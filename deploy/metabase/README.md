# Metabase + ComplyVerse Reports Analytics

**Reports › Analytics** is Metabase-backed. **Quick export** (`/reports`) stays
native for single-register CSV/Excel/Word/PDF. **Saved exports** stay native.

## Auth modes (important)

| Mode | When | Behaviour |
|---|---|---|
| `static_embed` | OSS + embedding secret | Curated dashboards iframe in Analytics |
| `open_link` | OSS + site URL only | Opens Metabase tab (login once) |
| `sso_link` / `embed` | **Metabase Pro** + `METABASE_PRO_JWT=1` | JWT SSO `/auth/sso?jwt=…` |

OSS Metabase does **not** register JWT SSO settings. Use Pro for seamless SSO.

## What shipped in-app

| Piece | Location |
|---|---|
| Semantic views | `backend/grc/services/reporting_semantic_layer.py` |
| Auto-create on tenant touch | `schema_migrations._ensure_for_engine` |
| Status / SSO / embed / ensure-views | `/reporting/metabase/*` |
| UI | `/reports/analytics` |
| Quick export / Saved | `/reports`, `/reports/saved` |
| Dashboard id map | `deploy/metabase/dashboard_ids.json` |

## Local bring-up

```bash
cd deploy/metabase
docker compose up -d
# Metabase http://127.0.0.1:3001  |  Mailhog http://127.0.0.1:8025
python setup_local.py
python enable_static_embedding.py
# copy backend-metabase.env keys into backend/.env, restart API
```

Then per tenant:

```bash
# reporting views: Reports > Analytics > Ensure reporting views
# or POST /reporting/metabase/ensure-views
# readonly role: readonly_reporting.sql (password must match provision_tenant)

export MB_URL=http://127.0.0.1:3001 MB_SESSION=… TENANT_SLUG=1link
export PG_HOST=host.docker.internal PG_USER=readonly_reporting PG_PASSWORD=…
python provision_tenant.py
export MB_DATABASE_ID=…   # printed by provision_tenant
python bootstrap_models.py
python bootstrap_dashboards.py
python configure_smtp.py
```

## Isolation

- One Metabase **database connection** per `grc_<slug>` (readonly role)
- Collection `Tenants/<slug>`
- JWT group hint `tenant_<slug>` (Pro JWT group sync)

## Subscriptions

Metabase owns schedule/delivery. Local SMTP → Mailhog (`configure_smtp.py`).
Create via dashboard → Sharing → Subscriptions (or `/api/pulse`).

## Security / licence

- Never connect Metabase as a privileged app role / never attach `grc_master`
- Metabase OSS is AGPL-3.0 — prefer commercial terms for multi-tenant embed
- Keep `deploy/metabase/.env` and `backend-metabase.env` out of git
