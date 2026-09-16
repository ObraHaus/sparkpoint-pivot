/**
 * publicApplicationForm — the pure, DOM-free model behind the PUBLIC alpha application (045).
 *
 * 026 put an application form on `/verify`. Only a wallet that had already connected and signed
 * could ever see it, which is close to the opposite of who needs it: a visitor with no access has
 * no reason to connect a wallet to a product they cannot use, and connecting only to be told "this
 * wallet isn't in the alpha yet" is a dead end with extra steps. So the landing page gets a form
 * that asks for nothing but typing.
 *
 * Same three questions as the signed-in form ({@link ./applicationForm.ts}) plus the one it never
 * needed to ask, because it took the answer from the session: **the wallet address**. Here that
 * address is a claim, not a proof — nobody signed anything — which is why the server stores it as
 * `source: 'public'` and the admin panel says so before anyone approves it.
 *
 * ⚠️ The caps are RESTATED here rather than imported from `./applicationForm`, and that is a
 * deliberate constraint of the test runner, not a preference: these pure models are exercised by
 * `node --experimental-strip-types`, which resolves no extensionless specifiers, so a module under
 * test has to be a leaf. `publicApplicationForm.test.ts` imports BOTH modules and asserts the
 * numbers are equal, so the duplication cannot drift silently — the agreement is enforced, just
 * one layer out. All four values also mirror the agent's server-side caps and the DB CHECKs; this
 * layer is a courtesy in every case, never the enforcement.
 */

export const MAX_CONTACT = 200;
export const MAX_NAME = 120;
export const MAX_REASON = 2000;

/** A 20-byte hex address. Case-insensitive: we do NOT require a checksummed string, because a user
 *  pasting from a block explorer or typing by hand should not be rejected over capitalisation. The
 *  server lowercases it (the DB has a `lower()` CHECK). */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Addresses that are never a real applicant — the zero address and the classic dead-burn one. */
const NON_WALLETS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

export interface PublicApplicationDraft {
  readonly address: string;
  readonly contact: string;
  readonly name: string;
  readonly reason: string;
  /** Honeypot. A real person leaves this empty; a naive bot fills every input it finds. */
  readonly website: string;
}

export const EMPTY_PUBLIC_DRAFT: PublicApplicationDraft = {
  address: "",
  contact: "",
  name: "",
  reason: "",
  website: "",
};

export interface PublicDraftValidation {
  readonly valid: boolean;
  /** Field-keyed messages — only the fields that are actually wrong. */
  readonly errors: Partial<Record<keyof PublicApplicationDraft, string>>;
}

/** True for a syntactically valid, non-placeholder wallet address (whitespace tolerated). */
export function isWalletAddress(value: string): boolean {
  const trimmed = value.trim();
  return ADDRESS_RE.test(trimmed) && !NON_WALLETS.has(trimmed.toLowerCase());
}

/**
 * `tooShort` exists because "A reason for access is required." is a lie when the field says "pls".
 * The applicant did answer; the answer was too thin. Telling them it is missing sends them looking
 * for a field they already filled in.
 */
function checkField(
  value: string,
  cap: number,
  label: string,
  minLength = 1,
  tooShort?: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} is required.`;
  if (trimmed.length < minLength) return tooShort ?? `${label} is required.`;
  if (trimmed.length > cap) return `${label} must be ${cap} characters or fewer.`;
  return undefined;
}

/**
 * Why the address message is worded the way it is: someone pasting the wrong thing here has almost
 * always pasted a transaction hash, an ENS name, or their exchange's deposit tag. Telling them the
 * shape we need ("0x… 42 characters") is actionable; "invalid address" is not.
 */
function checkAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Your wallet address is required.";
  if (!/^0x/i.test(trimmed)) return "A wallet address starts with 0x.";
  if (!ADDRESS_RE.test(trimmed)) {
    return "That doesn't look like a wallet address — it should be 0x followed by 40 characters.";
  }
  if (NON_WALLETS.has(trimmed.toLowerCase())) return "That address can't hold an alpha invite.";
  return undefined;
}

export function validatePublicDraft(draft: PublicApplicationDraft): PublicDraftValidation {
  const errors: Partial<Record<keyof PublicApplicationDraft, string>> = {};
  const address = checkAddress(draft.address);
  const contact = checkField(draft.contact, MAX_CONTACT, "A contact handle");
  const name = checkField(draft.name, MAX_NAME, "A name or alias");
  // A one-character "reason" is not a reason; ask for a sentence rather than silently accepting
  // noise. Same threshold as the signed-in form.
  const reason = checkField(
    draft.reason,
    MAX_REASON,
    "A reason for access",
    10,
    "Please tell us a little more — a sentence or two is plenty.",
  );
  if (address) errors.address = address;
  if (contact) errors.contact = contact;
  if (name) errors.name = name;
  if (reason) errors.reason = reason;
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Whether the honeypot was filled. Never surfaced to the user — see the route handler. */
export function looksAutomated(draft: PublicApplicationDraft): boolean {
  return draft.website.trim().length > 0;
}

export interface PublicSubmitBody {
  readonly address: string;
  readonly contact: string;
  readonly name: string;
  readonly reason: string;
}

/** The exact JSON body `POST /api/access/apply` expects (trimmed; the honeypot is not sent). */
export function toPublicSubmitBody(draft: PublicApplicationDraft): PublicSubmitBody {
  return {
    address: draft.address.trim(),
    contact: draft.contact.trim(),
    name: draft.name.trim(),
    reason: draft.reason.trim(),
  };
}

/**
 * The message shown after a submission.
 *
 * ⚠️ There is exactly ONE success message, and it must stay that way. The server answers
 * identically whether the application is new, a duplicate, or for an address that is already
 * approved — telling them apart here would rebuild, in the client, the enumeration oracle the
 * server refuses to be. "We've got it, an admin will review it" is true in every one of those
 * cases.
 */
export const SUBMITTED_MESSAGE =
  "Thanks — your application is in. An admin reviews each one by hand, and we'll reach you on the " +
  "contact you gave. You don't need to keep this page open.";

/** What to tell the applicant when the server refused. Never leaks which limit was hit. */
export function submitErrorMessage(status: number): string {
  if (status === 429) {
    return "That's a lot of applications from one place. Please try again a little later.";
  }
  if (status === 400) return "Please check the details above and try again.";
  return "Couldn't submit your application right now. Please try again in a moment.";
}
