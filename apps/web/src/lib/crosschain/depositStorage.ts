/**
 * 068 — resume an in-progress deposit after a refresh.
 *
 * A live quote's deposit address is the only thing that matters to the status poll, and it is not
 * in the persisted chat block. We keep it in `sessionStorage`, keyed by conversation + block
 * identity, so reopening the same thread (or refreshing) still shows the deposit/status view. It is
 * scoped to this tab/session and contains no secret: a smart-contract deposit address is public.
 */

export interface DepositSnapshot {
  depositAddress: string;
  deadline?: string;
  recipient: string;
  refundTo: string;
  status?: string;
  quoteId?: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface BlockIdentity {
  origin: { key: string; amount: string };
  destination: { key: string };
  quotedAt?: string;
}

/** A stable key: same conversation + same quoted block ⇒ same saved deposit. */
export function depositStorageKey(
  conversationId: string | undefined,
  block: BlockIdentity,
): string {
  const conversation = conversationId && conversationId.trim() ? conversationId.trim() : "anon";
  const quote = `${block.origin.key}>${block.destination.key}:${block.origin.amount}:${block.quotedAt ?? ""}`;
  return `sparkpoint.crosschain.deposit:${conversation}:${quote}`;
}

function isDepositSnapshot(value: unknown): value is DepositSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.depositAddress === "string" &&
    v.depositAddress.length > 0 &&
    typeof v.recipient === "string" &&
    typeof v.refundTo === "string"
  );
}

export function readDepositSnapshot(
  store: KeyValueStore,
  key: string,
): DepositSnapshot | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDepositSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDepositSnapshot(
  store: KeyValueStore,
  key: string,
  snapshot: DepositSnapshot,
): void {
  try {
    store.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable (private mode/quota). The card still works without resume.
  }
}

export function clearDepositSnapshot(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}
