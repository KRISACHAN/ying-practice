import { z } from 'zod';
import { runWorkflow } from '@/lib/workflow';
export const runtime = 'nodejs';
const schema = z.object({
    question: z.string().trim().min(1).max(1000),
    history: z
        .array(
            z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string().max(4000),
            }),
        )
        .max(12)
        .default([]),
    mode: z.enum(['demo', 'live']).default('demo'),
});
export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: '请求必须为 JSON' }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return Response.json(
            { error: '消息或会话历史格式不正确' },
            { status: 400 },
        );
    // NDJSON 一行一个事件；图节点、模型文字和错误使用同一个有序通道。
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const emit = (event: unknown) => {
                if (!request.signal.aborted)
                    controller.enqueue(
                        encoder.encode(JSON.stringify(event) + '\n'),
                    );
            };
            try {
                await runWorkflow(
                    parsed.data,
                    emit,
                    AbortSignal.any([
                        request.signal,
                        AbortSignal.timeout(60000),
                    ]),
                );
            } catch (error) {
                emit({
                    type: 'error',
                    message:
                        error instanceof Error &&
                        error.message === 'MODEL_NOT_CONFIGURED'
                            ? '请在 .env.local 配置 OPENAI_API_KEY 与 AI_MODEL，或切换到演示模式。'
                            : '本轮执行失败，请检查模型配置与服务端日志。',
                });
            } finally {
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
