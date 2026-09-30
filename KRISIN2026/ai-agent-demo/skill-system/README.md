# Skill 是什么？从概念到一个可运行的 Agent Demo

**Skill 是 Agent 可按需调用的一套任务方法。**它回答的是“遇到这类任务时，该按什么步骤处理、用哪些资源、产出什么结果”，而不是“这个 Agent 是谁”。例如，用户说“我在两个工作机会之间很纠结”，`decision-clarifier` Skill 会提醒助手先弄清选项、硬约束和取舍，再帮助用户思考，而不是直接替用户决定。

本文既是 Skill 的入门说明，也是本目录网页 demo 的使用指南。读完后，你可以运行一个最小 Skill 系统，并知道怎样把同样的机制接进自己的 AI Agent。

## 先建立一个直觉

普通模型调用通常是“用户消息 → 提示词 → 模型回复”。加上 Skill 后，中间多了一步：**根据当前任务选择合适的方法，再把该方法交给执行器**。

```text
用户消息
  → 判断这轮是否需要 Skill
  → 从已注册的 Skill 中选择一个
  → 加载该 Skill 的指令或资源
  → 执行并生成回复
```

一个 Skill 通常有两部分：

- **定义**：ID、名称、版本、适用条件、步骤或指令；复杂 Skill 还可能声明工具、资源和输出格式。
- **运行**：收到实际消息后，判断是否触发、是否允许执行、加载定义，并记录本次选择和结果。

这个 demo 的 `decision-clarifier` 定义了触发规则和一句过程指令。用户提到“纠结”“怎么选”等内容时，选择器可能选中它；执行器把“先明确选项、硬约束和最关键的取舍……”放进本轮的系统消息，模型据此回复。**模型负责生成内容，代码负责确定候选、选择和组装消息。**

### 它和 Prompt、Tool、Memory、Workflow 有什么区别？

| 概念 | 解决的问题 | 例子 |
| --- | --- | --- |
| Prompt | 这次给模型什么上下文和指令？ | “请用中文回答。” |
| Skill | 遇到某类任务，复用什么处理方法？ | “做选择时先澄清约束，再比较取舍。” |
| Tool | 具体执行什么操作？ | 搜索网页、查询数据库、调用日历 API。 |
| Memory | 需要记住什么事实？ | 用户偏好远程工作。 |
| Workflow | 多个步骤怎样流转和恢复？ | 收集条件 → 查询职位 → 比较 → 等待用户确认。 |
| Agent 人设 | 助手以什么身份和风格交流？ | “你是一位耐心的职业顾问。” |
| 安全与权限策略 | 哪些事可以做、做到什么程度？ | 未授权时不能替用户投递简历。 |

Skill 可以包含提示词，也可以调用工具或运行工作流。**直接往提示词里加入一段方法指令，已经是最简单的 Prompt Skill**；把它包装成可注册、可选择、可版本化的定义，则更容易复用和维护。Skill 不能代替工具的权限校验，也不能覆盖更高优先级的安全规则。

## 什么时候用 Skill？

当一种任务**会反复出现**，有相对稳定的处理方法，且你希望不同用户、不同轮次得到一致的过程时，适合做成 Skill。比如“澄清选择”“拆解目标”“总结会议并列出待办”。如果需要观察它是否有效，明确的触发条件和可检查的输出也很重要。

一次性的简单要求，直接写进当前 Prompt 就够了；“用户住在哪座城市”属于 Memory；“读取日历”属于 Tool；“任何回复都不得泄露密钥”属于全局安全策略。不要为了给每句话起名字，就把它们都做成 Skill。

可以从三种复杂度逐步增加：

| 类型 | 适合的任务 | 执行方式 | 本 demo |
| --- | --- | --- | --- |
| Prompt Skill | 改变一轮回答的方法 | 选择后把过程指令放入模型上下文 | **已实现** |
| Workflow Skill | 多轮收集信息、分步骤推进 | 保存会话状态，按步骤流转 | 未实现 |
| Tool Skill | 需要读取或修改外部数据 | 在权限范围内调用工具并校验结果 | 未实现 |

