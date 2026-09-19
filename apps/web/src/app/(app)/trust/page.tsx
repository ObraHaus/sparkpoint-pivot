"use client";

/**
 * /trust — Trust Center hub: five structural guarantees, LIVE on-chain status, beta caps,
 * real contract addresses, and the exit / automation entry points.
 *
 * The status/addresses/caps are driven by LIVE RPC reads (guardian, pauser, paused,
 * performanceFeeBps, totalAssets, + the CapRegistry caps) against the deployed Base-Sepolia
 * vault via `@sparkpoint/shared` addresses — no fabricated address, no fabricated audit. Reads
 * are public (chain 84532), so this page renders truthfully whether or not a wallet is connected.
 * /trust is NEVER gated by auth (non-custody law) — proving custody must always be reachable.
 */

import { useRouter } from "next/navigation";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import { brokerEngineAbi, sparkPointVaultAbi, capRegistryAbi } from "@sparkpoint/shared/abis";
import { getAddresses, resolveTargetRef } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS } from "@sparkpoint/shared/chains";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { APP_DEFAULT_CHAIN_ID, VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import type { WagmiChainId } from "@/lib/wagmi";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { Icon, type IconName } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { stageCopy } from "@/lib/stage";
import { whitelistedProtocols, actionLabel } from "@/lib/policy/whitelistedProtocols";
import "@/components/screens/trust.css";

/** The vault lives on Base Sepolia (84532); read there regardless of the connected chain. */
const VAULT_CHAIN = VAULT_CHAIN_ID as WagmiChainId;

/**
 * The mainnet-beta build (4663) has no Aave vault, but it DOES have the deployed revenue set
 * (engine / vault / splitter / sink / token / NFT). Its Trust Center must show those real addresses
 * rather than the older "nothing is deployed yet" line.
 */
const BETA_REVENUE = APP_DEFAULT_CHAIN_ID === CHAIN_IDS.robinhoodMainnet;
const BETA_CHAIN = CHAIN_IDS.robinhoodMainnet as WagmiChainId;

/**
 * The closed set of EXTERNAL on-chain venues the agent may route funds into (G5), derived from the
 * policy allowlist SoT joined to the address book. Vault entries are excluded (the vault itself is
 * shown in "Contracts & roles"); Aerodrome is already stripped by getPolicyConstants as undeployed
 * on 84532. On Base Sepolia this is exactly Aave v3 Pool — no address hardcoded (Principle III).
 */
const WHITELISTED = whitelistedProtocols(
  getPolicyConstants(VAULT_CHAIN).allowlist,
  (ref) => resolveTargetRef(VAULT_CHAIN, ref),
).filter((p) => p.targetRef !== "sparkpoint_vault");

const GUARANTEES: [IconName, string, string][] = [
  ["shieldcheck", "No admin withdrawal", "We have no code path to send your funds anywhere but back to you — not us, not anyone."],
  ["door", "Withdraw-always", "Exit directly on-chain, even if Sparky's app and AI are completely offline."],
  ["key", "You own your keys", "You own your keys and your account. We never generate a wallet for you or hold your keys."],
  ["zap", "Scoped, revocable automation", "Any automation you grant is scoped, capped, time-limited, and revocable by you instantly — without our help."],
  ["pause", "Non-upgradeable core, pause-only", "SparkPoint’s own vault is single-purpose and non-upgradeable; any pause control governs pausing only — never your funds. Curated-vault wrappers can be upgraded, but only through a public 72-hour timelock, and no upgrade can ever block an exit."],
];

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const usdc0 = (v?: bigint) => (v === undefined ? "…" : `$${Math.round(Number(formatUnits(v, 6))).toLocaleString("en-US")}`);

function AddrRow({ label, addr, chainId = VAULT_CHAIN }: { label: string; addr?: Address; chainId?: WagmiChainId }) {
  return (
    <div className="statusrow">
      <span className="muted">{label}</span>
      {addr ? (
        <a className="mono" style={{ fontSize: 12, color: "var(--primary)" }} href={explorerAddressUrl(chainId, addr)} target="_blank" rel="noreferrer">
          {short(addr)} <Icon name="ext" size={11} />
        </a>
      ) : (
        <span className="mono" style={{ fontSize: 12 }}>…</span>
      )}
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const addrs = getAddresses(VAULT_CHAIN);
  const beta = BETA_REVENUE ? getAddresses(CHAIN_IDS.robinhoodMainnet) : undefined;

  // The engine is a UUPS proxy; its owner is the address that can upgrade it, so the Trust Center
  // reads it live rather than naming the deployer from memory.
  const engineOwnerRead = useReadContract({
    address: beta?.brokerEngine as Address | undefined,
    abi: brokerEngineAbi,
    functionName: "owner",
    chainId: BETA_CHAIN,
    query: { enabled: BETA_REVENUE && Boolean(beta?.brokerEngine) },
  });
  const engineOwner = engineOwnerRead.data as Address | undefined;
  const vault = addrs.vault as Address | undefined;
  const capReg = addrs.capRegistry as Address | undefined;
  const govSafe = addrs.governanceSafe as Address | undefined;
  const factory = addrs.sparkPointVaultFactory as Address | undefined;
  const swapRouter = addrs.uniswapV3SwapRouter02 as Address | undefined;
  const wrappers = addrs.sparkPointWrappers ?? [];

  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;
  const capC = { address: capReg as Address, abi: capRegistryAbi, chainId: VAULT_CHAIN } as const;

  const reads = useReadContracts({
    // Vault is Base-only; on the mainnet-beta build (only 4663 registered) it is absent, so gate the
    // read on the vault chain being registered — otherwise it errors on the unregistered 84532.
    query: { enabled: !!vault && VAULT_CHAIN_AVAILABLE, refetchInterval: 30_000 },
    contracts: [
      { ...vaultC, functionName: "paused" }, // 0
      { ...vaultC, functionName: "performanceFeeBps" }, // 1
      { ...vaultC, functionName: "guardian" }, // 2
      { ...vaultC, functionName: "pauser" }, // 3
      { ...vaultC, functionName: "totalAssets" }, // 4
      { ...capC, functionName: "perUserCap" }, // 5
      { ...capC, functionName: "vaultCap" }, // 6
      { ...vaultC, functionName: "feeRecipient" }, // 7
    ],
  });

  const d = reads.data;
  const paused = d?.[0]?.result as boolean | undefined;
  const feeBps = d?.[1]?.result as bigint | number | undefined;
  const guardian = d?.[2]?.result as Address | undefined;
  const pauser = d?.[3]?.result as Address | undefined;
  const tvl = d?.[4]?.result as bigint | undefined;
  const perUserCap = d?.[5]?.result as bigint | undefined;
  const vaultCap = d?.[6]?.result as bigint | undefined;
  const feeRecipient = d?.[7]?.result as Address | undefined;
  const feePct = feeBps === undefined ? undefined : Number(feeBps) / 100;
  const live = !reads.isLoading && !reads.isError && d !== undefined;
  // On the mainnet-beta build the vault chain isn't registered, so show an honest "not on this
  // network" state (the vault is Base-only) instead of a stuck "reading…" / "read error".
  const vaultUnavailable = !VAULT_CHAIN_AVAILABLE;

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Trust Center</h1>
          <div className="sub">Fully self-custodial — your keys, your funds, always. Proven, not promised.</div>
        </div>
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("trust/permissions"))}>
          <Icon name="shieldcheck" size={16} /> Prove it
        </button>
      </div>
      <div className="trust-grid" style={{ marginBottom: 18 }}>
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Five structural guarantees</span>
          </div>
          {GUARANTEES.map((g) => (
            <div className="guarantee" key={g[1]}>
              <span className="gico">
                <Icon name={g[0]} size={18} />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{g[1]}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, marginTop: 3 }}>{g[2]}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Status</span>
              <span className="lbl">{vaultUnavailable ? "vault not available yet" : live ? "live · on-chain" : reads.isError ? "read error" : "reading…"}</span>
            </div>
            {vaultUnavailable ? (
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "2px 0 10px", lineHeight: 1.5 }}>
                <Icon name="info" size={13} /> The AI vault isn&rsquo;t part of the Robinhood Chain beta yet — it
                arrives in a later step. Your custody guarantees still hold.
              </div>
            ) : null}
            <div className="statusrow">
              <span className="muted">Custody invariants</span>
              <span style={{ color: "var(--gain)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="check" size={14} /> Enforced on-chain
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Kill-switch</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                <Icon name="pause" size={14} />
                {vaultUnavailable ? "—" : paused === undefined ? "…" : paused ? "Paused · new deposits halted" : "Pause-only · inactive"}
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Performance fee</span>
              <span style={{ fontWeight: 600 }}>{vaultUnavailable ? "—" : feePct === undefined ? "…" : `${feePct}% (profit-only)`}</span>
            </div>
            <div className="statusrow">
              <span className="muted">Network</span>
              <span style={{ fontWeight: 600 }}>{vaultUnavailable ? "—" : "Base Sepolia"}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.5 }}>
              <Icon name="info" size={13} /> The kill-switch can pause <b>new</b> deposits in an emergency. It can never
              block your withdrawals (N2).
            </div>
          </div>
          {!vaultUnavailable && (
            <div className="card card-pad">
              <div className="card-hd">
                <span className="t">{stageCopy.label} caps</span>
                <span className="lbl">CapRegistry · live</span>
              </div>
              <div className="statusrow">
                <span className="muted">Per-user cap</span>
                <span className="tnum">{usdc0(perUserCap)}</span>
              </div>
              <div className="statusrow">
                <span className="muted">Vault TVL / cap</span>
                <span className="tnum">
                  {usdc0(tvl)} / {usdc0(vaultCap)}
                </span>
              </div>
            </div>
          )}
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Contracts &amp; roles</span>
              <span className="lbl">
                {BETA_REVENUE
                  ? "beta revenue set · verifiable"
                  : vaultUnavailable
                    ? "none deployed yet"
                    : "on-chain · verifiable"}
              </span>
            </div>
            {BETA_REVENUE && beta ? (
              <>
                <AddrRow chainId={BETA_CHAIN} label="Utility token (SPARKYTEST)" addr={beta.utilityToken as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Sparky Broker - Test (NFT)" addr={beta.brokerNft as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="BrokerEngine (UUPS proxy · clock in / promote / fuse)" addr={beta.brokerEngine as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="BrokerVault (immutable · holds what brokers earn)" addr={beta.brokerVault as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="RevenueSplitter (immutable · 90% holders / 10% treasury)" addr={beta.revenueSplitter as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="FeeRouter (UUPS · 0.20% swap fee → splitter)" addr={beta.feeRouter as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Swap quoter BetaQuoterV2 (read-only swap quotes)" addr={beta.uniswapV3QuoterV2 as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="RoyaltySink (immutable · marketplace royalties)" addr={beta.royaltySink as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Revenue treasury (the 10% share)" addr={beta.revenueTreasury as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Vault factory V3 (admission gateway · one wrapper per vault)" addr={beta.sparkPointVaultFactoryV3 as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Vault upgrade timelock (72h · owns the wrapper beacon)" addr={beta.sparkPointVaultTimelock as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Wrapper beacon (upgrade authority for wrapper code)" addr={beta.sparkPointVaultBeacon as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Engine owner (can upgrade the engine)" addr={engineOwner} />
                <AddrRow chainId={BETA_CHAIN} label="Pons curve (trading fees accrue here)" addr={beta.ponsCurve as Address | undefined} />
                <AddrRow chainId={BETA_CHAIN} label="Pons fee escrow" addr={beta.ponsFeeEscrow as Address | undefined} />
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                  <Icon name="info" size={12} /> The <b>BrokerEngine</b> is a UUPS proxy: the owner above can
                  upgrade its implementation. The <b>BrokerVault</b> that holds the earnings has <b>no owner, no
                  upgrade path, no fee and no rescue function</b> — the only way value leaves it is a broker’s owner
                  withdrawing that broker’s balance.
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                  <Icon name="info" size={12} /> Every action on the set is <b>user-signed or permissionless</b>{" "}
                  (clock in / promote / fuse / withdraw are yours; settle / deliver / sweeps may be called by anyone).
                  No agent path can reach any of these contracts — the Robinhood Chain policy allowlist is empty.
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                  <Icon name="info" size={12} /> Revenue arrives as ETH and is delivered as ETH — the splitter and
                  engine hold no swap route and no payout asset. The AI vault, the utility token’s Premium surface
                  and the production broker collection are later steps.
                </div>
              </>
            ) : vaultUnavailable ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
                <Icon name="info" size={13} /> No SparkPoint contracts are deployed on Robinhood Chain yet — the
                utility token, the AI vault, the Sparky Broker and the reward engine all arrive in a later step.
                Swaps use the network&rsquo;s existing Uniswap V3 (user-signed; SparkPoint never holds your funds).
              </div>
            ) : (
              <>
                <AddrRow label="Vault (ERC-4626)" addr={vault} />
                <AddrRow label="Cap registry" addr={capReg} />
                <AddrRow label="Guardian (timelock)" addr={guardian} />
                <AddrRow label="Guardian controller (2-of-3 Safe)" addr={govSafe} />
                <AddrRow label="Pauser" addr={pauser} />
                <AddrRow label="Fee recipient (2-of-3 treasury)" addr={feeRecipient} />
                <AddrRow label="Vault factory (branded wrappers)" addr={factory} />
                <AddrRow label="Swap router (Uniswap V3 · user-signed)" addr={swapRouter} />
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                  <Icon name="info" size={12} /> The <b>vault factory</b> only deploys branded wrapper vaults (deploy-time
                  only — never a fund path). The <b>swap router</b> powers the separate <b>user-signed</b> swap page: you
                  sign every swap yourself, and it is <b>not</b> a vault or agent path.
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                  <Icon name="info" size={12} /> The guardian timelock is controlled by a <b>2-of-3 multisig</b> — no single
                  key can pause the vault or change fees/caps; only <b>2-of-3</b> of the guardian signers can, after the
                  timelock delay. It is <b>pause-only</b> and can never block your withdrawals (N2/N5). A <b>separate</b>{" "}
                  2-of-3 multisig only <b>receives</b> fees (via <span className="mono">feeRecipient()</span>) and has no power
                  over the vault.
                </div>
              </>
            )}
          </div>
          {!vaultUnavailable && WHITELISTED.length > 0 && (
            <div className="card card-pad">
              <div className="card-hd">
                <span className="t">Whitelisted protocols</span>
                <span className="lbl">closed allowlist · G5</span>
              </div>
              {WHITELISTED.map((p) => (
                <div className="statusrow" key={p.targetRef}>
                  <span>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.label}</span>
                    <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>
                      {p.actions.map(actionLabel).join(" · ")}
                    </span>
                  </span>
                  <a
                    className="mono"
                    style={{ fontSize: 12, color: "var(--primary)" }}
                    href={explorerAddressUrl(VAULT_CHAIN, p.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(p.address)} <Icon name="ext" size={11} />
                  </a>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                <Icon name="info" size={12} /> The agent can call <b>only</b> these audited, allowlisted
                contracts — a closed set enforced on-chain (G5). Anything else is unreachable; your deposits
                and withdrawals always settle to your own account.
              </div>
              {wrappers.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    User-signed vaults{" "}
                    <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>· not agent-routed</span>
                  </div>
                  {wrappers.map((w) => (
                    <div className="statusrow" key={w.address}>
                      <span>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{w.label}</span>
                        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                          {w.retired
                            ? "retired · withdrawals only · wraps a mock Morpho vault"
                            : "testnet demo · wraps a mock Morpho vault"}
                        </span>
                      </span>
                      <a
                        className="mono"
                        style={{ fontSize: 12, color: "var(--primary)" }}
                        href={explorerAddressUrl(VAULT_CHAIN, w.address)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(w.address)} <Icon name="ext" size={11} />
                      </a>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
                    <Icon name="info" size={12} /> A branded ERC-4626 wrapper you deposit into with <b>your own
                    signature</b> (never agent-routed). This one wraps a <b>mock</b> Morpho vault, so we have{" "}
                    <b>retired it: deposits are closed, withdrawals stay open</b> and are never gated by us (N2).
                    Morpho <i>does</i> run on Base Sepolia — Morpho Blue and the Vault V2 factory are both live there —
                    so a real Morpho vault replaces this one rather than another mock.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 048 / T305 — AI-curated vaults: the disclosure FR-010 requires, in the user's terms.
          Everything here is a property of the system, not a promise about returns. */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-hd">
          <span className="t">AI-curated vaults</span>
          <span className="lbl">off-chain list · on-chain deposits</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          The curated board on the <b>Vault</b> page is assembled by Sparky: a daily bot reads a
          public vault source, screens each candidate (asset, size, withdrawable liquidity, age,
          warnings) and scores it. That list lives <b>off-chain</b> in SparkPoint&rsquo;s database —
          adding, ranking or removing a vault is a record, never a transaction, and the only
          on-chain step is <b>your own signed deposit</b>.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 10 }}>
          <b>AI proposes, a person publishes.</b> Every autonomous action has a manual equivalent in
          the admin panel, every admin decision outranks the bot and is never overwritten by a later
          scan, and each row is labelled <b>AI</b> or <b>Admin</b> so you can see who put it there.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 10 }}>
          <b>Fees are performance-only.</b> Where SparkPoint deploys a wrapper over a curated vault,
          the fee applies <b>only to gains above the high-water mark</b> — never to a deposit, a
          withdrawal, or a flat or losing position. A curated vault <b>without</b> a wrapper is
          deposited <b>directly</b> from your wallet and carries <b>no SparkPoint fee</b>; the board
          says which is which, and a wrapper is only shown once an operator has actually deployed
          it.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 10 }}>
          <b>Admission: the AI wraps on a cooling-off window; a person can act instantly.</b> When a
          curated vault gets a wrapper, the AI can admit it on its own — but the wrapper is not
          deployable until an on-chain <b>cooling-off window</b> elapses (24 hours by default,
          operator-configurable between 1 hour and 7 days). The operator can admit and deploy a vault{" "}
          <b>immediately</b>, release a cooling entry early, or cancel a pending one.{" "}
          <b>One wrapper per vault</b> is enforced on-chain, and the AI never deploys an entry the
          operator added — provenance is checked off-chain before the AI acts.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 10 }}>
          <b>Wrappers upgrade behind a timelock; your exit never waits on anyone.</b> The wrapper
          family is upgradeable by design so a fix reaches every wrapper at once — but only a{" "}
          <b>3-of-5 proposer multisig</b> can start an upgrade, it must wait out a{" "}
          <b>72-hour timelock</b>, and an independent <b>2-of-3 canceller</b> can veto it. The
          timelock is confined to <b>code/proxy upgrades and non-admission parameters</b> (beacon,
          guardian, fee recipient, deploy limit, roles) — it cannot admit or deploy a vault. The AI
          deployer key can only admit (after the cooldown) and deploy; it has no unwhitelist,
          release, cooldown, upgrade, pause or fund power. Withdrawals are direct on-chain calls to
          the wrapper: no pause, upgrade or operator action can block them.{" "}
          <b>Residual risk:</b> an upgrade is still a change to the code around your position, and a
          curated child vault is a third-party venue (Morpho) with its own risks — the timelock, the
          canceller and the always-open exit are the guardrails, not a guarantee of returns.
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 12 }}>
          <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault"))}>
            Open the curated board
          </a>
          <span className="muted"> · </span>
          <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("trust/permissions"))}>
            What the admin can and cannot do
          </a>
        </div>
      </div>

      <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Exit anytime</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>The self-service exit works even if Sparky is entirely offline.</div>
        </div>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/exit"))}>
          <Icon name="door" size={16} /> Withdraw / Exit
        </button>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("automation"))}>
          <Icon name="zap" size={16} /> Automation
        </button>
      </div>
    </div>
  );
}
