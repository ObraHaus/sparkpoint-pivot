# Feature Specification: SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)

**Feature Branch**: `001-sparkpoint-pivot-mvp`

**Created**: 2026-06-15

**Status**: Draft

**Input**: A non-custodial, chat-based Personal DeFi Assistant paired with an AI-managed, 0-management / profit-only performance-fee Aave Yield Vault on Base, where the AI recommends and the user signs every move, funds are always withdrawable, and non-custody is provable onchain. The vault charges 0% management fee and 0% on principal, with a 10% high-water-mark performance fee on realized yield only (configurable on-chain within a hard cap of 20%) — "we only earn when you earn."

## User Scenarios & Testing *(mandatory)*

SparkPoint Pivot positions itself as "The First AI-Native Onchain Hedge Fund": the AI acts as the fund manager, but a deterministic policy layer means the model never has final execution authority. The user signs every transaction, can always withdraw, and can prove non-custody from onchain state. The stories below cover the six core user flows (onboarding, chat assistant, portfolio overview, strategy recommendations, vault deposit/withdraw, execution confirmation) and the five non-custody invariants. Each story is an independently testable, viable slice; priorities reflect MVP sequencing.

### User Story 1 - Deposit into the Aave Yield Vault and withdraw anytime (Priority: P1)

A whitelisted beta user connects their own wallet, deposits USDC into the single conservative 0-management / profit-only performance-fee Aave Yield Vault, watches their balance accrue Aave yield, and withdraws their full balance whenever they choose — including a direct onchain exit even if SparkPoint's frontend and AI agents are completely offline. Before depositing they are shown that the vault charges a 10% performance fee on yield above a high-water mark and 0% on their principal.

**Why this priority**: This is the smallest viable slice that delivers the core product promise — AI-managed yield with verifiable non-custody. The vault produces real yield and proves the central trust claim ("never touches your keys, withdraw anytime") without depending on chat, onboarding, or the recommender. It must work standalone.

**Independent Test**: Connect a whitelisted wallet, deposit USDC, confirm vault shares are issued and balance reflects Aave yield over time, then redeem all shares back to USDC — and separately confirm the redemption can be performed directly onchain with SparkPoint's frontend and agents disabled.

**Acceptance Scenarios**:

1. **Given** a whitelisted user with USDC and an established smart account, **When** they deposit USDC into the Aave Yield Vault and sign the transaction, **Then** vault shares are issued in proportion to the deposit, the funds are routed into Aave v3, and the vault dashboard shows the deposited balance and accruing yield.
2. **Given** a user holding vault shares, **When** they request a full withdrawal and sign it, **Then** their shares are redeemed for USDC (their full principal plus realized yield, less only a 10% performance fee on yield earned above the high-water mark and never anything on principal) and the funds arrive in their own wallet.
3. **Given** SparkPoint's frontend and AI agents are entirely offline and the kill-switch has paused new deployments, **When** the user interacts directly with the vault contract onchain, **Then** they can still redeem their shares and withdraw their funds in full (withdraw-always escape hatch).
4. **Given** a user inspecting onchain permissions, **When** they review who can move funds out of the vault, **Then** only the user's own account has a path to withdraw to an external address and no SparkPoint-controlled address has any withdrawal path.
5. **Given** a user about to deposit into the vault, **When** the deposit is prepared, **Then** they are shown a clear pre-deposit disclosure that the vault charges a 10% performance fee on realized yield above a high-water mark, 0% on principal, and 0% management fee, alongside the net-of-everything APY.
6. **Given** a user who has completed a deposit or withdrawal, **When** they view their receipt, **Then** the receipt discloses the performance fee terms ("SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal") and any fee actually accrued.

---

### User Story 2 - Execute a DeFi action with pre-trade simulation and per-action signing (Priority: P1)

A user initiates a DeFi action (deposit/withdraw on Aave v3 in USDC or ETH, or a swap on Aerodrome) and, before signing, is shown a deterministic preview of exactly what will happen — expected balances, fees, and slippage — produced by a pre-trade simulation. The action only proceeds when the user signs, and nothing the AI proposes can execute without that signature.

