import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ApiKeyInfo, AppEnv } from '../types';

export const authMiddleware = createMiddleware<AppEnv>(
    async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
        throw new HTTPException(401, {
            message: 'Missing or invalid Authorization header',
        });
    }

    const apiKey = authHeader.slice(7); // 去掉 "Bearer "

    // 从 KV 读取 key 信息
    const keyInfo = (await c.env.API_KEYS_KV.get(
        `key:${apiKey}`,
        'json',
    )) as ApiKeyInfo | null;

    if (!keyInfo) {
        throw new HTTPException(401, { message: 'Invalid API key' });
    }

    // 把 key 信息存到 context 里，后续中间件和路由可以用
    c.set('apiKeyId', keyInfo.id);
    c.set('apiKeyInfo', keyInfo);

        await next();
    },
);
