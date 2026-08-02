/**
 * applicationForm — the pure, DOM-free model behind the alpha access application on /verify
 * (feature 026), so the validation and the status copy are unit-testable without a browser.
 *
 * Three client-decided fields: a single free-text contact handle (email / Telegram / X — the
 * applicant picks), a name or alias, and a reason for access. Caps mirror the agent's server-side
 * caps AND the DB CHECKs — this layer is a courtesy, never the enforcement.
 */

export const MAX_CONTACT = 200;
export const MAX_NAME = 120;
export const MAX_REASON = 2000;

export type ApplicationStatus = "pending" | "approved" | "denied";

export interface ApplicationDraft {
  readonly contact: string;
  readonly name: string;
  readonly reason: string;
}

export interface ApplicationView {
  readonly address: string;
  readonly contact: string;
  readonly name: string;
  readonly reason: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export const EMPTY_DRAFT: ApplicationDraft = { contact: "", name: "", reason: "" };

export interface DraftValidation {
  readonly valid: boolean;
  /** Field-keyed messages — only the fields that are actually wrong. */
  readonly errors: Partial<Record<keyof ApplicationDraft, string>>;
}

function checkField(
  value: string,
  cap: number,
  label: string,
  minLength = 1,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < minLength) return `${label} is required.`;
  if (trimmed.length > cap) return `${label} must be ${cap} characters or fewer.`;
  return undefined;
}

export function validateDraft(draft: ApplicationDraft): DraftValidation {
  const errors: Partial<Record<keyof ApplicationDraft, string>> = {};
  const contact = checkField(draft.contact, MAX_CONTACT, "A contact handle");
  const name = checkField(draft.name, MAX_NAME, "A name or alias");
  // A one-character "reason" is not a reason; ask for a sentence rather than silently accepting noise.
  const reason = checkField(draft.reason, MAX_REASON, "A reason for access", 10);
  if (contact) errors.contact = contact;
  if (name) errors.name = name;
  if (reason) errors.reason = reason;
  return { valid: Object.keys(errors).length === 0, errors };
}

/** The exact JSON body the agent's `POST /access/application` expects (trimmed, never the wallet). */
export function toSubmitBody(draft: ApplicationDraft): ApplicationDraft {
  return {
    contact: draft.contact.trim(),
    name: draft.name.trim(),
    reason: draft.reason.trim(),
  };
}

/** Parse the agent's `{ application }` envelope. Anything unexpected ⇒ `null` (never a guess). */
export function parseApplication(raw: unknown): ApplicationView | null {
  if (!raw || typeof raw !== "object") return null;
  const app = (raw as { application?: unknown }).application;
  if (!app || typeof app !== "object") return null;
  const a = app as Record<string, unknown>;
  const status = a.status;
  if (status !== "pending" && status !== "approved" && status !== "denied") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    address: str(a.address),
    contact: str(a.contact),
    name: str(a.name),
    reason: str(a.reason),
    status,
    submittedAt: str(a.submittedAt),
    updatedAt: str(a.updatedAt),
  };
}

/** The one-line status a returning applicant sees above the form. */
export function statusLine(app: ApplicationView | null): string | undefined {
  if (!app) return undefined;
  if (app.status === "pending") return "Your application is pending review. We'll be in touch on the contact you gave.";
  if (app.status === "approved") {
    return "Your application was approved — sign in again to pick up your access.";
  }
  return "Your previous application wasn't approved. You can update your answers and re-submit.";
}

/** Whether the form should be shown at all (an approved applicant just needs to sign in again). */
export function shouldShowForm(app: ApplicationView | null): boolean {
  return app?.status !== "approved";
}
