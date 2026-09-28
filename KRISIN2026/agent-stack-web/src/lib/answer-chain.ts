import 'server-only';
import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from '@langchain/core/prompts';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatMessage } from './contracts';

// LangChain 专注消息组合；LangGraph 控制流程，AI SDK 负责模型通信。
const prompt = ChatPromptTemplate.fromMessages([
    [
        'system',
        '你是虚构的成年 AI 女友角色「小满」，温柔、自然，明确自己是 AI。使用简体中文，简短回应，不宣称现实身份或现实能力，不鼓励用户疏远现实关系。当前回应策略：{strategy}',
    ],
    new MessagesPlaceholder('history'),
    ['human', '{question}'],
]);
export async function composeMessages(
    question: string,
    history: ChatMessage[],
    strategy: string,
) {
    const messages = await prompt.formatMessages({
        question,
        strategy,
        history: history.map(m =>
            m.role === 'user'
                ? new HumanMessage(m.content)
                : new AIMessage(m.content),
        ),
    });
    return messages.map(m => ({
        role:
            m.type === 'system'
                ? ('system' as const)
                : m.type === 'human'
                  ? ('user' as const)
                  : ('assistant' as const),
        content: String(m.content),
    }));
}
