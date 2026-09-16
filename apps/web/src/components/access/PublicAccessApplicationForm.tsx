"use client";

/**
 * PublicAccessApplicationForm — apply for the alpha WITHOUT connecting a wallet (045).
 *
 * The 026 form ({@link ./AccessApplicationForm.tsx}) lives on `/verify`, behind a completed SIWE
 * sign-in, and takes the address from the session. That is right for someone who already connected
 * and was turned away — and unreachable for everyone else. A visitor who has heard about the alpha
 * has no reason to connect a wallet to a product they cannot use yet, so the only door was one they
 * had to walk through a locked one to find.
 *
 * This form asks the same three questions plus the address, and asks for nothing else: no wallet,
 * no signature, no extension. The address is therefore a CLAIM. The server records that (`source:
 * 'public'`) and the admin panel shows it, so approving one is a decision made with the facts.
 *
 * The success message is deliberately the same in every case — new application, duplicate, or an
 * address that is already approved. The endpoint refuses to be an oracle for who has access, and a
 * client that distinguished those cases would rebuild the oracle it is protected from.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  EMPTY_PUBLIC_DRAFT,
  MAX_CONTACT,
  MAX_NAME,
  MAX_REASON,
  SUBMITTED_MESSAGE,
  submitErrorMessage,
  toPublicSubmitBody,
  validatePublicDraft,
  type PublicApplicationDraft,
} from "@/lib/access/publicApplicationForm";
import "./apply-form.css";

export interface PublicAccessApplicationFormProps {
  /**
   * `"light"` pins the palette for the landing page's permanently-white closing panel; the default
   * follows the app theme. See `apply-form.css` for why this is not automatic.
   */
  readonly surface?: "theme" | "light";
  /** The class the surrounding surface uses for its primary button (`btn btn-primary btn-md` on an
   *  app page, `fbtn primary` in the landing footer). */
  readonly submitClassName?: string;
  /** Rendered above the fields. Omitted on a page that already explains itself in its heading. */
  readonly lede?: string;
}

/**
 * Whether React has taken over this markup yet.
 *
 * ⚠️ THIS GUARD IS LOAD-BEARING, and it is here because the bug it prevents was observed on the
 * live site. This is a real `<form>`, so before hydration the browser's own default submit applies:
 * clicking the button performed a plain GET to `/apply?website=` — it NAVIGATED, wiping all four
 * fields the applicant had just filled in, with no error and no explanation. (Only the honeypot
 * appeared in the query string, because it is the one input with a `name` — which is precisely how
 * a native submit serialises a form, and how the diagnosis was confirmed.)
 *
 * The landing page is the worse case, not `/apply`: it boots a Three.js scene, so its hydration
 * window is far longer and a quick applicant is far more likely to land inside it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server snapshot is `false` and
 * the client snapshot is `true`, which is exactly the SSR-safe way to express "this differs between
 * server and client" without tripping a hydration mismatch.
 */
const subscribeToNothing = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

export function PublicAccessApplicationForm({
  surface = "theme",
  submitClassName = "btn btn-primary btn-md",
  lede,
}: PublicAccessApplicationFormProps) {
  const hydrated = useHydrated();
  const [draft, setDraft] = useState<PublicApplicationDraft>(EMPTY_PUBLIC_DRAFT);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [touched, setTouched] = useState(false);

  const validation = validatePublicDraft(draft);
  const set = (key: keyof PublicApplicationDraft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  // Field errors stay hidden until the first submit attempt: flagging "required" at someone who
  // has not finished typing is noise, not help.
  const fieldError = (key: keyof PublicApplicationDraft) =>
    touched ? validation.errors[key] : undefined;

  const submit = useCallback(async () => {
    setTouched(true);
    if (!validatePublicDraft(draft).valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/access/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The honeypot rides along; the server drops the submission if it is filled.
        body: JSON.stringify({ ...toPublicSubmitBody(draft), website: draft.website }),
      });
      if (!res.ok) {
        setError(submitErrorMessage(res.status));
        return;
      }
      setSubmitted(true);
    } catch {
      setError(submitErrorMessage(0));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const root = `ap-form${surface === "light" ? " ap-light" : ""}`;

  if (submitted) {
    return (
      <div className={root}>
        <p className="ap-done" role="status">
          {SUBMITTED_MESSAGE}
        </p>
      </div>
    );
  }

  return (
    <form
      className={root}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {lede && <p className="ap-lede">{lede}</p>}

      <label className="ap-label" htmlFor="pub-app-address">
        Your wallet address
      </label>
      <input
        id="pub-app-address"
        className="ap-field ap-address"
        value={draft.address}
        maxLength={64}
        disabled={busy}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="text"
        placeholder="0x…"
        aria-invalid={fieldError("address") ? true : undefined}
        onChange={(e) => set("address")(e.target.value)}
      />
      <FieldError text={fieldError("address")} />

      <label className="ap-label" htmlFor="pub-app-contact">
        How can we reach you?
      </label>
      <input
        id="pub-app-contact"
        className="ap-field"
        value={draft.contact}
        maxLength={MAX_CONTACT}
        disabled={busy}
        placeholder="you@example.com or @yourhandle"
        aria-invalid={fieldError("contact") ? true : undefined}
        onChange={(e) => set("contact")(e.target.value)}
      />
      <FieldError text={fieldError("contact")} />

      <label className="ap-label" htmlFor="pub-app-name">
        Name or alias
      </label>
      <input
        id="pub-app-name"
        className="ap-field"
        value={draft.name}
        maxLength={MAX_NAME}
        disabled={busy}
        placeholder="What should we call you?"
        aria-invalid={fieldError("name") ? true : undefined}
        onChange={(e) => set("name")(e.target.value)}
      />
      <FieldError text={fieldError("name")} />

      <label className="ap-label" htmlFor="pub-app-reason">
        Why would you like access?
      </label>
      <textarea
        id="pub-app-reason"
        className="ap-field"
        value={draft.reason}
        maxLength={MAX_REASON}
        rows={3}
        disabled={busy}
        placeholder="A sentence or two is plenty."
        aria-invalid={fieldError("reason") ? true : undefined}
        onChange={(e) => set("reason")(e.target.value)}
      />
      <FieldError text={fieldError("reason")} />

      {/* Honeypot — off-screen, untabbable, hidden from assistive tech. Never shown, never
          validated, and a filled one is accepted silently rather than rejected loudly. */}
      <div className="ap-hp" aria-hidden="true">
        <label htmlFor="pub-app-website">Website</label>
        <input
          id="pub-app-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={draft.website}
          onChange={(e) => set("website")(e.target.value)}
        />
      </div>

      {error && (
        <p className="ap-error" role="alert">
          {error}
        </p>
      )}

      {/* `disabled` until hydrated: an enabled submit button in un-hydrated markup is a NATIVE
          submit that navigates away and discards everything typed. Inert-for-a-moment beats
          destructive. The label does not change, so there is no layout shift and nothing flickers
          — the button simply cannot throw the applicant's answers away. */}
      <button className={`${submitClassName} ap-submit`} type="submit" disabled={busy || !hydrated}>
        {busy ? "Submitting…" : "Apply for access"}
      </button>

      <p className="ap-fine">
        Applying grants nothing on its own and moves no funds — an admin reviews each request by
        hand. We only use your contact to tell you the outcome.
      </p>
    </form>
  );
}

function FieldError({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="ap-error">{text}</p>;
}
