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
import { useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import { sparkPointVaultAbi, capRegistryAbi } from "@sparkpoint/shared/abis";
import { getAddresses, resolveTargetRef } from "@sparkpoint/shared/addresses";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
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
  ["pause", "Non-upgradeable, pause-only", "The vault is single-purpose and non-upgradeable. Any pause control governs pausing only — never your funds."],
];

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const usdc0 = (v?: bigint) => (v === undefined ? "…" : `$${Math.round(Number(formatUnits(v, 6))).toLocaleString("en-US")}`);

function AddrRow({ label, addr }: { label: string; addr?: Address }) {
  return (
    <div className="statusrow">
      <span className="muted">{label}</span>
      {addr ? (
        <a className="mono" style={{ fontSize: 12, color: "var(--primary)" }} href={explorerAddressUrl(VAULT_CHAIN, addr)} target="_blank" rel="noreferrer">
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
              <span className="lbl">{vaultUnavailable ? "vault on Base — not on this network" : live ? "live · on-chain" : reads.isError ? "read error" : "reading…"}</span>
            </div>
            {vaultUnavailable ? (
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "2px 0 10px", lineHeight: 1.5 }}>
                <Icon name="info" size={13} /> The AI vault is <b>Base-only</b> and isn&rsquo;t part of the Robinhood
                mainnet beta yet — the figures below describe the testnet vault. Your custody guarantees still hold.
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
              <span style={{ fontWeight: 600 }}>Base Sepolia</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.5 }}>
              <Icon name="info" size={13} /> The kill-switch can pause <b>new</b> deposits in an emergency. It can never
              block your withdrawals (N2).
            </div>
          </div>
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
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Contracts &amp; roles</span>
              <span className="lbl">on-chain · verifiable</span>
            </div>
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
          </div>
          {WHITELISTED.length > 0 && (
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
