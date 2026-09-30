# AI API Gateway · Worker API

项目总览、实际路由、配置和已知边界见 [上级 README](../README.md)。此目录是 Hono Worker，提供健康检查、Bearer Key 鉴权、按 Key 限流、聊天和用量查询。

```bash
pnpm install --frozen-lockfile
pnpm key:init   # 仅向本地 KV 写入教学用网关 Key
pnpm key:check
pnpm dev
```

`GET /health` 无需鉴权；聊天入口是 `POST /api/v1/chat/completions`，其他 `/api/*` 路由也需要 `Authorization: Bearer <网关 Key>`。本目录没有 `/chat` 路由，也不读取 `x-api-key` 请求头。`pnpm deploy` 会部署 Worker；部署前必须处理上级 README 所述的明文密钥和 KV 占位配置。

[`src/lib/usage.ts`](./src/lib/usage.ts) 的用量写入函数尚未由聊天路由调用，查询结果不能代表当前请求的真实 token 用量。
