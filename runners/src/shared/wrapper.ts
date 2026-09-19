/**
 * Feature 049 — the wrapper-deploy runner's PURE core: job shape, validation, salt derivation and
 * the minimal factory ABI. Everything here is deterministic and unit-tested; the I/O lives in
 * `../deployer.ts`.
 *
 * SCOPE: this runner holds the SCOPED deploy-only hot key. It can call exactly one privileged
 * function — `createVault` on the factory — for children already on the curated on-chain allowlist,
 * with fee ≤ cap and caps within bounds (all re-enforced in Solidity). It can NOT upgrade anything,
 * change the allowlist, pause, set recipients, or move funds; there is no code path here for any of
 * those, and `wrapper-abi.ts`-style selectors are pinned by test.
 */

import { keccak256, toHex, type Address, type Hex } from "viem";

export type WrapperJob = {
  id: string;
  chainId: number;
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

export const FACTORY_ABI = [
  {
    type: "function",
    name: "isAllowlisted",
    stateMutability: "view",
    inputs: [{ name: "child", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
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
] as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UINT256_MAX = (1n << 256n) - 1n;

export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

/** Deterministic CREATE2 salt for a request id: a retried deploy lands on the SAME address. */
export function saltForJob(id: string): Hex {
  return keccak256(toHex(id));
}

export type JobCheck = { ok: true; args: CreateVaultParams } | { ok: false; reason: string };

/**
 * Validate a job locally BEFORE spending gas (and before hitting the chain), mirroring the
 * factory's own checks: a malformed request is reported as a failure with a reason, not attempted.
 */
export function prepareJob(job: WrapperJob, config: DeployerConfig): JobCheck {
  if (!UUID_RE.test(job.id)) return { ok: false, reason: `job id ${job.id} is not a UUID` };
  if (job.chainId !== config.chainId) {
    return { ok: false, reason: `job chain ${job.chainId} != runner chain ${config.chainId}` };
  }
  if (!isAddress(job.childAddress)) return { ok: false, reason: "childAddress is not an address" };
  if (!Number.isInteger(job.feeBps) || job.feeBps < 0 || job.feeBps > config.maxFeeBps) {
    return { ok: false, reason: `feeBps ${job.feeBps} outside 0..${config.maxFeeBps}` };
  }
  if (!job.name || !job.symbol || !job.label) {
    return { ok: false, reason: "name/symbol/label must be non-empty" };
  }
  let perUserCap: bigint;
  let totalCap: bigint;
  let vaultCap: bigint;
  try {
    perUserCap = BigInt(job.perUserCap);
    totalCap = BigInt(job.totalCap);
    vaultCap = BigInt(job.vaultCap);
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
      child: job.childAddress,
      feeBps: job.feeBps,
      perUserCap,
      totalCap,
      vaultCap,
      name: job.name,
      symbol: job.symbol,
      label: job.label,
      salt: saltForJob(job.id),
    },
  };
}
