/**
 * Base Sepolia (chainId 84532) address book.
 *
 * Protocol addresses are the pinned values verified on-chain 2026-07-11 (CTX):
 *   - EntryPoint v0.7: identical singleton to Base mainnet.
 *   - Aave v3 Pool: 0x8bAB…aE27.
 *   - reserveUsdc 0xba50…4D5f: the Aave-market test USDC — the ONLY USDC the
 *     Sepolia pool accepts, and therefore the token the vault's `asset()` must be.
 *   - aUSDC: 0x10F1…0ACC.
 *
 * Divergences from Base mainnet (deliberate):
 *   - `usdc` == `reserveUsdc` (the Aave test USDC). On Base Sepolia the SYSTEM's
 *     USDC is the Aave-reserve token; the canonical Circle Base-Sepolia USDC is
 *     NOT used by any path here (vault deposit → Aave supply is the only flow),
 *     so pinning the Aave-reserve token as `usdc` keeps the deposit path correct.
 *   - Aerodrome has NO Base-Sepolia deployment ⇒ `aerodromeRouter`/`aerodromeFactory`
 *     left `undefined`. Swaps are fork-only; this matches the `undeployed:true`
 *     Aerodrome entry that policy/constants.ts filters out (fail-closed).
 *   - `wrappedTokenGateway` left `undefined` (native-ETH path deferred; TODO_VERIFY).
 */

import { CHAIN_ID } from "../policy/index";
import type { AddressBook } from "./types";

