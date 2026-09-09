/**
 * lastConversation — surviving a page refresh.
 *
 * WHY THIS EXISTS (029/FR-013). Refreshing /chat dropped the user into an empty new chat. The
 * conversation they had been in was not lost — it was in the sidebar — but nothing said so, and
 * the reasonable reading of a blank screen is "it forgot". During the Aug-3 battery this was the
 * single most disorienting moment: an assistant that had just demonstrated cross-session memory
 * appeared to lose the entire session to a reload.
 *
 * Which conversation to restore is decided here as a pure function, so the rule is testable and
 * the component stays a component. The rule: prefer the conversation the browser was last IN;
 * fall back to the most recent one; restore nothing if there is nothing to restore.
 *
 * Leaf module: no imports, no React.
 */

const STORAGE_KEY = "sp:chat:lastConversation";

/** The shape the conversations list gives us (newest first). */
export interface ConversationRef {
  readonly id: string;
}

/**
 * The conversation to reopen on mount, or `null` to start blank.
 *
 * `remembered` wins when it is still in the list — that is literally where the user was. It is
 * checked against the list rather than trusted, so a conversation deleted on another device (or
 * belonging to a previously connected wallet) can never resurrect as a broken read.
 */
export function pickRestoreTarget(
  history: readonly ConversationRef[],
  remembered: string | null | undefined,
): string | null {
  if (history.length === 0) return null;
  if (remembered && history.some((c) => c.id === remembered)) return remembered;
  return history[0]?.id ?? null;
}

/** Remember the conversation currently on screen. Never throws — storage can be unavailable. */
export function rememberConversation(id: string | null | undefined): void {
  try {
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / storage disabled — restoring is a nicety, never a requirement */
  }
}

/** The remembered conversation id, or `null` when there is none (or storage is unavailable). */
export function readRememberedConversation(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
