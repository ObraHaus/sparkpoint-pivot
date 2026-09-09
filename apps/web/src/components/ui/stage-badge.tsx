/**
 * StageBadge — the one badge that shows the product stage (Alpha on develop), from a single source
 * ({@link stageCopy}). Reuses the design's `.pill` chip. Purely informational; it does not gate
 * anything (the beta ACCESS gate is unrelated and server-anchored). R5 A4.
 */

import { stageCopy } from "@/lib/stage";

export function StageBadge({
  title,
  className = "pill",
  led = true,
}: {
  title?: string;
  className?: string;
  led?: boolean;
}) {
  return (
    <span
      className={className}
      title={title ?? stageCopy.long}
      style={{
        background: "color-mix(in srgb, var(--caution) 12%, transparent)",
        borderColor: "color-mix(in srgb, var(--caution) 32%, transparent)",
        color: "var(--caution)",
      }}
    >
      {led && <span className="led" style={{ background: "var(--caution)" }} />}
      {stageCopy.label}
    </span>
  );
}
