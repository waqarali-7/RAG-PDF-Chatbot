import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/rag";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();

    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "Ask a question in the 'question' field." },
        { status: 400 }
      );
    }

    const result = await answerQuestion(question.trim(), store);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
