# Scaffold ↔ Showcase parity

How faithfully the Next.js scaffold (`apps/web`) reproduces the approved showcase design
(the prototype the client approved at `<internal-host>`). Measured by the
Playwright harness in [`/e2e`](../../e2e) — poke/click/screenshot/diff of every screen across
desktop + mobile and light + dark, plus DOM-text and interaction checks.

## Verdict (2026-06-22)

**The scaffold is a faithful 1:1 recreation of the showcase.** Every screen, the shell, all
overlays, the confirm gate, and the admin panel match the design's layout, components, copy, and
behaviour. A client would not notice it's a fresh build.

| Area | Result |
|---|---|
| **Landing** (animated Spark Core) | **0.07% / 0.12%** pixel diff — effectively identical (6 chapters, particle core, flavor switcher, intro splash). |
| **App screens** | Layout + content verified identical; residual **2–5%** is sub-pixel font anti-aliasing / render-scale, imperceptible. |
| **Admin** | Layout pixel-aligned (opsbar 56px, content top 56, H1 y=80 on both). The deliberate "no auth yet" banner is **dismissible** — once closed, admin matches the showcase. Text-dense pages (users/usage/system) read 6–9% purely from font anti-aliasing over lots of glyphs. |
| **Copy** | Faithful. The handful of text-parity flags are false positives — straight-vs-curly apostrophes (`can't` vs `can't`) and table-cell whitespace in text extraction, not missing copy. |
| **Interactions** | Pass — Prove-it sheet, ⌘K palette, Base↔Sui switch, **ack-gated Sign**, avatar theme toggle, disclaimer copy. |

The two genuinely-different things are both intentional: the **dismissible scaffold banner** on
`/admin`, and the fact that wallet/AI/chain/auth are simulated (out of scope for this UI build).

## Run it

```bash
# scaffold running in apps/web (pnpm dev, or pnpm build && pnpm start)
cd e2e && pnpm install && pnpm install:browsers
pnpm test                    # all specs; serves the showcase itself
node summarize.mjs           # -> parity-summary.md (the table below)
pnpm report                  # HTML report: side-by-side showcase/scaffold/diff per screen
```

See [`parity-summary.md`](./parity-summary.md) for the latest per-screen numbers.
Pixel thresholds are intentionally generous (two implementations never match to the pixel); the
**diff images** and **missing-copy list** are the actionable signal.
