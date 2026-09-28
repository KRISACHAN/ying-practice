import "server-only";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { traceable } from "langsmith/traceable";
import { z } from "zod";
import { answerChain, type ToolActivity } from "./answer-chain";
import { findTerms, type GlossaryTerm } from "./glossary";

// LangGraph：状态存业务数据，节点只返回更新；不把提示词或密钥放进状态。
const WorkflowState = new StateSchema({
  question: z.string(),
  matchedTerms: z.array(z.string()),
  answer: z.string(),
  toolActivity: z.array(z.object({ name: z.string(), term: z.string() })),
  path: z.array(z.string()),
});

const workflow = new StateGraph(WorkflowState)
  .addNode("inspect", (state) => {
    const matchedTerms = findTerms(state.question);
    return { matchedTerms, path: [...state.path, "inspect"] };
  })
  .addNode("compose", async (state) => {
    const result = await answerChain.invoke({
      question: state.question,
      matchedTerms: state.matchedTerms.join("、"),
    });
    return {
      answer: result.text,
      toolActivity: result.toolActivity,
      path: [...state.path, "compose"],
    };
  })
  .addNode("fallback", (state) => ({
    answer: "这个示例只收录 Vercel AI SDK、LangChain、LangGraph、LangSmith。请问一个与它们有关的问题。",
    path: [...state.path, "fallback"],
  }))
  .addEdge(START, "inspect")
  .addConditionalEdges("inspect", (state) => state.matchedTerms.length > 0 ? "compose" : "fallback")
  .addEdge("compose", END)
  .addEdge("fallback", END)
  .compile();

export type WorkflowResult = {
  answer: string;
  matchedTerms: GlossaryTerm[];
  toolActivity: ToolActivity[];
  path: string[];
};

// LangSmith：整次图执行是根轨迹，模型调用作为子轨迹出现。
export const runWorkflow = traceable(
  async (question: string): Promise<WorkflowResult> => {
    const state = await workflow.invoke({
      question,
      matchedTerms: [],
      answer: "",
      toolActivity: [],
      path: [],
    });
    return {
      answer: state.answer,
      matchedTerms: state.matchedTerms as GlossaryTerm[],
      toolActivity: state.toolActivity,
      path: state.path,
    };
  },
  { name: "agent_stack_web_workflow" },
);
