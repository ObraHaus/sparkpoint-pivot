/**
 * notificationsView — the pure, dependency-free mapper for the §3.11 in-app notifications feed
 * (`GET /notifications`, feature 021). Wire → display view, with NO fabrication: every row is a real
 * notification the agent DERIVED from indexed on-chain/DB activity (a deposit/withdraw, a realized
 * outcome, a reverted tx). This layer only formats — it never invents a notification.
 *
 * No `@/` runtime imports (type-only) so it stays unit-testable in isolation. `filterByPrefs` applies
 * the user's on-device category toggles (the `NotifKey`s the settings page owns) so those preferences
 * finally DO something; it takes a plain `Record<string, boolean>` to avoid coupling to the settings module.
 */

/** One notification off the wire (all fields optional — defensive parsing). */
export interface NotificationDto {
  id?: string;
  category?: string; // a NotifKey: txResults | outcomeUpdates …
  type?: string; // deposit_confirmed | withdrawal_confirmed | tx_reverted | outcome_closed
  title?: string;
  body?: string;
  icon?: string;
  tsApprox?: string; // ISO
  txHash?: string | null;
  href?: string | null;
  unread?: boolean;
}

/** `GET /notifications` body off the wire (all optional). */
export interface NotificationsResponseDto {
  asOf?: string;
  asOfBlock?: number;
  stale?: boolean;
  unreadCount?: number;
  notifications?: NotificationDto[];
}

/** One display row — every value real; `timeText` is a relative label off the approximate timestamp. */
export interface NotificationView {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string;
  icon: string;
  timeText: string; // "just now" | "2m ago" | "3h ago" | "yesterday" | "5d ago" | "Jul 24"
  txHash: string | null;
  href: string | null;
  unread: boolean;
}

/** The whole feed view. */
export interface NotificationsView {
  items: NotificationView[];
  unreadCount: number;
  stale: boolean;
}

const _MIN = 60_000;
const _HOUR = 60 * _MIN;
const _DAY = 24 * _HOUR;

/** A short relative-time label from an ISO timestamp (approximate for on-chain events). Pure. */
export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < _MIN) return "just now";
  if (diff < _HOUR) return `${Math.floor(diff / _MIN)}m ago`;
  if (diff < _DAY) return `${Math.floor(diff / _HOUR)}h ago`;
  if (diff < 2 * _DAY) return "yesterday";
  if (diff < 7 * _DAY) return `${Math.floor(diff / _DAY)}d ago`;
  // Older than a week → a plain date (locale-independent, no fabricated precision).
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function _str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Map the `GET /notifications` wire body to the display view. `now` (ms) is injected for testability. */
export function toNotificationsView(
  dto: NotificationsResponseDto | undefined | null,
  now: number,
): NotificationsView {
  const rows = Array.isArray(dto?.notifications) ? dto!.notifications : [];
  const items: NotificationView[] = rows.map((n) => ({
    id: _str(n.id),
    category: _str(n.category),
    type: _str(n.type),
    title: _str(n.title, "Notification"),
    body: _str(n.body),
    icon: _str(n.icon, "bell"),
    timeText: relativeTime(n.tsApprox, now),
    txHash: typeof n.txHash === "string" ? n.txHash : null,
    href: typeof n.href === "string" ? n.href : null,
    unread: n.unread === true,
  }));
  const unreadCount =
    typeof dto?.unreadCount === "number" ? dto.unreadCount : items.filter((i) => i.unread).length;
  return { items, unreadCount, stale: dto?.stale === true };
}

/** Keep only rows whose category the user hasn't switched OFF (unknown/true categories are shown). */
export function filterByPrefs(
  items: NotificationView[],
  prefs: Record<string, boolean>,
): NotificationView[] {
  return items.filter((i) => prefs[i.category] !== false);
}

/** The unread count of a (possibly pref-filtered) row set — so the badge matches what's shown. */
export function unreadCountOf(items: NotificationView[]): number {
  return items.filter((i) => i.unread).length;
}
