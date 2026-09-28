import 'server-only';
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { traceable } from 'langsmith/traceable';
import { z } from 'zod';
import { composeMessages } from './answer-chain';
import type { ChatMessage, NodeId, RunEvent } from './contracts';

const State = new StateSchema({
    question: z.string(),
    strategy: z.string(),
    direction: z.string(),
    answer: z.string(),
});
export async function runWorkflow(
    input: { question: string; history: ChatMessage[]; mode: 'demo' | 'live' },
    emit: (event: RunEvent) => void,
    signal: AbortSignal,
) {
    const runId = crypto.randomUUID();
    // 每个请求单独创建图与消息，避免并发用户共享会话。
    let messages: Awaited<ReturnType<typeof composeMessages>> = [];
    const mark = (
        node: NodeId,
        status: 'running' | 'done' | 'error',
        detail: string,
    ) => emit({ type: 'node', node, status, detail, at: Date.now() });
    const node =
        <T>(
            id: NodeId,
            work: () => Promise<T>,
            detail: string,
            describe?: (result: T) => string,
        ) =>
        async () => {
            mark(id, 'running', detail);
            try {
                signal.throwIfAborted();
                const result = await work();
                mark(id, 'done', describe ? describe(result) : detail);
                return result;
            } catch (error) {
                mark(id, 'error', '此节点执行失败');
                throw error;
            }
        };
    const tracing = process.env.LANGSMITH_TRACING === 'true';
    const generate = traceable(
        async () => {
            if (input.mode === 'demo') {
                // 离线示例也执行真实的图与提示词模板；仅模型输出是模拟内容。
                const text = /难过|累|烦|委屈|压力|孤独/.test(input.question)
                    ? '听起来今天有些累了。我在这里听你说。是发生了什么让你难过的事，还是想先安静地聊一会儿？'
                    : '好呀，我们慢慢聊。今天有没有一个让你觉得还不错的小瞬间？我想听听你的故事。';
                for (const part of text.match(/.{1,4}/gu) ?? []) {
                    signal.throwIfAborted();
                    emit({ type: 'token', text: part });
                    await new Promise(resolve => setTimeout(resolve, 45));
                }
                return text;
            }
            if (!process.env.OPENAI_API_KEY || !process.env.AI_MODEL)
                throw new Error('MODEL_NOT_CONFIGURED');
            const provider = createOpenAI({
                apiKey: process.env.OPENAI_API_KEY,
                ...(process.env.OPENAI_BASE_URL
                    ? { baseURL: process.env.OPENAI_BASE_URL }
                    : {}),
            });
            const result = streamText({
                model: provider(process.env.AI_MODEL),
                messages,
                abortSignal: signal,
                maxRetries: 1,
                maxOutputTokens: 700,
            });
            let text = '';
            for await (const chunk of result.textStream) {
                text += chunk;
                emit({ type: 'token', text: chunk });
            }
            if (!text) throw new Error('EMPTY_MODEL_RESPONSE');
            return text;
        },
        { name: 'companion_model', tracingEnabled: tracing },
    );
    const graph = new StateGraph(State)
        .addNode(
            'receive',
            node('receive', async () => ({}), '接收当前消息与近期对话'),
        )
        .addNode('route', state =>
            node(
                'route',
                async () => ({
                    direction: /难过|累|烦|委屈|压力|孤独/.test(state.question)
                        ? 'comfort'
                        : 'daily',
                }),
                '关键词规则选择回应分支',
                result => `条件边选择：${result.direction}`,
            )(),
        )
        .addNode(
            'comfort',
            node(
                'comfort',
                async () => ({
                    strategy: '先共情和倾听，再问一个温和的问题。',
                }),
                '选择情绪陪伴策略',
                result => result.strategy,
            ),
        )
        .addNode(
            'daily',
            node(
                'daily',
                async () => ({
                    strategy: '轻松自然地交流，结合用户话题提问。',
                }),
                '选择日常聊天策略',
                result => result.strategy,
            ),
        )
        .addNode(
            'memory',
            node(
                'memory',
                async () => ({}),
                `读取 ${input.history.length} 条近期消息`,
            ),
        )
        .addNode('prompt', state =>
            node(
                'prompt',
                async () => {
                    messages = await composeMessages(
                        state.question,
                        input.history,
                        state.strategy,
                    );
                    return {};
                },
                'LangChain 组合角色、策略、历史与问题',
                () =>
                    messages
                        .map(message => `[${message.role}] ${message.content}`)
                        .join('\n\n'),
            )(),
        )
        .addNode(
            'model',
            node(
                'model',
                async () => ({ answer: await generate() }),
                input.mode === 'demo'
                    ? '本地模拟输出（未调用模型）'
                    : 'AI SDK 流式调用模型',
            ),
        )
        .addNode(
            'reply',
            node('reply', async () => ({}), '完成本轮回复'),
        )
        .addEdge(START, 'receive')
        .addEdge('receive', 'route')
        .addConditionalEdges('route', state =>
            state.direction === 'comfort' ? 'comfort' : 'daily',
        )
        .addEdge('comfort', 'memory')
        .addEdge('daily', 'memory')
        .addEdge('memory', 'prompt')
        .addEdge('prompt', 'model')
        .addEdge('model', 'reply')
        .addEdge('reply', END)
        .compile();
    const run = traceable(
        async () =>
            graph.invoke({
                question: input.question,
                strategy: '',
                direction: '',
                answer: '',
            }),
        {
            name: 'companion_workflow',
            tracingEnabled: tracing,
            metadata: { runId, mode: input.mode },
        },
    );
    await run();
    emit({ type: 'complete', runId, tracing });
}
