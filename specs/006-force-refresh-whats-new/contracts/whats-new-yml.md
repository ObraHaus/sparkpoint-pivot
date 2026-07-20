# Contract: services/agent/content_seed/whats-new.yml

Committed source of the client-facing changelog. Ingested at agent boot (fail-open) and via `POST /admin/content/reingest`.

```yaml
entries:
  - slug: wallet-holdings-every-network   # stable unique key (required)
    tag: New                              # New | Fixed | Improved | Announcement
    title: Wallet holdings on every network
    body: Your Portfolio now lists native ETH plus every token your wallet holds.
    published_at: 2026-07-17              # ISO date or datetime; supports honest backdating
    active: true                          # optional, default true
    cta_label: Open Portfolio             # optional
    cta_href: /portfolio                  # optional
```

**Rules**:
- `slug` is required and unique; ingest upserts by slug (`ON CONFLICT (slug) DO UPDATE`).
- Client register only — no dev detail (file names, N1–N5, "requires redeploy").
- A slug hand-edited by an operator (Admin → Updates) is in `skip_sources` and is NOT overwritten on re-ingest.
- Dockerfile MUST `COPY content_seed` into the image or prod ingests 0.
