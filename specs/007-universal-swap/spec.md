# Feature Specification: Universal Swap

**Feature Branch**: `007-universal-swap`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "improve /swap — make it universal. Right now it only supports hardcoded ETH and USDC no matter the route or network. Keep the hardcoded tokens as the recommended ones, but let users input custom ERC-20 token addresses so the swap page works like any DEX/aggregator (it should support custom addresses because we just connect to DEX routes). Still adhere to the 0.20% swap routing fee listed on /fees. The swap inside the AI chat should support the same."

## Clarifications

Resolved with the operator on 2026-07-20 (see the approved plan artifact and Assumptions):

- **Routing fee stays 0.20% (20 bips).** The brief said "0.02"; the code (`ROUTING_FEE_BIPS = 20`) and the `/fees` page both say 0.20%. No fee-value change — this feature only makes that same 0.20% apply universally.
- **Both legs may be custom.** A user can paste a custom ERC-20 for the token they pay *and* the token they receive (ETH + USDC remain one-tap recommended defaults).
- **Fee applies on every network where it can be collected on-chain** — including Robinhood Chain Testnet (46630), which is fee-free today because it has no vault. Where the on-chain fee-split is not available, the fee is taken another honest way or the network stays fee-free and says so (never a displayed fee that isn't collected).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Swap into any token from the swap page (Priority: P1) 🎯 MVP

A connected user opens `/swap`, keeps ETH or USDC as the token they pay, and pastes the contract address
of a token they want to receive. The app reads that token's real name, symbol, and decimals on-chain,
shows a clear **verified / unverified** indicator, quotes the swap, and — once the user acknowledges an
unverified token — lets them sign the swap from their own wallet. The 0.20% routing fee is taken inside
the signed swap exactly as it is today for ETH↔USDC.

**Why this priority**: This is the core of "make it universal." On its own it turns the fixed ETH↔USDC
toggle into a real, DEX-like swap for any token that has a direct pool, and it is the smallest slice that
delivers the requested value.

**Independent Test**: With a wallet on Base Sepolia, paste a token address that has a direct pool with
USDC/WETH, confirm the resolved symbol/decimals and the unverified warning appear, get a live quote, and
complete a signed swap whose output (net of 0.20%) arrives in the user's own wallet.

**Acceptance Scenarios**:

1. **Given** a connected wallet and USDC selected as "you pay", **When** the user pastes a valid ERC-20
   address into "you receive", **Then** the app shows the token's on-chain symbol/name/decimals and an
   "unverified token" indicator, and offers to import it.
2. **Given** a resolved custom token with a direct pool, **When** the user enters an amount, **Then** a
   live quote shows the estimated output net of the 0.20% routing fee and the minimum received after
   slippage.
3. **Given** a reviewed swap, **When** the user confirms and signs, **Then** the output lands in the
   user's own address, the 0.20% fee goes on-chain to the routing-fee recipient, and SparkPoint never
   holds the funds.
4. **Given** a pasted address that is not a contract or has no `decimals()`, **When** it is resolved,
   **Then** the app refuses it with an honest "this doesn't look like an ERC-20 token" message and no
   quote is produced.
5. **Given** a pasted token whose symbol matches a recommended token (e.g. "USDC") but a different
   address, **When** it is shown, **Then** the app warns "this is NOT the official USDC" with the address.

---

### User Story 2 - Swap between any two tokens with automatic best-route (Priority: P2)

A user picks a custom token on **both** sides (or a pair with no direct pool). The app automatically finds
the best route — a direct pool if one exists, otherwise a multi-hop route through a common asset (WETH,
and USDC where it is a real routing asset) — quotes it honestly, and executes it, keeping the 0.20% fee on
the final received token.

**Why this priority**: Most arbitrary pairs have no direct pool, so "universal" is only real once the app
can route multi-hop. It builds directly on US1 and is what makes the page behave like a DEX aggregator.

**Independent Test**: Select a token pair with no direct pool but a viable path via WETH; confirm the app
shows a multi-hop route (e.g. `TOKEN → WETH → TOKEN`), a live quote, honest price impact, and completes a
signed swap that delivers the received token net of the 0.20% fee.

**Acceptance Scenarios**:

1. **Given** a pair with a direct pool, **When** quoted, **Then** the app uses the single-hop route and
   labels the route honestly.
2. **Given** a pair with no direct pool but a path via WETH, **When** quoted, **Then** the app uses the
   multi-hop route, shows the path, and the received amount is net of the 0.20% fee.
3. **Given** a pair with neither a direct pool nor a viable multi-hop path, **When** quoted, **Then** the
   app shows an honest "no route / no liquidity" state and never fabricates an output.
4. **Given** a transient RPC/quote error, **When** quoting, **Then** the app shows a retryable "couldn't
   fetch a quote" state — distinct from "no liquidity".
5. **Given** a wallet that switches networks mid-session, **When** the network changes, **Then** the token
   selection resets to that network's recommended tokens (the same address is a different contract on
   another chain) rather than silently quoting the wrong token.

