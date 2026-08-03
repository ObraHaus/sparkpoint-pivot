"use client";

/**
 * 035 — the original /admin/diagnostics screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → Network diagnostics (feature: SIWE network-gate incident viewer).
 *
 * Wired to the agent's `/admin/diagnostics` (via the BFF) — the persisted captures the /verify gate
 * beacon posts when a wallet is stuck on "wrong network". Each row compares the wallet's OWN
 * `eth_chainId` (ground truth) against the chainId wagmi surfaced, and lists the injected wallets
 * (EIP-6963) present — which is what tells a reconnect/stale flash apart from a multi-wallet
 * mis-binding. The wallet address is CLIENT-REPORTED (captured before sign-in) and UNVERIFIED; this
 * panel is read-only and can never move funds (N2).
 */

import { useCallback, useEffect, useState } from "react";

interface Diag {
  id: number;
  at: string;
  reason: string;
  address: string | null;
  wagmiChainId: number | null;
  walletChainId: number | null;
  chainMismatch: boolean | null;
  status: string | null;
  connectorId: string | null;
  connectorName: string | null;
  isMetaMask: boolean | null;
  injectedCount: number | null;
  injectedNames: string[];
  userAgent: string | null;
  buildId: string | null;
}

const CHAIN_LABEL: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia", 46630: "Robinhood" };
const chainName = (id: number | null): string =>
  id == null ? "—" : `${CHAIN_LABEL[id] ?? "unsupported"} · ${id}`;
const short = (a: string | null): string => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function DiagnosticsPanel() {
  const [rows, setRows] = useState<Diag[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [mismatchOnly, setMismatchOnly] = useState(false);

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const qs = `limit=200${mismatchOnly ? "&mismatch=true" : ""}`;
      const r = await fetch(`/api/agent/admin/diagnostics?${qs}`, {
        headers: { "x-chain-id": "84532" },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(String(r.status));
      setRows(((await r.json()) as { entries?: Diag[] }).entries ?? []);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [mismatchOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Network diagnostics</h1>
          <div className="sub">
            Captures from the <span className="mono">/verify</span> access gate when a wallet reads
            &ldquo;wrong network&rdquo;. Compare the wallet&rsquo;s own chain (ground truth) to what wagmi
            surfaced: a <b>supported wallet chain with a mismatch</b> is a reconnect/stale flash (now
            self-heals); <b>&gt;1 injected wallet</b> or <b>not MetaMask</b> points at a multi-wallet
            mis-binding. Addresses are client-reported &amp; unverified.
          </div>
        </div>
        <span className={`pill ${state === "ok" ? "ok" : state === "loading" ? "info" : "amber"}`}>
          <span className="led" />
          {state === "loading" ? "Loading…" : state === "error" ? "Unavailable" : `${rows.length} captures`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "0 0 12px", alignItems: "center" }}>
        <button
          type="button"
          className={`pill ${mismatchOnly ? "amber" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setMismatchOnly((v) => !v)}
        >
          {mismatchOnly ? "✓ Mismatches only" : "Mismatches only"}
        </button>
        <button type="button" className="pill" style={{ cursor: "pointer" }} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="muted" style={{ padding: "14px 4px", fontSize: 13 }}>
            {state === "loading"
              ? "Loading…"
              : state === "error"
                ? "Couldn’t load diagnostics (is the agent reachable?)."
                : mismatchOnly
                  ? "No mismatched captures — nothing to investigate."
                  : "No captures yet. They arrive when a wallet hits the network gate or retries sign-in."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="adtbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Reason</th>
                  <th>Wallet</th>
                  <th>wagmi chain</th>
                  <th>wallet chain</th>
                  <th>Match</th>
                  <th>Connector</th>
                  <th>Injected wallets</th>
                  <th>Build</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{new Date(d.at).toLocaleString()}</td>
                    <td>
                      <span className={`pill ${d.reason === "off-network" ? "amber" : ""}`}>{d.reason}</span>
                    </td>
                    <td className="mono" title={d.address ?? undefined}>{short(d.address)}</td>
                    <td className="mono">{chainName(d.wagmiChainId)}</td>
                    <td className="mono">{chainName(d.walletChainId)}</td>
                    <td>
                      {d.chainMismatch == null ? (
                        <span className="muted">—</span>
                      ) : d.chainMismatch ? (
                        <span className="pill amber">mismatch</span>
                      ) : (
                        <span className="pill ok">match</span>
                      )}
                    </td>
                    <td className="mono" title={d.connectorId ?? undefined}>
                      {d.connectorName ?? d.connectorId ?? "—"}
                      {d.isMetaMask === false ? <span className="muted"> · not MM</span> : null}
                      {d.status ? <span className="muted"> · {d.status}</span> : null}
                    </td>
                    <td
                      className={d.injectedCount && d.injectedCount > 1 ? "" : "mono"}
                      title={d.injectedNames.join(", ") || undefined}
                    >
                      {d.injectedCount == null ? (
                        "—"
                      ) : (
                        <>
                          {d.injectedCount > 1 ? (
                            <span className="pill amber">{d.injectedCount}</span>
                          ) : (
                            <span className="mono">{d.injectedCount}</span>
                          )}
                          {d.injectedNames.length ? (
                            <span className="muted" style={{ fontSize: 12 }}> {d.injectedNames.join(", ")}</span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="mono" title={d.userAgent ?? undefined}>{d.buildId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
