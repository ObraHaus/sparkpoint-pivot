# Research — 079 Rhea cross-chain (071 Phase C)

Sources read for this slice (no secret values were read; no live `dry=false` quote was made):

1. **Rhea cross-chain SDK** —
   <https://raw.githubusercontent.com/rhea-finance/rhea-sdk-docs/main/CrossChainDexSdk.md>
   - `SwapClient` quote/swap with `flow: "deposit" | "withdraw"`, `mcaAccountId`,
     `signerChain: "evm"`, optional `executionPreference` (`relayer` vs direct NEAR).
   - Withdraw can use a relayer business message or `nearMcaWithdrawTx` when recipient/NEAR
     conditions match. NEP-413 is **not** a transaction.
2. **Rhea contracts guide** — <https://guide.rhea.finance/developers/contracts>
   - `contract.main.burrow.near` (lending) and `multica.near` (MCA).
3. **Rhea step-by-step** —
   <https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/step-by-step-guide>
   - Same-chain users connect a NEAR wallet and sign supply/withdraw; different from this EVM
     origin 1Click rail.
4. **Rhea cross-chain litepaper** —
   <https://guide.rhea.finance/docs/rhea-finance-cross-chain-lending-litepaper>
   - MCA business messages and bridges.
5. **NEP-413** — <https://github.com/near/NEPs/blob/master/neps/nep-0413.md>
   - Off-chain authentication; not a Burrow/MCA transaction.
6. **Burrow SDK** — <https://github.com/burrowHQ/burrow-sdk-python>
   - Same-chain call args only; the signer is the NEAR account (078's rail).

In-repo facts (already verified by 071, reused unchanged):
- `specs/071-rhea-near-earn/research.md`: exact `customRecipientMsg` shapes
  (`{"w":[{"EVM":"…"}],"b":{"r":"BurrowSupply"}}` and
  `{"w":[…],"b":{"r":"BurrowRegisterAndSupply"},"s":["<sig no 0x>"]}`), MCA view
  `get_mca_by_wallet`, one-time fee `get_create_mca_fee_paged`, and the `dry=true` quote results.
- `services/agent/src/sparkpoint_agent/earn/rhea.py`: MCA lookup, fee, message builders.
- `services/agent/src/sparkpoint_agent/crosschain/{oneclick,routes}.json`: 1Click client and the
  `nep141:base-0x…omft.near` origin ids used to derive the ERC-20 contract.

## What was tried in-repo (no funds)

- Dry preview path already exists (071): `dry=true` quote with `customRecipientMsg`; no key needed.
- For a live commit, the key requirement is real: without `ONECLICK_API_KEY` presence the route is
  refused by design (server gate). The live path was exercised only against a mocked 1Click
  transport in tests (asserting `dry=true/false` and the exact body); no live quote was requested.
- The origin transfer plan is derived purely from the route config + the live quote's deposit
  address; no RPC read or wallet call is needed to build it.

## Exact external prerequisites (name + source)

1. **Funded origin wallet** — Base or Ethereum USDC + gas in the user's own wallet
   (<https://1click.chaindefuser.com> deposit address is created by the live quote).
2. **1Click/Rhea API credential** — `ONECLICK_API_KEY` in the secret store, value never committed.
   The Rhea SDK references a Boss-portal API key
   (<https://raw.githubusercontent.com/rhea-finance/rhea-sdk-docs/main/CrossChainDexSdk.md>).
3. **Owner decisions** — enable `EARN_LIVE_RHEA_XCHAIN` / `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` after a
   funded acceptance test; decide whether to persist Rhea deposit ownership in `crosschain_quotes`.

## Open questions

- Should the MCA first-deposit signature be cached per wallet? (071 research OQ-1; not required for
  the review slice.)
- Should a multi-instance deploy move the in-process deposit-ownership map to Postgres? (Follow-up.)
- Is the Rhea relayer withdraw path in scope for a later owner-approved slice? (Documented only.)
