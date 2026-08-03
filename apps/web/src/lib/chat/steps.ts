/**
 * steps — deciding which progress rows a finished turn still deserves.
 *
 * WHY THIS EXISTS (029). The agent streams each stage twice: `tool_step(label, "running")` and
 * then `tool_step(label, "done")`. The chat appended both, so a finished turn kept a permanent,
 * DUPLICATED trace above its answer — "Understanding your request" twice, "Reading your portfolio"
 * twice — and the answer itself was pushed down the screen. In the Aug-3 battery this made short
 * replies look like long ones and made the transcript read as a log rather than a conversation.
 *
 * Two rules, both here so they can be unit-tested without a browser:
 *
 *  1. one row per stage — the LAST status for a label wins (`done` supersedes `running`);
 *  2. once the turn is no longer streaming, a run of finished stages collapses behind a single
 *     summary line, so the answer leads.
 *
 * A stage that ERRORED is never collapsed: that one is the point.
 *
 * Leaf module: no imports, no React.
 */

export type StepStatus = "running" | "done" | "error";

/** The projection this module needs from a rendered card. */
export interface TranscriptItem {
  /** The block type, e.g. `"tool_step"` or `"text"`. */
  readonly type: string;
  /** Present on `tool_step` items. */
  readonly label?: string;
  /** Present on `tool_step` items. */
  readonly status?: StepStatus;
}

/** A single non-step card, rendered as-is at its original position. */
export interface CardPlan {
  readonly kind: "card";
  readonly index: number;
}

/** A consecutive run of progress rows, already deduplicated. */
export interface StepsPlan {
  readonly kind: "steps";
  /** Indices into the original array, one per distinct stage, in order. */
  readonly indices: readonly number[];
  /** Whether this group should render behind a summary line rather than expanded. */
  readonly collapsed: boolean;
  /** The summary line to show when collapsed. */
  readonly summary: string;
}

export type TranscriptPlan = CardPlan | StepsPlan;

/** "Worked through 3 steps" — the line a collapsed group shows. */
export function stepsSummary(count: number): string {
  if (count <= 1) return "Worked through 1 step";
  return `Worked through ${count} steps`;
}

/**
 * How to render one turn's blocks.
 *
 * Order is preserved exactly: groups sit where their steps were, so a turn that thinks, answers,
 * then thinks again still reads in that order. Deduplication keeps the LAST occurrence of a label
 * (its final status) at the position of that occurrence.
 */
export function planTranscript(
  items: readonly TranscriptItem[],
  { streaming }: { streaming: boolean },
): TranscriptPlan[] {
  const plan: TranscriptPlan[] = [];
  let group: number[] | null = null;

  const flush = () => {
    if (!group) return;
    const hasError = group.some((i) => items[i]?.status === "error");
    // While the turn is live the trace IS the feedback — keep it visible. A stage that failed
    // stays visible afterwards too, because that is exactly what the user needs to see.
    const collapsed = !streaming && !hasError && group.length > 0;
    plan.push({
      kind: "steps",
      indices: group,
      collapsed,
      summary: stepsSummary(group.length),
    });
    group = null;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.type !== "tool_step") {
      flush();
      plan.push({ kind: "card", index: i });
      continue;
    }
    // Drop this row if the same stage appears again later in the SAME run — the later one
    // carries the final status.
    let superseded = false;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if (next?.type !== "tool_step") break;
      if (next.label === item.label) {
        superseded = true;
        break;
      }
    }
    if (superseded) continue;
    group = group ?? [];
    group.push(i);
  }
  flush();
  return plan;
}
