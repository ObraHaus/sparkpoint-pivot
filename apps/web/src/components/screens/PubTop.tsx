"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Icon, SparkMark } from "@/lib/icons";

/** Shared public top bar — brand + theme toggle + nav links + Connect wallet. */
export function PubTop() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is undefined until next-themes resolves on the client; both
  // SSR and the first client render see undefined, so there's no mismatch.
  const isDark = resolvedTheme === "dark";

  return (
    <div className="pubtop">
      <div className="brand" style={{ cursor: "pointer" }} onClick={() => router.push("/")}>
        <SparkMark size={23} />
        SparkPoint
      </div>
      <div className="grow"></div>
      <button
        className="pub-themebtn"
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        suppressHydrationWarning
      >
        <Icon name={isDark ? "sun" : "moon"} size={17} stroke={1.8} />
      </button>
      <a className="publink" onClick={() => router.push("/")}>
        How it works
      </a>
      <a className="publink" onClick={() => router.push("/")}>
        Trust
      </a>
      <a className="publink" onClick={() => router.push("/")}>
        Security
      </a>
      <button className="btn btn-primary btn-md" onClick={() => router.push("/connect")}>
        Connect wallet
      </button>
    </div>
  );
}
