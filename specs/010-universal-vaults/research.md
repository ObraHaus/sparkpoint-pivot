# Research: Universal Vaults (Phase 0)

Decisions and rationale grounding the plan. Sources: direct read of
`services/agent/src/sparkpoint_agent/api/recommendations.py` (`_build_chain_context`,
`MarketData(gross_apy_bps=None, …)`), `coordinator/dag.py` (`MarketData`), `agents/recommender.py`
(code-fixed candidate set), `chain/vault_reader.py` (`_REQUIRED_METHODS` frozenset),
`packages/shared/src/addresses/*` (the `AddressBook` + 007's `swapFeeRecipient` plain-field precedent),
`packages/shared/src/policy/enums.ts` (Protocol/Asset mirror, CI parity T098), on-chain checks of the
Morpho deployment on Base + Base Sepolia, and the SparkPoint Constitution v1.3.0. Companion feature:
[011 — Wrapper Vault Factory](../011-wrapper-vault-factory/) reads this feature's registry + generic reader.

## D1 — Morpho GraphQL as the primary yield feed (not a QuickNode Earn API)

**Decision**: Use the **Morpho GraphQL API** (`https://api.morpho.org/graphql`, public, keyless,
~750 req/min, no SLA, **mainnet-only**) as the primary APY/TVL source for external vaults, with
**DeFiLlama** and **on-chain-derived** reads as the fallback tiers. Surface "QuickNode Earn" *as* the
Morpho vaults it is built on rather than integrating a QuickNode API.

**Rationale**: QuickNode Earn is a non-custodial USDC optimizer **built on Morpho vaults** with no reliable
public API — its economic reality *is* the underlying Morpho vaults, which the Morpho API already exposes
with net APY, TVL, and fees. Morpho vaults are standard ERC-4626 (+ERC-2612). Going straight to the source
avoids a brittle, undocumented dependency and lets one feed cover the whole "external Morpho universe".
Morpho subgraphs are deprecated (rejected). The API is keyless, so no secret/env-var onboarding is needed —
it stays a pure read.

**Recorded limitation**: the Morpho API/app are **mainnet-only**. On Base Sepolia (84532, the alpha chain)
they serve no data, so external APY there is honestly "unavailable (testnet)" (see D3). This is a labeling
concern, not a blocker — the SparkPoint launch vault's own figures come from on-chain reads regardless.

## D2 — The feed is ADVISORY and fail-open; it never touches signability

**Decision**: `data/market_data.py` returns, per vault, a `MarketQuote {apy (gross/net), tvl, source,
as_of, available}`. It is wired **only** into the recommender's `MarketData` (today
`gross_apy_bps=None, projected_apy_bps=None`), which feeds the LLM's **ranking + narration**. The candidate
SET stays code-fixed and whitelisted (`agents/recommender.py` `build_action` / `constants.allowlist` are
unchanged); the feed can add/remove/clear **nothing** signable. On total source failure the feed returns
`available=False` → the turn shows "unavailable", **never `0`, never a fabricated APY, never last-good
presented as live** (staleness is labeled).

