/**
 * GuardrailCheck — one row of the confirmation checklist (§2.5). Statuses map
 * 1:1 to the six guardrails (G1–G6) + the recipient check (N1). Closed wire ⇒
 * `.strict()`.
 */

import { z } from "zod/v3";

/** §2.5 — `pass` | `fail` | `warn`. */
export const GuardrailStatusSchema = z.enum(["pass", "fail", "warn"]);
export type GuardrailStatus = z.infer<typeof GuardrailStatusSchema>;

export const GuardrailCheckSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    status: GuardrailStatusSchema,
    /** e.g. the concrete allowlisted target address; not every check carries one. */
    detail: z.string().optional(),
  })
  .strict();
export type GuardrailCheck = z.infer<typeof GuardrailCheckSchema>;
