"use client";

/**
 * Shared deposit / withdraw amount panel — the design's `amountScreen(host, mode)`
 * (docs/design-handover/showcase/screens/vault.js), now driven by the LIVE vault.
 *
 * The "You'll receive ≈ / redeem ≈", the beta-cap-after line, and the remaining-position
 * line recompute from the LIVE ERC-4626 previews (via `useVaultConfirm` → `useVault`,
 * read direct-RPC — rounding favors the vault, agent-service-api.md §3.7) as the typed
 * amount changes. All markup/classes/copy are preserved verbatim; only the numbers and
 * the confirm ACTION go live.
 *
 * GATING (T047 per-user-cap gate) + the REAL execution config both live in the shared
 * `useVaultConfirm` hook, so the chat's inline vault-action cards drive the identical
 * real approve/deposit / redeem path. The beta WHITELIST gate sits ONE level up
 * (vault/deposit/page.tsx renders <BetaGate/> when `useBeta().canTransact` is false).
 * The WITHDRAW route is NEVER gated by client state (only a connected wallet + an actual
 * position). Non-custody law, N2: withdraw-is-sacred.
 *
 * On confirm, mounts the SHARED confirm gate <ConfirmFlow … mount="route" onchain={…} />,
 * whose live pre-sign check (agent quote + on-chain preview) gates the real Sign.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import type { Address } from "viem";
import { Icon } from "@/lib/icons";
import { money, fmt } from "@/lib/utils";
import { capNoun } from "@/lib/stage";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { ConfirmFlow } from "@/components/ui/ConfirmFlow";
import { useVaultConfirm, toNum } from "@/lib/chain/useVaultConfirm";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { buildVaultOptions, resolveSelectedVault } from "@/lib/chain/vaultOptions";
import { useCuratedBoard } from "@/lib/curation/useCuratedBoard";
import "@/components/screens/vault.css";

const DECIMALS = 6;

/** The chain whose address book seeds the vault options pre-connect (Base Sepolia). */
const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;

/** Address book for a chain, or `undefined` on an unsupported chain (getAddresses throws) — fail-closed. */
function safeAddresses(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}

/** Parse a typed USDC amount ("2,150.00") into 6-dp base units; never throws. */
function parseUnitsSafe(s: string): bigint {
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return 0n;
  try {
    return parseUnits(cleaned, DECIMALS);
  } catch {
    return 0n;
  }
}

