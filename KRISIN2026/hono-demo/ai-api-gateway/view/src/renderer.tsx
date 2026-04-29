import type { MiddlewareHandler } from 'hono';
import type { Context, Next } from 'hono';

export const renderer: MiddlewareHandler = async (_: Context, next: Next) => {
    await next();
};
