# Architecture: Anthropic Provider Support

**Date:** 2026-08-27
**Author:** Winston (Architect agent)

## Affected Systems

| System | Impact | Files |
|---|---|---|
| Chat completion | New provider abstraction + Anthropic implementation | `lib/rag.ts` (refactor `answerQuestion`), new `lib/providers/*` |
| Config / startup | Env var validation, provider selection | New `lib/config.ts` |
| Dependencies | New SDK | `package.json` (add `@anthropic-ai/sdk`) |
| Embeddings | No change to logic; `getClient()` renamed for clarity | `lib/rag.ts` |
| API routes | No change | `app/api/chat/route.ts`, `app/api/upload/route.ts` |
| UI | No change | `app/page.tsx` |
| Vector store | No change | `lib/store.ts` |

## Data Model Changes

None. The `Answer` interface (`{ answer: string, sources: RetrievedChunk[] }`) is unchanged. Citations come from the retrieval layer, not the LLM — both providers share the same vector search pipeline, so citation parity is structurally guaranteed.

## API Surface

No new endpoints. Existing routes are unchanged:

| Method | Path | Purpose | Change |
|---|---|---|---|
| POST | `/api/chat` | Ask a question | None — calls `answerQuestion`, which internally resolves the provider |
| POST | `/api/upload` | Upload a PDF | None — embeddings always use OpenAI |

### Response shape

The `/api/chat` response shape is unchanged:

```ts
{
  answer: string;
  sources: Array<{
    id: string;
    text: string;
    position: number;
    source: string;
    score: number;
  }>;
}
```

## Provider Abstraction

### Interface

A single narrow interface in `lib/providers/types.ts`:

```ts
export interface ChatProvider {
  complete(
    systemPrompt: string,
    userMessage: string,
    options: { temperature: number }
  ): Promise<string>;
}
```

Returns the answer text only. The calling code (`answerQuestion`) handles retrieval, context assembly, and response packaging — exactly as today.

**Why this shape:** The current `answerQuestion` function already separates the concerns cleanly — it builds the system prompt + user message, calls the LLM, and extracts `.choices[0].message.content`. The interface captures exactly the LLM call boundary. Model selection is not a parameter — each implementation reads its own model env var internally, keeping the interface free of provider-specific config.

### Implementations

**`lib/providers/openai.ts`** — wraps the existing `client.chat.completions.create()` call. Reads `OPENAI_MODEL` (default `gpt-4o-mini`). Pattern to follow: the existing `getClient()` in `lib/rag.ts`.

```ts
// Pseudocode — exact implementation left to stories
import OpenAI from "openai";

export class OpenAIChatProvider implements ChatProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async complete(systemPrompt, userMessage, { temperature }) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }
}
```

**`lib/providers/anthropic.ts`** — maps to Anthropic's Messages API. Reads `ANTHROPIC_MODEL` (default `claude-sonnet-5`). Key mapping differences:

| Concern | OpenAI | Anthropic |
|---|---|---|
| System prompt | `messages[0].role = "system"` | Top-level `system` parameter |
| User message | `messages[1].role = "user"` | `messages[0].role = "user"` |
| Response shape | `choices[0].message.content` (string) | `content[0].text` (content block array) |
| Max tokens | Optional | **Required** (`max_tokens` param) |

```ts
// Pseudocode
import Anthropic from "@anthropic-ai/sdk";

export class AnthropicChatProvider implements ChatProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(systemPrompt, userMessage, { temperature }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const block = res.content.find((b) => b.type === "text");
    return block?.text?.trim() ?? "";
  }
}
```

### Factory

**`lib/providers/index.ts`** — reads `LLM_PROVIDER`, constructs and caches the correct implementation. Exports a `getChatProvider()` function.

```ts
export function getChatProvider(): ChatProvider {
  // Return cached singleton if already created.
  // Read LLM_PROVIDER, validate, construct the right implementation.
}
```

## Config Validation

**`lib/config.ts`** — validates environment variables and exports typed config. Called by the provider factory on first use.

### Validation rules

| Variable | Required when | Default |
|---|---|---|
| `LLM_PROVIDER` | Always (optional) | `"openai"` |
| `OPENAI_API_KEY` | Always | — (fail if missing) |
| `OPENAI_MODEL` | `LLM_PROVIDER=openai` | `"gpt-4o-mini"` |
| `ANTHROPIC_API_KEY` | `LLM_PROVIDER=anthropic` | — (fail if missing) |
| `ANTHROPIC_MODEL` | `LLM_PROVIDER=anthropic` | `"claude-sonnet-5"` |

### Fail-fast behavior

- `LLM_PROVIDER` is not `"openai"` or `"anthropic"` → throw with message listing valid values.
- `OPENAI_API_KEY` missing → throw regardless of provider (embeddings depend on it).
- `ANTHROPIC_API_KEY` missing when `LLM_PROVIDER=anthropic` → throw naming the missing variable.

Config is validated on first import of the provider module. In Next.js, this happens when the first request hits a route that imports `lib/providers` — effectively at server startup. The error surfaces as a startup crash with a clear message.

### Exported config shape

```ts
export interface AppConfig {
  llmProvider: "openai" | "anthropic";
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
}
```

## Changes to `lib/rag.ts`

Minimal — the function signatures and return types stay the same.

1. **`getClient()`** — renamed to `getEmbeddingClient()` for clarity. Still returns an OpenAI instance, still used only by `embedTexts()`. No behavior change.

2. **`CHAT_MODEL` constant** — removed. Model selection moves into provider config.

3. **`EMBEDDING_MODEL` constant** — unchanged.

