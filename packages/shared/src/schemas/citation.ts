/**
 * Citation — a single provenance record surfaced under a rec/answer (§2.6).
 * Closed wire shape ⇒ `.strict()` (unknown keys rejected, fail-closed render).
 */

import { z } from "zod";

import { IsoDateTimeSchema } from "./primitives.js";

export const CitationSchema = z
  .object({
    provider: z.string(),
    endpoint: z.string(),
    field: z.string(),
    value: z.string(),
    asOf: IsoDateTimeSchema,
    stale: z.boolean(),
    /** Optional: on-chain sources (e.g. a Chainlink read) may carry no URL. */
    url: z.string().url().optional(),
  })
  .strict();
export type Citation = z.infer<typeof CitationSchema>;
