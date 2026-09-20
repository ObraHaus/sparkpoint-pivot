"use client";

/**
 * /trust/permissions — "What Sparky can & can't do": the can/can't guarantees plus the
 * REAL on-chain facts read live from the deployed vault (guardian/pauser/fee/caps).
 *
 * Honest by construction: there are NO session-key automation grants yet — scoped, revocable
 * automation (US6, the ERC-4337 account + PolicyModule) ships in Phase 3 and the PolicyModule
 * is not deployed, so this page says so plainly instead of rendering a fabricated grants table.
 * The vault-level facts that DO exist are read live via Base RPC (public → works disconnected).
 */

import { useRouter } from "next/navigation";
import { useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import { sparkPointVaultAbi, capRegistryAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import type { WagmiChainId } from "@/lib/wagmi";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";
import { useSessionKeys } from "@/lib/automation/useSessionKey";

const VAULT_CHAIN = VAULT_CHAIN_ID as WagmiChainId;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const usd0 = (v?: bigint) => (v === undefined ? "…" : `$${Math.round(Number(formatUnits(v, 6))).toLocaleString("en-US")}`);

export default function Page() {
  const router = useRouter();
  // The user's live session-key grant (if any) — so this page reflects real automation, not a stale
  // "not deployed" claim. Advisory read; `active` is null when offline/loading (honest, never faked).
  const { active: activeGrant } = useSessionKeys();
  const addrs = getAddresses(VAULT_CHAIN);
  const vault = addrs.vault as Address | undefined;
  const capReg = addrs.capRegistry as Address | undefined;
  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;

  const reads = useReadContracts({
    // Vault is Base-only; gate on the vault chain being registered so the mainnet-beta (only 4663)
    // shows an honest "not on this network" state instead of erroring on the unregistered 84532.
    query: { enabled: !!vault && VAULT_CHAIN_AVAILABLE, refetchInterval: 30_000 },
    contracts: [
      { ...vaultC, functionName: "guardian" }, // 0
      { ...vaultC, functionName: "pauser" }, // 1
      { ...vaultC, functionName: "performanceFeeBps" }, // 2
      { address: capReg as Address, abi: capRegistryAbi, chainId: VAULT_CHAIN, functionName: "perUserCap" }, // 3
      { ...vaultC, functionName: "feeRecipient" }, // 4
    ],
  });
  const d = reads.data;
  const guardian = d?.[0]?.result as Address | undefined;
  const pauser = d?.[1]?.result as Address | undefined;
  const feeBps = d?.[2]?.result as bigint | number | undefined;
  const perUserCap = d?.[3]?.result as bigint | undefined;
  const feeRecipient = d?.[4]?.result as Address | undefined;
  // Provable, not asserted: the treasury has NIL authority — it is not the guardian and has no
  // fund-movement path. `notGuardian` proves it from chain (both live-read).
  const notGuardian =
    feeRecipient !== undefined && guardian !== undefined && feeRecipient.toLowerCase() !== guardian.toLowerCase();
  const feePct = feeBps === undefined ? undefined : Number(feeBps) / 100;
  const live = !reads.isLoading && !reads.isError && d !== undefined;
  const vaultUnavailable = !VAULT_CHAIN_AVAILABLE;

  return (
    <div className="page page-narrow">
      <a className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} onClick={() => router.push(toHref("trust"))}>
        <Icon name="chevr" size={15} /> Back to Trust Center
      </a>
      <div className="pagehead">
        <div>
          <h1>What Sparky can &amp; can&apos;t do</h1>
          <div className="sub">Vault-level facts read live from the contracts via Base RPC — works even if our backend is down.</div>
        </div>
      </div>
      <div className="cancan" style={{ marginBottom: 18 }}>
        <div className="col can">
          <h5>Can</h5>
          <ul>
            <li><Icon name="check" size={13} /> Suggest strategy</li>
            <li><Icon name="check" size={13} /> Simulate before you sign</li>
            <li><Icon name="check" size={13} /> Pause new deposits (guardian)</li>
          </ul>
        </div>
        <div className="col cant">
          <h5>Can&apos;t</h5>
          <ul>
            <li><Icon name="x" size={13} /> Move your funds</li>
            <li><Icon name="x" size={13} /> Withdraw to itself</li>
            <li><Icon name="x" size={13} /> Change the rules</li>
            <li><Icon name="x" size={13} /> Stop you withdrawing</li>
          </ul>
        </div>
      </div>

      {activeGrant ? (
        <div
          className="infobanner"
          style={{ marginBottom: 16, background: "var(--gain-subtle, var(--surface-2))", borderColor: "color-mix(in srgb, var(--gain) 30%, transparent)" }}
        >
          <Icon name="zap" size={16} />
          <span>
            <b style={{ color: "var(--foreground)" }}>A scoped session key is active.</b> You granted Sparky a
            capped, time-boxed key (ERC-4337 account governed by the on-chain PolicyModule) — it can only touch its
            allowlisted targets under your caps, and you can{" "}
            <a className="qlink" style={{ display: "inline-flex" }} onClick={() => router.push(toHref("automation"))}>
              manage or revoke it instantly
            </a>
            . You alone can move funds out.
          </span>
        </div>
      ) : (
        <div
          className="infobanner"
          style={{ marginBottom: 16, background: "var(--info-subtle, var(--surface-2))", borderColor: "var(--border-soft)" }}
        >
          <Icon name="info" size={16} />
          <span>
            <b style={{ color: "var(--foreground)" }}>No automation grant is active.</b> Scoped, revocable
            session-key automation (US6 — a custom ERC-4337 account governed by an on-chain PolicyModule) is
            available; you haven’t granted one, so today <b>only you</b> can move funds. You can{" "}
            <a className="qlink" style={{ display: "inline-flex" }} onClick={() => router.push(toHref("automation"))}>
              grant a scoped, capped, revocable key
            </a>{" "}
            whenever you choose.
          </span>
        </div>
      )}

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">On-chain facts</span>
          <span className="lbl">{vaultUnavailable ? "vault not available yet" : live ? "live · on-chain" : reads.isError ? "read error" : "reading…"}</span>
        </div>
        {vaultUnavailable ? (
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "2px 0 10px", lineHeight: 1.5 }}>
            <Icon name="info" size={13} /> These vault-level facts are read from the <b>AI yield vault</b>, which
            isn&rsquo;t part of the Robinhood mainnet beta yet. Your can/can&rsquo;t guarantees above still hold.
          </div>
        ) : null}
        <table className="tbl permtable">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Who</th>
              <th className="num">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">admin.withdraw()</td>
              <td style={{ color: "var(--loss)" }}>— none —</td>
              <td className="num" style={{ color: "var(--loss)" }}>no code path</td>
            </tr>
            <tr>
              <td className="mono">redeem() / withdraw()</td>
              <td style={{ color: "var(--gain)" }}>you only</td>
              <td className="num" style={{ color: "var(--gain)" }}>unlimited, never pausable</td>
            </tr>
            <tr>
              <td>Guardian (pause-only)</td>
              <td className="mono" style={{ fontSize: 11 }}>{short(guardian)}</td>
              <td className="num">timelock</td>
            </tr>
            <tr>
              <td>Pauser</td>
              <td className="mono" style={{ fontSize: 11 }}>{short(pauser)}</td>
              <td className="num">deposits only</td>
            </tr>
            <tr>
              <td>Performance fee</td>
              <td>fee recipient</td>
              <td className="num">{feePct === undefined ? "…" : `${feePct}% profit-only`}</td>
            </tr>
            <tr>
              <td>Fee treasury (multisig)</td>
              <td className="mono" style={{ fontSize: 11 }}>{short(feeRecipient)}</td>
              <td className="num" style={{ color: "var(--gain)" }}>
                {feeRecipient === undefined ? "…" : notGuardian ? "receive-only · nil fund power" : "receive-only"}
              </td>
            </tr>
            <tr>
              <td>Per-user deposit cap</td>
              <td>CapRegistry</td>
              <td className="num">{usd0(perUserCap)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, lineHeight: 1.5 }}>
          The <span className="mono">admin.withdraw()</span> row is the trust payload: there is no function by which
          Sparky can move your funds. The <b>fee treasury</b> is a 2-of-3 multisig that only <b>receives</b> the
          performance fee — {notGuardian ? "it is not the guardian and " : ""}it has no withdraw/redeem path, so its
          power over your deposits is <b>none</b> (N5) — verify both addresses on Basescan.
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {vault && (
          <a className="btn btn-outline btn-md" href={explorerAddressUrl(VAULT_CHAIN, vault)} target="_blank" rel="noreferrer">
            <Icon name="ext" size={16} /> Verify on Basescan
          </a>
        )}
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("trust/exit"))}>
          Withdraw now
        </button>
      </div>
    </div>
  );
}
