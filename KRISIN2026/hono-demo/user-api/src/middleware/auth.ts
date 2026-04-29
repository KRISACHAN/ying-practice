import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwt } from 'hono/jwt';
import type { AppEnv } from '../types';

// JWT 认证中间件：验证 token 是否有效
export const authMiddleware = (c: Context<AppEnv>, next: Next) => {
    const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
    return jwtMiddleware(c, next);
};

// 角色鉴权中间件：检查是否有特定角色
export const requireRole = (role: string) => {
    return async (c: Context<AppEnv>, next: Next) => {
        const payload = c.get('jwtPayload');

        if (payload.role !== role) {
            throw new HTTPException(403, {
                message: '权限不足',
            });
        }

        await next();
    };
};
