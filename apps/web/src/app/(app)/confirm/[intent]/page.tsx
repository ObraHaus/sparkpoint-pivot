import { Suspense } from "react";
import { ConfirmFlow, type ConfirmIntent } from "@/components/ui/ConfirmFlow";
import { RouteConfirm } from "./RouteConfirm";

const INTENTS = new Set<ConfirmIntent>(["deposit", "withdraw", "swap", "premium", "bridge"]);

/** /confirm/[intent] — the trust gate as a full route (FR-054). Resolves the `intent` route param
 * (a Promise in Next 16), then hands off to the client {@link RouteConfirm}, which threads the
 * `?assets=`/`?shares=`/`?vault=` amount context (the SAME amount the chat inline card carries) into
 * the SAME `useVaultConfirm` → <ConfirmFlow onchain> real gate. One gate, two mount points. The
 * Suspense boundary is required because RouteConfirm reads `useSearchParams`. */
export default async function Page({ params }: { params: Promise<{ intent: string }> }) {
  const { intent } = await params;
  const safe: ConfirmIntent = INTENTS.has(intent as ConfirmIntent) ? (intent as ConfirmIntent) : "deposit";
  return (
    <Suspense
      fallback={
        <div className="page">
          <ConfirmFlow intent={safe} mount="route" />
        </div>
      }
    >
      <RouteConfirm intent={safe} />
    </Suspense>
  );
}
