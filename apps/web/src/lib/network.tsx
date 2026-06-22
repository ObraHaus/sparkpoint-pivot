"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { data, type Network, type NetworkId } from "@/lib/mock-data";

/**
 * Active-network + mock-session context. Switching the network swaps the displayed
 * wallet address across the shell (mirrors the design's `syncNetwork`). No real
 * connection — purely UI state for this build.
 */
interface NetworkContextValue {
  networks: Network[];
  activeNetwork: NetworkId;
  network: Network;
  wallet: string;
  setActiveNetwork: (id: NetworkId) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [activeNetwork, setActiveNetwork] = useState<NetworkId>(data.activeNetwork);

  const value = useMemo<NetworkContextValue>(() => {
    const network = data.networks.find((n) => n.id === activeNetwork) ?? data.networks[0];
    return {
      networks: data.networks,
      activeNetwork,
      network,
      wallet: network.wallet,
      setActiveNetwork,
    };
  }, [activeNetwork]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
  return ctx;
}
