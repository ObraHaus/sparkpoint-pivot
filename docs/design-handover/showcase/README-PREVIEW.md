# SparkPoint Pivot — Live Design Showcase (client preview)

This folder is the **hostable, clickable high-fidelity prototype** exported from **Claude Design**
for the **W1–2 "Live Wireframe & UI/UX Finalization"** milestone — the critical design-feedback
window. Use it to gather **initial input from the client** before the coded build begins.

> **Mockups only** — no live functionality, no wallet connection, no real transactions.

## Entry point

- **`SparkPoint Showcase.html`** (also copied as **`index.html`** so static hosts serve it at `/`).

It renders the full app inside a **desktop frame (1440×900)** and a **mobile frame (390×844)** side
by side, with a **route switcher** across every flow (Chat, Portfolio, Strategies, Vault,
Deposit/Withdraw, Confirm + sign, Trust Center, Prove-it, Withdraw-always, Automation, Outcomes,
Learn, SRK, Notifications, Settings) plus the **Onboarding** flow. The frames are live — you can
click around inside them.

## Preview it locally (recommended: a static server, not file://)

The showcase uses `<iframe>`s, which behave best over HTTP:

```bash
cd docs/design-handover/showcase
python3 -m http.server 8000
# then open:  http://localhost:8000/
```

## Share it with the client (deploy)

It's a plain static folder — drop it into any static host:
- **Netlify / Vercel / Cloudflare Pages / GitHub Pages / S3** — upload this `showcase/` folder; entry = `index.html`.
- Or zip the folder and send it; the client runs the one-line server above.

## What's inside (the runtime closure)

```
SparkPoint Showcase.html   # entry — device-framed showcase
index.html                 # identical copy of the showcase (serves at "/")
SparkPoint.html            # the actual app prototype (loaded in both frames)
flows/Onboarding.html      # the onboarding flow prototype
tokens.css                 # design tokens (colors, type, spacing, risk palette)
app.css                    # app styles
screens/*.js               # per-screen prototype logic (chat, portfolio, vault, trust, …)
```

## Notes

- **One external dependency:** the GSAP animation library loads from a CDN (`cdnjs.cloudflare.com`),
  so the preview needs internet for animations. Want a fully **offline/self-contained** bundle? I can
  vendor GSAP locally on request.
- **Source:** extracted from `SparkPoint Pivot-handoff.zip` (Claude Design export). The full handoff
  bundle also contains a `Direction Board.html`, screenshots, and the design source docs — available
  if you want them added here too.
- **Source of truth for behavior** remains the Spec Kit `spec.md` / `plan.md`; this is the visual
  finalization layer that feeds the coded Next.js + shadcn/ui build.
