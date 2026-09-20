# Tasks — 051 Universal-wrapper deposit/withdraw rail

- [x] **T801** `VaultKind: "universal_wrapper"` + `useVault` support (asset decimals read separately,
      `depositToken = asset()`, `curatedVerified`, label from options).
- [x] **T802** `buildVaultOptions` universal wrappers + `verified`; deep-link resolution.
- [x] **T803** Confirm model: curated-provenance fail-closed deposit, labeled scan APY,
      withdraw-never-gated.
- [x] **T804** Vault page + amount screen merge the board's live wrappers (rail routing + `?vault=`).
- [x] **T805** Tests (options + model) + full web suite/typecheck/lint.
- [ ] **T806** Operator: promote + deploy web; verify the Steakhouse CTA routes and a real deposit
      signs (fork proof already green).
