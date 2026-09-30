# AI Agent Demo

围绕 Agent 的组件协作、Skill 与检索增强生成进行本地交互练习。

- [Agent Stack Web](./agent-stack-web/README.md)：LangChain、LangGraph、AI SDK 的消息与工作流协作。
- [Skill System](./skill-system/README.md)：Skill 定义、选择与执行。
- [RAG 从零入门与 RAG Lab](./rag-system/README.md)：从“是什么、何时用、怎么用”开始，动手观察文档导入、混合检索、证据门禁、引用与评测。

## RAG 学习入口

从 [RAG 入门与动手实验](./rag-system/README.md) 的差旅制度示例开始，再启动网页，沿着“资料准备 → 查询 → 证据 → 回答 → 评测”观察一次运行。README 包含：

1. RAG 是什么、何时适合使用，以及与直接提示、业务 API、微调和记忆的关系。
2. 建索引与提问两条链路；切块、Embedding、混合检索、证据与引用。
3. 三个可复现的网页实验，借助 React Flow 查看实际节点、分支和回看。
4. 本机启动、`.env.local` 模型配置、评测方法与生产化边界。

知识文档与内置资料均为重新归纳的通用技术说明及合成示例，未保存课程正文副本或真实个人与业务信息。默认本地演示模式不用 AI 密钥；真实模式单独配置模型。
