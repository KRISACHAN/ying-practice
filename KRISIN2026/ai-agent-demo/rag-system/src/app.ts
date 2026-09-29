import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { embeddingProfile, strategyVersion, type Config } from './config.js';
import { fixtures, samples } from './fixtures.js';
import { evaluate } from './evaluation.js';
import type { Models } from './models.js';
import { ConflictError, type Store } from './store.js';
import { QuerySchema, runRag } from './workflow.js';

const DocumentSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().trim().min(1).max(100), body: z.string().trim().min(10).max(20000) }).strict();
export function createApp(config: Config, store: Store, models: Models) {
  const app = new Hono();
  // 本地教学服务只绑定 loopback，租户固定于服务端 env。部署多人系统前应接 Session + ACL。
  const tenant = config.RAG_TENANT_ID;
  const allowedOrigins = new Set([`http://127.0.0.1:${config.PORT}`, `http://localhost:${config.PORT}`]);
  let mutationBusy = false;
  let queryCount = 0;
  app.use('/api/*', bodyLimit({ maxSize: 80000 }));
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      let verifiedLocalRequest = false;
      // 某些浏览器中间层会省略 Origin 端口。仅在 same-origin 标记与完整 Referer
      // 同时证明来自本服务时兼容；不把任意 localhost 端口视为同源。
      if (origin === 'http://127.0.0.1' || origin === 'http://localhost') {
        try {
          verifiedLocalRequest = c.req.header('sec-fetch-site') === 'same-origin' &&
            allowedOrigins.has(new URL(c.req.header('referer') ?? '').origin);
        } catch { /* 缺失或无效 Referer 不放行。 */ }
      }
      if (origin && !allowedOrigins.has(origin) && !verifiedLocalRequest)
        return c.json({ error: '不允许跨站请求' }, 403);
      if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: '请发送 JSON' }, 415);
    }
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError) return c.json({ error: '输入不符合要求', fields: error.issues.map(i => i.path.join('.')) }, 400);
    if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式错误' }, 400);
    if (error instanceof ConflictError) return c.json({ error: '版本已变化，请刷新后重试' }, 409);
    // 供应商异常可能携带请求正文和鉴权字段，只输出稳定错误码。
    console.error('RAG_REQUEST_FAILED');
    return c.json({ error: '请求失败，请检查数据库、模型配置和索引任务状态' }, 503);
  });
  app.get('/', async c => c.html(await readFile(new URL('../web/index.html', import.meta.url), 'utf8')));
  app.get('/app.js', async c => c.body(await readFile(new URL('../web/app.js', import.meta.url), 'utf8'), 200,
    { 'Content-Type': 'text/javascript; charset=utf-8' }));
  app.get('/style.css', async c => c.body(await readFile(new URL('../web/style.css', import.meta.url), 'utf8'), 200,
    { 'Content-Type': 'text/css; charset=utf-8' }));
  for (const [path, type] of [['/flow.js', 'text/javascript'], ['/flow.css', 'text/css']] as const)
    app.get(path, async c => c.body(await readFile(new URL(`../web/dist${path}`, import.meta.url), 'utf8'), 200,
      { 'Content-Type': `${type}; charset=utf-8` }));
  app.get('/events.js', async c => c.body(await readFile(new URL('../web/events.js', import.meta.url), 'utf8'), 200,
    { 'Content-Type': 'text/javascript; charset=utf-8' }));
  app.get('/api/status', async c => {
    let databaseReady = false;
    try { await store.pool.query('SELECT 1 FROM rag_sources LIMIT 1'); databaseReady = true; } catch { /* UI 提供 db:init 操作说明。 */ }
    return c.json({ mode: config.RAG_MODE, databaseReady, profile: embeddingProfile(config),
      strategyVersion: strategyVersion(config), samples, chunkSize: config.CHUNK_SIZE,
      recallK: config.RECALL_K, contextK: config.CONTEXT_K,
      tracing: process.env.LANGSMITH_TRACING === 'true' });
  });
  app.get('/api/documents', async c => c.json({ documents: await store.list(tenant), jobs: await store.jobs(tenant) }));
  const mutation = async <T>(work: () => Promise<T>) => {
    if (mutationBusy) throw new ConflictError('MUTATION_BUSY');
    mutationBusy = true;
    try { return await work(); } finally { mutationBusy = false; }
  };
  app.post('/api/documents', async c => {
    const input = DocumentSchema.parse(await c.req.json());
    return c.json(await mutation(() => store.ingest(tenant, input,
      AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(90000)]))));
  });
  app.delete('/api/documents/:id', async c => c.json({ removed: await mutation(() => store.remove(tenant, c.req.param('id'))) }));
  app.post('/api/seed', async c => c.json({ indexed: await mutation(async () => {
    const results = [];
    for (const doc of fixtures) results.push(await store.ingest(tenant, doc, AbortSignal.timeout(90000)));
    return results;
  }) }));
  app.post('/api/query', async c => {
    const input = QuerySchema.parse(await c.req.json());
    if (queryCount >= 3) return c.json({ error: '正在处理其他查询，请稍后重试' }, 429);
    queryCount++;
    try { return c.json(await runRag(config, store, models, tenant, input,
      AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60000)]))); }
    finally { queryCount--; }
  });
  app.post('/api/query/stream', async c => {
    // 先完成输入与容量校验，再打开流；事件记录实际节点动作，答案仍等引用校验通过才返回。
    const input = QuerySchema.parse(await c.req.json());
    if (queryCount >= 3) return c.json({ error: '正在处理其他查询，请稍后重试' }, 429);
    queryCount++;
    c.header('Cache-Control', 'no-cache, no-transform');
    return streamSSE(c, async stream => {
      const disconnect = new AbortController();
      stream.onAbort(() => disconnect.abort());
      const signal = AbortSignal.any([c.req.raw.signal, disconnect.signal, AbortSignal.timeout(60000)]);
      try {
        const result = await runRag(config, store, models, tenant, input, signal, async event => {
          if (!disconnect.signal.aborted) await stream.writeSSE({ event: 'progress', id: String(event.seq), data: JSON.stringify(event) });
        });
        if (!signal.aborted) await stream.writeSSE({ event: 'result', data: JSON.stringify(result) });
      } catch {
        if (!disconnect.signal.aborted) await stream.writeSSE({ event: 'error',
          data: JSON.stringify({ error: signal.aborted ? '执行已取消或超时' : '执行失败，请检查数据库与模型配置' }) });
      } finally { queryCount--; }
    });
  });
  app.post('/api/eval', async c => c.json(await mutation(() => evaluate(config, store, models, tenant,
    AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(90000)])))));
  return app;
}
