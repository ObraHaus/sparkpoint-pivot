"use client";

import { useTheme } from "next-themes";
import { Icon } from "@/lib/icons";

/**
 * Shared light/dark toggle for the public + entry-flow chrome, wired to
 * next-themes (class on <html>, key `sp-theme`). resolvedTheme is undefined
 * until next-themes resolves on the client; both SSR and the first client
 * render see undefined, so there's no hydration mismatch.
 */
export function ThemeToggle({ className = "pub-themebtn" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      className={className}
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      suppressHydrationWarning
    >
      <Icon name={isDark ? "sun" : "moon"} size={17} stroke={1.8} />
    </button>
  );
}
