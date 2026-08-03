"use client";

/**
 * /settings — tabbed settings: Account, Mandate, Memory, Notifications, Appearance, Security.
 * Risk profile, goals, alerts, connected wallet, and theme (wired to next-themes).
 *
 * Faithful 1:1 port of the design's `settings` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim;
 * the tab/switch/segment interactivity is reproduced with React state. The **Memory** tab is
 * new in feature 027 (the design predates cross-conversation memory) and reuses the same
 * `.setrow` primitives, so it reads as part of the same screen.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Icon } from "@/lib/icons";
import { useNetwork } from "@/lib/network";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/support.css";
import { StatusTag } from "@/components/ui/status-tag";
import {
  useMandate,
  useUpdateMandate,
  useSparkyMemory,
  useClearSparkyMemory,
  mandateSaveHint,
  type MandateView,
} from "@/lib/agent/useAgent";
import { formatUsdc } from "@/lib/strategy/projection";
import { useSessionKeys } from "@/lib/automation/useSessionKey";
import { useSelfPremiumStatus } from "@/lib/premium/useSelfPremiumStatus";
import { useNotifPrefs, useDisplayPrefs } from "@/lib/settings/usePrefs";
import type { NotifKey } from "@/lib/settings/prefs";

type Tab = "account" | "mandate" | "memory" | "notifications" | "appearance" | "security";

const SETTABS: [Tab, string][] = [
  ["account", "Account"],
  ["mandate", "Mandate"],
  ["memory", "Memory"],
  ["notifications", "Notifications"],
  ["appearance", "Appearance"],
  ["security", "Security"],
];

const NOTIF_ROWS: { key: NotifKey; label: string }[] = [
  { key: "txResults", label: "Transaction results" },
  { key: "rateChanges", label: "Rate changes & recommendations" },
  { key: "capsNearLimit", label: "Caps near limit" },
  { key: "sessionKeyExpiry", label: "Session-key expiry" },
  { key: "outcomeUpdates", label: "Outcome updates" },
];

/** A controlled toggle mirroring the design's `.switch`. */
function Switch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      className={"switch" + (on ? " on" : "")}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

/** The Mandate tab — the user's REAL persisted plan (GET /agent/mandate), with honest
 * loading / empty / disconnected states. Replaces the former hardcoded tier-1 mock. */
function MandateTab() {
  const mandate = useMandate();

  if (mandate.status === "disconnected" || mandate.status === "loading") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Your plan</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {mandate.status === "loading" ? "Loading your plan…" : "Connect your wallet to see your mandate."}
          </div>
        </div>
        <span className="muted">—</span>
      </div>
    );
  }

  if (mandate.status === "error") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Your plan</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Couldn’t load your mandate just now.</div>
        </div>
        <Link className="btn btn-outline btn-md" href="/onboarding">Review plan</Link>
      </div>
    );
  }

  if (mandate.status === "empty") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>No plan yet</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Set your risk &amp; goals so recommendations fit you.</div>
        </div>
        <Link className="btn btn-primary btn-md" href="/onboarding">Set up mandate</Link>
      </div>
    );
  }

  const m = mandate.mandate;
  return <MandateFields m={m} />;
}

/**
 * The plan, editable field by field (030/FR-014).
 *
 * This tab was entirely read-only and its "Edit" button re-ran the whole conversational
 * onboarding flow — so changing one slippage value meant re-answering the drawdown question. For
 * a plan the product wants people to maintain, that is the wrong friction.
 *
 * Each row saves independently. The agent stores mandates as an immutable version series, so a
 * save forks a new confirmed version carrying every field the user did not touch.
 */
