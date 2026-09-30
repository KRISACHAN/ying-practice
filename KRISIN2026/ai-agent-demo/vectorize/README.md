# Vectorize：从文本向量到检索问答

这个 Cloudflare Worker 教学项目准备了三段代码：把文档转成向量写入 Vectorize、把问题转成向量检索相近文档、把检索结果放进提示词并流式生成回答。它使用 Hono、Workers AI 和名为 `DOCS_INDEX` 的 Vectorize binding。

**当前迁移状态：只有首页 `/` 已注册。**[`src/index.ts`](./src/index.ts) 现在返回 `Hello Hono!`，没有挂载 `src/routes/` 下的路由。因此下面的 `/ingest`、`/search`、`/rag` 是已写好的路由模块，**当前请求这些地址会得到 404**。这个 README 按现状说明代码，避免把未接通的模块写成已经可运行的 API。

## 先建立一个直觉

```text
文档 text → Workers AI Embedding → 向量与 metadata → Vectorize
问题 text → 同一 Embedding 模型 → 相似度查询 → 候选片段
候选片段 + 问题 → LLM → 流式回答与来源 ID
```

Embedding 把文本转换成数字向量，Vectorize 找相近向量，LLM 再利用找到的片段回答。**相似不等于有答案**：当前示例没有证据充分性判断或引用内容校验，不能保证生成内容受来源支持。这里的资料只存在于向量索引及其 metadata，没有独立的权威文档库或版本管理。

## 按代码顺序读三个模块

| 阶段 | 文件 | 已写出的逻辑 | 当前限制 |
| --- | --- | --- | --- |
| 写入 | [`src/routes/ingest.ts`](./src/routes/ingest.ts) | `POST /ingest` 接收 `docs`，用 `@cf/baai/bge-base-en-v1.5` 生成向量，再 `upsert` 到 `DOCS_INDEX` | 未挂载；没有输入校验、鉴权、分批、失败恢复或版本控制 |
| 检索 | [`src/routes/search.ts`](./src/routes/search.ts) | `POST /search` 把 `query` 向量化，返回 ID、分数、正文和来源 | 未挂载；固定 `topK: 5`，只查 `source=internal-wiki`；请求体的 `topK` 暂未使用 |
| 问答 | [`src/routes/rag.ts`](./src/routes/rag.ts) | `POST /rag` 检索 3 条候选，把文本拼入提示词，调用 `@cf/meta/llama-3.1-8b-instruct` 并发送 SSE | 未挂载；检索不按 source 过滤；`delta` 直接包裹上游流的字节片段，`sources` 仅含 ID 和分数 |

`ingest` 接收的文档形状是 `{id, text, source?}`。如果将来接通路由，想在 `search` 中找到资料，写入时需要设置 `source: "internal-wiki"`；未设置时写入为 `unknown`，会被当前 `search` 的固定过滤条件排除。`rag` 没有这个过滤条件，因此两个入口的候选范围不同。

当前代码使用英文 Embedding 模型。模型选择、向量维度和实际索引配置必须匹配；`wrangler.jsonc` 只绑定了名为 `docs-index` 的索引，没有创建索引的脚本。不要把“有 binding 配置”当成“索引已经存在”。

## 运行当前可用的 Worker

`wrangler.jsonc` 被仓库忽略，不会随迁移提交。新检出仓库需要先在本目录创建该文件。当前代码需要 `AI` 和 `DOCS_INDEX` 两个 binding；配置形状如下，其中 `docs-index` 必须是你已准备好的索引名称：

```jsonc
{
  "name": "vectorize",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-29",
  "vectorize": [{ "binding": "DOCS_INDEX", "index_name": "docs-index" }],
  "ai": { "binding": "AI" }
}
```

在仓库根目录执行：

```bash
cd KRISIN2026/ai-agent-demo/vectorize
pnpm install --frozen-lockfile
pnpm dev
```

Wrangler 输出本地地址后，可以访问根路径：

```bash
curl http://localhost:8787/
```

预期返回 `Hello Hono!`。这只验证 Worker 入口，不验证 Workers AI、Vectorize 或三个路由。配置文件声明了 `AI` 和 `DOCS_INDEX` binding；在实际使用路由前，需先准备与所用 Embedding 模型匹配的索引，并把路由挂载到 `src/index.ts`。部署命令是 `pnpm deploy`，但当前代码部署后也只提供首页。

## 如果继续把三个模块接成实验

1. 在 `src/index.ts` 用带 `AppEnv` 的 Hono 实例挂载 `ingest`、`search`、`rag` 路由，并确认实际路径。当前文件既未引入这些路由，也未给 `Hono` 声明 `AppEnv`。
2. 为写入和查询增加请求校验、批次限制与错误处理；为写入路由增加鉴权，避免公开调用方任意改动索引并消耗 AI 额度。
3. 统一 `search` 和 `rag` 的资料范围，决定是否让 `topK` 生效，并为“没有足够证据”设计明确回复。
4. 对流式协议做端到端验证。当前 `rag` 的 `delta` 事件包含上游流原始片段，不等于纯文字增量；调用方需要知道如何解析。
5. 用有答案和无答案的问题分别检查召回、回答和来源。当前 `sources` 只给候选 ID、分数，没有逐句引用或事实校验。

这个目录是 Vectorize 与 Workers AI 的起点。如果要研究更完整的检索、证据门禁、引用、版本和评测，可对照相邻的 [RAG Lab](../rag-system/README.md)；两者实现范围不同。
