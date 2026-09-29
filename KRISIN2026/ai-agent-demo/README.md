# AI Agent Demo

围绕 Agent 的组件协作、Skill 与检索增强生成进行本地交互练习。

- [Agent Stack Web](./agent-stack-web/README.md)：LangChain、LangGraph、AI SDK 的消息与工作流协作。
- [Skill System](./skill-system/README.md)：Skill 定义、选择与执行。
- [RAG Lab 与知识文档](./rag-system/README.md)：Hono + PostgreSQL/pgvector 的文档导入、混合检索、证据门禁、引用与评测。

## RAG 学习入口

从 [RAG Lab](./rag-system/README.md) 启动网页，沿着“资料准备 → 查询 → 证据 → 回答 → 评测”观察一次运行。README 包含：

1. 安装、数据库启动与 `.env.local` 模型配置。
2. RAG 与微调、上下文及长期记忆的关系。
3. 切块、Embedding、关键词与向量、RRF 和重排。
4. LangChain、LangGraph 的 Node/Edge/State 与 AI SDK 分工。
5. 权限、文档版本、更新删除、Prompt Injection 和无答案处理。
6. 分层评测、调优顺序、成本与生产化边界。

知识文档与内置资料均为重新归纳的通用技术说明及合成示例，未保存课程正文副本或真实个人与业务信息。默认本地演示模式不用 AI 密钥；真实模式单独配置模型。