function MandateFields({ m }: { m: MandateView }) {
  const { update, pending } = useUpdateMandate();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Parameters<typeof update>[0]) => {
    setError(null);
    const outcome = await update(patch);
    if (outcome.ok) setEditing(null);
    else setError(mandateSaveHint(outcome.failure));
  };

  return (
    <>
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Your plan</div>
          {/* 030 — DERIVED, not the stored string. Mandate v6 on alpha still stores
              "High risk (5/5), capital-preservation-first."; deriving retires that whole class
              of contradiction without a data migration. */}
          <div className="muted" style={{ fontSize: 12.5 }}>{m.summary}</div>
        </div>
        <RiskChip tier={m.tier} />
      </div>

      <EditableRow
        label="Risk level"
        hint="How much variation you're willing to accept. Only ever narrows what may be proposed."
        value={`${m.riskLabel} · ${m.tier}/5`}
        editing={editing === "risk"}
        onEdit={() => setEditing("risk")}
        onCancel={() => setEditing(null)}
        pending={pending}
      >
        <select
          className="input"
          defaultValue={String(m.tier)}
          onChange={(e) => void save({ riskTier: Number(e.target.value) })}
          aria-label="Risk level"
        >
          {[1, 2, 3, 4, 5].map((t) => (
            <option key={t} value={t}>{t}/5</option>
          ))}
        </select>
      </EditableRow>

      <EditableRow
        label="Most I'm willing to put at risk"
        hint="Caps what Sparky will suggest. Your on-chain limits still apply on top of this."
        value={m.exposureLimitUsdc ? `$${formatUsdc(Number(m.exposureLimitUsdc))}` : "Not set"}
        editing={editing === "exposure"}
        onEdit={() => setEditing("exposure")}
        onCancel={() => setEditing(null)}
        pending={pending}
      >
        <AmountInput
          placeholder="e.g. 500"
          initial={m.exposureLimitUsdc}
          onSave={(base) => void save({ exposureLimitUsdc: base })}
          onClear={() => void save({ exposureLimitUsdc: null })}
        />
      </EditableRow>

      <EditableRow
        label="What I'm saving for"
        hint="A target and a date, so the product can show you how far along you are."
        value={
          m.goalTargetUsdc && m.goalTargetDate
            ? `$${formatUsdc(Number(m.goalTargetUsdc))} by ${m.goalTargetDate}`
            : "Not set"
        }
        editing={editing === "goal"}
        onEdit={() => setEditing("goal")}
        onCancel={() => setEditing(null)}
        pending={pending}
      >
        <GoalInput
          initialAmount={m.goalTargetUsdc}
          initialDate={m.goalTargetDate}
          onSave={(amount, date) => void save({ goalTargetUsdc: amount, goalTargetDate: date })}
          onClear={() => void save({ goalTargetUsdc: null, goalTargetDate: null })}
        />
      </EditableRow>

      <EditableRow
        label="What I plan to add"
        hint="Used for projections and reminders only — nothing moves without you signing it."
        value={
          m.contribution
            ? `$${formatUsdc(Number(m.contribution.amountUsdc))} ${m.contribution.cadence}`
            : "Not set"
        }
        editing={editing === "contribution"}
        onEdit={() => setEditing("contribution")}
        onCancel={() => setEditing(null)}
        pending={pending}
      >
        <ContributionInput
          initial={m.contribution}
          onSave={(c) => void save({ contribution: c })}
          onClear={() => void save({ contribution: null })}
        />
      </EditableRow>

      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Max slippage</div>
          <div className="muted" style={{ fontSize: 12.5 }}>The most price movement a move may accept.</div>
        </div>
        <span>{m.maxSlippageBps !== undefined ? `${(m.maxSlippageBps / 100).toFixed(2)}%` : "—"}</span>
      </div>
      <div className="setrow">
        <div><div style={{ fontWeight: 600 }}>Timeline</div></div>
        <span>{m.timeline}</span>
      </div>

      {error && (
        <div className="setrow">
          <span style={{ fontSize: 12.5, color: "var(--loss)" }}>{error}</span>
        </div>
      )}
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Start over</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Re-runs the full review &amp; confirm steps.</div>
        </div>
        <Link className="btn btn-outline btn-md" href="/onboarding">Redo onboarding</Link>
      </div>
    </>
  );
}

