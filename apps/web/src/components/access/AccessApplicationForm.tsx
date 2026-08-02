"use client";

/**
 * AccessApplicationForm — the alpha access application on /verify's blocked branch (feature 026).
 *
 * Before this, a wallet that wasn't on the allowlist saw an honest but final "this wallet isn't in
 * the alpha yet" and had nowhere to go. It can now apply: contact handle, name or alias, reason.
 *
 * The wallet is NEVER sent — the agent scopes the application to the session's owner server-side.
 * The whole surface is advisory: submitting grants nothing, and the /exit escape hatch beside it is
 * untouched (N2 — the way out is never behind a form).
 */

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_DRAFT,
  MAX_CONTACT,
  MAX_NAME,
  MAX_REASON,
  parseApplication,
  shouldShowForm,
  statusLine,
  toSubmitBody,
  validateDraft,
  type ApplicationDraft,
  type ApplicationView,
} from "@/lib/access/applicationForm";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "transparent",
  color: "var(--foreground)",
  fontSize: 13,
  fontFamily: "inherit",
};
const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted-foreground)",
  margin: "10px 0 4px",
};

export function AccessApplicationForm() {
  const [draft, setDraft] = useState<ApplicationDraft>(EMPTY_DRAFT);
  const [existing, setExisting] = useState<ApplicationView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [touched, setTouched] = useState(false);

  // Read this wallet's own application (if any) so a returning applicant sees their status rather
  // than an empty form. Fail-open: an error just leaves the blank form, never a dead end.
  useEffect(() => {
    const ctrl = new AbortController();
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/agent/access/application", {
          headers: { "x-chain-id": "84532" },
          cache: "no-store",
          signal: ctrl.signal,
        });
        const app = r.ok ? parseApplication(await r.json()) : null;
        if (!live) return;
        setExisting(app);
        if (app) setDraft({ contact: app.contact, name: app.name, reason: app.reason });
      } catch {
        /* fail-open — show the blank form */
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
      ctrl.abort();
    };
  }, []);

  const validation = validateDraft(draft);

  const submit = useCallback(async () => {
    setTouched(true);
    if (!validateDraft(draft).valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await fetch("/api/agent/access/application", {
        method: "POST",
        headers: { "content-type": "application/json", "x-chain-id": "84532" },
        body: JSON.stringify(toSubmitBody(draft)),
      });
      const body = (await r.json().catch(() => null)) as unknown;
      if (!r.ok) {
        const message = (body as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(message ?? "Couldn't submit your application right now.");
      }
      setExisting(parseApplication(body));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit your application right now.");
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const line = statusLine(existing);
  const showForm = shouldShowForm(existing);
  const set = (key: keyof ApplicationDraft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const fieldError = (key: keyof ApplicationDraft) => (touched ? validation.errors[key] : undefined);

  return (
    <div style={{ marginTop: 18, textAlign: "left" }}>
      {line && (
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: existing?.status === "approved" ? "var(--gain)" : "var(--muted-foreground)",
            margin: "0 0 12px",
          }}
        >
          {line}
        </p>
      )}

      {showForm && (
        <>
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, margin: "0 0 4px" }}>
            {existing
              ? "Update your answers and re-submit."
              : "Apply for access — an admin reviews each request by hand."}
          </p>

          <label style={LABEL_STYLE} htmlFor="app-contact">
            How can we reach you? (email, Telegram, X — whichever you prefer)
          </label>
          <input
            id="app-contact"
            value={draft.contact}
            maxLength={MAX_CONTACT}
            disabled={busy || !loaded}
            onChange={(e) => set("contact")(e.target.value)}
            placeholder="you@example.com or @yourhandle"
            style={FIELD_STYLE}
          />
          <FieldError text={fieldError("contact")} />

          <label style={LABEL_STYLE} htmlFor="app-name">
            Name or alias
          </label>
          <input
            id="app-name"
            value={draft.name}
            maxLength={MAX_NAME}
            disabled={busy || !loaded}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="What should we call you?"
            style={FIELD_STYLE}
          />
          <FieldError text={fieldError("name")} />

          <label style={LABEL_STYLE} htmlFor="app-reason">
            Why would you like access?
          </label>
          <textarea
            id="app-reason"
            value={draft.reason}
            maxLength={MAX_REASON}
            rows={3}
            disabled={busy || !loaded}
            onChange={(e) => set("reason")(e.target.value)}
            placeholder="A sentence or two is plenty."
            style={{ ...FIELD_STYLE, resize: "vertical" }}
          />
          <FieldError text={fieldError("reason")} />

          {error && (
            <p style={{ fontSize: 12.5, color: "var(--loss, #ff6b6b)", margin: "8px 0 0", lineHeight: 1.5 }}>
              {error}
            </p>
          )}

          <button
            className="btn btn-primary btn-md"
            style={{ width: "100%", marginTop: 14 }}
            disabled={busy || !loaded}
            onClick={() => void submit()}
          >
            {busy ? "Submitting…" : existing ? "Re-submit application" : "Submit application"}
          </button>
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: "8px 0 0", lineHeight: 1.5 }}>
            Applying grants nothing on its own and moves no funds. Your wallet address is taken from
            your signed-in session, not from this form.
          </p>
        </>
      )}
    </div>
  );
}

function FieldError({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p style={{ fontSize: 11.5, color: "var(--loss, #ff6b6b)", margin: "4px 0 0" }}>{text}</p>
  );
}
