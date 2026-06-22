# UI Contracts — Phase 1 (002-web-app-ui)

The "interfaces" of this UI feature: the **route map** (design → Next.js), the **screen/overlay inventory**, the **shell + overlay component contracts**, and the **mock-data shape**. These are the checklists the build must satisfy (SC-001 = 100% screen coverage).

## Route map (design hash route → Next.js route)

| Design (showcase) | Next.js route | Group / layout |
|---|---|---|
| `Spark Core Landing.html` + `landing` | `/` | public, dark-only |
| `connect` | `/connect` | (public) |
| `verify` | `/verify` | (public) |
| `flows/Onboarding.html` | `/onboarding` | onboarding (focused layout) |
| `chat` | `/chat` | (app) shell |
| `portfolio`, `portfolio/vault` (position) | `/portfolio`, `/portfolio/[positionId]` | (app) |
| `vault`, `vault/deposit`, `vault/withdraw` | `/vault`, `/vault/deposit`, `/vault/withdraw` | (app) |
| `strategies` | `/strategies` | (app) |
| `confirm/deposit|withdraw|swap|premium|bridge` | `/confirm/[intent]` | (app) + inline-in-chat |
| `trust`, `trust/permissions`, `trust/exit` | `/trust`, `/trust/permissions`, `/trust/exit` | (app) |
| `automation`, `automation/grant` | `/automation`, `/automation/grant` | (app) |
| `bridge` | `/bridge` | (app) |
| `fees` | `/fees` | (app) |
| `premium`, `premium/pay` | `/premium`, `/premium/pay` | (app) |
| `outcomes` | `/outcomes` | (app) |
| `learn` | `/learn` | (app) |
| `srk` | `/srk` | (app) |
| `settings`, `settings/account` | `/settings` | (app) |
| `notifications` | `/notifications` | (app) |
| `SparkPoint Admin.html` → overview/users/usage/tvl/revenue/system/killswitch/config/audit | `/admin`, `/admin/{users,usage,tvl,revenue,system,killswitch,config,audit}` | admin (own shell) |

`/` (marketing landing) → `Launch app` → `/connect` → (simulated) `/onboarding` → `Enter` → `/chat`.

## Shell contract (must render, matching the design)

- **TopBar**: SparkMark+brand · PrimaryNav (Chat/Portfolio/Vault/Strategies, active state) · "Fully self-custodial" pill (→ Prove-it) · Network switcher (Base/Sui) · Wallet pill · ⌘K button · Notifications bell (+unread count) · Avatar button (→ avatar menu w/ theme toggle).
- **DisclaimerStrip**: "The AI proposes. Guardrails check it. You sign it." + "Prove it / How we make money / Exit anytime" links.
- **TrustRail** (desktop): label "Trust & control" + Bridge, Trust Center, Automation, Outcome Log (badge), Fees, Premium, Learn, SRK, Settings + a distinct **Withdraw / Exit**.
- **MobileTabBar** (<1024px): Chat/Portfolio/Vault/Strategies/More; **More** sheet exposes the rail's secondary items + Withdraw/Exit + Prove-it.

## Overlay contract (`OverlayProvider` API)

| Function | Renders |
|---|---|
| `openProveIt()` | Prove-it sheet: Can/Can't columns + 5 guarantees + links to permissions/exit |
| `openWalletMenu()` | Connected address + copy/view/permissions/switch/disconnect |
| `openNetworkMenu()` | Base/Sui list (active checked) + "Bridge assets between networks" |
| `openNotifications()` | Notifications sheet (unread markers) |
| `openCommandPalette()` | ⌘K searchable actions/screens (also via keyboard) |
| `toast(msg)` | Transient confirmation toast |

All use the design's `.scrim/.sheet/.dialog/.menu/.toast` markup + open/dismiss transitions; mobile sheets/dialogs slide from the bottom.

## Confirm gate contract (`ConfirmFlow`)

Props: `intent` ('deposit'|'withdraw'|'swap'|'premium'|'bridge'), `mount` ('route'|'inline'). Renders: simulating → balance-changes table → guardrail checklist → (deposit/state-change) **acknowledgement checkbox that gates a disabled Sign button** → "nothing moves until you sign" → signing → success (receipt). Same logic at `/confirm/[intent]` and inline in chat.

## Mock-data shape (`lib/mock-data.ts`)

```ts
type NetworkId = 'base' | 'sui';
interface Network { id: NetworkId; name: string; live: boolean; color: string; wallet: string }
interface Mandate { tier: 0|1|2|3|4|5; name: string; goal: string; timeline: string; experience: string }
interface Vault { name: string; netApy: number; supplyApy: number; fee: number; perfFee: number;
  shares: number; shareValue: number; accrued: number; risk: number; capUser: number; capUsed: number; tvl: number; tvlCap: number }
interface Recommendation { id: string; rank: string; title: string; thesis: string; apy: number; risk: number; fit: string }
interface Outcome { id: string; kind: 'gain'|'loss'; pnl: string; pct: string; win: string; from: string; cause: string; date: string }
interface Notification { t: string; s: string; time: string; unread: boolean; icon: string }
interface Tx { type: string; amt: string; usd: string; time: string; dir: 'in'|'out' }
interface BridgeAsset { sym: string; base: number; sui: number }
interface MockData {
  wallet: string; networks: Network[]; activeNetwork: NetworkId; bridgeAssets: BridgeAsset[];
  mandate: Mandate; netWorth: number; pnl: { abs: number; pct: number; window: string }; idleUSDC: number;
  vault: Vault; allocation: { k: string; v: number; risk: number }[];
  series1M: number[]; apyHist: number[];
  recs: Recommendation[]; outcomes: Outcome[]; notifications: Notification[]; txs: Tx[];
  sessionKey: null | { scopeVaults: string[]; capWeekly: number; maxSlippageBps: number; expiry: string };
}
```
Values mirror the design's `SP.data` exactly (e.g., `vault.netApy = 3.87`, `supplyApy = 4.3`, `perfFee = 10`; networks Base+Sui both `live`).

## Acceptance hooks (per spec SCs)
- SC-001: every row in the Route map has a built screen. · SC-003: every `OverlayProvider` function opens/dismisses. · SC-007: `ConfirmFlow` Sign disabled until ack on every intent. · SC-008: `/admin` reachable, all admin routes present, no fund-moving control.
