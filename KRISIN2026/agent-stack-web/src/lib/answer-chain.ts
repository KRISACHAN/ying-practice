import 'server-only';
import { createOpenAI } from '@ai-sdk/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { generateText, stepCountIs, tool } from 'ai';
import { traceable } from 'langsmith/traceable';
import { z } from 'zod';
import { glossary, type GlossaryTerm } from './glossary';

const terms = Object.keys(glossary) as [GlossaryTerm, ...GlossaryTerm[]];

// LangChain：把输入变量与回答规范组合成可复用的提示词，而不负责模型调用。
const answerPrompt =
    PromptTemplate.fromTemplate(`你是一位给 TypeScript 工程师讲解 Agent 工具的老师。
请先调用 lookupConcept 工具核对问题涉及的概念，再根据工具结果用简体中文回答。
只使用工具返回的资料陈述这四个产品的职责；资料不足时明确说明，不要编造。
先直接回答问题，再用简短的要点解释各产品在本示例中的分工。
相关概念：{matchedTerms}
用户问题：{question}`);

export type ToolActivity = { name: string; term: string };
export type AnswerResult = { text: string; toolActivity: ToolActivity[] };

// LangSmith：模型调用是独立子轨迹，便于查看输入、输出和耗时。
// 开启云端追踪会上传问题及工具结果，使用私有业务数据前应先确认组织策略。
const generateWithTrace = traceable(
    async (prompt: string): Promise<AnswerResult> => {
        const apiKey = process.env.OPENAI_API_KEY;
        const modelName = process.env.AI_MODEL;
        if (!apiKey || !modelName) throw new Error('MODEL_NOT_CONFIGURED');

        const provider = createOpenAI({
            apiKey,
            ...(process.env.OPENAI_BASE_URL
                ? { baseURL: process.env.OPENAI_BASE_URL }
                : {}),
        });
        const result = await generateText({
            model: provider(modelName),
            prompt,
            tools: {
                lookupConcept: tool({
                    description:
                        '从本地词条中读取一个 Agent 工具的定义与本例用途。',
                    inputSchema: z.object({ term: z.enum(terms) }),
                    execute: async ({ term }) => ({
                        term,
                        description: glossary[term],
                    }),
                }),
            },
            // AI SDK：第一步必须核对资料，之后最多再运行五步，防止无限工具循环。
            stopWhen: stepCountIs(6),
            prepareStep: ({ stepNumber }) => ({
                toolChoice: stepNumber === 0 ? 'required' : 'auto',
            }),
        });

        return {
            text:
                result.text ||
                '模型在步骤上限内没有生成最终答案，请缩小问题范围重试。',
            toolActivity: result.steps.flatMap(step =>
                step.toolCalls.map(call => {
                    const input = z
                        .object({ term: z.string() })
                        .safeParse(call.input);
                    return {
                        name: call.toolName,
                        term: input.success ? input.data.term : '未知参数',
                    };
                }),
            ),
        };
    },
    { name: 'ai_sdk_generate_with_tool', run_type: 'llm' },
);

// LangChain：链只处理提示词组合和函数衔接；AI SDK 是唯一的模型调用入口。
export const answerChain = RunnableSequence.from([
    answerPrompt,
    RunnableLambda.from(formattedPrompt =>
        generateWithTrace(formattedPrompt.toString()),
    ),
]);
