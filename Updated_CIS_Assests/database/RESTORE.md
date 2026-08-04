# Database — restore the `grc` database

This package ships the live demo database so your colleague gets the exact state
we built, **including the `demo-bank-srv-01` host and its co-located apps**
(MSSQL 2022, Apache Tomcat 9, Web-Server/IIS, Oracle DB) used to demo the
IT-Assets "room-and-chair" composite scoring.

## Files

| File | What it is | Size |
|------|------------|------|
| `grc-demo.sql.gz` | **Use this.** Full schema + data, with three bloat tables emptied (see below). Restores in a couple of minutes. | ~20 MB |
| `grc-schema.sql`  | Schema only (293 tables, 5 tenant schemas). For reference / building a blank DB. | ~1 MB |

### What was trimmed from `grc-demo.sql.gz`
To keep the file small, the **data** (not the structure) of three noisy tables
was excluded. The tables still exist (empty) after restore — nothing in the
IT-Assets / CIS / Risk-Posture / Agents flows depends on their rows:

- `public.grc_cis_ingest_jobs` — 723 MB of raw PDF-ingestion job blobs
- `public.grc_audit_logs` — 95 MB of historical audit rows
- `public.grc_workflow_audit_logs` — workflow audit history

Everything important is kept in full: **`grc_compliance_plugins`** (all ~5,300
CIS checks), **`grc_compliance_plugin_runs`** (scan results), all asset, risk,
agent, framework and tenant data.

## Prerequisites

- **PostgreSQL 18** installed (any recent 16/17/18 works). Installer:
  https://www.postgresql.org/download/windows/
- The app expects Postgres on **port 5433**, user **`postgres`**, password
  **`YourStr0ng!Pass`**, database **`grc`**. If you use different values, update
  `DATABASE_URL` in `project/.migration-backup/backend/.env` to match.

> The default Postgres port is 5432. This project uses **5433** on purpose so it
> can coexist with another local Postgres. During the installer, set the port to
> 5433, **or** install on 5432 and change the port in both places below + the `.env`.

## Restore on Windows (PowerShell)

```powershell
# Adjust the PG bin path to your installed version (here: 18)
$PG = "C:\Program Files\PostgreSQL\18\bin"
$env:PGPASSWORD = "YourStr0ng!Pass"

# 1. Create the empty database
& "$PG\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres grc

# 2. Decompress the dump (Git Bash / 7-Zip / WSL all provide gzip)
#    If you have Git installed:
& "C:\Program Files\Git\usr\bin\gzip.exe" -d -k grc-demo.sql.gz   # -k keeps the .gz

# 3. Restore
& "$PG\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d grc -f grc-demo.sql
```

## Restore on Linux / macOS / WSL

```bash
export PGPASSWORD='YourStr0ng!Pass'
createdb -h 127.0.0.1 -p 5433 -U postgres grc
gunzip -k grc-demo.sql.gz
psql -h 127.0.0.1 -p 5433 -U postgres -d grc -f grc-demo.sql
```

## Log in after restore

The app is multi-tenant. Use the **demo bank** tenant (this is the one wired to
the demo assets):

- **Email:** `hassan@demobank.com`
- **Password:** `demo1234`

> ⚠ Do **not** use `hassanai@ca.com` — that tenant has no schema and is broken.

If the password doesn't work (hashes differ per environment), reset it with SQL:

```sql
-- get a bcrypt hash first:
--   python -c "import bcrypt;print(bcrypt.hashpw(b'demo1234',bcrypt.gensalt()).decode())"
UPDATE tenant_demobankpakistan.users
SET password_hash = '<new_bcrypt_hash>'
WHERE email = 'hassan@demobank.com';
```

## Note on encrypted credentials

Integration credentials (WinRM/SSH/DB passwords entered in the Connect Wizard)
are Fernet-encrypted with the backend `SESSION_SECRET`. The bundled `.env` keeps
the **same** dev `SESSION_SECRET` that produced this dump, so they stay
readable. If you change `SESSION_SECRET`, expect to re-enter those credentials.
