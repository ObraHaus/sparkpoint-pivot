import { redirect } from "next/navigation";

/**
 * 032 — `/admin/updates` moved INTO the consolidated knowledge console.
 *
 * Kept as a redirect for the same reason as `/admin/tips`: every existing bookmark and admin-index
 * link keeps working, and the panel itself has exactly one home.
 */
export default function Page() {
  redirect("/admin/knowledge?section=updates");
}
