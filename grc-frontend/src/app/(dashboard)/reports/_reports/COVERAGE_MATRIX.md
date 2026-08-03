# Sidebar ↔ Reports coverage matrix

Source of truth: `Sidebar.tsx` leaves vs `datasets.ts` report datasets.
Status: `covered` | `thin` | `missing` | `N/A` (dashboard / tool / meta / admin).

| Sidebar leaf | Path | Dataset key(s) | Status | Notes |
|---|---|---|---|---|
| Performance Overview | `/dashboard` | — | N/A | Overview only |
| Governance › Overview | `/governance` | — | N/A | Overview only |
| Document Management | `/governance/documents` | `gov_documents`, `exceptions`, `policy_statements` | covered | Exceptions/statements are secondary |
| Committees | `/governance/committees` | `committees`, `oversight_actions` | covered | `committees` deepened (Wave 2): cadence, secretariat, description, updated_at, meeting/action counts |
| KRIs | `/erm/kris` | `kris` | covered | |
| KPI Report | `/governance/kpi-report` | — | N/A | Metrics UI; no tabular register |
| Projects | `/is-projects` | `is_projects` | covered | |
| Risk Management › Overview | `/erm` | — | N/A | Overview only |
| Risk Register | `/erm/risks` | `risks` | covered | server |
| Risk Assessments | `/erm/risk-assessments` | `risk_assessments` | covered | |
| RCSA | `/erm/rcsa` | `rcsa_findings`, `rcsa_campaigns` | covered | module relabeled to Risk Management (Wave 0) |
| Scenario Analysis | `/erm/analytics/scenario` | — | N/A | Tool UI |
| Bow-Tie Analysis | `/erm/analytics/bowtie` | — | N/A | Tool UI |
| Advanced Analytics | `/erm/analytics` | — | N/A | Dashboard |
| Third-Party Vendor Risk | `/vendor-risk` | `vendors`, `vendor_assessments`, `tpra_findings` | covered | `vendors` deepened (Wave 2): contact, website, residual risk, next reassessment date |
| Compliance › Overview | `/compliance` | — | N/A | Overview only |
| Frameworks | `/frameworks/manage` | `frameworks`, `journeys` | covered | `frameworks` rebuilt on real FrameworkResponse fields (Wave 2): short_code, regulator, jurisdiction, is_mandatory/is_custom, control/domain counts |
| Evidence Management | `/evidence` | `evidence`, `audit_packages` | covered | `evidence` deepened (Wave 2): evidence_type, is_stale, owner, collection/expiry dates, linkage counts |
| Access Reviews | `/compliance/access-reviews` | `access_reviews` | covered | Wave 3 — GET `/access-reviews` (campaigns) |
| Regulatory Changes | `/governance/regulatory-changes` | `regulatory_changes` | covered | Deepened (Wave 2): regulatory_body, owner, impact summary, gap/task counts |
| Regulatory Feeds | `/governance/regulatory-feeds` | `regulatory_feeds` | covered | Wave 3 — GET `/governance/regulatory-feeds/items` |
| Assessments › Overview | `/assessments` | — | N/A | Overview only |
| Cyber Security | `/cyber-security` | `assessments_cyber` | covered | Wave 3 — GET `/compliance/assessments` filtered by ASVS/OWASP/mobile/maturity formats |
| NCA | `/nca` | `assessments_nca` | covered | Wave 3 — GET `/compliance/assessments` filtered by `nca_*` formats |
| Digital Ops Maturity | `/assessments/digital_ops_maturity` | `assessments_digital_ops` | covered | Wave 3 |
| DPIA / PIA | `/assessments/dpia` | `assessments_dpia` | covered | Wave 3 |
| Saudi PDPL | `/assessments/pdpl` | `assessments_pdpl` | covered | Wave 3 — explicit `assessment_format` filter bypasses the endpoint's default hide-list |
| BCM › Overview | `/bcm` | — | N/A | Overview only |
| Continuity Plans | `/bcm/plans` | `bcm_plans` | covered | Deepened (Wave 2): business unit, RTO/RPO, testing cadence, BIA/drill counts, approval date |
| Drills & Invocations | `/bcm/drills` | `bcm_drills` | covered | Deepened (Wave 2): plan, source type, effective status, overdue flag, actual start/end, finding count |
| Assurance Overview | `/control-library/assurance` | — | N/A | Overview only |
| Controls Overview | `/controls/overview` | — | N/A | Overview only |
| Control Catalog | `/controls` | `controls`, `internal_controls` | covered | `controls` deepened (Wave 2): description (statement), objective |
| Issues | `/issues` | `issues` | covered | server Wave 5; limit raised to 5000, added description/source_type (Wave 2) |
| Incidents | `/erm/incidents` | `incidents` | covered | |
| IT Asset Inventory | `/assets` | `assets` | covered | server |
| IT Asset Discovery | `/asset-discovery` | `discovery_campaigns` | covered | |
| Assets Risk Posture | `/risk-posture` | — | N/A | Score/posture UI |
| Criticality Assessments | `/assets/criticality-assessments` | `criticality_info`, `criticality_infra` | covered | Deepened (Wave 2): total score, criticality level, approval status, owners/custodians, assessment date |
| Vulnerabilities | `/vulnerabilities` | `vulnerabilities` | covered | server; FE/BE field alignment (Wave 1): affected_host, assigned_to, discovered_at, resolved_at, vuln_id |
| Auditor Portal › Portal | `/auditor-portal` | `journeys`, `audit_packages` | covered | No dedicated list API — the portal picks a framework from the same certification-journey list (`journeys`) then drills into per-framework tabs; reused rather than duplicated |
| Internal Audit | `/auditor-portal/internal-audit` | `internal_audit` | covered | Wave 3 — GET `/compliance/assessments?assessment_format=ubl_audit_master_tracking` |
| Critical Tasks | `/tasks` | `tasks` | covered | server Wave 5; limit raised to 5000 (Wave 2) |
| Reports › Workspace | `/reports` | — | N/A | Meta |
| Reports › Saved reports | `/reports/saved` | — | N/A | Meta |
| Administration › * | `/admin…` | — | N/A | Ops, not GRC registers |

