/**
 * Feature 049 (v4.1.0 pivot) — the AI wrapper-ADMISSION runner. Holds the scoped AI key
 * (`DEPLOYER_ROLE`) and nothing else.
 *
 * Each tick it asks the agent for curated, unwrapped children; for each it reads the on-chain
 * admission state, then (deterministically, by provenance):
 *   * no pending admission        → `whitelistVault(child)` — an AI entry, deployable after the
 *                                   on-chain cooldown (default 24h); no timelock is involved.
 *   * AI entry still cooling off  → wait (a later tick re-checks).
 *   * AI entry ready              → `createVault(params)`.
 *   * admin entry / already wrapped → skip. The AI never deploys admin-added entries.
 *
 * There is deliberately NO code path to unwhitelist, release, set the cooldown, upgrade anything,
 * pause, set recipients, or move funds — the factory enforces those powers away from this key
 * on-chain, and this file has no selector for them.
 *
 * IDEMPOTENT BY CONSTRUCTION: the CREATE2 salt is derived from the child address and a landed-but-
 * unreported deploy is recovered by checking for code at the predicted address. A landed-but-
 * unreported whitelist is recovered by the next tick (the entry now exists; `by` is the AI's).
 *
 * The LLM agent stays keyless: it only serves candidates and stores reports.
 */

