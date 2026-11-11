"use client";

/**
 * 077 — Kamino (Solana) live deposit/withdraw flow.
 *
 * Amount → build (our BFF asks Kamino for an UNSIGNED transaction) → review every amount/account/
 * fee → the user explicitly confirms in their own Solana wallet → confirm the on-chain signature.
 *
 * The wallet is the only signer. SparkPoint never holds a key and never submits anything itself;
 * `submitSolanaTransaction` is called only from the confirm button below. The returned transaction
 * is re-validated here (not just trusted from the server) before the wallet is asked to sign.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, type VersionedTransaction } from "@solana/web3.js";

import { Icon } from "@/lib/icons";
import {
  KAMINO_VAULTS,
  apyPercent,
  assertKaminoTransactionMatches,
  checkSolDepositCapacity,
  conservativeSolDepositReserveLamports,
  decodeKaminoTransaction,
  findKaminoVault,
  formatLamports,
  formatTokenAmount,
  kaminoAssetMintLabel,
  maxSolDepositLamports,
  parseTokenAmount,
  resolveKaminoLookupAddresses,
  signatureOutcome,
  solDepositReserveLamports,
  summarizeKaminoTransaction,
  type KaminoBuildResponse,
  type KaminoLookupAddresses,
  type KaminoPositionView,
  type KaminoTxReview,
} from "@/lib/earn/kaminoLive";
import type { LiveEarnMode } from "@/lib/earn/liveFlags";
import {
  BALANCE_READ_TIMEOUT_MS,
  SIGNATURE_STATUS_TIMEOUT_MS,
  solanaProxyRpcUrl,
  withTimeout,
} from "@/lib/solana/clientRpc";
import {
  connectSolanaWallet,
  getInjectedSolanaProvider,
  solanaWalletErrorMessage,
  submitSolanaTransaction,
  type SolanaInjectedProvider,
} from "@/lib/solana/wallet";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const MUTED = "var(--muted-foreground)";

type Phase =
  | "idle"
  | "building"
  | "review"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "failed";

type SignatureOutcome = "confirmed" | "failed" | "pending";
type BalanceStatus = "idle" | "reading" | "ready" | "error";

function short(value: string, head = 6, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** The wallet's current public address; re-read before signing to catch an account switch. */
function providerAddress(provider: SolanaInjectedProvider): string | null {
  try {
    return provider.publicKey?.toBase58?.().trim() || null;
  } catch {
    return null;
  }
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

async function readAssetBalance(
  owner: string,
  assetMint: string,
  decimals: number,
): Promise<{ text: string; raw: bigint } | null> {
  try {
    const connection = new Connection(solanaProxyRpcUrl(), "confirmed");
    if (assetMint === SOL_MINT) {
      const lamports = await withTimeout(
        connection.getBalance(new PublicKey(owner)),
        BALANCE_READ_TIMEOUT_MS,
        "Reading your wallet balance timed out.",
      );
      return { text: formatTokenAmount(BigInt(lamports), 9), raw: BigInt(lamports) };
    }
    const accounts = await withTimeout(
      connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
        mint: new PublicKey(assetMint),
      }),
      BALANCE_READ_TIMEOUT_MS,
      "Reading your wallet balance timed out.",
    );
    let total = 0n;
    for (const account of accounts.value) {
      const amount = (account.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })
        .parsed?.info?.tokenAmount?.amount;
      if (typeof amount === "string") total += BigInt(amount);
    }
    return { text: formatTokenAmount(total, decimals), raw: total };
  } catch {
    return null;
  }
}

/**
 * Wait for the wallet's signature to reach a terminal state. Returns `pending` (never a fake
 * success) when the RPC cannot tell us within the window.
 */