/** One plan row: a value, an Edit affordance, and the editor inline when open. */
function EditableRow({
  label, hint, value, editing, onEdit, onCancel, pending, children,
}: {
  label: string; hint: string; value: string; editing: boolean;
  onEdit: () => void; onCancel: () => void; pending: boolean; children: React.ReactNode;
}) {
  return (
    <div className="setrow" style={{ alignItems: editing ? "flex-start" : "center" }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12.5, maxWidth: 420 }}>{hint}</div>
        {editing && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
      {editing ? (
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={pending}>Cancel</button>
      ) : (
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>{value}</span>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>Edit</button>
        </span>
      )}
    </div>
  );
}

/** A USDC amount in whole dollars, converted to base units on save. */
function AmountInput({
  placeholder, initial, onSave, onClear,
}: { placeholder: string; initial?: string; onSave: (base: string) => void; onClear: () => void }) {
  const [text, setText] = useState(initial ? String(Math.trunc(Number(initial) / 1_000_000)) : "");
  const base = /^\d+$/.test(text.trim()) && Number(text) > 0 ? `${Number(text) * 1_000_000}` : null;
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" inputMode="numeric" placeholder={placeholder} value={text}
             onChange={(e) => setText(e.target.value)} style={{ width: 140 }} aria-label="Amount in USDC" />
      <button className="btn btn-primary btn-sm" disabled={!base} onClick={() => base && onSave(base)}>Save</button>
      {initial && <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
    </span>
  );
}

/** A goal is atomic: the Save button stays disabled until BOTH an amount and a date are given. */
function GoalInput({
  initialAmount, initialDate, onSave, onClear,
}: {
  initialAmount?: string; initialDate?: string;
  onSave: (amount: string, date: string) => void; onClear: () => void;
}) {
  const [amount, setAmount] = useState(
    initialAmount ? String(Math.trunc(Number(initialAmount) / 1_000_000)) : "",
  );
  const [date, setDate] = useState(initialDate ?? "");
  const base = /^\d+$/.test(amount.trim()) && Number(amount) > 0 ? `${Number(amount) * 1_000_000}` : null;
  const ready = base !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" inputMode="numeric" placeholder="e.g. 10000" value={amount}
             onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} aria-label="Target amount in USDC" />
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)}
             aria-label="Target date" />
      <button className="btn btn-primary btn-sm" disabled={!ready}
              onClick={() => ready && base && onSave(base, date)}>Save</button>
      {initialAmount && <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
    </span>
  );
}

