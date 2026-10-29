"use client";

/**
 * Admin → Sparky Broker mint whitelist applications.
 *
 * This is the list an operator exports to the SeaDrop GTD/FCFS allowlist. It is deliberately
 * SEPARATE from the access applications above: approving an access application grants the `beta`
 * role, while a mint whitelist request grants an on-chain allowlist spot — different decisions,
 * different people. There is no approve/deny button here because nothing in this app is the
 * on-chain allowlist; a status flip that did not change SeaDrop would be a lie.
 *
 * READ-ONLY. Fetches through the same-origin BFF (`/api/agent/admin/access/mint-whitelist`), where
 * the agent gates the route on the admin role (a non-admin gets 404, not 403).
 */

import { useCallback, useEffect, useState } from "react";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";
import { toCsv } from "@/lib/csv";

interface MintWhitelistRow {
  address: string;
  contact: string;
  name: string;
  reason: string;
  submittedAt: string;
}

const CHAIN_HEADERS = { "x-chain-id": APP_CHAIN_ID_HEADER };

/** RFC-4180-ish CSV: quote every field, double embedded quotes and neutralize spreadsheet
 *  formulas. Addresses are hex; the rest is free text an applicant typed (unauthenticated), so it
 *  must never be interpreted as a formula by a spreadsheet. */
function rowsToCsv(rows: MintWhitelistRow[]): string {
  return toCsv([
    ["address", "name", "contact", "reason", "submittedAt"],
    ...rows.map((r) => [r.address, r.name, r.contact, r.reason, r.submittedAt]),
  ]);
}

function downloadCsv(rows: MintWhitelistRow[]): void {
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sparky-broker-mint-whitelist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MintWhitelistPanel() {
  const [rows, setRows] = useState<MintWhitelistRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/admin/access/mint-whitelist?limit=500", {
        headers: CHAIN_HEADERS,
        cache: "no-store",
      });
      // 404 = this agent predates the feature (migration 0042 not applied): show the empty state,
      // never an error — the rest of the page must keep working.
      setRows(r.ok ? (((await r.json()).applications ?? []) as MintWhitelistRow[]) : []);
    } catch {
      setRows([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const copyAddresses = useCallback(async () => {
    setNote(null);
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.address).join("\n"));
      setNote(`Copied ${rows.length} address${rows.length === 1 ? "" : "es"}.`);
    } catch {
      setNote("Clipboard blocked — use Download CSV instead.");
    }
  }, [rows]);

  return (
    <div className="chartcard" style={{ marginTop: 14 }}>
      <div className="ch">
        <span className="ct">
          Mint whitelist applications <span className="prov">{rows.length}</span>
        </span>
        <span className="prov">Sparky Broker · GTD/FCFS · 5,555</span>
      </div>
      <div style={{ padding: "4px 2px" }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            padding: "8px",
          }}
        >
          <button
            className="btn btn-primary btn-sm"
            disabled={rows.length === 0}
            onClick={() => void copyAddresses()}
          >
            Copy addresses
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(rows)}
          >
            Download CSV
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Upload the addresses to the SeaDrop GTD/FCFS allowlist. Read-only here — nothing in
            this app adds anyone on-chain.
          </span>
          {note && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              {note}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
            {loaded ? "No mint whitelist applications yet." : "Loading…"}
          </div>
        ) : (
          rows.map((a) => (
            <div key={a.address} style={{ padding: "10px 8px", borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 12.5, flex: "1 1 320px", wordBreak: "break-all" }}>
                  {a.address}
                </span>
                <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                  {a.submittedAt ? new Date(a.submittedAt).toLocaleString() : ""}
                </span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                <span>
                  <span className="muted">Name / alias: </span>
                  {a.name}
                </span>
                <span>
                  <span className="muted">Contact: </span>
                  {a.contact}
                </span>
                <span style={{ lineHeight: 1.5 }}>
                  <span className="muted">Why: </span>
                  {a.reason}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
