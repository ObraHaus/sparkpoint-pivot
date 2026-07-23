"use client";

/**
 * captureNetworkDiagnostic — one-shot capture of what the browser + wallet actually report at the SIWE
 * access gate, so a "wrong network" report we cannot reproduce becomes a concrete data point.
 *
 * It answers the two questions the /verify gate can't:
 *   1. What chain does the WALLET itself think it is on (`eth_chainId`, the ground truth) vs the chainId
 *      wagmi surfaced? A mismatch means wagmi is bound to a stale / other provider.
 *   2. How many injected wallets are present (EIP-6963), and is `window.ethereum` MetaMask? Multiple
 *      injected providers is the tell for the multi-wallet mis-binding root cause.
 *
 * Fire-and-forget + fully guarded: it never throws, never blocks the UI, and does nothing but READ
 * browser state (an `eth_chainId` read + an EIP-6963 re-announce) and POST a log line. Non-custodial —
 * it moves no funds, touches no keys, and cannot change the access verdict.
 */

export type NetDiagReason = "off-network" | "signin-attempt";

export interface WagmiSnapshot {
  chainId?: number;
  status?: string;
  isConnected?: boolean;
  connectorId?: string;
  connectorName?: string;
  address?: string;
}

// The auto-fired "off-network" capture can re-render many times — dedupe it to one line per page load
// (a full reload IS the "capture again" gesture, and it clears this set). The user-initiated
// "signin-attempt" is NOT deduped, so "have them log in again" reliably produces a fresh capture.
const DEDUP: ReadonlySet<NetDiagReason> = new Set<NetDiagReason>(["off-network"]);
const sent = new Set<NetDiagReason>();

interface Eip6963ProviderInfo {
  name?: string;
  rdns?: string;
}

/** Synchronously re-run EIP-6963 discovery to count/name the injected wallets present right now. */
function discoverInjectedProviders(): { count: number; names: string[] } {
  const found = new Map<string, Eip6963ProviderInfo>();
  try {
    const onAnnounce = (event: Event) => {
      const info = (event as CustomEvent).detail?.info as Eip6963ProviderInfo | undefined;
      if (info?.rdns) found.set(info.rdns, info);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    // Providers respond to this request synchronously, so listeners have already run by the next line.
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  } catch {
    /* best-effort discovery */
  }
  return {
    count: found.size,
    names: Array.from(found.values()).map((i) => i.name ?? i.rdns ?? "unknown"),
  };
}

/** The wallet's OWN view of the current chain — the ground truth to compare against wagmi's chainId. */
async function readWalletChainId(): Promise<number | null> {
  try {
    const eth = (window as unknown as { ethereum?: { request?: (a: { method: string }) => Promise<unknown> } }).ethereum;
    if (!eth?.request) return null;
    const hex = (await eth.request({ method: "eth_chainId" })) as string;
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function captureNetworkDiagnostic(reason: NetDiagReason, snap: WagmiSnapshot): Promise<void> {
  if (typeof window === "undefined") return;
  if (DEDUP.has(reason)) {
    if (sent.has(reason)) return;
    sent.add(reason);
  }
  try {
    const eth = (window as unknown as { ethereum?: { isMetaMask?: boolean; providers?: unknown[] } }).ethereum;
    const walletChainId = await readWalletChainId();
    const eip6963 = discoverInjectedProviders();

    const payload = {
      reason,
      // What wagmi surfaced to the gate.
      wagmi: snap,
      // The wallet's own truth — `walletChainId` supported while `wagmi.chainId` isn't localises the fault.
      walletChainId,
      walletChainIdMatchesWagmi: walletChainId != null && walletChainId === snap.chainId,
      wallet: {
        isMetaMask: Boolean(eth?.isMetaMask),
        // A non-empty legacy `.providers` array (or >1 eip6963 provider) is the multi-wallet smoking gun.
        legacyProvidersCount: Array.isArray(eth?.providers) ? eth.providers.length : 0,
      },
      eip6963,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      at: new Date().toISOString(),
    };

    // Surface it in the STUCK user's own devtools so they can read/screenshot it too.
    console.warn("[SparkPoint net-debug]", payload);

    // keepalive so the POST survives the /verify → /connect redirect; fetch (not sendBeacon) because
    // the route reads JSON. Fire-and-forget — a failed beacon must never surface to the user.
    void fetch("/api/debug/network", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Instrumentation must never break the page.
  }
}
