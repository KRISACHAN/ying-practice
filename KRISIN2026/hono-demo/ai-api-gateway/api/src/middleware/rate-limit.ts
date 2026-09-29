import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types';

export const rateLimitMiddleware = createMiddleware<AppEnv>(
    async (c: any, next: any) => {
        const apiKeyId = c.get('apiKeyId');
        const apiKeyInfo = c.get('apiKeyInfo');
        const limit = apiKeyInfo.rateLimit || 60;

        // 当前分钟的时间窗口 key
        const windowKey = `rate:${apiKeyId}:${Math.floor(Date.now() / 60000)}`;

        const count = parseInt(
            (await c.env.RATE_LIMIT_KV.get(windowKey)) || '0',
        );

        if (count >= limit) {
            throw new HTTPException(429, {
                message: `Rate limit exceeded. Max ${limit} requests per minute.`,
            });
        }

        // 计数 +1，设置 120 秒过期（确保过了这分钟后自动清理）
        await c.env.RATE_LIMIT_KV.put(windowKey, String(count + 1), {
            expirationTtl: 120,
        });

        // 在响应头里告诉客户端限流状态
        c.header('X-RateLimit-Limit', String(limit));
        c.header('X-RateLimit-Remaining', String(limit - count - 1));

        await next();
    },
);
