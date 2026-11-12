/**
 * 077 — pure Kamino prepare handler.
 *
 * Kept out of the Next route so the flag gate, metadata limits, upstream shape validation and the
 * malicious-fixture tests all exercise the exact same code path. The handler only ever returns an
 * **unsigned** transaction string; it never signs, approves or broadcasts.
 */

import {
  KAMINO_API_URL,
  KaminoLiveError,
  U64_MAX,
  assertKaminoTransactionMatches,
  decodeKaminoTransaction,
  deriveKaminoEstimate,
  fetchKaminoPositionShares,
  fetchKaminoVaultLimits,
  kaminoApiRequest,
  kaminoErrorStatus,
  kaminoVaultLimitsView,
  summarizeKaminoTransaction,
  type KaminoBuildInput,
  type KaminoLookupAddresses,
  type KaminoVaultLimits,
} from "./kaminoLive.ts";

export interface HandlerResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface KaminoPrepareDependencies {
  readonly enabled: boolean;
  readonly fetchImpl: typeof fetch;
  readonly resolveLookupAddresses: (
    encodedTransaction: string,
  ) => Promise<KaminoLookupAddresses | null>;
}

function error(status: number, code: string, message: string): HandlerResult {
  return { status, body: { error: { code, message } } };
}

function errorFromKamino(cause: KaminoLiveError): HandlerResult {
  return error(kaminoErrorStatus(cause.code), cause.code, cause.message);
}

/** Parse the route JSON body without trusting any field. */
export function parseKaminoPrepareBody(body: unknown): KaminoBuildInput {
  if (!body || typeof body !== "object") {
    throw new KaminoLiveError(
      "invalid_amount",
      "Send a JSON body with mode, wallet, vault and amount.",
    );
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

async function readMetrics(
  vault: string,
  fetchImpl: typeof fetch,
): Promise<{ tokensPerShare: string | null; apy: string | null; tokenPrice: string | null }> {
  try {
    const response = await fetchImpl(`${KAMINO_API_URL}/kvaults/vaults/${vault}/metrics`, {
      headers: { "User-Agent": "sparkpoint-web/1.0" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return { tokensPerShare: null, apy: null, tokenPrice: null };
    const body = (await response.json()) as Record<string, unknown>;
    return {
      tokensPerShare: typeof body.tokensPerShare === "string" ? body.tokensPerShare : null,
      apy: typeof body.apy === "string" ? body.apy : null,
      tokenPrice: typeof body.tokenPrice === "string" ? body.tokenPrice : null,
    };
  } catch {
    return { tokensPerShare: null, apy: null, tokenPrice: null };
  }
}

/**
 * Flag gate → body validation → live vault limits → Kamino unsigned build → full shape validation
 * → response. Any mismatch is refused; no transaction is ever signed or sent.
 */
export async function prepareKaminoTransaction(
  rawBody: unknown,
  deps: KaminoPrepareDependencies,
): Promise<HandlerResult> {
  if (!deps.enabled) {
    return error(404, "flag_off", "Live Kamino earn is disabled in this deployment.");
  }

  let input: KaminoBuildInput;
  let limits: KaminoVaultLimits | null;
  let positionShares: bigint | null | undefined = undefined;
  try {
    input = parseKaminoPrepareBody(rawBody);
    const basic = kaminoApiRequest(input);
    limits = await fetchKaminoVaultLimits(basic.vaultMeta.address, deps.fetchImpl);
    if (!limits) {
      return error(
        502,
        "metadata_unavailable",
        "Kamino vault metadata is unavailable right now; refusing to build without limits.",
      );
    }
    if (input.mode === "withdraw") {
      positionShares = await fetchKaminoPositionShares(
        basic.vaultMeta.address,
        basic.body.wallet,
        deps.fetchImpl,
      );
      if (positionShares === null) {
        return error(
          502,
          "position_unavailable",
          "Your current Kamino share balance could not be read, so a withdraw-ALL transaction cannot be verified. Refusing to build.",
        );
      }
      if (positionShares <= 0n) {
        return error(400, "zero_shares", "You have no shares to withdraw from this vault.");
      }
    }
  } catch (cause) {
    if (cause instanceof KaminoLiveError) return errorFromKamino(cause);
    return error(400, "invalid_body", "The request body could not be read.");
  }

  let built: ReturnType<typeof kaminoApiRequest>;
  try {
    built = kaminoApiRequest(input, limits);
  } catch (cause) {
    if (cause instanceof KaminoLiveError) return errorFromKamino(cause);
    return error(400, "invalid_body", "The request could not be validated.");
  }

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(built.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "sparkpoint-web/1.0" },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    return error(502, "kamino_unreachable", "Kamino's transaction API could not be reached.");
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return error(
      502,
      "kamino_error",
      `Kamino could not build that ${input.mode}${detail ? `: ${detail.slice(0, 160)}` : "."}`,
    );
  }

  const payload = (await upstream.json().catch(() => null)) as { transaction?: unknown } | null;
  const transaction = typeof payload?.transaction === "string" ? payload.transaction : null;
  if (!transaction) {
    return error(502, "kamino_empty", "Kamino returned no unsigned transaction.");
  }

  let review: ReturnType<typeof summarizeKaminoTransaction>;
  try {
    const decoded = decodeKaminoTransaction(transaction);
    const lookupAddresses =
      decoded.message.addressTableLookups.length === 0
        ? { writable: [], readOnly: [] }
        : await deps.resolveLookupAddresses(transaction);
    const summary = summarizeKaminoTransaction(transaction, { lookupAddresses });
    assertKaminoTransactionMatches(summary, {
      feePayer: built.body.wallet,
      mode: input.mode,
      vault: built.vaultMeta,
      amountRaw: built.buildAmountRaw,
      tokenVault: limits.tokenVault,
      vaultFarm: limits.vaultFarm,
      positionSharesRaw: positionShares,
    });
    review = summary;
  } catch (cause) {
    if (cause instanceof KaminoLiveError) return errorFromKamino(cause);
    return error(502, "kamino_invalid_tx", "Kamino returned a transaction that could not be validated.");
  }

  const metrics = await readMetrics(built.vaultMeta.address, deps.fetchImpl);
  const estimate = deriveKaminoEstimate(
    built.buildAmountRaw,
    input.mode,
    metrics.tokensPerShare,
    input.mode === "deposit"
      ? built.vaultMeta.sharesDecimals
      : built.vaultMeta.assetDecimals,
  );

  return {
    status: 200,
    body: {
      unsigned: true,
      transaction,
      mode: input.mode,
      wallet: built.body.wallet,
      vault: built.vaultMeta,
      amount: built.amount,
      amountRaw: built.amountRaw.toString(),
      buildAmountRaw: built.buildAmountRaw.toString(),
      tokensPerShare: metrics.tokensPerShare,
      apy: metrics.apy,
      tokenPriceUsd: metrics.tokenPrice,
      estimate: estimate.estimate,
      estimateUnit: estimate.estimateUnit,
      networkFeeLamports: review.networkFeeLamports.toString(),
      tokenAccountCreations: review.tokenAccountCreations,
      vaultLimits: kaminoVaultLimitsView(limits, built.vaultMeta),
      withdrawsAllShares: review.kaminoAction?.amountRaw === U64_MAX,
    },
  };
}

