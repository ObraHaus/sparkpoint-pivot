"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

const STEPS: [string, string][] = [
  ["Wallet connected", "0x12A4…b9Ef"],
  ["On Base network", "confirmed"],
  ["Whitelist (beta)", "passed"],
];

export default function VerifyPage() {
  const router = useRouter();
  // How many steps are visible, and how many of those have resolved to a check.
  const [visible, setVisible] = useState(0);
  const [resolved, setResolved] = useState(0);
  const done = resolved >= STEPS.length;

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function go(i: number) {
      if (i >= STEPS.length) return;
      // Append the row (showing the spinning dot).
      setVisible(i + 1);
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          // Resolve this row to a green check + value.
          setResolved(i + 1);
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              go(i + 1);
            }, 460),
          );
        }, 620),
      );
    }

    go(0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="pubwrap">
      <PubTop />
      <div className="center-stage">
        <div className="connect-card" style={{ textAlign: "center" }}>
          <div className="verify-anim" id="vanim">
            {done ? (
              <span style={{ color: "var(--gain)" }}>
                <Icon name="check" size={30} stroke={2.5} />
              </span>
            ) : (
              <span className="ai-dot"></span>
            )}
          </div>
          <h2 id="vtitle" style={{ fontSize: "20px", fontWeight: 600, margin: "18px 0 6px" }}>
            {done ? "You're in." : "Checking your access…"}
          </h2>
          <p id="vsub" style={{ fontSize: "13.5px", color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
            {done
              ? "Let's build your plan — it takes about 3 minutes."
              : "SparkPoint is in beta — confirming your wallet is whitelisted on Base."}
          </p>
          <div
            id="vsteps"
            style={{ margin: "20px 0 4px", textAlign: "left", maxWidth: "280px", marginInline: "auto" }}
          >
            {STEPS.slice(0, visible).map(([label, value], i) => {
              const isResolved = i < resolved;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "6px 0",
                    fontSize: "13px",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {isResolved ? (
                    <span style={{ color: "var(--gain)" }}>
                      <Icon name="check" size={15} stroke={2.5} />
                    </span>
                  ) : (
                    <span className="ai-dot"></span>
                  )}
                  <span style={{ flex: 1 }}>
                    {isResolved ? (
                      <>
                        {label} · <span className="mono" style={{ color: "var(--foreground)" }}>{value}</span>
                      </>
                    ) : (
                      label
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div id="vcta">
            {done && (
              <>
                <a
                  className="btn btn-primary btn-lg"
                  onClick={() => router.push("/onboarding")}
                  style={{ marginTop: "18px", display: "inline-flex", cursor: "pointer" }}
                >
                  Start onboarding
                </a>
                <div style={{ marginTop: "10px" }}>
                  <a className="btn btn-ghost btn-sm" onClick={() => router.push("/chat")} style={{ cursor: "pointer" }}>
                    Skip to app (demo)
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
