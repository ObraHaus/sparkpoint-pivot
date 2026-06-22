"use client";

/**
 * /onboarding layout — a FOCUSED shell (NOT the app shell).
 *
 * Faithful 1:1 port of the onboarding chrome in docs/design-handover/showcase/
 * flows/Onboarding.html: a slim `.shell-top` with the brand spark-mark + name, a
 * "Fully self-custodial" trust pill, a Base pill, a wallet pill, and a
 * "Save & exit" control → "/".
 */

import { useRouter } from "next/navigation";
import { SparkMark } from "@/lib/icons";
import "@/components/screens/onboarding.css";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <div className="ob" id="ob">
      {/* shell */}
      <div className="shell-top">
        <span className="brand">
          <SparkMark />
          SparkPoint
        </span>
        <span className="grow" />
        <span
          className="pill"
          id="badgeNC"
          title="What SparkPoint can &amp; can't do"
          onClick={() =>
            alert(
              'Prove-it panel → opens the "What SparkPoint can & can\'t do" sheet (Trust Center). Wired in the shell build.',
            )
          }
        >
          <span className="led" />
          Fully self-custodial
        </span>
        <span className="pill pill-base">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#0052FF" />
            <path
              d="M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm-1.7 4.5c0-.94.76-1.7 1.7-1.7.6 0 1.13.31 1.44.78h1.06a2.7 2.7 0 1 0 0 1.84h-1.06a1.7 1.7 0 0 1-3.14-.92Z"
              fill="#fff"
            />
          </svg>
          Base
        </span>
        <span className="pill pill-wallet">
          <span className="mono">0x12…ab</span>
        </span>
        <button
          className="btn btn-ghost btn-sm save-exit"
          type="button"
          onClick={() => router.push("/")}
        >
          Save &amp; exit
        </button>
      </div>

      {children}
    </div>
  );
}