## Reports-only datasets (no Sidebar leaf)

| Dataset | Closest path | Notes |
|---|---|---|
| `internal_controls` | `/erm/internal-controls` | Keep in catalog |
| `risk_reviews` | `/erm/reviews` | Keep in catalog |
| `exceptions` | `/governance/exceptions` | Keep in catalog |
| `policy_statements` | `/compliance/statements` | Keep in catalog |
| `audit_packages` | `/evidence/audit-packages` | Nested under Compliance Management module label |
| `ai_risk_assessments` | `/erm/ai-risk-assessment` | Folded into Risk Management module label |

## Module label alignment (Wave 0) — done

| Old `module` | New `module` (Sidebar taxonomy) |
|---|---|
| Controls | Control Testing & Assurance |
| Evidence | Compliance Management |
| Compliance | Compliance Management |
| IT Assets | Cybersecurity Assurance |
| Vulnerabilities | Cybersecurity Assurance |
| Vendor Risk | Third-Party Vendor Risk |
| Issue Management | Issue & Incident Management |
| ERM | Issue & Incident Management |
| Tasks | Critical Tasks |
| BCM | Business Continuity |
| Assessments (RCSA) | Risk Management |
| AI Governance | Risk Management |
| Governance / Risk Management | unchanged |

## Thin datasets (Wave 2) — deepened

`controls`, `evidence`, `bcm_drills`, `bcm_plans`, `criticality_info`, `criticality_infra`, `committees`, `frameworks`, `gov_documents`, `vendors`, `issues`, `tasks`, `regulatory_changes`, `internal_controls` (already rich, no change needed)

Also fixed several columns that referenced fields absent from the real list-API response
shape (were always blank): `frameworks.framework_type/status/publisher`,
`gov_documents.document_type/category/version_number`, `committees.status`,
`bcm_plans.plan_type`, `bcm_drills.scheduled_at/outcome`,
`criticality_*.criticality/overall_rating`, `vendors.criticality` (now `tier`).

## Wave 3 — new datasets added

`access_reviews`, `regulatory_feeds`, `assessments_cyber`, `assessments_nca`,
`assessments_digital_ops`, `assessments_dpia`, `assessments_pdpl`, `internal_audit`.

No API found (skipped, none added): none — every Wave 3 target had a real list
endpoint. `auditor_packages` was intentionally **not** added as a separate key;
the Auditor Portal has no register of its own and reuses `journeys` +
`audit_packages` (see notes above).
