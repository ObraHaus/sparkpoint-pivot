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
import { getAddresses } from "@sparkpoint/shared/addresses";
import { Icon, type IconName } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { stageCopy } from "@/lib/stage";
import "@/components/screens/trust.css";

/** The vault lives on Base Sepolia (84532); read there regardless of the connected chain. */
const VAULT_CHAIN = 84532;
const EXPLORER = "https://sepolia.basescan.org";

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
        <a className="mono" style={{ fontSize: 12, color: "var(--primary)" }} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
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

  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;
  const capC = { address: capReg as Address, abi: capRegistryAbi, chainId: VAULT_CHAIN } as const;

  const reads = useReadContracts({
    query: { enabled: !!vault, refetchInterval: 30_000 },
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
              <span className="lbl">{live ? "live · on-chain" : reads.isError ? "read error" : "reading…"}</span>
            </div>
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
                {paused === undefined ? "…" : paused ? "Paused · new deposits halted" : "Pause-only · inactive"}
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Performance fee</span>
              <span style={{ fontWeight: 600 }}>{feePct === undefined ? "…" : `${feePct}% (profit-only)`}</span>
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
            <AddrRow label="Pauser" addr={pauser} />
            <AddrRow label="Fee recipient (2-of-3 treasury)" addr={feeRecipient} />
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
              <Icon name="info" size={12} /> Protocol fees flow to a <b>2-of-3 multisig</b> that only{" "}
              <b>receives</b>. It isn&apos;t the guardian, can&apos;t pause or move the vault, and has{" "}
              <b>no power over your deposits</b> (N5) — read live from <span className="mono">feeRecipient()</span>.
            </div>
          </div>
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
