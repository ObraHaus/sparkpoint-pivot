/**
 * Feature 049 — the wrapper DEPLOY RUNNER. Holds the scoped, deploy-only hot key and nothing else.
 *
 * It polls the agent for admin-requested wrapper deployments, validates each job locally, asks the
 * factory whether the child is on the curated on-chain allowlist, simulates `createVault`, sends it,
 * and reports the result. There is deliberately NO code path to upgrade anything, change the
 * allowlist, pause, set recipients, or move funds — the factory enforces those powers away from this
 * key on-chain, and this file has no selector for them.
 *
 * IDEMPOTENT BY CONSTRUCTION: the CREATE2 salt is derived from the request id, and if code already
 * exists at the predicted address (a previous attempt succeeded but its report was lost), the
 * runner reports success without sending a second transaction.
 *
 * The LLM agent stays keyless: it only serves the queue and stores the report.
 */

import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { forever, logger } from "./shared/log.ts";
import {
  FACTORY_ABI,
  prepareJob,
  type CreateVaultParams,
  type DeployerConfig,
  type WrapperJob,
} from "./shared/wrapper.ts";

const log = logger("deployer");

class ConfigError extends Error {}

function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name}=${raw} is not a positive number`);
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DeployerConfig {
  const apiBaseUrl = env.AGENT_BASE_URL ?? env.CURATOR_API_BASE_URL ?? "";
  const s2sToken = env.AGENT_S2S_TOKEN ?? "";
  const reportOwner = env.DEPLOYER_REPORT_OWNER ?? env.BOT_REPORT_OWNER ?? "";
  // The private key is validated where it is used (main), so tests can build a config without one.
  if (!apiBaseUrl || !s2sToken || !reportOwner) {
    throw new ConfigError(
      "AGENT_BASE_URL (or CURATOR_API_BASE_URL), AGENT_S2S_TOKEN and DEPLOYER_REPORT_OWNER are " +
        "required — the runner reports to the agent and holds no other identity",
    );
  }
  const chainId = envNumber(env, "CHAIN_ID", 4663);
  return {
    chainId,
    rpcUrl: required(env, "RPC_URL"),
    factoryAddress: required(env, "WRAPPER_FACTORY_ADDRESS") as Address,
    apiBaseUrl,
    s2sToken,
    reportOwner,
    pollSec: envNumber(env, "DEPLOYER_POLL_SEC", 120),
    maxFeeBps: envNumber(env, "WRAPPER_MAX_FEE_BPS", 2000),
    fetchTimeoutSec: envNumber(env, "DEPLOYER_FETCH_TIMEOUT_SEC", 30),
  };
}

export type JobOutcome = {
  id: string;
  ok: boolean;
  txHash?: Hex;
  proxyAddress?: Address;
  capRegistry?: Address | null;
  error?: string;
};

export type DeployerDeps = {
  fetchJobs(): Promise<WrapperJob[]>;
  report(outcome: JobOutcome): Promise<void>;
  isAllowlisted(child: Address): Promise<boolean>;
  predict(args: CreateVaultParams): Promise<Address>;
  getCode(address: Address): Promise<Hex | undefined>;
  createVault(args: CreateVaultParams): Promise<{
    txHash: Hex;
    proxy: Address;
    capRegistry: Address | null;
  }>;
  readCapRegistry(proxy: Address): Promise<Address | null>;
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: string }).shortMessage;
    return (short ?? error.message).split("\n")[0] ?? "unknown error";
  }
  return String(error);
}

/**
 * One polling pass: process every pending job, oldest first. A single bad job is reported and never
 * stops the rest; a transport failure fetching the queue propagates (the tick is degraded and the
 * heartbeat must not advance).
 */
export async function runOnce(config: DeployerConfig, deps: DeployerDeps): Promise<number> {
  const jobs = await deps.fetchJobs();
  if (jobs.length === 0) {
    log.info("no pending wrapper deploys");
    return 0;
  }
  log.info(`${jobs.length} pending wrapper deploy(s)`);

  let deployed = 0;
  for (const job of jobs) {
    const check = prepareJob(job, config);
    if (!check.ok) {
      log.warn(`job ${job.id} rejected locally: ${check.reason}`);
      await deps.report({ id: job.id, ok: false, error: `rejected: ${check.reason}` });
      continue;
    }
    const args = check.args;

    try {
      if (!(await deps.isAllowlisted(job.childAddress))) {
        // No gas spent on a child the on-chain allowlist does not carry (the factory would revert).
        log.warn(`job ${job.id}: ${job.childAddress} is not on the on-chain allowlist`);
        await deps.report({
          id: job.id,
          ok: false,
          error: "child is not on the on-chain curated allowlist",
        });
        continue;
      }

      const predicted = await deps.predict(args);
      const existing = await deps.getCode(predicted);
      if (existing !== undefined && existing !== "0x") {
        // Recovery: a prior attempt landed but its report was lost. Do NOT send again.
        log.warn(`job ${job.id}: ${predicted} already exists — reporting without sending`);
        await deps.report({
          id: job.id,
          ok: true,
          proxyAddress: predicted,
          capRegistry: await deps.readCapRegistry(predicted),
        });
        deployed += 1;
        continue;
      }

      const result = await deps.createVault(args);
      log.info(`job ${job.id}: deployed ${result.proxy} (tx ${result.txHash})`);
      await deps.report({
        id: job.id,
        ok: true,
        txHash: result.txHash,
        proxyAddress: result.proxy,
        capRegistry: result.capRegistry,
      });
      deployed += 1;
    } catch (error) {
      const detail = errorText(error);
      log.warn(`job ${job.id} failed: ${detail}`);
      await deps.report({ id: job.id, ok: false, error: detail });
    }
  }
  return deployed;
}

function chainFor(config: DeployerConfig) {
  return defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

function agentHeaders(config: DeployerConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.s2sToken}`,
    // The agent's middleware requires the scoping headers on every non-exempt route. The runner is a
    // machine with no wallet; it asserts the operator address that configured it. No authority.
    "x-owner": config.reportOwner,
    "x-account": config.reportOwner,
    "x-chain-id": String(config.chainId),
  };
}

