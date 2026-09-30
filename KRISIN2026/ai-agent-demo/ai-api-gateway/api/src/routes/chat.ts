import { ChatOpenAI } from '@langchain/openai';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { AppEnv, ChatRequest } from '../types';

const chat: any = new Hono<AppEnv>();

// 流式代理
chat.post('/v1/chat/completions', async (c: any) => {
    const body = (await c.req.json()) as ChatRequest;
    const model = body.model || c.env.OPENAI_MODEL || 'gpt-4o-mini';
    const isStream = body.stream !== false; // 默认流式
    const baseUrl = c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const timeoutMs = 180000;
    const maxRetries = 0;

    const llm = new ChatOpenAI({
        apiKey: c.env.OPENAI_API_KEY,
        model,
        timeout: timeoutMs,
        maxRetries,
        configuration: {
            baseURL: baseUrl,
        },
    });

    // 非流式：直接转发 JSON 响应
    if (!isStream) {
        try {
            const result = await llm.invoke(body.messages);

            // 返回 OpenAI 兼容结构，前端/调用方更好处理
            return c.json({
                id: crypto.randomUUID(),
                object: 'chat.completion',
                model,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: String(result.content ?? ''),
                        },
                        finish_reason: 'stop',
                    },
                ],
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new HTTPException(502, {
                message: `Upstream error (${baseUrl}): ${message}`,
            });
        }
    }

    // 流式：SSE 转发（按 OpenAI chunk 结构封装）
    return streamSSE(c, async stream => {
        try {
            const chatStream = await llm.stream(body.messages);
            for await (const chunk of chatStream) {
                const text =
                    typeof chunk.content === 'string'
                        ? chunk.content
                        : Array.isArray(chunk.content)
                          ? chunk.content
                                .map((item: any) =>
                                    typeof item?.text === 'string'
                                        ? item.text
                                        : '',
                                )
                                .join('')
                          : '';

                if (!text) continue;
                await stream.writeSSE({
                    data: JSON.stringify({
                        id: crypto.randomUUID(),
                        object: 'chat.completion.chunk',
                        model,
                        choices: [
                            {
                                index: 0,
                                delta: { content: text },
                                finish_reason: null,
                            },
                        ],
                    }),
                    event: 'message',
                });
            }
            await stream.writeSSE({
                data: '[DONE]',
                event: 'message',
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new HTTPException(502, {
                message: `Upstream error (${baseUrl}): ${message}`,
            });
        }
    });
});

export default chat;
