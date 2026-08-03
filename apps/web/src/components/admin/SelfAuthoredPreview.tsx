"use client";

/**
 * 032 — the Self-authored section, as a PREVIEW ONLY.
 *
 * The client approved letting Sparky write research notes daily without prior approval, into a
 * section an admin can read, edit and delete like any other. The retrieval groundwork for that
 * shipped in 031: the `self_authored` source kind exists, searches include it, and a citation to
 * one already announces itself as *"written by Sparky, not yet reviewed"*.
 *
 * The generation job itself is deliberately NOT built. It gets its own planning session, because
 * the questions that decide whether it is safe are design questions rather than coding ones —
 * what a note may be grounded in, what it may never claim, how a run that drifts is detected, and
 * what a reader is told when an answer leans on one. This panel exists so that conversation has
 * something concrete to point at.
 *
 * WHY IT IS WIRED TO NOTHING, EXPLICITLY. A mockup that quietly reads a real endpoint is how a
 * demo becomes a dependency by accident. This component makes no network call at all, the rows
 * below are fixed strings, and every control is disabled. The banner says so in the admin's own
 * words, because an admin who mistakes this for a live feature will assume notes are being
 * generated when none are.
 */

/** Illustrative rows. Fixed strings — nothing here is read from anywhere. */
const SAMPLE = [
  {
    title: "Aave USDC supply rate, week of 3 Aug",
    grounded: "Read from the Aave v3 pool on Base",
    written: "Daily run · 03 Aug 2026",
    body:
      "The USDC supply rate on Base moved from 0.44% to 0.51% gross over the week, driven by " +
      "higher utilisation. Every figure here is read from the pool contract at the time of the run.",
  },
  {
    title: "What changed in the vault this week",
    grounded: "Read from the published changelog",
    written: "Daily run · 02 Aug 2026",
    body:
      "Two user-facing changes shipped: the strategies screen now shows both options with their " +
      "fee stance, and plan summaries are derived rather than stored.",
  },
];

export function SelfAuthoredPreview() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          border: "1px solid color-mix(in srgb, var(--caution, #b8860b) 35%, transparent)",
          background: "color-mix(in srgb, var(--caution, #b8860b) 10%, transparent)",
          borderRadius: 10,
          padding: "14px 16px",
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview — nothing here is live yet</div>
        <p style={{ margin: 0 }}>
          This is a layout preview of where Sparky&apos;s own research notes will appear. It is
          connected to nothing: <strong>no notes are being generated</strong>, the rows below are
          fixed examples, and the controls are disabled. The generation job is being designed
          separately.
        </p>
        <p style={{ margin: "8px 0 0" }}>
          What already works: notes written here would be searchable alongside your documentation,
          and a citation to one already identifies itself as{" "}
          <em>&ldquo;written by Sparky, not yet reviewed&rdquo;</em> — so a reader can always tell
          Sparky&apos;s own research from something a person wrote and checked.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" disabled title="Not built yet">
          Run now
        </button>
        <button className="btn btn-outline btn-sm" disabled title="Not built yet">
          Pause daily run
        </button>
        <span style={{ fontSize: 12.5, opacity: 0.7 }}>
          Last run: — · Next run: — · Notes: 0
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SAMPLE.map((note) => (
          <article
            key={note.title}
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              padding: "14px 16px",
              // Visibly inert: this is an example, not a record.
              opacity: 0.62,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14.5 }}>{note.title}</strong>
              <span style={{ fontSize: 11.5, opacity: 0.8 }}>Example</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, margin: "4px 0 8px" }}>
              {note.written} · Grounded in: {note.grounded}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{note.body}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-outline btn-sm" disabled>
                Edit
              </button>
              <button className="btn btn-ghost btn-sm" disabled>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      <div style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.6 }}>
        Two constraints are already settled for whenever this is built: every note must be grounded
        in something <strong>fetched during that run</strong>, and a run must not read previously
        self-authored notes as input — a loop that reads its own output drifts, confidently and in
        one direction.
      </div>
    </div>
  );
}
