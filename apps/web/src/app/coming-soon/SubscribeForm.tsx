"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

// Newsletter subscribe form for the Coming soon CTA funnel. Ported from the
// landing's "05 — Fully self-custodial" block (same /api/subscribe → Mailjet
// proxy, same email validation + submitting/success/error states), restyled for
// the dark coming-soon surface. A client component so the page.tsx server
// component can keep exporting `metadata`; /api/subscribe is gate-allow-listed,
// so it works while the construction gate is on.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) throw new Error("provider");
      setStatus("success");
    } catch {
      setError("Something went wrong — please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="cs-done">
        <p className="cs-sub-done" role="status">
          Thanks — check your inbox to confirm your subscription.
        </p>
        {/* Post-subscribe, offer a way back to the landing. prefetch={false} so
            the lean coming-soon route doesn't pull the heavy Three.js landing
            chunk until the user clicks; `/` is gate-allow-listed. */}
        <Link className="cs-home-btn" href="/" prefetch={false}>
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <form className="cs-sub" onSubmit={onSubmit} noValidate>
      <label className="cs-sub-label" htmlFor="cs-news">
        Get launch updates
      </label>
      <div className="cs-sub-row">
        <input
          id="cs-news"
          className="cs-sub-input"
          type="email"
          autoComplete="email"
          placeholder="you@email.com"
          aria-label="Email address"
          value={email}
          disabled={status === "submitting"}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
        />
        <button className="cs-btn" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Subscribing…" : "Subscribe"}
          <span className="cs-arrow" aria-hidden>
            <ArrowOut />
          </span>
        </button>
      </div>
      {status === "error" && (
        <p className="cs-sub-error" role="alert">
          {error}
        </p>
      )}
      <p className="cs-sub-consent">
        We&rsquo;ll only email launch updates. Unsubscribe anytime.
      </p>
    </form>
  );
}

function ArrowOut() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 17L17 7M17 7H8M17 7V16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
