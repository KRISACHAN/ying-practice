import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export const errorHandler = (err: Error, c: Context) => {
    console.error(`[Error] ${err.message}`);

    if (err instanceof HTTPException) {
        return c.json({ error: err.message }, err.status);
    }

    // 未知错误，不暴露内部细节
    return c.json({ error: 'Internal Server Error' }, 500);
};