**Why this priority**: The execution-confirmation flow is the trust backbone of the entire product and a hard non-custody requirement (every state-changing action is user-signed, and the deterministic policy layer wraps all AI output). Without it, no recommendation can be safely acted upon. It is co-critical with the vault.

**Independent Test**: Trigger an Aave deposit and an Aerodrome swap, confirm a simulation preview is shown before any signature is requested, reject one and confirm nothing executes, sign the other and confirm the onchain result matches the preview within the stated tolerance.

**Acceptance Scenarios**:

1. **Given** a user about to perform an Aave v3 deposit, withdrawal, or an Aerodrome swap, **When** the action is prepared, **Then** a pre-trade simulation preview is displayed (expected output amount, fees, price impact, and max slippage) before any signature is requested.
2. **Given** a simulation preview is displayed, **When** the user declines to sign or the wallet rejects the signature, **Then** no transaction is submitted and no funds move.
3. **Given** the simulation predicts the transaction would revert or exceed the user's max slippage, **When** the preview is generated, **Then** the action is blocked from being signed and the user is told why.
4. **Given** the AI proposes an action that violates the policy layer (non-whitelisted protocol, exceeds a cap, or malformed), **When** the proposal reaches execution, **Then** the deterministic policy layer rejects it and no signature is offered to the user.

---

### User Story 3 - Chat-driven onboarding into a personalized mandate (Priority: P2)

A new user completes a chat-based onboarding where the assistant asks about their goals and risk tolerance, and produces a personalized investment mandate (e.g., conservative yield-seeking) that shapes every later recommendation.

**Why this priority**: Onboarding personalizes the experience and makes recommendations relevant, but the vault and execution flows deliver value without it. It is the first step toward the differentiated "learns your goals" promise and gates the recommender's quality.

**Independent Test**: Complete the onboarding chat, answer goal and risk questions, and confirm a stored, human-readable mandate is produced and surfaced back to the user that reflects their stated answers.

**Acceptance Scenarios**:

1. **Given** a first-time whitelisted user, **When** they start onboarding, **Then** the assistant conversationally collects their financial goals and risk tolerance.
2. **Given** the user has answered the onboarding questions, **When** onboarding completes, **Then** a personalized mandate (goals + risk profile) is generated, shown back to the user for confirmation, and saved for use by later flows.
3. **Given** a user with an existing mandate, **When** they revisit onboarding or ask to change their goals, **Then** they can update their mandate and the change is reflected in subsequent recommendations.

---

### User Story 4 - View portfolio overview across Base assets (Priority: P2)

A user opens a portfolio overview that reads their onchain wallet activity and shows current positions, profit/loss, and allocation across their Base assets, including their vault and Aave positions.

**Why this priority**: The portfolio reader gives users situational awareness and is a precondition for trustworthy, context-aware recommendations. It depends on a connected wallet but not on chat or onboarding, so it is an independent slice.

**Independent Test**: Connect a wallet holding Base assets and a vault position, open the portfolio overview, and confirm positions, PnL, and allocation percentages are displayed and reconcile with onchain balances.

**Acceptance Scenarios**:

1. **Given** a user with positions across Base assets, **When** they open the portfolio overview, **Then** their current positions, per-position and total PnL, and allocation breakdown are displayed.
2. **Given** a user with an active vault deposit and an Aave position, **When** they view the portfolio, **Then** those positions appear with current value and accrued yield.
3. **Given** a user with no positions, **When** they open the portfolio overview, **Then** an empty state is shown without error.

---

### User Story 5 - Receive ranked strategy recommendations with rationale and outcome tracking (Priority: P2)

A user asks the assistant what to do and receives a ranked list of strategy recommendations scored against their mandate, each with a plain-language rationale. Once acted on, each recommendation is labeled over time with its realized PnL so the user can see whether past advice worked.

**Why this priority**: The recommender is the visible "hedge fund manager" intelligence and the differentiator, plus outcome logging builds the credibility loop. It depends on having a mandate and portfolio context, so it sequences after those.

