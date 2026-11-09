/**
 * 077 — Kamino unsigned deposit/withdraw transaction proxy.
 *
 * The browser asks this route for a transaction; this route asks Kamino's public transactions API
 * and returns its base64 **unsigned** versioned transaction. This route never holds a key, never
 * signs, and never broadcasts. It also refuses any vault outside the curated allowlist and checks
 * the returned transaction really is the requested Kamino action for the requested fee payer.
 */

import { NextResponse } from "next/server";

import { kaminoServerLiveEnabled } from "@/lib/earn/liveFlags";
import {
  KAMINO_API_URL,
  KaminoLiveError,
  deriveKaminoEstimate,
  kaminoApiRequest,
  summarizeKaminoTransaction,
  type KaminoBuildInput,
} from "@/lib/earn/kaminoLive";

export const dynamic = "force-dynamic";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function readInput(body: unknown): KaminoBuildInput {
  if (!body || typeof body !== "object") {
    throw new KaminoLiveError("invalid_amount", "Send a JSON body with mode, wallet, vault and amount.");
  }
  const value = body as Record<string, unknown>;
  const mode = value.mode;
  if (mode !== "deposit" && mode !== "withdraw") {
    throw new KaminoLiveError("invalid_mode", "Mode must be deposit or withdraw.");
  }
  return {
    mode,
    wallet: typeof value.wallet === "string" ? value.wallet : "",
    vault: typeof value.vault === "string" ? value.vault : "",
    amount: typeof value.amount === "string" ? value.amount : String(value.amount ?? ""),
  };
}

export async function POST(request: Request) {
  if (!kaminoServerLiveEnabled()) {
    return jsonError(404, "flag_off", "Live Kamino earn is disabled in this deployment.");
  }

  let input: KaminoBuildInput;
  let built: ReturnType<typeof kaminoApiRequest>;
  try {
    input = readInput(await request.json());
    built = kaminoApiRequest(input);
  } catch (error) {
    if (error instanceof KaminoLiveError) return jsonError(400, error.code, error.message);
    return jsonError(400, "invalid_body", "The request body could not be read.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(built.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "sparkpoint-web/1.0" },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "kamino_unreachable", "Kamino's transaction API could not be reached.");
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return jsonError(
      502,
      "kamino_error",
      `Kamino could not build that ${input.mode}${detail ? `: ${detail.slice(0, 160)}` : "."}`,
    );
  }

  const payload = (await upstream.json().catch(() => null)) as { transaction?: unknown } | null;
  const transaction = typeof payload?.transaction === "string" ? payload.transaction : null;
  if (!transaction) {
    return jsonError(502, "kamino_empty", "Kamino returned no unsigned transaction.");
  }

  let review;
  try {
    review = summarizeKaminoTransaction(transaction);
  } catch {
    return jsonError(502, "kamino_invalid_tx", "Kamino returned a transaction that could not be decoded.");
  }

  const expectedAction = input.mode === "deposit" ? review.hasKaminoDeposit : review.hasKaminoWithdraw;
  if (!expectedAction || review.feePayer.trim() !== input.wallet.trim()) {
    return jsonError(502, "kamino_unexpected_tx", "Kamino returned a transaction that did not match the request.");
  }

  const metrics = await fetch(`${KAMINO_API_URL}/kvaults/vaults/${built.vaultMeta.address}/metrics`, {
    headers: { "User-Agent": "sparkpoint-web/1.0" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);

  const tokensPerShare =
    metrics && typeof metrics.tokensPerShare === "string" ? metrics.tokensPerShare : null;
  const apy = metrics && typeof metrics.apy === "string" ? metrics.apy : null;
  const tokenPriceUsd = metrics && typeof metrics.tokenPrice === "string" ? metrics.tokenPrice : null;
  const estimate = deriveKaminoEstimate(
    built.amountRaw,
    input.mode,
    tokensPerShare,
    input.mode === "deposit" ? built.vaultMeta.sharesDecimals : built.vaultMeta.assetDecimals,
  );

  return NextResponse.json(
    {
      unsigned: true,
      transaction,
      mode: input.mode,
      wallet: input.wallet.trim(),
      vault: built.vaultMeta,
      amount: built.body.amount,
      amountRaw: built.amountRaw.toString(),
      tokensPerShare,
      apy,
      tokenPriceUsd,
      estimate: estimate.estimate,
      estimateUnit: estimate.estimateUnit,
      networkFeeLamports: review.networkFeeLamports.toString(),
      tokenAccountCreations: review.tokenAccountCreations,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
