/**
 * /onboarding layout — a FOCUSED shell (NOT the app shell).
 *
 * Faithful to the design's onboarding chrome (docs/design-handover/showcase/flows/
 * Onboarding.html): a slim top bar with the brand, a "Fully self-custodial" trust
 * pill, a compact theme toggle, and a "Save & exit" link back home. Children render
 * centered in a max-width container so the stepped flow stays readable.
 */

import Link from "next/link";
import { SparkMark } from "@/components/spark-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Focused top bar */}
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border-soft px-5">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold">
          <SparkMark size={22} />
          <span>SparkPoint</span>
        </Link>

        <div className="flex-1" />

        {/* Trust pill — the non-custodial promise, always visible */}
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
          <span
            className="size-[7px] flex-none rounded-full bg-gain shadow-[0_0_0_3px_var(--gain-subtle)]"
            aria-hidden
          />
          Fully self-custodial
        </span>

        <ThemeToggle variant="icon" />

        <Link
          href="/"
          className="text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          Save &amp; exit
        </Link>
      </header>

      {/* Centered stepped flow */}
      <main className="flex flex-1 justify-center px-5 py-8">
        <div className="w-full max-w-[760px]">{children}</div>
      </main>
    </div>
  );
}
