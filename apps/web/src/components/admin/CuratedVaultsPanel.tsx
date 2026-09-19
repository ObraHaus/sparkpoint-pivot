"use client";

/**
 * 048 — Admin → Vaults → Curated. The human half of AI-curated vaults.
 *
 * The curator runner discovers and screens vaults off-chain and reports them to the agent; this
 * panel is where a person reviews that report and decides what the public `/vault` board shows.
 * Every autonomous action has a manual equivalent here (FR-007): approve, deny, pin, hide, edit,
 * add by address, run discovery now, and read the audit.
 *
 * ⚠️ "Run now" is a REQUEST, not a command. The runner is a keyless process with its own schedule;
 * the agent stores a marker it reads on its next poll. This panel must never grow the ability to
 * make that process act — the same line `admin_bots`/`BotsPanel` hold.
 *
 * Default posture: **AI proposes, admin publishes.** With auto-publish off, a run lands as
 * candidates and an invisible proposal; nothing reaches the public board until a person approves
 * (or pins) it.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";
import { CAP_DEFAULTS, toRawCaps } from "@/lib/curation/caps";
import {
  auditLine,
  candidateQueue,
  curationStatusLabel,
  curationStatusTone,
  curatorLabel,
  curatorRunLabel,
  curatorRunState,
  fmtApyBps,
  fmtUsdCompact,
  fmtWhen,
  screeningFailures,
  shortAddr,
  type CurationAdminData,
  type CurationVault,
} from "@/lib/curation/model";

const API = "/api/agent/admin/vaults/curation";
const WRAPPERS_API = "/api/agent/admin/vaults/wrappers";
const HEADERS = {
  "content-type": "application/json",
  "x-chain-id": APP_CHAIN_ID_HEADER,
};

type WrapperDeployment = {
  id: string;
  childAddress: string;
  status: "requested" | "deployed" | "failed" | "cancelled";
  label: string;
  name: string;
  symbol: string;
  feeBps: number;
  proxyAddress: string | null;
  txHash: string | null;
  error: string | null;
  requestedAt: string | null;
  reportedAt: string | null;
};

type WrapperList = { deployments: WrapperDeployment[]; pending: number };

async function wrapperCall(path: string, body?: unknown): Promise<WrapperList | null> {
  const res = await fetch(`${WRAPPERS_API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as WrapperList;
}

const WRAPPER_STATUS_TONE: Record<WrapperDeployment["status"], string> = {
  requested: "amber",
  deployed: "ok",
  failed: "bad",
  cancelled: "info",
};

/**
 * T504 — wrapper provenance + the deploy request queue.
 *
 * ⚠️ Requesting is not deploying: the row is a marker the keyless agent serves to the deterministic
 * deploy runner (which holds the scoped, deploy-only key; the factory enforces allowlist/fee/caps).
 * The runner reports back and, on success, the curated row flips to the wrapper deposit rail (T501).
 */
