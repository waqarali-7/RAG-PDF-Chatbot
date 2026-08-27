# PRD: Anthropic Provider Support

**Date:** 2026-08-26
**Status:** draft
**Author:** John (PM agent)

## Problem

Deployment operators need to route DocuChat's chat-completion calls through Anthropic (Claude) instead of OpenAI because some clients prohibit sending documents to OpenAI. Today every LLM call — embedding and chat — is hard-wired to the OpenAI SDK, so there is no way to satisfy that requirement without forking the codebase.

## Outcome

- An operator sets `LLM_PROVIDER=anthropic` plus an `ANTHROPIC_API_KEY` and the chatbot answers questions using Claude, with no code changes required.
- Citation structure in Anthropic-path responses is identical to the OpenAI path — same shape, same fields, same grounding rules.
- OpenAI remains the default provider; existing deployments are unaffected.

## Users / Roles

- **Deployment operator** — sets environment variables, chooses the provider.
- **End user** — uploads PDFs and asks questions; unaware of which provider is active.

## In scope

- Chat-completion provider abstraction (interface + OpenAI and Anthropic implementations).
- Provider selection via `LLM_PROVIDER` env var (`openai` | `anthropic`, default `openai`).
- Configurable model names via `OPENAI_MODEL` (default `gpt-4o-mini`) and `ANTHROPIC_MODEL` (default `claude-sonnet-5`).
- Startup config validation: fail fast if required keys are missing.
- `OPENAI_API_KEY` remains **always required** (embeddings depend on it regardless of provider).
- Adapter that maps the existing system prompt + user message + context into Anthropic's Messages API request shape.
- Citation parity: Anthropic path must produce the same citation structure as OpenAI path.

## Out of scope

- Embeddings provider swap — Anthropic has no embeddings endpoint. Embeddings continue to use OpenAI. See **Risk** below.
- UI provider-picker or runtime provider switching.
- Streaming responses (note as follow-up).
- Migrating or re-indexing existing documents.
- Changing the vector store implementation.

---

> **RISK — Document egress to OpenAI is NOT eliminated by this change.**
>
> The client's stated requirement is that documents should not be sent to OpenAI. This feature only routes *chat completions* through Anthropic. **Document chunks are still sent to OpenAI at ingest time** via the embeddings endpoint (`text-embedding-3-small`). This means every uploaded PDF still transits OpenAI's API, regardless of the `LLM_PROVIDER` setting.
>
> **This must be raised with the client before build, not after.** The client may believe that setting `LLM_PROVIDER=anthropic` fully removes OpenAI from the data path — it does not.
>
> **Mitigation path (out of scope for v1, must be designed):** Define an `EmbeddingsProvider` interface now so a future provider can be swapped in. Candidate options to evaluate: Voyage AI (hosted), a local embedding model (e.g. running via Ollama). Neither is in scope for this PRD, but the interface should be shaped to accommodate them.

---

## Key flows

1. **Startup validation** — Application reads `LLM_PROVIDER`. If `anthropic`, it verifies `ANTHROPIC_API_KEY` is set; if `openai` (or unset), it verifies `OPENAI_API_KEY`. `OPENAI_API_KEY` is validated regardless of provider (embeddings need it). Missing keys cause the process to exit with a clear error message before serving requests.

2. **Chat completion (Anthropic path)** — User submits a question → `answerQuestion` resolves the provider to the Anthropic implementation → retrieves context chunks from the vector store (unchanged) → builds the system prompt and user message → maps them into an Anthropic Messages API request (`messages.create()` with `role: "user"` message, system prompt via the `system` parameter) → returns the response with citations extracted in the same structure as the OpenAI path.

3. **Chat completion (OpenAI path, unchanged)** — Identical to current behavior. The existing `client.chat.completions.create()` call is wrapped behind the provider interface but its logic does not change.

4. **PDF upload (unchanged)** — Upload → parse → chunk → embed via OpenAI embeddings → store in vector store. No change to this flow regardless of provider selection.

## Business rules

- `LLM_PROVIDER` accepts exactly `openai` or `anthropic`. Any other value fails at startup.
- Default provider is `openai` (backward-compatible).
- `OPENAI_API_KEY` is required for all providers (embeddings dependency).
- `ANTHROPIC_API_KEY` is required only when `LLM_PROVIDER=anthropic`.
- Chat model is never hardcoded — always read from `OPENAI_MODEL` or `ANTHROPIC_MODEL` with sensible defaults (`gpt-4o-mini`, `claude-sonnet-5`).
- Temperature and system prompt are shared across providers, not duplicated.
- Citation extraction logic must produce identical structure regardless of provider — test with a 10-question golden set comparing citation structure (not wording).

## Edge cases

- `LLM_PROVIDER=anthropic` but `ANTHROPIC_API_KEY` is missing → startup failure with message naming the missing variable.
- `LLM_PROVIDER` is unset → default to `openai`, no warning.
- `LLM_PROVIDER` is set to an unrecognized value (e.g. `gemini`) → startup failure with message listing valid options.
- `OPENAI_API_KEY` is missing regardless of provider → startup failure (embeddings will fail).
- Anthropic API returns a rate-limit or auth error at query time → surface the error to the user the same way OpenAI errors are surfaced today.
- Anthropic response format differs from OpenAI (e.g. content blocks vs. plain string) → the adapter normalizes this before citation extraction runs.

## Non-functionals

- **Latency:** Anthropic path latency should be comparable to OpenAI path for equivalent model tiers. No specific SLA, but measure and log response times per provider for future comparison.
- **Security:** API keys must only be read from environment variables, never logged, never included in error messages, never exposed to the client.
- **Maintainability:** Provider interface must be narrow enough that adding a third provider (e.g. Google) requires only a new implementation, not changes to calling code.

## Acceptance criteria (high-level)

- [ ] Set `LLM_PROVIDER=anthropic` with valid keys → ask a question about an uploaded PDF → receive a cited answer.
- [ ] Citation structure from Anthropic path matches OpenAI path exactly (same fields, same shape).
- [ ] Run a 10-question golden set against both providers; citation structure (not wording) is identical.
- [ ] Set `LLM_PROVIDER=openai` (or leave unset) → existing behavior is unchanged.
- [ ] Remove `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic` → app fails at startup with a clear error message.
- [ ] Remove `OPENAI_API_KEY` with any provider → app fails at startup (embeddings dependency).
- [ ] Set `LLM_PROVIDER=bogus` → app fails at startup listing valid options.
- [ ] `OPENAI_MODEL` and `ANTHROPIC_MODEL` env vars override the default model for their respective providers.
- [ ] No hardcoded model names in source code.

## Open questions

- [ ] **Q:** Does the client understand that embeddings still transit OpenAI even with `LLM_PROVIDER=anthropic`? — **Owner:** Project lead — **Decision needed by:** before build starts.
- [ ] **Q:** Which embeddings alternative should we evaluate for v2 (Voyage AI vs. local model vs. other)? — **Owner:** Project lead — **Decision needed by:** after v1 ships, before v2 planning.
- [ ] **Q:** Should streaming be added in the same release or as a fast-follow? — **Owner:** Project lead — **Decision needed by:** epic planning.
