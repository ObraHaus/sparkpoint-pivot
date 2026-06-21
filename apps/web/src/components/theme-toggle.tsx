"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Light/dark toggle — matches the design's user-menu row.
 * Persists via next-themes (shared `sp-theme` key) so app/admin/onboarding stay in sync.
 * Icon/label/switch are driven purely by the `.dark` class (CSS) — no JS state, so there's
 * no hydration mismatch and no flash. Shows the CURRENT theme (sun = light, moon = dark).
 */
export function ThemeToggle({ variant = "row" }: { variant?: "row" | "icon" }) {
  const { setTheme } = useTheme();
  const toggle = () =>
    setTheme(document.documentElement.classList.contains("light") ? "dark" : "light");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle light or dark theme"
        title="Toggle light / dark theme"
        className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-primary hover:text-foreground"
      >
        <Sun size={16} className="dark:hidden" />
        <Moon size={16} className="hidden dark:block" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-foreground transition hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Sun size={16} className="dark:hidden" />
        <Moon size={16} className="hidden dark:block" />
        <span className="dark:hidden">Light mode</span>
        <span className="hidden dark:inline">Dark mode</span>
      </span>
      <span aria-hidden className="relative h-5 w-9 rounded-full bg-primary transition dark:bg-input">
        <span className="absolute top-0.5 left-[18px] size-4 rounded-full bg-white transition-all dark:left-0.5" />
      </span>
    </button>
  );
}
