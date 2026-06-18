# Design Update — 2026-06-18 (latest Claude Design handoff, reconciled into the repo)

> **What this is.** A concise change-log recording the latest design iteration delivered by Claude
> Design (handoff dated **June 18, 2026**) and exactly how the repo was brought back in sync with it.
> The authoritative narrative of the handoff itself lives in `docs/DESIGN-UPDATE-HANDOFF.md`,
> `docs/DESIGN-DELIVERY-NOTES.md`, and `docs/INCREMENT-multi-network.md`; this file is the index of
> **what changed and which governing artifacts were edited to match.**
>
> **Discipline carried throughout:** edits are minimal and consistent, structure is preserved, and
> every client-directed scope/principle amendment is **logged as such** (never introduced silently).
> Where a change implies non-EVM (Sui) or bridge-mechanism work, it is **flagged as a follow-on**,
> not fabricated.

---

## The changes in this iteration

| # | Change | What it means | Status |
|---|---|---|---|
| 1 | **Multi-network (Base → Sui) + Bridge** | The product is now **multi-network**: **Base at launch (live)**, **Sui as the designated fast-follow network**. A persistent **network switcher** sits in the authenticated top bar (next to the wallet pill); switching updates the active-network indicator and the per-network wallet address. A dedicated **Bridge** surface (`#/bridge`) moves assets **Base ↔ Sui** with a simulation-backed `#/confirm/bridge` sign gate and a chat **bridge intent** ("bridge", "sui", "cross-chain"). **Networks beyond Base + Sui remain out of scope.** | Client-directed scope amendment — **supersedes "Base-only at launch."** |
| 2 | **Bridge is fully self-custodial** | The user signs a **lock/burn on the SOURCE network**; funds are received in the **user's OWN wallet on the DESTINATION network**; SparkPoint **never custodies funds in transit**. **Withdraw-always (N2)** holds on **every** network. The single simulation + guardrail checklist + you-sign gate applies to bridge actions exactly like swaps/deposits; per-network and per-bridge caps wire to policy limits. | Non-custody invariant, extended to every network. |
| 3 | **In-chat inline confirm** | Chat-initiated **deposit / swap / bridge** now render the confirm+sign flow **inline in the chat thread (no navigation)**, running the **same trust gate**: pre-trade simulation → balance changes → guardrail checklist → acknowledgement checkbox that **gates the Sign button** → "nothing moves until you sign" → Sign → success. The standalone `/confirm/[intent]` routes **remain** for non-chat entry points (vault page, ⌘K, etc.). One `ConfirmFlow` component, **two mount points**. | UX **surface** change only — the sign-disabled-until-acknowledged invariant and the whole trust gate are preserved 1:1; non-custody unchanged. |
| 4 | **Terminology: "fully self-custodial"** | The canonical **user-facing** trust term is now **"fully self-custodial"** (client-mandated), replacing "non-custodial" in user-facing copy and the persistent trust badge. "Non-custodial / self-custodial" remain accurate **technical** descriptors in architecture text. | Client-mandated terminology. |
| 5 | **Brand — cobalt / gold / coral via `tokens.css`** | The delivered brand diverges from the old "orange spark accent." The real brand (matched to sparkpoint.io) is **cobalt blue + gold + coral** warm accents, with a signature **blue→cyan→gold→coral gradient**, on a **deep indigo-navy** dark base. Risk scale is **violet→magenta** (5-step, so it never collides with the cobalt brand blue). Type: **Geist Sans + Geist Mono**, tabular numerals on financials. **`tokens.css` is the source of truth**; the old orange accent is **STALE**. | Brand divergence from `04-design-system.md`. |
| 6 | **New surfaces** | An animated **"Spark Core" marketing Landing** page; the **Fees** page; the **Premium** (SRK-paid subscription) surface; the **Bridge** surface; and the **Admin / Stakeholder** panel. | Additive surfaces. |
| 7 | **Admin governed kill-switch** | The Admin panel carries a **governed manual kill-switch**: **pause-only**, **2-of-3 multisig**, **NEVER blocks withdrawals**. The panel can only **propose & sign** — execution requires the on-chain multisig threshold. | Governed, never custodial. |
| 8 | **Performance fee — already active (v1.1.0)** | The **10% performance fee** on yield over a high-water mark on the Aave vault — **0% on principal/deposits/withdrawals** — is **already active in v1** (constitution v1.1.0, ratified last iteration). The design now reflects this (gross Aave **4.3% → net 3.87%** after 10% of yield). No "not active at launch" wording remains. | Already ratified; design caught up to it. |

---

## Admin specifics (delivered this iteration)

- **Custom (non-native) role dropdown** ("View as": Super-Admin / Ops / Stakeholder / Client) — a
  custom button+menu, not a native `<select>`.
- The ops top bar is a **plain, non-sticky / non-transformed** element (class **`.opsbar`**) — do not
  reintroduce `position:sticky` / `transform` on it.