export function AmountScreen({
  mode,
  selectedParam,
}: {
  mode: "deposit" | "withdraw";
  selectedParam: string | null;
}) {
  const isDep = mode === "deposit";
  const { chainId, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const wantUnits = parseUnitsSafe(amount);

  // Multi-vault selection (011): resolve the `?vault=` address (carried here by the /vault picker) into
  // the selected vault. Absent/unknown ⇒ the launch Aave vault, so the flow is byte-identical by default.
  // 051: the curated board's live V3 wrappers are merged in — they are deployed dynamically and can
  // never appear in the static book, so the board's `wrapped` record is their provenance.
  const bookChainId = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const book = safeAddresses(bookChainId);
  const curated = useCuratedBoard();
  const boardWrappers = useMemo(
    () =>
      (curated.board?.vaults ?? [])
        .filter((v) => v.wrapped && v.wrapperAddress)
        .map((v) => ({
          address: v.wrapperAddress as Address,
          label: v.label,
          symbol: v.asset.symbol ?? undefined,
          netApyBps: v.netApyBps ?? undefined,
        })),
    [curated.board],
  );
  const options = buildVaultOptions({
    wrappers: book?.sparkPointWrappers,
    universalWrappers: boardWrappers,
    // Beta: no launch Aave vault — the default selection is the first live curated wrapper.
    includeLaunch: VAULT_CHAIN_AVAILABLE,
  });
  const sel = resolveSelectedVault(options, selectedParam);
  const selectedBoardVault = boardWrappers.find(
    (w) => w.address.toLowerCase() === (sel.vaultAddress ?? "").toLowerCase(),
  );
  // 051 — a curated universal wrapper is depositable on this build even though the SparkPoint Aave
  // vault is Base-only; the launch/default path keeps the honest "not part of the beta" notice.
  const isUniversalWrapper = sel.kind === "universal_wrapper";
  // 053 — the ASSET's symbol (the amount + confirm copy are in asset units): a universal wrapper
  // names its own asset (USDG), the launch vault is USDC. `sel.symbol` for the launch option is the
  // SHARE symbol (spvUSDC), so it is only consulted for a universal wrapper.
  const assetSymbol = isUniversalWrapper ? (sel.symbol ?? "USDG") : "USDC";
  const backHref = toHref("vault") + (sel.vaultAddress ? `?vault=${sel.vaultAddress}` : "");

  // LIVE figures + gating + the REAL execution config (shared with the chat inline path). The selected
  // vault is threaded in; for launch, kind/label equal the defaults so everything renders as before.
  const {
    v,
    depositShares,
    redeemShares,
    redeemAssetsOut,
    capRaw,
    netApyText,
    vaultName,
    shareSymbol,
    isWrapper,
    usedAfter,
    remaining,
    ready,
    label,
    onchain,
  } = useVaultConfirm({
    mode,
    assets: wantUnits,
    vaultAddress: sel.vaultAddress,
    kind: sel.kind,
    label: sel.label,
    // 053 — the asset symbol (USDG on 4663) so the confirm copy names the real token.
    assetSymbol,
    // 051 — curated provenance + the stored scan APY for a dynamically-deployed V3 wrapper.
    verified: sel.verified,
    curatedNetApyBps: selectedBoardVault?.netApyBps,
    // 024: a retired vault fail-closes DEPOSIT only. `mode: "withdraw"` never reads this (N2).
    retired: sel.retired,
  });

  // 053 — shares format with the SHARE token's decimals (V3 wrappers: 9 over a 6-dp asset), so a
  // share count is never rendered at the asset scale (which overstated it 1000×).
  const shareDec = v.shareDecimals ?? DECIMALS;

  const ctaLabel = label;

  const onMax = () =>
    setAmount(formatUnits(isDep ? v.usdcBalance ?? 0n : v.underlying ?? 0n, DECIMALS));

  if (confirming) {
    return <ConfirmFlow intent={mode} mount="route" onchain={onchain} />;
  }

  // No curated vault selected on the Robinhood Chain beta: point at the board instead of a notice
  // about a vault that isn't part of this program.
  if (!VAULT_CHAIN_AVAILABLE && !isUniversalWrapper) {
    return (
      <div className="page page-narrow">
        <div className="pagehead">
          <div>
            <h1>{isDep ? "Deposit" : "Withdraw"}</h1>
            <div className="sub">Curated vaults</div>
          </div>
        </div>
        <div
          className="card card-pad"
          style={{ marginTop: 8, fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}
        >
          Pick a live vault first — open the{" "}
          <Link style={{ color: "var(--primary)" }} href={toHref("vault")}>
            Vault page
          </Link>{" "}
          and choose one to {mode}.
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={backHref}>
        <Icon name="chevr" size={15} /> Back to vault
      </Link>
      <div className="pagehead">
        <div>
          <h1>{isDep ? `Deposit ${assetSymbol}` : "Withdraw"}</h1>
          <div className="sub">
            {isDep
              ? isWrapper
                ? `Into ${vaultName} · net APY ${netApyText}`
                : `Into the ${vaultName} · ${netApyText} net APY (estimate)`
              : "Withdraw anytime — even if Sparky is offline"}
          </div>
        </div>
        <RiskChip tier={1} />
      </div>
      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 16 }}>
          <label>{isDep ? "Amount to deposit" : "Amount to withdraw"}</label>
          <div className={"amtbox" + (focused ? " focus" : "")} id="amtbox">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                className="input big"
                id="amt"
                inputMode="decimal"
                placeholder="0.00"
                style={{ border: "none", boxShadow: "none", padding: 0, background: "none" }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              />
              <span style={{ fontSize: 18, fontWeight: 600, color: "var(--muted-foreground)" }}>{assetSymbol}</span>
              <button className="btn btn-ghost btn-sm" id="maxbtn" onClick={onMax}>
                Max
              </button>
            </div>
          </div>
          <div className="hint">
            {isDep
              ? `Max ${money(toNum(v.usdcBalance))} (idle) · ${money(toNum(capRaw), 0)} ${capNoun}`
              : `You hold ${money(toNum(v.underlying))} · withdraw any amount`}
          </div>
        </div>
        <div
          style={{
            background: "var(--background)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius)",
            padding: 14,
            marginBottom: 8,
          }}
        >
          {isDep ? (
            <>
              <div className="preview-row">
                <span className="muted">You&apos;ll receive ≈</span>
                <span className="tnum">
                  {v.previewDepositShares === undefined && wantUnits > 0n
                    ? "…"
                    : `${fmt(toNum(depositShares, shareDec), 4)} ${shareSymbol}`}
                </span>
              </div>
              <div className="preview-row">
                <span className="muted">Net APY</span>
                <span className="tnum">
                  {netApyText}
                  {!isWrapper && (
                    <>
                      {" "}
                      <a className="cite" style={{ cursor: "pointer" }}>
                        breakdown
                      </a>
                    </>
                  )}
                </span>
              </div>
              <div className="preview-row">
                <span className="muted" style={{ textTransform: "capitalize" }}>{capNoun} after</span>
                <span className="tnum">
                  {money(toNum(usedAfter), 0)} / {money(toNum(capRaw), 0)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="preview-row">
                <span className="muted">You&apos;ll redeem ≈</span>
                <span className="tnum">{fmt(toNum(redeemShares, shareDec), 4)} {shareSymbol}</span>
              </div>
              <div className="preview-row">
                <span className="muted">You&apos;ll receive</span>
                <span className="tnum">≈ {fmt(toNum(redeemAssetsOut))} {assetSymbol}</span>
              </div>
              <div className="preview-row">
                <span className="muted">Remaining position</span>
                <span className="tnum">{money(toNum(remaining))}</span>
              </div>
            </>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 16 }}>
          {isDep
            ? "Estimates, not guarantees. Shares: your fixed slice of the vault; its USDC value grows as the vault earns."
            : "No fees to exit. Nothing moves until you sign."}
        </div>
        <button
          className="btn btn-primary btn-lg"
          style={{ width: "100%" }}
          disabled={!ready}
          onClick={() => setConfirming(true)}
        >
          {ctaLabel}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
          Next: live quote + on-chain preview, then you sign.
        </div>
      </div>
    </div>
  );
}

/** Reads the `?vault=` selection client-side; isolated so the Suspense fallback can SSR the shell. */
function AmountScreenLive({ mode }: { mode: "deposit" | "withdraw" }) {
  const selectedParam = useSearchParams().get("vault");
  return <AmountScreen mode={mode} selectedParam={selectedParam} />;
}

/**
 * Route wrapper: `useSearchParams` bails the reading subtree to the client, so the Suspense fallback
 * renders the LAUNCH shell (selectedParam = null) — a cold load keeps the server-rendered first paint
 * instead of blanking (and for the default, no `?vault`, the fallback and live render are identical).
 */
export function AmountScreenRoute({ mode }: { mode: "deposit" | "withdraw" }) {
  // 051 — the "no vault on this build" notice moved INSIDE AmountScreen: a curated universal wrapper
  // is depositable on the Robinhood Chain beta, while the launch Aave vault is Base-only.
  return (
    <Suspense fallback={<AmountScreen mode={mode} selectedParam={null} />}>
      <AmountScreenLive mode={mode} />
    </Suspense>
  );
}
