# Risk Posture v2 â€” update on top of CIS_Version_1

This folder ships ONLY the Risk Posture v2 surface. It is meant to be
overlaid on a tenant that already has CIS_Version_1 (or equivalent) running.

## What this adds

### Per-asset detail page (`/risk-posture/asset/{id}`)

A full v2 deep dive with six sections stacked top-to-bottom:

1. **Header** â€” asset score (0â€“100), band pill, data quality %
2. **Business Impact panel** (split-pane left) â€” the human-in-the-loop form:
   Customer-facing toggle, Internet-facing toggle, Regulated data dropdown
   (with `Multiple` option), Operational dependency radio with bank-context
   meanings (dev box, branch network, core bankingâ€¦), C/I/A sliders, audit
   trail notes
3. **Live Preview pane** (split-pane right) â€” recomputes the score live as
   the operator toggles values on the left; shows current vs after-save
   plus a per-vuln re-score list. No data is written until Save is clicked.
4. **Before vs After applying real-world exploit signals** â€” two coloured
   panels shown at the same time. Left: scanner CVSS ranking. Right:
   effective-risk ranking with â–²â–¼ Î” rank arrows. Amber callout names each
   mover and the reason (KEV listed, EPSS%, business impact).
5. **Triage Lens control** â€” three buttons let the operator pick the view:
   Scanner only Â· Effective (recommended) Â· Compare side-by-side. Plus a
   what-if checkbox: "Pretend EPSS + KEV don't exist" to demonstrate how
   much the real-world signals actually move the priority.
6. **Per-vulnerability boxed breakdown** â€” one card per CVE sorted by the
   chosen lens, stamped with `#N by Effective Â· moved up/down from CVSS
   rank #M`. Each card shows Base CVSS / EPSS / KEV / Asset CIA max /
   Business impact, the weighted-base equation in full, and an
   escalation banner when the 0.85 floor fires.

### Dashboard list (`/risk-posture`)
- New green "V2 ENHANCED" callout at the top
- Composite formula text updated to say "30% vulnerabilities (effective)"
- New "Vulnerabilities sub-formula (v2)" line with exact weights and
  escalation rule

### Backend
- `risk_posture/effective_risk.py` â€” pure math formula module
- `risk_posture/external_feeds.py` â€” FIRST.org EPSS + CISA KEV fetchers,
  23-hour in-process cache, urllib only (no new pip deps)
- `risk_posture/router.py` â€” new POST `/risk-posture/asset/{id}/preview`
  endpoint (no-persist before-save)
- `risk_posture/service.py` â€” `_vuln_score()` rewired to use the v2 formula
  and return a `per_vuln` payload with `contributions`, `business_impact_factor`,
  and the explainable English reason
- 5 new columns on `grc_it_assets`: `is_customer_facing`, `is_internet_facing`,
  `regulated_data_type`, `operational_dependency`, `business_impact_notes`
- 10 new columns on `grc_vulnerabilities`: `epss_score`, `epss_percentile`,
  `epss_updated_at`, `kev_flag`, `kev_due_date`, `kev_added_at`,
  `exploit_maturity`, `effective_risk_score`, `effective_risk_reason`,
  `effective_risk_computed_at`

## Install order

This update assumes CIS_Version_1 is already in place. If not, install
that first.

### 1. Apply the migration

```powershell
# Apply the 5+10 column migration
$env:PGPASSWORD = '<your db password>'
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
   -h 127.0.0.1 -p 5433 -U postgres -d compliverse `
   -f migrations\risk_posture_upgrade_2026_06_05.sql
