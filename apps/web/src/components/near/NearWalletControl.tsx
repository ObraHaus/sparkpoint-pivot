"use client";

/**
 * 075 — the "Connect NEAR wallet" control (Meteor first).
 *
 * It sits next to the EVM wallet UI but is a separate, client-side connection: it never reads or
 * writes the SIWE session and never authorises anything server-side. The truncated label keeps a
 * long implicit (64-hex) account readable, with the full id in the title.
 */

import { Icon } from "@/lib/icons";
import { truncateNearAccount } from "@/lib/near/account";
import { useNearWallet } from "@/lib/near/NearWalletProvider";

export function NearWalletControl({ compact = false }: { compact?: boolean }) {
  const { accountId, status, error, connect, disconnect } = useNearWallet();

  if (accountId) {
    return (
      <span
        className="pill nearPill"
        data-testid="near-wallet-connected"
        title={accountId}
        style={{ maxWidth: compact ? 190 : 280 }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--primary)" }}>
          NEAR
        </span>
        <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {truncateNearAccount(accountId)}
        </span>
        <button
          type="button"
          data-testid="near-wallet-disconnect"
          onClick={() => void disconnect()}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--muted-foreground)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Disconnect
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="pill nearPill"
        data-testid="near-wallet-connect"
        onClick={() => void connect()}
        disabled={status === "connecting"}
        title="Sign in with Meteor (no access key). Your NEAR account is a client-side claim, never server auth."
      >
        <Icon name="wallet" size={14} />
        <span>{status === "connecting" ? "Connecting NEAR…" : "Connect NEAR wallet"}</span>
        <span className="mono" style={{ fontSize: 10.5 }}>Meteor</span>
      </button>
      {error && (
        <span
          data-testid="near-wallet-error"
          title={error}
          style={{ fontSize: 11, color: "var(--caution)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
