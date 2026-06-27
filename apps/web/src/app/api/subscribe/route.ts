import { NextResponse } from "next/server";

// Newsletter subscribe proxy — feature 004-mailjet-subscribe.
//
// Server-side POST to the PUBLIC Mailjet subscription-widget endpoint, so the
// browser never calls mjt.lu cross-origin and no Mailjet API key is involved.
// The destination is fixed/server-controlled (no SSRF); Mailjet applies the
// list's double opt-in (it sends the confirmation email).
const SUBSCRIBE_URL =
  process.env.MAILJET_WIDGET_SUBSCRIBE_URL ??
  "https://14ij2.mjt.lu/wgt/14ij2/0r1n/subscribe?c=22cd210c";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const value = typeof email === "string" ? email.trim() : "";
  if (!EMAIL_RE.test(value)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The widget endpoint expects JSON; it returns 2xx for both new and
      // already-subscribed contacts.
      body: JSON.stringify({ email: value, consent: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "provider" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "provider" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