---

### User Story 3 - Routing fee applies on every supported network (Priority: P2)

The 0.20% routing fee applies on every network the swap runs on, including Robinhood Chain Testnet, which
is fee-free today. The fee is always taken on-chain inside the user's signed swap and paid to the
disclosed routing-fee recipient — never held by SparkPoint. Where the network cannot collect the fee
inside the swap, either the fee is taken another honest on-chain way or the network stays fee-free **and
the UI shows no fee** — the displayed fee always equals the collected fee.

**Why this priority**: The brief requires the 0.20% fee to hold "no matter which route or network." Today
it silently doesn't apply where there's no vault, which is both a revenue gap and a consistency gap.

**Independent Test**: On a non-vault network configured with a routing-fee recipient, complete a swap and
confirm the 0.20% fee is deducted and delivered to the recipient on-chain, and the receipt figures match
what was shown.

**Acceptance Scenarios**:

1. **Given** a network with a configured routing-fee recipient, **When** a swap executes, **Then** the
   user receives output − 0.20% and the recipient receives the 0.20% on-chain.
2. **Given** a routing-fee recipient that has not yet resolved, **When** the user tries to confirm,
   **Then** confirmation is blocked (never silently degraded to a fee-free swap).
3. **Given** a network where the fee cannot be collected on-chain, **When** the user swaps, **Then** the
   UI shows no routing fee and states the swap is fee-free on that network — no phantom fee is displayed.
4. **Given** the `/fees` page, **When** viewed, **Then** it discloses the routing-fee recipient for the
   active network and states the fee now applies on every supported network.

---

### User Story 4 - The same custom-token swap inside the chat assistant (Priority: P3)

When the assistant proposes a swap in chat, the inline swap card supports the same custom tokens with the
same safety and the same 0.20% fee. A token the assistant proposes is treated as **unverified by default**
and shown with its address and verified/unverified badge — it carries no more trust than a user paste.

**Why this priority**: The brief asks for parity in chat, but the manual page is where the value is proven
first; chat parity reuses the same engine once it is token-generic.

**Independent Test**: Have the assistant propose a swap into a custom token; confirm the inline card shows
the resolved token with an unverified badge + address, quotes with the 0.20% fee, and executes user-signed
exactly like the manual page.

**Acceptance Scenarios**:

1. **Given** an assistant swap proposal carrying a token pair, **When** the inline card renders, **Then**
   it shows the proposed from/to tokens (with address + verified/unverified badge for any non-recommended
   token) and quotes with the 0.20% fee.
2. **Given** a proposal for a network different from the connected wallet, **When** the card renders,
   **Then** it asks the user to switch networks (or refuses honestly) instead of quoting on the wrong
   chain.
3. **Given** an older-format proposal (single asset, no pair), **When** the card renders, **Then** it
   falls back gracefully to the recommended ETH↔USDC swap rather than breaking.

---

### Edge Cases

- **Not-a-token / EOA / self-destructed address** → refused with an honest message; no quote.
- **Fee-on-transfer or rebasing output token** → the app does not promise an exact minimum received on
  delivery; it warns that taxed tokens may deliver less and keeps figures labeled "estimated".
- **Tokens with unusual decimals** (0-decimal, >18-decimal, `bytes32` symbol like MKR) → resolved
  correctly or refused; amounts are never mis-scaled.