/** A stated intention to add money. Deliberately worded so it cannot read as automatic. */
function ContributionInput({
  initial, onSave, onClear,
}: {
  initial?: { amountUsdc: string; cadence: string };
  onSave: (c: { amountUsdc: string; cadence: string }) => void; onClear: () => void;
}) {
  const [amount, setAmount] = useState(
    initial ? String(Math.trunc(Number(initial.amountUsdc) / 1_000_000)) : "",
  );
  const [cadence, setCadence] = useState(initial?.cadence ?? "monthly");
  const base = /^\d+$/.test(amount.trim()) && Number(amount) > 0 ? `${Number(amount) * 1_000_000}` : null;
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" inputMode="numeric" placeholder="e.g. 200" value={amount}
             onChange={(e) => setAmount(e.target.value)} style={{ width: 120 }} aria-label="Contribution amount" />
      <select className="input" value={cadence} onChange={(e) => setCadence(e.target.value)}
              aria-label="How often">
        {["weekly", "fortnightly", "monthly", "quarterly"].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button className="btn btn-primary btn-sm" disabled={!base}
              onClick={() => base && onSave({ amountUsdc: base, cadence })}>Save</button>
      {initial && <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
    </span>
  );
}

/** The one honest sentence that has to sit next to the list, in the user's own words. */
const MEMORY_DISCLOSURE =
  "This includes your recent platform activity — deposits, withdrawals, swaps, and faucet " +
  "claims — alongside what you've discussed. It is advisory context for suggestions and " +
  "answers only — it never authorises anything, and it is never used to move your funds.";

/**
 * The Memory tab (027) — "Sparky's memory": what the assistant carries between conversations,
 * shown verbatim, with a one-press erase.
 *
 * Deliberately unglamorous. The lines are rendered exactly as stored (the same strings the model
 * is given), because the card's claim is "this is what Sparky knows about you" and a prettier
 * paraphrase would make that claim false. Clearing reports FAILURE honestly: a button labelled
 * "Clear memory" that silently did nothing would be worse than no button at all.
 */
function MemoryTab() {
  const memory = useSparkyMemory();
  const clearMemory = useClearSparkyMemory();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (memory === null) {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Sparky&apos;s memory</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Connect your wallet to see what Sparky remembers.
          </div>
        </div>
        <span className="muted">—</span>
      </div>
    );
  }

  const onClear = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await clearMemory();
    setBusy(false);
    setFailed(!ok);
    if (ok) setConfirming(false);
  };

  return (
    <>
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Sparky&apos;s memory</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            A short running note of what you&apos;ve done together, so a new conversation
            doesn&apos;t start from scratch. {MEMORY_DISCLOSURE}
          </div>
        </div>
        {memory.view.isEmpty || confirming ? (
          <span className="muted">{memory.view.isEmpty ? "Nothing yet" : ""}</span>
        ) : (
          <button className="btn btn-outline btn-md" onClick={() => setConfirming(true)}>
            Clear memory
          </button>
        )}
      </div>

      {confirming && (
        <div className="setrow">
          <div>
            <div style={{ fontWeight: 600 }}>Clear everything Sparky remembers?</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              This can&apos;t be undone. Your chat history, plan, and funds are untouched.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-md" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary btn-md" onClick={onClear} disabled={busy}>
              {busy ? "Clearing…" : "Yes, clear it"}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <div className="setrow">
          <div className="muted" style={{ fontSize: 12.5 }}>
            Couldn&apos;t clear your memory just now — nothing was changed. Please try again.
          </div>
        </div>
      )}

      {memory.isLoading && (
        <div className="setrow">
          <div className="muted" style={{ fontSize: 12.5 }}>Loading…</div>
        </div>
      )}

      {memory.isError && (
        <div className="setrow">
          <div className="muted" style={{ fontSize: 12.5 }}>
            Couldn&apos;t load Sparky&apos;s memory just now.
          </div>
        </div>
      )}

      {memory.loaded && memory.view.isEmpty && (
        <div className="setrow">
          <div className="muted" style={{ fontSize: 12.5 }}>
            Sparky hasn&apos;t noted anything yet. It starts remembering once you chat.
          </div>
        </div>
      )}

      {memory.view.rows.map((row) => (
        <div className="setrow" key={row.key}>
          <div style={{ fontSize: 13.5 }}>{row.text}</div>
          <span className="muted" style={{ fontSize: 12.5 }}>{row.dateText}</span>
        </div>
      ))}

      {!memory.view.isEmpty && (
        <div className="setrow">
          <div className="muted" style={{ fontSize: 12.5 }}>
            Showing the {memory.view.count} most recent notes — older ones drop off automatically.
            {memory.view.updatedText ? ` ${memory.view.updatedText}.` : ""}
          </div>
        </div>
      )}
    </>
  );
}

