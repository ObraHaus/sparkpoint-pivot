# Quickstart & Validation — 002-web-app-ui

How to run the faithful UI build and validate it against the approved design.

## Prerequisites
- Node 22, pnpm, the repo cloned. Reference design open for side-by-side: `docs/design-handover/showcase/` (host it with `python3 -m http.server` from that folder) — or the deployed showcase URL.

## Run
```bash
cd apps/web
pnpm install
pnpm dev            # http://localhost:3000  (next dev)
# gates:
pnpm lint && pnpm build
```

## Validate the flow (SC-002)
Walk: `/` (marketing landing) → **Launch app** → `/connect` → pick a wallet (simulated) → `/onboarding` → step through welcome→goal→risk→mandate→first-rec → **Enter SparkPoint** → `/chat`. Expect no dead ends.

## Validate the shell & overlays (SC-003)
On any `(app)` route: confirm TopBar (brand, Chat/Portfolio/Vault/Strategies, self-custodial pill, Base/Sui switcher, wallet pill, ⌘K, bell+count, avatar), the disclaimer strip, the "Trust & control" rail (incl. Withdraw/Exit). Open each overlay — self-custodial pill → Prove-it sheet; network switcher; wallet menu; bell → notifications; ⌘K (button + keyboard); avatar menu (theme toggle); trigger a toast. Each opens and dismisses.

## Validate screens vs the design (SC-001, SC-006)
For every row in `contracts/ui-contracts.md`'s Route map, open the route and compare side-by-side to the matching showcase screen: layout, components, copy, tokens. Spot-focus: Chat (cards + inline confirm), Portfolio (net worth chart + risk + allocation + positions + detail), Vault (net-APY breakdown incl. 10% perf fee/HWM, deposit/withdraw with shares preview), Confirm (sim → balance changes → guardrails → ack-gated Sign → success), Trust Center (permissions/exit/automation), Bridge (Base↔Sui), Fees/Premium/Outcomes.

## Validate the confirm gate (SC-007)
Trigger deposit, withdraw, swap, bridge, premium. Each routes through `ConfirmFlow`; the **Sign button is disabled until the acknowledgement is checked**; a chat-initiated action renders the same flow inline in the thread.

## Validate theme & responsive (SC-004, SC-005)
Toggle light/dark from the avatar menu, the onboarding header, and the admin panel; reload → theme persists, no flash; landing stays dark. Resize to 390px (mobile tab bar + bottom sheets, no horizontal scroll) and 1440px (rail + top nav).

## Validate admin (SC-008)
Open `/admin` directly → distinct shell, "Observe-only · read-only over funds" chip, "View as" role switcher (changes visible sections), "no auth yet" banner. Visit overview/users/usage/tvl/revenue(graphical dashboard)/system/killswitch/config/audit. Confirm **no control can move funds**; kill-switch is framed pause-only · 2-of-3 multisig · never blocks withdrawals.

## Validate routes load (SC-009)
Direct-navigate and reload each route (not just via in-app links) → renders shell + screen, no runtime/console errors.

> All data is mock/sample (see `data-model.md`); wallet/AI/chain/auth are non-functional by design in this build.
