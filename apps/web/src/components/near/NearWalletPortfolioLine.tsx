"use client";

/**
 * 075 — the connected NEAR account on portfolio surfaces.
 *
 * There is still no NEAR wallet-token balance read, so balances are not shown (never invented).
 * Rhea positions are read for a NEAR NEP-413 session's account id directly. Before sign-in the
 * local Meteor account is only a client-side claim; the note says which state it is in.
 */

import { nearPortfolioNote, truncateNearAccount } from "@/lib/near/account";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { useSession } from "@/lib/auth/useSiwe";

const MUTED = "var(--muted-foreground)";

export function NearWalletPortfolioLine() {
  const { accountId: localAccountId } = useNearWallet();
  const { session } = useSession();
  // 1111 — a server-verified NEAR session is a real sign-in. The local Meteor connection may not
  // be restored on every device, so fall back to the session's account for display only.
  const verifiedNear = session?.chain === "near";
  const accountId = localAccountId ?? (verifiedNear ? session?.address ?? null : null);
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
      <div data-testid="near-portfolio-note">{nearPortfolioNote(verifiedNear)}</div>
    </div>
  );
}
