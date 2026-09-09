import { redirect } from "next/navigation";

/**
 * 035 — this screen is now a section of a console. A REDIRECT rather than a copy of the
 * panel: one home per screen, so the two can never drift apart, and every bookmark an
 * operator wrote down still lands in the right place.
 */
export default function Page() {
  redirect("/admin/system?section=diagnostics");
}
