# SparkPoint parity harness (Playwright)

Proves the **scaffold** (`apps/web`) is detail-identical to the **approved showcase** design
(the prototype the client loves at `kg88wkk4g84wccokc4w000ss.aldrickb.app`). It pokes, clicks,
screenshots, and diffs every screen — including the admin panel — across desktop + mobile and
light + dark themes.

## What it checks

- **Visual** (`tests/visual.spec.ts`, `tests/admin.spec.ts`) — full-page screenshots of the showcase
  and the scaffold for each screen, pixel-diffed (animations frozen; the landing's particle canvas
  is masked). Outputs `showcase / scaffold / diff` images into the HTML report.
- **Text parity** (`tests/text-parity.spec.ts`) — every line of visible copy in the showcase must be
  present in the scaffold (catches missing/paraphrased microcopy).
- **Interactions** (`tests/interactions.spec.ts`) — Prove-it sheet, ⌘K palette, Base↔Sui switch,
  the ack-gated confirm Sign button, avatar theme toggle, disclaimer copy.
- **Admin** (`tests/admin.spec.ts`) — all 10 admin screens + observe-only / no-auth assertions.

Screen↔route mapping lives in `screens.ts`.

## Run

```bash
# 1. scaffold must be running (in apps/web): pnpm dev   (or pnpm build && pnpm start)
cd e2e
pnpm install
pnpm install:browsers          # playwright install chromium
pnpm test                      # runs all specs; starts the showcase static server itself
pnpm exec node summarize.mjs   # -> console table + parity-summary.md
pnpm report                    # open the HTML report (side-by-side images + diffs)
```

Override targets with env: `SCAFFOLD_URL` (default `http://localhost:3000`),
`SHOWCASE_URL` (default `http://localhost:4123`, served from `docs/design-handover/showcase/`).
To compare against the live deploy instead of the local showcase:
`SHOWCASE_URL=https://kg88wkk4g84wccokc4w000ss.aldrickb.app pnpm test` (note its routes may differ).

## Reading results

- `parity-results/*.json` — raw per-screen numbers.
- `parity-summary.md` — the table (✅ <2% · ⚠️ <6% · ❌ ≥6% pixels differing) + missing-copy list.
- `playwright-report/` — visual side-by-side + diff images for every screen.

Two different implementations never match to the pixel, so the visual threshold is generous;
the **diff images** and the **text-missing** list are the actionable signal for reaching
"the client won't notice it's a rebuild."
