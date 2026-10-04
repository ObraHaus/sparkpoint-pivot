# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History note.** The changelog starts here — earlier entries remain available in the git history.
> The repo changelog and the in-app changelog (`services/agent/content_seed/whats-new.json`) are
> reset together; a seed reset prunes the old in-app entries on the next agent boot/reingest.

## [Unreleased]

### Changed (AI model lineup — chat, self-authoring, embeddings)

- **The gateway model lineup is switched on both environments.** `sparkpoint-chat` is now **Ling 3.0 Flash Sante (free)** with a **Qwen 3.8 27B (free)** fallback; `sparkpoint-chat-premium` is now **Ling 3.1 Flash** with an **Apodex 1.1 Mini (free)** fallback (both currently $0 upstream; costs pinned to 0 in the config so spend accounting stays honest). `sparkpoint-selfauthor` — Sparky's daily self-authored research job — is now defined in `services/litellm/config.yaml` with the same pair as premium, so it exists on **both** gateways; previously it lived only in the alpha gateway's LiteLLM DB, which is why beta self-authoring runs had no model. All four upstreams were probed live (clean JSON, 262k ctx) before the switch.
- **The RAG embedding model is switched to `nvidia/llama-nemotron-embed-vl-1b-v2:free`** (OpenRouter; native 2048-dim, MRL-truncated to the pinned 1024). This is a **re-embed event**: the pin is bumped to `nvidia-llama-nemotron-embed-vl-1b-v2-mrl1024@2026.10.0`, and the `memory_chunks` corpus is cleared and re-ingested on both alpha and beta (knowledge seed, changelog, tips). The truncation path was validated against the provider's own 1024-dim output (cosine ≥ 0.9999999) so the pgvector `vector(1024)` column and HNSW index are unchanged. The relevance fixture is regenerated from the new space. No secret/PII handling changed: every ingest still passes the fail-closed PII scan before any embed call.

## [0.3.0] — 2026-09-18 — Beta launch (Robinhood Chain)

### Added

- **beta.sparkpoint.io is live on Robinhood Chain (4663).** Wallet connect + SIWE sign-in, Sparky chat, portfolio reads (native ETH + USDG), and user-signed **ETH ↔ USDG** swaps on the network's own Uniswap V3.
- **The 0.20% swap fee, disclosed before signing.** A non-custodial `FeeRouter` charges the fee on the input side and routes it to the immutable `RevenueSplitter` (90% broker holders / 10% treasury); the confirm screen shows the exact fee and where it goes.
- **Sparky Broker (test collection).** Clock in, promote and fuse brokers; Pons trading fees flow `splitter → engine pot → per-broker vault`, and a broker's owner withdraws what it earned.
- **Trust Center** lists every deployed 4663 contract with verifiable addresses — including the fee router and the swap quote source.

### Fixed

- **Sign-in no longer stalls** on a slow fail-open check (hard time budget + retry; the button says which step it is on).
- **Swap quotes work again** — 4663 shipped without a working quoter; a minimal read-only quote contract was deployed and wired.
- **The changelog reset clears the old in-app rows completely.** The seed prune now also removes entries created before slugs existed (seed-owned, `slug IS NULL`), so the in-app changelog shows exactly the committed seed — while an operator's Admin → Updates edit is still never touched.
