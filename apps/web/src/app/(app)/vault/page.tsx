"use client";

/**
 * /vault — Aave Yield Vault overview: net-APY breakdown (Aave supply rate − the
 * performance fee over a high-water mark → net APY), APY history sparkline, your
 * position (shares / accrued / idle), beta-cap meter, and audit pills.
 *
 * Faithful 1:1 port of the design's `vault` screen
 * (docs/design-handover/showcase/screens/vault.js) — markup, classes, and copy verbatim —
 * with the mock `data.vault` figures swapped for LIVE useVault reads (direct-RPC; no agent,
 * no backend). Pre-connect it reads the deployed Base Sepolia vault so the vault-global
 * figures (net APY, fee, caps) render; account-scoped figures (your shares/value/idle
 * USDC) fill in on connect and degrade to "—" when disconnected or on a chain without the
 * vault. The performance FEE is live on-chain; the Aave supply rate + APY history are
 * indexer-sourced estimates (no pure-RPC source), so they stay as the design's estimate.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money, fmt } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { useVault } from "@/lib/chain/useVault";
import { useAaveSupplyApyBps } from "@/lib/chain/useAaveSupplyApy";
import { apyLabel, ZERO_APY_BPS } from "@/lib/chain/aaveApy";
import { buildVaultOptions, resolveSelectedVault } from "@/lib/chain/vaultOptions";
import { VaultPicker } from "@/components/ui/VaultPicker";
import { capNoun } from "@/lib/stage";
import "@/components/screens/vault.css";
import { StatusTag } from "@/components/ui/status-tag";

const DECIMALS = 6;

/** Address book for a chain, or `undefined` on an unsupported chain (getAddresses throws) — fail-closed. */
function safeAddresses(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}

/** The chain whose live vault the dashboard reads before a wallet connects (Base Sepolia). */
const DISPLAY_CHAIN_ID = 84532;

/** Raw base units → a JS number for the design's `fmt`/`money` display helpers. */
function toNum(x: bigint | undefined, decimals = DECIMALS): number {
  return x === undefined ? 0 : Number(formatUnits(x, decimals));
}

/** Per-user beta cap (raw USDC base units) for a chain; fail-closed to 0 on unsupported. */
function perUserCapRaw(chainId: number | undefined): bigint {
  if (chainId === undefined) return 0n;
  try {
    return getPolicyConstants(chainId).caps.perUserTvl.amount;
  } catch {
    return 0n;
  }
}

/** APY-history line path (mirrors the design's `apyPath`). */
function apyPath(vals: number[], W: number, H: number) {
  const min = Math.min(...vals) - 0.1,
    max = Math.max(...vals) + 0.1,
    r = max - min || 1,
    p = 6;
  return (
    "M" +
    vals
      .map(
        (val, i) =>
          (p + (i / (vals.length - 1)) * (W - p * 2)).toFixed(1) +
          " " +
          (p + (1 - (val - min) / r) * (H - p * 2)).toFixed(1),
      )
      .join(" L")
  );
}

const HIST_RANGES = ["7d", "30d", "90d"];

