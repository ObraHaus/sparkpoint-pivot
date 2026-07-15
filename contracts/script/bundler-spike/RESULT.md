# ITEM 8 — Bundler spike (R10 / OQ-2) — RESULT

**Status: SUCCESS.** One ERC-4337 **v0.7** UserOp was pushed through a **real bundler
(Pimlico Alto)** against a **local Anvil fork** and landed with `success: true`.
Spike only — no production wiring, and **nothing was broadcast to any real network**
(the executor tx went to the in-memory Anvil fork on `127.0.0.1`).

## Result of the run

```
computed userOpHash        : 0x6a1db29425171c4b07e90940f05712c423717aaf2f128b9fef6ccc5d51c2be17
bundler-accepted userOpHash: 0x6a1db29425171c4b07e90940f05712c423717aaf2f128b9fef6ccc5d51c2be17   (identical)
receipt.success            : true
receipt.sender             : 0xDcec0E6f2253cB1bceC3D05Bf08C27166D0ce1B0  (fresh SparkPointAccount)
receipt.actualGasUsed      : 0x8fbc8  (588744 gas)
receipt.receipt.txHash     : 0x4f74a551e84b6fea444ae6d63387f9988612d3cac64404aaaf4f3900ab313976
bundler                    : Alto (@pimlico/alto 0.0.20), --chain-type op-stack, --safe-mode false
entryPoint                 : 0x0000000071727De22E5E9d8BAf0edAc6f37da032  (v0.7 singleton, present on fork)
```

The bundler returned the *same* hash our client computed on-chain via
`EntryPoint.getUserOpHash(...)`, then bundled and submitted `handleOps`, and the op executed.

## The full path this exercised (what makes it different from the existing test)

`test/account/integration/SessionDepositFork.t.sol` calls `entryPoint.handleOps(...)`
**directly** inside forge. That proves the *contract* path but skips the off-chain
component that Phase-3 actually depends on. This spike drives the **real submission
path** end-to-end:

```
client  --eth_sendUserOperation-->  Alto mempool
Alto    --simulateValidation (deployed EntryPointSimulations v7)-->  passes
Alto executor  --signs & submits handleOps-->  EntryPoint.handleOps
EntryPoint  -->  account.validateUserOp  (custom `mode(0x00)||r||s||v` owner sig ACCEPTED)
EntryPoint  -->  account.execute(owner, 0, "")   (no-op)   -->  success
client  --eth_getUserOperationReceipt-->  {success: true, ...}
```

Verified from Alto's log: it received the **unpacked v0.7** op (`factory/paymaster` split,
`callData` selector `0xb61d27f6` = `execute(address,uint256,bytes)`, signature leading byte
`0x00` = `MODE_OWNER`), deployed its own EntryPointSimulations helper, and logged
`submitted bundle transaction`.

## Environment notes (important)

- The fork (`SIM_FORK_RPC_URL`) resolved to **chainId 8453 (Base mainnet lineage)**, forked
  locally into Anvil. This is fine for the spike: the v0.7 EntryPoint singleton is the *same
  canonical address* on Base mainnet and Base Sepolia, so the 4337 path is identical. The
  no-op UserOp does **not** touch the live vault (which lives on Base Sepolia / 84532), so the
  spike is independent of which chain state the fork carries.
- **No mainnet broadcast.** `anvil --fork-url` creates a fresh in-memory chain; all writes
  (deploys, the bundle tx) stayed local. The shared `spark-anvil` node is not mutated.
- Anvil's stdout echoes the secret fork URL, so the runner redirects it to a log it never
  prints; Alto only ever sees the local `http://127.0.0.1:8545` RPC. The Alto log was checked
  to contain zero secret-URL hits.

## Alto vs. the documented Alchemy fallback

- **Used: Alto** (`@pimlico/alto`), installable from npm in this environment
  (`npm i -g @pimlico/alto`). This is the preferred path: a self-hosted bundler that runs
  **against the local fork**, so the UserOp can target fork-only / freshly-deployed infra.
- **Fallback (documented, not exercised): the Alchemy Base-Sepolia bundler.** An external
  hosted bundler only sees **real Base Sepolia state**, not our local fork — so it cannot
  bundle an op against fork-deployed contracts, and using it would submit to the public
  testnet. For a local-fork spike, self-hosted Alto is strictly better; the hosted bundler
  is the fallback only if Alto were un-installable.

## Reproduce

```bash
export PATH="$HOME/.foundry/bin:$PATH"
npm i -g @pimlico/alto            # or set ALTO_BIN to a local install
bash contracts/script/bundler-spike/run-spike.sh
```

Files:
- `BundlerSpikeDeploy.s.sol` — deploys the account stack + one account + gas deposit on the fork.
- `submit-userop.sh` — builds/signs (`cast`), submits + polls the receipt (`curl`/`jq`). No JS deps.
- `run-spike.sh` — orchestrates Anvil fork → forge deploy → Alto → submit, with cleanup.

## What it de-risks for Phase-3 AA

1. **The custom signature scheme is bundler-compatible.** A general-purpose bundler accepted
   and validated our non-standard `mode-byte || ECDSA` signature with **no bundler changes** —
   the account's `validateUserOp` is all that's needed. (Owner mode `0x00` proven here;
   session mode `0x01` runs the same submission path, only swapping the validator.)
2. **v0.7 unpacked-op plumbing works.** `eth_sendUserOperation` / `eth_getUserOperationReceipt`
   round-trip, `getUserOpHash` parity between our client and the bundler, and the
   packed↔unpacked field mapping (`accountGasLimits` / `gasFees`) are all confirmed.
3. **A local-fork bundler harness exists.** Phase-3 can now iterate on session-key UserOps,
   gas estimation, and paymaster flows against a self-hosted Alto on a fork before ever
   touching a public testnet — the exact harness this script provides.
4. **op-stack gas model is handled.** Alto ran with `--chain-type op-stack` and correctly
   priced/relayed the bundle (the L1-data-fee component is why `preVerificationGas` is padded).

Open follow-ups (not part of this spike): session-key (mode `0x01`) op via the bundler; a
`initCode`/`factory` first-op that deploys the account counterfactually in the same UserOp;
`eth_estimateUserOperationGas` instead of fixed gas fields.
