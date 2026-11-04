"use client";

/**
 * 075 — the connected NEAR account on portfolio surfaces.
 *
 * 072 has no NEAR-account input or NEAR-balance read path (its Rhea read is scoped to the session
 * EVM wallet's MCA), so this is an honest display with a "balances coming soon" note — never an
 * invented NEAR balance. The id is a client-side claim and is not server authentication.
 */

import { truncateNearAccount } from "@/lib/near/account";
import { useNearWallet } from "@/lib/near/NearWalletProvider";

const MUTED = "var(--muted-foreground)";

export function NearWalletPortfolioLine() {
  const { accountId } = useNearWallet();
  return (
    <div
      data-testid="near-portfolio-account"
      data-connected={accountId ? "true" : "false"}
      style={{
        margin: "0 14px 10px",
        padding: "9px 11px",
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        display: "grid",
        gap: 4,
        fontSize: 12,
        lineHeight: 1.5,
        color: MUTED,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--primary)" }}>
          NEAR
        </span>
        {accountId ? (
          <span
            data-testid="near-portfolio-account-id"
            title={accountId}
            style={{
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--foreground)",
              fontSize: 12.5,
              wordBreak: "break-all",
            }}
          >
            {truncateNearAccount(accountId)}
          </span>
        ) : (
          <span data-testid="near-portfolio-not-connected">
            No NEAR wallet connected. Connect Meteor to link your account for NEAR recipient prefill.
          </span>
        )}
      </div>
      <div data-testid="near-portfolio-note">
        NEAR balances are coming soon. Rhea positions are read through your connected EVM wallet.
        Your NEAR account is a client-side claim, never server authentication.
      </div>
    </div>
  );
}