export const baseSepolia: AddressBook = {
  chainId: CHAIN_ID.baseSepolia,
  network: "baseSepolia",

  // ── ERC-4337 (identical singleton to Base mainnet) ──
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",

  // ── Aave v3 (Base Sepolia market) ──
  aavePool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  aUsdc: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
  reserveUsdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f", // the ONLY USDC the Sepolia pool accepts
  wrappedTokenGateway: undefined, // TODO_VERIFY: native-ETH gateway not pinned on Base Sepolia (deferred)

  // ── Aerodrome — NO Base-Sepolia deployment (undeployed; swaps are fork-only) ──
  aerodromeRouter: undefined,
  aerodromeFactory: undefined,

  // ── Uniswap V3 (Base Sepolia) — verified on-chain (eth_getCode non-empty), a live USDC/WETH pool
  // exists. Powers the manual, user-signed swap page (non-custodial; not a policy target). ──
  uniswapV3SwapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  uniswapV3QuoterV2: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
  uniswapV3Factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",

  // ── ERC-20 tokens ──
  usdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f", // == reserveUsdc: system USDC on Sepolia is the Aave test token
  weth: "0x4200000000000000000000000000000000000006", // OP-stack WETH predeploy (same on Base Sepolia)
  usdcFaucet: "0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc", // Aave-market faucet: mint(token,to,amount), per-addr timelock

  // ── SparkPoint contracts — filled by deploy (undefined ⇒ fail-closed) ──
  // US1 core deployed to Base Sepolia 2026-07-14 via script/DeploySepolia.s.sol
  // (guardian/governance = the OZ TimelockController 0x0A21…d720, minDelay 60s testnet;
  // custody wiring verified on-chain: HWM 1e18, perfFee 1000/cap 2000, mgmt/entry/exit 0).
  // ERC-4337 session-key stack (US6, feature 022) DEPLOYED to Base Sepolia 2026-07-24 via
  // script/DeploySessionStack.s.sol — Path A (account-owned session storage); proven live (a
  // mode-0x01 UserOp passed the Alchemy bundler ERC-7562 tracer + executed on-chain, tx 0x1d1fad64).
  // See contracts/deployments/84532/session-stack.md.
  sparkPointAccountImpl: "0xAF387322A9C5d08fC95e86C6e642d4e054D966C2",
  accountFactory: "0x251C9Cb0A30fCA6FEF2916Ca2C5679411DCedbdb",
  sessionKeyValidator: "0xc4F11ECB89C1A6c1655D46DD0fe22f2Ab604Aa99",
  policyModule: "0x55A210191420823F309c25220257D7666BA38134",
  vault: "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2",
  capRegistry: "0x4538B536b1da5940deC8e15048Ce07a053699B04",
  // ── INERT on this chain (024/T083, verified on-chain 2026-07-31) ──────────────────────────────
  // Deployed (456 bytes of code) but NOT WIRED TO ANYTHING. The live `SparkPointVault`
  // 0x15D269B1…47f2 exposes `guardian` / `pauser` / `paused` / `pauseDeposits` / `unpauseDeposits`
  // and has **no `killSwitch()` selector at all**, and nothing in `apps/web` or `services/agent`
  // reads this address (only the ABI is exported). Kept for the deployment record rather than
  // deleted — but it MUST NOT be presented as active safety machinery anywhere in the UI or the
  // Trust Center: the live pause path is the VAULT's own, not this standalone contract. The same
  // applies to `AaveV3Adapter` in `contracts/deployments/84532/addresses.json`.
  killSwitch: "0x39C38c86611FF3679802D5341E830c83DB7F4537",
  // ── Guardian control cutover to a 2-of-3 Safe (2026-07-24) ──
  // The vault's guardian() is the OZ TimelockController 0x0A21…d720 (unchanged). Its
  // PROPOSER/EXECUTOR/CANCELLER + DEFAULT_ADMIN roles were transferred to this dedicated 2-of-3
  // Gnosis Safe and the deployer FULLY RENOUNCED — so no single key can pause/unpause/setFee/setCaps
  // anymore; only 2-of-3 of the guardian signers can (§6.2 multisig kill-switch, live). Proven on-chain
  // by a pause→unpause round-trip via the Safe before renounce. Owners are the dedicated guardian
  // signers (testnet keys in .claude/testnet-wallets.txt); SEPARATE from the fee-treasury Safe.
  governanceSafe: "0x1265f0ffFF933162719E2261E5b1242863543964",

  // ── Feature 011 wrapper-vault factory (deployed 2026-07-22 via DeployMorphoWrapperFactory) ──
  // The factory address is REQUIRED for wrapper provenance: useVault reads factory.isSparkPointVault
  // for a `morpho_wrapper`, and without it the read is disabled ⇒ every wrapper deposit fail-closes to
  // "Unverified vault". `sparkPointWrappers` is a display list for the picker (attested on-chain live).
  sparkPointVaultFactory: "0x2774D4b0Af206b8F489BF1db9d8FAFbB17D36D8b",
  sparkPointWrappers: [
    {
      // ── RETIRED 2026-07-30 (feature 024) — DEPOSITS OFF, WITHDRAW UNTOUCHED (N2). ──
      // This wrapper is immutably bound to `0x7f37…8420`, which is NOT a real Morpho vault: it is the
      // test-tree `MockMorphoVault` (contracts/test/mocks/Mocks.sol:283-350). That mock's simulation
      // hooks — simulateYield / simulateLoss / lendOut / setAvailableLiquidity / setMaxReturnsZero —
      // are all plain `external` with NO access control, so ANY anonymous caller on Base Sepolia can
      // move the wrapper's share price or drain its withdrawable liquidity. It must never be a
      // deposit target. The wrapper's `morphoVault` is a constructor immutable, so this cannot be
      // fixed by re-pointing it — only by retiring the wrapper.
      //
      // We keep the row (rather than deleting it) precisely so existing testnet holders keep a
      // first-class exit: the picker still resolves it, /portfolio still shows the position, and
      // withdraw/redeem is never gated. Real Morpho on 84532 replaces it in feature 024 Phase 3
      // (Morpho Blue + VaultV2Factory 0xE3a2CEbc…2ea0 are both live on Base Sepolia).
      address: "0xff0a43FA397a90c1277C96A783e1171e1efbE9BB",
      label: "SparkPoint Morpho USDC",
      symbol: "spMORPHO",
      morphoVault: "0x7f377fe96DaD2eEa494F0fb095233EF4aB438420",
      retired: true,
      retiredReason:
        "Testnet demo only — its underlying is a mock with no access control. Withdrawals stay open; deposits are closed.",
    },
  ],

  // ── Feature 024 Phase 3: a REAL Morpho Vault V2, broadcast 2026-07-30 ──────────────────────────
  // Morpho's OWN audited Vault V2, created by Morpho's `VaultV2Factory` and configured by us — the
  // organising rule of constitution v3.0.0 ("stop writing custody-critical Solidity; configure
  // Morpho's instead"). This REPLACES the retired `SparkPointMorphoVault` demo above, whose
  // underlying was a mock. Verified live after the handover tx 0x5f44f1af…58fd:
  //   isVaultV2 true · owner + curator + sentinel = the 2-of-3 Safe 0xCB13…578f
  //   setReceiveSharesGate / setSendSharesGate / setReceiveAssetsGate PERMANENTLY abdicated (N2)
  //   3-day timelocks on all 7 curator selectors · dead deposit = 1e18 shares to 0xdead (1.000000 USDC)
  //   native performanceFee() == managementFee() == 0
  //
  // NOTE THE ASSET. This vault's `asset()` is CIRCLE's USDC `0x036CbD53…`, NOT the `usdc` field
  // above (Aave's test token `0xba50Cd2A…`). Both report symbol()=="USDC" at 6 dp on this chain and
  // are NOT interchangeable — Morpho's markets use Circle's. This is why `asset` is a required field
  // on the entry rather than inherited from the book.
  morphoVaultV2Factory: "0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0",
  morphoFeeWrappers: [
    {
      address: "0x756C41dD33481620EbCB0357F759d31c9eE72170",
      label: "SparkPoint USDC Yield",
      symbol: "spUSDCv2",
      adapter: "0x4C4dCd2e2Bb985a606C1e7d4822bB330637D8E24",
      marketId: "0x01351cf859346bbae655f1c9da71ba0e9ad201dd79a276c28f34e574386b0bfb",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      assetDecimals: 6,
      // 18, not 6 — the V2 applies a decimals offset (`virtualShares() == 1e12`). Scaling a USDC
      // amount with this number instead of `assetDecimals` is a 1e12 error.
      shareDecimals: 18,
    },
  ],

  // ── Premium / SRK (feature 012) — Base-Sepolia only ──
  // `srk` is filled by script/DeploySRK.s.sol at deploy time; undefined ⇒ the pay surface shows an
  // honest "SRK unavailable on this network" state rather than a fabricated value.
  srk: "0x2dF90304126560F01Dd6EafB508B69c033dFeD52",
  // ── Fee treasury Safe (feature 014, 2-of-3, deployed 2026-07-22: deployer + 0x867E + 0x122D) ──
  // The dedicated multisig that receives all protocol fees. The vault's on-chain feeRecipient() was
  // re-pointed here via the Timelock, so the perf fee AND the Base-Sepolia swap fee (which falls back
  // to feeRecipient()) both land on the Safe. SRK Premium payments are disclosed to the same Safe.
  feeTreasury: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",
  premiumTreasury: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",
};