**Independent Test**: With a mandate and portfolio present, request recommendations and confirm a ranked, rationale-bearing list is returned; act on one and confirm an outcome log entry is created and later updated with realized PnL.

**Acceptance Scenarios**:

1. **Given** a user with an established mandate and portfolio, **When** they request strategy recommendations, **Then** a ranked list is returned, each ranked relative to the user's goal and accompanied by a plain-language rationale.
2. **Given** a recommendation the user acts on, **When** the action is executed, **Then** an outcome log entry is created linking the recommendation to the resulting position.
3. **Given** an outcome log entry exists for a past recommendation, **When** time passes and the position changes value, **Then** the entry is updated with the realized PnL of that recommendation.
4. **Given** a recommendation references a protocol or action, **When** it is shown, **Then** only whitelisted protocols (Aave v3, Aerodrome) and within-policy actions are ever recommended.

---

### User Story 6 - Opt in to scoped, revocable auto-rebalance via session key (Priority: P3)

A user opts in to automated rebalancing by authorizing a time-boxed session key bounded by an onchain policy (allowlisted vaults only, per-transaction and cumulative caps, max slippage, hard expiry). The user can revoke this authorization instantly and unilaterally at any time, without SparkPoint's cooperation, and the agent can never exceed the granted scope even if compromised.

**Why this priority**: Automation is a power-user convenience that materially raises the trust bar, so it ships after the per-action signing baseline is solid. It is the concrete expression of the "scoped, instantly-revocable automation" invariant and is optional to the core product.

**Independent Test**: Authorize a session key with explicit caps and expiry, confirm an in-scope automated action succeeds, confirm an out-of-scope action is rejected onchain, then revoke the key and confirm no further automated actions can occur.

**Acceptance Scenarios**:

1. **Given** a user who opts in to auto-rebalance, **When** they authorize a session key, **Then** the key is bound by an onchain policy specifying allowlisted vaults only, per-transaction and cumulative caps, max slippage, and a hard expiry.
2. **Given** an active session key, **When** the agent attempts an action exceeding the caps, slippage, allowlist, or expiry, **Then** the action is rejected onchain and no funds move.
3. **Given** an active session key, **When** the user revokes it, **Then** revocation takes effect immediately and unilaterally (without any SparkPoint action) and no further automated action can be taken.
4. **Given** a session key has reached its hard expiry, **When** the agent attempts to use it, **Then** the attempt fails and the user is prompted to re-authorize if they wish.

---

### Edge Cases

- **Agent / frontend offline**: The user can still redeem vault shares and withdraw from Aave directly onchain; portfolio and recommendations may be unavailable, but custody and exit are not affected.
- **Kill-switch active**: New deployments and deposits are paused, but withdrawals and redemptions remain fully available; the user is clearly told the system is paused for new activity.
- **Fee accrual fails during withdrawal**: If performance-fee accrual cannot complete (e.g., transient computation/data issue), it fails open — the fee is skipped for that transaction and the user's redemption proceeds in full and is never blocked, delayed, or reverted.
- **Flat or down period (share price at/below high-water mark)**: No performance fee is charged; principal is fully redeemable and the high-water mark is not advanced.
- **Per-user cap reached**: A deposit that would exceed the per-user TVL cap is blocked before signing, with a clear explanation; existing funds and withdrawals are unaffected.
- **Total protocol / vault deposit cap reached**: New deposits are blocked at the cap with a clear message; withdrawals remain available.
- **Simulation predicts revert**: The action is blocked from signing and the user is shown the predicted failure reason.
- **Slippage exceeded at execution**: If realized slippage would exceed the user's max, the transaction does not proceed.
- **Session key expired or revoked mid-flow**: Any pending automated action using that key fails cleanly; the user retains full manual control.
- **Wallet rejects or times out on signature**: No transaction is submitted; the user can retry or cancel with no side effects.
- **Zero balance / insufficient funds for gas or action**: The user is informed and the action is prevented before signing.
- **Geo-blocked user**: The frontend is geo-fenced; a user from a restricted region is prevented from accessing the app surfaces, while existing users retain the onchain withdraw-always escape hatch.
- **Non-whitelisted wallet**: A wallet not on the beta whitelist cannot deposit or transact through the app and is told it is not yet enabled for the beta.
- **AI hallucination / out-of-policy proposal**: The deterministic policy layer rejects it before any signature is offered; the user never sees a signable out-of-policy action.
- **Price-feed or data-source outage**: Portfolio values and recommendations may be marked stale or unavailable; no execution proceeds on stale data beyond the user's tolerance, and custody/withdrawals are unaffected.
- **SRK unavailable**: All core vault and assistant functions operate fully even if SRK features are absent or disabled.

