# Contract: POST /admin/content/reingest

Mirror of `POST /admin/tips/reingest`. Re-applies `content_seed/whats-new.yml` into `content_entries` without a full redeploy.

**Request**: `POST /admin/content/reingest` — admin-gated (session `admin=true`); no body.

**Behavior**: read `whats-new.yml`, upsert each entry by `slug`, skip slugs in `skip_sources` (operator-owned), append a `content_audit` row.

**Response 200**:
```json
{ "ingested": 6, "skipped": 1, "total_active": 7 }
```

**Errors**: 401/404 for non-admin (per existing admin-route convention); 200 with `ingested: 0` if the file is absent (fail-open — logged, never 500).
