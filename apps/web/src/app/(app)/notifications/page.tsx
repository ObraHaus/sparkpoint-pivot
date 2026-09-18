"use client";

/**
 * /notifications — the real in-app notifications feed (§3.11, feature 021): transaction results and
 * realized outcomes, each DERIVED from your on-chain activity by the agent — never a mock, never
 * fabricated (Principle III). Visiting the page marks the feed read (advisory). Rows honour the
 * on-device category toggles from Settings → Notifications. Read-only; never on the withdraw/exit path.
 */

import { useEffect } from "react";
import type { Hex } from "viem";
import { Icon } from "@/lib/icons";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { useNotifications, useMarkNotificationsRead } from "@/lib/agent/useAgent";
import { filterByPrefs, type NotificationView } from "@/lib/agent/notificationsView";
import { useNotifPrefs } from "@/lib/settings/usePrefs";
import { StatusTag } from "@/components/ui/status-tag";
import "@/components/screens/support.css";

export default function Page() {
  const notif = useNotifications();
  const { prefs } = useNotifPrefs();
  const markRead = useMarkNotificationsRead();
  useEffect(() => {
    markRead();
  }, [markRead]);

  const items = notif ? filterByPrefs(notif.view.items, prefs) : [];
  const hasRows = !!notif && notif.loaded && items.length > 0;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Notifications <NotifTag hasRows={hasRows} />
          </h1>
          <div className="sub">
            Transaction results and realized outcomes — each derived from your on-chain activity, never
            a made-up alert.
          </div>
        </div>
      </div>

      {hasRows ? (
        <div className="card card-pad">
          {items.map((n) => (
            <Row key={n.id} n={n} />
          ))}
        </div>
      ) : (
        <EmptyState notif={notif} />
      )}
    </div>
  );
}

function NotifTag({ hasRows }: { hasRows: boolean }) {
  if (hasRows) {
    return (
      <StatusTag
        variant="live"
        label="Live"
        works={[
          "Every notification is derived from your real on-chain activity — a deposit/withdrawal, a realized outcome, a reverted tx — never fabricated",
          "The unread badge is real, and your category toggles in Settings filter this feed",
        ]}
        pending={[
          "Alerts that watch for a change over time (vault near capacity, rate moves) arrive in a follow-up; session-key expiry needs automation (US6) first",
        ]}
      />
    );
  }
  return (
    <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <b style={{ color: "var(--foreground)" }}>No notifications yet.</b> Reads your real indexed
      on-chain activity — no fabricated alerts — and notifications appear as you deposit, withdraw,
      or an outcome is realized on-chain.
    </div>
  );
}

function Row({ n }: { n: NotificationView }) {
  return (
    <div className="setrow">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "var(--spark-subtle)",
            color: "var(--primary)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Icon name={n.icon} size={16} />
        </span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            {n.title}
            {n.unread && (
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", flex: "none" }} />
            )}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{n.body}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            {n.href ? (
              <a className="cite" href={n.href}>
                view <Icon name="ext" size={10} />
              </a>
            ) : null}
            {n.txHash ? (
              <a className="cite" href={explorerTxUrl(APP_DEFAULT_CHAIN_ID, n.txHash as Hex)} target="_blank" rel="noreferrer">
                tx <Icon name="ext" size={10} />
              </a>
            ) : null}
          </div>
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
        {n.timeText}
      </span>
    </div>
  );
}

function EmptyState({ notif }: { notif: ReturnType<typeof useNotifications> }) {
  let title = "Connect your wallet to see your notifications";
  let body =
    "Once you connect, transaction results and realized outcomes from your on-chain activity show here — never a fabricated alert.";
  if (notif) {
    if (notif.isError) {
      title = "Couldn’t load your notifications";
      body = "This is an advisory view — your funds and withdrawals are never affected. Try again shortly.";
    } else if (!notif.loaded && notif.isLoading) {
      title = "Loading your notifications…";
      body = "Reading your indexed on-chain activity.";
    } else {
      title = "You’re all caught up";
      body =
        "No notifications yet. When you deposit, withdraw, or an outcome is realized on-chain, it appears here with its proof.";
    }
  }
  return (
    <div className="card card-pad" style={{ textAlign: "center", padding: "34px 20px" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
        {body}
      </div>
    </div>
  );
}
