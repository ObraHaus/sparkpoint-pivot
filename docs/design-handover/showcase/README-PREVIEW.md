# SparkPoint Pivot — Live Design Showcase (client preview)

This folder is the **hostable, clickable high-fidelity prototype** exported from **Claude Design**.
It is refreshed to the **latest design iteration** (June 18, 2026). Use it to walk the client through
the product.

> **Mockups only** — no live functionality, no wallet connection, no real transactions.

## Entry point

- **`SparkPoint Showcase.html`** (also copied as **`index.html`** so static hosts serve it at `/`).

It renders the full app in a **desktop frame (1440)** and a **mobile frame (390)** side-by-side, with a
route switcher. From the top bar you can also open the **App**, **Admin**, **Onboarding**, and the
**Spark Core Landing** in their own tabs.

## What's new in this iteration

- **Performance fee is ACTIVE in v1** — the Aave Yield Vault shows a 10% performance fee on yield over a
  high-water mark (0% on principal/deposits/withdrawals); net APY shown as **3.87%** (gross 4.3%).
- **Multi-network: Base → Sui + a Bridge** — a network switcher in the top bar and a dedicated
  **Bridge (Base ↔ Sui)** surface with a simulation-backed sign gate. Bridging is **fully self-custodial**.
- **In-chat confirm** — deposit/swap/bridge can be reviewed & signed **inline in the chat thread** (the
  same simulation → guardrails → ack-gated sign trust gate; `/confirm/*` routes still exist for other entry points).
- **New surfaces** — **Fees** (`/fees`), **Premium** (SRK-paid subscription, `/premium`), **Bridge**,
  the **Admin / Stakeholder** panel (read-only over funds; governed pause-only kill-switch), and an
  animated **Spark Core Landing**.
- **Brand** — cobalt blue + gold + coral (matched to sparkpoint.io); trust term is **"Fully self-custodial."**

## Preview it locally (recommended: a static server, not file://)

```bash
cd docs/design-handover/showcase
python3 -m http.server 8000
# then open:  http://localhost:8000/
```

## Share it with the client (deploy)

It's a plain static folder — drop it into any static host (Netlify / Vercel / Cloudflare Pages / GitHub
Pages / S3); entry = `index.html`.

## What's inside (the runtime closure)

```
SparkPoint Showcase.html   # entry — device-framed showcase
index.html                 # identical copy (serves at "/")
SparkPoint.html            # the app prototype (loaded in both frames)
SparkPoint Admin.html      # admin / stakeholder panel (self-contained)
Spark Core Landing.html    # animated marketing landing (self-contained; GSAP CDN)
flows/Onboarding.html      # onboarding flow
tokens.css · app.css       # design tokens + app shell styling
screens/*.js               # chat, portfolio, vault, strategies, confirm, trust, support,
                           # public, fees, premium, bridge
```

## Notes / caveats

- **External dependency:** the Spark Core Landing (and some animations) load **GSAP** from a CDN, so the
  preview needs internet for those. The core app frames work offline.
- **Known issue (carried over from Claude Design):** inside the Showcase's *scaled* desktop frame, the
  **Admin panel top bar can flicker/disappear** in some browsers (a transformed-ancestor + iframe
  compositing quirk). If it happens during the demo, open the Admin in its own tab via the **"Admin ↗"**
  link (top-right of the showcase), where it renders normally. This is a review-harness artifact, not a
  product bug.
- **Source of truth for behavior** remains the repo specs; this is the visual layer for client review.
