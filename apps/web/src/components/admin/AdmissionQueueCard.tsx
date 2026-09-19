"use client";

/**
 * 049 v4.1.0 — Admin → Vaults → the admission queue.
 *
 * The V3 factory is RBAC: the AI deployer admits a curated vault that unlocks after an on-chain
 * cooling-off window (default 24h, bounded 1h–7d), the operator EOA admits/deploys instantly and
 * may release or cancel a pending entry, and one wrapper per child is enforced on-chain.
 *
 * ⚠️ This panel SIGNS from the operator wallet (4663) and only RECORDS afterwards; the agent never
 * signs and never deploys. A green button is not authority: the factory enforces the role, the
 * cooldown, the fee cap and the child validation on-chain.
 */

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";
import { useVaultFactoryV3, VAULT_FACTORY_V3_CHAIN } from "@/lib/chain/useVaultFactoryV3";
import {
  ADMISSION_LABEL,
  ADMISSION_TONE,
  admissionRows,
  cooldownHours,
  createVaultArgs,
  hoursToSeconds,
  phaseOf,
  remainingLabel,
  type AdmissionCandidate,
  type AdmissionData,
  type AdmissionEntry,
  type AdmissionPhase,
} from "@/lib/curation/admission";
import { shortAddr } from "@/lib/curation/model";

const API = "/api/agent/admin/vaults/whitelist";
const HEADERS = {
  "content-type": "application/json",
  "x-chain-id": APP_CHAIN_ID_HEADER,
};

async function admissionCall(path = "", body?: unknown): Promise<AdmissionData> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AdmissionData;
}

