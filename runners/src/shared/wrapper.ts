/**
 * Feature 049 (v4.1.0 pivot) — the AI wrapper-admission runner's PURE core: candidate shape,
 * validation, deterministic CREATE2 salt, the V3 factory ABI and the deterministic admission
 * decision. Everything here is pure and unit-tested; the I/O lives in `../deployer.ts`.
 *
 * SCOPE: this runner holds the scoped AI key (`DEPLOYER_ROLE`). It can call exactly two factory
 * functions — `whitelistVault(child)` (admits a curated child; deployable only after the on-chain
 * cooldown) and `createVault(params)` (deploys a ready child). It can NOT unwhitelist, release,
 * set the cooldown, upgrade anything, pause, set recipients, or move funds; there is no code path
 * here for any of those, and the selector set is pinned by test.
 *
 * PROVENANCE RULE: the runner only deploys entries whose on-chain `by` is its own address.
 * Admin-added entries are the admin's to deploy — `decideAdmission` skips them.
 */

import { keccak256, toHex, type Address, type Hex } from "viem";

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** One curated, unwrapped child offered by the agent for AI admission (params are prefilled). */
export type WrapperCandidate = {
  childAddress: Address;
  feeBps: number;
  perUserCap: string;
  totalCap: string;
  vaultCap: string;
  name: string;
  symbol: string;
  label: string;
};

export type DeployerConfig = {
  chainId: number;
  rpcUrl: string;
  factoryAddress: Address;
  apiBaseUrl: string;
  s2sToken: string;
  reportOwner: string;
  pollSec: number;
  maxFeeBps: number;
  fetchTimeoutSec: number;
};

/** The factory's CreateVaultParams, in viem's struct shape for the tuple ABI input. */
export type CreateVaultParams = {
  child: Address;
  feeBps: number;
  perUserCap: bigint;
  totalCap: bigint;
  vaultCap: bigint;
  name: string;
  symbol: string;
  label: string;
  salt: Hex;
};

/** The on-chain admission state for one child (all three views are cheap, sync reads). */
export type AdmissionState = {
  /** `wrapperOf(child)`; the ZERO address when no wrapper exists. */
  wrapper: Address;
  /** `whitelistOf(child).by`; the ZERO address when no admission is pending. */
  whitelistedBy: Address;
  /** `isReady(child)` — true once an AI admission's cooldown has elapsed (or immediately for admin). */
  ready: boolean;
};

export type AdmissionDecision =
  | { action: "whitelist" }
  | { action: "deploy" }
  | { action: "wait" }
  | { action: "skip"; reason: string };

export const FACTORY_ABI = [
  {
    type: "function",
    name: "whitelistVault",
    stateMutability: "nonpayable",
    inputs: [{ name: "child", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "whitelistOf",
    stateMutability: "view",
    inputs: [{ name: "child", type: "address" }],
    outputs: [
      { name: "by", type: "address" },
      { name: "readyAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "isReady",
    stateMutability: "view",
    inputs: [{ name: "child", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "wrapperOf",
    stateMutability: "view",
    inputs: [{ name: "child", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "predictVaultAddress",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "child", type: "address" },
          { name: "feeBps", type: "uint16" },
          { name: "perUserCap", type: "uint256" },
          { name: "totalCap", type: "uint256" },
          { name: "vaultCap", type: "uint256" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "label", type: "string" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "function",
    name: "createVault",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "child", type: "address" },
          { name: "feeBps", type: "uint16" },
          { name: "perUserCap", type: "uint256" },
          { name: "totalCap", type: "uint256" },
          { name: "vaultCap", type: "uint256" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "label", type: "string" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      { name: "child", type: "address", indexed: true },
      { name: "proxy", type: "address", indexed: true },
      { name: "capRegistry", type: "address", indexed: false },
      { name: "deployer", type: "address", indexed: true },
      { name: "feeBps", type: "uint16", indexed: false },
      { name: "label", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultWhitelisted",
    inputs: [
      { name: "child", type: "address", indexed: true },
      { name: "by", type: "address", indexed: true },
      { name: "readyAt", type: "uint64", indexed: false },
    ],
  },
] as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT256_MAX = (1n << 256n) - 1n;

export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

/**
 * Deterministic CREATE2 salt for a child: a retried admission lands on the SAME wrapper address.
 * Domain-separated from the retired admin-request (UUID) salts so the two lanes can never collide.
 */
export function saltForChild(child: Address): Hex {
  return keccak256(toHex(`sparkpoint.wrapper.v3:${child.toLowerCase()}`));
}

export type CandidateCheck = { ok: true; args: CreateVaultParams } | { ok: false; reason: string };

/**
 * Validate a candidate locally BEFORE spending gas (and before hitting the chain), mirroring the
 * factory's own checks: a malformed candidate is reported as a failure with a reason, not attempted.
 */
export function prepareCandidate(
  candidate: WrapperCandidate,
  config: DeployerConfig,
): CandidateCheck {
  if (!isAddress(candidate.childAddress)) {
    return { ok: false, reason: "childAddress is not an address" };
  }
  if (
    !Number.isInteger(candidate.feeBps) ||
    candidate.feeBps < 0 ||
    candidate.feeBps > config.maxFeeBps
  ) {
    return { ok: false, reason: `feeBps ${candidate.feeBps} outside 0..${config.maxFeeBps}` };
  }
  if (!candidate.name || !candidate.symbol || !candidate.label) {
    return { ok: false, reason: "name/symbol/label must be non-empty" };
  }
  let perUserCap: bigint;
  let totalCap: bigint;
  let vaultCap: bigint;
  try {
    perUserCap = BigInt(candidate.perUserCap);
    totalCap = BigInt(candidate.totalCap);
    vaultCap = BigInt(candidate.vaultCap);
  } catch {
    return { ok: false, reason: "caps must be integer strings" };
  }
  for (const [name, value] of [
    ["perUserCap", perUserCap],
    ["totalCap", totalCap],
    ["vaultCap", vaultCap],
  ] as const) {
    if (value < 0n || value > UINT256_MAX) return { ok: false, reason: `${name} out of uint256` };
  }
  return {
    ok: true,
    args: {
      child: candidate.childAddress,
      feeBps: candidate.feeBps,
      perUserCap,
      totalCap,
      vaultCap,
      name: candidate.name,
      symbol: candidate.symbol,
      label: candidate.label,
      salt: saltForChild(candidate.childAddress),
    },
  };
}

/**
 * The provenance rule, deterministically: deploy only what the AI itself admitted.
 *   * a wrapper already exists        → skip (one wrapper per child, on-chain)
 *   * no admission pending            → whitelist (AI entry; deployable after the cooldown)
 *   * pending admission, `by` ≠ AI    → skip (an admin entry — the admin's to release/deploy)
 *   * pending AI admission, ready     → deploy
 *   * pending AI admission, cooling   → wait (a later tick re-checks)
 */
export function decideAdmission(state: AdmissionState, runner: Address): AdmissionDecision {
  if (state.wrapper !== ZERO_ADDRESS) {
    return { action: "skip", reason: "already wrapped (one wrapper per child)" };
  }
  if (state.whitelistedBy === ZERO_ADDRESS) return { action: "whitelist" };
  if (state.whitelistedBy.toLowerCase() !== runner.toLowerCase()) {
    return { action: "skip", reason: "admin entry — not the AI's to deploy" };
  }
  return state.ready ? { action: "deploy" } : { action: "wait" };
}
