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

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits } from "viem";
import type { Address } from "viem";
import { useAccount, useBalance } from "wagmi";
import { Icon } from "@/lib/icons";
import { money, fmt } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { useVault } from "@/lib/chain/useVault";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import { useAaveSupplyApyBps } from "@/lib/chain/useAaveSupplyApy";
import { apyLabel, ZERO_APY_BPS } from "@/lib/chain/aaveApy";
import { buildVaultOptions, resolveSelectedVault } from "@/lib/chain/vaultOptions";
import { feeBasisShortLabel, vaultFeeChain } from "@/lib/policy/feeCopy";
import { VaultPicker } from "@/components/ui/VaultPicker";
import { CuratedBoard } from "@/components/vault/CuratedBoard";
import { useCuratedBoard } from "@/lib/curation/useCuratedBoard";
import { capNoun } from "@/lib/stage";
import "@/components/screens/vault.css";

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
const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;

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

const HIST_RANGES = ["7d", "30d", "90d"];

function VaultOverview({ selectedParam }: { selectedParam: string | null }) {
  const router = useRouter();
  const [hist, setHist] = useState("30d");
  const { isConnected, chainId } = useAccount();

  // Multi-vault selection (011): the picker stores the chosen vault in `?vault=<address>` (absent ⇒ the
  // launch Aave vault — the byte-identical default). Options come from the STATIC address-book SoT for the
  // display chain PLUS the curated board's live V3 wrappers (051 — they are deployed dynamically and can
  // never appear in a static book); a wrapper-less chain yields launch-only and the picker renders nothing.
  const bookChainId = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const book = safeAddresses(bookChainId);

  // 048 — the AI-curated board. A read through the BFF; the deposit rail routes only to vaults the
  // in-app flow already knows, and everything else is disclosed as a direct deposit (T303).
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
    // On the beta there is no launch Aave vault in this program — the picker shows curated wrappers only.
    includeLaunch: VAULT_CHAIN_AVAILABLE,
  });
  const sel = resolveSelectedVault(options, selectedParam);
  const knownVaults = options
    .filter((o) => !!o.vaultAddress)
    .map((o) => ({
      address: o.vaultAddress as string,
      depositHref: toHref("vault/deposit") + `?vault=${o.vaultAddress}`,
    }));
  // `isWrapper` stays LEGACY-SPECIFIC (the SparkPointMorphoVault): it gates copy about a branded
  // wrapper over one curated Morpho vault. `isMorphoVenue` is the broader question — "is the yield
  // Morpho's rather than Aave's?" — and is what the APY/fee panel branches on, so a Vault V2 gets the
  // Morpho treatment instead of silently falling into the Aave branch and being described as earning
  // an Aave supply rate it has no relationship to.
  const isWrapper = sel.kind === "morpho_wrapper";
  const isMorphoVenue = sel.kind === "morpho_wrapper" || sel.kind === "morpho_fee_wrapper";
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

  // 024 / T052 — the three-line stacked fee chain for a Morpho venue.
  //   * OUR fee is the vault's own live `performanceFeeBps` (on a V2, SparkPoint's fee IS the V2's
  //     `performanceFee()` — there is no separate layer).
  //   * The CHILD leg differs by kind and neither case may be rendered as a bare 0. On a Fee Wrapper
  //     we allocate straight into a Morpho Blue market, so there is no child VAULT to stack on — a
  //     fact worth stating. On the legacy wrapper we have never read the underlying's fee, so the
  //     honest value is "not yet read", NOT zero.
  //   * The NET is genuinely unavailable: Morpho's API covers no testnet, so `netApyBps` stays
  //     undefined and the row renders "unavailable" rather than a fabricated 0%.
  const feeChain = vaultFeeChain({
    basis: v.feeBasis,
    sparkpointFeeBps: v.performanceFeeBps,
    // Deliberately NOT `v.managementFeeBps`: on a Vault V2 that selector is OUR vault's management
    // fee, not a child's, so feeding it to the CHILD line would misattribute our own fee to someone
    // else. The child leg is described by the note (Fee Wrapper) or left unread (legacy wrapper).
    nativeFeeNote:
      sel.kind === "morpho_fee_wrapper"
        ? "no child vault — allocates directly into a Morpho Blue market, which charges no vault fee"
        : undefined,
    netApyBps: undefined,
  });

  // Live CapRegistry per-user cap (US1); fall back to the compile-time policy mirror only when the
  // on-chain read is unresolved / CapRegistry isn't deployed on this chain — never a fabricated cap.
  const capRaw = v.perUserCap ?? perUserCapRaw(v.chainId);
  const usedRaw = v.underlying ?? 0n;
  const capPct = capRaw > 0n ? Math.min((toNum(usedRaw) / toNum(capRaw)) * 100, 100) : 0;

  // On a build whose app chain has no vault (the Robinhood Chain beta — VAULT_CHAIN_AVAILABLE=false),
  // the 048 curated board IS the vault experience: Sparky's screened picks, off-chain and
  // admin-reviewed. A SparkPoint-originated vault is not part of this program for now — the page
  // stays about curated third-party vaults rather than implying one of our own is coming.
  if (!VAULT_CHAIN_AVAILABLE) {
    return (
      <div className="page page-wide">
        <div className="pagehead">
          <div>
            <h1>Vault</h1>
            <div className="sub">AI-curated vaults · discovered, screened and reviewed</div>
          </div>
        </div>
        <CuratedBoard
          board={curated.board}
          state={curated.state}
          knownVaults={knownVaults}
          fetchedAt={curated.fetchedAt}
        />
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>{v.label}</h1>
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
              {VAULT_CHAIN_AVAILABLE ? (
                <>The SparkPoint vault isn&apos;t deployed on your connected network. Switch to <b>Base Sepolia</b> to deposit or manage your vault.</>
              ) : (
                <>The SparkPoint vault is <b>Base-only</b> and isn&apos;t part of the Robinhood mainnet beta yet.</>
              )}{" "}
              Your funds are safe and withdrawable via{" "}
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
              {isMorphoVenue ? "—" : apyLabel(framing?.netApyBps ?? null, { testnet })}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 7 }}>
              {isMorphoVenue ? "net APY · unavailable" : "net APY · estimate"}
            </div>
          </div>
          {isMorphoVenue ? (
            <>
              <div className="apybreak" style={{ marginTop: 16 }}>
                <div className="br">
                  <span className="muted">Yield source</span>
                  <span className="tnum">Morpho (external)</span>
                </div>
                {/* 024 / T052 — the stacked fee chain as THREE SEPARATE LINES.
                    IV.5 requires the chain disclosed net, and it must be three rows rather than one
                    blended number because the two fees have different owners: ours we choose, the
                    child's we merely inherit and cannot change. This replaced a single vague
                    "+ Morpho curator fee", which named a fee without ever stating its size.
                    `vaultFeeChain` keeps "we didn't read it" and "there is none" distinct — the same
                    discipline that makes an unavailable APY render as "unavailable", never 0%. */}
                {feeChain.map((line) => (
                  <div key={line.kind}>
                    {/* Same rule as the launch branch: a divider sets the NET apart from the
                        components above it, so the summary line reads as a total rather than a
                        fourth ingredient. */}
                    {line.kind === "net" ? <div className="divider" style={{ margin: "4px 0" }} /> : null}
                    <div
                      className="br"
                      style={line.kind === "net" ? { fontWeight: 600 } : undefined}
                    >
                      <span className={line.kind === "net" ? undefined : "muted"}>{line.label}</span>
                      <span
                        className="tnum"
                        style={{
                          fontSize: 12,
                          // An honest unknown is secondary + italic so it never reads as a figure.
                          color: line.unknown ? "var(--muted-foreground)" : undefined,
                          fontStyle: line.unknown ? "italic" : undefined,
                        }}
                      >
                        {line.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Routes pooled USDC into Morpho — the yield is Morpho&apos;s, not Aave&apos;s. There is no live
                APY feed for this vault, so the net is shown as &ldquo;unavailable&rdquo; rather than an
                invented number.
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
                    Performance fee · {feePctInt}% of yield{" "}
                    <span style={{ fontSize: 11 }}>({feeBasisShortLabel(v.feeBasis)})</span>
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
              {/* No live pure-RPC APY-history source exists on ANY chain, so we never draw a curve —
                  a synthesized/mock history would present a fabricated trend as real. Honest note only;
                  the current rate above IS read live on-chain. */}
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>
                APY history isn&apos;t indexed yet — the current rate above is read live on-chain.
              </div>
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
              {isMorphoVenue ? "shares" : "spvUSDC"} ≈ {v.underlying !== undefined ? money(toNum(v.underlying)) : "—"}
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

      {/* 048 + 069/070/071 — ONE vault list: the curated wrapped vaults plus the live
          Rhea/Morpho/Kamino registry rows, tagged and filterable, with each card's real balance
          for the connected wallet on that chain. It is chain-scoped by the caller's session, so
          on the alpha build it shows that chain's record and says honestly when there is none. */}
      <CuratedBoard
        board={curated.board}
        state={curated.state}
        knownVaults={knownVaults}
        fetchedAt={curated.fetchedAt}
      />
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
