"use client";

/**
 * Admin → SRK faucet (feature 026).
 *
 * Pure chain reads + CLIENT-SIGNED writes — there is no agent endpoint behind this page and there
 * never can be: the SparkPoint agent is provably keyless, so it cannot sign a setter. "Admin-editable"
 * therefore means the connected admin WALLET signs `setClaimAmount` / `setCooldown` on the deployed
 * `SrkFaucet`. The contract itself is the authority (owner-or-admin); this page reads
 * `isAdmin(connectedWallet)` and says so honestly when the connected wallet isn't one, rather than
 * offering a button that would revert.
 *
 * The faucet holds only its own pre-transferred float and has zero authority over user funds.
 */

import { useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { srkFaucetAbi } from "@sparkpoint/shared/abis";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { faucetErrorCopy, formatCountdown, wholeSrk } from "@/lib/chain/srkFaucet";
import { Icon } from "@/lib/icons";

const SRK_CHAIN = 84532;

type Setter = "claimAmount" | "cooldown";

function shortErr(e: unknown): string {
  const a = e as { shortMessage?: string; message?: string } | null;
  return faucetErrorCopy(a?.shortMessage ?? a?.message ?? "Transaction failed.");
}

export default function Page() {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const owner = address as Address | undefined;
  const faucet = getAddresses(SRK_CHAIN).srkFaucet as Address | undefined;
  const onChain = isConnected && walletChain === SRK_CHAIN;

  const publicClient = usePublicClient({ chainId: SRK_CHAIN });
  const { writeContractAsync } = useWriteContract();

  const [amountInput, setAmountInput] = useState("");
  const [cooldownInput, setCooldownInput] = useState("");
  const [busy, setBusy] = useState<Setter | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; tx?: Hex } | null>(null);

  const read = { address: faucet, abi: srkFaucetAbi, chainId: SRK_CHAIN } as const;
  const on = { query: { enabled: !!faucet } } as const;

  const claimAmount = useReadContract({ ...read, functionName: "claimAmount", ...on });
  const cooldown = useReadContract({ ...read, functionName: "cooldown", ...on });
  const available = useReadContract({ ...read, functionName: "available", ...on });
  const claimsRemaining = useReadContract({ ...read, functionName: "claimsRemaining", ...on });
  const contractOwner = useReadContract({ ...read, functionName: "owner", ...on });
  const isAdmin = useReadContract({
    ...read,
    functionName: "isAdmin",
    args: owner ? [owner] : undefined,
    query: { enabled: !!faucet && !!owner },
  });

  const canEdit = onChain && isAdmin.data === true;
  const paused = claimAmount.data === 0n;

  const refresh = () => {
    void claimAmount.refetch();
    void cooldown.refetch();
    void available.refetch();
    void claimsRemaining.refetch();
  };

  const send = async (which: Setter, args: readonly [bigint]) => {
    if (!faucet || !publicClient) return;
    setBusy(which);
    setMsg(null);
    try {
      const tx = await writeContractAsync({
        address: faucet,
        abi: srkFaucetAbi,
        functionName: which === "claimAmount" ? "setClaimAmount" : "setCooldown",
        args,
        chainId: SRK_CHAIN,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        setMsg({ kind: "err", text: "The transaction reverted — nothing changed on-chain.", tx });
        return;
      }
      setMsg({ kind: "ok", text: `Updated ${which === "claimAmount" ? "the claim amount" : "the cooldown"}.`, tx });
      if (which === "claimAmount") setAmountInput("");
      else setCooldownInput("");
      refresh();
    } catch (e) {
      setMsg({ kind: "err", text: shortErr(e) });
    } finally {
      setBusy(null);
    }
  };

  const submitAmount = () => {
    const raw = amountInput.trim();
    if (!/^\d+(\.\d{1,18})?$/.test(raw)) {
      setMsg({ kind: "err", text: "Enter the new per-claim amount in whole SRK (e.g. 5000). 0 pauses claiming." });
      return;
    }
    void send("claimAmount", [parseUnits(raw, 18)]);
  };

  const submitCooldown = () => {
    const raw = cooldownInput.trim();
    if (!/^\d+$/.test(raw)) {
      setMsg({ kind: "err", text: "Enter the new cooldown in SECONDS (e.g. 86400 for 24h)." });
      return;
    }
    const seconds = BigInt(raw);
    if (seconds > 365n * 86_400n) {
      setMsg({ kind: "err", text: "The contract caps the cooldown at 365 days (31536000 seconds)." });
      return;
    }
    void send("cooldown", [seconds]);
  };

  const txUrl = msg?.tx ? explorerTxUrl(SRK_CHAIN, msg.tx) : undefined;
  const val = (v: bigint | undefined, fmt: (b: bigint) => string) => (v === undefined ? "…" : fmt(v));

  return (
    <>
      <div className="pghead">
        <div>
          <h1>SRK faucet</h1>
          <div className="sub">
            The testnet SRK dispenser behind the Premium page. Parameters live on-chain — the agent is
            keyless and cannot change them, so YOUR connected wallet signs these edits.
          </div>
        </div>
      </div>

      {!faucet ? (
        <div className="chartcard">
          <div style={{ padding: "12px 8px", fontSize: 13, color: "var(--muted-foreground)" }}>
            No faucet is recorded for Base Sepolia in the address book — nothing to administer.
          </div>
        </div>
      ) : (
        <>
          <div className="chartcard" style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">Live state</span>
              <span className="prov">read from chain</span>
            </div>
            <div style={{ padding: "4px 2px" }}>
              <div className="statusrow">
                <span>Per claim</span>
                <span className="mono">
                  {val(claimAmount.data as bigint | undefined, (b) => `${wholeSrk(b).toLocaleString()} SRK`)}
                  {paused && <span style={{ color: "var(--caution)" }}> · claiming PAUSED</span>}
                </span>
              </div>
              <div className="statusrow">
                <span>Cooldown</span>
                <span className="mono">
                  {val(cooldown.data as bigint | undefined, (b) => `${b.toString()}s (${formatCountdown(Number(b))})`)}
                </span>
              </div>
              <div className="statusrow">
                <span>Remaining float</span>
                <span className="mono">
                  {val(available.data as bigint | undefined, (b) => `${wholeSrk(b).toLocaleString()} SRK`)}
                  {claimsRemaining.data !== undefined && ` · ${(claimsRemaining.data as bigint).toString()} claims`}
                </span>
              </div>
              <div className="statusrow">
                <span>Contract</span>
                <a
                  className="mono"
                  href={`https://sepolia.basescan.org/address/${faucet}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--primary)" }}
                >
                  {faucet} ↗
                </a>
              </div>
              <div className="statusrow">
                <span>Owner (can withdraw the float)</span>
                <span className="mono">{(contractOwner.data as string | undefined) ?? "…"}</span>
              </div>
            </div>
          </div>

          {!canEdit && (
            <div
              className="chartcard"
              style={{ marginBottom: 14, borderColor: "color-mix(in srgb,var(--caution) 30%,var(--border))" }}
            >
              <div style={{ padding: "12px 10px", fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.55, display: "flex", gap: 8 }}>
                <span style={{ color: "var(--caution)", flex: "none" }}>
                  <Icon name="info" size={15} />
                </span>
                <span>
                  {!isConnected
                    ? "Connect the admin wallet to edit these parameters."
                    : !onChain
                      ? "Switch your wallet to Base Sepolia to edit these parameters."
                      : isAdmin.data === undefined
                        ? "Checking whether this wallet is a faucet admin…"
                        : "This wallet is not a faucet admin on the contract, so the setters would revert. The faucet owner can grant it with setAdmin(address,true)."}
                </span>
              </div>
            </div>
          )}

          <div className="chartcard" style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">Amount per claim</span>
              <span className="prov">setClaimAmount</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 4px", alignItems: "center" }}>
              <input
                className="mono"
                placeholder={
                  claimAmount.data !== undefined
                    ? `${formatUnits(claimAmount.data as bigint, 18)} (whole SRK)`
                    : "whole SRK, e.g. 5000"
                }
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                style={INPUT}
              />
              <button className="btn btn-primary btn-sm" disabled={!canEdit || busy !== null} onClick={submitAmount}>
                {busy === "claimAmount" ? "Confirm in your wallet…" : "Update"}
              </button>
            </div>
            <div style={{ padding: "0 8px 10px", fontSize: 11.5, color: "var(--muted-foreground)" }}>
              Setting <b>0</b> pauses claiming without moving the float.
            </div>
          </div>

          <div className="chartcard" style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">Cooldown</span>
              <span className="prov">setCooldown</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 4px", alignItems: "center" }}>
              <input
                className="mono"
                placeholder={
                  cooldown.data !== undefined ? `${(cooldown.data as bigint).toString()} (seconds)` : "seconds, e.g. 86400"
                }
                value={cooldownInput}
                onChange={(e) => setCooldownInput(e.target.value)}
                style={INPUT}
              />
              <button className="btn btn-primary btn-sm" disabled={!canEdit || busy !== null} onClick={submitCooldown}>
                {busy === "cooldown" ? "Confirm in your wallet…" : "Update"}
              </button>
            </div>
            <div style={{ padding: "0 8px 10px", fontSize: 11.5, color: "var(--muted-foreground)" }}>
              Seconds between claims per address. Shortening it applies immediately, including to
              wallets already waiting. The contract caps it at 365 days.
            </div>
          </div>

          {msg && (
            <div
              style={{
                padding: "8px 10px",
                fontSize: 12.5,
                color: msg.kind === "ok" ? "var(--gain)" : "var(--loss, #ff6b6b)",
              }}
            >
              {msg.text}{" "}
              {txUrl && (
                <a href={txUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>
                  View tx ↗
                </a>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

const INPUT: React.CSSProperties = {
  flex: "1 1 260px",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
};
