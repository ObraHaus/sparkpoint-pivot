/**
 * 068 — the 1Click status → UI state mapping, plus the polling cadence.
 *
 * Kept pure so the honest terminal/attention states and the backoff are unit-tested instead of
 * living only inside a React effect. Polling STOPS on SUCCESS / REFUNDED / FAILED, and backs off
 * after ten minutes so a slow route does not hammer the agent (or 1Click) forever.
 */

export const CROSSCHAIN_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
] as const;

export type CrossChainStatus = (typeof CROSSCHAIN_STATUSES)[number];
export type CrossChainStatusTone = "progress" | "success" | "attention";

export interface CrossChainStatusView {
  status: CrossChainStatus | "UNKNOWN";
  label: string;
  description: string;
  /** Index into the four-step stepper, or null for an attention-only state. */
  step: number | null;
  tone: CrossChainStatusTone;
  terminal: boolean;
}

const VIEWS: Record<CrossChainStatus, Omit<CrossChainStatusView, "status">> = {
  PENDING_DEPOSIT: {
    label: "Waiting for your deposit",
    description:
      "Send the exact amount to the one-time deposit address from your own wallet. It is detected automatically.",
    step: 0,
    tone: "progress",
    terminal: false,
  },
  KNOWN_DEPOSIT_TX: {
    label: "Deposit seen",
    description: "Your transaction is detected. The swap is getting ready.",
    step: 1,
    tone: "progress",
    terminal: false,
  },
  PROCESSING: {
    label: "Swapping",
    description: "1Click is converting your funds and delivering them to your destination address.",
    step: 2,
    tone: "progress",
    terminal: false,
  },
  SUCCESS: {
    label: "Complete",
    description: "Your funds arrived at the destination address.",
    step: 3,
    tone: "success",
    terminal: true,
  },
  INCOMPLETE_DEPOSIT: {
    label: "Deposit incomplete",
    description:
      "The amount received was below the quoted amount. Your funds are not lost — check the deposit address and top up, or contact support with it.",
    step: null,
    tone: "attention",
    terminal: false,
  },
  REFUNDED: {
    label: "Refunded",
    description:
      "The swap could not complete. Your funds are being returned to the refund address. SparkPoint never held them.",
    step: null,
    tone: "attention",
    terminal: true,
  },
  FAILED: {
    label: "Swap failed",
    description:
      "The swap did not complete. Check the refund address and the deposit address; SparkPoint never holds your funds.",
    step: null,
    tone: "attention",
    terminal: true,
  },
  EXPIRED: {
    label: "Quote expired",
    description:
      "The deposit window closed before funds arrived, so nothing was swapped. Create a new quote when you are ready — SparkPoint never held your funds.",
    step: null,
    tone: "attention",
    terminal: true,
  },
};

/** Normalise a wire status (case-insensitive), or null when it is not one we know. */
export function normalizeStatus(raw: string | undefined | null): CrossChainStatus | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return (CROSSCHAIN_STATUSES as readonly string[]).includes(upper)
    ? (upper as CrossChainStatus)
    : null;
}

export function statusView(raw: string | undefined | null): CrossChainStatusView {
  const status = normalizeStatus(raw);
  if (status === null) {
    return {
      status: "UNKNOWN",
      label: "Checking status",
      description: "SparkPoint is waiting for an update from the cross-chain service.",
      step: null,
      tone: "progress",
      terminal: false,
    };
  }
  return { status, ...VIEWS[status] };
}

export function isTerminalStatus(raw: string | undefined | null): boolean {
  const status = normalizeStatus(raw);
  return status !== null && VIEWS[status].terminal;
}

/** Five seconds, backing off to 15s then 30s after ten/twenty minutes of waiting. */
export function pollDelayMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 5_000;
  if (elapsedMs >= 20 * 60_000) return 30_000;
  if (elapsedMs >= 10 * 60_000) return 15_000;
  return 5_000;
}

/** Poll while there is a deposit address and the status is not terminal. */
export function shouldPoll(status: string | undefined | null): boolean {
  return !isTerminalStatus(status);
}
