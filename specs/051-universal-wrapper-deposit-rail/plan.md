# Plan 051 — Universal-wrapper deposit/withdraw rail

## Constitution check

- **N1:** no new asset path — the wrapper's own ERC-4626 `deposit`/`withdraw` (already audited code).
- **N2:** withdraw is untouched by provenance/curation gates; `maxRedeem` only.
- **III:** the APY shown for a wrapper is the STORED curator scan, labeled; unreadable ⇒ "—".
- **IV.5:** provenance fail-closed — the wrapper kind is only granted by the curated board record.
- **VII:** no new service, no contract change; the smallest kind + option plumbing that works. ✅

## Changes (web only)

| File | Change |
|---|---|
| `lib/chain/useVault.ts` | `VaultKind + "universal_wrapper"`; `isUniversalWrapper`; `isMorphoVenue` includes it; `depositToken = asset()` for it; `assetDecimals` read from `asset().decimals()`; label from options; new `curatedVerified` result. |
| `lib/chain/vaultOptions.ts` | `UniversalWrapperInput`; `buildVaultOptions({ universalWrappers })`; `VaultOption.verified`. |
| `lib/chain/vaultConfirmModel.ts` | `curatedVerified` in the view; `wrapperVerified = attested \|\| curatedVerified`; deposit safe requires it + asset match; `curatedNetApyBps` labeled APY. |
| `lib/chain/useVaultConfirm.tsx` | Passes `verified` through to `useVault`. |
| `app/(app)/vault/page.tsx` | Merges board live wrappers into options + `knownVaults` (rail routing). |
| `app/(app)/vault/_amount-screen.tsx` | Same merge; passes `verified` + the selected scan APY. |
| Tests | `vaultOptions.test.ts`, `vaultConfirmModel.test.ts` (+6 cases). |

## Verification

- `pnpm --filter @sparkpoint/web test` (741), `tsc --noEmit`, `typecheck:test`, `eslint`.
- Live: after deploy, the Steakhouse card CTA routes to the deposit screen; the fork proof
  (`UniversalWrapperV3Fork`) already establishes the on-chain leg.

## Rollback

Revert the PR — the deposit rail returns to "In-app deposit coming soon"; no contract or DB change.