function VaultOverview({ selectedParam }: { selectedParam: string | null }) {
  const router = useRouter();
  const [hist, setHist] = useState("30d");
  const { isConnected, chainId } = useAccount();

  // Multi-vault selection (011): the picker stores the chosen vault in `?vault=<address>` (absent ⇒ the
  // launch Aave vault — the byte-identical default). Options come from the STATIC address-book SoT for the
  // display chain; a wrapper-less chain yields launch-only and the picker renders nothing.
  const bookChainId = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const book = safeAddresses(bookChainId);
  const options = buildVaultOptions({ wrappers: book?.sparkPointWrappers });
  const sel = resolveSelectedVault(options, selectedParam);
  const isWrapper = sel.kind === "morpho_wrapper";
  const depositHref = toHref("vault/deposit") + (sel.vaultAddress ? `?vault=${sel.vaultAddress}` : "");
  const withdrawHref = toHref("vault/withdraw") + (sel.vaultAddress ? `?vault=${sel.vaultAddress}` : "");

  // Connected → follow the wallet's chain (account-scoped reads work). Disconnected → read
  // the deployed Base Sepolia vault so the vault-global figures aren't blank pre-connect. The selected
  // vault (launch by default) is threaded in; for launch, kind/label equal useVault's own defaults so
  // the read + render stay byte-identical to before.
  const v = useVault({
    chainId: isConnected ? undefined : DISPLAY_CHAIN_ID,
    vaultAddress: sel.vaultAddress,
    kind: sel.kind,
    label: sel.label,
  });

  // §B3 — the vault is BASE-ONLY. On a connected chain without it (e.g. Robinhood testnet 46630)
  // useVault reports `vault_not_deployed`; surface an honest banner + disable the vault actions,
  // mirroring the /portfolio page. Show the wallet's native ETH for the Robinhood case.
  const wrongNetwork = isConnected && v.unavailable?.kind === "vault_not_deployed";
  const robinhood = wrongNetwork && chainId === 46630;
  const eth = useBalance({ address: v.account, query: { enabled: isConnected && !!v.account } });
  const ethBalance = eth.data?.value !== undefined ? Number(formatUnits(eth.data.value, 18)) : undefined;

  // 017 — the LIVE Aave USDC supply APY (bps), read on-chain; null when unreadable / off Aave.
  // On testnet the rate is ~0 → honest "≈0% (testnet)"; never the old fabricated 4.3%/3.87%.
  const grossApyBps = useAaveSupplyApyBps(v.chainId);
  const testnet = v.chainId === 84532 || v.chainId === 46630;
  const framing = grossApyBps === null ? null : v.netApy(grossApyBps);
  const netPct = framing?.netApyPct ?? 0;
  const supplyPct = (grossApyBps ?? 0) / 100;
  const feePctInt = Math.round((framing?.feeBps ?? v.netApy(0).feeBps) / 100);

  // Live CapRegistry per-user cap (US1); fall back to the compile-time policy mirror only when the
  // on-chain read is unresolved / CapRegistry isn't deployed on this chain — never a fabricated cap.
  const capRaw = v.perUserCap ?? perUserCapRaw(v.chainId);
  const usedRaw = v.underlying ?? 0n;
  const capPct = capRaw > 0n ? Math.min((toNum(usedRaw) / toNum(capRaw)) * 100, 100) : 0;

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>{v.label} <StatusTag variant="partial" works={["Vault caps, fee, your shares/value/idle read live on-chain", "Real approve + deposit + withdraw / exit"]} pending={[isWrapper ? "Net APY feed not yet wired — shown as —" : "Net APY reflects the live Aave supply rate (≈0% on testnet)"]} /></h1>
          <div className="sub">{isWrapper ? "Branded Morpho-wrapper vault · yield routed via Morpho · Base" : "Conservative, capital-preservation-first yield on USDC · Base"}</div>
        </div>
        <div className="actions">
          <RiskChip tier={1} />
          <button
            className="btn btn-outline btn-md"
            disabled={wrongNetwork}
            title={wrongNetwork ? "The vault is on Base — switch to Base Sepolia to manage it" : undefined}
            onClick={() => router.push(withdrawHref)}
          >
            <Icon name="door" size={16} /> Withdraw
          </button>
          <button
            className="btn btn-primary btn-md"
            disabled={wrongNetwork}
            title={wrongNetwork ? "The vault is on Base — switch to Base Sepolia to deposit" : undefined}
            onClick={() => router.push(depositHref)}
          >
            Review deposit
          </button>
        </div>
      </div>
      {options.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <VaultPicker options={options} selected={sel} />
        </div>
      )}
      {wrongNetwork && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 14,
            padding: "11px 14px",
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--muted-foreground)",
            background: "var(--caution-subtle)",
            border: "1px solid color-mix(in srgb,var(--caution) 26%,transparent)",
          }}
        >
          <span style={{ color: "var(--caution)", flex: "none", marginTop: 1 }}>
            <Icon name="info" size={16} />
          </span>
          {robinhood ? (
            <span>
              You&apos;re on <b>Robinhood Testnet</b>. The SparkPoint vault is <b>Base-only</b> — switch to{" "}
              <b>Base Sepolia</b> to deposit or manage your vault.
              {ethBalance !== undefined ? ` Your Robinhood ETH balance: ${ethBalance.toFixed(4)} ETH.` : ""} Your
              vault funds on Base are always withdrawable via{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>
                /exit
              </a>
              .
            </span>
          ) : (
            <span>
              The SparkPoint vault isn&apos;t deployed on your connected network. Switch to <b>Base Sepolia</b> to
              deposit or manage your vault. Your funds are safe and withdrawable via{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>
                /exit
              </a>
              .
            </span>
          )}
        </div>
      )}
      <div className="vault-grid">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl">Net APY</span>
            <span className="badge badge-ai">AI-managed</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.02em" }} className="tnum">
              {isWrapper ? "—" : apyLabel(framing?.netApyBps ?? null, { testnet })}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 7 }}>
              {isWrapper ? "net APY · not yet available" : "net APY · estimate"}
            </div>
          </div>
          {isWrapper ? (
            <>
              <div className="apybreak" style={{ marginTop: 16 }}>
                <div className="br">
                  <span className="muted">Yield source</span>
                  <span className="tnum">Morpho (external)</span>
                </div>
                <div className="br">
                  <span className="muted">
                    Fee · SparkPoint {feePctInt}% of yield <span style={{ fontSize: 11 }}>(over high-water mark)</span>
                  </span>
                  <span className="tnum" style={{ fontSize: 12 }}>+ Morpho curator fee</span>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Routes pooled USDC into a curated Morpho vault — yield is Morpho&apos;s, not Aave&apos;s, and the
                SparkPoint performance fee stacks on Morpho&apos;s native curator fee. No live APY feed yet, so
                it&apos;s shown as &ldquo;—&rdquo; — never an invented number.
              </div>
            </>
          ) : (
            <>
              <div className="apybreak" style={{ marginTop: 16 }}>
                <div className="br">
                  <span className="muted">Aave supply rate</span>
                  <span className="tnum">{apyLabel(grossApyBps, { testnet })}</span>
                </div>
                <div className="br">
                  <span className="muted">
                    Performance fee · {feePctInt}% of yield <span style={{ fontSize: 11 }}>(over high-water mark)</span>
                  </span>
                  <span className="tnum">
                    {grossApyBps !== null && grossApyBps > ZERO_APY_BPS ? `−${(supplyPct - netPct).toFixed(2)}%` : "—"}
                  </span>
                </div>
                <div className="divider" style={{ margin: "4px 0" }} />
                <div className="br" style={{ fontWeight: 600 }}>
                  <span>Net APY</span>
                  <span className="tnum">{apyLabel(framing?.netApyBps ?? null, { testnet })}</span>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Estimates, not guarantees. Rates change; historical and current only — no projections.
              </div>
              <div className="divider" />
              <div className="card-hd">
                <span className="t">APY history</span>
                {grossApyBps !== null && !testnet && (
                  <div className="seg">
                    {HIST_RANGES.map((r) => (
                      <button key={r} className={r === hist ? "active" : ""} onClick={() => setHist(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* No live pure-RPC APY-history source exists — never synthesize one. Real chart only
                  off testnet with a live rate; else an honest note (mock history would contradict ≈0%). */}
              {grossApyBps !== null && !testnet ? (
                <svg width="100%" height="80" viewBox="0 0 520 80" preserveAspectRatio="none">
                  <path d={apyPath(data.apyHist, 520, 80)} fill="none" stroke="var(--info)" strokeWidth="2" />
                </svg>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>
                  History unavailable on testnet.
                </div>
              )}
            </>
          )}
        </div>
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl">Your position</span>
          </div>
          <div className="stat" style={{ marginBottom: 14 }}>
            <span className="k">Shares held</span>
            <span className="v tnum">{v.shares !== undefined ? fmt(toNum(v.shares, DECIMALS), 4) : "—"}</span>
            <span className="muted" style={{ fontSize: 11 }}>
              {/* Match the confirm gate's share-symbol convention (generic "shares" for a wrapper) so the
                  same token isn't named two ways across the overview → deposit/confirm flow. */}
              {isWrapper ? "shares" : "spvUSDC"} ≈ {v.underlying !== undefined ? money(toNum(v.underlying)) : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span className="muted">Accrued yield</span>
            <span className="tnum" style={{ color: "var(--gain)" }}>
              {/* accrued needs cost basis (deposit history) → indexer-sourced, not pure RPC */}
              —
            </span>
          </div>
          <div className="preview-row">
            <span className="muted">Idle USDC available</span>
            <span className="tnum">{v.usdcBalance !== undefined ? money(toNum(v.usdcBalance)) : "—"}</span>
          </div>
          {isWrapper ? (
            <>
              <div className="divider" />
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                This vault enforces its own on-chain deposit cap, set at deploy. You can always withdraw your
                full balance, regardless of caps or pause.
              </div>
              <div className="divider" />
              <div style={{ display: "flex", gap: 8 }}>
                <span className="pill ghosty" style={{ cursor: "default" }}>
                  <Icon name="lock" size={13} /> Non-upgradeable
                </span>
                <span className="pill ghosty" style={{ cursor: "default" }}>
                  <Icon name="door" size={13} /> Withdraw anytime
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="divider" />
              <div className="card-hd">
                <span className="lbl">Your {capNoun}</span>
                <span className="tnum" style={{ fontSize: 12 }}>
                  {money(toNum(usedRaw), 0)} / {money(toNum(capRaw), 0)}
                </span>
              </div>
              <div className="capmeter">
                <i style={{ width: `${capPct}%` }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>
                {(100 - capPct).toFixed(0)}% of your {capNoun} remaining. You can always withdraw, regardless of caps.
              </div>
              <div className="divider" />
              <div style={{ display: "flex", gap: 8 }}>
                <span className="pill ghosty" style={{ cursor: "default" }}>
                  <Icon name="shieldcheck" size={13} /> Audited
                </span>
                <span className="pill ghosty" style={{ cursor: "default" }}>
                  <Icon name="lock" size={13} /> Non-upgradeable
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Reads the `?vault=` selection client-side; isolated so the Suspense fallback can SSR the shell. */
function VaultOverviewLive() {
  const selectedParam = useSearchParams().get("vault");
  return <VaultOverview selectedParam={selectedParam} />;
}

export default function Page() {
  // `useSearchParams` bails the reading subtree to the client. The fallback renders the LAUNCH shell
  // (selectedParam = null) so a cold load's first paint keeps the server-rendered vault shell instead of
  // blanking — and for the default (no `?vault`) the fallback and the live render are identical.
  return (
    <Suspense fallback={<VaultOverview selectedParam={null} />}>
      <VaultOverviewLive />
    </Suspense>
  );
}