## Requirements *(mandatory)*

### Functional Requirements

#### Onboarding

- **FR-001**: System MUST provide a chat-based onboarding that conversationally collects the user's financial goals and risk tolerance.
- **FR-002**: System MUST generate a personalized mandate (goals + risk profile) from onboarding answers and present it back to the user for confirmation before it takes effect.
- **FR-003**: System MUST persist the user's mandate and make it available to the portfolio, recommendation, and execution flows.
- **FR-004**: Users MUST be able to update their goals and risk tolerance after initial onboarding, with the change reflected in subsequent recommendations.

#### Chat Assistant

- **FR-005**: System MUST provide a chat-based AI assistant through which users can ask questions, request recommendations, and initiate actions.
- **FR-006**: System MUST explain the reasoning behind each recommendation and proposed action in plain language ("explains every move").
- **FR-007**: System MUST surface contextual financial-literacy tips relevant to the user's current context and actions.
- **FR-008**: System MUST ensure that any action the assistant proposes is validated by the deterministic policy layer before it can be offered to the user for signing.

#### Portfolio

- **FR-009**: System MUST read the user's onchain wallet activity and display current positions across the user's Base assets.
- **FR-010**: System MUST display per-position and total profit/loss (PnL) for the user's holdings.
- **FR-011**: System MUST display the user's allocation breakdown across assets and positions.
- **FR-012**: System MUST include the user's vault and Aave positions in the portfolio overview, showing current value and accrued yield.
- **FR-013**: System MUST present a clear empty state when the user has no positions, without error.

#### Strategy

- **FR-014**: System MUST produce strategy recommendations ranked relative to the user's mandate/goal.
- **FR-015**: System MUST attach a plain-language rationale to each recommendation.
- **FR-016**: System MUST only recommend actions that use whitelisted protocols (Aave v3, Aerodrome) and that comply with the policy layer.

#### Vault & Execution