export default function Page() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { wallet, disconnectWallet } = useNetwork();
  const [tab, setTab] = useState<Tab>("account");
  const premium = useSelfPremiumStatus();
  const sessionKeys = useSessionKeys();
  const { prefs: notif, setNotif } = useNotifPrefs();
  const { prefs: display, setDensity, setReducedMotion } = useDisplayPrefs();

  const isLight = resolvedTheme === "light";

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>Settings <StatusTag variant="partial" works={["Your mandate (risk + slippage) is real and drives recommendations", "Sparky's memory is real: the Memory tab shows the actual notes it carries between conversations, and Clear memory really erases them", "In-app notifications are live — these category toggles filter your real notifications feed", "Display preferences are saved on this device; compact density and reduce-motion apply across the app"]} pending={["Only email / push DELIVERY of notifications isn’t wired yet (in-app is live); session-key alerts arrive once automation ships"]} /></h1>
        </div>
        <button
          className="btn btn-ghost btn-md"
          onClick={async () => {
            await disconnectWallet();
            router.push(toHref("landing"));
          }}
        >
          <Icon name="logout" size={15} /> Log out
        </button>
      </div>
      <div className="settabs">
        {SETTABS.map((t) => (
          <div
            className={"settab " + (t[0] === tab ? "active" : "")}
            key={t[0]}
            onClick={() => setTab(t[0])}
          >
            {t[1]}
          </div>
        ))}
      </div>
      <div className="card card-pad">
        {tab === "account" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Connected wallet</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Smart account on Base
                </div>
              </div>
              <span className="mono">{wallet}</span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Network</div>
              </div>
              <span className="pill ghosty" style={{ cursor: "default" }}>
                Base
              </span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Plan</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {premium.active
                    ? `Premium${premium.untilLabel ? ` — active until ${premium.untilLabel}` : ""}`
                    : "Free — fully capable, forever. Premium adds advanced capability."}
                </div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("premium"))}>
                {premium.active ? "Manage plan" : "See Premium"}
              </button>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Disconnect</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Your funds are untouched — you can reconnect anytime.
                </div>
              </div>
              <button
                className="btn btn-outline btn-md"
                onClick={async () => {
                  await disconnectWallet();
                  router.push(toHref("landing"));
                }}
              >
                <Icon name="logout" size={15} /> Disconnect
              </button>
            </div>
          </>
        )}

        {tab === "mandate" && <MandateTab />}

        {tab === "memory" && <MemoryTab />}

        {tab === "notifications" && (
          <>
            {NOTIF_ROWS.map(({ key, label }) => (
              <div className="setrow" key={key}>
                <div style={{ fontWeight: 600 }}>{label}</div>
                <Switch on={notif[key]} onChange={(v) => setNotif(key, v)} />
              </div>
            ))}
            <div className="setrow">
              <div className="muted" style={{ fontSize: 12.5 }}>
                Saved on this device. Delivery (email / push) isn’t live in alpha — these set what you’ll get once it is.
              </div>
            </div>
          </>
        )}

        {tab === "appearance" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Theme</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Dark is the default canvas.
                </div>
              </div>
              <div className="seg">
                <button className={!isLight ? "active" : ""} onClick={() => setTheme("dark")}>
                  Dark
                </button>
                <button className={isLight ? "active" : ""} onClick={() => setTheme("light")}>
                  Light
                </button>
              </div>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Density</div>
              </div>
              <div className="seg">
                <button
                  className={display.density === "comfortable" ? "active" : ""}
                  onClick={() => setDensity("comfortable")}
                >
                  Comfortable
                </button>
                <button
                  className={display.density === "compact" ? "active" : ""}
                  onClick={() => setDensity("compact")}
                >
                  Compact
                </button>
              </div>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Reduce motion</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Fewer transitions &amp; animations on this device.
                </div>
              </div>
              <Switch on={display.reducedMotion} onChange={setReducedMotion} />
            </div>
          </>
        )}

        {tab === "security" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Active session keys</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {sessionKeys.active
                    ? `1 active grant — expires ${new Date(sessionKeys.active.validUntil * 1000).toLocaleDateString()} — instantly revocable, on-chain scoped.`
                    : sessionKeys.loaded
                      ? "None — you sign every move."
                      : "You sign every move unless you grant one."}
                </div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("automation"))}>
                Manage
              </button>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>View exact permissions</div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/permissions"))}>
                <Icon name="shieldcheck" size={15} /> Prove it
              </button>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Withdraw / Exit</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Always available, even if we&apos;re offline.
                </div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/exit"))}>
                <Icon name="door" size={15} /> Exit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