function WrapperDeploymentsCard({
  vaults,
  reloadKey,
  onChanged,
  onError,
}: {
  vaults: CurationVault[];
  reloadKey: number;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [list, setList] = useState<WrapperList | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const approved = vaults.filter((v) => v.status === "approved" && !v.wrapped);
  const [child, setChild] = useState("");
  const [feeBps, setFeeBps] = useState("1000");
  const [perUser, setPerUser] = useState<string>(CAP_DEFAULTS.perUser);
  const [total, setTotal] = useState<string>(CAP_DEFAULTS.total);
  const [vaultCap, setVaultCap] = useState<string>(CAP_DEFAULTS.vault);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    let live = true;
    fetch(WRAPPERS_API, { headers: HEADERS, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((next: WrapperList) => {
        if (live) setList(next);
      })
      .catch(() => {
        if (live) setList(null);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const selected = approved.find((v) => v.address === child);
  const decimals = selected?.asset.decimals ?? 6;
  const capsOk = [perUser, total, vaultCap].every((v) => toRawCaps(v, decimals) !== null);
  const feeOk = /^\d+$/.test(feeBps) && Number(feeBps) >= 0 && Number(feeBps) <= 2000;
  const valid =
    Boolean(selected) && capsOk && feeOk && name.trim() !== "" && symbol.trim() !== "" && label.trim() !== "";

  const pick = (address: string) => {
    setChild(address);
    const vault = approved.find((v) => v.address === address);
    if (!vault) return;
    const base = (vault.asset.symbol ?? "USDG").replace(/[^A-Za-z0-9]/g, "");
    setName(vault.label);
    setSymbol(`sp${base}`.slice(0, 20));
    setLabel(`${vault.label} · SparkPoint wrapper`);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await wrapperCall("/request", {
        childAddress: child,
        feeBps: Number(feeBps),
        perUserCap: toRawCaps(perUser, decimals),
        totalCap: toRawCaps(total, decimals),
        vaultCap: toRawCaps(vaultCap, decimals),
        name: name.trim(),
        symbol: symbol.trim(),
        label: label.trim(),
      });
      setOpen(false);
      setChild("");
      onChanged();
    } catch {
      onError("Couldn’t queue that wrapper deployment.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await wrapperCall("/cancel", { id });
      onChanged();
    } catch {
      onError("Couldn’t cancel that request.");
    } finally {
      setBusy(false);
    }
  };

  const deployments = list?.deployments ?? [];

  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">Wrapper deployments</span>
        <span className="prov">
          {list ? `${list.pending} pending · ${deployments.length} total` : "unavailable"}
        </span>
      </div>
      <div style={{ padding: "2px 2px 8px", fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
        A request is a marker, not authority: the deploy runner executes it with the scoped,
        deploy-only key, and the factory enforces the allowlist, the 20% fee cap and the caps
        bounds on-chain. The wrapper becomes depositable on <b>/vault</b> only after the runner
        reports the deployed proxy.
      </div>

      {approved.length > 0 && (
        <div style={{ padding: "0 2px 10px" }}>
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setOpen(!open)}>
            {open ? "Close request form" : "Request wrapper deployment"}
          </button>
        </div>
      )}

      {open && (
        <div style={{ display: "grid", gap: 8, padding: "0 2px 12px", maxWidth: 640 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Approved vault (child)</span>
            <select className="input" value={child} onChange={(e) => pick(e.target.value)}>
              <option value="">Select an approved vault…</option>
              {approved.map((v) => (
                <option key={v.address} value={v.address}>
                  {v.label} · {shortAddr(v.address)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>
              Performance fee (bps · ≤ 2000; policy default 1000 = 10% of gains above the
              high-water mark)
            </span>
            <input className="input mono" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>
                Per-user cap ({selected?.asset.symbol ?? "asset"})
              </span>
              <input className="input mono" value={perUser} onChange={(e) => setPerUser(e.target.value)} />
            </label>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Total cap</span>
              <input className="input mono" value={total} onChange={(e) => setTotal(e.target.value)} />
            </label>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Vault cap</span>
              <input className="input mono" value={vaultCap} onChange={(e) => setVaultCap(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Wrapper name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Symbol</span>
              <input className="input mono" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </label>
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Label</span>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Caps default to the CapRegistry defaults (5,000 per user · 1,000,000 total/vault) and can
            never exceed its ceilings (10,000 · 5,000,000). Zero blocks deposits.
          </div>
          <div>
            <button className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={() => void submit()}>
              Queue deployment
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th>Wrapper</th>
              <th>Child</th>
              <th>Fee</th>
              <th>Status</th>
              <th>Result</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                  {list === null ? "No wrapper deployments (or this build predates the queue)." : "No wrapper deployments yet."}
                </td>
              </tr>
            ) : (
              deployments.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.label}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {d.symbol}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{shortAddr(d.childAddress)}</td>
                  <td className="mono tnum">{(d.feeBps / 100).toFixed(2)}%</td>
                  <td>
                    <span className={`pill ${WRAPPER_STATUS_TONE[d.status]}`}>{d.status}</span>
                    {d.requestedAt ? (
                      <div className="muted" style={{ fontSize: 11 }}>{fmtWhen(d.requestedAt)}</div>
                    ) : null}
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {d.status === "deployed" && d.proxyAddress ? (
                      <div>
                        wrapper {shortAddr(d.proxyAddress)}
                        {d.txHash ? <div className="muted">tx {shortAddr(d.txHash)}</div> : null}
                      </div>
                    ) : d.status === "failed" ? (
                      <span style={{ color: "var(--destructive)" }}>{d.error ?? "failed"}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {d.status === "requested" && (
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void cancel(d.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


async function call(path: string, body?: unknown): Promise<CurationAdminData | null> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as CurationAdminData;
}

function VaultRow({
  vault,
  onAction,
  busy,
  onEdit,
  editing,
}: {
  vault: CurationVault;
  onAction: (path: string, body: unknown) => void;
  busy: boolean;
  onEdit?: () => void;
  editing?: boolean;
}) {
  const failures = screeningFailures(vault);
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{vault.label}</div>
        <div className="muted mono" style={{ fontSize: 11 }}>
          {shortAddr(vault.address)}
          {vault.pinned ? " · pinned" : ""}
        </div>
      </td>
      <td className="mono">{vault.asset.symbol ?? "—"}</td>
      <td className="mono tnum">{vault.score ?? "—"}</td>
      <td className="mono tnum">{fmtApyBps(vault.netApyBps)}</td>
      <td className="mono tnum">{fmtUsdCompact(vault.tvlUsd)}</td>
      <td>
        <div>{curatorLabel(vault)}</div>
        {!vault.curatorVerified && vault.curator ? <div className="muted" style={{ fontSize: 11 }}>unverified</div> : null}
      </td>
      <td>
        <span className={`pill ${curationStatusTone(vault.status)}`}>{curationStatusLabel(vault.status)}</span>
        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
          {vault.provenance === "admin" ? "admin-owned" : "AI"}
        </div>
        {vault.wrapped && vault.wrapperAddress ? (
          <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
            wrapped · {shortAddr(vault.wrapperAddress)}
          </div>
        ) : null}
        {failures.length > 0 && (
          <div className="muted" style={{ fontSize: 11 }} title={failures.map((f) => `${f.code}: ${f.detail}`).join("\n")}>
            failed: {failures.map((f) => f.code).join(", ")}
          </div>
        )}
      </td>
      <td>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {vault.status !== "approved" && (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAction("/approve", { address: vault.address })}>
              Approve
            </button>
          )}
          {vault.status !== "denied" && (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAction("/deny", { address: vault.address })}>
              Deny
            </button>
          )}
          {vault.status !== "hidden" && (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAction("/hide", { address: vault.address })}>
              Hide
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => onAction("/pin", { address: vault.address, pinned: !vault.pinned })}
          >
            {vault.pinned ? "Unpin" : "Pin as pick"}
          </button>
          {onEdit && (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={onEdit}>
              {editing ? "Close editor" : "Edit"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EditForm({
  vault,
  onDone,
  onError,
}: {
  vault: CurationVault;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState(vault.label);
  const [curator, setCurator] = useState(vault.curator ?? "");
  const [note, setNote] = useState(vault.adminNote ?? "");
  const [wrapped, setWrapped] = useState(vault.wrapped);
  const [wrapperAddress, setWrapperAddress] = useState(vault.wrapperAddress ?? "");
  const [busy, setBusy] = useState(false);
  // The server enforces this too (and the DB CHECK backs it up); the form just refuses to submit
  // a wrapped vault with no wrapper address, which would attach a fee to nothing.
  const wrapperOk = !wrapped || /^0x[0-9a-fA-F]{40}$/.test(wrapperAddress.trim());

  const save = async () => {
    setBusy(true);
    try {
      await call("/edit", {
        address: vault.address,
        label,
        curator: curator || null,
        admin_note: note || null,
        wrapped,
        wrapper_address: wrapped ? wrapperAddress.trim() || null : null,
        deposit_mode: wrapped ? "wrapper" : "direct",
      });
      onDone();
    } catch {
      onError("Couldn’t save that edit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chartcard" style={{ marginTop: 10 }}>
      <div className="ch">
        <span className="ct">Edit {vault.label}</span>
        <span className="prov mono">{shortAddr(vault.address)}</span>
      </div>
      <div style={{ display: "grid", gap: 8, padding: "4px 2px" }}>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Label</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Curator (name or address)</span>
          <input className="input" value={curator} onChange={(e) => setCurator(e.target.value)} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Admin note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={wrapped} onChange={(e) => setWrapped(e.target.checked)} />
          <span>SparkPoint fee wrapper deployed for this vault</span>
        </label>
        {wrapped && (
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Wrapper address</span>
            <input
              className="input mono"
              value={wrapperAddress}
              placeholder="0x…"
              onChange={(e) => setWrapperAddress(e.target.value)}
            />
          </label>
        )}
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          Editing marks the vault <b>admin-owned</b>: future scans refresh its numbers but never
          overwrite this metadata, and they never change its status.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !wrapperOk} onClick={() => void save()}>
            Save
          </button>
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AddForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [symbol, setSymbol] = useState("USDC");
  const [busy, setBusy] = useState(false);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim()) && label.trim().length > 0;

  const add = async () => {
    setBusy(true);
    try {
      await call("/add", {
        address: address.trim(),
        label: label.trim(),
        asset_symbol: symbol.trim() || null,
        wrapped: false,
        deposit_mode: "direct",
      });
      onDone();
    } catch {
      onError("Couldn’t add that vault — check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">Add by address</span>
        <span className="prov">off-chain — no transaction</span>
      </div>
      <div style={{ display: "grid", gap: 8, padding: "4px 2px" }}>
        <input className="input mono" placeholder="0x vault address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <input className="input" placeholder="Label shown on /vault" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" placeholder="Asset symbol (USDC)" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          Added approved and admin-owned. A wrapped deposit rail is configured from the table edit —
          only after an operator has actually deployed the wrapper.
        </div>
        <div>
          <button className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={() => void add()}>
            Add vault
          </button>
        </div>
      </div>
    </div>
  );
}

export function CuratedVaultsPanel() {
  const [data, setData] = useState<CurationAdminData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped after a successful action (and after an edit/add) to re-read the panel. The effect owns
  // the fetch so setState happens only in its promise callbacks, and the 30s poll keeps the
  // last-run/failure state current without a manual reload.
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(API, { headers: HEADERS, cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((next: CurationAdminData) => {
          if (!live) return;
          setData(next);
          setState("ok");
        })
        .catch(() => {
          if (live) setState("error");
        });
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [reloadKey]);

  const act = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setNotice(null);
      try {
        await call(path, body);
        refresh();
      } catch {
        setNotice("That action didn’t go through. Nothing changed.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const run = data ? curatorRunState(data) : "never-run";
  const queue = candidateQueue(data?.vaults ?? []);
  const others = (data?.vaults ?? []).filter((v) => v.status !== "candidate");
  const pick = data?.recommendation;
  const pickVault = data?.vaults.find((v) => v.address === pick?.pickAddress);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Curated vaults</h1>
          <div className="sub">
            What Sparky found, what it recommends, and what the public board shows. Curation is
            off-chain: adding or removing a vault is a row here, never a transaction.
          </div>
        </div>
        <span className={`pill ${run === "failed" ? "bad" : run === "requested" ? "amber" : run === "ok" ? "ok" : "info"}`}>
          <span className="led" />
          {data?.autoPublish ? "Auto-publish on" : "AI proposes · admin publishes"}
        </span>
      </div>

      {state === "error" && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          Couldn’t load the curation state. The curator may still be running — this is a read.
        </div>
      )}
      {notice && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          {notice}
        </div>
      )}

      <div className="chartcard">
        <div className="ch">
          <span className="ct">Discovery</span>
          <span className="prov">{curatorRunLabel(data ?? { lastRunAt: null, lastRunOk: null })}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "2px 2px 8px" }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || run === "requested"}
            onClick={() => void act("/run-now", {})}
          >
            {run === "requested" ? "Run requested" : "Run discovery now"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={data?.autoPublish ?? false}
              disabled={busy}
              onChange={(e) => void act("/auto-publish", { enabled: e.target.checked })}
            />
            Auto-publish Sparky’s pick
          </label>
          {data?.lastFailedAt && (
            <span className="muted" style={{ fontSize: 12 }}>
              Last failure {fmtWhen(data.lastFailedAt)}
              {data.lastFailedDetail?.error ? `: ${String(data.lastFailedDetail.error)}` : ""}
            </span>
          )}
        </div>
        {run === "requested" && (
          <div className="muted" style={{ fontSize: 12, padding: "0 2px 8px" }}>
            The keyless curator picks this up on its next poll (≤ 5 minutes). The agent cannot make
            it run — that boundary is deliberate.
          </div>
        )}
      </div>

      {pick && (
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Sparky’s proposal</span>
            <span className={`pill ${pick.published ? "ok" : "info"}`}>
              {pick.published ? "Published" : "Not published"}
            </span>
          </div>
          <div style={{ padding: "2px 2px 8px" }}>
            <div style={{ fontWeight: 600 }}>
              {pickVault?.label ?? shortAddr(pick.pickAddress)}
              {pickVault ? <span className="mono muted" style={{ fontSize: 12 }}> · {shortAddr(pick.pickAddress)}</span> : null}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "4px 0" }}>{pick.pickReason}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              as of {fmtWhen(pick.asOf)} · {pick.alternates.length} alternate(s)
              {pick.published ? "" : " · approve or pin a vault to publish"}
            </div>
          </div>
        </div>
      )}

      <div className="chartcard">
        <div className="ch">
          <span className="ct">Candidate queue</span>
          <span className="prov">{queue.length} waiting</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 820 }}>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Asset</th>
                <th>Score</th>
                <th>Net APY</th>
                <th>TVL</th>
                <th>Curator</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                    {state === "loading" ? "Loading…" : "Nothing waiting — no screened candidates."}
                  </td>
                </tr>
              ) : (
                queue.map((v) => (
                  <VaultRow key={v.address} vault={v} onAction={(p, b) => void act(p, b)} busy={busy} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chartcard">
        <div className="ch">
          <span className="ct">Curated list</span>
          <span className="prov">approved · hidden · denied</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 820 }}>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Asset</th>
                <th>Score</th>
                <th>Net APY</th>
                <th>TVL</th>
                <th>Curator</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {others.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                    {state === "loading" ? "Loading…" : "No decided vaults yet."}
                  </td>
                </tr>
              ) : (
                others.map((v) => (
                  <Fragment key={v.address}>
                    <VaultRow
                      vault={v}
                      onAction={(p, b) => void act(p, b)}
                      busy={busy}
                      editing={editing === v.address}
                      onEdit={() => setEditing(editing === v.address ? null : v.address)}
                    />
                    {editing === v.address && (
                      <tr>
                        <td colSpan={8} style={{ background: "var(--muted)" }}>
                          <EditForm
                            vault={v}
                            onDone={() => {
                              setEditing(null);
                              refresh();
                            }}
                            onError={setNotice}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <WrapperDeploymentsCard
        vaults={others}
        reloadKey={reloadKey}
        onChanged={refresh}
        onError={setNotice}
      />

      <AddForm onDone={refresh} onError={setNotice} />

      <div className="chartcard">
        <div className="ch">
          <span className="ct">Audit</span>
          <span className="prov">newest first</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 520 }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(data?.audit ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                    {state === "loading" ? "Loading…" : "Nothing recorded yet."}
                  </td>
                </tr>
              ) : (
                (data?.audit ?? []).map((entry, i) => (
                  <tr key={`${entry.at}:${i}`}>
                    <td>{fmtWhen(entry.at)}</td>
                    <td>{auditLine(entry)}</td>
                    <td className="muted mono" style={{ fontSize: 11 }}>
                      {Object.keys(entry.detail ?? {}).length > 0 ? JSON.stringify(entry.detail) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
        Curation is off-chain and AI-assisted; an admin can always override it, and every override
        is audited above. Figures are as-of the stored scan — never projections.
      </div>
    </>
  );
}
