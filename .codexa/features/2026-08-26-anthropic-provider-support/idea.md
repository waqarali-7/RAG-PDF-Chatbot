# Idea

## The request
"Can this thing use Claude instead of OpenAI? Some of our clients won't
send documents to OpenAI."

## What I think they mean
Provider choice, not a swap. The chat and embedding calls both need to
route through a configurable provider so a deployment can pick one.

## What's in scope
- Provider abstraction for the chat completion call
- Anthropic implementation alongside the existing OpenAI one
- Provider selected by env var, defaulting to current behaviour

## Out of scope
- Embeddings provider swap (Anthropic has no embeddings endpoint — needs
  its own decision, park it)
- Any UI for switching providers
- Migrating existing indexed documents