- **Adversarial metadata** (homoglyph "USDС", zero-width characters, over-long symbol) → sanitized before
  display and before any duplicate-symbol comparison; trust decisions key off the address, not the symbol.
- **Approval quirks** (USDT-style non-zero→non-zero approval revert) → handled with a reset-to-zero step.
- **Zero / unconfigured routing-fee recipient** → the fee is not activated (never sent to the zero
  address); the swap does not silently break.
- **Same token on both legs / native↔wrapped-native** → disallowed as a swap.
- **Thin pool / high price impact** → prominent warning; the minimum-received floor + deadline still guard
  the swap.
- **Disconnected preview** → the page previews on the default network and does not persist custom tokens
  against a network the user has not actually connected to.

## Requirements *(mandatory)*

### Functional Requirements

**Token selection & identity**

- **FR-001**: The swap MUST offer ETH and USDC as one-tap "recommended" tokens on every supported network,
  unchanged from today's behavior.
- **FR-002**: Users MUST be able to select a custom token for either the pay side or the receive side by
  entering its ERC-20 contract address.
- **FR-003**: The system MUST read a custom token's `decimals`, `symbol`, and `name` from the chain and
  MUST treat the on-chain `decimals` as authoritative for BOTH legs (never a value supplied by the wire,
  the assistant, or a cache) so that amounts are never mis-scaled.
- **FR-004**: The system MUST refuse an address that is not a contract or does not expose `decimals()`, and
  MUST NOT produce a quote for it.
- **FR-005**: The system MUST show whether a selected token is on a curated verified list, and MUST warn
  when a token's symbol collides with a recommended/verified token at a different address.
- **FR-006**: The system MUST let a user keep a small, per-network list of tokens they have imported /
  recently used, and MUST scope that list to the correct network.

**Routing & quoting**

- **FR-007**: The system MUST quote and execute direct (single-hop) routes and multi-hop routes through a
  common asset (WETH, and USDC where it is a real routing asset), and MUST pick the route giving the best
  received amount.
- **FR-008**: The system MUST fail closed: if no route has liquidity it MUST show an honest "no route"
  state, and it MUST distinguish that from a transient quote/RPC error (retryable).
- **FR-009**: Every quote MUST show the estimated received amount, the routing-fee amount (where a fee
  applies), the minimum received after slippage, and price impact (or an honest "unavailable" when it
  cannot be computed) — no fabricated numbers.
- **FR-010**: Every swap MUST enforce a minimum-received floor and a deadline.

**Routing fee**

- **FR-011**: The routing fee MUST remain 0.20% (20 bips) and MUST be taken inside the user's signed swap
  and paid on-chain to the disclosed routing-fee recipient; SparkPoint MUST NOT custody the fee.
- **FR-012**: The routing fee MUST apply on every supported network where it can be collected on-chain.
  Where it cannot, the network MUST be fee-free AND the UI MUST show no fee (the displayed fee always
  equals the collected fee).
- **FR-013**: The system MUST NOT execute a swap on a fee-bearing network until the routing-fee recipient
  has resolved; it MUST block, never degrade to a fee-free swap.
- **FR-014**: The system MUST NOT activate a fee toward an unconfigured/zero recipient address.
- **FR-015**: The `/fees` page MUST disclose the routing-fee recipient for the active network and state
  that the fee applies on every supported network.

**Safety & non-custody**

- **FR-016**: Every swap MUST be signed solely by the user; the recipient MUST always be the connecting
  account; no code path may take custody of user funds or the fee (Constitution N1–N3).
- **FR-017**: For any non-recommended token, the signing/confirmation surface (both `/swap` and the chat
  card) MUST show the token address and its verified/unverified status, and MUST require the user to
  acknowledge an unverified receive-token before confirming — the picker warning alone is not sufficient.
- **FR-018**: The system MUST sanitize on-chain token metadata (length cap, strip control/zero-width
  characters, normalize) before display and before any duplicate-symbol comparison, and MUST base
  anti-phishing decisions on the address, not the symbol string.
- **FR-019**: The system MUST NOT claim a guaranteed minimum received for fee-on-transfer output tokens;
  it MUST warn honestly instead.

**Chat parity**

