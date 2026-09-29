import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { createModels } from '../src/models.js';
import { Store, ConflictError } from '../src/store.js';
import { fixtures } from '../src/fixtures.js';
import { evaluate } from '../src/evaluation.js';
import { runRag, QuerySchema } from '../src/workflow.js';
import { createApp } from '../src/app.js';
import { createEventParser } from '../web/events.js';
import type { RunEvent } from '../src/workflow.js';

test(
    '真实 PostgreSQL：生命周期、租户隔离、失败路径和 HTTP 合约',
    { skip: !process.env.DATABASE_URL },
    async t => {
        const config = readConfig({ ...process.env, RAG_MODE: 'demo' });
        const models = createModels(config);
        const store = new Store(config, models);
        const tenant = `test-${crypto.randomUUID()}`;
        const other = `${tenant}-other`;
        await store.init();
        try {
            await t.test('重复导入幂等，新版本切换后旧向量消失', async () => {
                const input = {
                    id: 'version-test',
                    title: '审批规则',
                    body: '连续两天年假需要部门负责人审批。',
                };
                const first = await store.ingest(tenant, input);
                assert.equal(first.revision, 1);
                assert.equal(
                    (await store.ingest(tenant, input)).unchanged,
                    true,
                );
                const before = await store.retrieve(
                    tenant,
                    '年假审批',
                    await models.query('年假审批'),
                    'hybrid',
                );
                await store.ingest(tenant, {
                    ...input,
                    body: '连续两天年假由直属负责人审批，不再需要部门负责人。',
                });
                assert.equal(
                    (await store.revalidate(tenant, before)).length,
                    0,
                );
                const after = await store.retrieve(
                    tenant,
                    '年假审批',
                    await models.query('年假审批'),
                    'hybrid',
                );
                assert.ok(after.every(r => r.revision === 2));
            });
            await t.test(
                'Embedding 失败不发布半成品，旧版本保持可读',
                async () => {
                    const failedModels = {
                        ...models,
                        documents: async () => {
                            throw new Error('synthetic provider failure');
                        },
                    };
                    const failedStore = new Store(config, failedModels);
                    try {
                        await assert.rejects(
                            failedStore.ingest(tenant, {
                                id: 'version-test',
                                title: '审批规则',
                                body: '更新失败不应发布。',
                            }),
                        );
                        assert.equal((await store.list(tenant))[0].revision, 2);
                        assert.equal(
                            (await store.jobs(tenant))[0].status,
                            'failed',
                        );
                    } finally {
                        await failedStore.close();
                    }
                },
            );
            await t.test('过期索引任务不能覆盖更新后的正文', async () => {
                let started!: () => void;
                let release!: () => void;
                const start = new Promise<void>(resolve => {
                    started = resolve;
                });
                const barrier = new Promise<void>(resolve => {
                    release = resolve;
                });
                const delayed = new Store(config, {
                    ...models,
                    documents: async texts => {
                        started();
                        await barrier;
                        return models.documents(texts);
                    },
                });
                try {
                    const pending = delayed.ingest(tenant, {
                        id: 'version-test',
                        title: '审批规则',
                        body: '旧任务想写入的正文。',
                    });
                    await start;
                    await store.ingest(tenant, {
                        id: 'version-test',
                        title: '审批规则',
                        body: '最新审批规则优先于过期索引任务。',
                    });
                    release();
                    await assert.rejects(pending, ConflictError);
                    assert.equal((await store.list(tenant))[0].revision, 3);
                } finally {
                    release();
                    await delayed.close();
                }
            });
            await t.test(
                '过滤在召回前，其他租户的高相关文档不会出现',
                async () => {
                    await store.ingest(other, {
                        id: 'private',
                        title: '审批规则',
                        body: '年假审批由秘密团队执行，这属于其他租户。',
                    });
                    const results = await store.retrieve(
                        tenant,
                        '年假审批',
                        await models.query('年假审批'),
                        'hybrid',
                    );
                    assert.ok(results.every(r => r.sourceId !== 'private'));
                    assert.equal(await store.remove(tenant, 'private'), false);
                    assert.equal((await store.list(other)).length, 1);
                },
            );
            await t.test('删除正文时级联删除向量与检索结果', async () => {
                assert.equal(await store.remove(tenant, 'version-test'), true);
                assert.equal(
                    (
                        await store.retrieve(
                            tenant,
                            '审批',
                            await models.query('审批'),
                            'hybrid',
                        )
                    ).length,
                    0,
                );
            });
            await t.test(
                '工作流回答、无答案、检索故障、生成故障与取消分别处理',
                async () => {
                    for (const fixture of fixtures)
                        await store.ingest(tenant, fixture);
                    const query = QuerySchema.parse({
                        question: 'RRF 为什么按排名融合？',
                    });
                    const answer = await runRag(
                        config,
                        store,
                        models,
                        tenant,
                        query,
                    );
                    assert.equal(answer.status, 'passed');
                    assert.ok(answer.answer.includes('[S1]'));
                    const empty = await runRag(
                        config,
                        store,
                        models,
                        tenant,
                        QuerySchema.parse({
                            question: '火星温室番茄种植温度是多少？',
                        }),
                    );
                    assert.equal(empty.status, 'insufficient');
                    assert.equal(empty.sources.length, 0);
                    const failed = await runRag(
                        config,
                        store,
                        {
                            ...models,
                            query: async () => {
                                throw new Error('synthetic timeout');
                            },
                        },
                        tenant,
                        query,
                    );
                    assert.equal(failed.status, 'unavailable');
                    const generated = await runRag(
                        config,
                        store,
                        {
                            ...models,
                            answer: async () => {
                                throw new Error('synthetic failure');
                            },
                        },
                        tenant,
                        query,
                    );
                    assert.equal(generated.status, 'generation_failed');
                    assert.equal(generated.sources.length, 0);
                    const cancelled = AbortSignal.abort();
                    await assert.rejects(
                        runRag(config, store, models, tenant, query, cancelled),
                    );
                    const noEmbedding = await runRag(
                        config,
                        store,
                        {
                            ...models,
                            query: async () => {
                                throw new Error('keyword must not embed');
                            },
                        },
                        tenant,
                        { ...query, retrieval: 'keyword' },
                    );
                    assert.equal(noEmbedding.status, 'passed');
                },
            );
            await t.test(
                'HTTP 输入、跨站请求、固定服务端租户和评测集',
                async () => {
                    const app = createApp(
                        { ...config, RAG_TENANT_ID: tenant },
                        store,
                        models,
                    );
                    assert.equal(
                        (await app.request('/api/status')).status,
                        200,
                    );
                    const request = (body: unknown, origin?: string) =>
                        app.request('/api/query', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(origin ? { Origin: origin } : {}),
                            },
                            body: JSON.stringify(body),
                        });
                    assert.equal(
                        (
                            await request({
                                question: 'RAG 是什么',
                                tenantId: other,
                            })
                        ).status,
                        400,
                    );
                    assert.equal(
                        (
                            await request(
                                { question: 'RAG 是什么' },
                                'https://untrusted.example',
                            )
                        ).status,
                        403,
                    );
                    const normalizedOrigin = await app.request('/api/query', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Origin: 'http://127.0.0.1',
                            Referer: `http://127.0.0.1:${config.PORT}/`,
                            'Sec-Fetch-Site': 'same-origin',
                        },
                        body: JSON.stringify({
                            question: 'RRF 为什么按排名融合？',
                        }),
                    });
                    assert.equal(normalizedOrigin.status, 200);
                    const otherPort = await app.request('/api/query', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Origin: 'http://127.0.0.1',
                            Referer: 'http://127.0.0.1:8888/',
                            'Sec-Fetch-Site': 'same-site',
                        },
                        body: JSON.stringify({ question: 'RAG 是什么' }),
                    });
                    assert.equal(otherPort.status, 403);
                    const response = await request({
                        question: 'RRF 为什么按排名融合？',
                    });
                    assert.equal(response.status, 200);
                    const result = await response.json();
                    assert.equal(result.status, 'passed');
                    assert.ok(
                        !JSON.stringify(result).includes('OPENAI_API_KEY'),
                    );
                    const evaluation = await evaluate(
                        config,
                        store,
                        models,
                        tenant,
                    );
                    assert.equal(evaluation.passed, evaluation.total);
                },
            );
            await t.test('模型 profile 更改不会混搜旧空间', async () => {
                const liveConfig = readConfig({
                    ...process.env,
                    RAG_MODE: 'live',
                    OPENAI_API_KEY: 'synthetic-test-key',
                    AI_MODEL: 'synthetic-test-model',
                });
                // 注入本地模型只验证数据库 profile 边界，不向外部服务发送任何请求。
                const migrated = new Store(liveConfig, models);
                try {
                    assert.equal(
                        (
                            await migrated.retrieve(
                                tenant,
                                'RRF',
                                await models.query('RRF'),
                                'hybrid',
                            )
                        ).length,
                        0,
                    );
                } finally {
                    await migrated.close();
                }
            });
            await t.test(
                '实时事件在模型返回前送达，最终答案仍等引用校验后发布',
                async () => {
                    let release!: () => void;
                    const barrier = new Promise<void>(resolve => {
                        release = resolve;
                    });
                    const delayedModels = {
                        ...models,
                        query: async (text: string) => {
                            await barrier;
                            return models.query(text);
                        },
                    };
                    const app = createApp(
                        { ...config, RAG_TENANT_ID: tenant },
                        store,
                        delayedModels,
                    );
                    const response = await app.request('/api/query/stream', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            question: 'RRF 为什么按排名融合？',
                        }),
                    });
                    assert.equal(response.status, 200);
                    assert.match(
                        response.headers.get('content-type')!,
                        /text\/event-stream/,
                    );
                    const received: RunEvent[] = [];
                    let result: { status: string; answer: string } | undefined;
                    const parse = createEventParser(
                        (name: string, data: any) => {
                            if (name === 'progress') received.push(data);
                            if (name === 'result') result = data;
                        },
                    );
                    const reader = response.body!.getReader();
                    const decoder = new TextDecoder();
                    try {
                        // 不释放模拟模型，先确认 retrieve 进入事件已抵达客户端；禁止完成后伪造动画。
                        while (
                            !received.some(
                                e =>
                                    e.node === 'retrieve' &&
                                    e.type === 'node_start',
                            )
                        ) {
                            const chunk = await reader.read();
                            assert.equal(chunk.done, false);
                            parse(
                                decoder.decode(chunk.value, { stream: true }),
                            );
                        }
                        assert.equal(result, undefined);
                        assert.ok(!received.some(e => e.type === 'run_end'));
                        release();
                        while (true) {
                            const chunk = await reader.read();
                            if (chunk.done) break;
                            parse(
                                decoder.decode(chunk.value, { stream: true }),
                            );
                        }
                        assert.equal(result!.status, 'passed');
                        assert.ok(result!.answer.includes('[S1]'));
                        assert.deepEqual(
                            received
                                .filter(e => e.type === 'node_start')
                                .map(e => e.node),
                            [
                                'prepare_query',
                                'retrieve',
                                'grade_evidence',
                                'generate',
                                'validate_answer',
                            ],
                        );
                        assert.deepEqual(
                            received.map(e => e.seq),
                            received.map((_, i) => i + 1),
                        );
                        assert.equal(
                            new Set(received.map(e => e.traceId)).size,
                            1,
                        );
                        assert.ok(
                            received.every(e => !('answer' in (e.state || {}))),
                        );
                    } finally {
                        release();
                        reader.releaseLock();
                    }
                },
            );
            await t.test(
                '事件准确记录降级与执行中取消，不把失败节点标记成功',
                async () => {
                    const query = QuerySchema.parse({
                        question: 'RRF 为什么按排名融合？',
                    });
                    const failed = await runRag(
                        config,
                        store,
                        {
                            ...models,
                            answer: async () => {
                                return {
                                    answer: '未经支持的答案 [S999]',
                                    citationIds: ['S999'],
                                    insufficient: false,
                                    usage: { inputTokens: 0, outputTokens: 0 },
                                };
                            },
                        },
                        tenant,
                        query,
                    );
                    assert.equal(failed.status, 'generation_failed');
                    assert.ok(
                        failed.events.some(
                            e =>
                                e.node === 'validate_answer' &&
                                e.type === 'node_end' &&
                                e.outcome === 'failed',
                        ),
                    );
                    assert.ok(
                        failed.events.some(
                            e =>
                                e.node === 'fallback' &&
                                e.type === 'node_start',
                        ),
                    );
                    const controller = new AbortController();
                    const records: RunEvent[] = [];
                    await assert.rejects(
                        runRag(
                            config,
                            store,
                            models,
                            tenant,
                            query,
                            controller.signal,
                            event => {
                                records.push(event);
                                if (
                                    event.node === 'retrieve' &&
                                    event.type === 'node_start'
                                )
                                    controller.abort();
                            },
                        ),
                    );
                    assert.ok(
                        records.some(
                            e =>
                                e.node === 'retrieve' &&
                                e.outcome === 'cancelled',
                        ),
                    );
                    assert.equal(records.at(-1)?.type, 'run_error');
                    assert.equal(records.at(-1)?.outcome, 'cancelled');
                },
            );
        } finally {
            await store.pool.query(
                'DELETE FROM rag_sources WHERE tenant_id=ANY($1::text[])',
                [[tenant, other]],
            );
            await store.pool.query(
                'DELETE FROM rag_index_jobs WHERE tenant_id=ANY($1::text[])',
                [[tenant, other]],
            );
            await store.close();
        }
    },
);
