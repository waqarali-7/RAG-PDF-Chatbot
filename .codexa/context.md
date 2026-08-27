# Codexa Context — docuchat-rag

> Condensed context for AI agents. Every Codexa agent loads this file first.
> For full detail, see `.codexa/project-profile.md`.

**Project:** docuchat-rag — DocuChat — a RAG chatbot that answers questions from your PDFs with cited sources. Built with Next.js, TypeScript, and the OpenAI API.
**Type:** web-app
**Stack:** Next.js / TypeScript (strict mode unverified — check tsconfig) / yarn
**UI:** React + none
**Data:** none / not detected
**Validation:** none / not detected
**Auth:** none / not detected
**AI:** openai
**Media:** —
**Test runner:** none configured

**Top-level layout:**
- app/
- components/
- docs/
- lib/
- public/
- sample-docs/

**Capabilities (from API routes):**
- AI generation
- Media uploads

**Commands:**
- dev: `yarn dev`
- build: `yarn build`
- lint: `yarn lint`
- test: `_(none)_`

**Conventions (must follow unless story explicitly overrides):**
- Server components by default; `"use client"` only when required
- API routes live in `app/api/**/route.ts` (or `pages/api/*` for pages router)
- AI calls go through a service layer (e.g. `lib/services/` or `lib/prompts/`); never call openai from a route handler directly
- No `any` types — prefer `unknown` and narrow

**Do not touch:**
- node_modules/
- dist/
- build/
- .next/
- .turbo/
- .cache/
