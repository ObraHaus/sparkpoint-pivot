"use client";

/**
 * 036 — the waiting state, while Sparky is still working.
 *
 * It used to be a pulsing dot and the word "Working…". That answers none of the three questions a
 * person actually has while they wait — *is it alive*, *what is it doing*, *how long has this been
 * going* — and a single static word for a turn that can take thirty seconds reads as a stall.
 *
 * Now: the brand mark animating, the step the agent says it is on, and a clock.
 *
 * THE STEP IS NOT INVENTED. It is the agent's own `tool_step` label — the same six strings that
 * become the trace above the finished answer. They were already on the wire and simply unused
 * while the turn was in flight, which is the whole reason this was possible in an afternoon.
 *
 * ACCESSIBILITY, and the part that is easy to get badly wrong: the live region announces the STEP
 * only. A clock ticking inside `aria-live` would make a screen reader read a number once a second
 * for the length of the turn — technically "accessible", practically unusable. The clock is
 * `aria-hidden`, and the elapsed time is offered once, in words, when the wait gets long.
 *
 * The animation honours `prefers-reduced-motion`: it stops, and the row still says everything it
 * needs to in text.
 */

import { useEffect, useState } from "react";

import { SparkMark } from "@/lib/icons";
import { currentStep, formatElapsed, reassurance, thinkingLabel, type StepLike } from "@/lib/chat/thinking";

export function ThinkingIndicator({ cards, startedAt }: { cards: readonly StepLike[]; startedAt: number }) {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    // A second is the right cadence: fast enough that the clock is visibly alive, slow enough that
    // it costs nothing. `Date.now()` is read in the tick rather than in render, which keeps the
    // component pure and keeps the React compiler happy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = Math.max(0, now - startedAt);
  const label = thinkingLabel(currentStep(cards));
  const note = reassurance(elapsed);

  return (
    <div className="think">
      <div className="thinking-row">
        <span className="thinking-mark" aria-hidden="true">
          <SparkMark size={18} className="" />
        </span>

        {/* The live region: the STEP, and nothing that changes every second. */}
        <span className="thinking-label" role="status" aria-live="polite">
          {label}
        </span>

        {/* The clock is decoration for a screen reader — the same fact is offered in words below
            once the wait is long enough to be worth mentioning. */}
        <span className="thinking-clock" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {note && (
        <div className="thinking-note" role="status" aria-live="polite">
          {note}
        </div>
      )}
    </div>
  );
}