- **FR-017**: System MUST provide a single conservative, 0-management Aave Yield Vault that accepts USDC deposits, routes them into Aave v3 yield, and allows withdrawal at any time. The vault MUST charge 0% management fee, 0% entry/exit fee, and 0% on principal, and MUST charge only a profit-only high-water-mark performance fee on realized yield (per FR-047).
- **FR-018**: System MUST issue vault shares to depositors in proportion to their deposit and redeem shares for their full principal plus realized yield, with the only deduction being the performance fee on yield earned above the high-water mark (FR-047); no management, entry, exit, or principal fee is ever deducted.
- **FR-047**: System MUST charge a performance fee of 10% (configurable on-chain, default 10%, hard-capped at 20%) assessed ONLY on realized yield above a per-vault high-water mark on share price. The fee MUST NOT be charged on principal and MUST NOT be charged when share price is at or below the high-water mark (no fee in flat or down periods).
- **FR-048**: System MUST realize the performance fee by minting fee shares to a feeRecipient during lazy fee accrual on deposit, withdraw, or harvest — minting shares whose claim equals feeRate × (assets gained above the high-water mark since last accrual) — and MUST advance the high-water mark only after accrual. Entry fee, exit fee, and management fee MUST remain constant at 0.
- **FR-049**: System MUST treat the feeRecipient as an ordinary, non-privileged share holder that redeems through the same withdraw/redeem path as any user, with no admin or withdrawal authority over other users' shares and no ability to block, delay, or reorder any user's redemption.
- **FR-050**: System MUST ensure the performance fee never reduces any user's redeemable principal below their deposited principal; fee shares accrue only against realized gains above the high-water mark.
- **FR-051**: System MUST make performance-fee accrual fail open: if accrual cannot complete, the fee MUST be skipped and the user's withdrawal/redemption MUST proceed unblocked and never revert; the redemption path MUST never depend on a fee being collectible.
- **FR-052**: System MUST disclose the performance fee fully before deposit and on transaction receipts, stating the rate, that it applies only to yield above the high-water mark, and that principal is never charged (e.g., "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal"), and MUST present the net-of-everything APY. Fee terms and any accrued fee MUST be provable on-chain.
- **FR-053**: System MUST make feeRate the only mutable fee parameter, governed by a timelock and multisig and hard-capped at 20%, and MUST ensure changing feeRate can never alter custody, withdraw, or principal semantics. The vault's custody semantics MUST remain non-upgradeable.
- **FR-019**: System MUST support Aave v3 deposit and withdraw for USDC and ETH initiated from the assistant.
- **FR-020**: System MUST support Aerodrome swaps initiated from chat.
- **FR-021**: System MUST present a pre-trade simulation preview (expected output, fees, price impact, max slippage) before any signature is requested for a state-changing action.
- **FR-022**: System MUST require an explicit user signature for every state-changing action, with per-action signing as the default mode.
- **FR-023**: System MUST block any action from being signed when the simulation predicts a revert or predicts that the user's max slippage would be exceeded, and MUST tell the user why.
- **FR-024**: System MUST not submit any transaction if the user declines to sign or the wallet rejects the signature.
- **FR-025**: System MUST enforce hard caps — per-user TVL cap, total protocol cap, and vault deposit cap — and block deposits that would breach them before signing, with a clear explanation.
- **FR-026**: System MUST provide a multisig kill-switch that can pause new deployments/deposits but MUST NOT block or delay user withdrawals or redemptions (pause-only).
- **FR-027**: System MUST restrict all execution to whitelisted protocols only (Aave v3, Aerodrome).

#### Account Abstraction & Automation

- **FR-028**: System MUST give each user a smart account that they solely own and administer; the system MUST NOT generate or hold wallets on the user's behalf.
- **FR-029**: System MUST allow users to opt in to scoped auto-rebalance using a time-boxed session key bound by an onchain policy (allowlisted vaults only, per-transaction and cumulative caps, max slippage, hard expiry).
- **FR-030**: System MUST reject onchain any automated action that exceeds the session key's allowlist, caps, slippage limit, or expiry, such that the agent can never exceed scope even if compromised.
- **FR-031**: Users MUST be able to revoke a session key instantly and unilaterally, without SparkPoint's cooperation, after which no further automated action can occur.
- **FR-032**: System MUST stop using a session key once it reaches its hard expiry and MUST require explicit re-authorization to resume automation.

#### Trust & Safety / Non-Custody

- **FR-033** (N1 — No admin withdrawal): System MUST ensure that only the user can move funds out to an external address; there MUST be no code path by which the protocol or agent withdraws user funds to a SparkPoint-controlled address. The agent MAY only direct strategy within an allowlist.
- **FR-034** (N2 — Withdraw-always escape hatch): System MUST allow the user to exit directly onchain (redeem vault shares, withdraw from Aave) even when SparkPoint's frontend and agents are entirely offline, and the kill-switch MUST never block withdrawals.
- **FR-035** (N3 — User-owned keys): System MUST make the user the sole owner/admin signer of their smart account, with per-action user signature as the default execution mode and no agent-generated wallets.
- **FR-036** (N4 — Scoped, revocable, time-boxed automation): System MUST bound all opt-in automation by the onchain policy module (allowlisted vaults, per-tx and cumulative caps, max slippage, hard expiry) and MUST allow instant, unilateral user revocation.
- **FR-037** (N5 — Non-upgradeable custody + verifiable non-custody): System MUST make the vault single-purpose and non-upgradeable in its custody semantics; any multisig/timelock MUST govern only pause and the hard-capped, timelocked feeRate (FR-053) and MUST never move user funds or alter custody, withdraw, or principal semantics; and the Trust Center MUST surface the exact onchain permissions so non-custody is provable.
- **FR-038**: System MUST provide a Trust Center surface that displays current caps, kill-switch status, whitelisted protocols, and the exact onchain permissions associated with the user's account and the vault.

