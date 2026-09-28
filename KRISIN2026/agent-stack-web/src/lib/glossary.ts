// 演示用的小型本地知识源：工具读取可信条目，模型不需要凭记忆解释产品职责。
export const glossary = {
    'Vercel AI SDK':
        'TypeScript AI 应用工具集；本例由它发起模型调用，执行工具调用循环并返回结果。',
    LangChain:
        '用于构建模型应用的组件与组合接口；本例用 PromptTemplate 和 RunnableSequence 组织回答链。',
    LangGraph:
        '有状态工作流编排工具；本例用节点、共享状态和条件边控制回答或兜底分支。',
    LangSmith:
        'Agent 的轨迹、调试、评估与监控平台；本例可选将工作流和模型调用记录到项目中。',
} as const;

export type GlossaryTerm = keyof typeof glossary;

export function findTerms(question: string): GlossaryTerm[] {
    const aliases: Record<GlossaryTerm, string[]> = {
        'Vercel AI SDK': ['vercel', 'ai sdk'],
        LangChain: ['langchain', 'lang chain'],
        LangGraph: ['langgraph', 'lang graph'],
        LangSmith: ['langsmith', 'lang smith'],
    };
    const normalized = question.toLowerCase();
    return (Object.keys(aliases) as GlossaryTerm[]).filter(term =>
        aliases[term].some(alias => normalized.includes(alias)),
    );
}
