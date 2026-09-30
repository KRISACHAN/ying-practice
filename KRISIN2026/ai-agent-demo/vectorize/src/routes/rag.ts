import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../types';

const rag = new Hono<AppEnv>();

rag.post('/rag', async c => {
    const { question } = await c.req.json<{ question: string }>();

    // 1. 检索相关文档
    //    只传一段文本，按 first vector 取查询向量
    const embeddingResult = (await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [question],
    })) as any;
    const queryVec = embeddingResult?.data?.[0] as number[] | undefined;
    if (!queryVec) {
        return c.json({ error: 'Failed to generate query embedding' }, 500);
    }

    const { matches } = await c.env.DOCS_INDEX.query(queryVec, {
        topK: 3,
        returnMetadata: 'all',
    });

    // 2. 把检索到的片段拼进 prompt
    const context = matches
        .map((m, i) => `[${i + 1}] ${m.metadata?.text}`)
        .join('\n\n');

    const systemPrompt = `你是一个根据提供的上下文回答问题的助手。
只使用下面的上下文回答。如果上下文里没有答案，就回复"根据现有资料无法回答"。

上下文：
${context}`;

    // 3. 调用大模型流式生成
    return streamSSE(c, async stream => {
        const llmStream = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: question },
            ],
            stream: true,
        });

        const reader = (llmStream as unknown as ReadableStream).getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await stream.writeSSE({
                data: decoder.decode(value, { stream: true }),
                event: 'delta',
            });
        }

        // 顺便把引用来源也发给前端，方便展示
        await stream.writeSSE({
            data: JSON.stringify(
                matches.map(m => ({ id: m.id, score: m.score })),
            ),
            event: 'sources',
        });
    });
});

export default rag;
