# Compliverse — PostgreSQL DB Dump

Full snapshot of the Compliverse demo database, split into ~100 MB chunks because GitHub rejects single files larger than 100 MB.

> ⚠ **This dump contains test/demo PII** (test user emails, hashed passwords, 78k audit log rows, Fernet-encrypted credentials). Do not point production at it. Replace all secrets after restoring.

## Contents

- `compliverse.sql.gz.part-aa` (~95 MB)
- `compliverse.sql.gz.part-ab` (~8 MB)
- Total uncompressed: ~271 MB across 291 tables and 5 tenant schemas.
- Highlights: 5,385 CIS plugins across Windows / Linux / Cisco / AWS / Oracle, framework definitions, all module schemas.

## Restore on Linux / macOS / WSL

```bash
# 1. Recombine + decompress the chunks
cat compliverse.sql.gz.part-* | gunzip > compliverse.sql

# 2. Spin up a fresh Postgres 18 (any port — adjust below)
createdb -h 127.0.0.1 -p 5433 -U postgres compliverse

# 3. Restore
psql -h 127.0.0.1 -p 5433 -U postgres -d compliverse -f compliverse.sql
```

## Restore on Windows (PowerShell)

```powershell
# 1. Recombine + decompress (requires gzip — e.g. 7-Zip CLI, Git Bash, or WSL)
cmd /c "copy /b compliverse.sql.gz.part-aa + compliverse.sql.gz.part-ab compliverse.sql.gz"
gzip -d compliverse.sql.gz

# 2. Create DB
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres compliverse

# 3. Restore
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d compliverse -f compliverse.sql
```

## After restoring

The dump includes encrypted credentials and bcrypt-hashed passwords. To get into the demo tenants:

1. Reset a user password via SQL:
   ```sql
   -- Generate a new bcrypt hash for 'demo1234' first:
   --   python -c "import bcrypt;print(bcrypt.hashpw(b'demo1234',bcrypt.gensalt()).decode())"
   UPDATE tenant_ca.users SET password_hash = '<new_bcrypt_hash>' WHERE email = 'hassanai@ca.com';
   ```
2. Or use the auth flow to reset.

The Fernet-encrypted integration credentials will be **unreadable** unless your backend `SESSION_SECRET` matches the one that produced the dump — they were encrypted with the dev SESSION_SECRET. After restore, expect to re-enter Cisco / Oracle / AWS credentials in the Connect Wizard.

## Demo tenants in the dump

| Tenant schema             | Slug          | Notes                     |
|---------------------------|---------------|---------------------------|
| `tenant_layerongroupllc`  | layerongroupllc | Original demo             |
| `tenant_testcorpe2e`      | testcorpe2e   | E2E test tenant           |
| `tenant_acmecorpdemo`     | acmecorpdemo  | ACME demo                 |
| `tenant_globextech`       | globextech    | Globex demo               |
| `tenant_ca`               | ca            | Hassan's primary dev tenant |
