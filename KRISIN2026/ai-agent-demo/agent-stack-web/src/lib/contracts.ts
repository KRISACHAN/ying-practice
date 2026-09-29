export type NodeId =
    | 'receive'
    | 'route'
    | 'comfort'
    | 'daily'
    | 'memory'
    | 'prompt'
    | 'model'
    | 'reply';
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type RunEvent =
    | {
          type: 'node';
          node: NodeId;
          status: 'running' | 'done' | 'error';
          detail: string;
          at: number;
      }
    | { type: 'token'; text: string }
    | { type: 'complete'; runId: string; tracing: boolean }
    | { type: 'error'; message: string };
export const nodeInfo: Record<
    NodeId,
    { title: string; owner: string; explanation: string }
> = {
    receive: {
        title: '接收消息',
        owner: '应用入口',
        explanation: '验证输入，传入最近 12 条会话。每次请求使用独立状态。',
    },
    route: {
        title: '判断对话方向',
        owner: 'LangGraph',
        explanation:
            '本例用关键词规则区分安慰与日常聊天，条件边选择一个分支。可替换成结构化模型分类。',
    },
    comfort: {
        title: '情绪陪伴',
        owner: 'LangGraph',
        explanation: '将回应策略设为先倾听、再询问，不急着给建议。',
    },
    daily: {
        title: '日常聊天',
        owner: 'LangGraph',
        explanation: '将回应策略设为轻松交流，并结合当前话题自然提问。',
    },
    memory: {
        title: '读取会话',
        owner: '应用上下文',
        explanation:
            '读取浏览器随请求携带的近期对话；不是数据库长期记忆，也不是 LangSmith 存储。',
    },
    prompt: {
        title: '组装角色提示词',
        owner: 'LangChain',
        explanation:
            'ChatPromptTemplate + MessagesPlaceholder 将角色、分支策略、会话历史和当前问题组合为消息。',
    },
    model: {
        title: '生成回复',
        owner: 'Vercel AI SDK',
        explanation:
            'streamText 调用环境变量指定的模型，逐段返回文字；演示模式在同一节点生成明确标记的本地示例。',
    },
    reply: {
        title: '返回对话',
        owner: 'LangGraph',
        explanation: '保存本轮结果并结束图执行。前端使用后端节点事件更新图示。',
    },
};
