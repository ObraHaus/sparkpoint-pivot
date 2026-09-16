import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isAddress, type Address } from "viem";
import { isKnownChain, type KnownChainId } from "./chain.ts";

/**
 * The address book, read from THIS repo's deployment record —
 * `contracts/deployments/<chainId>/addresses.json` — rather than pasted.
 *
 * A runner holding a hard-coded address keeps calling into empty space after a redeploy and reports
 * nothing wrong. The book is the record; this reads the record.
 *
 * ⚠️ The book is a **record of what was deployed**, not an aspiration: every required field here was
 * verified on-chain at deploy time (see the beta tracker). `royaltySink`/`token`/`curve`/`escrow` are
 * optional because a partial deploy is a real state — the keeper must still be able to start and
 * settle rounds while the token is unwired.
 */
export type Deployment = {
  chainId: number;
  contracts: {
    nft: Address;
    engine: Address;
    vault: Address;
    splitter: Address;
    royaltySink?: Address;
  };
  token?: Address;
  curve?: Address;
  escrow?: Address;
};

export type Env = "mainnet" | "testnet" | "sim";

const CHAIN_BY_ENV: Record<Env, KnownChainId> = {
  mainnet: 4663,
  testnet: 46630,
  sim: 46633,
};

export function envName(): Env {
  const raw = (process.env.DEPLOY_ENV ?? "").trim();
  if (raw !== "mainnet" && raw !== "testnet" && raw !== "sim") {
    throw new Error(`DEPLOY_ENV must be mainnet, testnet or sim (got ${raw || "nothing"})`);
  }
  return raw;
}

/** Default: `<cwd>/contracts/deployments/<chainId>/addresses.json`; override with DEPLOYMENT_PATH. */
export function deploymentPath(env: Env, root = process.cwd()): string {
  return (
    process.env.DEPLOYMENT_PATH ??
    join(root, "contracts", "deployments", String(CHAIN_BY_ENV[env]), "addresses.json")
  );
}

const ZERO = "0x0000000000000000000000000000000000000000";

export function loadDeployment(root = process.cwd()): Deployment {
  const env = envName();
  const path = deploymentPath(env, root);
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist. Deploy the contracts first, or set DEPLOYMENT_PATH.`);
  }

  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} is not an object`);
  const o = raw as Record<string, unknown>;

  const chainId = Number(o.chainId);
  if (!isKnownChain(chainId)) throw new Error(`${path} records unknown chain ${chainId}`);

  // ⚠️ The book, the environment and the node all have to agree. A book for one chain read by a
  // runner configured for another is how a keeper settles rounds on a testnet while an operator
  // watches mainnet and sees nothing happen. `assertChain()` covers the node; this covers the file.
  const want = CHAIN_BY_ENV[env];
  if (chainId !== want) {
    throw new Error(
      `${path} records chain ${chainId}, but DEPLOY_ENV=${env} means chain ${want}. Refusing to run.`,
    );
  }
  const configured = Number(process.env.CHAIN_ID);
  if (Number.isFinite(configured) && configured !== chainId) {
    throw new Error(`CHAIN_ID=${configured} disagrees with ${path}, which records ${chainId}`);
  }

  // Our book shape: `beta` holds the deployed set; `thirdParty` holds the protocol addresses.
  const beta = (o.beta ?? o) as Record<string, unknown>;

  const address = (value: unknown, key: string): Address => {
    if (typeof value !== "string" || !isAddress(value)) {
      throw new Error(`${path}: ${key} is not an address`);
    }
    return value;
  };

  // The zero address is a valid address and a meaningless one — a book written before a piece was
  // wired may carry zeroes rather than omitting the key. Treat those as absent.
  const optional = (value: unknown, key: string): Address | undefined => {
    if (value === undefined || value === null) return undefined;
    const parsed = address(value, key);
    return parsed === ZERO ? undefined : parsed;
  };

  return {
    chainId,
    contracts: {
      nft: address(beta.brokerNFT, "beta.brokerNFT"),
      engine: address(beta.brokerEngine, "beta.brokerEngine"),
      vault: address(beta.brokerVault, "beta.brokerVault"),
      splitter: address(beta.revenueSplitter, "beta.revenueSplitter"),
      royaltySink: optional(beta.royaltySink, "beta.royaltySink"),
    },
    token: optional(beta.utilityToken, "beta.utilityToken"),
    curve: optional(beta.ponsCurve, "beta.ponsCurve"),
    escrow: optional(beta.ponsFeeEscrow, "beta.ponsFeeEscrow"),
  };
}
