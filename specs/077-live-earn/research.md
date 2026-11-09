# Research — 077 first live earn slice (Kamino → Morpho), verified 2026-11-08

All facts below come from **read-only** public calls: Kamino's public API
(`https://api.kamino.finance`), the Base public JSON-RPC (`https://mainnet.base.org`),
Morpho's public GraphQL API, and `@solana/web3.js` deserialization of the **unsigned**
transactions Kamino returns. No key, signature, secret or env value is printed. No transaction
was signed or sent. The only Solana/Base addresses used are the public probes from the task:
`J9EH8VmiXd58kuhhUCbED6Pm1dZU9fFQELhVE9UyMEKz` (Solana) and
`0xBddA41D11014FdD9a656386e29Af1a1349f94f13` (Base, unfunded).

## 1. Kamino — SOL *and* USDC are both depositable

`GET /kvaults/vaults` returned **195 vaults** today:

| deposit mint | vaults |
|---|---|
| USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 dp) | 111 |
| SOL `So11111111111111111111111111111111111111112` (9 dp) | 23 |

**A SOL deposit is possible.** The question in the task ("do not assume USDC required") is
settled: Kamino's own unsigned-tx endpoint builds a valid SOL deposit by wrapping native SOL in
the same transaction.

Curated vaults chosen for the slice:

| vault | name | deposit mint | share mint | fee (mgmt/perf) |
|---|---|---|---|---|
| `DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg` | SOL Balanced | SOL (9 dp) | `5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK` (9 dp) | 0 / 0 |
| `HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E` | Steakhouse USDC | USDC (6 dp) | `7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS` (6 dp) | 0 / 500 (5%) |

`GET /kvaults/vaults/{pubkey}/metrics` for SOL Balanced (2026-11-08):
`apy=0.039689…`, `tokensPerShare=1.0563585818443082452`, `sharePrice=91.659649…`,
`tokenPrice=86.76944687`, `tokensInvestedUsd=2226120.13`, 351 holders. `tokensPerShare` is the
underlying per share, so an estimate is `shares ≈ amount / tokensPerShare` (and the inverse for a
withdraw). It is an **estimate**, not a quote.

## 2. Kamino unsigned transaction API (no key, no signing)

The public transactions API is exactly the primitive 077 needs:

| endpoint | body | returns |
|---|---|---|
| `POST /ktx/kvault/deposit` | `{wallet, kvault, amount}` (`amount` = underlying, decimal) | `{transaction: base64}` |
| `POST /ktx/kvault/withdraw` | `{wallet, kvault, amount}` (`amount` = **shares**, decimal) | `{transaction: base64}` |
| `POST /ktx/kvault/deposit-instructions` / `withdraw-instructions` | same | structured instructions + lookup tables |
| `GET /kvaults/users/{wallet}/positions` | — | `[{vaultAddress, stakedShares, unstakedShares, totalShares}]` |

Both returned transactions are **versioned (v0) transactions, one signature, unsigned**. Decoded
with `@solana/web3.js`:

**Deposit 0.01 SOL** (665 bytes, 1 ALT `2mQQUa9WAnzsJWZoBSUSfiVsemYQGxrTfgFeEPLcuMTi`):

| # | program | instruction |
|---|---|---|
| 0 | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | create idempotent share ATA |
| 1 | `11111111111111111111111111111111` | system transfer `10,000,000` lamports (0.01 SOL) → wSOL ATA |
| 2 | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `syncNative` (17) |
| 3 | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | create idempotent wSOL ATA |
| 4 | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` | kVault **deposit** (disc `f223c68952e1f2b6` + u64 amount) |
| 5–6 | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` | optional farm stake bookkeeping |

**Withdraw 0.01 shares** (498 bytes): create SOL ATA → kVault **withdraw** (disc
`1383709baadc2239` + u64 shares) → `closeAccount` (9) on the wSOL ATA (unwraps to native SOL).

So the transaction the user signs contains **no swap and no Kamino fee instruction**, only the
vault's configured mgmt/performance fee (0/0 on SOL Balanced) plus Solana network fees and
associated-token-account rent. That is the honest review we show.

`getFeeForMessage` returned `null` for these v0 messages (ALTs unresolved at the public RPC), so
the review computes the fee itself: `5,000 lamports × signatures` + any `ComputeBudget`
priority fee (none in either transaction today). ATA creation costs the rent-exempt minimum
(~`0.00203928 SOL` per new token account) — disclosed separately, never called a Kamino fee.

## 3. Morpho on Base — plain ERC-4626

Chosen vault (verified by `eth_call` and Morpho GraphQL):

| field | value |
|---|---|
| vault | `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` |
| name / symbol | Gauntlet USDC Prime / `gtUSDCp` |
| chain | Base 8453 (listed) |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 dp |
| share decimals | **18** (not the asset's 6 — never format shares with 6) |
| totalAssets / net APY | `401,103,632.004356` (raw) / ~5.00% (Morpho API) |
| `previewDeposit(1_000_000)` | `893451082814255214` shares (≈0.8934) |
| probe `balanceOf` / `allowance` | `0` / `0` (unfunded, as expected) |

Deposit is `approve(asset, vault, assets)` (only when allowance is short) then
`deposit(assets, account)`. Withdraw is `redeem(shares, account, account)`. Both are standard
ERC-4626 and are exactly the selectors already in `sparkPointVaultAbi`, so the existing
`useExecuteVaultTx` orchestration can be reused (the user is the only signer; SparkPoint holds no
key and submits nothing).

The Base probe is unfunded, so `eth_estimateGas`/simulation is **expected to fail with
insufficient funds / a balance revert** — that is the correct simulated result, not a bug.

## 4. What is *not* built / not claimed

- No signing by the agent, no submission by the agent, no custody, no approve or transfer from the
  task environment.
- No 1Click Earn or Aurora Intents Connect path is changed. This is the **direct** rail only:
  Kamino via the connected Solana wallet, Morpho via the connected EVM wallet on Base.
- Position values are estimates from Kamino `tokensPerShare` / on-chain `convertToAssets`; they are
  not PnL and not a guaranteed redemption amount.
- Only the two curated vaults are buildable server-side (allowlist), so the BFF cannot be used to
  build an arbitrary Kamino transaction.
- Live execution needs an owner-approved funded test wallet; until then everything is flagged off
  and the simulation scripts are labelled SIMULATED.

## Sources

- Kamino `GET /kvaults/vaults`, `GET /kvaults/vaults/DcCRSd…/metrics`,
  `GET /kvaults/users/{wallet}/positions`,
  `POST /ktx/kvault/deposit`, `POST /ktx/kvault/withdraw`, 2026-11-08.
- Kamino docs: `https://kamino.com/docs/llms.txt` (Earn Vault deposit/withdraw endpoints,
  `KaminoVault.depositIxs/withdrawIxs`, program ids).
- Base JSON-RPC `eth_chainId`, `eth_call` (`asset()`, `decimals()`, `balanceOf`, `allowance`,
  `previewDeposit`), 2026-11-08.
- Morpho GraphQL `vaults(where:{address_in:[…]})`, 2026-11-08.
- Repo: specs/069, 070, 071, 072 research; `apps/web/src/lib/chain/useExecuteVaultTx.ts`.