LangGraph 等编排框架可以帮助实现复杂工作流，但**不是使用 Skill 的前提**。这个 demo 只做一轮的 Prompt Skill，因此用普通 JavaScript 函数即可讲清核心原理。

## 运行这个 demo

需要 Node.js **20.6+**。在 `KRISIN2026/ai-agent-demo/skill-system` 目录执行：

```bash
npm install
cp .env.example .env
npm run web
```

打开终端输出的网址，默认是 **http://127.0.0.1:4173**；如果在 `.env` 中设置了 `PORT`，使用对应端口。网页只处理单聊消息。先不配置模型也可以试：输入消息并点击“运行 Skill”，页面会显示命中的 Skill、过程指令，以及将要发给模型的 `system` / `user` 消息。此时只做**选择与提示词预览**，不会生成模型回复。

若要看到真实回复，在本地 `.env` 填写：

```dotenv
OPENAI_API_KEY=你的密钥
AI_MODEL=你的模型ID
# 使用兼容 OpenAI Chat Completions 的其他服务时再设置：
# OPENAI_BASE_URL=https://你的服务/v1
```

保存后重启 `npm run web`。网页会默认勾选“调用模型并显示回复”；模型输出会逐段显示，也可以取消勾选，只看 Skill 的选择和提示词。`OPENAI_MODEL` 也可作为模型变量名，且优先于 `AI_MODEL`。`.env` 由 Node 启动参数加载并被 Git 忽略；密钥只在本地服务端读取，用户消息会发往你配置的模型服务。网页的流式调用使用兼容 OpenAI Chat Completions 的接口，最多等待 120 秒；若中途失败，已收到的回复片段会保留并显示错误原因。

试试这些输入，对照页面上的“触发方式”和“最终提示词”：

| 输入 | 预期结果 |
| --- | --- |
| `我在两个工作机会之间很纠结，怎么选？` | 规则选中 `decision-clarifier`。 |
| `我想准备考试，却无从下手` | 规则选中 `goal-breakdown`。 |
| `最近有点难过，想找人倾诉` | 规则选中 `active-listening`。 |
| `/goal-breakdown 帮我准备考试` | 显式指定 `goal-breakdown`，优先于关键词规则。 |
| `你好` | 没有命中 Skill，走普通聊天。 |

显式命令也可写成 `/skill goal-breakdown 帮我准备考试`。命令中的 ID 必须已注册；写错 ID 不会执行一个临时 Skill。这个最小示例会把**用户输入原文**一起发给模型，所以命令前缀也会留在 `user` 消息里。

命令行入口方便看相同的选择结果：

```bash
npm run demo -- "我在两个工作机会之间很纠结，怎么选？"
npm test
```

命令行默认也只是预览。`npm run demo -- "..." --live` 可以调用模型，但它使用单次非流式请求；**要观察逐段输出，请使用网页**。

## 代码里怎样完成一次 Skill 调用？

核心代码在 [`src/skills.js`](./src/skills.js)。为了让原理清楚，这里把定义、注册、选择和 Prompt 执行都放在一个文件里：

1. `registry` 注册三个 Skill。每项都有 `manifest`（ID、版本、名称、优先级）、匹配规则 `patterns`、执行指令 `instruction`。启动时检查 ID 是否重复、定义是否完整。
2. `selectSkill({ text })` 先看 `/skill-id` 或 `/skill skill-id` 显式命令，再按正则命中数打分。自动选择时依次按分数、优先级、ID 排序，**每轮最多返回一个 Skill**；没有命中则返回 `null`。
3. `runPromptSkill(selection)` 把选中项变成本轮执行记录：Skill ID、版本、触发方式和 `systemInstruction`。它没有运行工具或独立的子 Agent。
4. `buildMessages({ text, selection })` 把通用系统指令、可选的 Skill 指令和用户原文组装成模型消息。未选中 Skill 时，也能正常生成普通回复。

例如输入“两个工作机会让我很纠结”，本轮发给模型的消息结构大致如下（具体指令以代码为准）：

```js
[
  {
    role: 'system',
    content: '你是帮助用户思考的 AI 助手。……\n本轮回复方法：先明确选项、硬约束和最关键的取舍；……'
  },
  { role: 'user', content: '两个工作机会让我很纠结' }
]
```