import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { forever, logger } from "./shared/log.ts";
import {
  FACTORY_ABI,
  decideAdmission,
  prepareCandidate,
  type AdmissionState,
  type CreateVaultParams,
  type DeployerConfig,
  type WrapperCandidate,
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

export type AdmissionOutcome = {
  childAddress: Address;
  action: "whitelist" | "deploy" | "none";
  ok: boolean;
  txHash?: Hex;
  proxyAddress?: Address;
  capRegistry?: Address | null;
  readyAt?: number;
  byAddress?: Address;
  error?: string;
};

export type DeployerDeps = {
  /** The scoped AI account address — the provenance anchor (`whitelistOf(child).by`). */
  runnerAddress: Address;
  fetchCandidates(): Promise<WrapperCandidate[]>;
  report(outcome: AdmissionOutcome): Promise<void>;
  getAdmissionState(child: Address): Promise<AdmissionState>;
  predict(args: CreateVaultParams): Promise<Address>;
  getCode(address: Address): Promise<Hex | undefined>;
  whitelistVault(child: Address): Promise<{ txHash: Hex; readyAt: number }>;
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
 * One polling pass. A single bad candidate is reported and never stops the rest; a transport
 * failure fetching the candidate list propagates (the tick is degraded and the heartbeat must not
 * advance). Returns the number of on-chain actions taken (whitelists + deploys).
 */
export async function runOnce(config: DeployerConfig, deps: DeployerDeps): Promise<number> {
  const candidates = await deps.fetchCandidates();
  if (candidates.length === 0) {
    log.info("no unwrapped curated candidates");
    return 0;
  }
  log.info(`${candidates.length} unwrapped curated candidate(s)`);

  let acted = 0;
  for (const candidate of candidates) {
    const check = prepareCandidate(candidate, config);
    if (!check.ok) {
      log.warn(`${candidate.childAddress} rejected locally: ${check.reason}`);
      await deps.report({
        childAddress: candidate.childAddress,
        action: "none",
        ok: false,
        error: `rejected: ${check.reason}`,
      });
      continue;
    }
    const args = check.args;
    let action: AdmissionOutcome["action"] = "none";

    try {
      const state = await deps.getAdmissionState(args.child);
      const decision = decideAdmission(state, deps.runnerAddress);
      if (decision.action === "wait") {
        log.info(`${args.child}: AI entry still cooling off — waiting for a later tick`);
        continue;
      }
      if (decision.action === "skip") {
        log.info(`${args.child}: skipped (${decision.reason})`);
        continue;
      }

      if (decision.action === "whitelist") {
        action = "whitelist";
        const result = await deps.whitelistVault(args.child);
        log.info(`${args.child}: whitelisted, ready at ${result.readyAt} (tx ${result.txHash})`);
        await deps.report({
          childAddress: args.child,
          action,
          ok: true,
          txHash: result.txHash,
          readyAt: result.readyAt,
          // The on-chain `by` is the runner itself; recording it keeps the panel's provenance
          // honest (AI entry vs an admin admission) without an extra chain read.
          byAddress: deps.runnerAddress,
        });
        acted += 1;
        continue;
      }

      action = "deploy";
      const predicted = await deps.predict(args);
      const existing = await deps.getCode(predicted);
      if (existing !== undefined && existing !== "0x") {
        // Recovery: a prior attempt landed but its report was lost. Do NOT send again.
        log.warn(`${args.child}: ${predicted} already exists — reporting without sending`);
        await deps.report({
          childAddress: args.child,
          action,
          ok: true,
          proxyAddress: predicted,
          capRegistry: await deps.readCapRegistry(predicted),
        });
        acted += 1;
        continue;
      }

      const result = await deps.createVault(args);
      log.info(`${args.child}: deployed ${result.proxy} (tx ${result.txHash})`);
      await deps.report({
        childAddress: args.child,
        action,
        ok: true,
        txHash: result.txHash,
        proxyAddress: result.proxy,
        capRegistry: result.capRegistry,
      });
      acted += 1;
    } catch (error) {
      const detail = errorText(error);
      log.warn(`${args.child} ${action} failed: ${detail}`);
      await deps.report({ childAddress: args.child, action, ok: false, error: detail });
    }
  }
  return acted;
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

  const admissionReport = async (outcome: AdmissionOutcome): Promise<void> => {
    const base = config.apiBaseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/curator/wrapper-whitelist/report`, {
      method: "POST",
      headers: agentHeaders(config),
      body: JSON.stringify({
        childAddress: outcome.childAddress,
        action: outcome.action,
        ok: outcome.ok,
        txHash: outcome.txHash ?? null,
        proxyAddress: outcome.proxyAddress ?? null,
        capRegistry: outcome.capRegistry ?? null,
        readyAt: outcome.readyAt ?? null,
        byAddress: outcome.byAddress ?? null,
        error: outcome.error ?? null,
        runnerCommit: process.env.DEPLOYER_COMMIT ?? null,
      }),
      signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
    });
    if (!res.ok) throw new Error(`agent report -> HTTP ${res.status}`);
  };

  return {
    runnerAddress: account.address,
    async fetchCandidates() {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/curator/wrapper-whitelist`, {
        headers: agentHeaders(config),
        signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
      });
      if (!res.ok) throw new Error(`agent wrapper-whitelist -> HTTP ${res.status}`);
      const body = (await res.json()) as { candidates?: WrapperCandidate[] };
      return body.candidates ?? [];
    },
    report: admissionReport,
    async getAdmissionState(child) {
      const [wrapper, whitelist, ready] = await Promise.all([
        publicClient.readContract({
          address: config.factoryAddress,
          abi: FACTORY_ABI,
          functionName: "wrapperOf",
          args: [child],
        }),
        publicClient.readContract({
          address: config.factoryAddress,
          abi: FACTORY_ABI,
          functionName: "whitelistOf",
          args: [child],
        }),
        publicClient.readContract({
          address: config.factoryAddress,
          abi: FACTORY_ABI,
          functionName: "isReady",
          args: [child],
        }),
      ]);
      return { wrapper, whitelistedBy: whitelist[0], ready };
    },
    predict,
    getCode: (address) => publicClient.getCode({ address }),
    async whitelistVault(child) {
      // Simulate first: a revert caught here is a sentence, a revert on chain is gas spent to learn
      // the same thing.
      const { request } = await publicClient.simulateContract({
        address: config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "whitelistVault",
        args: [child],
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
        eventName: "VaultWhitelisted",
      });
      const event = parsed[0]?.args as unknown as { readyAt?: bigint } | undefined;
      if (event?.readyAt !== undefined) return { txHash, readyAt: Number(event.readyAt) };
      // Fallback: re-read the entry (the event should always be there; never report a wrong wait).
      const entry = await publicClient.readContract({
        address: config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "whitelistOf",
        args: [child],
      });
      return { txHash, readyAt: Number(entry[1]) };
    },
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
    `AI wrapper-admission runner: chain ${config.chainId}, factory ${config.factoryAddress}, ` +
      `runner ${deps.runnerAddress}, poll ${config.pollSec}s ` +
      `(scoped admission key: whitelist + createVault only; no unwhitelist/release/cooldown/upgrade)`,
  );

  await forever(
    log,
    "tick",
    () => config.pollSec * 1_000,
    async () => {
      const acted = await runOnce(config, deps);
      if (acted > 0) log.info(`whitelisted/deployed ${acted} wrapper(s) this tick`);
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
