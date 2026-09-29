import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { strategyVersion, type Config } from './config.js';
import {
    selectEvidence,
    validateCitations,
    type Candidate,
} from './retrieval.js';
import type { Models } from './models.js';
import type { Store } from './store.js';

export const QuerySchema = z
    .object({
        question: z.string().trim().min(2).max(1000),
        history: z
            .array(
                z.object({
                    role: z.enum(['user', 'assistant']),
                    content: z.string().max(2000),
                }),
            )
            .max(6)
            .default([]),
        retrieval: z.enum(['hybrid', 'vector', 'keyword']).default('hybrid'),
    })
    .strict();
export type Query = z.infer<typeof QuerySchema>;
export type RunEvent = {
    type: 'run_start' | 'node_start' | 'node_end' | 'run_end' | 'run_error';
    traceId: string;
    seq: number;
    elapsedMs: number;
    node?: string;
    detail?: string;
    durationMs?: number;
    state?: Record<string, unknown>;
    update?: Record<string, unknown>;
    inputState?: Record<string, unknown>;
    outcome?: 'completed' | 'failed' | 'cancelled';
    status?: string;
};
type Step = { node: string; durationMs: number; detail: string };
const fields = {
    question: z.string(),
    query: z.string().default(''),
    candidates: z.array(z.custom<Candidate>()).default(() => []),
    evidence: z.array(z.custom<Candidate>()).default(() => []),
    status: z
        .enum([
            'pending',
            'passed',
            'insufficient',
            'unavailable',
            'generation_failed',
        ])
        .default('pending'),
    answer: z.string().default(''),
    citationIds: z.array(z.string()).default(() => []),
};
const State = new StateSchema(fields);
type Snapshot = z.infer<z.ZodObject<typeof fields>>;
// 展示状态摘要而非整个图状态：不传客户端、鉴权信息或未经引用校验的模型正文。
function summarize(state: Partial<Snapshot>) {
    return {
        ...(state.question !== undefined ? { question: state.question } : {}),
        ...(state.query !== undefined ? { query: state.query } : {}),
        ...(state.candidates
            ? {
                  candidateCount: state.candidates.length,
                  candidates: state.candidates.map(s => ({
                      title: s.title,
                      sourceId: s.sourceId,
                      revision: s.revision,
                  })),
              }
            : {}),
        ...(state.evidence
            ? {
                  evidenceCount: state.evidence.length,
                  evidence: state.evidence.map((s, i) => ({
                      citationId: `S${i + 1}`,
                      title: s.title,
                      revision: s.revision,
                  })),
                  contextCharacters: state.evidence.reduce(
                      (sum, s) => sum + s.content.length,
                      0,
                  ),
              }
            : {}),
        ...(state.status !== undefined ? { status: state.status } : {}),
        ...(state.citationIds ? { citationIds: state.citationIds } : {}),
        ...(state.answer
            ? { validatedAnswerCharacters: state.answer.length }
            : {}),
    };
}
export async function runRag(
    c: Config,
    store: Store,
    models: Models,
    tenant: string,
    input: Query,
    signal?: AbortSignal,
    onEvent?: (event: RunEvent) => Promise<void> | void,
) {
    // 事件产生于节点真正开始和返回时，回看使用这份记录，不添加人为延迟。
    const traceId = crypto.randomUUID();
    const origin = performance.now();
    let seq = 0;
    const events: RunEvent[] = [];
    const trace: Step[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    let generated: Awaited<ReturnType<Models['answer']>> | undefined;
    const emit = async (
        event: Omit<RunEvent, 'traceId' | 'seq' | 'elapsedMs'>,
    ) => {
        const record = {
            ...event,
            traceId,
            seq: ++seq,
            elapsedMs: Math.round(performance.now() - origin),
        };
        events.push(record);
        await onEvent?.(record);
    };
    const timed = async (
        node: string,
        detail: string,
        state: Snapshot,
        work: () => Promise<Partial<Snapshot>>,
    ): Promise<Partial<Snapshot>> => {
        signal?.throwIfAborted();
        await emit({
            type: 'node_start',
            node,
            detail,
            state: summarize(state),
        });
        const start = performance.now();
        try {
            signal?.throwIfAborted();
            const update = await work();
            // 本地摘录及数据库调用未必消费 AbortSignal，节点返回前仍需确认取消状态。
            signal?.throwIfAborted();
            const durationMs = Math.round(performance.now() - start);
            trace.push({ node, detail, durationMs });
            await emit({
                type: 'node_end',
                node,
                detail,
                durationMs,
                state: summarize({ ...state, ...update }),
                inputState: summarize(state),
                update: summarize(update),
                outcome:
                    update.status === 'unavailable' ||
                    update.status === 'generation_failed'
                        ? 'failed'
                        : 'completed',
            });
            return update;
        } catch (error) {
            const durationMs = Math.round(performance.now() - start);
            trace.push({ node, detail, durationMs });
            await emit({
                type: 'node_end',
                node,
                detail,
                durationMs,
                outcome: signal?.aborted ? 'cancelled' : 'failed',
            });
            throw error;
        }
    };
    const graph = new StateGraph(State)
        .addNode('prepare_query', state =>
            timed(
                'prepare_query',
                '保留原始问题；有历史指代时补充检索上下文',
                state,
                async () => ({
                    query: await models.rewrite(
                        state.question,
                        input.history,
                        signal,
                    ),
                }),
            ),
        )
        .addNode('retrieve', state =>
            timed(
                'retrieve',
                `${input.retrieval} 召回；查询向量（关键词模式跳过）→ PG 范围过滤 → 两路排名融合`,
                state,
                async () => {
                    try {
                        const vector =
                            input.retrieval === 'keyword'
                                ? null
                                : await models.query(state.query, signal);
                        return {
                            candidates: await store.retrieve(
                                tenant,
                                state.query,
                                vector,
                                input.retrieval,
                            ),
                        };
                    } catch {
                        signal?.throwIfAborted();
                        return { candidates: [], status: 'unavailable' };
                    }
                },
            ),
        )
        .addNode('grade_evidence', state =>
            timed(
                'grade_evidence',
                '复核当前版本 → 阈值筛选 → 去重 → 上下文预算；决定生成或降级',
                state,
                async () => {
                    if (state.status === 'unavailable') return {};
                    try {
                        const candidates = await store.revalidate(
                            tenant,
                            state.candidates,
                        );
                        const evidence = selectEvidence(candidates, {
                            contextK: c.CONTEXT_K,
                            budget: c.CONTEXT_CHAR_BUDGET,
                            minVector: c.MIN_VECTOR_SCORE,
                            minKeyword: c.MIN_KEYWORD_SCORE,
                        });
                        return {
                            candidates,
                            evidence,
                            status: evidence.length ? 'passed' : 'insufficient',
                        };
                    } catch {
                        signal?.throwIfAborted();
                        return { status: 'unavailable', evidence: [] };
                    }
                },
            ),
        )
        .addNode('generate', state =>
            timed(
                'generate',
                c.RAG_MODE === 'demo'
                    ? '本地原文摘录；没有 LLM 调用'
                    : 'LangChain 提示词 → AI SDK 结构化生成；正文暂不发布',
                state,
                async () => {
                    try {
                        generated = await models.answer(
                            state.question,
                            state.evidence,
                            signal,
                        );
                        usage = generated.usage;
                        return {
                            status: generated.insufficient
                                ? 'insufficient'
                                : 'passed',
                        };
                    } catch {
                        signal?.throwIfAborted();
                        return { status: 'generation_failed' };
                    }
                },
            ),
        )
        .addNode('validate_answer', state =>
            timed(
                'validate_answer',
                '检查正文与引用 ID 一致 → 复核来源版本 → 允许发布答案',
                state,
                async () => {
                    try {
                        if (!generated) throw new Error('MISSING_GENERATION');
                        const citationIds = validateCitations(
                            generated.answer,
                            generated.citationIds,
                            state.evidence,
                        );
                        const fresh = await store.revalidate(
                            tenant,
                            state.evidence,
                        );
                        if (fresh.length !== state.evidence.length)
                            return { status: 'insufficient' };
                        return { answer: generated.answer, citationIds };
                    } catch {
                        signal?.throwIfAborted();
                        return { status: 'generation_failed' };
                    }
                },
            ),
        )
        .addNode('fallback', state =>
            timed('fallback', `明确结束：${state.status}`, state, async () => ({
                answer:
                    state.status === 'unavailable'
                        ? '检索服务暂时不可用，请稍后重试。'
                        : state.status === 'generation_failed'
                          ? '生成服务失败或引用未通过验证，本次不展示未经验证的答案。'
                          : '现有资料不足以回答这个问题。请补充条件或导入相关资料。',
                citationIds: [],
                evidence: [],
            })),
        )
        .addEdge(START, 'prepare_query')
        .addEdge('prepare_query', 'retrieve')
        .addEdge('retrieve', 'grade_evidence')
        .addConditionalEdges('grade_evidence', state =>
            state.status === 'passed' ? 'generate' : 'fallback',
        )
        .addConditionalEdges('generate', state =>
            state.status === 'passed' ? 'validate_answer' : 'fallback',
        )
        .addConditionalEdges('validate_answer', state =>
            state.status === 'passed' ? END : 'fallback',
        )
        .addEdge('fallback', END)
        .compile();
    await emit({
        type: 'run_start',
        state: {
            question: input.question,
            retrieval: input.retrieval,
            mode: c.RAG_MODE,
        },
    });
    try {
        const result = await graph.invoke(
            { question: input.question },
            { signal },
        );
        await emit({
            type: 'run_end',
            status: result.status,
            state: summarize(result),
        });
        const { evidence, ...rest } = result;
        return {
            ...rest,
            mode: c.RAG_MODE,
            traceId,
            strategyVersion: strategyVersion(c),
            trace,
            events,
            usage,
            sources: evidence.map((item, i) => ({
                ...item,
                citationId: `S${i + 1}`,
                cited: result.citationIds.includes(`S${i + 1}`),
            })),
        };
    } catch (error) {
        await emit({
            type: 'run_error',
            outcome: signal?.aborted ? 'cancelled' : 'failed',
            detail: signal?.aborted
                ? '请求已取消或超时，未发布答案'
                : '执行中断，未发布答案',
        });
        throw error;
    }
}
