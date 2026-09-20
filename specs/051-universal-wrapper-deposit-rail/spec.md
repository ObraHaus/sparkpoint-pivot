# Spec 051 — Universal-wrapper deposit/withdraw rail (web)

**Status:** approved by operator 2026-09-20 ("build the app side wiring") · **Owner:** build ·
**Depends on:** 049 (V3 fleet), 050 (live-only board). **Contracts: none — the wrapper is already a
complete ERC-4626** (proven by `contracts/test/fork/UniversalWrapperV3Fork.t.sol`).

## Why

The V3 `SparkPointUniversalVault` (e.g. Steakhouse USDG `0xd43F…7cfE`) is deployed and functional,
but the web deposit/withdraw flow only knows `aave_launch` / `morpho_wrapper` / `morpho_fee_wrapper`
and resolves vaults from the **static** address book. Dynamically-deployed wrappers can never appear
there, so the board's CTA said "wrapper not deployed yet" instead of routing into a working vault.

## What

1. **New `VaultKind: "universal_wrapper"`** threaded through options → `useVault` → confirm model.
2. **Curated provenance is the trust root.** V3 has no `isSparkPointVault`; the agent's curated
   `wrapped` + `wrapperAddress` record is the attestation. `buildVaultOptions` marks board-derived
   options `verified: true`; `depositSignable` requires `curatedVerified && asset == chain stable`.
   A `universal_wrapper` without it renders "Unverified vault" and fails closed.
3. **Separate decimals.** The universal wrapper reads 9 share decimals over a 6-dp asset (offset
   1e3), so `assetDecimals` is read from `asset().decimals()` (as already done for Vault V2);
   `shareDecimals` stays the wrapper's own `decimals()`.
4. **Deposit token = the vault's `asset()`** (USDG on 4663), never the chain book's guess.
5. **Net APY**: the stored curator-scan figure is shown LABELED ("3.62% (curator scan)"); absent ⇒
   "—". The live Aave gross rate never frames a wrapper.
6. **Options merge**: the vault page and the amount screen merge the board's live wrappers into
   options + `knownVaults`, so `depositRail` routes `?vault=<wrapper>` into the existing deposit
   flow, and withdraw uses `maxRedeem` (OZ rounds down 1 wei — the fork proof pins this).

## Non-negotiable

- Withdraw is never gated on provenance/curation (N2) — an unverified wrapper's holder can always
  exit, bounded only by liquidity.
- No fabricated figures: unreadable ⇒ "—"; the scan figure is labeled as stored.
- Fail-closed: an option that did not come from the curated board never gets the wrapper kind.

## Acceptance

- A board-wrapped vault's card CTA is "Deposit via SparkPoint wrapper" and routes to
  `/vault/deposit?vault=<wrapper>`; the amount screen resolves it, shows the labeled scan APY, and
  the confirm gate signs `deposit(assets, receiver)` against the real wrapper.
- Unverified/incorrect-asset wrappers are blocked with honest labels.
- Tests: `vaultOptions` (universal options + verified), `vaultConfirmModel` (signable/blocked,
  labeled APY, withdraw-never-gated). Full web suite green; both changelogs updated.
