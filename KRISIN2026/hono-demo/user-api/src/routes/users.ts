import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { users } from '../db/schema';
import { requireRole } from '../middleware/auth';
import type { AppEnv } from '../types';

const userRoutes = new Hono<AppEnv>();

// GET /users/me — 获取当前用户信息
userRoutes.get('/me', async c => {
    const payload = c.get('jwtPayload');
    const db = drizzle(c.env.DB);

    const user = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, payload.sub))
        .get();

    if (!user) {
        return c.json({ error: '用户不存在' }, 404);
    }

    return c.json(user);
});

// PUT /users/me — 更新个人信息
const updateSchema = z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
});

userRoutes.put('/me', zValidator('json', updateSchema), async c => {
    const payload = c.get('jwtPayload');
    const data = c.req.valid('json');
    const db = drizzle(c.env.DB);

    // 如果要改邮箱，检查新邮箱是否已被别人占用
    if (data.email) {
        const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, data.email))
            .get();

        if (existing && existing.id !== payload.sub) {
            return c.json({ error: '该邮箱已被使用' }, 409);
        }
    }

    const updated = await db
        .update(users)
        .set(data)
        .where(eq(users.id, payload.sub))
        .returning({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
        })
        .get();

    return c.json(updated);
});

// GET /users — 管理员列出所有用户
userRoutes.get('/', requireRole('admin'), async c => {
    const db = drizzle(c.env.DB);

    const allUsers = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            createdAt: users.createdAt,
        })
        .from(users)
        .all();

    return c.json(allUsers);
});

// DELETE /users/:id — 管理员删除用户
userRoutes.delete('/:id', requireRole('admin'), async c => {
    const id = Number(c.req.param('id'));
    const db = drizzle(c.env.DB);

    const deleted = await db
        .delete(users)
        .where(eq(users.id, id))
        .returning()
        .get();

    if (!deleted) {
        return c.json({ error: '用户不存在' }, 404);
    }

    return c.json({ message: '已删除' });
});

export default userRoutes;
