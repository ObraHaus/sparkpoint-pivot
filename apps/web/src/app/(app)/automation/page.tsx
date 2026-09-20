"use client";

/**
 * /automation — Session-key management, LIVE (US6). Reads your real grants from the deployed ERC-4337
 * account (SparkPointAccount + SessionKeyValidator + PolicyModule on Base Sepolia) via the agent BFF,
 * and lets you revoke instantly with a transaction you sign yourself. By default you sign every move;
 * any granted key is scoped, capped, time-boxed, and revocable by you instantly (a sacred exit).
 *
 * De-mocked from the design's `automation` screen: the `data.sessionKey` mock + the `mock` StatusTag
 * are retired. The "How session keys stay safe" rows are still reproduced verbatim.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Hex } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";
import { StatusTag } from "@/components/ui/status-tag";
import {
  useSessionKeys,
  useRevokeBuilder,
  useSessionKeyTx,
  useInvalidateSessionKeys,
  type SessionKeyGrant,
} from "@/lib/automation/useSessionKey";
import {
  bpsToPercent,
  buildRevokeTx,
  expiryCountdown,
  formatUsdcBaseUnits,
  selectorLabel,
} from "@/lib/automation/scope";
import { hasSessionKey, wipeSessionKey } from "@/lib/automation/sessionKeyStore";

const VAULT_CHAIN = VAULT_CHAIN_ID;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function explorerTx(hash: string): string | undefined {
  return explorerTxUrl(VAULT_CHAIN, hash as Hex);
}

const SAFE: [string, string][] = [
  ["Allowlist", "Can only touch the allowlisted vault — nothing else."],
  ["Per-tx + cumulative caps", "Bounded spend per action and in total."],
  ["Max slippage", "Trades stop if prices move against you."],
  ["Hard expiry", "Auto-expires; you set the window."],
  ["Instant revoke", "Cancel unilaterally on-chain — no Sparky cooperation needed."],
];

export default function Page() {
  const router = useRouter();
  const { active, account, online, isLoading, loaded, isError } = useSessionKeys();

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Automation{" "}
            <StatusTag
              variant="live"
              title="Your session-key grants are read live from your smart account on-chain; granting and revoking are real transactions you sign yourself."
            />
          </h1>
          <div className="sub">Opt-in, scoped, time-boxed — and revocable by you instantly.</div>
        </div>
      </div>

      {online && isLoading && !loaded ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: "36px 24px", marginBottom: 16, color: "var(--muted-foreground)", fontSize: 13 }}>
          Reading your session keys from chain…
        </div>
      ) : active ? (
        <GrantCard grant={active} account={account} />
      ) : (
        <EmptyCard error={online && isError} onGrant={() => router.push(toHref("automation/grant"))} />
      )}

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">How session keys stay safe</span>
        </div>
        {SAFE.map((r) => (
          <div className="statusrow" key={r[0]}>
            <span style={{ fontWeight: 600 }}>{r[0]}</span>
            <span className="muted" style={{ fontSize: 12.5, maxWidth: 300, textAlign: "right" }}>
              {r[1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyCard({ error, onGrant }: { error: boolean; onGrant: () => void }) {
  return (
    <div className="card card-pad" style={{ textAlign: "center", padding: "36px 24px", marginBottom: 16 }}>
      <div className="empty" style={{ padding: 0 }}>
        <span className="ei">
          <Icon name="zap" size={24} />
        </span>
        <div className="et">No active automation</div>
        <div className="eb">
          By default you sign every move. You can grant a scoped, capped, time-limited session key for hands-off
          rebalancing — and revoke it instantly, without our help.
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
            Couldn&apos;t read your grants just now — nothing is granted that we can see.
          </div>
        )}
        <button className="btn btn-primary btn-md" onClick={onGrant}>
          Grant scoped access
        </button>
      </div>
    </div>
  );
}

/** The live grant: its scope, caps, spend, slippage, an expiry countdown, and instant revoke. */
function GrantCard({ grant, account }: { grant: SessionKeyGrant; account?: string }) {
  // The countdown needs the wall clock; hold it in state (+ interval) so render stays pure (lint).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const revoke = useRevokeBuilder();
  const tx = useSessionKeyTx();
  const invalidate = useInvalidateSessionKeys();

  // Whether the session key is stored on THIS device (⇒ hands-off moves can sign here).
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const sessionAddress = grant.sessionKey;
  useEffect(() => {
    let alive = true;
    const check = async (): Promise<boolean> =>
      account ? hasSessionKey({ chainId: VAULT_CHAIN, account, sessionAddress }) : false;
    void check().then((p) => {
      if (alive) setKeyPresent(p);
    });
    return () => {
      alive = false;
    };
  }, [account, sessionAddress]);

  useEffect(() => {
    if (!tx.isDone) return;
    invalidate();
    // Revoke confirmed → wipe the local key (a consequence of the sacred exit, never a gate on it).
    if (account) void wipeSessionKey({ chainId: VAULT_CHAIN, account, sessionAddress }).then(() => setKeyPresent(false));
  }, [tx.isDone, invalidate, account, sessionAddress]);

  const vault = (() => {
    try {
      return getAddresses(VAULT_CHAIN).vault?.toLowerCase();
    } catch {
      return undefined;
    }
  })();

  const targets = Array.from(new Set(grant.allowlist.map((e) => e.target.toLowerCase())));
  const verbs = Array.from(new Set(grant.allowlist.map((e) => selectorLabel(e.selector))));
  const scopeTarget =
    targets.length === 0
      ? "—"
      : targets.length === 1
        ? vault && targets[0] === vault
          ? "Live vault"
          : short(targets[0])
        : `${targets.length} contracts`;

  const busy = revoke.building || tx.isBusy;
  async function onRevoke() {
    // Prefer the CLIENT-built revoke (the sacred exit works even if SparkPoint is offline, N2); only
    // fall back to the server builder if the account address isn't known yet. Both are user-signed.
    const local = buildRevokeTx(account, grant.sessionKey, VAULT_CHAIN);
    const built = local ?? (await revoke.build(grant.sessionKey));
    if (built) tx.send(built);
  }

  async function onDisableHandsOff() {
    if (account) await wipeSessionKey({ chainId: VAULT_CHAIN, account, sessionAddress });
    setKeyPresent(false);
  }

  const rows: [string, React.ReactNode][] = [
    ["Scope", verbs.length > 0 ? `${scopeTarget} · ${verbs.join(", ")}` : scopeTarget],
    ["Per-transaction cap", formatUsdcBaseUnits(grant.perTxCap)],
    ["Cumulative cap", formatUsdcBaseUnits(grant.cumulativeCap)],
    ["Spent so far", `${formatUsdcBaseUnits(grant.spent)} of ${formatUsdcBaseUnits(grant.cumulativeCap)}`],
    ["Max slippage", bpsToPercent(grant.maxSlippageBps)],
    ["Expires", expiryCountdown(grant.validUntil, now)],
  ];

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-hd">
        <span className="t">Active automation</span>
        <StatusTag variant="live" label="Active · on-chain" />
      </div>

      <div style={{ marginBottom: 6 }}>
        {rows.map(([label, value]) => (
          <div className="statusrow" key={label}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 13, textAlign: "right" }}>{value}</span>
          </div>
        ))}
        <div className="statusrow">
          <span style={{ fontWeight: 600 }}>Session key</span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
            {short(grant.sessionKey)}
          </span>
        </div>
      </div>

      {grant.registeredTxHash && (
        <div style={{ fontSize: 12, marginBottom: 12 }}>
          <a href={explorerTx(grant.registeredTxHash)} target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>
            View grant transaction ↗
          </a>
        </div>
      )}

      {tx.isDone ? (
        <div style={{ fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--gain)", fontWeight: 600 }}>
            <Icon name="check" size={16} /> Revoked on-chain — the session key can no longer act.
          </div>
          {tx.txHash && (
            <div style={{ marginTop: 6 }}>
              <a href={explorerTx(tx.txHash)} target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>
                View revoke transaction ↗
              </a>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Hands-off (on-device) status: the key is per-browser, so say plainly whether it's here. */}
          {keyPresent === true ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "10px 12px",
                marginBottom: 12,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background: "var(--info-subtle)",
                fontSize: 12.5,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gain)" }}>
                <Icon name="check" size={14} /> Hands-off signing is on in this browser.
              </span>
              <button className="qlink" onClick={() => void onDisableHandsOff()} style={{ fontSize: 12 }}>
                Turn off here
              </button>
            </div>
          ) : keyPresent === false ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 12, lineHeight: 1.5 }}>
              Hands-off signing isn’t set up in this browser — you’ll sign each move manually here. The grant is still
              live; you can enable hands-off by re-granting on this device.
            </div>
          ) : null}

          <button className="btn btn-outline btn-md" disabled={busy} onClick={() => void onRevoke()} style={{ width: "100%" }}>
            {tx.stage === "signing"
              ? "Confirm in your wallet…"
              : tx.stage === "confirming"
                ? "Revoking on-chain…"
                : revoke.building
                  ? "Preparing revoke…"
                  : "Revoke instantly"}
          </button>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
            Revoke is unilateral: you sign it from your own wallet and it takes effect on-chain — Sparky cannot
            block or delay it.
          </div>
          {(tx.error || revoke.error) && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--loss)" }}>
              {tx.error ?? revoke.error?.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
