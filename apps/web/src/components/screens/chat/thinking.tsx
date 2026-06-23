"use client";

/**
 * ThinkingTurn — the assistant "tool-step" thinking state.
 * Faithful port of the `thinking()` animation in chat.js: each step shows a pulsing
 * ai-dot + "<a>…", then flips to a green check + the past-tense "<b>" label. When every
 * step has resolved, the turn removes itself and `onDone` fires (revealing the answer).
 */

import { useEffect, useRef, useState } from "react";
import { SparkMark } from "@/lib/icons";

export interface ThinkStep {
  a: string;
  b: string;
}

export function ThinkingTurn({
  steps,
  onDone,
  onTick,
}: {
  steps: ThinkStep[];
  onDone: () => void;
  /** called as steps progress so the scroller can follow. */
  onTick?: () => void;
}) {
  // number of steps fully resolved; the step at `done` index is currently pending.
  const [done, setDone] = useState(0);
  const [gone, setGone] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let i = 0;
    function next() {
      if (i >= steps.length) {
        const t = window.setTimeout(() => {
          setGone(true);
          onDone();
        }, 240);
        timers.current.push(t);
        return;
      }
      // step i is now visible & pending
      onTick?.();
      const t = window.setTimeout(() => {
        i += 1;
        setDone(i);
        const t2 = window.setTimeout(next, 220);
        timers.current.push(t2);
      }, 480);
      timers.current.push(t);
    }
    next();
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;

  return (
    <div className="cturn ai">
      <div className="cav">
        <SparkMark size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="cname">SparkPoint AI</div>
        <div className="think">
          {steps.map((s, k) => {
            if (k > done) return null;
            const isDone = k < done;
            return (
              <div
                key={k}
                style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted-foreground)", padding: "3px 0" }}
              >
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="ai-dot" />
                )}
                <span>{isDone ? s.b : `${s.a}…`}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