```

The migration is `ALTER TABLE â€¦ ADD COLUMN IF NOT EXISTS` â€” idempotent, safe
to re-run.

### 2. Drop in the files

Overlay this folder onto your repo root. From PowerShell:
```powershell
robocopy . <your-repo-root> /S /XO
```

The MODIFIED files (`models.py`, `schemas.py`, `assets_router.py`,
`vuln_management/routers/vulnerabilities.py`, `lib/api.ts`,
`assets/[id]/page.tsx`) will overwrite. Review with `git diff` before
committing.

### 3. Restart the backend

```powershell
cd .migration-backup\backend
python -m uvicorn main:app --host 0.0.0.0 --port 5000
```

### 4. Smoke test

1. Open `/risk-posture` â€” you should see the green V2 ENHANCED callout.
2. Click any asset row â†’ drilldown â†’ `/risk-posture/asset/{id}`.
3. Verify the six sections (Header Â· Business Impact + Live Preview Â·
   Before vs After Â· Lens control Â· Per-vuln cards Â· Dimension panels).
4. Flip the Lens between Scanner / Effective / Compare. List should resort.
5. Tick "Pretend EPSS + KEV don't exist". Demo or high-EPSS vulns should
   move position.
6. Toggle a Business Impact value (e.g. uncheck Internet-facing). The Live
   Preview pane on the right should show "AFTER YOUR CHANGES" with a delta
   arrow and per-vuln re-scores.

## How the formula works

```
effective_risk = clamp_0_1(
    0.30 Ã— (CVSS / 10)             â† scanner / NVD
  + 0.25 Ã— EPSS_probability         â† FIRST.org daily feed
  + 0.20 Ã— (KEV ? 1 : 0)            â† CISA daily JSON
  + 0.10 Ã— (asset.CIA_max / 5)      â† human-set
  + 0.15 Ã— (business_impact_factor âˆ’ 1)   â† human-set
)

business_impact_factor = MAX(
    is_customer_facing      ? 1.2 : 1.0,
    is_internet_facing      ? 1.3 : 1.0,
    regulated_data_type     âˆˆ {PII, PCI, PHI, Financial, Multiple} ? 1.3-1.4 : 1.0,
    operational_dependency  âˆˆ {low:0.8, medium:1.0, high:1.3, critical:1.5}
)

Escalation rule:
    IF (EPSS â‰¥ 0.7  OR  KEV = true)
       AND (asset.CIA_max â‰¥ 4  OR  business_impact_factor â‰¥ 1.3)
    THEN floor effective_risk at 0.85 â†’ force CRITICAL band
```

Bands: `< 0.40 low Â· 0.40-0.69 medium Â· 0.70-0.84 high Â· â‰¥ 0.85 critical`

## Signal certainty (KEV vs EPSS)

**KEV** = CISA-confirmed real-world attacks happened (binary YES / NO).
**EPSS** = FIRST.org model prediction of likelihood in next 30 days (0â€“100%).
**CVSS** = severity *if* exploited, not whether it *will* be.

When the operator sees a per-vuln card with `KEV YES (CISA actively exploited)`
they're seeing hard evidence, not a guess. EPSS is statistical.

## Single source of vulnerability data

The Risk Posture v2 page reads from the same `grc_vulnerabilities` table the
`/vulnerabilities` registry writes to. Linking to specific assets is via
`grc_vulnerability_asset_links` â€” same rows, same numbers. No copying.

Adding a CVE on `/vulnerabilities` and linking it to an asset (via the asset
detail page's Vulnerabilities tab, or via the bulk-upload CSV) will make it
appear in that asset's Risk Posture v2 view immediately.

## What's deliberately NOT in this drop

Nothing v2-specific should be missing â€” this drop is the complement of
CIS_Version_1. If you want the IT Asset + CIS surface as well, install
CIS_Version_1 first.

## Asset-owner backfill (optional, recommended)

If you upgraded an existing DB and have rows in `grc_it_assets` with
`owner_id = NULL` (left over from before auto-owner was wired), backfill:

```sql
UPDATE grc_it_assets
SET owner_id = (
  SELECT triggered_by_user_id
  FROM grc_compliance_plugin_runs r
  WHERE r.asset_id = grc_it_assets.id
    AND r.triggered_by_user_id IS NOT NULL
  GROUP BY triggered_by_user_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE owner_id IS NULL;
```

This avoids "unowned asset" rows in the runs feed.

## Source-of-truth plan

The original design plan is in `docs/RISK_POSTURE_PLAN.md`. Update that
file rather than spawning new docs.
