import { notFound } from "next/navigation";

/**
 * Internal rewrite target for a denied /admin request (see `middleware.ts` → `deny404`). It always
 * calls `notFound()`, so the response is a real 404 (proper status + the app's not-found UI) while
 * the browser keeps the original /admin URL — the admin surface stays invisible to non-admins.
 */
export default function GateNotFound(): never {
  notFound();
}
