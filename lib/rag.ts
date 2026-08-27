import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Core RAG engine.
 *
 * The pipeline has two halves:
 *   1. INGEST  — split a document into overlapping chunks, embed each chunk,
 *                and store the vectors in a vector store.
 *   2. QUERY   — embed the user's question, retrieve the most similar chunks
 *                by cosine similarity, and hand them to the LLM as grounded
 *                context so answers cite real source passages instead of
 *                hallucinating.
 *
 * The VectorStore interface is deliberately small so the in-memory store
 * used for the demo can be swapped for a real vector DB (Pinecone, Chroma,
 * pgvector, etc.) without touching the rest of the app — see `MemoryVectorStore`.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";

const VALID_PROVIDERS = ["openai", "anthropic"] as const;
type LLMProvider = (typeof VALID_PROVIDERS)[number];

const SYSTEM_PROMPT =
  "You answer questions using only the provided source passages. " +
  "Write for a normal reader: clear, friendly, and easy to follow. " +
  "Start with a direct answer in plain language. If there are several points, " +
  "use short markdown bullet points. Keep sentences short and avoid jargon. " +
  "Do NOT put citation markers like [Source 1] in your answer — the sources " +
  "are shown separately below your response. " +
  "If the passages do not contain the answer, say so plainly in one friendly " +
  "sentence — do not guess or use outside knowledge.";

export interface Chunk {
  id: string;
  text: string;
  /** 1-based index of the chunk within its source document. */
  position: number;
  source: string;
}

export interface StoredChunk extends Chunk {
  embedding: number[];
}

export interface RetrievedChunk extends Chunk {
  /** Cosine similarity to the query, 0..1. Higher is more relevant. */
  score: number;
}

/**
 * Minimal vector store contract. Implement this against any backend.
 * The demo ships an in-memory implementation; production would back it
 * with a managed vector DB.
 */
export interface VectorStore {
  add(chunks: StoredChunk[]): Promise<void>;
  /** Return the top-k chunks most similar to `queryEmbedding`. */
  search(queryEmbedding: number[], k: number): Promise<RetrievedChunk[]>;
  clear(): Promise<void>;
  size(): number;
}

// ---------------------------------------------------------------------------
// Chat provider abstraction (chat completions only — embeddings stay OpenAI)
// ---------------------------------------------------------------------------

interface ChatProvider {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

class OpenAIChatProvider implements ChatProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, timeout: 60_000 });
    this.model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return (
      completion.choices[0]?.message?.content?.trim() ?? ""
    );
  }
}

class AnthropicChatProvider implements ChatProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000 });
    this.model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const block = response.content.find((b) => b.type === "text");
    return block ? block.text.trim() : "";
  }
}

// ---------------------------------------------------------------------------
// Config validation & provider resolution
// ---------------------------------------------------------------------------

function validateConfig(): LLMProvider {
  const raw = process.env.LLM_PROVIDER ?? "openai";
  if (!(VALID_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid LLM_PROVIDER "${raw}". Valid options: ${VALID_PROVIDERS.join(", ")}.`
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. It is always required (embeddings depend on it). " +
        "Copy .env.example to .env.local and add your key."
    );
  }
  if (raw === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. It is required when LLM_PROVIDER is "anthropic".'
    );
  }
  return raw as LLMProvider;
}

let _chatProvider: ChatProvider | null = null;

function getChatProvider(): ChatProvider {
  if (_chatProvider) return _chatProvider;
  const provider = validateConfig();
  _chatProvider =
    provider === "anthropic"
      ? new AnthropicChatProvider(process.env.ANTHROPIC_API_KEY!)
      : new OpenAIChatProvider(process.env.OPENAI_API_KEY!);
  return _chatProvider;
}

// ---------------------------------------------------------------------------
// OpenAI client for embeddings (always required, regardless of provider)
// ---------------------------------------------------------------------------

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy .env.example to .env.local and add your key."
    );
  }
  return new OpenAI({ apiKey, timeout: 60_000 });
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Split raw text into overlapping chunks.
 *
 * Overlap matters: a fact that straddles a chunk boundary would be lost
 * without it. We split on sentence-ish boundaries first so chunks stay
 * semantically coherent rather than cutting mid-sentence.
 */
export function chunkText(
  text: string,
  source: string,
  { chunkSize = 900, overlap = 150 }: { chunkSize?: number; overlap?: number } = {}
): Chunk[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  // Sentence-aware segmentation, then greedily pack sentences into chunks.
  const sentences = clean.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) ?? [clean];

  const chunks: Chunk[] = [];
  let current = "";
  let position = 0;

  const push = (textForChunk: string) => {
    const trimmed = textForChunk.trim();
    if (!trimmed) return;
    position += 1;
    chunks.push({
      id: `${source}::${position}`,
      text: trimmed,
      position,
      source,
    });
  };

  for (const sentence of sentences) {
    if ((current + sentence).length > chunkSize && current) {
      push(current);
      // Start the next chunk with an overlapping tail of the previous one.
      current = current.slice(Math.max(0, current.length - overlap)) + sentence;
    } else {
      current += sentence;
    }
  }
  push(current);

  return chunks;
}

/** Embed an array of texts in a single batched API call. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

/** Ingest: chunk a document, embed every chunk, store the vectors. */
export async function ingestDocument(
  text: string,
  source: string,
  store: VectorStore
): Promise<number> {
  const chunks = chunkText(text, source);
  if (chunks.length === 0) return 0;

  const embeddings = await embedTexts(chunks.map((c) => c.text));
  const stored: StoredChunk[] = chunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i],
  }));
  await store.add(stored);
  return stored.length;
}

export interface Answer {
  answer: string;
  sources: RetrievedChunk[];
}

/**
 * Query: retrieve the most relevant chunks and ask the model to answer
 * using ONLY that context. The system prompt forces the model to admit
 * when the documents don't contain the answer — this is the core
 * anti-hallucination guarantee of a RAG system.
 */
export async function answerQuestion(
  question: string,
  store: VectorStore,
  { topK = 4 }: { topK?: number } = {}
): Promise<Answer> {
  if (store.size() === 0) {
    return {
      answer:
        "No documents have been added yet. Upload a PDF first, then ask a question.",
      sources: [],
    };
  }

  const [queryEmbedding] = await embedTexts([question]);
  const retrieved = await store.search(queryEmbedding, topK);

  const context = retrieved
    .map((c, i) => `[Source ${i + 1} — ${c.source}, passage ${c.position}]\n${c.text}`)
    .join("\n\n");

  const provider = getChatProvider();
  const text = await provider.complete(
    SYSTEM_PROMPT,
    `Source passages:\n\n${context}\n\nQuestion: ${question}`
  );

  return {
    answer: text || "I couldn't generate an answer.",
    sources: retrieved,
  };
}