4. **`answerQuestion()`** — the only functional change. Currently creates an OpenAI client and calls `chat.completions.create` inline. Refactored to:
   - Call `getChatProvider()` to get the active provider.
   - Build the system prompt and user message exactly as today.
   - Call `provider.complete(systemPrompt, userMessage, { temperature: 0.2 })`.
   - Package the result into `Answer` exactly as today.

The system prompt text, context formatting, temperature, and top-K retrieval are unchanged and shared across providers.

## Integration Points

| Integration | Direction | Change |
|---|---|---|
| OpenAI Embeddings API | Outbound | No change — always uses OpenAI |
| OpenAI Chat API | Outbound | Wrapped behind `ChatProvider` |
| Anthropic Messages API | Outbound (new) | New `AnthropicChatProvider` |
| Vector store | Internal | No change |

## New Files

| File | Purpose |
|---|---|
| `lib/providers/types.ts` | `ChatProvider` interface |
| `lib/providers/openai.ts` | OpenAI implementation |
| `lib/providers/anthropic.ts` | Anthropic implementation |
| `lib/providers/index.ts` | Factory + provider cache |
| `lib/config.ts` | Env var validation + typed config |

## Modified Files

| File | Change |
|---|---|
| `lib/rag.ts` | Rename `getClient` → `getEmbeddingClient`, remove `CHAT_MODEL`, refactor `answerQuestion` to use `ChatProvider` |
| `package.json` | Add `@anthropic-ai/sdk` dependency |

## Permissions & Authorization

No permission model — provider selection is an operator-level concern configured via environment variables, not a runtime or user-facing decision.

## Migration & Rollout

No migration needed. Default behavior (`LLM_PROVIDER` unset → OpenAI) matches current behavior exactly. Existing deployments are unaffected.

**Deployment sequence:**
1. Merge code.
2. Operator sets `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` in their environment to opt in.
3. No feature flags — env var is the switch.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic response format changes between SDK versions | Low | Medium | Pin `@anthropic-ai/sdk` to a specific major version. The adapter's content-block extraction is the only format-dependent code. |
| `max_tokens` too low truncates long answers | Medium | Low | Default 4096 is generous for RAG answers. Monitor response `stop_reason` — `"end_turn"` is normal, `"max_tokens"` means truncation. |
| Operator believes `LLM_PROVIDER=anthropic` eliminates OpenAI data egress | High | High | **This is a PRD-level risk, not an architecture risk.** The embeddings path still sends document chunks to OpenAI. The PRD flags this and requires it to be raised with the client before build. Architecture cannot mitigate a communication gap. |
| Anthropic rate limits differ from OpenAI | Medium | Low | Surface rate-limit errors the same way OpenAI errors are surfaced today (catch in route handler, return 500 with message). No retry logic in v1. |

## Decisions Log

| Decision | Why | Alternative considered |
|---|---|---|
| `ChatProvider.complete()` returns `string`, not a structured response object | The calling code only needs the answer text. Citations come from retrieval, not the LLM. A richer return type would be YAGNI — add fields when streaming or tool-use arrives. | Return `{ text: string, stopReason: string, usage: {...} }` — rejected as premature. |
| Model name read inside each provider, not passed through the interface | Keeps the interface provider-agnostic. `OPENAI_MODEL` and `ANTHROPIC_MODEL` are different env vars with different valid values — the caller shouldn't know about them. | Pass model as a `complete()` parameter — rejected because it leaks provider-specific knowledge. |
| Config validated on first import, not via Next.js instrumentation hook | Simpler, no Next.js-version-specific API dependency. The practical effect is the same — the server crashes on the first request if config is invalid, which for a fresh deploy is immediate. | `instrumentation.ts` with `register()` — cleaner semantics but adds a Next.js API surface that may change. |
| Singleton provider instance, not per-request construction | The provider is stateless and the SDK clients are designed for reuse. Constructing per-request wastes memory and connection setup. Follow the pattern in `lib/store.ts` (singleton store). | Per-request factory — rejected for waste. |
| `max_tokens: 4096` hardcoded in Anthropic provider | Anthropic's API requires it. 4096 is generous for RAG answers (typically 100–500 tokens). Not worth an env var until there's a real need to tune it. | Env var `ANTHROPIC_MAX_TOKENS` — rejected as premature config surface. |

## Pattern References (existing files to follow)

- **Provider construction:** follow the singleton pattern in `lib/store.ts:61-70` (globalThis cache for dev HMR).
- **Error handling in routes:** follow `app/api/chat/route.ts:12-17` — catch, extract message, return JSON error. Provider errors should surface the same way.
- **OpenAI client creation:** follow `lib/rag.ts:52-60` (`getClient` pattern — validate key, construct, return).
- **Module structure:** follow the existing flat `lib/` layout. The `providers/` subdirectory is justified by having four files (types, two implementations, factory) that form a cohesive unit.

## Out of Scope — Embeddings Provider Interface (Design Note)

The PRD flags that embeddings still transit OpenAI even when `LLM_PROVIDER=anthropic`. It asks that an `EmbeddingsProvider` interface be *designed* (not implemented) so a future provider can be swapped in.

**Recommended interface shape** (to be created in a future feature):

```ts
export interface EmbeddingsProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

The `dimensions` field matters because switching embedding models changes vector dimensionality, which invalidates any existing stored vectors. A future implementation must handle re-indexing.

**Not implemented in this feature.** The current `embedTexts()` in `lib/rag.ts` continues to call OpenAI directly. This interface is recorded here so the v2 feature can pick it up without re-deriving the design.
