import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { z } from 'zod';
import { users } from '../db/schema';
import type { AppEnv } from '../types';
import { hashPassword, verifyPassword } from '../utils/password';

const auth = new Hono<AppEnv>();

// 注册校验规则
const registerSchema = z.object({
    email: z.email({ error: '邮箱格式不正确' }),
    name: z.string().min(2, '名称至少 2 个字符'),
    password: z.string().min(6, '密码至少 6 位'),
});

auth.post('/register', zValidator('json', registerSchema), async c => {
    const { email, name, password } = c.req.valid('json');
    const db = drizzle(c.env.DB);

    // 检查邮箱是否已注册
    const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

    if (existing) {
        return c.json({ error: '该邮箱已注册' }, 409);
    }

    // 哈希密码并入库
    const passwordHash = await hashPassword(password);
    const newUser = await db
        .insert(users)
        .values({ email, name, passwordHash })
        .returning()
        .get();

    return c.json(
        {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
        },
        201,
    );
});

const loginSchema = z.object({
    email: z.email(),
    password: z.string(),
});

auth.post('/login', zValidator('json', loginSchema), async c => {
    const { email, password } = c.req.valid('json');
    const db = drizzle(c.env.DB);

    const user = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

    if (!user) {
        return c.json({ error: '邮箱或密码错误' }, 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
        return c.json({ error: '邮箱或密码错误' }, 401);
    }

    // 签发 JWT，24 小时过期
    const token = await sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        },
        c.env.JWT_SECRET,
    );

    return c.json({ token });
});

export default auth;
