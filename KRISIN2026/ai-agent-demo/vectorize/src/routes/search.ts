import { Hono } from 'hono';
import type { AppEnv } from '../types';

const search = new Hono<AppEnv>();

search.post('/search', async c => {
    const { query, topK = 5 } = await c.req.json<{
        query: string;
        topK?: number;
    }>();

    // 1. 把问题也转成向量
    const embeddingResult = (await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [query],
    })) as any;
    const queryVector = embeddingResult?.data?.[0] as number[] | undefined;
    if (!queryVector) {
        return c.json({ error: 'Failed to generate query embedding' }, 500);
    }

    // 2. 查最相似的 topK 条
    const result = await c.env.DOCS_INDEX.query(queryVector, {
        topK: 5,
        returnMetadata: 'all',
        filter: {
            source: { $eq: 'internal-wiki' },
        },
    });

    return c.json({
        matches: result.matches.map(m => ({
            id: m.id,
            score: m.score, // 相似度分数，0~1 之间
            text: m.metadata?.text,
            source: m.metadata?.source,
        })),
    });
});

export default search;