[`src/app.js`](./src/app.js) 将这条链路接到 Hono API：`GET /api/skills` 提供目录，`POST /api/run` 返回预览，`POST /api/run/stream` 先发送 `selection` 事件，再调用模型并发送 `delta`、`done` 或 `error` 事件。[`src/model-stream.js`](./src/model-stream.js) 解析上游流，[`web/app.js`](./web/app.js) 把增量文字和选择结果显示在页面；[`src/server.js`](./src/server.js) 启动本地服务。[`src/demo.js`](./src/demo.js) 是命令行对照入口。

### 怎样新增一个 Prompt Skill？

在 `registry` 中增加一项，例如“会议待办提取”：

```js
{
  manifest: {
    id: 'meeting-actions',
    version: '1.0.0',
    name: '会议待办提取',
    priority: 10,
  },
  patterns: [/会议纪要|会议记录/, /待办|行动项/],
  instruction: '提取行动项；每项写清负责人和截止时间，缺失的信息标为待确认。',
}
```

重启服务后，`GET /api/skills` 和网页会自动看到它。试一条命中输入，再试一条不应命中的输入，检查选择结果与最终消息是否符合预期。修改指令的行为时，更新版本号有助于日后追踪结果。当前注册表写在代码里，新增 Skill 需要改代码并重启；它尚未提供上传文件或在网页上编辑 Skill 的功能。

## 接进自己的 AI Agent 时怎么设计？

最小接法和 demo 一样：在**接收用户消息之后、调用模型之前**加入 Skill 选择；只有选中时才加载相应指令。Agent 已有的对话历史、用户记忆和工具可以继续保留，Skill 只提供这轮任务的方法。下面是接入顺序的示意，`checkPolicy` 等函数需要在你的项目中实现，**并非本 demo 已有代码**：

```js
async function handleMessage(userText, agentContext) {
  const policy = await checkPolicy(userText, agentContext);
  if (policy.blocked) return policy.reply;

  const candidates = getAllowedSkills(agentContext); // 只保留该 Agent 可用的 Skill
  const selection = selectFrom(candidates, userText); // 可先用规则，必要时再用模型判断
  const method = selection ? loadSkill(selection.id, selection.version) : null;
  const messages = composeMessages({
    agentInstructions: agentContext.instructions,
    memory: agentContext.relevantMemory,
    skillInstruction: method?.instruction,
    userText,
  });
  return streamModel(messages);
}
```

这里有几个关键边界：

- **安全与权限先于 Skill**：先判断请求是否允许，再决定哪些 Skill 可供选择。提示词不能充当可靠的权限控制；涉及外部操作时，工具层还要单独校验授权。
- **按需加载**：先展示简短目录或元信息，命中后再加载完整指令和资源，避免每轮把所有 Skill 塞进提示词。
- **一次选择要能解释**：记录触发方式、Skill ID 和版本，方便排查“为什么用了这个方法”。本 demo 已返回这些字段，但没有持久化运行记录。
- **没有命中也能回复**：Skill 是增强某类任务的方法，不应让普通聊天依赖必须选中一个 Skill。

当任务变成多轮流程时，可以给 Skill 加 `Session`，保存当前步骤、已收集信息和下一步；用户下一条消息应先继续活动 Session，再考虑重新选 Skill。若需要调用外部工具，还要增加工具白名单、参数校验、权限、失败处理和审计。那些是下一阶段，**当前 demo 都没有实现**。当前 `buildMessages` 里虽有一句通用安全提醒，它也不是完整的安全策略系统。

## 从这里继续看

- [Skill 系统架构](https://aicompanion.usehook.cn/62-agent-skill-system-architecture/)：Skill 在 Agent、Memory、Tool、Workflow 与安全策略之间的位置。
- [Prompt Skill 第一阶段实现](https://aicompanion.usehook.cn/65-agent-prompt-skill-stage-one/)：单轮 Prompt Skill 的落地思路。
- [Skill 运行时、安全与演进](https://aicompanion.usehook.cn/64-agent-skill-runtime-safety-evolution/)：从最小实现扩展到更完整的运行时。