function walletError(error: unknown): string {
  const msg =
    (error as { shortMessage?: string; message?: string }).shortMessage ??
    (error as { message?: string }).message ??
    "The transaction failed.";
  if (/user rejected|denied|rejected the request/i.test(msg)) return "You cancelled the signature.";
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

type Row =
  | { kind: "candidate"; candidate: AdmissionCandidate; entry: AdmissionEntry | null }
  | { kind: "history"; entry: AdmissionEntry };

export function AdmissionQueueCard({
  reloadKey,
  onChanged,
  onError,
}: {
  reloadKey: number;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [data, setData] = useState<AdmissionData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const { address: wallet, chainId: walletChain } = useAccount();
  const publicClient = usePublicClient({ chainId: VAULT_FACTORY_V3_CHAIN });
  const { factory, abi, writeContractAsync } = useVaultFactoryV3();
  const walletReady = Boolean(wallet) && walletChain === VAULT_FACTORY_V3_CHAIN;

  const { data: cooldown } = useReadContract({
    address: factory,
    abi,
    functionName: "cooldown",
    chainId: VAULT_FACTORY_V3_CHAIN,
    query: { enabled: Boolean(factory) },
  });
  const { data: minCooldown } = useReadContract({
    address: factory,
    abi,
    functionName: "MIN_COOLDOWN",
    chainId: VAULT_FACTORY_V3_CHAIN,
    query: { enabled: Boolean(factory) },
  });
  const { data: maxCooldown } = useReadContract({
    address: factory,
    abi,
    functionName: "MAX_COOLDOWN",
    chainId: VAULT_FACTORY_V3_CHAIN,
    query: { enabled: Boolean(factory) },
  });

  const hoursValue =
    hours ?? (typeof cooldown === "bigint" ? String(cooldownHours(Number(cooldown))) : "24");

  const load = useCallback(async () => {
    try {
      setData(await admissionCall());
    } catch {
      onError("Couldn’t load the admission queue.");
    }
  }, [onError]);

  useEffect(() => {
    // setState in the promise callback (never synchronously inside the effect), mirroring the
    // panel's other cards and the react-hooks rule.
    let live = true;
    admissionCall()
      .then((next) => {
        if (live) setData(next);
      })
      .catch(() => {
        if (live) onError("Couldn’t load the admission queue.");
      });
    return () => {
      live = false;
    };
  }, [reloadKey, onError]);

  useEffect(() => {
    const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);

  const wait = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) throw new Error("No RPC client for chain 4663.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted on chain.");
    },
    [publicClient],
  );

  const run = useCallback(
    async (child: string, fn: () => Promise<void>) => {
      setBusy(child);
      try {
        await fn();
        await load();
        onChanged();
      } catch (error) {
        onError(walletError(error));
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged, onError],
  );

  const whitelist = (child: string) =>
    run(child, async () => {
      if (!factory) throw new Error("The V3 factory is not configured.");
      const hash = await writeContractAsync({
        address: factory,
        abi,
        functionName: "whitelistVault",
        args: [child as `0x${string}`],
        chainId: VAULT_FACTORY_V3_CHAIN,
      });
      await wait(hash);
      await admissionCall("/record", { childAddress: child, action: "whitelist", txHash: hash });
    });

  const release = (child: string) =>
    run(child, async () => {
      if (!factory) throw new Error("The V3 factory is not configured.");
      const hash = await writeContractAsync({
        address: factory,
        abi,
        functionName: "releaseNow",
        args: [child as `0x${string}`],
        chainId: VAULT_FACTORY_V3_CHAIN,
      });
      await wait(hash);
      await admissionCall("/record", { childAddress: child, action: "release", txHash: hash });
    });

  const cancel = (child: string) =>
    run(child, async () => {
      if (!factory) throw new Error("The V3 factory is not configured.");
      const hash = await writeContractAsync({
        address: factory,
        abi,
        functionName: "unwhitelist",
        args: [child as `0x${string}`],
        chainId: VAULT_FACTORY_V3_CHAIN,
      });
      await wait(hash);
      await admissionCall("/record", { childAddress: child, action: "unwhitelist", txHash: hash });
    });

  const deployNow = (row: Row) =>
    run(row.kind === "candidate" ? row.candidate.childAddress : row.entry.childAddress, async () => {
      if (!factory || !publicClient) throw new Error("The V3 factory is not configured.");
      const source = row.kind === "candidate" ? row.candidate : row.entry;
      const entry = row.kind === "candidate" ? row.entry : row.entry;
      if (phaseOf(entry, nowSec) === "cooling") {
        const releaseHash = await writeContractAsync({
          address: factory,
          abi,
          functionName: "releaseNow",
          args: [source.childAddress as `0x${string}`],
          chainId: VAULT_FACTORY_V3_CHAIN,
        });
        await wait(releaseHash);
      }
      const args = createVaultArgs(source);
      const predicted = await publicClient.readContract({
        address: factory,
        abi,
        functionName: "predictVaultAddress",
        args: [args],
      });
      const hash = await writeContractAsync({
        address: factory,
        abi,
        functionName: "createVault",
        args: [args],
        chainId: VAULT_FACTORY_V3_CHAIN,
      });
      await wait(hash);
      await admissionCall("/record", {
        childAddress: source.childAddress,
        action: "deploy",
        txHash: hash,
        proxyAddress: predicted,
      });
    });

  const saveCooldown = () =>
    run("__cooldown__", async () => {
      if (!factory) throw new Error("The V3 factory is not configured.");
      const seconds = hoursToSeconds(Number(hoursValue));
      if (seconds === null) throw new Error("Cooldown must be a whole number of hours, 1–168.");
      const hash = await writeContractAsync({
        address: factory,
        abi,
        functionName: "setCooldown",
        args: [BigInt(seconds)],
        chainId: VAULT_FACTORY_V3_CHAIN,
      });
      await wait(hash);
    });

  const rows: Row[] = data ? (admissionRows(data) as Row[]) : [];

  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">Vault admission queue</span>
        <span className={`pill ${data && data.pending > 0 ? "amber" : "ghosty"}`}>
          {data ? `${data.pending} pending` : "…"}
        </span>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted-foreground)" }}>
        The AI can admit an approved vault on its own, but it unlocks only after the on-chain
        cooling-off window. You can admit and deploy instantly, release a cooling entry, or cancel
        a pending one. One wrapper per vault is enforced on-chain; upgrades stay behind the 72-hour
        timelock.
      </p>

      {!factory ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          The V3 factory is not configured for this build.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 10,
              fontSize: 12.5,
            }}
          >
            <span className="muted">AI cooling-off window</span>
            <input
              aria-label="Cooldown hours"
              value={hoursValue}
              onChange={(e) => setHours(e.target.value)}
              style={{ width: 64 }}
              inputMode="numeric"
            />
            <span className="muted">
              hours (1–168
              {typeof minCooldown === "bigint" && typeof maxCooldown === "bigint"
                ? `; chain bounds ${cooldownHours(Number(minCooldown))}–${cooldownHours(Number(maxCooldown))}h`
                : ""}
              )
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={saveCooldown}
              disabled={!walletReady || busy !== null || hoursToSeconds(Number(hoursValue)) === null}
            >
              {busy === "__cooldown__" ? "Saving…" : "Save cooldown"}
            </button>
          </div>

          {!walletReady && (
            <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
              Connect the operator wallet on Robinhood Chain 4663 to sign admission actions.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              {data === null
                ? "Loading…"
                : "No approved unwrapped vaults. Approve a vault above to offer it for wrapping."}
            </p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Vault</th>
                  <th>State</th>
                  <th>Ready</th>
                  <th>Fee</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const child =
                    row.kind === "candidate" ? row.candidate.childAddress : row.entry.childAddress;
                  const entry = row.kind === "candidate" ? row.entry : row.entry;
                  const source = row.kind === "candidate" ? row.candidate : row.entry;
                  const phase: AdmissionPhase = phaseOf(entry, nowSec);
                  const label = row.kind === "candidate" ? row.candidate.vaultLabel : row.entry.label;
                  const isBusy = busy === child;
                  return (
                    <tr key={`${child}-${entry?.id ?? "candidate"}`}>
                      <td>
                        <div>{label}</div>
                        <div className="mono muted" style={{ fontSize: 11 }}>
                          {shortAddr(child)}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${ADMISSION_TONE[phase]}`}>
                          <span className="led" />
                          {ADMISSION_LABEL[phase]}
                        </span>
                        {entry?.error && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {entry.error}
                          </div>
                        )}
                      </td>
                      <td className="tnum">
                        {phase === "cooling" && entry
                          ? remainingLabel(entry.readyAt, nowSec)
                          : phase === "deployed"
                            ? entry?.proxyAddress
                              ? shortAddr(entry.proxyAddress)
                              : "—"
                            : phase === "ready"
                              ? "ready now"
                              : "—"}
                      </td>
                      <td className="tnum">{(source.feeBps / 100).toFixed(1)}%</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {(phase === "not-admitted" ||
                          phase === "cancelled" ||
                          phase === "failed") && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => whitelist(child)}
                            disabled={!walletReady || isBusy}
                          >
                            {isBusy ? "Signing…" : "Whitelist now"}
                          </button>
                        )}
                        {(phase === "cooling" || phase === "ready") && (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => deployNow(row)}
                              disabled={!walletReady || isBusy}
                            >
                              {isBusy ? "Signing…" : "Deploy now"}
                            </button>
                            {phase === "cooling" && (
                              <button
                                className="btn btn-outline btn-sm"
                                style={{ marginLeft: 6 }}
                                onClick={() => release(child)}
                                disabled={!walletReady || isBusy}
                              >
                                Release
                              </button>
                            )}
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ marginLeft: 6 }}
                              onClick={() => cancel(child)}
                              disabled={!walletReady || isBusy}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
