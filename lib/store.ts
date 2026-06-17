import {
  cosineSimilarity,
  RetrievedChunk,
  StoredChunk,
  VectorStore,
} from "./rag";

/**
 * Brute-force in-memory vector store.
 *
 * Perfect for a demo and for small document sets: zero external services,
 * runs instantly on a clean clone. It scans every stored vector on each
 * query (O(n)), which is fine up to a few thousand chunks.
 *
 * To go to production, implement the same `VectorStore` interface against
 * a managed vector DB (Pinecone, Chroma, pgvector) that does approximate
 * nearest-neighbour search at scale — nothing else in the app changes.
 */
export class MemoryVectorStore implements VectorStore {
  private chunks: StoredChunk[] = [];

  async add(chunks: StoredChunk[]): Promise<void> {
    this.chunks.push(...chunks);
  }

  async search(queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
    return this.chunks
      .map((c) => ({
        id: c.id,
        text: c.text,
        position: c.position,
        source: c.source,
        score: cosineSimilarity(queryEmbedding, c.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }

  size(): number {
    return this.chunks.length;
  }

  /** Distinct source document names currently in the store. */
  sources(): string[] {
    return Array.from(new Set(this.chunks.map((c) => c.source)));
  }
}

/**
 * Single shared store for the demo so uploads and queries hit the same
 * instance across API routes within a server process.
 *
 * NOTE: this lives in server memory and resets on redeploy / cold start.
 * That's intentional for a stateless demo. A production build would
 * persist to a real vector DB (see MemoryVectorStore docs above).
 */
const globalForStore = globalThis as unknown as {
  ragStore?: MemoryVectorStore;
};

export const store: MemoryVectorStore =
  globalForStore.ragStore ?? new MemoryVectorStore();

if (process.env.NODE_ENV !== "production") {
  globalForStore.ragStore = store;
}
