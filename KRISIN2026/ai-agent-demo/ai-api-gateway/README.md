# AI API Gateway：用 Hono 包一层模型调用

这个教学项目把模型服务放在一个 Cloudflare Worker 后面，演示 API Key 鉴权、按 Key 限流、聊天接口和一个独立的请求页面。目录分为 [`api/`](./api/) 和 [`view/`](./view/)；两者各有自己的依赖与开发命令。

## 先看一次请求怎么走

```text
浏览器或调用方
  → Authorization: Bearer <网关 Key>
  → Hono /api 路由
  → API_KEYS_KV 查 Key → RATE_LIMIT_KV 查当前分钟计数
  → LangChain ChatOpenAI 调用上游模型
  → 普通 JSON 或 SSE 文字增量返回调用方
```

网关 Key 用来识别调用方；`OPENAI_API_KEY` 是 Worker 调用上游模型的服务端凭据，两者不是同一个 Key。`GET /health` 不经过鉴权；`/api/*` 都经过鉴权和限流。页面只是单独的调试界面，由用户输入网关地址、Bearer Key、模型和消息，再向 API 发请求。

## 当前代码实现了什么

| 能力 | 代码 | 当前行为 |
| --- | --- | --- |
| 鉴权 | [`api/src/middleware/auth.ts`](./api/src/middleware/auth.ts) | 只接受 `Authorization: Bearer ...`，从 `API_KEYS_KV` 的 `key:<原始 Key>` 读取 Key 信息 |
| 限流 | [`api/src/middleware/rate-limit.ts`](./api/src/middleware/rate-limit.ts) | 按 Key ID 和当前分钟在 `RATE_LIMIT_KV` 计数，超过配置值返回 429 |
| 聊天 | [`api/src/routes/chat.ts`](./api/src/routes/chat.ts) | `ChatOpenAI` 调上游；默认流式，将文本增量包装为 OpenAI 风格的 SSE chunk；`stream:false` 返回单次 JSON |
| 用量查询 | [`api/src/routes/usage.ts`](./api/src/routes/usage.ts) | 从 `USAGE_KV` 读取总量、某天及最近 N 天记录 |
| 调试页面 | [`view/src/index.tsx`](./view/src/index.tsx) | 输入参数、发送聊天、读取用量并显示返回内容 |

**用量写入尚未接通。**[`api/src/lib/usage.ts`](./api/src/lib/usage.ts) 定义了总量和每日写入函数，但聊天路由没有调用它们，也没有从模型回复中提取 token 用量。因此 `/api/usage` 显示的零值或既有 KV 值，不能当作当前聊天请求的准确用量。流式接口也不是原样透传上游：它只提取文字，重新组成兼容结构；非流式回复未包含上游的 `usage` 字段。

## 本地启动

在两个终端分别运行。项目使用 pnpm；`api` 和 `view` 各有独立锁文件。**两个子目录的 `wrangler.jsonc` 都被仓库忽略，不会随迁移提交。**新检出仓库需要先在各自目录创建配置；本机已有配置可保留，但不要把密钥写入版本库。

`api/wrangler.jsonc` 至少需要入口、兼容日期和三个 KV binding；下面的 ID 是占位符，部署前必须替换为自己的 namespace ID：

```jsonc
{
  "name": "ai-api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-29",
  "kv_namespaces": [
    { "binding": "API_KEYS_KV", "id": "替换为你的 Key KV ID" },
    { "binding": "RATE_LIMIT_KV", "id": "替换为你的限流 KV ID" },
    { "binding": "USAGE_KV", "id": "替换为你的用量 KV ID" }
  ],
  "vars": {
    "OPENAI_BASE_URL": "https://api.openai.com/v1",
    "OPENAI_MODEL": "填入服务支持的模型 ID"
  }
}
```

`view/wrangler.jsonc` 的本地示例是 `{"name":"ai-api-gateway-v2","main":"./src/index.tsx","compatibility_date":"2025-08-03"}`。它只用于调试页面，不保存上游模型密钥。模型密钥放在 `api/.dev.vars` 的 `OPENAI_API_KEY=...` 中供本地开发使用，部署时用 Wrangler Secret 配置。两处配置文件及 `.dev.vars` 都被当前仓库忽略。

```bash
cd KRISIN2026/ai-agent-demo/ai-api-gateway/api
pnpm install --frozen-lockfile
pnpm dev
```

```bash
cd KRISIN2026/ai-agent-demo/ai-api-gateway/view
pnpm install --frozen-lockfile
pnpm dev
```

API 的本地地址通常是 `http://localhost:8787`，页面地址以 Vite 终端输出为准。先用 `GET /health` 检查 API，再在页面中填写 API 地址。页面预填的网关 Key 只有在本地 KV 已写入对应记录时才有效；API 子项目的 `pnpm key:init` 会向**本地** `API_KEYS_KV` 写入示例 Key，`pnpm key:check` 可检查该记录。`key:init` 的 Key 是教学示例，不适合公开部署。

```bash
curl http://localhost:8787/health
curl http://localhost:8787/api/usage \
  -H 'Authorization: Bearer gw-demo-key'
```

真实聊天还需要上游模型凭据。**本机现有的 `api/wrangler.jsonc` 含有写死的上游密钥值，且 KV ID 仍是占位符。请撤销该密钥、从配置中移除明文，再用本地私密变量和部署 Secret 配置；不要直接按现状发布。**这里不展示任何密钥值。

## 实际路由与请求格式

| 方法与路径 | 作用 |
| --- | --- |
| `GET /health` | 无鉴权健康检查 |
| `POST /api/v1/chat/completions` | 聊天；请求体使用 `messages`，可选 `model`、`stream` |
| `GET /api/usage` | 当前网关 Key 的累计记录 |
| `GET /api/usage/:date` | 指定日期记录，例如 `2026-09-30` |
| `GET /api/usage/trend/:days` | 最近 N 天记录，默认解析失败时用 7 天 |

聊天请求的最小形状如下；不传 `stream` 时，代码默认走 SSE。`model` 优先于 Worker 的 `OPENAI_MODEL`。实际入口是 `/api/v1/chat/completions`，鉴权头是 `Authorization: Bearer ...`；用量接口只查询当前已认证的网关 Key。

```json
{
  "messages": [{ "role": "user", "content": "你好" }],
  "stream": false
}
```

## 代码边界

- 限流是 KV 的“读取后写回”，并发请求可能越过设定值；它适合观察基本流程，不能作为严格配额系统。当前限流覆盖 `/api/usage` 等所有 API 路由，也会消耗计数。
- 聊天路由直接把调用方的消息交给上游；目前没有请求体校验、模型白名单、费用上限或按租户隔离。页面的 `model` 输入可以覆盖默认模型。
- `USAGE_KV` 的写入函数未被聊天路由调用，无法用于计费。要做可核对的用量统计，需要在模型返回后处理真实 usage，并设计失败、重试和并发写入行为。
- 当前页面会将网关 Key 放在浏览器输入框并从浏览器请求 API，只适合本地调试；不要把可调用付费模型的共享 Key 放到公开页面。

迁移后的上游模型连通性、远端 KV 状态和部署结果，需要在你自己的 Cloudflare 环境验证。
