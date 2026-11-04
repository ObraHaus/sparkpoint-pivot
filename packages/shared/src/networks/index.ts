/**
 * Multi-network registry — the ONE place the product says which networks it supports and WHAT it
 * can actually do on each.
 *
 * WHY IT IS SEPARATE FROM `chains/`. `chains/index.ts` is the EVM chain-metadata registry (ids,
 * explorer roots, vault/switch capabilities) and must stay a dependency-free leaf. This registry is
 * the USER-FACING story across families — Base, Ethereum, Solana, NEAR, Bitcoin and Robinhood Chain
 * — including destination-only networks that have no wallet connector at all. Capability flags are
 * deliberately explicit so copy never promises more than the build wires.
 *
 * LEAF RULE: no imports. `apps/web` unit tests value-import this under
 * `node --experimental-strip-types`, which cannot resolve extensionless relative specifiers. Chain
 * ids are repeated here on purpose; `chains/index.ts` remains the authority for EVM ids and a web
 * parity test pins the overlap.
 */

export type NetworkKind = "evm" | "solana" | "near" | "bitcoin";

/** What the current product can honestly do on a network. */
export interface NetworkCapabilities {
  /** A wallet connector is wired in this build (browser/EVM or the NEAR client claim). */
  readonly connect: boolean;
  /** The app can send an origin asset from the user's own wallet (cross-chain source). */
  readonly sendFromWallet: boolean;
  /** A cross-chain swap can deliver funds here (paste/prefilled address). */
  readonly receiveDestination: boolean;
  /** The in-app swap page quotes this network. */
  readonly swap: boolean;
  /** A SparkPoint vault is offered here. */
  readonly vault: boolean;
  /** Read-only portfolio data is available here. */
  readonly portfolio: boolean;
}

export interface NetworkInfo {
  /** Stable short id (`base`, `ethereum`, `solana`, `near`, `bitcoin`, `robinhood`). */
  readonly id: string;
  readonly kind: NetworkKind;
  /** The only user-visible name for this network. */
  readonly label: string;
  /** EVM chain id; omitted for non-EVM families. */
  readonly chainId?: number;
  readonly color: string;
  readonly testnet: boolean;
  /** True when the only honest action is pasting a destination address. */
  readonly destinationOnly: boolean;
  readonly capabilities: NetworkCapabilities;
}

const caps = (over: Partial<NetworkCapabilities> = {}): NetworkCapabilities => ({
  connect: false,
  sendFromWallet: false,
  receiveDestination: false,
  swap: false,
  vault: false,
  portfolio: false,
  ...over,
});

export const NETWORKS: readonly NetworkInfo[] = [
  {
    id: "base",
    kind: "evm",
    label: "Base",
    chainId: 8453,
    color: "#0052FF",
    testnet: false,
    destinationOnly: false,
    // Registered as a SOURCE chain in the beta build so USDC can be sent from a Base wallet.
    capabilities: caps({
      connect: true,
      sendFromWallet: true,
      receiveDestination: true,
      swap: true,
      portfolio: true,
    }),
  },
  {
    id: "ethereum",
    kind: "evm",
    label: "Ethereum",
    chainId: 1,
    color: "#627EEA",
    testnet: false,
    destinationOnly: false,
    // No connector registered in this build; it is a cross-chain source/destination via 1Click.
    capabilities: caps({ receiveDestination: true, portfolio: true }),
  },
  {
    id: "solana",
    kind: "solana",
    label: "Solana",
    color: "#9945FF",
    testnet: false,
    destinationOnly: false,
    capabilities: caps({ receiveDestination: true, swap: true, portfolio: true }),
  },
  {
    id: "near",
    kind: "near",
    label: "NEAR",
    color: "#00EC97",
    testnet: false,
    destinationOnly: false,
    // Client-side NEAR wallet claim (Meteor) + cross-chain recipient. Never server sign-in.
    capabilities: caps({
      connect: true,
      receiveDestination: true,
      swap: true,
      portfolio: true,
    }),
  },
  {
    id: "bitcoin",
    kind: "bitcoin",
    label: "Bitcoin",
    color: "#F7931A",
    testnet: false,
    destinationOnly: true,
    capabilities: caps({ receiveDestination: true }),
  },
  {
    id: "robinhood",
    kind: "evm",
    label: "Robinhood Chain",
    chainId: 4663,
    color: "#00C805",
    testnet: false,
    destinationOnly: false,
    capabilities: caps({
      connect: true,
      sendFromWallet: true,
      receiveDestination: true,
      swap: true,
      portfolio: true,
    }),
  },
  {
    id: "baseSepolia",
    kind: "evm",
    label: "Base Sepolia",
    chainId: 84532,
    color: "#0052FF",
    testnet: true,
    destinationOnly: false,
    capabilities: caps({ connect: true, swap: true, vault: true, portfolio: true }),
  },
];

/** The networks worth showing as "supported" (testnets excluded from the public story). */
export const PUBLIC_NETWORKS: readonly NetworkInfo[] = NETWORKS.filter((n) => !n.testnet);

/** Label for a network id, or the id itself when unknown (never a fabricated name). */
export function networkLabel(id: string): string {
  return NETWORKS.find((n) => n.id === id)?.label ?? id;
}

/** "Base · Ethereum · Solana · NEAR · Bitcoin · Robinhood Chain" — registry order. */
export function networkNames(
  networks: readonly NetworkInfo[] = PUBLIC_NETWORKS,
  separator = " · ",
): string {
  return networks.map((n) => n.label).join(separator);
}

/** The honest "you can paste an address here" list. */
export function destinationNetworks(): readonly NetworkInfo[] {
  return PUBLIC_NETWORKS.filter((n) => n.capabilities.receiveDestination);
}

/** The networks a wallet can connect to in this build. */
export function connectableNetworks(): readonly NetworkInfo[] {
  return PUBLIC_NETWORKS.filter((n) => n.capabilities.connect);
}
