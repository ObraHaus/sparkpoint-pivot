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
import { AdmissionQueueCard } from "@/components/admin/AdmissionQueueCard";
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
const HEADERS = {
  "content-type": "application/json",
  "x-chain-id": APP_CHAIN_ID_HEADER,
};

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

      <AdmissionQueueCard reloadKey={reloadKey} onChanged={refresh} onError={setNotice} />

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
        is audited above. Figures reflect recent data; not projections.
      </div>
    </>
  );
}
