"use client";

/**
 * 035 — the original /admin/vaults screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → Vaults (feature 011 — the MANAGE half of /admin/vaults).
 *
 * Since 010's read-only half isn't built yet, this page carries BOTH halves:
 *   - a READ section listing the branded Morpho wrappers + their live on-chain state
 *     (GET /api/agent/admin/vaults);
 *   - the MANAGE half: a create-vault form (validates the on-chain curated allowlist, shows the
 *     predicted CREATE2 address), an allowlist-vetting form, and a guardian-action panel
 *     (pause / unpause / setFee / setFeeRecipient / adjust caps).
 *
 * 024 / T033 — MULTI-CHAIN STATUS, stated plainly rather than half-built.
 *
 * `GET /admin/vaults` has always returned rows for EVERY chain, but this page rendered them with no
 * chain label and a chain-blind explorer link, so a Base-mainnet row looked like a broken
 * Base-Sepolia row and linked into the wrong explorer. Both are fixed: each row now names its own
 * chain, links via the shared chain registry (plain text when a chain has no explorer), and says
 * explicitly when live reads are simply out of scope for it rather than failing.
 *
 * `CHAIN_ID` below is still a constant, and that is deliberate — a chain SELECTOR here would be
 * dishonest until two agent-side blockers are cleared, because it would offer chains the backend
 * cannot serve:
 *   1. `SPARKPOINT_VAULT_FACTORY_ADDRESS` is a SINGLE global env in the agent
 *      (`api/admin_vaults.py`), so create/allowlist calldata would target the 84532 factory whatever
 *      the `x-chain-id` header said — prepared calldata for the wrong network is worse than none.
 *   2. `API_SUPPORTED_CHAIN_IDS = (8453, 84532, 46630)` (`api/security.py`) rejects Robinhood
 *      mainnet 4663 outright, so the chain v3.0.0 just ratified 400s at the door.
 * There is also a pre-existing gap a selector would make reachable: `CalldataCard.sign()` calls
 * `sendTransaction` with no `chainId`, so it broadcasts on whatever chain the wallet is on. Today
 * that happens to be the one chain this panel reads. Fixing all three is 024 Phase 5/6 work.
 *
 * NON-CUSTODY (N1/N2) — the invariant this page renders AND relies on:
 *   Every mutating action returns PREPARED CALLDATA the operator signs from their OWN wallet (or
 *   copies to sign off-app against the owner/timelock). This panel holds NO key and has NO fund
 *   path — the BFF never signs. The guardian-action enum is a CLOSED set with NO move-funds verb:
 *   there is deliberately no withdraw / sweep / migrate / transfer action anywhere. This mirrors the
 *   read-only kill-switch page's honest "guardian action performed off-app / this panel holds no
 *   key" framing and reuses the same signing UX (the operator's own wallet, never a server key).
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAccount, useSendTransaction } from "wagmi";
import type { Address, Hex } from "viem";
import { Icon } from "@/lib/icons";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { chainName } from "@sparkpoint/shared/chains";

const API = "/api/agent/admin/vaults";
const CHAIN_ID = "84532";
const CHAIN = { "x-chain-id": CHAIN_ID } as const;

/** The CLOSED guardian-action enum — NO fund-moving verb exists (mirrors the agent's enum). */
const GUARDIAN_ACTIONS = ["pause", "unpause", "setFee", "setFeeRecipient", "setCaps"] as const;
type GuardianAction = (typeof GUARDIAN_ACTIONS)[number];

interface Calldata {
  to: string;
  data: string;
  value?: string;
}
interface ChainState {
  paused: boolean;
  guardian: string;
  performanceFeeBps: number;
  feeRecipient: string;
  morphoVault: string;
  capRegistry: string;
  label: string;
  caps: { perUserCap: number; totalCap: number; vaultCap: number };
}
interface WrapperRow {
  vault_address: string;
  chain_id: number;
  kind: string;
  label: string;
  morpho_vault: string | null;
  native_fee_bps: number | null;
  status: string;
  chainState: ChainState | null;
}
interface VaultsResponse {
  vaults: WrapperRow[];
  factory: { address: string | null; owner: string | null; onChainRegistry: string[] | null };
  chainConfigured: boolean;
  guardianActions: string[];
  noMoveFundsAction: boolean;
}

