/**
 * Mock data — the single source of truth for every screen, mirroring the design's
 * `SP.data` (docs/design-handover/showcase/SparkPoint.html). No backend, wallet, AI,
 * or chain in this build; all figures are sample data.
 */

export type NetworkId = "base" | "sui";

export interface Network {
  id: NetworkId;
  name: string;
  live: boolean;
  color: string;
  wallet: string;
}

export interface Mandate {
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  name: string;
  goal: string;
  timeline: string;
  experience: string;
}

export interface Vault {
  name: string;
  netApy: number;
  supplyApy: number;
  fee: number;
  perfFee: number;
  shares: number;
  shareValue: number;
  accrued: number;
  risk: number;
  capUser: number;
  capUsed: number;
  tvl: number;
  tvlCap: number;
}

export interface Allocation {
  k: string;
  v: number;
  risk: number;
}

export interface Recommendation {
  id: string;
  rank: string;
  title: string;
  thesis: string;
  apy: number;
  risk: number;
  fit: string;
}

export interface Outcome {
  id: string;
  kind: "gain" | "loss";
  pnl: string;
  pct: string;
  win: string;
  from: string;
  cause: string;
  date: string;
}

export interface Notification {
  t: string;
  s: string;
  time: string;
  unread: boolean;
  icon: string;
}

export interface Tx {
  type: string;
  amt: string;
  usd: string;
  time: string;
  dir: "in" | "out";
}

export interface BridgeAsset {
  sym: string;
  base: number;
  sui: number;
}

export interface SessionKey {
  scopeVaults: string[];
  capWeekly: number;
  maxSlippageBps: number;
  expiry: string;
}

export interface MockData {
  wallet: string;
  networks: Network[];
  activeNetwork: NetworkId;
  bridgeAssets: BridgeAsset[];
  mandate: Mandate;
  netWorth: number;
  pnl: { abs: number; pct: number; window: string };
  idleUSDC: number;
  vault: Vault;
  allocation: Allocation[];
  series1M: number[];
  apyHist: number[];
  recs: Recommendation[];
  outcomes: Outcome[];
  notifications: Notification[];
  txs: Tx[];
  sessionKey: SessionKey | null;
}

export const data: MockData = {
  wallet: "0x12A4…b9Ef",
  networks: [
    { id: "base", name: "Base", live: true, color: "#0052FF", wallet: "0x12A4…b9Ef" },
    { id: "sui", name: "Sui", live: true, color: "#4DA8FF", wallet: "0x9c3f…7a2d" },
  ],
  activeNetwork: "base",
  bridgeAssets: [
    { sym: "USDC", base: 2150.0, sui: 480.0 },
    { sym: "ETH", base: 0.42, sui: 0 },
  ],
  mandate: { tier: 1, name: "Lower risk", goal: "Steady USDC yield", timeline: "1–3 years", experience: "Some" },
  netWorth: 12184.42,
  pnl: { abs: 312.4, pct: 2.83, window: "1M" },
  idleUSDC: 2150.0,
  vault: {
    name: "Aave Yield Vault",
    netApy: 3.87,
    supplyApy: 4.3,
    fee: 0,
    perfFee: 10,
    shares: 9834.5031,
    shareValue: 10034.42,
    accrued: 34.42,
    risk: 1,
    capUser: 25000,
    capUsed: 10034,
    tvl: 8.42,
    tvlCap: 12,
  },
  allocation: [
    { k: "Aave Yield Vault", v: 10034.42, risk: 1 },
    { k: "Idle USDC", v: 2150.0, risk: 0 },
  ],
  series1M: [11700, 11760, 11690, 11820, 11880, 11810, 11950, 12010, 11980, 12080, 12040, 12120, 12184],
  apyHist: [4.0, 4.1, 4.05, 4.2, 4.15, 4.3, 4.28, 4.3],
  recs: [
    {
      id: "r1",
      rank: "Best fit · #1 vs your goal",
      title: "Move idle USDC into the Aave Yield Vault",
      thesis:
        "Aave's USDC rate rose to 4.3% net APY. Moving your idle 2,150 USDC in could earn more, at the same low risk.",
      apy: 4.3,
      risk: 1,
      fit: "Fits your plan: lower risk, steady yield.",
    },
    {
      id: "r2",
      rank: "#2 vs your goal",
      title: "Keep a 1-month cash buffer",
      thesis:
        "Holding ~10% idle keeps funds ready without chasing yield. Honest tradeoff: less earning, more flexibility.",
      apy: 0,
      risk: 0,
      fit: "Conservative, capital-preservation-first.",
    },
  ],
  outcomes: [
    { id: "o1", kind: "gain", pnl: "+$48.20", pct: "+0.5%", win: "1M", from: "the May 18 deposit recommendation", cause: "The Aave rate held steady and yield accrued.", date: "May 18" },
    { id: "o2", kind: "loss", pnl: "−$88.10", pct: "−0.7%", win: "1M", from: "the Jun 2 rebalance recommendation", cause: "The rate dropped after the move.", date: "Jun 2" },
    { id: "o3", kind: "gain", pnl: "+$12.04", pct: "+0.1%", win: "1W", from: "the Jun 9 top-up recommendation", cause: "Small steady accrual since the top-up.", date: "Jun 9" },
  ],
  notifications: [
    { t: "Aave USDC rate moved to 4.3%", s: "A recommendation is ready in chat.", time: "2m ago", unread: true, icon: "activity" },
    { t: "Yield accrued: +$2.04 today", s: "Your vault position updated.", time: "1h ago", unread: true, icon: "up" },
    { t: "Deposit confirmed", s: "You now hold 9,834.50 spvUSDC.", time: "yesterday", unread: false, icon: "check" },
  ],
  txs: [
    { type: "Deposit", amt: "+9,834.50 spvUSDC", usd: "$10,000.00", time: "Jun 1", dir: "in" },
    { type: "Yield", amt: "+34.42 USDC", usd: "$34.42", time: "ongoing", dir: "in" },
    { type: "Withdraw", amt: "−500.00 USDC", usd: "$500.00", time: "May 24", dir: "out" },
  ],
  sessionKey: null,
};

/** Risk tier lookup → label + token CSS var (mirrors the design's TIER map). */
export const TIER: Record<number, { n: string; v: string }> = {
  0: { n: "Cash", v: "--muted-foreground" },
  1: { n: "Lower", v: "--risk-1" },
  2: { n: "Low", v: "--risk-2" },
  3: { n: "Moderate", v: "--risk-3" },
  4: { n: "Elevated", v: "--risk-4" },
  5: { n: "High", v: "--risk-5" },
};
