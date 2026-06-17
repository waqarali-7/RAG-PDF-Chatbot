import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/lib/rag";
import { store } from "@/lib/store";

// pdf-parse is CommonJS; import lazily to keep the route edge-safe-ish.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Attach a PDF under the 'file' field." },
        { status: 400 }
      );
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    const text = parsed.text?.trim();

    if (!text) {
      return NextResponse.json(
        { error: "Could not extract any text from this PDF. It may be a scanned image." },
        { status: 422 }
      );
    }

    const chunkCount = await ingestDocument(text, file.name, store);

    return NextResponse.json({
      source: file.name,
      chunks: chunkCount,
      pages: parsed.numpages,
      totalChunks: store.size(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
