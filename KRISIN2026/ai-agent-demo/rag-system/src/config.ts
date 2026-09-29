import { createHash } from 'node:crypto';
import { z } from 'zod';

const integer = (fallback: number, min: number, max: number) =>
    z.coerce.number().int().min(min).max(max).default(fallback);
const Schema = z
    .object({
        RAG_MODE: z.enum(['demo', 'live']).default('demo'),
        PORT: integer(3016, 1024, 65535),
        DATABASE_URL: z.string().min(1),
        RAG_TENANT_ID: z.string().min(1).default('demo-team'),
        CHUNK_SIZE: integer(600, 100, 2000),
        CHUNK_OVERLAP: integer(80, 0, 500),
        RECALL_K: integer(20, 1, 50),
        CONTEXT_K: integer(4, 1, 8),
        CONTEXT_CHAR_BUDGET: integer(2400, 500, 10000),
        MIN_VECTOR_SCORE: z.coerce.number().min(0).max(1).default(0.3),
        MIN_KEYWORD_SCORE: z.coerce.number().min(0).max(1).default(0.12),
        OPENAI_API_KEY: z.string().default(''),
        OPENAI_BASE_URL: z.string().default(''),
        AI_MODEL: z.string().default(''),
        EMBEDDING_API_KEY: z.string().default(''),
        EMBEDDING_BASE_URL: z.string().default(''),
        EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
        EMBEDDING_DIMENSIONS: integer(1536, 1, 8192),
    })
    .superRefine((c, ctx) => {
        if (c.CHUNK_OVERLAP >= c.CHUNK_SIZE)
            ctx.addIssue({
                code: 'custom',
                path: ['CHUNK_OVERLAP'],
                message: '必须小于 CHUNK_SIZE',
            });
        if (c.CONTEXT_K > c.RECALL_K)
            ctx.addIssue({
                code: 'custom',
                path: ['CONTEXT_K'],
                message: '不能大于 RECALL_K',
            });
        if (c.RAG_MODE === 'live' && (!c.OPENAI_API_KEY || !c.AI_MODEL))
            ctx.addIssue({
                code: 'custom',
                path: ['RAG_MODE'],
                message: 'live 需要 OPENAI_API_KEY 和 AI_MODEL',
            });
    });

export type Config = z.infer<typeof Schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const result = Schema.safeParse(env);
    // 不序列化整个 env 或 Zod 输入，防止错误日志带出密钥。
    if (!result.success)
        throw new Error(
            result.error.issues
                .map(i => `${i.path.join('.')}: ${i.message}`)
                .join('; '),
        );
    return result.data;
}
export const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
export function embeddingProfile(c: Config) {
    return c.RAG_MODE === 'demo'
        ? 'demo-feature-hash-v1:256'
        : `live:${hash(`${c.EMBEDDING_BASE_URL || c.OPENAI_BASE_URL || 'openai'}:${c.EMBEDDING_MODEL}:${c.EMBEDDING_DIMENSIONS}`).slice(0, 24)}`;
}
export function strategyVersion(c: Config) {
    return `rag-v1:${hash(
        JSON.stringify([
            embeddingProfile(c),
            c.CHUNK_SIZE,
            c.CHUNK_OVERLAP,
            c.RECALL_K,
            c.CONTEXT_K,
            c.CONTEXT_CHAR_BUDGET,
            c.MIN_VECTOR_SCORE,
            c.MIN_KEYWORD_SCORE,
            c.AI_MODEL,
        ]),
    ).slice(0, 12)}`;
}
