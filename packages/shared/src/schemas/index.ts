/**
 * Zod wire schemas (T012) — the fail-closed mirror of agent-service-api.md §2.
 *
 * These validate every artifact crossing the Frontend ↔ Orchestrator seam so the
 * frontend's card rendering is fail-closed: unknown/invalid → reject (`.strict()`
 * on closed shapes; a non-null `userOp.signature` is rejected). Enums are reused
 * from the policy foundation (ActionType, Protocol, ReasonCode) — never redefined.
 *
 * Barrel re-exporting the primitives + the seven named schemas and their
 * inferred types.
 */
export * from "./primitives.js";
export * from "./action.js";
export * from "./citation.js";
export * from "./guardrail.js";
export * from "./simulation.js";
export * from "./policy-verdict.js";
export * from "./intent-bundle.js";
export * from "./chat-block.js";