#### Outcome Logging

- **FR-039**: System MUST create an outcome log entry that links each acted-upon recommendation to the resulting position/action.
- **FR-040**: System MUST update each outcome log entry over time with the realized PnL attributable to that recommendation.
- **FR-041**: System MUST make outcome history viewable to the user so they can see whether past recommendations performed.

#### Beta Gating

- **FR-042**: System MUST restrict app access and transacting to whitelisted users during the beta.
- **FR-043**: System MUST enforce per-user caps for beta participants.
- **FR-044**: System MUST geo-fence the frontend so users from restricted regions cannot access the app surfaces, while preserving the onchain withdraw-always escape hatch for existing users.

#### SRK

- **FR-045**: System MUST treat SRK as non-essential to core vault function — the vault and assistant MUST operate fully without SRK.
- **FR-046**: System MUST provide an SRK view that displays SRK information to the user without making any core function depend on holding SRK.

### Key Entities *(include if feature involves data)*

- **User**: A whitelisted beta participant who solely owns and signs for their smart account. Has a connected wallet, an optional mandate, a portfolio, and an outcome history.
- **Risk Profile / Mandate**: The personalized expression of a user's goals and risk tolerance, produced during onboarding, confirmed by the user, and used to rank recommendations and constrain suggested actions.
- **Portfolio**: The aggregate view of a user's positions across Base assets, including total and per-position PnL and allocation breakdown.
- **Position**: A single holding (e.g., an Aave deposit, a token balance, a vault stake) with current value, cost basis, and accrued yield where applicable.
- **Strategy Recommendation**: A ranked suggestion scored against the user's mandate, carrying a plain-language rationale and referencing only whitelisted protocols and in-policy actions.
- **Vault**: The single conservative, 0-management / profit-only performance-fee, non-upgradeable Aave Yield Vault. Accepts USDC, routes to Aave v3 yield, issues/redeems shares, allows withdrawal anytime, charges 0% on principal and a 10% high-water-mark performance fee on realized yield only (hard-capped at 20%), and is governed for pause and the timelocked feeRate only — never for fund movement.
- **Vault Position (Shares)**: A user's stake in the vault, denominated in shares that represent a proportional claim on the vault's USDC plus accrued yield (net of any performance fee on gains above the high-water mark), redeemable at any time, with principal never reduced by the fee.
- **Fee Recipient**: An ordinary, non-privileged share holder that receives performance-fee shares minted during accrual. Redeems via the same withdraw/redeem path as any user, holds no admin or withdrawal authority over others' shares, and cannot block, delay, or reorder any user's redemption.
- **High-Water Mark**: The per-vault peak share price against which the performance fee is assessed. The fee applies only to realized yield above it; it advances only after accrual, and is never charged in flat or down periods (share price at/below the mark).
- **Fee Accrual**: The lazy, on-deposit/withdraw/harvest event that realizes the performance fee by minting fee shares to the Fee Recipient equal to feeRate × gains above the high-water mark, then advancing the mark. Accrual fails open: if it cannot complete it is skipped and never blocks or reverts a user's redemption.
- **Session Key / Policy**: A time-boxed, scope-bounded authorization for automation, defined by an onchain policy (allowlisted vaults, per-tx and cumulative caps, max slippage, hard expiry), instantly and unilaterally revocable by the user.
- **Transaction / Execution**: A state-changing onchain action (deposit, withdraw, swap, rebalance) that carries a pre-trade simulation preview and requires a user signature (or an in-scope session key) to proceed.
- **Outcome Log Entry**: A record linking an acted-upon recommendation to its resulting position and tracking realized PnL over time.
- **Literacy Tip**: A contextual financial-education snippet surfaced to the user relevant to their current action or context.
- **Trust Center Record**: The surfaced state of caps, kill-switch status, whitelisted protocols, and exact onchain permissions used to make non-custody provable to the user.
- **SRK View**: A non-essential informational surface presenting SRK details, with no core function gated on SRK.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of state-changing actions require and receive an explicit user signature (or an explicitly authorized, in-scope session key); no action executes without one.
- **SC-002**: A pre-trade simulation preview is shown before 100% of signature requests for state-changing actions.
- **SC-003**: Withdraw-always works with the frontend and agents fully offline: a user can redeem vault shares and withdraw from Aave directly onchain in 100% of test cases, including while the kill-switch is active.
- **SC-004**: There is zero (0) onchain code path by which any SparkPoint-controlled address can withdraw user funds to itself, verifiable from onchain permissions.
- **SC-005**: 100% of strategy recommendations are displayed with a visible plain-language rationale and a ranking relative to the user's goal.
- **SC-006**: 100% of recommended and executed actions use only whitelisted protocols (Aave v3, Aerodrome); out-of-policy proposals are rejected before any signature is offered.
- **SC-007**: A new user can complete chat-based onboarding and produce a confirmed mandate in under 5 minutes.
- **SC-008**: Session-key revocation takes effect immediately and unilaterally, and 100% of out-of-scope automated actions (exceeding caps, slippage, allowlist, or expiry) are rejected onchain.
- **SC-009**: Deposits that would breach any hard cap (per-user TVL, total protocol, vault deposit) are blocked before signing in 100% of cases, while withdrawals remain unaffected.
- **SC-010**: 100% of acted-upon recommendations generate an outcome log entry that is subsequently updated with realized PnL.
- **SC-011**: The portfolio overview reconciles displayed positions, PnL, and allocation with onchain balances for connected wallets.
- **SC-012**: The Trust Center accurately surfaces current caps, kill-switch status, whitelisted protocols, and the exact onchain permissions, making non-custody independently verifiable by a user.
- **SC-013**: Core vault and assistant functions remain fully usable with SRK absent or disabled in 100% of test cases.
- **SC-014**: Geo-fenced and non-whitelisted users are prevented from accessing app surfaces or transacting, while existing users retain the onchain withdraw-always escape hatch.
- **SC-015**: The vault charges a fee only on realized yield above the high-water mark (10%, hard-capped at 20%) and 0 on principal: in 100% of test cases a user redeems at least their full deposited principal, no fee is charged in flat or down periods, and the fee terms are fully disclosed pre-deposit and on receipts with net-of-everything APY, provable on-chain.
- **SC-016**: Performance-fee accrual fails open in 100% of test cases: a withdrawal/redemption is never blocked, delayed, or reverted by fee accrual, and changing feeRate (timelocked, hard-capped at 20%) never alters custody, withdraw, or principal semantics.

