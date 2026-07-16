"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import type { Network, NetworkId } from "@/lib/mock-data";

/**
 * Real connected-network + wallet context for the app shell (Phase B).
 *
 * Backed by wagmi `useAccount` — NOT mock data. Exposes the actually-connected address (or an
 * honest disconnected state), the real chain, an explorer base, and real disconnect / chain-switch
 * actions. Sui is shown as a documented fast-follow (NOT "live") — the earlier mock marked it live.
 */

const SUPPORTED = new Set<number>([base.id, baseSepolia.id]);
const EXPLORER: Record<number, string> = {
  [base.id]: "https://basescan.org",
  [baseSepolia.id]: "https://sepolia.basescan.org",
};
/** The chain the develop vault lives on — where an off-network wallet is prompted to switch. */
const PREFERRED_CHAIN = baseSepolia;

/** Honest display list for the network menu. Base is live; Sui is a fast-follow, not live. */
const NETWORKS: Network[] = [
  { id: "base", name: "Base", color: "#0052FF", live: true, wallet: "" },
  { id: "sui", name: "Sui", color: "#4DA8FF", live: false, wallet: "" },
];

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "Not connected");

function chainName(chainId?: number): string {
  if (chainId === base.id) return "Base";
  if (chainId === baseSepolia.id) return "Base Sepolia";
  return "Unsupported network";
}

interface NetworkContextValue {
  networks: Network[];
  activeNetwork: NetworkId;
  /** The active network for display (name reflects the REAL connected chain). */
  network: Network;
  /** Short connected address, or "Not connected". */
  wallet: string;
  /** The full connected address (undefined when disconnected). */
  address?: `0x${string}`;
  isConnected: boolean;
  chainId?: number;
  /** True iff connected to Base or Base Sepolia. */
  onSupportedChain: boolean;
  /** Basescan base URL for the active chain (defaults to Base Sepolia when off-network). */
  explorerBase: string;
  /** Kept for compatibility; only "base" is selectable (Sui is a fast-follow). */
  setActiveNetwork: (id: NetworkId) => void;
  /** Prompt the wallet to switch to the supported develop chain. */
  switchToBase: () => void;
  /** Real wagmi disconnect + server session logout. */
  disconnectWallet: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnectAsync();
    } finally {
      // End the server session too, so the middleware no longer treats this browser as signed in.
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    }
  }, [disconnectAsync]);

  const switchToBase = useCallback(() => {
    switchChain({ chainId: PREFERRED_CHAIN.id });
  }, [switchChain]);

  const value = useMemo<NetworkContextValue>(() => {
    const onSupportedChain = chainId !== undefined && SUPPORTED.has(chainId);
    const network: Network = {
      id: "base",
      name: chainName(chainId),
      color: onSupportedChain ? "#0052FF" : "#f59e0b",
      live: onSupportedChain,
      wallet: "",
    };
    return {
      networks: NETWORKS,
      activeNetwork: "base",
      network,
      wallet: isConnected ? short(address) : "Not connected",
      address,
      isConnected,
      chainId,
      onSupportedChain,
      explorerBase: (chainId && EXPLORER[chainId]) || EXPLORER[PREFERRED_CHAIN.id],
      setActiveNetwork: () => undefined,
      switchToBase,
      disconnectWallet,
    };
  }, [address, chainId, isConnected, switchToBase, disconnectWallet]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
  return ctx;
}