- **FR-020**: A swap proposed by the assistant MUST be expressible as a token pair (pay token + receive
  token) plus the network it targets.
- **FR-021**: The inline chat swap card MUST support the same custom tokens, safety indicators, and 0.20%
  fee as `/swap`, and MUST treat an assistant-proposed token as unverified by default.
- **FR-022**: When an assistant proposal targets a network different from the connected wallet, the card
  MUST prompt a network switch or refuse honestly rather than quote on the wrong network.
- **FR-023**: The chat surfaces MUST remain backward-compatible: an older single-asset proposal MUST fall
  back to the recommended ETH↔USDC swap rather than break.

**Governance / scope boundary**

- **FR-024**: The universal swap MUST remain a user-signed, non-custodial action that is OUTSIDE the
  deterministic policy/allowlist engine; it MUST NOT widen the agent/vault policy allowlist, the `Asset`
  enum, or any on-chain `(target, selector)` permission (Constitution II & IV — see plan Constitution
  Check).

### Key Entities

- **SwapToken**: a token the user can pay or receive — symbol, name, decimals, on-chain address (native
  ETH is represented via wrapped-native for routing), a source (recommended / imported / native), and a
  verified flag. Decimals are always the on-chain value.
- **Route**: the chosen way to get from pay-token to receive-token — either a direct pool at a fee tier or
  a multi-hop path through a common asset — plus the quoted output and price impact.
- **RoutingFeeConfig**: the per-network routing-fee recipient and whether the fee can be collected
  on-chain on that network; the fee rate is fixed at 0.20%.
- **ImportedTokenList**: the user's small, per-network set of imported/recently-used custom tokens.
- **ProposedSwap**: an assistant-proposed swap expressed as a pay/receive token pair plus target network.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete a swap into a pasted custom token (with a direct pool) end-to-end from
  `/swap` without editing code or config.
- **SC-002**: A user can complete a swap for a pair that has no direct pool via an automatically-chosen
  multi-hop route, with the received amount net of the 0.20% fee.
- **SC-003**: For every completed swap on a fee-bearing network, the fee delivered on-chain to the
  recipient equals 0.20% of the swapped output, and the receipt figures match what was shown before
  signing (within rounding).
- **SC-004**: 100% of pasted addresses that are not valid ERC-20 tokens are refused before any quote; 0
  swaps are executed with mis-scaled amounts from wrong decimals.
- **SC-005**: Every non-recommended token shown to the user carries its address and a verified/unverified
  indicator at the point of signing, on both `/swap` and the chat card.
- **SC-006**: The same custom-token swap can be completed from the chat assistant with identical fee and
  safety behavior to `/swap`.
- **SC-007**: No swap is ever executed fee-free on a fee-bearing network due to a timing/loading race
  (the displayed fee always equals the collected fee).
- **SC-008**: No custody regression: in every path, the signer and recipient are the connecting account
  and neither the output nor the fee is ever held by SparkPoint.

## Assumptions

- The routing fee is **0.20% (20 bips)** — the operator confirmed the brief's "0.02" meant 0.20%; the fee
  value does not change, only its reach.
- Custom tokens are supported on **both** legs (operator-confirmed), with ETH/USDC as recommended defaults.
- Routing uses the DEX already wired per network (Uniswap V3 on Base / Base Sepolia; the Synthra V3 fork on
  Robinhood 46630), reached through the same user-signed, non-custodial path used today. No new custodial
  contract is introduced.
- Multi-hop hop assets are WETH on every network and USDC where it is a real routing asset; a network where
  USDC is not a real routing asset (e.g. the Base Sepolia Aave test token) skips the USDC hop.
- Whether the 0.20% fee can be collected on-chain on Robinhood 46630 depends on the fork exposing the
  on-chain fee-split; this is verified before the fee is turned on there, with an honest fallback.
- The swap remains outside the deterministic policy engine (user-signed), consistent with how the current
  ETH↔USDC swap already runs on Uniswap/Synthra rather than the policy-gated Aerodrome path.
- Price/impact display does not depend on any single stable reference; where impact cannot be computed it
  is shown as "unavailable", not zero.
- This feature does not touch the vault, session keys, the AA account stack, or the agent's execution
  authority.
