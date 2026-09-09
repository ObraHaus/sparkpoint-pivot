# US6 session-key AA stack — Base Sepolia (84532) deployment + live ERC-7562 verification

**Feature 022 (US6 session-key automation). Deployed + verified 2026-07-24.** Path-A architecture:
all per-session state lives in `SparkPointAccount`'s own storage, so `validateUserOp` is
ERC-7562-compliant (the recordSpend-in-validation external-storage write that blocked US6 is gone).

## Deployed addresses (deployer/admin `0xA71e24359A6cb7A939aae2d62dD12b6256365c30`)

| Contract | Address |
|---|---|
| EntryPoint (v0.7 singleton) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| PolicyModule (stateless arming allowlist) | `0x55A210191420823F309c25220257D7666BA38134` |
| SessionKeyValidator (view-only parity mirror) | `0xc4F11ECB89C1A6c1655D46DD0fe22f2Ab604Aa99` |
| SparkPointAccount (implementation) | `0xAF387322A9C5d08fC95e86C6e642d4e054D966C2` |
| AccountFactory (CREATE2) | `0x251C9Cb0A30fCA6FEF2916Ca2C5679411DCedbdb` |
| Armed target: SparkPointVault | `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2` (deposit/redeem/withdraw) |
| Vault asset: test USDC (6dp) | `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f` |

Deploy: `forge script script/DeploySessionStack.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --private-key
$DEPLOYER_PRIVATE_KEY --broadcast --slow`. Addresses are CREATE2-deterministic
(salt `keccak256("sparkpoint-session-stack-v1")`).

## Live ERC-7562 verdict (SC-U6-A) — PASS, proven on-chain

A real mode-0x01 session-key UserOp was submitted to the **Alchemy Base-Sepolia bundler** (Rundler,
spec-compliant, EntryPoint v0.7) via `eth_sendUserOperation` and **accepted** — the exact submission
the old design could not get past. It was then bundled + executed on-chain **successfully**:

- Demo session account: `0x07754FEd9680872710D7E91195890435Ee4aaF59`
- Session key (scoped to vault deposit, 500/5000 USDC caps, 1-day expiry): `0xd9a07554bB203fa0C5B3e2a27a52EAEde7Fd1830`
- Action: `execute(vault, 0, deposit(1 USDC, account))` — signed by the session key, **no per-move user signature**
- userOpHash: `0xc21f3a6f2988ba4a682294c4731169a04a734c4ed2a1621f6ea25e2e3de29068`
- **on-chain tx: `0x1d1fad640ff9d9ef27ec79570e1e10367457b9c5cc0f698db8f638ead56d8f44`** (block 44564832, success, 557,882 gas)

Reproduce: `forge script script/VerifySessionBundler.s.sol --rpc-url $RPC --private-key $PK --broadcast
--slow` (owner setup), then POST the emitted `session-userop.json` to the bundler via
`eth_sendUserOperation` (see the feature-022 quickstart). The bundler's canonical ERC-7562 validation
tracer running clean over this op is the definitive evidence that Path A resolved the blocker.

## Live e2e of the WEB signer (feature 022, #107) — PASS, 2026-07-25

A second live run proved the **`apps/web` client-side session-signer specifically** (not the foundry
script): a fresh session key was granted (owner tx `0xbdb7297e…`), then a `execute(vault, 0, deposit(1
USDC, account))` UserOp was signed by the **web `sessionSigner`** (mode-0x01 / EIP-191 over viem's
EntryPoint-v0.7 `userOpHash`) and submitted to the Alchemy bundler:

- Session account: `0x07754FEd9680872710D7E91195890435Ee4aaF59` (reused; fresh grant, 1h expiry)
- web userOpHash: `0xde40754aed364e01d54369c06918fc13b5b3ad1d495548061521bceb8b38b3dc`
- **on-chain tx: `0xcde4cc48cf22ac880e3429b4eb05e7f08167086ee28708f2b4184ba4dd5f83b5`** (block 44592171,
  success, 354,738 gas) — a session-key deposit with **no per-move user signature**.

**Finding (fixed):** the first submission carried the client op's **null** v0.7 fields
(`factory`/`paymaster`) and the bundler rejected it with *"Invalid account signature"* — sending those
slots as JSON `null` makes the Rundler hash a different op than was signed. `execution/bundler.py` now
strips null fields before `eth_sendUserOperation`; the identical op then executed on-chain. Only a real
bundler exercises this seam (the unit tests + `userOpHash` byte-check against the on-chain EntryPoint
did not surface it).