export function realDeps(config: DeployerConfig, privateKey: Hex): DeployerDeps {
  const chain = chainFor(config);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ chain, account, transport: http(config.rpcUrl) });

  const predict = (args: CreateVaultParams): Promise<Address> =>
    publicClient.readContract({
      address: config.factoryAddress,
      abi: FACTORY_ABI,
      functionName: "predictVaultAddress",
      args: [args],
    });

  const jobReport = async (outcome: JobOutcome): Promise<void> => {
    const base = config.apiBaseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/curator/wrapper-jobs/report`, {
      method: "POST",
      headers: agentHeaders(config),
      body: JSON.stringify({
        id: outcome.id,
        ok: outcome.ok,
        txHash: outcome.txHash ?? null,
        proxyAddress: outcome.proxyAddress ?? null,
        capRegistry: outcome.capRegistry ?? null,
        error: outcome.error ?? null,
        runnerCommit: process.env.DEPLOYER_COMMIT ?? null,
      }),
      signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
    });
    if (!res.ok) throw new Error(`agent report -> HTTP ${res.status}`);
  };

  return {
    async fetchJobs() {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/curator/wrapper-jobs`, {
        headers: agentHeaders(config),
        signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
      });
      if (!res.ok) throw new Error(`agent wrapper-jobs -> HTTP ${res.status}`);
      const body = (await res.json()) as { jobs?: WrapperJob[] };
      return body.jobs ?? [];
    },
    report: jobReport,
    isAllowlisted: (child) =>
      publicClient.readContract({
        address: config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "isAllowlisted",
        args: [child],
      }),
    predict,
    getCode: (address) => publicClient.getCode({ address }),
    async createVault(args) {
      // Simulate first: a revert caught here is a sentence, a revert on chain is gas spent to learn
      // the same thing (and, with a CREATE2 collision, a confusing one).
      const { request } = await publicClient.simulateContract({
        address: config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "createVault",
        args: [args],
        account,
      });
      const txHash = await walletClient.writeContract({ ...request, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      // waitForTransactionReceipt RESOLVES on a reverted tx — check status explicitly.
      if (receipt.status !== "success") {
        throw new Error(`tx ${txHash} reverted on chain (gas used ${receipt.gasUsed})`);
      }
      const parsed = parseEventLogs({
        abi: FACTORY_ABI,
        logs: receipt.logs,
        eventName: "VaultCreated",
      });
      const event = parsed[0]?.args as unknown as
        | { proxy?: Address; capRegistry?: Address }
        | undefined;
      return {
        txHash,
        proxy: event?.proxy ?? (await predict(args)),
        capRegistry: event?.capRegistry ?? null,
      };
    },
    async readCapRegistry(proxy) {
      try {
        return (await publicClient.readContract({
          address: proxy,
          abi: [
            {
              type: "function",
              name: "capRegistry",
              stateMutability: "view",
              inputs: [],
              outputs: [{ name: "", type: "address" }],
            },
          ] as const,
          functionName: "capRegistry",
        })) as Address;
      } catch {
        return null;
      }
    },
  };
}

async function main(): Promise<void> {
  const config = configFromEnv();
  const privateKey = required(process.env, "WRAPPER_DEPLOYER_PRIVATE_KEY") as Hex;
  const deps = realDeps(config, privateKey);
  log.info(
    `wrapper deploy runner: chain ${config.chainId}, factory ${config.factoryAddress}, ` +
      `poll ${config.pollSec}s (scoped deploy-only key; no upgrade/allowlist/pause power)`,
  );

  await forever(
    log,
    "tick",
    () => config.pollSec * 1_000,
    async () => {
      const deployed = await runOnce(config, deps);
      if (deployed > 0) log.info(`deployed ${deployed} wrapper(s) this tick`);
    },
    "deployer",
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
