# CIS Version 1 â€” complete codebase drop

This folder is a **complete copy** of the IT Asset + CIS surface from
Hassan's branch. No diffs, no patches â€” every file is shipped in full at
its real repo path so you can merge by overlay.

## How to merge

1. Make sure your branch is clean (`git status`).
2. Copy the contents of this folder over the root of your repo:
   ```powershell
   robocopy .\CIS_Version_1_Complete <your-repo-root> /S /XO
   ```
   (or just drag the inner folders into your repo with overwrite.)
3. Run `git diff` â€” every changed file is in this drop. Review, commit.
4. Restore the DB from `db-dump/` per its README (gives you the 5,817
   seeded CIS rules + framework definitions).
5. Replace secrets in `.migration-backup/backend/.env`
   (`DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`).
6. Boot:
   ```powershell
   # Backend
   cd .migration-backup\backend
   python -m uvicorn main:app --host 0.0.0.0 --port 5000

   # Frontend
   pnpm --filter @workspace/grc-frontend run dev
   ```

## What's inside (IT Assets sidebar surface)

| Sidebar item | Page in this drop |
|---|---|
| Inventory | `artifacts/grc-frontend/src/app/(dashboard)/assets/` |
| Compliance Overview | `artifacts/grc-frontend/src/app/(dashboard)/compliance-overview/` |
| Compliance Rules | `artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/library/` |
| Risk Posture (dashboard) | `artifacts/grc-frontend/src/app/(dashboard)/risk-posture/page.tsx` |
| Agents | `artifacts/grc-frontend/src/app/(dashboard)/admin/agents/` |
| Activity feed | `artifacts/grc-frontend/src/app/(dashboard)/my-runs/` |
| Vulnerability Mgmt | `artifacts/grc-frontend/src/app/(dashboard)/vulnerabilities/` |
| Connect Wizard | `artifacts/grc-frontend/src/pages/ConnectWizard.tsx` |

Backend modules:
- `grc/modules/agents/` â€” agent enrollment, heartbeat, job queue
- `grc/modules/compliance_plugins/` â€” CIS rule library + scanners (Windows, Linux, Cisco, AWS, Oracle) + PDF ingestion
- `grc/modules/onboarding/` â€” CIDR bulk discovery
- `grc/modules/vuln_management/` â€” vulnerability registry + asset links
- `grc/modules/risk_posture/` â€” dashboard composite score (the v2 effective-risk module is excluded)
- `agent/` â€” bank-side endpoint + collector agent + installers

## Deliberately NOT in this drop

Risk Posture v2 (effective-risk formula + EPSS/KEV feeds + per-asset detail
page). The v2 columns *exist* in the DB schema and on the models, but no
code in this drop reads or writes them. Treat them as inert.

Files specifically excluded:
- `.migration-backup/backend/grc/modules/risk_posture/effective_risk.py`
- `.migration-backup/backend/grc/modules/risk_posture/external_feeds.py`
- `artifacts/grc-frontend/src/app/(dashboard)/risk-posture/asset/[id]/page.tsx`
- `.migration-backup/backend/migrations/risk_posture_upgrade_2026_06_05.sql`

If you see imports referencing those files in the code you merge, delete
the import â€” they belong to the in-development v2 branch.

## Asset ownership note

Asset auto-discovery (via Connect Wizard or agent heartbeat) now stamps
`owner_id` with the wizard operator / token minter. Earlier rows in the
DB dump may be NULL â€” the included backfill SQL is in
`db-dump/README.md` under "After restoring".

## DB schema note

The dump has 5 extra columns on `grc_it_assets` and 10 on
`grc_vulnerabilities` left over from Risk Posture v2. They are nullable
and inert in this drop. Don't drop them â€” Hassan will use them in v2.