**Rationale**: This is the load-bearing constitutional decision. Constitution II lets the model
"analyze / rank / propose"; feeding it real market data widens its **information set**, not its
**disposition**. Fail-open-to-unavailable satisfies Constitution III ("current + verifiable … never
promised") and forecloses the failure mode where a down feed silently reads as `0%` APY and mis-ranks. The
security-relevant invariant to test: for **every** feed outcome (live / fallback / unavailable) the
candidate set + policy stamps are byte-identical to today's. Rejected: letting the feed influence which
candidates are offered — that would let untrusted external data reach disposition, violating Principle II.

**Sanity-bounding**: a source returning a wildly out-of-range APY (feed bug or manipulated pool) is bounded
and labeled "suspect / unavailable" rather than surfaced as a headline "better yield", so a poisoned feed
cannot become misleading advice.

## D3 — Time-boxed + cached, single batched query per turn

**Decision**: The feed is time-boxed (a few hundred ms) and cached per RECOMMEND turn, issuing a single
batched Morpho GraphQL query for all registered mainnet vaults. A slow/unreachable source degrades **that
turn** to "unavailable" rather than blocking it. Cache TTL + endpoint + fallback order are documented in
`DEVELOPMENT.md`.

**Rationale**: The Morpho API is ~750 req/min with **no SLA**, and the dev box is CPU-starved (~25s/render
per project memory). An unbounded per-candidate fan-out would blow the rate budget and stall the
recommender. Batching + caching keeps the feed cheap and keeps the recommender responsive; time-boxing
turns a feed outage into a clean "unavailable", not a hung turn.

## D4 — Split `_REQUIRED_METHODS` into generic-4626 core vs SparkPoint-only extras

**Decision**: Split the agent `vault_reader` `_REQUIRED_METHODS` frozenset into
`GENERIC_4626_METHODS` (the standard ERC-4626 surface: `asset`, `decimals`, `totalAssets`,
`convertToAssets`, `convertToShares`, `previewDeposit`, `previewRedeem`, `balanceOf`) and
`SPARKPOINT_EXTRA_METHODS` (`performanceFeeBps`, `highWaterMark`, `feeRecipient`, `paused`). The reader is
selected by the registry row's `abiKind`: `sparkpoint` → the full reader (core + extras, exactly as today);
`erc4626` → the generic reader (core only). The web mirrors this with a generic `resolveErc4626()` beside
the existing single-vault `useVault.ts`.

**Rationale**: External Morpho/ERC-4626 vaults expose only the standard surface — they have no
`performanceFeeBps`/`highWaterMark`/`feeRecipient`. Today's single fixed reader validates the whole
`_REQUIRED_METHODS` set and would fail-closed on every external vault. Splitting the set is the minimal
change that lets external vaults be read while the SparkPoint vault keeps its full, unchanged validation
(no regression, FR-010). Rejected: a bespoke reader per protocol (violates "registry-only" + Principle VII);
loosening the SparkPoint vault's own required set (would weaken the launch-vault read guarantees).

**Fail-closed per row**: a registry row whose bytecode is absent or lacks ERC-4626 `asset()`/`decimals()`
is marked "unreadable" and isolated — it must not poison other rows or a RECOMMEND turn (FR-012), the same
fail-closed discipline the fixed reader already applies to the single vault.

## D5 — Registry as a plain address-book field, mirroring 007's `swapFeeRecipient`

**Decision**: Add `readonly vaults?: VaultRegistryEntry[]` to the shared `AddressBook` (and a matching list
in the agent `config.py`), where `VaultRegistryEntry = {chainId, address, protocol, abiKind, asset,
assetDecimals, verified, label, apySource}`. This is a **plain data field, NOT a policy `TargetRef`** —
exactly the pattern 007 used when it added `swapFeeRecipient?: Address` as an optional address-book field
that is explicitly *not* in `TargetRefResolution` / the `satisfies Record<TargetRef, keyof AddressBook>`
map. Adding a display vault = one row.

**Rationale**: The `AddressBook` already cleanly separates policy `TargetRef`s (`vault → sparkpoint_vault`)
from plain infrastructure fields (007's `swapFeeRecipient`). Reusing that separation makes 010's
custody-neutrality **structural**: the registry lives in the non-policy half of the address book, so it is
mechanically impossible for a registry row to become a policy target. The registry `protocol` field is a
**display/data label** ("morpho" / "aave_v3" / "sparkpoint"), deliberately distinct from the policy
`Protocol` enum (`aave_v3` / `aerodrome` / `sparkpoint_vault`) in `enums.ts`, which stays byte-identical
(CI parity T098, FR-022). Rejected: putting external vaults in the policy allowlist/candidate set (violates
Guardrail IV.5 + FR-020); a separate DB table (over-engineered — the registry is small static config).

## D6 — Why advisory-only keeps the Constitution gate open (the load-bearing argument)

**Decision**: Treat the whitelist ("only Aave v3 + Aerodrome … impossible by construction") as a bound on
**EXECUTION with custodied funds** — what the deterministic policy engine and the vault can *reach* — not
on the AI's **information set**. 010 adds **zero** execution path into any non-whitelisted protocol; it lets
the AI *see*, *rank*, and *narrate* external vaults and nothing more. This is authored as a **GATE PASS with
a recorded scope note** in [plan.md](./plan.md), mirroring 007.

**Rationale**: Three independent grounds converge:

1. **Principle II already grants it.** The constitution explicitly lets the model "analyze / rank /
   propose"; advisory market data is precisely inputs to analysis/ranking. Disposition (signing, routing
   funds) is untouched — the candidate set, `Asset`/`Protocol` enums, and `(target,selector)` permissions
   are byte-identical (D2, D5).
2. **007's precedent.** 007 broadened an already-outside-policy user-signed surface's **token set** and
   passed as a GATE-PASS scope note, with an explicit FR-024 forbidding any policy-allowlist widening. 010
   is *weaker* than 007: it broadens a **read-only advisory information set**, touching no signable surface
   at all. Its **FR-020** mirrors FR-024 verbatim in intent.
3. **Guardrail IV.5 is about interaction, not information.** "Interaction with any other protocol MUST be
   impossible by construction" governs on-chain interaction. Displaying an APY *about* Morpho is not
   *interacting with* Morpho. 010 introduces no call, approval, or fund flow to any non-whitelisted
   protocol.

Every external figure is labeled "estimated / external / not a SparkPoint vault" and fails open to
"unavailable", so Constitution III + V are honored (the launch vault's own Aave-yield claim stays separate
and unchanged; no external vault is presented "under the banner of the launch vault"). No custody semantics
(N1–N5, pause-only killswitch, AI-disposition, non-upgradeable vault) are touched, so **no re-ratification
is required** (Governance) — an agent could not self-authorize that anyway (ObraHaus playbook 2.6), which is
exactly why 010 is scoped to never need it. The **execution/manage half is deferred to 011**, which will
run its own Constitution Check for any custody-touching surface.

## D7 — Read-only `/admin/vaults`, seam for 011's manage half

**Decision**: Add a **read-only** `/admin/vaults/page.tsx` (mounted via `AdminShell`, like `killswitch` /
`tvl` / `revenue`) listing every registered vault with live TVL/APY/state + source/verified badges and
**zero** management controls. The existing `killswitch` page (already read-only-reads the single vault's
`paused()`/`guardian()`) is left unchanged.

**Rationale**: Shipping visibility read-only first makes 010's custody-neutrality obvious and auditable, and
gives 011 a stable surface to attach deposit/withdraw/curate/pause controls to (011 US4's manage half ⇄
this page). Rejected: bundling management now — that is exactly the custody-touching execution 010 must not
introduce (it belongs behind 011's own gate).

## D8 — Extend `derive.ts` for N-vault DISPLAY without mislabeling

**Decision**: Extend the portfolio derivation's closed `'vault' | 'idle'` union to represent N vaults **for
display**, with external vaults explicitly marked external — never counted as a SparkPoint holding or a
signable position.

**Rationale**: The app must show the SparkPoint vault alongside external context. But the derivation feeds
portfolio/holdings semantics, so an external vault must be structurally distinguishable from the SparkPoint
position (source + `verified` + `abiKind`), or an external row could read as a user holding. Trust keys off
the address + `abiKind` + `verified`, not the label (defends the "USDC Vault" collision edge case).

## D9 — Chat parity reuses the feed + registry; external mentions are never signable

**Decision**: `agents/strategy_recommender.py` (+ chat narration) may reference/compare external vaults with
a source + recency citation, but the turn's only signable/policy-cleared candidate remains the whitelisted
SparkPoint (Aave) action. Agent-referenced external vaults are unverified external market data by default.

**Rationale**: The brief's "suggest better yield strategies" is delivered in chat, but Principle II forbids
an external mention from becoming a `ProposedAction`. Reusing the US1 feed + US2 registry makes parity
nearly free; the one hard invariant to test is that **0** external vaults are ever emitted as a
candidate/`ProposedAction` (FR-018).

## D10 — Testing focuses on the fail-open feed, the reader split, and the no-signability invariant

**Decision**: `pytest` the feed's source-priority + fail-open-to-unavailable + sanity-bounds + per-turn
cache; the generic-vs-SparkPoint reader selection (external vault reads with core only; SparkPoint vault
still validates the full set); and the **byte-identical-candidate-set** invariant across all feed outcomes.
`node:test`/Vitest for `resolveErc4626`/`useVaults`/N-vault `derive.ts`. Playwright for the read-only
`/admin/vaults` render (assert **no** management control), using `domcontentloaded` + a long hydration
budget (CPU-starved-box memory).

## Open verifications carried into implementation

- Morpho GraphQL query shape for Base-mainnet curated USDC vaults (net APY + TVL + fee fields) and the
  DeFiLlama pool-id mapping for the same vaults (fallback correctness). Gates Phase 1 external figures.
- The exact Base-mainnet external vault(s) to seed in the registry (operator input) — recommend one curated
  Morpho USDC vault + label/verified flag.
- Confirm on-chain (via `eth_getCode` / basescan) that any external row's address is a live ERC-4626 before
  marking it `verified: true`; unverified rows render with the "unverified external" marker (D4, FR-005-style).
- DEVELOPMENT.md entries: Morpho GraphQL endpoint, DeFiLlama fallback, feed cache TTL, time-box budget, and
  the `vaults[]` registry schema (no new secret — the feed is keyless).
