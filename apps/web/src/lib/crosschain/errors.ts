/**
 * 068 — shared, user-facing error copy for the cross-chain flow.
 *
 * Both the chat card and the manual /swap page call the same 1Click endpoints, so they must say the
 * same thing when a quote or a wallet transfer fails. Kept here instead of duplicated per surface.
 */

/** Read the agent's §1.5 error envelope, falling back to a status-based sentence. */
export async function crossChainErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // fall through to the status-based message
  }
  return `The cross-chain service answered ${res.status}. Please try again.`;
}

/** Map a wallet rejection/insufficiency to plain language; never imply anything was sent. */
export function crossChainWalletErrorCopy(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/user rejected|denied|rejected request|cancel|closed/i.test(raw)) {
    return "You cancelled the wallet request. Nothing was sent.";
  }
  if (/insufficient/i.test(raw)) {
    return "Your wallet doesn't have enough of this token for that transfer.";
  }
  return raw || "The wallet couldn't send that transaction.";
}
