import "@/components/screens/admin.css";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Admin layout — SERVER-SIDE admin gate (defense-in-depth with the middleware, Phase B item #8).
 *
 * A non-admin — including any unauthenticated visitor or a beta-but-not-admin wallet — gets a real
 * 404 (never a 403). The admin surface must be invisible: nobody without an admin session can even
 * confirm it exists. Every admin API route enforces the same check server-side independently.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims?.admin) notFound();
  return <AdminShell>{children}</AdminShell>;
}
