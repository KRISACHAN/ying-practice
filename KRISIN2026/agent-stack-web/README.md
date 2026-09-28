# Agent Stack Web Demo

一个可交互的 Next.js / TypeScript 网页，用同一道问题展示 Vercel AI SDK、LangChain、LangGraph 和 LangSmith 的不同职责。代码中的关键位置有中文注释。

## 快速运行

需要 Node.js 20.9+ 和 pnpm。只在这个目录安装依赖：

```bash
cd KRISIN2026/agent-stack-web
cp .env.example .env.local
# 编辑 .env.local，填写 OPENAI_API_KEY 和 AI_MODEL
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:3000`。不填模型密钥时仍能查看页面，也能测试不相关问题的兜底分支；需要模型的回答会提示配置密钥。运行 `pnpm typecheck` 和 `pnpm build` 检查代码。密钥只在服务端读取，`.env.local` 被 Git 忽略。

## 四个工具怎样协作

```text
网页 → POST /api/ask → LangSmith 根轨迹 → LangGraph inspect
                                                ├─ 不相关 → fallback → 页面
                                                └─ 相关 → compose → LangChain 提示词链
                                                            → AI SDK 模型 + lookupConcept 工具
                                                            → 页面
```

| 工具 | 本例中的代码 | 负责什么 |
| --- | --- | --- |
| Vercel AI SDK | `src/lib/answer-chain.ts` 的 `generateText`、`tool` | 调模型、执行本地工具，并用 `stopWhen` 限制循环 |
| LangChain | 同文件的 `PromptTemplate`、`RunnableSequence` | 复用提示词模板，组合提示词与模型函数；模型调用仍由 AI SDK 负责 |
| LangGraph | `src/lib/workflow.ts` | 定义状态、节点和条件边；节点只返回状态更新 |
| LangSmith | 两个文件中的 `traceable` | 可选记录工作流和模型调用；在 LangSmith 项目中检查轨迹 |

本例的 `inspect` 通过确定性词条匹配决定分支，因此更准确地说是**带有工具调用循环的 Agent 工作流示例**，不是开放式自主 Agent。这样可以明确看见图的分支与 AI SDK 的工具循环分别解决什么问题。知识源在 `src/lib/glossary.ts`，可以替换为数据库或检索服务。内存状态只在单次请求有效；如果要做跨轮对话，需要持久化会话和 LangGraph checkpoint。

## LangSmith 追踪

在 `.env.local` 增加或修改：

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=你的密钥
LANGSMITH_PROJECT=agent-stack-web-demo
```

在 LangSmith 的该项目中查看 `agent_stack_web_workflow` 根轨迹及 `ai_sdk_generate_with_tool` 子轨迹。不开启追踪时，网页仍显示 `inspect → compose/fallback` 和工具调用概览。**开启追踪会将用户问题、提示词、工具结果及回答传到配置的 LangSmith 服务**；处理私有资料时先确认数据策略。本例没有把 LangSmith 密钥发送给浏览器。

## 替换模型

`AI_MODEL` 是模型 ID；默认示例值仅作为占位，请改成你的账户实际有权限调用的模型。若使用兼容 OpenAI API 的服务，可同时设置 `OPENAI_BASE_URL` 与其密钥。工具调用能力因模型和兼容服务而异，至少需要支持 function/tool calling。浏览器只调用自己的 `/api/ask`，不直接调用模型供应商。

## English summary

This interactive Next.js demo uses the Vercel AI SDK for model and tool calls, LangChain for prompt composition, LangGraph for stateful branching, and optional LangSmith tracing. Copy `.env.example` to `.env.local`, configure an API key and model, then run `pnpm install && pnpm dev` from this directory. The sample is a bounded agent workflow with a local glossary; it does not persist chat history.
