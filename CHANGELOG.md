# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History note.** The changelog starts here — earlier entries remain available in the git history.
> The repo changelog and the in-app changelog (`services/agent/content_seed/whats-new.json`) are
> reset together; a seed reset prunes the old in-app entries on the next agent boot/reingest.

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