## Assumptions

- The product launches on Base mainnet as a single-chain MVP.
- At launch there is exactly one vault: a conservative, 0-management / profit-only performance-fee, non-upgradeable Aave Yield Vault accepting USDC, charging 0% on principal and a 10% high-water-mark performance fee on realized yield (hard-capped at 20%, default 10%); multi-strategy vaults are deferred.
- The launch operates as a closed beta with a whitelist, per-user caps, and a geo-fenced frontend; broader public access expands post-launch.
- SRK is non-essential to core function; SRK v2 utility and governance are deferred to a later cycle and the vault works without SRK.
- Per-action user signing is the default execution mode; scoped session-key automation is strictly opt-in.
- Supported assets at launch are USDC and ETH for Aave v3, with Aerodrome swaps available from chat; additional protocols and assets are out of scope.
- External security audit, penetration testing, legal review (terms of service, risk disclosures, geo rules), and marketing/growth are owned by SparkPoint's internal teams and are out of scope for this build.
- Deferred out of scope for this feature: multi-strategy vaults (market-neutral, volatility harvesting, yield optimization), ZK trade proofs, SRK v2 utility and governance, KYC/compliance gating, additional protocols, stocks/TradFi, and a general-purpose financial assistant.
- Users connect their own self-custodied wallet; the system never generates or holds wallets on a user's behalf.
- If the custom account-abstraction stack hits schedule risk, a fallback to a battle-tested account-abstraction SDK is acceptable provided it preserves all five non-custody invariants.
- Target production-ready launch on Base is September 4, 2026.