async function waitForSignature(signature: string): Promise<SignatureOutcome> {
  const connection = new Connection(solanaProxyRpcUrl(), "confirmed");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const status = await withTimeout(
        connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        }),
        SIGNATURE_STATUS_TIMEOUT_MS,
        "Checking the transaction signature timed out.",
      );
      const outcome = signatureOutcome(status.value);
      if (outcome !== "pending") return outcome;
    } catch {
      // Keep polling; a transient RPC error is not a confirmed success.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return "pending";
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
  const [expectedAmountRaw, setExpectedAmountRaw] = useState<bigint | null>(null);
  const [review, setReview] = useState<KaminoTxReview | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureOutcomeState, setSignatureOutcomeState] = useState<SignatureOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<KaminoPositionView[]>([]);
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("idle");
  const balanceRequestRef = useRef(0);

  const meta = findKaminoVault(vaultAddress) ?? KAMINO_VAULTS[0]!;
  const position = positions.find((row) => row.vaultAddress === vaultAddress) ?? null;
  const isSolDeposit = mode === "deposit" && meta.assetMint === SOL_MINT;
  const positionShares = position ? BigInt(position.sharesRaw) : 0n;

  const readPositions = useCallback(async (owner: string): Promise<KaminoPositionView[] | null> => {
    try {
      const response = await fetch(`/api/earn/kamino/positions?wallet=${encodeURIComponent(owner)}`, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { positions?: KaminoPositionView[] };
      return Array.isArray(body.positions) ? body.positions : [];
    } catch {
      // A failed read-back is not a failed action; callers decide whether to proceed.
      return null;
    }
  }, []);

  const refreshPositions = useCallback(
    async (owner: string) => {
      const rows = await readPositions(owner);
      if (rows !== null) setPositions(rows);
    },
    [readPositions],
  );

  const loadBalance = useCallback(
    async (owner: string, assetMint: string, decimals: number) => {
      const requestId = balanceRequestRef.current + 1;
      balanceRequestRef.current = requestId;
      setBalanceStatus("reading");
      const value = await readAssetBalance(owner, assetMint, decimals);
      if (balanceRequestRef.current !== requestId) return;
      setBalanceRaw(value?.raw ?? null);
      setBalanceStatus(value ? "ready" : "error");
    },
    [],
  );

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
      void loadBalance(address, meta.assetMint, meta.assetDecimals);
    } catch (cause) {
      setError(solanaWalletErrorMessage(cause));
    }
  }, [loadBalance, meta.assetDecimals, meta.assetMint, provider, refreshPositions]);

  const reset = useCallback(() => {
    setPhase("idle");
    setBuild(null);
    setTransaction(null);
    setExpectedAmountRaw(null);
    setReview(null);
    setSignature(null);
    setSignatureOutcomeState(null);
    setError(null);
  }, []);

  const buildTransaction = useCallback(async () => {
    if (!wallet) {
      setError("Connect a Solana wallet first.");
      return;
    }
    if (mode === "withdraw" && positionShares <= 0n) {
      setError("You have no shares to withdraw from this vault.");
      return;
    }
    const decimals = mode === "deposit" ? meta.assetDecimals : meta.sharesDecimals;
    const requestedAmountRaw = parseTokenAmount(amount, decimals);
    if (requestedAmountRaw === null) {
      setError(`Enter a valid ${mode === "deposit" ? meta.assetSymbol : "share"} amount.`);
      return;
    }
    if (mode === "withdraw" && requestedAmountRaw !== positionShares) {
      setError(
        "Kamino's public API only builds a withdraw-ALL-shares transaction. " +
          `Enter your full share balance (${formatTokenAmount(positionShares, meta.sharesDecimals)} shares) or press Max; partial withdraws are refused.`,
      );
      return;
    }
    if (isSolDeposit) {
      if (balanceStatus === "reading" || balanceStatus === "idle") {
        setError("Still reading your SOL balance — try again in a moment.");
        return;
      }
      if (balanceRaw === null || balanceStatus === "error") {
        setError("Could not read your SOL balance; refusing to build a deposit blind.");
        return;
      }
      const reserve = conservativeSolDepositReserveLamports();
      const capacity = checkSolDepositCapacity({
        balanceLamports: balanceRaw,
        amountLamports: requestedAmountRaw,
        reserveLamports: reserve,
      });
      if (!capacity.ok) {
        setError(
          `Insufficient SOL: this deposit needs ${formatLamports(capacity.requiredLamports)} SOL ` +
            `(amount + fees + rent + safety buffer) and you are short ${formatLamports(capacity.shortfallLamports)} SOL.`,
        );
        return;
      }
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
      if (
        body.vault?.address !== meta.address ||
        body.wallet !== wallet ||
        body.mode !== mode ||
        body.amountRaw !== requestedAmountRaw.toString()
      ) {
        throw new Error("Kamino returned a transaction for a different vault, wallet, mode or amount.");
      }

      const decoded = decodeKaminoTransaction(body.transaction);

      let resolved: KaminoLookupAddresses | null = null;
      if (decoded.message.addressTableLookups.length > 0) {
        resolved = await resolveKaminoLookupAddresses(
          new Connection(solanaProxyRpcUrl(), "confirmed"),
          decoded,
        );
        if (!resolved) throw new Error("Could not resolve the transaction's address lookup tables.");
      }

      const summary = summarizeKaminoTransaction(body.transaction, { lookupAddresses: resolved });
      assertKaminoTransactionMatches(summary, {
        feePayer: wallet,
        mode,
        vault: meta,
        amountRaw: requestedAmountRaw,
        tokenVault: body.vaultLimits?.tokenVault ?? "",
        vaultFarm: body.vaultLimits?.vaultFarm ?? null,
        positionSharesRaw: mode === "withdraw" ? positionShares : undefined,
      });

      if (isSolDeposit && balanceRaw !== null) {
        const actualReserve = solDepositReserveLamports({
          networkFeeLamports: summary.networkFeeLamports,
          tokenAccountRentLamports: summary.tokenAccountRentLamports,
        });
        const capacity = checkSolDepositCapacity({
          balanceLamports: balanceRaw,
          amountLamports: requestedAmountRaw,
          reserveLamports: actualReserve,
        });
        if (!capacity.ok) {
          throw new Error(
            `Insufficient SOL after review: need ${formatLamports(capacity.requiredLamports)} SOL, ` +
              `short ${formatLamports(capacity.shortfallLamports)} SOL.`,
          );
        }
      }

      setExpectedAmountRaw(requestedAmountRaw);
      setReview(summary);
      setTransaction(decoded);
      setBuild(body);
      setPhase("review");
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Kamino could not build that transaction.");
    }
  }, [
    amount,
    balanceRaw,
    balanceStatus,
    isSolDeposit,
    meta,
    mode,
    positionShares,
    vaultAddress,
    wallet,
  ]);

  const confirm = useCallback(async () => {
    if (phase !== "review") return;
    if (!provider || !transaction || !review || !build || expectedAmountRaw === null) return;
    setError(null);
    // The wallet provider can switch accounts between prepare and confirm. Refuse a stale review
    // instead of handing the old transaction to a different signer.
    const currentWallet = providerAddress(provider);
    if (!currentWallet || currentWallet !== wallet) {
      reset();
      setError(
        "Your Solana wallet account changed after review. Nothing was signed — reconnect and review again.",
      );
      return;
    }
    // Kamino's API always builds a withdraw-ALL transaction. Re-read the balance so a stale review
    // can never sign an all-shares withdrawal that no longer matches what the user reviewed.
    if (mode === "withdraw") {
      const fresh = await readPositions(wallet);
      if (fresh === null) {
        setError(
          "Your current share balance could not be re-read, so the withdraw-ALL transaction cannot be verified. Nothing was signed.",
        );
        return;
      }
      const freshShares = fresh.find((row) => row.vaultAddress === vaultAddress)?.sharesRaw ?? "0";
      if (BigInt(freshShares) !== positionShares || positionShares <= 0n) {
        reset();
        setError(
          "Your share balance changed since review. Nothing was signed — review the full-share withdraw again.",
        );
        return;
      }
    }
    try {
      assertKaminoTransactionMatches(review, {
        feePayer: wallet ?? "",
        mode,
        vault: meta,
        amountRaw: expectedAmountRaw,
        tokenVault: build.vaultLimits?.tokenVault ?? "",
        vaultFarm: build.vaultLimits?.vaultFarm ?? null,
        positionSharesRaw: mode === "withdraw" ? positionShares : undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transaction changed; refusing to sign.");
      return;
    }

    setPhase("submitting");
    try {
      const submitted = await submitSolanaTransaction(provider, transaction);
      setSignature(submitted);
      setPhase("confirming");
      const outcome = await waitForSignature(submitted);
      setSignatureOutcomeState(outcome);
      setPhase(outcome === "failed" ? "failed" : "confirmed");
      if (wallet) {
        await refreshPositions(wallet);
        void loadBalance(wallet, meta.assetMint, meta.assetDecimals);
      }
    } catch (cause) {
      setPhase("review");
      setError(solanaWalletErrorMessage(cause));
    }
  }, [
    build,
    expectedAmountRaw,
    loadBalance,
    meta,
    mode,
    phase,
    positionShares,
    provider,
    readPositions,
    refreshPositions,
    reset,
    review,
    transaction,
    vaultAddress,
    wallet,
  ]);

  const depositReserve = conservativeSolDepositReserveLamports();
  const maxDepositRaw =
    balanceRaw === null
      ? null
      : isSolDeposit
        ? maxSolDepositLamports(balanceRaw, depositReserve)
        : balanceRaw;
  const maxAmount =
    mode === "withdraw"
      ? positionShares > 0n
        ? formatTokenAmount(positionShares, meta.sharesDecimals)
        : null
      : maxDepositRaw !== null && maxDepositRaw > 0n
        ? formatTokenAmount(maxDepositRaw, meta.assetDecimals)
        : null;
  const withdrawBlocked = mode === "withdraw" && positionShares <= 0n;
  const typedAmountRaw = parseTokenAmount(
    amount,
    mode === "deposit" ? meta.assetDecimals : meta.sharesDecimals,
  );
  const withdrawPartial =
    mode === "withdraw" &&
    typedAmountRaw !== null &&
    positionShares > 0n &&
    typedAmountRaw !== positionShares;
  const canReview =
    !!wallet &&
    amount.trim() !== "" &&
    !withdrawBlocked &&
    !withdrawPartial &&
    phase !== "building" &&
    phase !== "submitting" &&
    phase !== "confirming";
  const balanceText =
    balanceRaw === null ? null : formatTokenAmount(balanceRaw, meta.assetDecimals);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card card-pad" data-testid="kamino-live-flow">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Kamino · {meta.name}</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
              Direct kVault {mode} on Solana · asset {kaminoAssetMintLabel(meta)} · share mint{" "}
              {short(meta.sharesMint)}
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
                      void loadBalance(wallet, nextMeta.assetMint, nextMeta.assetDecimals);
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
                  {mode === "deposit" ? (
                    balanceStatus === "error" ? (
                      <span style={{ color: "var(--caution)" }}>
                        Could not read your wallet balance.{" "}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: "0 6px", height: "auto", fontSize: 11.5 }}
                          onClick={() => {
                            if (wallet) {
                              void loadBalance(wallet, meta.assetMint, meta.assetDecimals);
                            }
                          }}
                        >
                          Retry
                        </button>
                      </span>
                    ) : balanceStatus === "ready" && balanceText ? (
                      `Wallet balance ≈ ${balanceText} ${meta.assetSymbol}`
                    ) : (
                      "Reading your wallet balance…"
                    )
                  ) : position ? (
                    `Position ≈ ${position.shares} shares${position.estimatedTokens ? ` ≈ ${position.estimatedTokens} ${meta.assetSymbol}` : ""}`
                  ) : (
                    "No position read yet for this vault."
                  )}
                </div>
                {isSolDeposit && (
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
                    Max reserves ≈ {formatLamports(depositReserve)} SOL for network/priority fees,
                    token-account rent and a 0.005 SOL safety buffer.
                  </div>
                )}
                {withdrawBlocked && (
                  <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 4 }}>
                    No shares to withdraw in this vault — withdraw is disabled.
                  </div>
                )}
                {mode === "withdraw" && !withdrawBlocked && (
                  <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 4, lineHeight: 1.5 }}>
                    Kamino&apos;s public API only builds a <b>withdraw-ALL-shares</b> transaction. Enter
                    your full share balance ({formatTokenAmount(positionShares, meta.sharesDecimals)}{" "}
                    shares) or press Max; partial withdraws are refused.
                  </div>
                )}
                {withdrawPartial && (
                  <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 4 }}>
                    That is a partial amount. Use Max (or type your full share balance) to review.
                  </div>
                )}
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
            <Row k="Asset" v={kaminoAssetMintLabel(meta)} />
            <Row k="Share mint" v={short(meta.sharesMint, 8, 8)} />
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
              Asset symbol, mint and token program come from Kamino&apos;s vault metadata. SparkPoint
              does not claim an issuer or &quot;native&quot; status — verify the mint in your wallet
              before signing.
            </div>
            <Row k="Min deposit (vault)" v={`${build.vaultLimits.minDepositAmount} ${meta.assetSymbol}`} />
            <Row k="Min withdraw (vault)" v={`${build.vaultLimits.minWithdrawAmount} shares`} />
            {build.vaultLimits.depositCap && (
              <Row k="Vault deposit cap" v={`${build.vaultLimits.depositCap} ${meta.assetSymbol}`} />
            )}
            {build.vaultLimits.remainingDeposit && (
              <Row k="Vault cap remaining" v={`${build.vaultLimits.remainingDeposit} ${meta.assetSymbol}`} />
            )}
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

          {build.withdrawsAllShares && (
            <Notice tone="caution">
              Kamino&apos;s public API always builds a <b>withdraw-ALL-shares</b> transaction. This
              one only proceeds because the amount you entered equals your current full share
              balance; partial withdraws are refused. If your balance changed, go back and review
              again — nothing has been signed yet.
            </Notice>
          )}

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
            <button
              type="button"
              className="btn btn-ghost btn-md"
              onClick={reset}
              disabled={phase === "submitting" || phase === "confirming"}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-md"
              onClick={() => void confirm()}
              disabled={phase !== "review"}
            >
              {phase === "submitting"
                ? "Waiting for your wallet…"
                : phase === "confirming"
                  ? "Confirming on-chain…"
                  : phase === "confirmed"
                    ? "Confirmed"
                    : phase === "failed"
                      ? "Failed"
                      : "Confirm in wallet"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Your wallet shows its own confirmation and is the only signer. SparkPoint cannot sign,
            submit or move these funds. {meta.assetSymbol} stays in the Kamino vault under your wallet.
          </div>
        </div>
      )}

      {signature && (phase === "confirming" || phase === "confirmed" || phase === "failed") && (
        <div className="card card-pad" data-testid="kamino-live-done">
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {phase === "confirming"
              ? "Submitted · waiting for confirmation"
              : phase === "failed"
                ? "Transaction failed on-chain"
                : signatureOutcomeState === "confirmed"
                  ? "Transaction confirmed"
                  : "Submitted · confirmation pending"}
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>
            Signature <span className="mono" style={{ wordBreak: "break-all" }}>{signature}</span>
          </div>
          {phase === "failed" && (
            <Notice tone="caution">
              The network reported this transaction as failed. Nothing was credited to your
              position. Check the explorer for the exact error.
            </Notice>
          )}
          {phase === "confirmed" && signatureOutcomeState === "pending" && (
            <Notice tone="caution">
              The wallet submitted the transaction, but the RPC has not confirmed it yet. Refresh
              the position to check again — this is not a success claim.
            </Notice>
          )}
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
