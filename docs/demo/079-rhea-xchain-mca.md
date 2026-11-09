# Demo note — 079 cross-chain Rhea (071 Phase C)

**This is 071's cross-chain rail** (EVM USDC → Rhea/Burrow on NEAR via 1Click + MCA). It is **not**
078's same-chain NEAR → Burrow flow.

## What to show (with flags off — the default)

1. Sparky: "Deposit 100 USDC into Rhea" → the existing **dry** Rhea preview (no change).
2. With `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN=true` set for a local build, `/vault`'s Rhea row and the
   Rhea earn card both link to **`/vault/rhea-xchain`**.
3. `/vault/rhea-xchain`:
   - the server gate shows `server flag off · 1Click key absent · live commit disabled` until both
     are enabled;
   - **Dry review (dry=true)** shows origin chain/asset/amount, refund address, MCA/recipient
     message, one-time MCA fee, routing fee, net supplied and supply APY;
   - the withdraw card states `NEP-413 is a transaction: no`, `custodian: none`, and lists the Rhea
     app link-out plus the documented SDK relayer/`nearMcaWithdrawTx` paths.

## What is deliberately NOT done

- No live quote (`dry=false`) is made.
- No signature is produced and nothing is sent/broadcast.
- The `EARN_LIVE_RHEA_XCHAIN` flag and the 1Click key are **not** enabled or configured here.

## Funded acceptance (owner)

Set `EARN_LIVE_RHEA_XCHAIN=true` and a real `ONECLICK_API_KEY` (secret store only), fund a Base
wallet with USDC + gas, then:

1. Dry review → **Prepare live commit (dry=false)**.
2. First deposit only: **Sign message** (off-chain EVM `personal_sign`).
3. Review the 1Click deposit address and the **unsigned** `transfer(address,uint256)` plan.
4. Tick the acknowledgement and confirm from the wallet. The agent never signs or submits.

Sources: `specs/079-rhea-xchain-mca/research.md` and
`https://raw.githubusercontent.com/rhea-finance/rhea-sdk-docs/main/CrossChainDexSdk.md`.
