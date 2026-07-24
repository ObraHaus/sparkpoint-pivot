import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterByPrefs,
  relativeTime,
  toNotificationsView,
  unreadCountOf,
} from "./notificationsView.ts";

const NOW = Date.parse("2026-07-24T12:00:00Z");

test("relativeTime buckets an ISO timestamp into a short label", () => {
  assert.equal(relativeTime("2026-07-24T11:59:30Z", NOW), "just now");
  assert.equal(relativeTime("2026-07-24T11:58:00Z", NOW), "2m ago");
  assert.equal(relativeTime("2026-07-24T09:00:00Z", NOW), "3h ago");
  assert.equal(relativeTime("2026-07-23T10:00:00Z", NOW), "yesterday");
  assert.equal(relativeTime("2026-07-20T12:00:00Z", NOW), "4d ago");
  assert.equal(relativeTime("2026-06-09T12:00:00Z", NOW), "Jun 9");
  assert.equal(relativeTime(undefined, NOW), "");
  assert.equal(relativeTime("not-a-date", NOW), "");
});

test("toNotificationsView maps the wire rows, never fabricating", () => {
  const v = toNotificationsView(
    {
      stale: false,
      unreadCount: 2,
      notifications: [
        { id: "dep:0xa:0", category: "txResults", type: "deposit_confirmed", title: "Deposit confirmed", body: "5.00 USDC into the vault", icon: "check", tsApprox: "2026-07-24T11:58:00Z", txHash: "0xa", href: "/portfolio", unread: true },
        { id: "out:0xb:0", category: "outcomeUpdates", type: "outcome_closed", title: "Outcome: Win", body: "closed up +2.00 USDC", icon: "up", tsApprox: "2026-07-24T09:00:00Z", txHash: "0xb", href: "/outcomes", unread: true },
      ],
    },
    NOW,
  );
  assert.equal(v.items.length, 2);
  assert.equal(v.unreadCount, 2);
  assert.equal(v.stale, false);
  assert.equal(v.items[0].title, "Deposit confirmed");
  assert.equal(v.items[0].timeText, "2m ago");
  assert.equal(v.items[0].txHash, "0xa");
  assert.equal(v.items[0].href, "/portfolio");
  assert.equal(v.items[1].category, "outcomeUpdates");
});

test("toNotificationsView defends against a partial/empty wire (no crash, honest defaults)", () => {
  const empty = toNotificationsView(undefined, NOW);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.unreadCount, 0);
  assert.equal(empty.stale, false);
  // A row missing fields → safe defaults, never $NaN / undefined leaking through.
  const partial = toNotificationsView({ notifications: [{ type: "deposit_confirmed" }] }, NOW);
  assert.equal(partial.items[0].title, "Notification");
  assert.equal(partial.items[0].icon, "bell");
  assert.equal(partial.items[0].timeText, "");
  assert.equal(partial.items[0].txHash, null);
  assert.equal(partial.items[0].unread, false);
  // unreadCount falls back to counting when the wire omits it.
  const counted = toNotificationsView({ notifications: [{ unread: true }, { unread: false }] }, NOW);
  assert.equal(counted.unreadCount, 1);
});

test("filterByPrefs drops only categories switched OFF; unknown/true stay", () => {
  const v = toNotificationsView(
    {
      notifications: [
        { id: "1", category: "txResults", unread: true },
        { id: "2", category: "outcomeUpdates", unread: true },
        { id: "3", category: "unknownCat", unread: false },
      ],
    },
    NOW,
  );
  const filtered = filterByPrefs(v.items, { txResults: true, outcomeUpdates: false });
  const ids = filtered.map((i) => i.id);
  assert.deepEqual(ids, ["1", "3"]); // outcomeUpdates off → dropped; unknown category kept
  assert.equal(unreadCountOf(filtered), 1); // only the txResults row is unread among the shown
});