interface ApiErr {
  error?: { code?: string; message?: string };
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...CHAIN },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await r.json()) as Record<string, unknown> & ApiErr;
  if (!r.ok) {
    throw new Error(json.error?.message ?? `Request failed (${r.status}).`);
  }
  return json;
}

const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
/**
 * 024 — chain-AWARE explorer link. This was `https://sepolia.basescan.org/address/${a}` for every
 * row, but `GET /admin/vaults` returns rows for EVERY chain (the store has no WHERE clause), so a
 * Base-mainnet wrapper rendered a link into Sepolia's explorer — a confidently wrong reference.
 * Returns `undefined` for a chain with no explorer so the caller renders plain text, never a
 * fabricated URL (Principle III).
 */
const scan = (chainId: number | undefined, a: string) => explorerAddressUrl(chainId, a);

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
  width: "100%",
};
const labelStyle: CSSProperties = { fontSize: 12, color: "var(--muted-foreground)", marginBottom: 4 };

/** Prepared-calldata card — the ONE way any action leaves this panel: copy, or sign with your own
 *  wallet. There is no server key; this component can never move funds on its own. */
function CalldataCard({ title, call }: { title: string; call: Calldata }) {
  const { isConnected } = useAccount();
  const { sendTransaction, data: txHash, isPending, error } = useSendTransaction();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(call, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sign = () => {
    sendTransaction({
      to: call.to as Address,
      data: call.data as Hex,
      value: BigInt(call.value ?? "0"),
    });
  };

  return (
    <div className="panel" style={{ marginTop: 10, borderColor: "color-mix(in srgb,var(--primary) 22%,transparent)" }}>
      <div className="ch" style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="ct">{title}</span>
        <span className="prov">prepared calldata · sign off-app</span>
      </div>
      <div className="statusrow">
        <span className="muted">To</span>
        {/* Prepared calldata is always built for the chain this panel is scoped to, so the target
            resolves on THAT chain's explorer — not on whichever chain a row happened to be from. */}
        {scan(Number(CHAIN_ID), call.to) ? (
          <a
            className="mono"
            style={{ fontSize: 11, color: "var(--primary)" }}
            href={scan(Number(CHAIN_ID), call.to)}
            target="_blank"
            rel="noreferrer"
          >
            {short(call.to)} <Icon name="ext" size={11} />
          </a>
        ) : (
          <span className="mono" style={{ fontSize: 11 }}>{short(call.to)}</span>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={labelStyle}>Calldata (data)</div>
        <code className="mono" style={{ display: "block", fontSize: 10.5, wordBreak: "break-all", lineHeight: 1.5, color: "var(--foreground)" }}>
          {call.data}
        </code>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn-exp" onClick={copy} style={{ fontSize: 12.5, padding: "8px 12px" }}>
          <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy calldata"}
        </button>
        <button
          className="btn-exp"
          onClick={sign}
          disabled={!isConnected || isPending}
          title={isConnected ? "Sign with your connected wallet (must be the owner/timelock)" : "Connect the owner/timelock wallet to sign"}
          style={{ fontSize: 12.5, padding: "8px 12px", opacity: isConnected ? 1 : 0.55 }}
        >
          <Icon name="key" size={13} /> {isPending ? "Signing…" : "Sign with your wallet"}
        </button>
        {txHash && (
          <span className="pill ok" style={{ fontSize: 10 }}>submitted · {short(txHash)}</span>
        )}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--loss, #e5484d)" }}>{error.message}</div>}
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        This panel holds no key. Signing uses <b>your own wallet</b> — the owner/timelock — or copy the
        calldata to sign off-app. The server never signs and never holds funds.
      </div>
    </div>
  );
}

export function VaultConfigPanel() {
  const [data, setData] = useState<VaultsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API, { headers: CHAIN, cache: "no-store" });
      const json = (await r.json()) as VaultsResponse & ApiErr;
      if (!r.ok) throw new Error(json.error?.message ?? `Failed to load (${r.status}).`);
      setData(json);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Vaults</h1>
          <div className="sub">Create + govern branded Morpho wrappers. Every action is prepared calldata you sign off-app — this panel holds no key.</div>
        </div>
        <span className="pill info">
          <span className="led" /> Non-custodial · prepare-only
        </span>
      </div>

      {/* The invariant, rendered explicitly (US4). */}
      <div
        className="infobanner"
        style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
      >
        <Icon name="lock" size={16} />
        <span>
          <b style={{ color: "var(--foreground)" }}>No move-funds action exists.</b> The only admin
          verbs are <b style={{ color: "var(--foreground)" }}>create</b>, <b style={{ color: "var(--foreground)" }}>allowlist</b>,
          and the guardian actions <b style={{ color: "var(--foreground)" }}>pause / unpause / setFee / setFeeRecipient / setCaps</b> —
          there is deliberately no withdraw, sweep, migrate, or transfer. Each returns calldata you
          sign from the owner/timelock wallet; the server never signs and can never touch user funds.
          Withdrawals (N2) stay open on-chain at all times.
        </span>
      </div>

      {/* READ — the registered wrappers + live state. */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ch" style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span className="ct">Registered wrappers</span>
          <span className="prov">{data ? (data.chainConfigured ? "live on-chain reads" : "provenance rows only — no RPC") : "loading"}</span>
        </div>
        {loading && <div className="muted" style={{ fontSize: 12.5 }}>Reading chain…</div>}
        {loadErr && <div style={{ fontSize: 12.5, color: "var(--loss, #e5484d)" }}>{loadErr}</div>}
        {data && data.vaults.length === 0 && !loading && (
          <div className="muted" style={{ fontSize: 12.5 }}>No branded wrappers yet. Create one below.</div>
        )}
        {data?.vaults.map((v) => (
          <div key={`${v.chain_id}-${v.vault_address}`} className="panel" style={{ marginBottom: 10, background: "var(--surface-2, transparent)" }}>
            <div className="statusrow">
              <span style={{ fontWeight: 600 }}>{v.label}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {/* 024 — the row's OWN chain. Rows for other chains were previously rendered with no
                    chain label and a null chainState, which read as "broken" rather than
                    "not the chain this panel is reading". */}
                <span className="pill" style={{ fontSize: 10 }}>
                  {chainName(v.chain_id)}
                </span>
                <span className={`pill ${v.status === "live" ? "ok" : "amber"}`} style={{ fontSize: 10 }}>{v.status}</span>
              </span>
            </div>
            {v.chain_id !== Number(CHAIN_ID) && (
              <div className="statusrow">
                <span className="muted" style={{ fontSize: 11 }}>
                  Live on-chain reads are scoped to {chainName(Number(CHAIN_ID))}, so this row shows
                  its stored record only — not a failed read.
                </span>
              </div>
            )}
            <div className="statusrow">
              <span className="muted">Wrapper</span>
              {scan(v.chain_id, v.vault_address) ? (
                <a
                  className="mono"
                  style={{ fontSize: 11, color: "var(--primary)" }}
                  href={scan(v.chain_id, v.vault_address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(v.vault_address)} <Icon name="ext" size={11} />
                </a>
              ) : (
                <span className="mono" style={{ fontSize: 11 }}>{short(v.vault_address)}</span>
              )}
            </div>
            <div className="statusrow">
              <span className="muted">Wrapped Morpho vault</span>
              <span className="mono" style={{ fontSize: 11 }}>{short(v.morpho_vault)}</span>
            </div>
            <div className="statusrow">
              <span className="muted">Fees (SparkPoint · Morpho native)</span>
              <span style={{ fontSize: 12 }}>
                {v.chainState ? `${(v.chainState.performanceFeeBps / 100).toFixed(2)}%` : "—"} ·{" "}
                {v.native_fee_bps !== null ? `${(v.native_fee_bps / 100).toFixed(2)}%` : "—"}
              </span>
            </div>
            {v.chainState && (
              <div className="statusrow">
                <span className="muted">Deposits</span>
                <span className={`pill ${v.chainState.paused ? "amber" : "ok"}`} style={{ fontSize: 10 }}>
                  {v.chainState.paused ? "paused" : "open"}
                </span>
              </div>
            )}
          </div>
        ))}
        {data?.factory.address && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted-foreground)" }}>
            Factory <span className="mono">{short(data.factory.address)}</span>
            {data.factory.owner ? <> · owner (timelock) <span className="mono">{short(data.factory.owner)}</span></> : null}
          </div>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <CreateForm onDone={load} disabled={!data?.chainConfigured} />
        <AllowlistForm onDone={load} />
      </div>

      <GuardianPanel vaults={data?.vaults ?? []} />
    </>
  );
}

/** Create a branded wrapper — validates the curated allowlist, shows the predicted CREATE2 address. */
function CreateForm({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const [morphoVault, setMorphoVault] = useState("");
  const [feeBps, setFeeBps] = useState("1000");
  const [perAddressCap, setPerAddressCap] = useState("0");
  const [totalCap, setTotalCap] = useState("0");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ predictedAddress: string; calldata: Calldata } | null>(null);

  const submit = async () => {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const json = await post("/create", {
        morphoVault: morphoVault.trim(),
        feeBps: Number(feeBps),
        caps: { perAddressCap: Number(perAddressCap), totalCap: Number(totalCap) },
        label: label.trim(),
        chainId: Number(CHAIN_ID),
      });
      setResult({
        predictedAddress: String(json.predictedAddress),
        calldata: json.calldata as Calldata,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="ch" style={{ marginBottom: 12 }}>
        <span className="ct">Create branded wrapper</span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={labelStyle}>Curated Morpho vault (must be allowlisted)</div>
          <input style={inputStyle} placeholder="0x…" value={morphoVault} onChange={(e) => setMorphoVault(e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>Performance fee (bps · hard cap 2000 = 20%)</div>
          <input style={inputStyle} inputMode="numeric" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Per-address cap (base units)</div>
            <input style={inputStyle} inputMode="numeric" value={perAddressCap} onChange={(e) => setPerAddressCap(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Total cap (base units)</div>
            <input style={inputStyle} inputMode="numeric" value={totalCap} onChange={(e) => setTotalCap(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={labelStyle}>Branded label</div>
          <input style={inputStyle} placeholder="SparkPoint · Steakhouse USDC" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn-exp" onClick={submit} disabled={busy || disabled} style={{ fontSize: 13, padding: "10px 14px" }}>
          <Icon name="plus" size={14} /> {busy ? "Preparing…" : "Prepare createVault"}
        </button>
        {disabled && <div className="muted" style={{ fontSize: 11.5 }}>Live reads unavailable — create needs an RPC-configured deployment to validate the allowlist.</div>}
        {err && <div style={{ fontSize: 12, color: "var(--loss, #e5484d)" }}>{err}</div>}
      </div>
      {result && (
        <>
          <div className="statusrow" style={{ marginTop: 12 }}>
            <span className="muted">Predicted CREATE2 address</span>
            <span className="mono" style={{ fontSize: 11 }}>{short(result.predictedAddress)}</span>
          </div>
          <CalldataCard title="createVault — sign from the owner/timelock" call={result.calldata} />
        </>
      )}
    </div>
  );
}

/** Vet + allowlist a curated Morpho vault (records the off-chain rationale + prepares calldata). */
function AllowlistForm({ onDone }: { onDone: () => void }) {
  const [morphoVault, setMorphoVault] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [nativeFeeBps, setNativeFeeBps] = useState("");
  const [vettingNotes, setVettingNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Calldata | null>(null);

  const submit = async () => {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const json = await post("/allowlist", {
        morphoVault: morphoVault.trim(),
        allowed,
        nativeFeeBps: nativeFeeBps ? Number(nativeFeeBps) : null,
        vettingNotes: vettingNotes.trim() || null,
      });
      setResult(json.calldata as Calldata);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="ch" style={{ marginBottom: 12 }}>
        <span className="ct">Curate + allowlist</span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={labelStyle}>Morpho vault to vet</div>
          <input style={inputStyle} placeholder="0x…" value={morphoVault} onChange={(e) => setMorphoVault(e.target.value)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
          Allowlisted (uncheck to prepare a revoke — blocks FUTURE deploys only; never touches an existing wrapper)
        </label>
        <div>
          <div style={labelStyle}>Native Morpho fee (bps · for the honest double-fee disclosure)</div>
          <input style={inputStyle} inputMode="numeric" placeholder="e.g. 100" value={nativeFeeBps} onChange={(e) => setNativeFeeBps(e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>Vetting notes (TVL, audit, oracle, market composition)</div>
          <textarea style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} rows={3} value={vettingNotes} onChange={(e) => setVettingNotes(e.target.value)} />
        </div>
        <button className="btn-exp" onClick={submit} disabled={busy} style={{ fontSize: 13, padding: "10px 14px" }}>
          <Icon name="shieldcheck" size={14} /> {busy ? "Preparing…" : "Prepare allowlist"}
        </button>
        {err && <div style={{ fontSize: 12, color: "var(--loss, #e5484d)" }}>{err}</div>}
      </div>
      {result && <CalldataCard title="allowlistMorphoVault — sign from the owner/timelock" call={result} />}
    </div>
  );
}

/** Guardian actions — pause/unpause/fee/recipient/caps as prepared Timelock schedule+execute calldata. */
function GuardianPanel({ vaults }: { vaults: WrapperRow[] }) {
  const [vault, setVault] = useState("");
  const [action, setAction] = useState<GuardianAction>("pause");
  const [feeBps, setFeeBps] = useState("1000");
  const [recipient, setRecipient] = useState("");
  const [perAddressCap, setPerAddressCap] = useState("0");
  const [totalCap, setTotalCap] = useState("0");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ schedule: Calldata; execute: Calldata; timelock: string; delaySeconds: number } | null>(null);

  const vaultOptions = useMemo(() => vaults.map((v) => v.vault_address), [vaults]);

  const submit = async () => {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const args: Record<string, unknown> = {};
      if (action === "setFee") args.feeBps = Number(feeBps);
      if (action === "setFeeRecipient") args.recipient = recipient.trim();
      if (action === "setCaps") {
        args.perAddressCap = Number(perAddressCap);
        args.totalCap = Number(totalCap);
      }
      const json = await post(`/${vault.trim()}/guardian-action`, { action, args });
      setResult({
        schedule: json.schedule as Calldata,
        execute: json.execute as Calldata,
        timelock: String(json.timelock),
        delaySeconds: Number(json.delaySeconds),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="ch" style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span className="ct">Guardian actions (timelocked)</span>
        <span className="prov">no move-funds verb exists</span>
      </div>
      <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
        <div>
          <div style={labelStyle}>Wrapper</div>
          {vaultOptions.length > 0 ? (
            <select className="sel" style={inputStyle} value={vault} onChange={(e) => setVault(e.target.value)}>
              <option value="">Select a wrapper…</option>
              {vaultOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          ) : (
            <input style={inputStyle} placeholder="0x… wrapper address" value={vault} onChange={(e) => setVault(e.target.value)} />
          )}
        </div>
        <div>
          <div style={labelStyle}>Action</div>
          <select className="sel" style={inputStyle} value={action} onChange={(e) => setAction(e.target.value as GuardianAction)}>
            {GUARDIAN_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {action === "setFee" && (
          <div>
            <div style={labelStyle}>New performance fee (bps · ≤ 2000)</div>
            <input style={inputStyle} inputMode="numeric" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} />
          </div>
        )}
        {action === "setFeeRecipient" && (
          <div>
            <div style={labelStyle}>New fee recipient (non-privileged holder)</div>
            <input style={inputStyle} placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </div>
        )}
        {action === "setCaps" && (
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Per-address cap</div>
              <input style={inputStyle} inputMode="numeric" value={perAddressCap} onChange={(e) => setPerAddressCap(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Total cap</div>
              <input style={inputStyle} inputMode="numeric" value={totalCap} onChange={(e) => setTotalCap(e.target.value)} />
            </div>
          </div>
        )}
        <button className="btn-exp" onClick={submit} disabled={busy || !vault.trim()} style={{ fontSize: 13, padding: "10px 14px" }}>
          <Icon name="pause" size={14} /> {busy ? "Preparing…" : "Prepare timelock action"}
        </button>
        {err && <div style={{ fontSize: 12, color: "var(--loss, #e5484d)" }}>{err}</div>}
      </div>
      {result && (
        <div style={{ marginTop: 8 }}>
          <div className="statusrow">
            <span className="muted">Guardian (timelock)</span>
            <span className="mono" style={{ fontSize: 11 }}>{short(result.timelock)}</span>
          </div>
          <div className="statusrow">
            <span className="muted">Timelock delay</span>
            <span style={{ fontSize: 12 }}>{result.delaySeconds}s</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", margin: "6px 0" }}>
            Two-step, timelocked: sign <b>schedule</b> now, then <b>execute</b> after the delay. Both
            are pause/param-only — neither can move funds.
          </div>
          <CalldataCard title="1 · schedule (queue the action)" call={result.schedule} />
          <CalldataCard title="2 · execute (after the delay)" call={result.execute} />
        </div>
      )}
    </div>
  );
}
