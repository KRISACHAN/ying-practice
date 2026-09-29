# Skill 系统最小 Demo

这个网页用 **Prompt Skill** 展示 Skill 系统最核心的四步：定义能力、注册能力、选择本轮能力、执行能力。页面由原生 HTML/CSS/JavaScript 实现，API 用 Hono.js，Node.js 20.6+ 即可运行。它不需要 LangGraph：只有出现跨轮状态或复杂流程时才需要工作流编排。

## 运行

在本目录执行：

```bash
npm install
cp .env.example .env
npm run web
```

打开 **http://127.0.0.1:4173**。点击示例消息或自己输入，再点“运行 Skill”。页面会展示命中的 Skill、过程指令、最终提示词和模型回复。这个示例只处理单聊。

要观察 Skill 指令如何影响真实回复，在本地 `.env` 中填写：

```dotenv
OPENAI_API_KEY=你的密钥
AI_MODEL=你的模型ID
# 如果不是 OpenAI 官方接口，再设置：
# OPENAI_BASE_URL=https://你的服务/v1
```

保存后重启 `npm run web`。网页检测到密钥和模型后会**默认调用真实模型，并逐段显示生成内容**；取消勾选可只查看 Skill 选择和提示词。后端向兼容 OpenAI Chat Completions 的服务发送 `stream: true`，再通过 Hono SSE 转发给浏览器。模型请求的最长等待时间为 120 秒；如果途中出错，已经收到的文本仍留在页面，并显示失败原因。`OPENAI_MODEL` 也可作为 `AI_MODEL` 的别名。启动命令使用 Node 自带的 `--env-file=.env` 加载配置，`.env` 被 Git 忽略；密钥只由本地服务端读取，不会发送到浏览器。用户消息会被发送至所配置的模型服务。本地服务只监听 `127.0.0.1`。

原有命令行版本也保留，方便对照：

```bash
npm run demo -- "我在两个工作机会之间很纠结，怎么选？"
npm test
```

## 看代码时抓住这条链路

```text
用户消息
  → Registry 中查找 Skill
  → Selector 先处理显式 /skill-id，再按规则计分
  → 一轮最多选一个 Skill
  → Prompt Runner 返回一段过程指令
  → 组装 system / user 消息，交给模型生成回复
```

| 位置                          | 职责                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/skills.js` 的 `registry` | Manifest 说明 ID、版本、名称与优先级；定义包含匹配规则和过程指令。启动时检查 ID 重复和定义完整性。 |
| `selectSkill`                 | 显式命令优先；自动触发时按命中数、优先级、ID 稳定排序；只返回第一名。未知命令不执行。              |
| `runPromptSkill`              | 执行 Prompt Skill：把选中的定义转成这轮可用的系统指令，不执行工具。                                |
| `buildMessages`               | 把通用要求、Skill 过程指令和用户原文组装成模型消息。                                               |
| `src/app.js`                  | Hono 路由：提供网页、Skill 列表、预览 API 和流式执行 API。                                         |
| `src/model-stream.js`         | 读取模型服务的 Chat Completions SSE，解析文本增量。                                                |
| `src/server.js`               | 用 `@hono/node-server` 将 Hono 应用监听在本机。                                                    |
| `web/`                        | 输入、示例、执行结果、Prompt 展示界面。                                                            |
| `src/demo.js`                 | 命令行对照入口。                                                                                   |

例如输入“两个工作机会让我很纠结”，规则会选中 `decision-clarifier`；模型看到的系统消息会多一段“先明确选项、硬约束和取舍”的指令。普通闲聊选不中 Skill，就只使用通用系统消息。

## 为什么先做到这里

Prompt Skill 本质上是**可注册、可选择、有边界的提示词片段**。如果只是改善回答方法，这个最小闭环就够了。真实产品仍需把安全判断放在选择 Skill 之前，不能把提示词当成可靠的权限控制。

要做跨轮任务，再添加 `SkillSession` 保存当前步骤和已收集信息，并让活动 Session 优先于重新选择 Skill。要读取或修改数据，再加入工具白名单、输入输出校验、授权、幂等和审计。那些属于后续阶段，没有混进这个最小示例。

参考：[Prompt Skill 第一阶段实现](https://aicompanion.usehook.cn/65-agent-prompt-skill-stage-one/)、[Skill 运行时、安全与演进](https://aicompanion.usehook.cn/64-agent-skill-runtime-safety-evolution/)。
