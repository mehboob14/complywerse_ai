# 1LINK ERM Framework V2.0 → ComplyVerse demo coverage

Source: `ERM Framework-Scanned.pdf` (1LINK (Pvt) Limited, Sept 2025, Board-approved 05-Nov-2025).

Seed script: `backend/seed_1link_erm_demo.py`

```bash
cd backend
python seed_1link_erm_demo.py seed --tenant 1link
# optional: python seed_1link_erm_demo.py cleanup --tenant 1link
```

## Framework → platform map

| Framework section | What to create in ComplyVerse | Module / path |
|---|---|---|
| Doc itself (ERM Framework V2.0) | Upload as governance **framework** document (confidential) | Governance → Documents |
| §5.2 Board of Directors | Committee `Board of Directors` (type `board`) | Governance → Committees |
| §5.3 BRMITC | Committee `Board Risk Management and IT Committee (BRMITC)` (`risk_committee`, quarterly) + charter notes + sample meetings | Governance → Committees |
| §5.4 MANCOM | Committee `Management Committee (MANCOM)` (`custom`, monthly) | Governance → Committees |
| §5.5 GRCC | Committee `Governance Risk & Compliance Committee (GRCC)` (`compliance_committee`, monthly) + sample meetings | Governance → Committees |
| §5.1 / diagram Control Committee | Committee `Control Committee` (`custom`) | Governance → Committees |
| §5.1 BAC (Board Audit) | Committee `Board Audit Committee (BAC)` (`audit_committee`, quarterly) | Governance → Committees |
| §4.2 / §6–9 risk taxonomy | Sample **1LINK** register risks (Financial / Operational / Compliance / Strategic + sub-categories) | ERM → Risks (register type `1LINK`) |
| §4.5–4.7 assessment / treatment | Inherent/residual scores on 3×3 scale; treatment plans; mitigation actions | ERM → Risks / Mitigation |
| Annexure C – KRI Dashboard | KRIs: Fraud tx %, Cybersecurity incidents, System downtime | ERM → KRIs (+ Governance KPI Report lens) |
| Annexure A – Risk Management Plan | Plan activities as oversight actions / document note (illustrative schedule) | Governance → Committees / Documents |
| Annexure D – Risk Treatment Tracker | Mitigation actions linked to sample risks | ERM → Mitigation Actions |
| §4.9 Risk Reporting pack | Report categories called out for Board / BRMITC / GRCC (Overall, Strategic, Operational, IT, Compliance, Financial, BCP/DR) | Reports + committee meeting packs |
| §4.8 monitoring / appetite | Risk appetite statement notes on sample risks | ERM → Appetite / risk fields |
| §5.9 Risk Champions | Tag users / notes in committee membership (admin assigns champions) | Admin → Users + Committees |
| §11 Communication (monthly GRCC / quarterly BRMITC) | Upcoming meetings scheduled on those committees | Governance → Committees → Meetings |
| Annexure B assessment mechanism | Already built into 1LINK register UI (3×3) | ERM 1LINK fields |
| Annexure E Operational Loss | Upload Excel template as document when available | Governance → Documents / Evidence |
| Annexure F Responsibility Matrix | Upload `.docx` when available; else reference in framework tags | Governance → Documents |

## Manual UI uploads still useful for the demo

1. Upload the scanned PDF on Documents (script also copies it if path is given).
2. Upload any Risk Register workbook (Book4 / 1LINK) via ERM → Risks → 1LINK import.
3. Upload Operational Loss.xlsx and Responsibility Matrix.docx when the client provides the annexure files.
4. Walk KPI Report (`/governance/kpi-report`) after KRIs are seeded.
5. Show RCSA campaigns referencing GRCC’s RCSA / KRI review duty.

## Production note

Keep `ALLOW_ORG_REGISTRATION=0` on production after the demo tenant exists. Create the tenant once with the flag temporarily `1`, then turn it off.
