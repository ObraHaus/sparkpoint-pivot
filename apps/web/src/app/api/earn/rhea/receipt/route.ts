import { NextResponse } from "next/server";

import { isValidNearAccountId } from "@/lib/near/account";
import { classifyReceipt } from "@/lib/near/burrow";
import { serverLiveRheaEnabled } from "@/lib/near/liveEarn";
import { viewTransactionStatus } from "@/lib/near/rpc";

/**
 * 078 — READ-ONLY receipt poll for a transaction the user's own wallet already sent.
 *
 * This route never submits anything. It reports confirmed only when the RPC marks the execution
 * final AND successful; optimistic or unknown states stay pending so the UI never fakes success.
 */

export const runtime = "nodejs";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export async function GET(request: Request) {
  if (!serverLiveRheaEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const txHash = (url.searchParams.get("txHash") ?? "").trim();
  const accountId = (url.searchParams.get("accountId") ?? "").trim();
  if (!BASE58_RE.test(txHash)) {
    return NextResponse.json({ ok: false, error: "bad_tx_hash" }, { status: 400 });
  }
  if (!isValidNearAccountId(accountId)) {
    return NextResponse.json({ ok: false, error: "bad_account" }, { status: 400 });
  }

  try {
    const result = await viewTransactionStatus(txHash, accountId);
    const classification = classifyReceipt(result);
    return NextResponse.json({
      ok: true,
      txHash,
      accountId,
      status: classification.status,
      error: classification.error,
      finalExecutionStatus: result.final_execution_status ?? null,
      note: "Read-only receipt lookup. No transaction is submitted by this route.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A not-yet-known transaction is an honest pending state, not a fabricated success/failure.
    if (/unknown|not found|does not exist|UNKNOWN_TRANSACTION/i.test(message)) {
      return NextResponse.json({ ok: true, txHash, accountId, status: "pending", error: null, note: "Not yet visible." });
    }
    return NextResponse.json({ ok: false, error: "rpc_unavailable", message: "The receipt read didn't complete." }, { status: 503 });
  }
}
