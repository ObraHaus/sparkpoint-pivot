"use client";

/**
 * TokenPicker — choose a swap token (universal swap, feature 007).
 *
 * Three ways in: the chain's RECOMMENDED tokens (ETH/USDC, one tap), the user's IMPORTED tokens, and a
 * paste-address field that resolves an arbitrary ERC-20 on-chain (`resolveErc20`) and shows its real
 * symbol/name/decimals. Safety is surfaced HERE and again at the signing gate: a token whose ADDRESS is
 * not in the curated verified set is badged "Unverified", and a token borrowing a trusted symbol at a
 * different address is flagged "NOT the official {SYMBOL}". Nothing is a hard gate — the user can import
 * and swap any address — but every non-recommended token is shown honestly with its address.
 */

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { recommendedTokens, type SwapToken } from "@/lib/swap/tokens";
import { resolveErc20 } from "@/lib/swap/metadata";
import { isVerifiedAddress, findVerifiedBySymbol } from "@/lib/swap/tokenList";
import { getImported, addImported, removeImported } from "@/lib/swap/importedTokens";

const MUTED = "var(--muted-foreground)";
const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const isAddressish = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

function toSwapToken(chainId: number, r: { address: Address; symbol: string; name?: string; decimals: number }): SwapToken {
  return {
    symbol: r.symbol,
    name: r.name,
    address: r.address,
    decimals: r.decimals,
    isNative: false,
    source: "imported",
    verified: isVerifiedAddress(chainId, r.address),
  };
}

function VerifiedBadge({ verified }: { verified?: boolean }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: "1px 6px",
        borderRadius: 6,
        color: verified ? "var(--gain)" : "var(--caution)",
        background: verified ? "var(--gain-subtle)" : "var(--caution-subtle)",
      }}
    >
      {verified ? "✓ Verified" : "⚠ Unverified"}
    </span>
  );
}

function TokenLine({
  token,
  onSelect,
  onRemove,
  disabled,
}: {
  token: SwapToken;
  onSelect: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        className="btn btn-ghost"
        onClick={onSelect}
        disabled={disabled}
        style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", padding: "8px 10px", height: "auto", opacity: disabled ? 0.5 : 1 }}
      >
        <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 14 }}>{token.symbol}</b>
            {!token.isNative && <VerifiedBadge verified={token.verified} />}
          </span>
          <span style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {token.name ? `${token.name} · ` : ""}
            {token.isNative ? "Native" : token.address}
          </span>
        </span>
      </button>
      {onRemove && (
        <button className="btn btn-ghost btn-sm" title="Remove" onClick={onRemove} style={{ color: MUTED }}>
          ✕
        </button>
      )}
    </div>
  );
}

export function TokenPicker({
  chainId,
  exclude,
  onSelect,
  onClose,
}: {
  chainId: number | undefined;
  /** The other leg's address — selecting the same token is disabled. */
  exclude?: string;
  onSelect: (token: SwapToken) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<SwapToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lazy init from localStorage — the picker only mounts after a user click (client-only, post-hydration),
  // so there is no SSR/hydration mismatch and no load effect is needed.
  const [imported, setImported] = useState<SwapToken[]>(() => (chainId !== undefined ? getImported(chainId) : []));
  const reqId = useRef(0);

  const recommended = chainId !== undefined ? recommendedTokens(chainId) : [];

  // Resolve a pasted address on-chain (debounced; ignore stale responses). The setState calls sync UI
  // state to an EXTERNAL system (an on-chain RPC read), which is the sanctioned use of an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const q = query.trim();
    setError(null);
    setResolved(null);
    if (!isAddressish(q) || chainId === undefined) {
      setResolving(false);
      return;
    }
    const id = ++reqId.current;
    setResolving(true);
    const t = setTimeout(async () => {
      const res = await resolveErc20(chainId, q);
      if (id !== reqId.current) return; // stale
      setResolving(false);
      if (res.ok) setResolved(toSwapToken(chainId, res.token));
      else setError(res.reason);
    }, 300);
    return () => clearTimeout(t);
  }, [query, chainId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pick = (token: SwapToken) => {
    if (chainId !== undefined && token.source === "imported") addImported(chainId, token);
    onSelect(token);
    onClose();
  };

  // "This is NOT the official {SYMBOL}" — a pasted token borrowing a trusted symbol at another address.
  const collision =
    resolved && !resolved.verified
      ? findVerifiedBySymbol(chainId ?? 0, resolved.symbol)
      : undefined;
  const collisionMismatch = collision && !eqAddr(collision.address, resolved?.address);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select a token"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "color-mix(in srgb, var(--background) 60%, rgba(0,0,0,0.5))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 440, maxHeight: "80vh", overflow: "auto", padding: 16, borderRadius: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Select a token</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Paste address */}
        <input
          autoFocus
          type="text"
          spellCheck={false}
          value={query}
          placeholder="Paste token address (0x…)"
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            fontSize: 13.5,
            padding: "9px 11px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--foreground)",
            outline: "none",
          }}
        />

        {resolving && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Reading token on-chain…</div>}
        {error && (
          <div style={{ fontSize: 12.5, color: "var(--caution)", marginTop: 8, lineHeight: 1.5 }}>{error}</div>
        )}
        {resolved && (
          <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            {collisionMismatch && (
              <div style={{ fontSize: 12, color: "var(--loss)", marginBottom: 8, lineHeight: 1.5 }}>
                ⚠ This is <b>NOT</b> the official {resolved.symbol}. Anyone can create a token with any name — verify the address.
              </div>
            )}
            <TokenLine token={resolved} onSelect={() => pick(resolved)} disabled={eqAddr(resolved.address, exclude)} />
            {eqAddr(resolved.address, exclude) && (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>Already selected on the other side.</div>
            )}
          </div>
        )}

        {/* Recommended */}
        <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
          Recommended
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          {recommended.map((t) => (
            <TokenLine key={t.symbol + t.address} token={t} onSelect={() => pick(t)} disabled={eqAddr(t.address, exclude)} />
          ))}
        </div>

        {/* Imported */}
        {imported.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
              Imported
            </div>
            <div style={{ display: "grid", gap: 2 }}>
              {imported.map((t) => (
                <TokenLine
                  key={t.address}
                  token={t}
                  onSelect={() => pick(t)}
                  disabled={eqAddr(t.address, exclude)}
                  onRemove={() => {
                    if (chainId === undefined) return;
                    removeImported(chainId, t.address);
                    setImported(getImported(chainId));
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
