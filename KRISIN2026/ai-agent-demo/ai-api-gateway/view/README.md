# AI API Gateway · 调试页面

项目总览和 API 的实际行为见 [上级 README](../README.md)。此目录是独立的 Hono/Vite 页面，用于输入网关地址、Bearer Key、模型和消息，观察聊天与用量接口返回。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

页面地址以 Vite 终端输出为准，默认网关地址填写 `http://localhost:8787`。请先启动 [`../api`](../api/) 的 Worker，并在 API 子目录执行 `pnpm key:init` 写入本地教学 Key。页面预填的 Key 只适用于对应的本地 KV 记录；真实聊天还需要 API Worker 配置可用的上游模型服务。

页面会从浏览器直接请求 `/api/v1/chat/completions` 和 `/api/usage`。它适合本地调试，不提供登录或安全的密钥管理。`pnpm build` 构建页面，`pnpm deploy` 构建并部署；部署前先处理上级 README 中的配置与安全边界。
