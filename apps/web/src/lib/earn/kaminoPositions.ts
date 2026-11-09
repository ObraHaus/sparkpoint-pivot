/**
 * 077 — pure read-only Kamino positions handler (flag-gated, curated-vault filtered).
 *
 * Reads the public user-positions endpoint, attaches `tokensPerShare`, and returns an estimated
 * underlying amount. It never signs or moves anything.
 */

import { isValidAddress } from "../crosschain/address.ts";
import {
  KAMINO_API_URL,
  applyDecimalRate,
  findKaminoVault,
  formatTokenAmount,
  parseKaminoPositions,
} from "./kaminoLive.ts";

export interface PositionsHandlerResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface KaminoPositionsDependencies {
  readonly enabled: boolean;
  readonly fetchImpl: typeof fetch;
}

function error(status: number, code: string, message: string): PositionsHandlerResult {
  return { status, body: { error: { code, message } } };
}

async function readTokensPerShare(
  vault: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${KAMINO_API_URL}/kvaults/vaults/${vault}/metrics`, {
      headers: { "User-Agent": "sparkpoint-web/1.0" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body.tokensPerShare === "string" ? body.tokensPerShare : null;
  } catch {
    return null;
  }
}

export async function readKaminoPositions(
  rawWallet: string | null | undefined,
  deps: KaminoPositionsDependencies,
): Promise<PositionsHandlerResult> {
  if (!deps.enabled) {
    return error(404, "flag_off", "Live Kamino earn is disabled in this deployment.");
  }
  const wallet = rawWallet?.trim() ?? "";
  if (!isValidAddress(wallet, "sol")) {
    return error(400, "invalid_wallet", "A base58 Solana wallet address is required.");
  }

  let raw: unknown;
  try {
    const response = await deps.fetchImpl(
      `${KAMINO_API_URL}/kvaults/users/${encodeURIComponent(wallet)}/positions`,
      {
        headers: { "User-Agent": "sparkpoint-web/1.0" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    if (response.status === 404) return { status: 200, body: { wallet, positions: [] } };
    if (!response.ok) {
      return error(502, "kamino_positions_error", "Kamino could not read that wallet's positions.");
    }
    raw = await response.json();
  } catch {
    return error(502, "kamino_unreachable", "Kamino's positions API could not be reached.");
  }

  const rows = parseKaminoPositions(raw);
  const positions = await Promise.all(
    rows.map(async (row) => {
      const meta = findKaminoVault(row.vaultAddress);
      const tokensPerShare = await readTokensPerShare(row.vaultAddress, deps.fetchImpl);
      const estimate =
        tokensPerShare && meta ? applyDecimalRate(row.sharesRaw, tokensPerShare) : null;
      return {
        vaultAddress: row.vaultAddress,
        vaultName: row.vaultName,
        shares: row.shares,
        sharesRaw: row.sharesRaw.toString(),
        tokensPerShare,
        estimatedTokens:
          estimate === null || !meta ? null : formatTokenAmount(estimate, meta.assetDecimals),
        assetSymbol: meta?.assetSymbol ?? null,
      };
    }),
  );

  return { status: 200, body: { wallet, positions } };
}
