import { Hono } from 'hono';
import type { AppEnv } from '../types';

const ingest = new Hono<AppEnv>();

ingest.post('/ingest', async c => {
    const { docs } = await c.req.json<{
        docs: Array<{ id: string; text: string; source?: string }>;
    }>();

    // 1. 批量生成 embedding（Workers AI 一次最多 100 段文本）
    //    返回 { data: [向量1, 向量2, ...] }，每个向量是 float[]
    const texts = docs.map(d => d.text);
    const { data: embeddings } = await c.env.AI.run(
        '@cf/baai/bge-base-en-v1.5',
        {
            text: texts,
        },
    );

    // 2. 组装成 Vectorize 的格式
    const vectors = docs.map((doc, i) => ({
        id: doc.id,
        values: embeddings[i],
        metadata: {
            text: doc.text,
            source: doc.source || 'unknown',
            insertedAt: Date.now(),
        },
    }));

    // 3. 一次批量写入
    const result = await c.env.DOCS_INDEX.upsert(vectors);

    return c.json({
        ingested: vectors.length,
        mutationId: result.mutationId,
    });
});

export default ingest;
