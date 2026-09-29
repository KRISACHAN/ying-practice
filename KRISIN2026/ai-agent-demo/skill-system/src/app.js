import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
    buildMessages,
    listSkills,
    runPromptSkill,
    selectSkill,
} from './skills.js';
import { streamChatCompletion } from './model-stream.js';

export const app = new Hono();

const assets = new Map([
    ['/', ['../web/index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['../web/app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['../web/style.css', 'text/css; charset=utf-8']],
]);

for (const [path, [relativePath, contentType]] of assets) {
    app.get(path, async c => {
        const body = await readFile(
            fileURLToPath(new URL(relativePath, import.meta.url)),
        );
        return c.body(body, 200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        });
    });
}

app.get('/api/skills', c => {
    const model = process.env.OPENAI_MODEL || process.env.AI_MODEL;
    return c.json({
        skills: listSkills(),
        liveAvailable: Boolean(process.env.OPENAI_API_KEY && model),
        model: model || null,
    });
});

app.post('/api/run', async c => {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) {
        return c.json({ error: '只接受同源请求' }, 403);
    }
    let input;
    try {
        const body = await c.req.text();
        if (body.length > 10_000) throw new Error('输入过长');
        input = JSON.parse(body);
    } catch {
        return c.json({ error: '请求内容不是有效 JSON，或输入过长' }, 400);
    }

    const { text } = input ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
        return c.json({ error: '请输入 1–2000 字的消息' }, 400);
    }

    const selection = selectSkill({ text });
    const execution = runPromptSkill(selection);
    const messages = buildMessages({ text, selection });
    return c.json({ execution, messages });
});

app.post('/api/run/stream', async c => {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin)
        return c.json({ error: '只接受同源请求' }, 403);
    let input;
    try {
        const body = await c.req.text();
        if (body.length > 10_000) throw new Error('输入过长');
        input = JSON.parse(body);
    } catch {
        return c.json({ error: '请求内容不是有效 JSON，或输入过长' }, 400);
    }
    const { text } = input ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 2000)
        return c.json({ error: '请输入 1–2000 字的消息' }, 400);

    const selection = selectSkill({ text });
    const execution = runPromptSkill(selection);
    const messages = buildMessages({ text, selection });
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || process.env.AI_MODEL;
    if (!apiKey || !model)
        return c.json(
            {
                error: '请在 .env 中配置 OPENAI_API_KEY 和 AI_MODEL，然后重启服务',
            },
            400,
        );

    return streamSSE(c, async stream => {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(new Error('模型请求超过 120 秒，请重试')),
            120_000,
        );
        stream.onAbort(() => controller.abort());
        try {
            await stream.writeSSE({
                event: 'selection',
                data: JSON.stringify({ execution, messages }),
            });
            await streamChatCompletion({
                apiKey,
                baseUrl:
                    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
                model,
                messages,
                signal: controller.signal,
                onDelta: async delta =>
                    stream.writeSSE({
                        event: 'delta',
                        data: JSON.stringify({ text: delta }),
                    }),
            });
            await stream.writeSSE({ event: 'done', data: '{}' });
        } catch (error) {
            if (!stream.aborted) {
                const message =
                    controller.signal.reason instanceof Error
                        ? controller.signal.reason.message
                        : error instanceof Error
                          ? error.message
                          : '模型调用失败';
                await stream.writeSSE({
                    event: 'error',
                    data: JSON.stringify({ message }),
                });
            }
        } finally {
            clearTimeout(timeout);
        }
    });
});
