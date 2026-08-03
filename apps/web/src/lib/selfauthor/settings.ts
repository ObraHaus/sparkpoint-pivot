/**
 * 034 — validating the two lists an admin edits, in the browser, before anything is sent.
 *
 * PURE. No imports, no network — a leaf module, so the strip-types test runner can load it.
 *
 * WHY VALIDATE HERE AT ALL when the agent validates too? Because the agent's answer arrives after a
 * round trip, and the field the admin is typing in has already lost focus by then. The server
 * remains the authority; this is what lets the form say "drop the scheme" while the cursor is still
 * in the box. The two must agree, so the rules below mirror `selfauthor/allowlist.py` exactly.
 *
 * THE EMPTY LIST IS MEANINGFUL. An empty prose allowlist means Sparky fetches NO prose — never
 * "fetch anything". The UI has to say that out loud, because an empty list looks like an unfinished
 * setting rather than a deliberate one.
 */

/** The structured feeds an admin may switch on. `prose` is absent deliberately — prose is governed
 *  by the DOMAIN list, and offering it in both places would let one list contradict the other. */
export const DATA_SOURCES = [
  { id: "chain", label: "On-chain reads", hint: "The only source that can describe our own testnet truthfully." },
  { id: "defillama", label: "DeFiLlama yields", hint: "Mainnet benchmarks. Structured numbers, no prose." },
  { id: "morpho", label: "Morpho API", hint: "Net APY after the whole fee chain. Mainnet only." },
  { id: "own_corpus", label: "Our own documentation", hint: "What we've already published. No third party." },
  { id: "answer_gaps", label: "Gaps in our answers", hint: "Topic counts only — never anyone's words." },
] as const;

export type DataSourceId = (typeof DATA_SOURCES)[number]["id"];

const KNOWN: readonly string[] = DATA_SOURCES.map((s) => s.id);

export interface DomainCheck {
  readonly ok: boolean;
  /** The value as it would be stored. Only meaningful when `ok`. */
  readonly value: string;
  /** Why it was refused, phrased as something the admin can act on. */
  readonly problem: string;
}

/**
 * One allowlist entry, normalised to a bare lowercase host — or refused, with a reason.
 *
 * Refuses rather than coerces. An admin who typed `https://docs.aave.com/v3` and saw it silently
 * become `docs.aave.com` would reasonably believe the path was part of the restriction. It is not:
 * the allowlist is per-host, and the whole host is allowed.
 */
export function checkDomain(raw: string): DomainCheck {
  const entry = (raw ?? "").trim().toLowerCase();
  const no = (problem: string): DomainCheck => ({ ok: false, value: "", problem });

  if (!entry) return no("Enter a host name.");
  if (entry.includes("*")) return no("Wildcards aren't supported — list each host on its own.");
  if (entry.includes("://")) return no("Drop the https:// — this is a list of hosts.");
  if (entry.includes("/")) return no("Drop the path. The whole host is allowed, not one page.");
  if (entry.includes(":")) return no("Drop the port.");
  if (entry.includes(" ")) return no("A host name can't contain spaces.");
  if (!entry.includes(".")) return no("That doesn't look like a host name.");
  if (entry.startsWith(".") || entry.endsWith(".")) return no("Remove the leading or trailing dot.");
  return { ok: true, value: entry, problem: "" };
}

/** Add an entry to a list, deduplicated and sorted. Returns the reason when it cannot be added. */
export function addDomain(list: readonly string[], raw: string): { list: string[]; problem: string } {
  const check = checkDomain(raw);
  if (!check.ok) return { list: [...list], problem: check.problem };
  if (list.includes(check.value)) return { list: [...list], problem: `${check.value} is already on the list.` };
  return { list: [...list, check.value].sort(), problem: "" };
}

export function removeDomain(list: readonly string[], host: string): string[] {
  return list.filter((d) => d !== host);
}

export function toggleSource(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((s) => s !== id) : [...list, id].filter((s) => KNOWN.includes(s)).sort();
}

/** A draft window an admin typed, or the reason it can't be used. 0 is valid — publish immediately. */
export function checkWindowHours(raw: string): { ok: boolean; value: number; problem: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, value: 0, problem: "Enter a number of hours." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, value: 0, problem: "Whole hours only." };
  const value = Number(trimmed);
  if (value > 8760) return { ok: false, value, problem: "A year is the maximum — beyond that, 'draft' means 'off'." };
  return { ok: true, value, problem: "" };
}

/** How long a window reads to a person. Hours are precise and unreadable past a day or two. */
export function describeWindow(hours: number): string {
  if (hours === 0) return "publishes immediately";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} in draft`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days in draft`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} in draft`;
}

/**
 * What the Self-authored section says about its own state, in one sentence.
 *
 * Written as a sentence rather than a row of badges because the combination is what matters: a
 * feature that is enabled but reads nothing is not the same as one that is switched off, and both
 * look identical if you only render each setting on its own.
 */
export function describeState(s: {
  enabled: boolean;
  publishMode: string;
  draftWindowHours: number;
  allowedDataSources: readonly string[];
  allowedProseDomains: readonly string[];
}): string {
  if (!s.enabled) return "Switched off. Nothing is being generated, and nothing already published has changed.";
  if (s.allowedDataSources.length === 0) {
    return "Switched on, but no source is allowed — so a run has nothing to read and will write nothing.";
  }
  const prose =
    s.allowedProseDomains.length === 0
      ? "no external pages"
      : `${s.allowedProseDomains.length} allowed ${s.allowedProseDomains.length === 1 ? "domain" : "domains"}`;
  const publishing =
    s.publishMode === "manual"
      ? "You publish each document yourself"
      : `Publishing automatically, ${describeWindow(s.draftWindowHours)}`;
  return `Reading ${s.allowedDataSources.length} data ${
    s.allowedDataSources.length === 1 ? "source" : "sources"
  } and ${prose}. ${publishing}.`;
}

/** How a run's outcome should read. `no_change` and `no_evidence` are SUCCESSES, not failures. */
export function describeOutcome(outcome: string | null): { text: string; tone: "good" | "quiet" | "bad" } {
  switch (outcome) {
    case "published":
      return { text: "Published", tone: "good" };
    case "no_change":
      return { text: "Nothing new to say", tone: "quiet" };
    case "no_evidence":
      return { text: "Nothing could be read", tone: "quiet" };
    case "blocked_selfcheck":
      return { text: "Held back — it would have made an answer worse", tone: "bad" };
    case "skipped_locked":
      return { text: "Skipped — another run was in flight", tone: "quiet" };
    case "skipped_disabled":
      return { text: "Skipped — switched off", tone: "quiet" };
    case "error":
      return { text: "Failed", tone: "bad" };
    default:
      return { text: outcome ? outcome : "Running…", tone: "quiet" };
  }
}

/** "4 findings held, oldest 12 days" — count AND age, so a growing pile is visible. */
export function describeHeld(count: number, oldestIso: string | null, nowMs: number): string {
  if (count === 0) return "Nothing held.";
  const noun = count === 1 ? "finding" : "findings";
  if (!oldestIso) return `${count} ${noun} held.`;
  const days = Math.floor((nowMs - Date.parse(oldestIso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return `${count} ${noun} held, the oldest from today.`;
  return `${count} ${noun} held, oldest ${days} day${days === 1 ? "" : "s"} ago.`;
}
