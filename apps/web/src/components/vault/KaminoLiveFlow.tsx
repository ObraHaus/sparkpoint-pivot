"use client";

/**
 * 077 — Kamino (Solana) live deposit/withdraw flow.
 *
 * Amount → build (our BFF asks Kamino for an UNSIGNED transaction) → review every amount/account/
 * fee → the user explicitly confirms in their own Solana wallet → read the position back.
 *
 * The wallet is the only signer. SparkPoint never holds a key and never submits anything itself;
 * `submitSolanaTransaction` is called only from the confirm button below.
 */

import { useCallback, useMemo, useState } from "react";
import { Connection, PublicKey, type VersionedTransaction } from "@solana/web3.js";

import { Icon } from "@/lib/icons";
import {
  KAMINO_VAULTS,
  SOLANA_MAINNET_RPC,
  apyPercent,
  decodeKaminoTransaction,
  findKaminoVault,
  formatLamports,
  formatTokenAmount,
  summarizeKaminoTransaction,
  type KaminoBuildResponse,
  type KaminoPositionView,
  type KaminoTxReview,
} from "@/lib/earn/kaminoLive";
import type { LiveEarnMode } from "@/lib/earn/liveFlags";
import {
  connectSolanaWallet,
  getInjectedSolanaProvider,
  solanaWalletErrorMessage,
  submitSolanaTransaction,
  type SolanaInjectedProvider,
} from "@/lib/solana/wallet";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const MUTED = "var(--muted-foreground)";

type Phase = "idle" | "building" | "review" | "submitting" | "done";

function solanaRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || SOLANA_MAINNET_RPC;
}

function short(value: string, head = 6, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" | "gain" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span
        style={{
          color: tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--foreground)",
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "caution" | "gain" }) {
  const c = tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--info)";
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 12,
        lineHeight: 1.5,
        color: c,
        background: `color-mix(in srgb, ${c} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, transparent)`,
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      {children}
    </div>
  );
}

async function readAssetBalance(owner: string, assetMint: string, decimals: number): Promise<string | null> {
  try {
    const connection = new Connection(solanaRpcUrl(), "confirmed");
    if (assetMint === SOL_MINT) {
      const lamports = await connection.getBalance(new PublicKey(owner));
      return formatTokenAmount(BigInt(lamports), 9);
    }
    const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
      mint: new PublicKey(assetMint),
    });
    let total = 0n;
    for (const account of accounts.value) {
      const amount = (account.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })
        .parsed?.info?.tokenAmount?.amount;
      if (typeof amount === "string") total += BigInt(amount);
    }
    return formatTokenAmount(total, decimals);
  } catch {
    return null;
  }
}

export interface KaminoLiveFlowProps {
  readonly vault: string | null;
  readonly mode: LiveEarnMode;
  readonly initialAmount: string | null;
}

