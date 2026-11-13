# Quickstart — verifying 043 on a real chain

Green tests prove the code runs, not that the product is true. This is the pass that proves the
product. It runs against **Robinhood testnet 46630**, where the collection is already live.

## What already exists (no setup needed)

| | |
|---|---|
| `SparkyBroker` | `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2` — 3 minted, #1 activated |
| SRK | `0x4538B536b1da5940deC8e15048Ce07a053699B04` |
| `SrkFaucet` | `0x39C38c86611FF3679802D5341E830c83DB7F4537` — 5,000 SRK / 24h |
| RPC | `https://rpc.testnet.chain.robinhood.com`, or eRPC `/core/evm/46630?secret=…` |
| Wallets | deployer `0xA71e…5c30` (NFT owner), test user `0x32Ed…e8b5` — both funded, keys in `.env` |

Gas is cheap here (0.02 gwei) and both wallets are funded. **Do not ask for testnet gas without
probing `eth_getBalance` first** — it was assumed to be a blocker for phases 1 and 2 and was not.

## The one that matters — Premium dies with the sale (US1)

Runnable the moment `broker_gate.py` exists, before any new contract is deployed, because #1 is
already activated and held by the test user.

```bash
R=https://rpc.testnet.chain.robinhood.com
N=0x15D269B1D4fb3581E5a47482A70215e63Ed547f2
HOLDER=0x32Ed4400C5BBB394712c482F1207886d8C22e8b5

cast call $N "isActivated(uint256)(bool)" 1 --rpc-url $R          # expect true
cast call $N "ownerOf(uint256)(address)"  1 --rpc-url $R          # expect $HOLDER
```

1. Resolve the holder's tier → **premium**, source **broker**.
2. Transfer #1 away, signed by the holder:
   `cast send $N "safeTransferFrom(address,address,uint256)" $HOLDER $OTHER 1 --private-key $TEST_USER_PRIVATE_KEY`
3. `cast call $N "isActivated(uint256)(bool)" 1` → **false** (the transfer cleared it).
4. Wait out the 60s cache. Resolve the tier again → **free**.
5. `SELECT * FROM wallet_tier WHERE address = lower($HOLDER)` → **no broker-sourced row exists.**
   Step 5 is the point of the whole exercise: step 4 can pass while the bug is still present if the
   answer was written down somewhere.

Then transfer #1 back and re-activate it, so the environment is left as found.

## Activation is atomic (US2)

After the registry is deployed and `setActivator` points at it:

```bash
REG=<registry>
cast call  $REG "price()(uint256)" --rpc-url $R
cast send  $SRK "approve(address,uint256)" $REG <price> --private-key $K
cast send  $REG "activate(uint256)" 3      --private-key $K
```

Expect: SRK balance down by `price`, the dead address up by `price`, `isActivated(3)` true, and
`balanceOf(REG)` **zero** for both SRK and brokers.

Then prove each failure changes nothing — check the SRK balance before and after each:

| Attempt | Expect |
|---|---|
| `activate(3)` again | revert, no SRK moves |
| `activate` a token you do not own | revert, no SRK moves |
| `activate` with allowance below `price` | revert, no SRK moves |
| `activate` with balance below `price` | revert, no SRK moves |

There must be **no** sequence that leaves SRK spent and the broker unactivated.

## Mint (US3)

After `setMinter`: mint from an eligible wallet, confirm the token arrives **unactivated**, then
confirm an ineligible wallet and an over-allocation attempt both revert without charging.

## The visible half

`<internal-host>/api/metadata/<id>` and `/og/<id>.png` — an activated broker serves
`<id>-a.png` with the gold frame; an unactivated one serves `<id>.png`.

⚠️ **There is deliberately no `Activated` date attribute on this chain.** `activatedAt` is a block
number and Robinhood Chain's `block.number` is not addressable as an RPC block height, so the date is
omitted rather than published wrong. Its absence is correct. A date appearing here is a regression.

## The four screens

Check all four source combinations on `/premium` — subscription only, broker only, both, neither —
and confirm the page names which one is paying and what ends it.

## Leave it as you found it

- Both roles back to their intended state (the sale and registry addresses, not an EOA).
- The environment's activation state restored.
- Every address, transaction and role change recorded in `DEPLOYMENT.md`, and the `setActivator`
  call noted with the research-R1 caveat: **re-pointing `activator` at a different registry splits
  the activation record**, and the new one must read through to the old.
