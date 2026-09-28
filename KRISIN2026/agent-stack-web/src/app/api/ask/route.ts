import { NextResponse } from "next/server";
import { z } from "zod";
import { runWorkflow } from "@/lib/workflow";

export const runtime = "nodejs";

const requestSchema = z.object({ question: z.string().trim().min(2).max(500) });

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求必须是 JSON。" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "问题长度应为 2–500 字。" }, { status: 400 });
  }

  try {
    const result = await runWorkflow(parsed.data.question);
    return NextResponse.json({ ...result, tracingEnabled: process.env.LANGSMITH_TRACING === "true" });
  } catch (error) {
    // 服务器记录详情；客户端不接收密钥、请求体或提供商的原始错误。
    console.error("Agent workflow failed", error);
    const unconfigured = error instanceof Error && error.message === "MODEL_NOT_CONFIGURED";
    return NextResponse.json(
      { error: unconfigured ? "请先在 .env.local 配置 OPENAI_API_KEY 和 AI_MODEL。" : "模型调用失败，请检查服务端日志与模型配置。" },
      { status: unconfigured ? 503 : 502 },
    );
  }
}
