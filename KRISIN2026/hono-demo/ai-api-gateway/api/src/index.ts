import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import chat from './routes/chat';
import usage from './routes/usage';
import type { AppEnv } from './types';

const app: any = new Hono<AppEnv>();

// 全局中间件
app.use('*', logger());
app.use('*', cors());

// 健康检查（不需要鉴权）
app.get('/health', (c: any) => {
    return c.json({ status: 'ok', timestamp: Date.now() });
});

// API 路由（需要鉴权 + 限流）
const api: any = new Hono<AppEnv>();
api.use('*', authMiddleware);
api.use('*', rateLimitMiddleware);
api.route('/', chat);
api.route('/', usage);

app.route('/api', api);

// 全局错误处理
app.onError((err: any, c: any) => {
    if (err instanceof HTTPException) {
        return c.json({ error: err.message }, err.status);
    }

    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
});

// 404
app.notFound((c: any) => {
    return c.json({ error: 'Not found' }, 404);
});

export default app;
