/**
 * 077 — live earn feature flags and the ONE shared route into the review+confirm flow.
 *
 * Both access points (the /vault page's earn rows and Sparky's earn card) build their links with
 * `liveEarnHref`, so they can never drift into two different flows. The flags are OFF by default:
 * a live deposit/withdraw surface only appears when the build explicitly opts in with
 * `NEXT_PUBLIC_EARN_LIVE_KAMINO` / `NEXT_PUBLIC_EARN_LIVE_MORPHO` / `NEXT_PUBLIC_EARN_LIVE_RHEA`
 * set to exactly "true". The server-side build proxy additionally requires `EARN_LIVE_KAMINO` /
 * `EARN_LIVE_MORPHO`, and the Rhea preflight/receipt routes require `EARN_LIVE_RHEA`. The flags are
 * independent and all default off.
 */

export type LiveEarnProtocol = "kamino" | "morpho" | "rhea";
export type LiveEarnMode = "deposit" | "withdraw";

/** True only for the exact string "true" (case/whitespace tolerant). Anything else is off. */
export function liveEarnEnabled(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** The build-time Kamino switch (Next inlines the `NEXT_PUBLIC_*` read). */
export function kaminoLiveEnabledFromEnv(): boolean {
  return liveEarnEnabled(process.env.NEXT_PUBLIC_EARN_LIVE_KAMINO);
}

/** The build-time Morpho switch (Next inlines the `NEXT_PUBLIC_*` read). */
export function morphoLiveEnabledFromEnv(): boolean {
  return liveEarnEnabled(process.env.NEXT_PUBLIC_EARN_LIVE_MORPHO);
}

/** The build-time Rhea switch (Next inlines the `NEXT_PUBLIC_*` read). Server gate stays separate. */
export function rheaLiveEnabledFromEnv(): boolean {
  return liveEarnEnabled(process.env.NEXT_PUBLIC_EARN_LIVE_RHEA);
}

/** True when the build has the live entry points for this protocol enabled. */
export function protocolLiveEnabled(protocol: LiveEarnProtocol): boolean {
  if (protocol === "kamino") return kaminoLiveEnabledFromEnv();
  if (protocol === "morpho") return morphoLiveEnabledFromEnv();
  return rheaLiveEnabledFromEnv();
}

/**
 * The server-side gate for the Kamino unsigned-tx proxy. Either the server flag or the public
 * build flag may enable it; default off. This function is for route handlers only — never render
 * its result to the client as a promise of execution.
 */
export function kaminoServerLiveEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return liveEarnEnabled(env.EARN_LIVE_KAMINO) || liveEarnEnabled(env.NEXT_PUBLIC_EARN_LIVE_KAMINO);
}

export interface LiveEarnLink {
  readonly protocol: LiveEarnProtocol;
  readonly chain?: string | null;
  readonly vault?: string | null;
  readonly mode?: LiveEarnMode;
  readonly amount?: string | null;
  readonly asset?: string | null;
}

/** `/vault/live?…` — the single review+confirm route. Empty values are omitted. */
export function liveEarnHref(input: LiveEarnLink): string {
  const params = new URLSearchParams();
  params.set("protocol", input.protocol);
  if (input.chain) params.set("chain", input.chain);
  if (input.vault) params.set("vault", input.vault);
  if (input.mode) params.set("mode", input.mode);
  if (input.amount) params.set("amount", input.amount);
  if (input.asset) params.set("asset", input.asset);
  return `/vault/live?${params.toString()}`;
}
