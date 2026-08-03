import { redirect } from "next/navigation";

/**
 * 032 — `/admin/tips` moved INTO the consolidated knowledge console.
 *
 * The route is kept rather than deleted: bookmarks, the admin index and anything an operator has
 * written down all still resolve. A redirect (not a copy of the panel) so there is exactly one
 * place the tips UI lives and no chance of the two drifting apart.
 */
export default function Page() {
  redirect("/admin/knowledge?section=tips");
}
