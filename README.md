# DocuChat — RAG over your PDFs

Ask questions about any PDF and get answers **grounded in cited source passages** — not hallucinated. DocuChat shows the exact evidence it retrieved alongside every answer, so you can see *why* it answered the way it did.

Built with **Next.js (App Router), TypeScript, and the OpenAI API**.

<!-- ▸ Add a 20–30s screen recording here. Upload a PDF, ask a question, show the answer + evidence cards lighting up. A GIF or Loom at the top is the single most important part of this README. -->

![DocuChat demo](docs/demo.gif)

**[▶ Live demo](https://your-deploy-url.vercel.app)** · Drop in a PDF and ask away.

---

## What this demonstrates

This is a complete, working Retrieval-Augmented Generation pipeline in a single codebase:

- **Document ingestion** — PDF text extraction, sentence-aware chunking with overlap, and batched embedding.
- **Semantic retrieval** — query embedding + cosine similarity search to pull the most relevant passages.
- **Grounded generation** — the LLM answers using *only* the retrieved context, and is instructed to say so when the documents don't contain the answer.
- **Visible sources** — every retrieved passage is shown with a relevance score, so the answer is auditable rather than a black box.

The vector store sits behind a small `VectorStore` interface, so the in-memory store used here can be swapped for a managed vector DB (Pinecone, Chroma, pgvector) without touching the rest of the app.

---

## How it works

```
INGEST                                  QUERY
──────                                  ─────
PDF                                     Question
 │ extract text                          │ embed
 ▼                                       ▼
Sentence-aware chunks  ──embed──►  ┌───────────────┐   top-k cosine
(with overlap)                     │  Vector store │ ◄──────────────  query vector
 │                                 └───────────────┘
 ▼                                       │ retrieve
Vectors stored                           ▼
                                   Relevant passages
                                         │ + question
                                         ▼
                                   LLM (grounded prompt)
                                         │
                                         ▼
                                   Answer + cited sources
```

The anti-hallucination guarantee lives in two places: the model is given only the retrieved passages as context, and the system prompt forces it to admit when those passages don't contain the answer.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | One codebase, API routes + UI, one-click deploy |
| Language | TypeScript | Typed end-to-end, including the RAG engine |
| Embeddings | OpenAI `text-embedding-3-small` | Cheap, fast, strong retrieval quality |
| Generation | OpenAI `gpt-4o-mini` | Low-cost grounded answering |
| Vector store | In-memory (pluggable interface) | Zero external services for the demo |
| PDF parsing | `pdf-parse` | Reliable text extraction |

---

## Run it locally

**Prerequisites:** Node.js 18+ and an OpenAI API key.

```bash
git clone https://github.com/waqarali-7/docuchat-rag.git
cd docuchat-rag
npm install

cp .env.example .env.local
# open .env.local and paste your OpenAI key

npm run dev
```

Open <http://localhost:3000>, upload a PDF (a sample is in [`sample-docs/`](sample-docs/)), and start asking questions.

---

## Deploy

This deploys to **Vercel** in one click:

1. Push the repo to your GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add `OPENAI_API_KEY` as an environment variable.
4. Deploy.

> The demo's in-memory store resets on each cold start — fine for a showcase. For persistent multi-user use, back the `VectorStore` interface with a managed vector DB.

---

## Project structure

```
lib/
  rag.ts        ← the RAG engine: chunking, embeddings, retrieval, grounded answering
  store.ts      ← in-memory VectorStore implementation (swap for a real DB)
app/
  api/upload/   ← parse PDF → chunk → embed → index
  api/chat/     ← embed question → retrieve → answer with sources
  page.tsx      ← the chat UI with visible evidence cards
sample-docs/    ← a PDF you can try immediately
```

---

## Notes on the design choices

A few decisions worth calling out, since they're the kind of thing that separates a real RAG build from a toy:

- **Overlapping chunks.** A fact that straddles a chunk boundary would be lost without overlap. Chunks are split on sentence boundaries first so they stay semantically coherent.
- **Batched embeddings.** All chunks of a document are embedded in one API call rather than one-per-request.
- **Pluggable store.** The retrieval backend is an interface, not a hardcoded dependency — the demo runs with zero infrastructure, production swaps in a vector DB.
- **Auditable answers.** Showing the retrieved passages and their scores is a feature, not debug output. It's what makes the system trustworthy for real use.

---

## License

MIT — use it, fork it, learn from it.

---

Built by **Waqar Ali** — senior full-stack & AI automation engineer.
[Upwork](https://www.upwork.com/freelancers/waqarali7) · [GitHub](https://github.com/waqarali-7)