export function KaminoLiveFlow({ vault, mode: initialMode, initialAmount }: KaminoLiveFlowProps) {
  const initialVault = useMemo(() => findKaminoVault(vault) ?? KAMINO_VAULTS[0]!, [vault]);
  const [provider, setProvider] = useState<SolanaInjectedProvider | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [vaultAddress, setVaultAddress] = useState(initialVault.address);
  const [mode, setMode] = useState<LiveEarnMode>(initialMode);
  const [amount, setAmount] = useState(initialAmount?.replace(/,/g, "") ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [build, setBuild] = useState<KaminoBuildResponse | null>(null);
  const [transaction, setTransaction] = useState<VersionedTransaction | null>(null);
  const [review, setReview] = useState<KaminoTxReview | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<KaminoPositionView[]>([]);
  const [balance, setBalance] = useState<string | null>(null);

  const meta = findKaminoVault(vaultAddress) ?? KAMINO_VAULTS[0]!;
  const position = positions.find((row) => row.vaultAddress === vaultAddress) ?? null;

  const refreshPositions = useCallback(async (owner: string) => {
    try {
      const response = await fetch(`/api/earn/kamino/positions?wallet=${encodeURIComponent(owner)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { positions?: KaminoPositionView[] };
      setPositions(Array.isArray(body.positions) ? body.positions : []);
    } catch {
      // A failed read-back is not a failed action; the next refresh can retry.
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const injected = provider ?? getInjectedSolanaProvider();
    if (!injected) {
      setError("No Solana wallet found. Install Phantom or Solflare, then reload this page.");
      return;
    }
    try {
      const address = await connectSolanaWallet(injected);
      setProvider(injected);
      setWallet(address);
      void refreshPositions(address);
      void readAssetBalance(address, meta.assetMint, meta.assetDecimals).then(setBalance);
    } catch (cause) {
      setError(solanaWalletErrorMessage(cause));
    }
  }, [meta.assetDecimals, meta.assetMint, provider, refreshPositions]);

  const reset = useCallback(() => {
    setPhase("idle");
    setBuild(null);
    setTransaction(null);
    setReview(null);
    setSignature(null);
    setError(null);
  }, []);

  const buildTransaction = useCallback(async () => {
    if (!wallet) {
      setError("Connect a Solana wallet first.");
      return;
    }
    setError(null);
    setPhase("building");
    try {
      const response = await fetch("/api/earn/kamino/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, wallet, vault: vaultAddress, amount }),
      });
      const body = (await response.json()) as KaminoBuildResponse & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Kamino could not build that transaction.");
      }
      const decoded = decodeKaminoTransaction(body.transaction);
      setReview(summarizeKaminoTransaction(body.transaction));
      setTransaction(decoded);
      setBuild(body);
      setPhase("review");
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Kamino could not build that transaction.");
    }
  }, [amount, mode, vaultAddress, wallet]);

  const confirm = useCallback(async () => {
    if (!provider || !transaction) return;
    setError(null);
    setPhase("submitting");
    try {
      const submitted = await submitSolanaTransaction(provider, transaction);
      setSignature(submitted);
      setPhase("done");
      if (wallet) {
        await refreshPositions(wallet);
        void readAssetBalance(wallet, meta.assetMint, meta.assetDecimals).then(setBalance);
      }
    } catch (cause) {
      setPhase("review");
      setError(solanaWalletErrorMessage(cause));
    }
  }, [meta.assetDecimals, meta.assetMint, provider, refreshPositions, transaction, wallet]);

  const maxAmount = mode === "withdraw" ? (position?.shares ?? "") : (balance ?? "");
  const canReview = !!wallet && amount.trim() !== "" && phase !== "building" && phase !== "submitting";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card card-pad" data-testid="kamino-live-flow">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Kamino · {meta.name}</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
              Direct kVault {mode} on Solana · {meta.assetSymbol} · share mint {short(meta.sharesMint)}
            </div>
          </div>
          <span className="pill" style={{ alignSelf: "flex-start", fontSize: 11.5 }}>
            Live · flagged
          </span>
        </div>

        {!wallet ? (
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            <button type="button" className="btn btn-primary btn-md" onClick={() => void connect()}>
              <Icon name="wallet" size={16} /> Connect Solana wallet
            </button>
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
              Phantom, Solflare or any injected Solana wallet. Connecting reads your public address
              only; it does not sign anything.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
            <span style={{ color: MUTED }}>Connected</span>
            <span className="mono" style={{ wordBreak: "break-all" }}>{short(wallet, 8, 8)}</span>
          </div>
        )}

        {error && <Notice tone="caution">{error}</Notice>}

        {phase === "idle" || phase === "building" ? (
          <>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div className="field">
                <label htmlFor="kamino-vault">Vault</label>
                <select
                  id="kamino-vault"
                  className="input"
                  value={vaultAddress}
                  onChange={(event) => {
                    const next = event.target.value;
                    setVaultAddress(next);
                    reset();
                    const nextMeta = findKaminoVault(next);
                    if (wallet && nextMeta) {
                      void readAssetBalance(wallet, nextMeta.assetMint, nextMeta.assetDecimals).then(setBalance);
                    }
                  }}
                >
                  {KAMINO_VAULTS.map((vault) => (
                    <option key={vault.address} value={vault.address}>
                      {vault.name} · {vault.assetSymbol}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                {(["deposit", "withdraw"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`pill${mode === option ? "" : " ghosty"}`}
                    onClick={() => {
                      setMode(option);
                      reset();
                    }}
                    style={{ cursor: "pointer", textTransform: "capitalize" }}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <div className="field">
                <label htmlFor="kamino-amount">
                  {mode === "deposit" ? `Amount to deposit (${meta.assetSymbol})` : "Vault shares to withdraw"}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    id="kamino-amount"
                    className="input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    style={{ flex: 1 }}
                  />
                  {maxAmount && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(maxAmount)}>
                      Max
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
                  {mode === "deposit"
                    ? balance
                      ? `Wallet balance ≈ ${balance} ${meta.assetSymbol}`
                      : "Reading your wallet balance…"
                    : position
                      ? `Position ≈ ${position.shares} shares${position.estimatedTokens ? ` ≈ ${position.estimatedTokens} ${meta.assetSymbol}` : ""}`
                      : "No position read yet for this vault."}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!canReview}
              onClick={() => void buildTransaction()}
            >
              {phase === "building" ? "Building unsigned transaction…" : "Review transaction"}
            </button>
          </>
        ) : null}
      </div>

      {phase !== "idle" && phase !== "building" && review && build && (
        <div className="card card-pad" data-testid="kamino-live-review">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              Review {mode} · {build.amount} {mode === "deposit" ? meta.assetSymbol : "shares"}
            </div>
            <span style={{ fontSize: 11.5, color: MUTED }}>Unsigned · not sent</span>
          </div>

          <div style={{ display: "grid", gap: 5, marginTop: 12 }}>
            <Row k="Vault" v={`${meta.name} (${short(meta.address, 6, 6)})`} />
            <Row
              k={mode === "deposit" ? "You pay" : "You redeem"}
              v={`${build.amount} ${mode === "deposit" ? meta.assetSymbol : "shares"}`}
            />
            <Row
              k="You receive (estimate)"
              v={
                build.estimate
                  ? `≈ ${build.estimate} ${build.estimateUnit === "shares" ? "shares" : meta.assetSymbol}`
                  : "unavailable"
              }
            />
            <Row k="Vault APY (Kamino)" v={apyPercent(build.apy) ?? "unavailable"} />
            <Row
              k="Vault fees"
              v={`${(meta.managementFeeBps / 100).toFixed(2)}% mgmt · ${(meta.performanceFeeBps / 100).toFixed(2)}% perf`}
            />
            <Row k="SparkPoint fee" v="0% — none on a direct deposit" tone="gain" />
          </div>

          <div className="divider" style={{ margin: "12px 0" }} />

          <div style={{ display: "grid", gap: 5 }}>
            <Row k="Fee payer / owner" v={short(review.feePayer, 8, 8)} />
            <Row k="Share mint" v={short(meta.sharesMint, 8, 8)} />
            <Row k="kVault program" v={short(review.instructions.find((ix) => ix.programLabel === "Kamino kVault")?.programId ?? "—", 8, 8)} />
            <Row k="Signatures" v={String(review.signatures)} />
            <Row k="Network fee" v={`≈ ${formatLamports(review.networkFeeLamports)} SOL`} />
            {review.priorityFeeLamports > 0n && (
              <Row k="Priority fee" v={`${formatLamports(review.priorityFeeLamports)} SOL`} />
            )}
            <Row
              k="New token accounts"
              v={`${review.tokenAccountCreations} · ≈ ${formatLamports(review.tokenAccountRentLamports)} SOL rent`}
              tone="caution"
            />
            {review.transferredLamports > 0n && (
              <Row k="SOL wrapped in this tx" v={`${formatLamports(review.transferredLamports)} SOL`} />
            )}
          </div>

          <details style={{ marginTop: 12 }} open>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
              Instructions in this transaction ({review.instructions.length})
            </summary>
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
              {review.instructions.map((instruction, index) => (
                <li key={`${instruction.programId}-${index}`}>
                  <b>{instruction.programLabel}</b> · {instruction.instruction}
                  <span style={{ color: MUTED }}> ({instruction.accountCount} accounts)</span>
                </li>
              ))}
            </ol>
          </details>

          <Notice tone="caution">
            Associated-token-account rent ({formatLamports(review.tokenAccountRentLamports)} SOL) is
            locked while a new token account exists, not a Kamino or SparkPoint fee. The wSOL account
            is closed on withdraw; the share account stays until you close it.
          </Notice>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            This unsigned transaction carries a recent blockhash that expires in about a minute. If
            your wallet says it expired, go back and review again — the amount and fee may have moved.
          </div>

          {error && <Notice tone="caution">{error}</Notice>}

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-md" onClick={reset} disabled={phase === "submitting"}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-md"
              onClick={() => void confirm()}
              disabled={phase === "submitting" || phase === "done"}
            >
              {phase === "submitting" ? "Waiting for your wallet…" : phase === "done" ? "Confirmed" : "Confirm in wallet"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Your wallet shows its own confirmation and is the only signer. SparkPoint cannot sign,
            submit or move these funds. {meta.assetSymbol} stays in the Kamino vault under your wallet.
          </div>
        </div>
      )}

      {phase === "done" && signature && (
        <div className="card card-pad" data-testid="kamino-live-done">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Transaction submitted</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>
            Signature <span className="mono" style={{ wordBreak: "break-all" }}>{signature}</span>
          </div>
          <a
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm"
            style={{ marginTop: 10 }}
          >
            View on Solscan <Icon name="ext" size={11} />
          </a>
        </div>
      )}

      {wallet && (
        <div className="card card-pad" data-testid="kamino-live-position">
          <div style={{ fontSize: 14, fontWeight: 600 }}>Your Kamino position</div>
          {positions.length === 0 ? (
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>
              No curated Kamino position read for this wallet yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {positions.map((row) => (
                <div key={row.vaultAddress} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                  <span>{row.vaultName}</span>
                  <span className="tnum">
                    {row.shares} shares
                    {row.estimatedTokens ? ` ≈ ${row.estimatedTokens} ${row.assetSymbol ?? ""}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => void refreshPositions(wallet)}>
            Refresh position
          </button>
        </div>
      )}
    </div>
  );
}
