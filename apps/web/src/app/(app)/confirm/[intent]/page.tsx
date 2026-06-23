import { ConfirmFlow, type ConfirmIntent } from "@/components/ui/ConfirmFlow";

const INTENTS = new Set<ConfirmIntent>(["deposit", "withdraw", "swap", "premium", "bridge"]);

/** /confirm/[intent] — the trust gate as a full route. Reads the `intent` route param
 * (a Promise in Next 16) and renders the shared client ConfirmFlow inside `.page`. */
export default async function Page({ params }: { params: Promise<{ intent: string }> }) {
  const { intent } = await params;
  const safe: ConfirmIntent = INTENTS.has(intent as ConfirmIntent) ? (intent as ConfirmIntent) : "deposit";
  return (
    <div className="page">
      <ConfirmFlow intent={safe} mount="route" />
    </div>
  );
}