- The **daily-executions chart** has explicit **green/red** colors.
- **Perf-fee surfaces are ACTIVE** (solid / realized, not projected / dashed).
- **Known unresolved issue (documented, not claimed fixed):** inside the Showcase's **scaled desktop
  iframe**, the admin top bar can **flicker / disappear** in some browsers — a transformed-ancestor +
  iframe compositing quirk. **Workaround: open Admin in its own tab.**

---

## Repo docs updated to match

| Artifact | What was reconciled |
|---|---|
| `.specify/memory/constitution.md` | **→ v1.2.0.** Scope/principles amended to **multi-network** (Principle VII + Chain & scope), the **fully self-custodial bridge** added at the non-custody level (Principle I / N2 hold on every network), the **"fully self-custodial"** canonical term adopted, and the Sui account/vault stack + bridge mechanism/provider **flagged as a follow-on** (Sui is non-EVM / Move-based; the ERC-4337/4626 Base stack is preserved intact). Performance fee unchanged from v1.1.0. |
| `specs/001-sparkpoint-pivot-mvp/spec.md` | Multi-network + fully-self-custodial bridge framing, terminology, and the active performance-fee disclosure woven into the input, user stories, and FRs. |
| `specs/001-sparkpoint-pivot-mvp/plan.md`, `data-model.md`, `tasks.md`, `contracts/*` | Multi-network scope, the bridge `txIntent` / `confirm/bridge` gate, per-network / per-bridge caps, and terminology aligned; the Base/EVM contract spec kept intact (no fabricated Sui contracts). |
| `docs/design-handover/00-brief.md` | Multi-network + Bridge, "fully self-custodial," the cobalt/gold/coral brand (orange marked stale), and the new surfaces logged as client-directed amendments. |
| `docs/design-handover/01-information-architecture.md` | The `(app)/bridge` route, the persistent **network switcher** + per-network wallet address in the shell, and Bridge in secondary nav + ⌘K. |
| `docs/design-handover/02-flows/02-chat-assistant.md` | The chat **bridge `ActionCard`** and the **in-chat inline confirm** (deposit / swap / bridge run the trust gate inline, no navigation). |
| `docs/design-handover/02-flows/12-bridge-multinetwork.md` | **New** — Flow 12: the network switcher, the Base ↔ Sui Bridge surface, the fully-self-custodial explainer, and the handoff to the `confirm/bridge` sign gate. |
| `docs/design-handover/03-screen-inventory.md` | New surfaces/states added to the numbered production checklist (Landing, Fees, Premium, Bridge, network switcher, admin). |
| `docs/design-handover/04-design-system.md` | Brand reconciled to cobalt/gold/coral + the signature gradient and violet→magenta risk scale; **`tokens.css` flagged as source of truth**; the old orange accent marked **stale**. |
| `docs/design-handover/05-trust-and-safety-ux.md` | Withdraw-always / caps / kill-switch semantics extended to **every network** and to bridge actions; "fully self-custodial" framing. |
| `docs/design-handover/06-component-library.md` | Components touched by the network switcher, bridge, and inline confirm. |
| `docs/design-handover/07-content-and-tone.md` | "Fully self-custodial" as canonical copy; bridge verbs ("Review bridge" → "Sign bridge"); the active perf-fee disclosure string. |
| `docs/design-handover/09-references.md` | Bridge-UX / simulation-sign-gate references. |
| `docs/admin-panel/` (README + design-spec) | The **governed** kill-switch (pause-only, 2-of-3 multisig, propose-&-sign only, never blocks withdrawals), the `.opsbar` render note, the custom role dropdown, active perf-fee revenue surfaces, and the documented (not-fixed) scaled-iframe top-bar quirk. |

---

## Flagged as FOLLOW-ON (do not fabricate here)

- **The Sui-side account / vault architecture.** Sui is **non-EVM (Move-based)** — it does **not** use
  ERC-4337 / ERC-4626 / Solidity. The Sui account/vault stack is a **separate follow-on technical
  design increment to be designed.** The existing Base/EVM contract spec stays intact.
- **The bridge mechanism / provider / route-selection.** The design shows a single canonical route at
  the **product / UX / non-custody** level only; the concrete bridge provider and route logic are a
  **separate follow-on increment.**
- **The Spark Core landing "flavor."** The landing's flavor selector (**Ember / Plasma /
  Constellation**) is intentionally **left for the client to pick** — an open choice, not yet locked.

---

## Live showcase

The live showcase under `docs/design-handover/showcase/` (entry point `SparkPoint Showcase.html`,
with `SparkPoint.html`, `screens/*.js`, `SparkPoint Admin.html`, `Spark Core Landing.html`,
`app.css`, and `tokens.css`) was **refreshed from this June 18 2026 handoff** — it reflects the
multi-network switcher + Bridge, the in-chat inline confirm, the cobalt/gold/coral brand
(`tokens.css` source of truth), the active performance fee, and the governed admin kill-switch.
