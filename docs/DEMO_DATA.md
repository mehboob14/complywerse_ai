# Demo Data — bring the dashboards to life

Every dashboard in the app is **fully data-driven**: each module page and the main
dashboard read real rows from the tenant's PostgreSQL database through formula
endpoints. A fresh install has empty tables, so the dashboards show "Not tracked
yet" until you load data.

This guide loads a reversible **demo dataset** (all rows tagged `[DEMO]`) so a new
environment shows populated, realistic dashboards out of the box. It mirrors the
`complyverse` reference tenant.

## Prerequisites

1. Backend set up per **[SETUP.md](SETUP.md)** (PostgreSQL running, `backend/.env`
   configured from `backend/.env.example`).
2. A tenant exists (default slug `complyverse`) with an `admin` user. Tables are
   auto-created on first tenant-DB access (no Alembic).
3. Run everything **from the `backend/` directory** with the environment loaded so
   the seeders can reach the tenant database:

   ```bash
   cd backend
   set -a && . ./.env && set +a          # load DB creds (bash)
   export MSYS_NO_PATHCONV=1             # Git Bash on Windows only
   ```

## 1. Foundation data (run once)

```bash
# Unified control library — the normalized baseline the Control Library,
# Coverage Matrix and Gap Analysis read from (426 sets + ~1,906 standalone).
python seed_normalization_baseline.py

# Workflow engine definitions (approval / review flows).
python seed_workflow_definitions.py
```

## 2. Module demo data — makes every dashboard card show real numbers

Each script is **idempotent and reversible**: `seed` clears its own prior `[DEMO]`
rows then re-inserts; `cleanup` removes them. All accept `--tenant <slug>`
(default `complyverse`).

| Script | Populates the dashboard for |
| --- | --- |
| `seed_demo_governance_docs.py` | Governance (documents, mappings, approvals, reviews, committees, attestations) |
| `seed_demo_erm.py` | Risk / ERM (register, assessments, RCSA, KRIs, appetite, mitigation, incidents) |
| `seed_demo_compliance.py` | Compliance (frameworks, controls, evidence, control library) |
| `seed_demo_it_assets.py` | IT Assets inventory (hygiene, criticality, vulnerability, scan, lifecycle) |
| `seed_demo_asvs.py` | Assessments — ASVS (OWASP application security, L1/L2/L3) |
| `seed_demo_itsecops.py` | Assessments — IT security operations maturity |
| `seed_demo_pdpl.py` | Assessments — Saudi PDPL (privacy) |
| `seed_demo_nca_risk.py` | Assessments — NCA risk register |
| `seed_demo_nca_vuln.py` | Assessments — NCA vulnerability (CVSS) |
| `seed_demo_dpia.py` | Assessments — DPIA / PIA |
| `seed_demo_mobile.py` | Assessments — Mobile (MASVS) |
| `seed_demo_audit.py` | Assessments — audit tracking |
| `seed_demo_rest.py` | Assessments — remaining checklist/tracking types |
| `seed_demo_kpi_history.py` | Cyber Security KPI **trend history** (run LAST — reads the modules above) |

### Seed everything at once

```bash
for s in governance_docs erm compliance it_assets asvs itsecops pdpl \
         nca_risk nca_vuln dpia mobile audit rest; do
  echo "== seeding $s =="
  python "seed_demo_${s}.py" seed --tenant complyverse
done
# KPI trend history reads the live values from the modules above, so seed it last:
python seed_demo_kpi_history.py seed --tenant complyverse
```

### Roll it all back

```bash
for s in governance_docs erm compliance it_assets asvs itsecops pdpl \
         nca_risk nca_vuln dpia mobile audit rest; do
  python "seed_demo_${s}.py" cleanup --tenant complyverse
done
```

## What you should see

After seeding, open the main dashboard (`/dashboard`). Every module card shows a
live score computed server-side from the seeded rows:

- **Governance / Risk / Assets** — radar of section sub-scores
- **Compliance / Assessments** — horizontal bars vs the 85 target line
- **Vulnerabilities / Evidence / Attestation** — severity/status donuts with counts
- **Where to act first** — the weakest areas aggregated across all modules

Change any underlying record and the card, its ring, the readiness average and the
priorities list all recompute on next load — nothing on the dashboard is hardcoded.

> Everything here is demo content tagged `[DEMO]`. Use the `cleanup` commands to
> return the tenant to real production counts.
