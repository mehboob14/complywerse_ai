# Verity Control Plane — Production Architecture

**SCF 2026.2 as canonical catalog · v1.0 · build document**

---

## 1. Verdict

We store SCF 2026.2 verbatim in seven release-versioned catalog tables plus four tenant-overlay tables in each `grc_{slug}` database, and we bridge to the existing platform with exactly one column — `grc_normalized_controls.scf_id` — so that all 19 model files already FK'd to `grc_normalized_controls` (evidence, risks, exceptions, assets, assessments, work items) keep working with zero schema churn. Every connector check stops naming a SOC 2 criterion and instead names one SCF assessment objective (`ao_id`) or control (`scf_id`); all 249 framework views are then index seeks over a single 69,791-row crosswalk table, which is the entire "one control satisfies many requirements" mechanism. Applicability is derived from that same crosswalk — a control is in scope iff it maps to a framework the tenant selected — materialised per scope with a diff-before-commit gate so a recompute can never silently delete a human's accepted N/A justification. Status never overstates: evidence expires on SCF's own `conformity_cadence`, a collector error is `not_assessed` and never `deficient`, a truncated population can never be `satisfactory`, and framework scores are computed over *requirements* with a relationship gate that — because SCF's JSON ships no STRM strength — labels every SCF-derived framework number **indicative / contributes-to**, not compliant.

**We are betting on four things.** (1) That serving a tenant-filtered subset of *unmodified* SCF text under CC BY-ND 4.0 is "reproduction in part" and permitted — this is a legal gate, resolved in writing **before** Phase 1, not an engineering assumption. (2) That a crosswalk is navigation and our own evidence is the assertion — so we ship three numbers per framework and never one. (3) That 43% is the honest automation ceiling (563 Technology + 97 Data of 1,534 controls), so the manual-evidence path is a launch feature, not a follow-up. (4) That every piece of runtime we need already exists in this repo — Celery beat, the runner registry, `NormalizationRun.is_baseline` as a feature flag with a tested cascade delete, `Tenant.settings` as the rollout flag — so this migration adds **zero new infrastructure**.

---

## 2. What we adopt from open source

| Project | What we take | Licence | Where it plugs in |
|---|---|---|---|
| **Secure Controls Framework 2026.2** | The catalog itself: 1,534 controls / 34 domains, 249 real crosswalk keys → **69,791** mapping rows, 5,956 assessment objectives, 316 ERL evidence artifacts, 2,742 compensating alternatives, 11 pre-authored tailoring baselines, per-control `weight` / `pptdf_applicability` / `conformity_cadence` | **CC BY-ND 4.0** — see §11 gate | `seed_data/scf/*`, tables `grc_scf_*`. Text stored **verbatim**, never rewritten |
| **NIST OSCAL + usnistgov/oscal-content** | (a) OSCAL *profile* as the SoA export shape; (b) `assessment-results` / POA&M export shape; (c) 800-53 R5 catalog **text** we can legally ship where SCF gives only identifiers | CC0 / US public domain | Export-only serializer at `/grc/scf/**/export?format=oscal`. **Never** an import source, never internal storage |
| **compliance-trestle** | `trestle.oscal.*` pydantic models as typed serializers — nothing else | Apache-2.0 | The three exporters. Import the models; ignore the CLI, workspace layout and agile-authoring flow |
| **metaschema-framework/oscal-cli** | Schema validation of our exports | CC0-1.0 | CI container step only. No JVM in the FastAPI runtime path |
| **Prowler** | (a) The *pattern*: check metadata names no framework, the mapping file lists check ids; (b) `Remediation.Code.{CLI,Terraform,NativeIaC,Other}` + `Recommendation{Text,Url}` copied verbatim as a check field — we ship nothing equivalent; (c) `prowler/compliance/*.json` (45 AWS files, 24 provider dirs) harvested for *which* cloud checks are worth writing | Apache-2.0 | `seed_data/evidence/checks/<connector>.json`; optional `prowler_runner` |
| **Cloud Custodian (c7n)** | AWS/Azure/GCP/OCI/K8s policy engine, same Python runtime | Apache-2.0 | New `c7n_runner` in `modules/compliance_plugins/runners/`. **Strip or reject any policy with an `actions:` block at load** — this is a read-only evidence platform |
| **cisagov ScubaGear / ScubaGoggles** | M365 (7 services) + Google Workspace baselines, already mapped to 800-53 and ATT&CK | **CC0-1.0** — zero obligation | `scuba_runner`; closes the biggest SaaS evidence gap |
| **ComplianceAsCode/content** | OS hardening rules (RHEL/Ubuntu/Debian/SLES) with rule-level 800-53 refs that bridge into SCF's 777-control 800-53 R5 mapping | BSD-3-Clause | `oscap_runner.py` **already exists** — this is half-wired today |
| **Trivy / Syft / Grype** | Container, IaC, secrets, SBOM, vuln evidence; plus Trivy's `compliance` spec YAML as the file shape for our crosswalk files | Apache-2.0 / MIT | `trivy_runner` |
| **Kubescape regolibrary** | K8s controls with framework memberships | Apache-2.0 | Data for the K8s slice of check bindings |
| **OWASP OpenCRE · CTID Mappings Explorer** | Second-opinion crosswalk rows where SCF is thin (GDPR 42, NIS2 68, ISO 22301 36, SOX 4 controls) | CC0-1.0 / Apache-2.0 | `grc_scf_mapping` rows with `provenance='oss'` — lets us publish crosswalks that are **not** SCF-derived |
| **Probo** | The current 81 common controls | MIT | Retire after Phase 6; keep in git history as rollback |
| **Steampipe · Powerpipe** | **Ideas only**: benchmark = recomputed tree of references (never materialised); one check reused by N frameworks | **AGPL-3.0** | ❌ Never linked, vendored, shelled-out or added to the dependency manifest. §13 triggers on network use; a hosted multi-tenant SaaS is the canonical trigger |
| **sc2in/scf · trycompai/comp** | Endpoint-shape reading only | AGPL-3.0 | ❌ Never copy a line |
| **GSA oscal-ssp-to-word / oscal-sar-to-word** | — | GPL-3.0 | ❌ Not linkable into commercial SaaS. Write the docx ourselves if needed |

### Licensing constraints, stated plainly

**SCF (CC BY-ND 4.0).** Permitted: reproduce and share the licensed material *in whole or in part* with attribution — the Practitioner Guidebook (p.92, GEN-FAQ-006) explicitly names "a GRC platform that includes SCF content" as an intended use. Prohibited: distributing modified material, and — named verbatim — *"utilizing Artificial Intelligence (or similar technologies) to leverage SCF content to generate policies, standards, procedures, metrics, risks, threats or other derivative content."* Engineering rules that follow:

- SCF `description`, `control_question`, AO `objective`, `cmm_levels` are stored **byte-verbatim** and rendered verbatim. No LLM ever rewrites, summarises, translates or paraphrases them into shipped content.
- **No "generate my policy from this control" feature pointed at SCF text.** Generation must run on *our* prose that merely cites an `scf_id`.
- **Never export an OSCAL catalog or profile document containing SCF control text.** A reformatted SCF catalog is the textbook derivative. An SSP / assessment-results / POA&M *about the customer's system* that cites `scf_id` values is a different artifact and is defensible.
- Attribution on every SCF-derived screen and export: *"Control content from the Secure Controls Framework (SCF) 2026.2, © Secure Controls Framework Council, LLC, used under CC BY-ND 4.0"* + link.
- `grc_scf_source.source_key` retains SCF's verbatim column header as the provenance string; our additions (bindings, in-house crosswalks, narratives) live in separately-provenanced rows.
- **Trademark:** "Common Controls Framework" is claimed by the SCF Council with exclusive rights asserted (GEN-FAQ-008). Our Sidebar ships a label literally reading *"Common Controls"* (`Sidebar.tsx:204`, `/automation/common/controls`). Rename to **"Control Library"** — in its own release, not bundled with the cutover.
- Commercial licence if the gate comes back negative: Tier 1 $25,000/yr (50% startup discount year one), Tier 2 $200,000/yr + 20% of net sales.

**Our current, larger, live exposure.** All 35 files in `backend/grc/seed_data/frameworks/` carry a populated `full_text` field on **100% of their 4,022 controls** — verified, not sampled. That includes `iso_27001.json` (93 Annex A controls; ISO grants no redistribution right in any form), `pci_dss.json` (205; PCI SSC requires express written permission), `cis_controls.json` (153; **CC BY-NC-ND** — the NonCommercial term alone bars a paid SaaS regardless of attribution), `hitrust_csf.json` (156 with Control Specification and Level 1/2/3 Implementation text; HITRUST excludes vendors and service providers from being licensed users at all). Plus `seed_data/automation/gap_requirement_texts.json`, whose own README documents AI "re-scoping" of ISO clause text — a self-attested derivative with intent in writing. **This is remediated in Phase 0, blocking, before any SCF code is written**, because SCF's own model is the fix: publish *identifiers*, never prose. That is precisely why SCF can crosswalk to ISO, PCI and HITRUST without a licence from any of them.

---

## 3. Data model

**11 new tables, 3 column adds.** New tables arrive through `Base.metadata.create_all`, which `_ensure_for_engine()` (`modules/compliance/schema_migrations.py:954`) already calls at line 968 via `safe_metadata_create_all(engine, slug=...)` **before** its ALTER pass — so tenant provisioning gets them for free and none needs a `_COLUMN_ADDS` entry on day one. Composite and GIN indexes must be declared in `__table_args__` as `Index(...)`, because `_COLUMN_ADDS`' 4th tuple element (`modules/compliance/schema_migrations.py:157`, currently 344 tuples) supports only a single-column index.

New file: `backend/grc/models/_56_scf_catalog_models.py` (`_55` is the highest taken), one import line appended to `models/__init__.py`.

> **Global vs per-tenant.** This platform is one Postgres DB per tenant (`grc_{slug}`, port 5433). "Global" here means *seeded identically into every tenant DB*, matching how `seed_frameworks.py` already replicates the 35 framework libraries. Catalog cost is ~24 MB per release per tenant DB; at 100 tenants with two resident releases that is ~5 GB of duplicated reference data. Acceptable, and consistent with what we already do. Escape hatch above ~250 tenants: move only `grc_scf_control` / `grc_scf_mapping` / `grc_scf_objective` (never the overlay) into a shared read-only DB, at the cost of cross-DB joins. **Do not pre-build it.**

### 3.1 Catalog (release-versioned, read-only, never updated in place)

**`grc_scf_release`** — ~1 row/release.
`id` · `version VARCHAR(16) UNIQUE` ('2026.2') · `generated_at` · `source_url` · `control_count` · `is_current BOOLEAN` · `imported_at` · `import_checksum VARCHAR(64)` · `import_status VARCHAR(12)` ('importing'|'ready'|'failed').
`ix(is_current)`. **`import_status='ready'` is the gate every `/scf` route checks** — see §4.

**`grc_scf_source`** — **249 SCF keys + ~20 of our own slugs**/release. The crosswalk registry and the only bridge to the framework libraries.
`id` · `release_id` · `source_key VARCHAR(160)` (SCF's verbatim header, e.g. `AICPA TSC 2017:2022 (used for SOC 2)` — the audit trail to the STRM PDF) · `source_slug VARCHAR(64)` (`aicpa_tsc_soc2`) · `display_name` · `region VARCHAR(16)` · `is_overlay BOOLEAN` (PCI SAQ A/A-EP/…, 800-53B baselines, FedRAMP tiers, CIS IG1-3, CMMC L1-3) · `parent_source_slug` · `uploaded_framework_id INTEGER NULL` (→ `grc_uploaded_frameworks.id`, hand-curated once) · **`license_class VARCHAR(20)`** (`'open'|'identifier-only'|'restricted'`) · **`propagate VARCHAR(10)`** (`'strict'|'indicative'`, default `'indicative'`) · `mapped_control_count` · `mapped_requirement_count`.
`UNIQUE(release_id, source_key)`, `ix(release_id, source_slug)`.
- `license_class` is **enforced in the render path**, not by policy memory: a source marked `identifier-only` cannot emit requirement prose from any endpoint. A rule a human must remember is broken by the next framework someone seeds.
- `mapped_control_count` **must be rendered on every framework tile.** `US SOX` is 4 controls / 17 rows; `ISO 22301 2019` is 36. "250 frameworks crosswalked" is not uniform coverage, and a customer opening the SOX view otherwise concludes the product is broken.

**`grc_scf_control`** — **1,534** rows/release.
`id` · `release_id` · `scf_id VARCHAR(16)` · `domain_identifier VARCHAR(8)` (denormalised; every list query filters on it) · `domain_name` · `base_scf_id VARCHAR(16)` (derived: `GOV-01` for `GOV-01.4` — parent/enhancement tree free) · `sort_key VARCHAR(24)` (zero-padded `GOV-001-004`; raw ids sort `GOV-01.10` before `GOV-01.2`) · `name VARCHAR(500)` · `description TEXT` **verbatim** · `control_question TEXT` **verbatim** · `weight SMALLINT` · `is_material BOOLEAN` (weight=10 → **163** rows; also means compensating controls are blocked) · `pptdf VARCHAR(16)` · `conformity_cadence VARCHAR(16)` · `csf_function VARCHAR(16)` · `ao_count SMALLINT` (denormalised — it is the coverage denominator, read on every roll-up) · **`mapped_source_count SMALLINT`** (0 → the orphan bucket, see below) · `baselines JSONB` · `cmm_levels JSONB` · `compensating JSONB` (2 alternative slots folded) · `solutions JSONB` (5 BLS firm-size text blocks) · `risks JSONB` · `threats JSONB` · `risk_if_not_implemented TEXT` · `status VARCHAR(12)` default `'active'` · `superseded_by VARCHAR(16) NULL`.
`UNIQUE(release_id, scf_id)` · `ix(release_id, domain_identifier)` · `ix(release_id, pptdf)` · `ix(release_id, weight)` · `Index('ix_grc_scf_control_baselines','baselines',postgresql_using='gin')`.
> ⚠️ **Never `SELECT *` from a list endpoint.** `cmm_levels` is 7.78 MB of prose across the table (35% of the source file). Project explicit columns or every list view drags TOAST.
> **`mapped_source_count = 0` on exactly 107 controls** (verified): 38 Artificial Intelligence & Autonomous Technologies, 25 Quantum Security, 11 Compliance, 4 Governance, 4 Cloud Security, 3 Data Classification. No framework can ever discharge them. They get their own UI bucket ("in catalog, no framework obligation") and are excluded from every framework denominator by construction — otherwise a baseline overlay pulls them into scope and they permanently depress every score.

**`grc_scf_mapping`** — **69,791** SCF rows + in-house rows/release. The crosswalk; the whole point.
`id BIGSERIAL` · `release_id` · `control_id FK ON DELETE CASCADE` · `scf_id VARCHAR(16)` (denormalised so the seeder and check engine work in text space with no join) · `source_slug VARCHAR(64)` · `requirement_code VARCHAR(96)` · **`relationship VARCHAR(16)`** default `'intersects-with'` (OSCAL 1.2 / STRM vocabulary: `equal-to` | `equivalent-to` | `superset-of` | `subset-of` | `intersects-with` | `no-relationship`) · **`match_mode VARCHAR(8)`** (`'exact'|'parent'`) · **`provenance VARCHAR(12)`** (`'scf'|'resolver'|'human'|'ai'|'oss'`) · `provenance_ref VARCHAR(160)` · **`confidence NUMERIC(3,2)`** default 1.00 · **`pivot_via_slug VARCHAR(64) NULL`** (the transitive bridge, §5) · **`tenant_id INTEGER NULL`** (NULL = shipped global row; non-NULL = this tenant's own crosswalk).
`ix(release_id, source_slug, requirement_code)` answers *which SCF controls satisfy PCI 8.3.1* · `ix(control_id, source_slug)` answers *which frameworks does GOV-01 discharge* · `ix(tenant_id) WHERE tenant_id IS NOT NULL`.
- **Do not insert the 62 `Risk R-*` / `Threat MT-*` marker keys.** They are 100% redundant with the two Summary keys and would add 78,276 dead rows to the hot join. They live in `control.risks` / `control.threats`.
- `tenant_id` is 90% of a graph model's extensibility payoff for one nullable column: a customer's own framework lands as rows invisible to other tenants with no schema change.
- `match_mode='parent'` rows are **excluded from the conformance numerator**. COBIT scores 40/40 only because `APO01` is a string prefix of `APO01.01` — one objective-level row claiming ten practice-level codes. Fine for navigation, indefensible in assurance.

**`grc_scf_objective`** — **5,956** rows/release.
`id` · `release_id` · `control_id FK ON DELETE CASCADE` · `scf_id` · `ao_id VARCHAR(24)` (`AAT-01_A01`) · `seq SMALLINT` (parsed from `_Ann` = display order) · `objective TEXT` **verbatim** · `pptdf` · **`rigor VARCHAR(16)`** · `origin VARCHAR(255)` · `defined_parameters TEXT NULL` (`extra['SCF Defined Parameters (SDP)']`, 503 rows — the org-defined-value tailoring form field) · `source_refs JSONB`.
`UNIQUE(release_id, ao_id)` · `ix(control_id, seq)`.
> `rigor` **must** be VARCHAR: 191 of 5,956 rows carry the string `'NIST 800-171'` where an integer belongs. `int()` crashes the seeder.
> Do **not** create `procedure` / `expected_result` columns — verified NULL on **all 5,956** rows.

**`grc_scf_erl`** (**316**) + **`grc_scf_erl_control`** (**810**) — the manual-evidence taxonomy, and the honest denominator for the 57% of the catalog no connector will ever touch.
`erl`: `id` · `release_id` · `erl_id VARCHAR(16)` · `number` · `area_of_focus` · `artifact VARCHAR(500)` · `description` · `UNIQUE(release_id, erl_id)`.
`erl_control`: `id` · `release_id` · `erl_id` · `scf_id` · `control_id FK` · `link_source VARCHAR(8)` (`'both'|'erl'|'ctrl'`) · `UNIQUE(release_id, erl_id, scf_id)`.

### 3.2 Tenant overlay

**`grc_scf_scope`** — 1–3 rows/tenant. The tailoring profile.
`id` · `tenant_id FK grc_tenants(id)` · `name` ('Enterprise', 'PCI CDE', 'EU Entity') · **`release_id FK`** — *pin the release per scope so a quarterly SCF import never moves an in-flight audit under the auditor* · `parent_id` self-FK · `framework_slugs JSONB` · `framework_obligations JSONB` (slug → `'MCR'|'DSR'`) · `baseline_keys JSONB` · `esp_level SMALLINT` · `firm_size SMALLINT` (1-9 BLS class) · `has_facilities BOOLEAN` · `processes_personal_data BOOLEAN` · `target_cmm SMALLINT` default 3 · `is_default BOOLEAN`.
`UNIQUE(tenant_id, name)`.

**`grc_scf_control_state`** — ≤1,534 rows per scope. Applicability + ownership + designation on one row.
`id` · `tenant_id` · `scope_id FK ON DELETE CASCADE` · **`scf_id VARCHAR(16)`** — *join on the stable TEXT id, never on `grc_scf_control.id`, so a release upgrade cannot orphan the overlay* · `is_applicable BOOLEAN NULL` (NULL = inherit the derived answer; TRUE/FALSE = an explicit human decision that survives re-derivation) · `applicability_source VARCHAR(12)` (`'derived'|'override'|'inherited'|'gate'|'baseline'`) · `applicability_reason TEXT` · `obligation VARCHAR(4)` · `designation VARCHAR(20)` default `'not_assessed'` (`satisfactory|deficient|alternative_control|na|partial|not_assessed` — CDPAS Standard 6.5, not invented) · `designation_source VARCHAR(12)` · `coverage_num SMALLINT` · `coverage_den SMALLINT` · `cmm_actual` · `cmm_target` · `owner_user_id` · `reviewer_user_id` · `alternative_scf_id VARCHAR(16) NULL` · `alternative_justification TEXT` · **`provider_vendor_id INTEGER NULL`** · **`inheritance_type VARCHAR(10)`** (`'full'|'shared'|'customer'`) · `defined_parameters JSONB` (answers keyed by `ao_id`, the 503 SDP objectives) · `linked_evidence_ids JSONB` · **`exception_id INTEGER NULL`** (→ `grc_exceptions.id`) · `last_assessed_at` · `next_due_at` · approval trail copied **verbatim** from `ClauseApplicability` (`models/_17_framework_upload_parsing_models.py:155`): `status` · `requested_by` · `requested_at` · `reviewed_by` · `reviewed_at` · `review_comment` · `created_at`/`updated_at`.
`UNIQUE(tenant_id, scope_id, scf_id)` · `ix(tenant_id, scope_id, designation)` · `ix(tenant_id, is_applicable)` · `ix(tenant_id, next_due_at)`.

Writer-enforced invariants (in the endpoint, **not** DB triggers):
1. `is_material` ⇒ `alternative_scf_id IS NULL`. SCF states this itself on all 163 weight-10 rows: *"Not eligible for a compensating control, due to being a material control (control weighting of 10/10)."* Verified: the 163 weight-10 set is **exactly** the 163 zero-alternative set.
2. **Segregation of duties.** `reviewed_by ∉ {owner_user_id, requested_by}` for any N/A justification, compensating-control justification, or manual designation. Self-approval of scope exclusions is a standard ITGC finding and this is a two-line check.
3. `inheritance_type IS NOT NULL` ⇒ `linked_evidence_ids` non-empty, else the control scores `deficient`. An inherited control with no provider artifact is a lie.

**`grc_scf_check_result`** — the genuinely missing table. Today per-finding `control_codes` die inside `CompliancePluginRun.evidence_snapshot` JSON and nothing ever queries them.
`id BIGSERIAL` · `tenant_id` · `scope_id` · `run_id FK grc_compliance_plugin_runs(id)` · `connector VARCHAR(64)` (`'manual'` for attestations) · **`connection_id INTEGER`** (→ `grc_integration_connections.id`) · **`credential_fingerprint VARCHAR(64)`** · **`granted_scopes JSONB`** · `check_id VARCHAR(128)` · `scf_id VARCHAR(16)` · `ao_id VARCHAR(24) NULL` (NULL = whole-control claim) · **`method VARCHAR(12)`** (`'TEST'|'EXAMINE'|'INTERVIEW'` — NIST 800-53A vocabulary) · `status VARCHAR(10)` (`pass|fail|error`) · `severity VARCHAR(10)` · `resource VARCHAR(255)` · **`population_size INTEGER`** · **`tested_size INTEGER`** · **`truncated BOOLEAN`** · `detail TEXT` · `evidence_id INTEGER NULL` · `collected_at TIMESTAMP` · **`expires_at TIMESTAMP`**.
`ix(tenant_id, scope_id, scf_id, collected_at DESC)` · `ix(tenant_id, run_id)` · `ix(tenant_id, connector, collected_at DESC)`.
- `expires_at = collected_at + window(conformity_cadence)` (Annual 1,292 / Semi-Annual 100 / Quarterly 141). Without this the platform reports green from a token revoked a year ago.
- `connection_id` + `credential_fingerprint` + `granted_scopes` answer *"what could this collector see when it produced this evidence"* — asked in every cloud audit, and unanswerable today because `IntegrationConnection` is mutable.
- `truncated=true` **can never yield `satisfactory`.** The engine runs `MAX_ITEMS=300` with serial pagination, so a `min_count`/`all_true`/`none_match` check against a 400-repo GitHub org tests 300 and today reports pass.
- Volume: ~65→150 connectors × ~4 checks × ~1.5 covers ≈ **400–900 rows per collection cycle per tenant**, not `150 × MAX_ITEMS`. Only the per-check **summary** finding is persisted; per-item findings stay in `evidence_snapshot`.

**`grc_scf_audit_period`** — 1–3 rows/tenant. The gap nothing else closed.
`id` · `tenant_id` · `scope_id FK` · `name` · `framework_slug VARCHAR(64)` · `period_start DATE` · `period_end DATE` · `release_id FK` (pinned) · `status VARCHAR(12)` (`open|fieldwork|closed`) · **`soa_snapshot JSONB`** (the frozen `grc_scf_control_state` applicability rows at freeze time — 1,534 small objects, ~400 KB, TOASTs out) · `frozen_at` · `frozen_by`.
`UNIQUE(tenant_id, scope_id, name)` · `ix(tenant_id, status)`.
Purpose: (a) every roll-up query accepts `as_of`; (b) SoA is frozen, not live, for the period under audit; (c) **retention pruning refuses to touch any `grc_scf_check_result` row whose `collected_at` falls inside an open or fieldwork period.** A SOC 2 Type II opinion rests on the day-by-day record — aggregating it away destroys the evidence.
No snapshot *table*: freezing is one JSONB write, and `as_of` status is a replay of the append-only `grc_scf_check_result`.

### 3.3 The three column adds

Appended to `_COLUMN_ADDS` at `modules/compliance/schema_migrations.py:157`, tuple shape `(table, column, ddl_type, index_name_or_None)`:

```python
("grc_normalized_controls", "scf_id", "VARCHAR(16)", "ix_grc_normalized_controls_scf_id"),
("grc_integration_connections", "last_success_at", "TIMESTAMP", None),
("grc_integration_connections", "last_error", "TEXT", None),
```

1. **The bridge.** `seed_scf.py` emits one `grc_normalized_controls` row per SCF control under `NormalizationRun(label='SCF 2026.2', is_baseline=False)`, `code='SCF-<scf_id>'` (fits `String(50)`; `NormalizedControl.code` is **globally unique**, so the prefix is mandatory), `source='scf'`, `statement=description`, `objective=control_question`, `scf_id=<scf_id>`. Every FK into `grc_normalized_controls` — `grc_exceptions`, `grc_evidence_control_mappings`, `grc_compliance_assessments`, `grc_control_work_items(source_type='normalized')`, `grc_ai_control_proposals`, `grc_internal_control_framework_links` — keeps working. Nothing else in the platform learns the word "SCF".
2–3. **Collection health, separate from control failure.** A revoked OAuth scope, an expired secret or a 429 storm today produces a false deficiency; `last_success_at` gives us *"this connector has not collected successfully in 90 days"* as its own dashboard.

> ⚠️ `_ensure_for_engine()` is memoized per engine id and only marks an engine done when **every** column add succeeds. A single failing entry retries on every request against that tenant — a slow-burn latency regression that looks unrelated. Add these three, ship, watch the logs.

**Deliberately not built:** no `grc_scf_check_binding` table (the binding *is* the `covers` array in the checks JSON, loaded at startup — Powerpipe's benchmark-as-references model; materialising it is what rots). No compensating-alternatives table (2,742 rows folded into JSONB; rendered on one detail page, never joined). No domain table (34 rows; `domain_identifier` + `domain_name` denormalised, `principles`/`intent` in `seed_data/scf/domains.json`). No SoA snapshot table. No OSCAL document store. No graph node/edge tables — text-keyed edges with no enforceable FK on the chain an auditor walks is a correctness regression dressed as flexibility.

---

## 4. Ingestion pipeline

**Source is `JSON/scf-full-2026.2.json` (22,321,928 bytes). Not the OSCAL catalog.** `oscal-catalog-2026.2.json` is 78,686,547 bytes (3.5×), 3.0× more verbose per control (29,906 B vs 9,967 B measured), and **lossy** — it silently drops all 316 ERL entries and all 1,534 compensating controls. OSCAL is our export format, never our import format. `oscal-assessment-plan-2026.2.json` is the same 5,956 objectives wrapped in OSCAL with `procedure`/`expected_result` null — skip it too.

### 4.1 Offline build — `backend/grc/tools/build_scf_seed.py`

Runs on a developer machine, never in the app. Emits compact artifacts into `backend/grc/seed_data/scf/`:

| Artifact | Content |
|---|---|
| `controls.json` | 1,534 controls minus the 333-key mappings dict (~6 MB) |
| `cmm_levels.json` | 7.78 MB of display prose, loaded lazily, never in a list query |
| `mappings.csv.gz` | 69,791 rows: `release_version,scf_id,source_slug,requirement_code,relationship,provenance` |
| `objectives.json` · `erl.json` · `sources.json` · `domains.json` | as named |

**The 22 MB source file never enters the repo and never enters a request path.**

**Eight ingest assertions. Any failure aborts the build.**

1. `len(controls) == metadata['control_count'] == 1534`.
2. Every `scf_id` matches `^[A-Z]{3}-\d{2}(\.\d{1,2})?$`, all unique, and `set(3-letter prefixes) == set(domains[].identifier)`.
3. **`compensating_controls[i]['scf_id'] == controls[i]['scf_control_name']` for all i.** ✅ verified True. This is what proves the column shift is still the same shift and not a fixed export. **Not optional.** The block is shifted by one at *both* levels: top-level `scf_id` holds the control **name**; inside `alternatives[]`, `.trigger` holds the SCF id, `.name` the name, `.id` the **description prose**, `.justification` is the only correct field. **Join by array index.** If SCF fixes this in 2027.x, a naive remap silently inverts and only this assert catches it.
4. `{weight==10} == {zero non-'N/A' alternatives}` — both **163**. ✅ verified equal.
5. Every AO `scf_id` and every `erl.scf_mappings` token resolves. ERL union = **810** pairs (795 control-direction + 797 ERL-direction, 782 intersection). **The only dropped token is `MON-03.2`, which appears in `MON-03.3`'s `erl_reference` where an `E-XXX-NN` belongs.** ✅ verified — exactly one bad token.
6. Exploded mapping rows == **69,791** across **249** real keys (333 union minus `^(Risk |Threat )` and the literals `Control Threat Summary`, `Risk Threat Summary`, `Errata 2026.2`).
7. `mappings` is **sparse** (4–224 keys per control) — iterate the *union* of keys, never `controls[0]`'s.
8. Split values on `'\n'` only. Commas appear in 19 values and are part of codes, never separators.

### 4.2 Runtime load — out of the request path, permanently

**This is the single most likely way this migration takes production down, so it is designed first.**

`safe_metadata_create_all` creates the 11 empty tables at first engine touch — that is DDL, milliseconds, fine. **Nothing else happens inline.** The 81,532-row catalog load runs as:

- **CLI:** `python -m grc.tools.scf_import --tenant <slug> --version 2026.2`
- **Fleet:** Celery task `grc.tasks.scf.fleet_import(version)` fanning out `grc.tasks.scf.import_catalog(slug, version)` per tenant on the existing `parsing` queue.

`celery_app.py` already has Redis broker + backend, late-ack, `reject_on_worker_lost`, prefetch=1, per-task time limits, a `beat_schedule` (line 176) and a `grc/tasks/` package. **Zero new infrastructure.**

The loader writes `grc_scf_release(import_status='importing')` first, uses `psycopg2.copy_expert` for `grc_scf_mapping` (69,791 rows) and `grc_scf_objective` (5,956), then flips to `'ready'` in the same transaction as the final row. **30–90 s per tenant with COPY; a naive ORM insert loop takes 10+ minutes and will be blamed on the provisioning endpoint.**

**Every `/grc/scf/**` route checks for a `ready` release and returns `503 {"status":"not_provisioned"}` if there is none.** The app never seeds inline. `startup_seed.py` is **not** modified to call the SCF loader.

Idempotency: keyed on `(version, import_checksum)`; re-running is a no-op unless `--force`, which deletes the release's rows by `release_id` (`ON DELETE CASCADE` handles children) and re-imports.

### 4.3 The 35 existing framework libraries

They keep their current path — `seed_framework_from_json()` (`seed_frameworks.py:1923`) via `ensure_local_framework_catalog()` (`startup_seed.py:152`) — with two changes:

1. **Phase 0 strips `full_text`** from `iso_27001`, `pci_dss`, `cis_controls`, `hitrust_csf` (and audits the other 31) down to `{control_id, original_reference, domain, source_url}`, driven by `grc_scf_source.license_class='identifier-only'`. Verified: **all 4,022 controls across all 35 files currently carry a populated `full_text`.**
2. **Freeze the 35 filenames for the whole migration.** `framework_exists()` compares `UploadedFramework.name` (`seed_frameworks.py:1886`) and `ensure_local_framework_catalog` diffs seed filenames against existing names — a rename silently reseeds a duplicate framework with 4,022 new parsed-control ids and orphans every applicability and assessment row pointing at the originals.

### 4.4 Version upgrades — designed as an operation, not a schema

SCF ships **~4 releases/year** (Guidebook GEN-FAQ-003). 2026.2 alone added 67 controls and an entire new domain (QTS), renamed 10, reworded 18, and retired none. This path is exercised every 90 days.

1. `build_scf_seed.py` against the new file; all 8 assertions must pass.
2. `grc.tasks.scf.fleet_import('2027.1')` — new `release_id`, nothing updated in place, nothing deleted.
3. Delta computed at import into `grc_scf_release_delta` *(materialised as a JSONB column on `grc_scf_release`, not a table — it is read once per upgrade on one screen)*: `added | retired | renamed | reworded | weight_changed | mapping_changed | domain_added`, seeded from `errata.txt`, which already ships exactly these sections.
4. **Retirement:** an `scf_id` present in release N and absent in N+1 gets a synthesised `status='retired'` row in N+1 carrying `superseded_by` when the errata names a successor — so a tenant's overlay still resolves and the UI reads *"retired in 2027.1, see X"* rather than a dangling reference. Untested against real data (2026.2 retired nothing), so ship it with a hand-built fixture.
5. **Adoption is per-scope and explicit.** `grc_scf_release.is_current` only sets the default for *new* scopes. An existing scope bumps `release_id` deliberately, and **a scope inside an `open` or `fieldwork` audit period cannot be bumped at all.**
6. Purge refuses to drop any release a `grc_scf_scope` or `grc_scf_audit_period` still pins. Keep at most 2–3 resident.

---

## 5. Crosswalk layer

### 5.1 SCF's 249 keys → our frameworks

One registry file, `backend/grc/seed_data/scf/crosswalk_registry.json` — **data, not code**, so a new framework or SCF release is a JSON edit and a re-seed:

```json
{"iso_27001": {"file":"frameworks/iso_27001.json","scf_keys":["ISO 27002 2022"],
  "join_field":"control_id","normalize":["strip_prefix:A."],
  "match_mode":"exact","verified":{"matched":93,"total":93}}}
```

**Exactly 8 normalizer primitives, ~25 lines, applied left-to-right. Do not build a rule engine** — these were verified sufficient across all 18 machine-matchable frameworks:
`squeeze_ws` · `upper` · `strip_prefix:<s>` (`A.`, `DORA-`, `NIS2-`, `§`) · `strip_regex:<re>` (`-POF\d+$` for AICPA, `A$` for SWIFT) · `zero_pad_family` (`AC-1`→`AC-01`, 800-53 only) · `paren_num_to_dot` (`Article 10(1)`→`Article 10.1`, DORA+NIS2) · `article_root` (`^Article \d+`, GDPR fallback) · alias lookup.
`match_mode='parent'`: normalized code `C` matches SCF code `S` when `S==C` or `S` startswith `C+'.'` or `C+'('`.

Resolve **once at seed time** into `grc_scf_mapping` rows. Never normalize at query time.

**Verified baselines — the regression tripwire, printed on every resolver run:**

| Framework | Result | Transform |
|---|---|---|
| `pci_dss` → PCI DSS 4.0.1 | **205/205** | raw exact |
| `nist_800_171` → NIST 800-171 R2 | **110/110** | raw exact |
| `cis_controls` → CIS CSC 8.1 | **153/153** | raw exact |
| `nist_airmf` → NIST AI 100-1 1.0 | **72/72** | raw exact |
| `iso_27001` → **ISO 27002 2022** | **93/93** | `strip_prefix:A.` |
| `nist_800_53` → NIST 800-53 R5 | **148/148** | `zero_pad_family` |
| `iso_42001` → ISO 42001 2023 | **70/70** | join `original_reference`, parent |
| `cobit` → COBIT 2019 | **40/40** | parent — ⚠️ overclaims, see below |
| `mas_trm` → MAS TRM 2021 | 231/236 | raw exact |
| `csa_ccm_v4` → CSA CCM 4.1.0 | 187/197 → **196/197** | 10-entry `IVS-nn`→`I&S-nn` alias |
| `swift_cscf` → SWIFT CSF 2025 | 29/31 | `strip_regex:A$` |
| `soc2` → AICPA TSC | 60/65 | `strip_regex:-POF\d+$` |
| `dora` → EU DORA 2023 | 48/54 | `paren_num_to_dot` |
| `hipaa` → HIPAA Admin Simplification | 56/67 | `§` + whitespace strip |
| `iso_22301` → ISO 22301 2019 | 30/40 | parent |
| `gdpr` → EU GDPR 2016 | 28/35 roots | `article_root` |
| `nis2` → EU NIS2 2022 | 18/30 | `paren_num_to_dot` |

> **These ratios are a snapshot, not proof of correctness.** They assert that a run today reproduces numbers measured today; they cannot distinguish "the mapping is right" from "the mapping is consistently wrong". COBIT's 40/40 is *known overclaiming* — that is why `match_mode` is a column and why parent-matched rows are excluded from the conformance numerator. A green check that includes a known-wrong 100% will not be believed the first time it goes red, so the report prints `exact` and `parent` counts **separately**.

**Two hard-coded traps.**
- **ISO.** `ISO 27001 2022` maps only **51** SCF controls (management clauses 4-10, values like `5.1(e)(1)`). Our `iso_27001.json` is Annex-A-only (93 controls) and scores 12/93 against it, 93/93 against `ISO 27002 2022` (**316** controls). Bind the platform slug `iso27001` to **both** sources with `parent_source_slug`, or the dashboard reads ~3% and looks broken. **Audit all 249 sources for this class of trap before launch.**
- **NIST CSF.** Ours is v1.1 (`ID.BE-2`), SCF maps only CSF 2.0 (`DE.AE-02`, `GV.OC`). Zero-padding scores 18/46 and those 18 are **coincidental** — 2.0 renumbered and dissolved `ID.BE` into `GV.OC`. **Do not machine-map.** Replace the library with CSF 2.0.

### 5.2 Framework-library defects the crosswalk exposed — fix before building on it

- **`sama_csf.json`**: 170 rows, only 81 unique `control_id` values; 20 are literally `'N/A'`; 11 use prose as the id ("Information security function", "SOC description"). The SCF SAMA key is fine; our file is broken. **Re-extract.**
- **`soc2.json`**: 5 of 65 ids are not real AICPA TSC criteria — `CC6.9`, `CC7.6`, `CC9.3`, `A1.4`, `C1.3`. TSC 2017 stops at CC6.8 / CC7.5 / CC9.2 / A1.3 / C1.2. They are exactly the 5 that fail the `-POF`-stripped match. **The crosswalk doubles as a framework-library validator.**
- **`csa_ccm_v4.json` and `gcrf_global_cyber_resilience.json`** self-declare as synthetic paraphrase / pipeline-test content. CCM's *codes* are right (187/197) while the *text* is placeholder — a crosswalk that looks healthy over unusable content. `gcrf` is excluded from the canonical catalog.

### 5.3 The 15 frameworks SCF cannot crosswalk — transitive bridge

SCF has **no key at all** for: `hitrust_csf` (156), `adhics` (162), `doh_adhie_policy` (195), `NDMO` (202), `qcb_technology_risks` (**516 — our single largest file**), `sbp_cloud` (58), `sbp_etgrmf` (262), `sbp_internet_banking` (66), `sl_csf` (79), `pisf_2026` (185), `iso_45001` (36), `aramco_ccc` (35), `sabic_cybertrust` (35), `Regulation on Personal Data Transfer Outside KSA` (21), `gcrf` (75). That is **~1,990 of 4,022 seeded controls (49%)**, disproportionately the GCC/South-Asia regionals that differentiate the product.

**They do not need SCF mappings. They need one edge each to a pivot SCF already covers.** Stored in `grc_scf_mapping` with `pivot_via_slug` set, so the framework view is one SQL shape regardless of who authored the mapping:

```
req(hitrust_csf, 09.ab) --equal--> req(iso_27002_2022, 8.16) <--maps-- ctl(scf, MON-01)
```

**Hop depth is capped at 2 by construction.** `subset-of` is not usefully transitive — A ⊂ B and B ⊂ C does not license claiming A satisfies C. If a customer genuinely needs 3 hops, add a direct row; do not raise the cap.

Three routes, cheapest first, in `backend/grc/seed_data/scf/crosswalks/{slug}_to_scf.json` — **our authorship, our copyright, sidestepping both CC BY-ND and the source frameworks' terms**:

| Route | Frameworks | Method |
|---|---|---|
| **(a) Pivot via ISO 27002** — no AI, no new mapping | hitrust_csf, adhics, pisf_2026, sl_csf, sbp_*, qcb, doh_adhie | All ISO 27002-derived. **First check whether their existing `original_reference`/`parent_section` fields already carry an ISO clause** before generating anything. Reaches SCF through the verified 93/93 ISO 27002 mapping |
| **(b) Hand-curated, human-reviewed** | aramco_ccc (35), sabic_cybertrust (35), KSA transfer (21), NDMO (202) | `provenance='human'` or `'ai'`, `confidence < 1.0`, labelled in the UI. ⚠️ Mapping *our* framework text **to** `scf_id` is fine; generating SCF-derived content is the prohibited act |
| **(c) Keep native, map nothing** | iso_45001 (occupational H&S, out of SCF scope by design), sox (an ITGC set, not a standard), gcrf (synthetic — exclude) | Native controls stay in the same run rather than being dropped |

> **Do not auto-map `aramco_ccc` to `EMEA Saudi Arabia SACS-002 2022` on name similarity.** SACS-002 is the underlying standard (SCF codes it `VII.A.TPC-1..124`); CCC is the certification scheme over it. 0/35 code overlap. Hand-curate or leave it.

**SCF's crosswalk is one vendor's expert judgement and the Guidebook says so (p.12: *"not infallible"*).** AICPA has not blessed the TSC mapping; ISO has not blessed the 27002 mapping. The STRM relationship strength — the thing that says whether a mapping is `equal-to` or merely `intersects-with` — exists **only** in the 249 STRM PDFs, not in the JSON. That is why `relationship` defaults to `intersects-with` and why every SCF-derived framework number is labelled **indicative**. Parsing one STRM PDF later strengthens that framework's numbers as a **data edit with no code change**.

---

## 6. Check & evidence binding

**The rule, one sentence: a check asserts against ONE SCF assessment objective (`ao_id`) or, coarsely, one control (`scf_id`), and never names a framework.** Frameworks inherit status by joining through `grc_scf_mapping`. This is Prowler's and Powerpipe's shared inversion with SCF substituted for their per-framework file.

### 6.1 Today's bottleneck, measured

`seed_data/evidence/connector_checks.json`: 65 connectors, 170 resources, **239 checks** — and the `controls` array on those checks references only **15 distinct SOC 2 codes**. `CC6.1` alone carries **103 of 239 (43%)**. Check kinds: `all_true` 74, `min_count` 52, `none_match` 34, `present` 32, `all_match` 24, `max_count` 12, `all_false` 11.

> ⚠️ **The field is `controls`, not `control_codes`.** Any migration script written against `control_codes` silently matches nothing and produces an empty crosswalk that looks like a successful run.

Worse, those per-finding codes are **thrown away**: `live_api_runner.py:31` collapses the list to `any_fail = any(f['status']=='fail')` → one `RunnerResult`, persisted as `CompliancePluginRun.status` with the findings dumped into `evidence_snapshot` JSON that nothing queries. So status is computed at **connector** granularity — one failing GitHub branch-protection check marks CC6.1 **and** CC6.2 **and** CC8.1 non-compliant, because `_plugins_by_control_code()` (`automation/router.py:239`) indexes each plugin under the *union* `all_control_codes(provider)`.

### 6.2 The new check shape

```json
{"id": "github.org_2fa_required",
 "resource": "org_detail",
 "kind": "all_true",
 "field": "two_factor_required",
 "covers": ["IAC-06_A01", "IAC-06_A02"],
 "severity": "high",
 "remediation": {"cli": "...", "terraform": "...", "console": "...", "url": "..."},
 "controls": ["CC6.1"],
 "title": "Organizations require two-factor authentication",
 "fail_msg": "Organization does not enforce mandatory 2FA for all members"}
```

Disambiguation is free — an AO id always contains `_A`. The legacy `controls` key stays readable for **one release, sunset dated in Phase 8**, and is populated **by derivation** (`scf_id` → `mappings['AICPA TSC 2017:2022 (used for SOC 2)']`), never the reverse.

### 6.3 The 239 `covers` values — the only irreducible manual work

**Auto-migration is forbidden and the numbers prove it.** Reverse-indexing SCF's SOC 2 key: `CC6.1` → **28** SCF controls exact (50 with `-POF` expansion), `A1.2` → 37, `CC7.2` → 16, `CC8.1` → 8. A GitHub 2FA check tagged `CC6.1` would mechanically claim 28 controls including five cryptography controls (`CRY-01`, `CRY-03`, `CRY-05`, `CRY-08`, `CRY-09`). That inflates claimed coverage ~20×.

**Who does it and how a wrong one is caught.** This is a compliance-expert task, not a dev task, and it produces a reviewable artifact committed to git:

`backend/grc/seed_data/evidence/covers_review.csv` — one row per `(check_id, target)`:
`check_id, check_title, target (ao_id|scf_id), target_text (the SCF objective, verbatim), rationale (ours, ≥1 sentence), reviewed_by, reviewed_at`

CI asserts three things, and only the first is a typo check:
1. every `covers` token resolves to a real `scf_id` / `ao_id` in the current release;
2. every token has a **non-empty `rationale`**;
3. every token has a **`reviewed_by` and `reviewed_at`**.

Spot-check protocol: 10% random sample re-reviewed by a second person each quarter, logged in the same file. Prioritise authoring by frequency — the 103 `CC6.1` checks separate cleanly into `IAC-*` (MFA, session, privileged access) and `CRY-*` (encryption) by check title. **Budget: 2–3 engineering days plus a compliance reviewer's sign-off.**

### 6.4 Code changes — one chokepoint, one seam

**`_finding()` at `live_api_catalog.py:111`** is the single function every runner already flows through (`evidence_engine.py:35` hard-imports it, `_eval_check` at `evidence_engine.py:210` builds every finding through it). Current signature:

```python
def _finding(codes, check, resource, status, detail=""): 
    return {"control_codes": list(codes), "check": check, "resource": resource,
            "status": status, "detail": detail}
```

New: add `covers`, `kind` (`'summary'|'item'`), `severity`, `population_size`, `tested_size`, `truncated`; keep `control_codes` populated by derivation. **One function, two files touched.** Then `live_api_runner.py:31` keeps its `any_fail` collapse *and* writes one `grc_scf_check_result` row per `(summary finding × covers entry)`.

**Manual evidence uses the same table.** `POST /grc/scf/scopes/{id}/attest` writes a row with `connector='manual'`, `method='INTERVIEW'` or `'EXAMINE'`, and an `evidence_id`. Manual and automated coverage compose in one roll-up query with **no second code path**. SCF's ERL supplies the artifact to request for the remainder — `MON-01` → `E-MON-01`, `E-MON-06`, `E-MON-07`.

**Config-load failure must be loud.** `_load_connector_checks()` returns `{}` on any parse error today, silently disabling all 239 checks while the UI shows `not_run` rather than `broken`. Raise at startup; keep per-resource *runtime* failure soft.

**Split the spec file before 150.** `connector_checks.json` is already 145,910 bytes at 65 connectors → `seed_data/evidence/checks/<connector>.json`, globbed by the loader.

### 6.5 Scaling to 150+ — transport code vs spec JSON

**Exactly one code seam.** `evidence_engine.py:263`:

```python
def run_connector_checks(provider, spec, creds, base, cdef, transport=http_request):
```

Everything above the transport stays declarative JSON — `resources {path, method, paginate, for_each, fields}` and `checks {kind, field, op, value, covers}`, already proven at 65 connectors / 170 resources / 239 checks. Connectors #66–150 that speak REST + static token need **zero Python**.

**Five transports, ~80–150 lines each. Four need no SDK:**

| Transport | Auth | Notes |
|---|---|---|
| `aws_sdk` | boto3 / SigV4 | The only one needing an SDK. Reuse `aws_runner`'s client construction. **Prefer `sts:AssumeRole` with an `ExternalId` over stored long-lived keys** |
| `azure_arm` | client_credentials → `login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, scope `https://management.azure.com/.default` | then plain REST |
| `msgraph` (Entra) | same token endpoint, scope `https://graph.microsoft.com/.default` | then plain REST |
| `gcp` | service-account JWT → `oauth2.googleapis.com/token` | cloudresourcemanager, compute, iam, logging |
| `k8s` | service-account bearer or client cert | plain REST |

**No schema change for cloud auth.** `IntegrationConnection` (`models/_33_...py:31`, `grc_integration_connections`) already has `encrypted_credentials` (Fernet via `services/connector_credentials.py`), `oauth_tokens` (documented as the OAuth2 access/refresh blob *"so the static client_secret can survive a refresh-token rotation"*), `credentials_extra_json` (already used by the CIS Connect Wizard for Azure/K8s/Postgres/LDAP), `auth_method`, and `assigned_collector_agent_id`. Token caching lives in one helper `_token_for(connection)`.

**Fix in the same change:** `PROVIDER_API['microsoft_365']` verifies against `/me`, which returns 400/403 for the app-only client-credentials token that is the **only** viable auth for tenant-wide Entra evidence — the connector looks connected and returns nothing. Verify path must be `/organization`. Same delegated-vs-app-only trap for `google_workspace` (`/oauth2/v3/userinfo` vs Admin SDK) and `gcp`.

**Rate limiting, same seam:** today `MAX_ITEMS=300`, `MAX_FINDINGS=25`, `MAX_FOREACH=25`, a 15 s urllib timeout, **no 429/Retry-After handling, no backoff, no concurrency** — `_collect_one` paginates serially, so a 400-repo GitHub org does 400 sequential calls. Add Retry-After handling and a per-connector concurrency cap.

**Collapse the second engine.** `aws_runner._evaluate_expectation`'s six kinds (`exists`, `list_nonempty`, `field_equals`, `field_in`, `all_items_field_equals`, `no_items_match`) map onto `evidence_engine`'s seven. Once `aws_sdk` is a transport, delete `_evaluate_expectation` and `_resolve_path` and express AWS checks as ordinary `connector_checks` JSON. **Net −120 lines.**

**New runners slot into the existing registry** (`modules/compliance_plugins/runners/registry.py`, `@register(runner_type)` + `RunnerResult`, 11 already registered including `oscap`): `c7n_runner`, `scuba_runner`, `trivy_runner`. Same signature, same finding shape, same `covers` binding.

---

## 7. Applicability, scope & tailoring

**Vocabulary is SCF's own, not invented** (Guidebook p.21-22): **MCR** = Minimum Compliance Requirements, externally imposed by law/regulation/contract. **DSR** = Discretionary Security Requirements, internally chosen from risk appetite. **MSR = MCR + DSR** = the control set. Published, citable definitions beat anything we design.

**Tenant setup is four questions, not a 1,534-row exercise:** firm size (1-9 BLS class), ESP level (0-3), tick the frameworks, answer *has facilities* / *processes personal data*. That yields (a) the applicable control set, (b) per-control implementation suggestions from SCF's own `solutions` JSONB for that firm size, (c) a target CMM per control.

**Show the common-control multiplier literally:** SOC 2 + ISO 27002 + GDPR + PCI + HIPAA = **663 SCF controls** against ~1,847 requirements — not 5 × 400. Render *"5 frameworks / 1,847 requirements / 663 controls"*.

### Resolution algorithm — `backend/grc/modules/scf/applicability.py`, first match wins

```
0.  HARD GATES (from SCF's own data)
    pptdf='Facility' AND NOT scope.has_facilities
        -> not_applicable, source='gate', "No owned or leased facilities in scope"   [51 controls]
    pptdf='Data' AND NOT scope.processes_personal_data
        -> not_applicable, source='gate'                                              [97 controls]

1.  EXPLICIT: grc_scf_control_state row with is_applicable NOT NULL
        -> return it, source='override'                      # NEVER touched by recompute

2.  INHERITED: walk scope.parent_id; first ancestor with an explicit row
        -> return it, source='inherited'

3.  DERIVED: EXISTS (SELECT 1 FROM grc_scf_mapping m
                     JOIN jsonb_array_elements_text(scope.framework_slugs) f
                       ON f.value = m.source_slug
                     WHERE m.scf_id = ? AND m.release_id = scope.release_id)
        -> applicable
        -> obligation = 'MCR' if ANY matching framework is flagged MCR else 'DSR'

4.  BASELINE OVERLAY: scope.esp_level > 0
                      AND control.baselines contains an ESP level <= scope.esp_level
        -> applicable, obligation='DSR'

5.  else -> not_applicable, source='derived'
```

**Materialise on save, never compute per request.** `POST /grc/scf/scopes/{id}/recompute` writes 1,534 rows in one transaction (sub-second). Two rules:
- `source='override'` rows are **never** touched.
- The endpoint returns a **diff preview by default** and applies only on `?commit=true`: *"adding PCI DSS makes 148 controls newly applicable, 3 previously-N/A controls become applicable."* **A recompute that silently discards a human N/A justification destroys evidence an auditor already accepted.**
- **A scope inside an `open`/`fieldwork` audit period cannot be recomputed** — the frozen `soa_snapshot` is authoritative for that period.

### Baselines — SCF ships them already authored

Verified counts (key **presence** in `extra` is the signal, not the value): `SCF CORE Fundamentals` **68** ⊂ `ESP Level 1 Foundational` **327** ⊂ `ESP Level 2 Critical Infrastructure` **573** ⊂ `ESP Level 3 Advanced Threats` **590** — **strictly nested, zero exceptions**, so one `SMALLINT esp_level` replaces three booleans. Also `AI Model Deployment` 213, `AI-Enabled Operations` 57, `MA&D` 732, `SCRMS` 268, and `SCRM Focus  TIER 1/2/3` 319 / 1,242 / 1,063 — ⚠️ **note the double space** in those three key names.

**Counterexample that will bite:** CIS `IG1(104) ⊂ IG2(208) ⊂ IG3(230)` and PCI `SAQ A(71) ⊂ A-EP(239) ⊂ D-SP(339)` **are** nested, but **NIST 800-53B R5 is not** — low=202, moderate=157, high=89 SCF controls, and low is **not** a subset of moderate. Compute every overlay union explicitly; never derive a higher baseline from a lower one by ordinal assumption.

### Target maturity — orthogonal, never blended

`cmm_target = COALESCE(per-control override, MAX(target across in-scope frameworks mapping this control), scope default)`. Guidebook defaults: **MCR → L3** ("enterprise-wide standardization"), **DSR → L2** (the negligence threshold — *"at L2, practices are formalized to the point that documented evidence exists"*). Never offer L0/L1 as a target; never auto-suggest L5. SCR-CMM is nested, so one integer suffices.

**Maturity is not assurance** — Guidebook p.40 is explicit: *"maturity does not equate to an in-depth analysis of the strength and depth of the control."* A satisfactory control below target reads **"satisfactory, below target maturity"**. One blended number would be indefensible.

### Automation ceiling — say it in the product

`pptdf`: Process **755** · Technology **563** · Data **97** · People **67** · Facility **51** · N/A 1. Only **660 of 1,534 (43%)** are connector-checkable. 822 are Process + People — policy and interview evidence. Set this expectation before anyone promises automation over 1,534 controls.

### Re-attestation clock — with an actual scheduler

`next_due_at = last_assessed_at + conformity_cadence` (Annual 1,292 / Semi-Annual 100 / Quarterly 141), `ix(tenant_id, next_due_at)`. **Fired by a new Celery beat entry** alongside the existing `exception-expiry-daily-sweep` and `vuln-enrichment-daily-refresh` in `celery_app.py:176`:

```python
"scf-attestation-daily-sweep": {"task": "grc.tasks.scf.daily_attestation_sweep",
                                "schedule": 24*60*60, "options": {"queue": "parsing"}},
```

The sweep expires stale evidence, opens attestation tasks for overdue controls with the ERL artifact name attached, and flips controls whose `exception_id` has expired back to `deficient` — reusing the exact pattern of `grc.tasks.exceptions.daily_exception_expiry_sweep`, which already exists. **A `next_due_at` column with nothing pulling from it is a sorted list nobody reads.**

### Exceptions and shared responsibility

- **Exceptions:** `grc_scf_control_state.exception_id` → `grc_exceptions`. A deficient control with an approved, in-date exception renders **"deficient — accepted, expires 2026-11-30"**, is excluded from the *open findings* count, and is **still counted as deficient in the conformity denominator**. An expired exception flips it back automatically via the existing sweep. Without this, the first thing a customer does with a red control is argue about it in a spreadsheet.
- **Shared responsibility:** `provider_vendor_id` + `inheritance_type` (`full|shared|customer`) as real columns, distinct from `alternative_scf_id`. A CSP-inherited control and a compensating control are different assertions with different evidence tests. Counted in the numerator **only** when the provider artifact (their SOC 2 / ISO cert) is actually in the evidence library.

### Statement of Applicability

The SoA **is** an OSCAL profile: `framework_slugs` → `imports`, `is_applicable=true` → `include-controls`, `false` + reason → `exclude-controls` with a `remarks` prop, `cmm_target` → `set-parameter`. `GET /grc/scf/scopes/{id}/soa?format=oscal`.

**Explicit scope boundary — we support `import`, `include-controls`, `exclude-controls`, `set-parameter` and REJECT with a clear error any imported profile using `alter`, `add`, `remove`, `with-child-controls`, or nested profile chains beyond one parent.** Without this refusal list a serializer becomes a resolver over two releases.

---

## 8. Status algebra

Vocabulary is **CDPAS Standard 6.5** (`satisfactory | deficient | alternative_control | na`) plus our `partial` and `not_assessed`. Bands are **CDPAS Standard 8**. Nothing here is invented. Implemented in `backend/grc/modules/scf/rollup.py`, one SQL statement per level, all accepting an optional `as_of` timestamp.

### L0 — CHECK

```sql
SELECT DISTINCT ON (connector, check_id, scf_id, ao_id) *
FROM grc_scf_check_result
WHERE tenant_id=$1 AND scope_id=$2
  AND collected_at <= COALESCE($as_of, now())
  AND expires_at   >  COALESCE($as_of, now())     -- STALENESS GATE
ORDER BY connector, check_id, scf_id, ao_id, collected_at DESC;
```

Three rules that stop the platform lying:
- **`now() > expires_at` → `not_assessed`, regardless of the recorded result.** A check that passed 400 days ago on a since-revoked token is not evidence.
- **`status='error'` → `not_assessed`, never `deficient`.** A broken collector is not a control failure. It surfaces separately via `grc_integration_connections.last_success_at`.
- **`truncated=true` → cannot yield `satisfactory`.** Best case `partial`, with `tested_size / population_size` rendered. An auditor's first question about any automated test is *"was the population complete"*.

`connector='manual'` rows are ordinary L0 rows.

### L1 — ASSESSMENT OBJECTIVE (`ao_id`)

```
any deficient        -> deficient
else any error       -> not_assessed          # never deficient
else any satisfactory-> satisfactory
else no rows         -> not_assessed          # a fresh tenant is unassessed, not failing
```
A manual attestation may write `alternative_control` or `na` directly on an AO.

### L2 — CONTROL (`scf_id`), CDPAS 6.5(2) verbatim

```
applicable_aos = grc_scf_control.ao_count  minus AOs explicitly marked na
covered_aos    = distinct AOs with >=1 non-expired L0 row
coverage       = covered_aos / applicable_aos        -- cached to coverage_num/coverage_den

if not applicable                                          -> na
elif approved non-material alternative WITH evidence       -> alternative_control
elif any applicable AO deficient                           -> deficient
elif covered_aos = 0                                       -> not_assessed
elif covered_aos < applicable_aos                          -> partial
elif all applicable AOs in {satisfactory, alternative_control, na} and >=1 satisfactory
                                                           -> satisfactory
elif all applicable AOs are na                             -> na
```
Controls with `ao_count = 0`, or checks bound at whole-control granularity (`ao_id IS NULL`), fall back to worst-of over their L0 rows, then to the manually entered designation.

> **Coverage is granularity, not rigor — surface the caveat.** Verified: **447 of 1,534 controls have exactly ONE assessment objective** (max 65, mean 3.88). A 1-AO control reaches `coverage=1.0` from a single connector check; `IAO-03` with 65 AOs can never leave `partial`. And **`procedure` and `expected_result` are NULL on all 5,956 AOs** — "this check satisfies this objective" is entirely *our* assertion with no published test step behind it. That is why every binding carries a signed rationale (§6.3), and why the control screen renders `covered / total (N objectives)` rather than a bare percentage.

### L3 — FRAMEWORK REQUIREMENT `(source_slug, requirement_code)`

```
S = { c : grc_scf_mapping(release_id=scope.release_id, source_slug=$1,
                          requirement_code=$2, scf_id=c)
          AND state(scope,c).is_applicable
          AND state(scope,c).designation <> 'na' }

if S empty                          -> not_mapped        # excluded from every denominator, but REPORTED

RELATIONSHIP GATE:
    a control propagates 'satisfied' only when its mapping row has
        relationship IN ('equal-to','equivalent-to','superset-of')
        AND match_mode = 'exact'
    otherwise it propagates at most 'contributes'

any c deficient                                   -> deficient
elif any c in {partial, not_assessed}             -> partial
elif all c in {satisfactory, alternative_control} -> satisfied
```

**AND-semantics is mandatory.** A requirement is satisfied only when **all** its in-scope mapped controls are — never any-of. Measured `requirement → control` fan-out across the 38,410 distinct requirement nodes: **mean 1.82, median 1, p95 5, max 65.** Cheap for the median requirement, correctly brutal for the 65-way one. Any-of semantics would let one connector check mark an entire GDPR article compliant.

**Because SCF ships no STRM strength, every SCF-derived row is `intersects-with` and can only ever propagate `contributes`.** The UI label is **"contributes to"**, the framework number is badged **INDICATIVE**, and this is enforced in the query, not by discipline.

### L4 — FRAMEWORK SCORE (CDPAS Standard 8), computed over **REQUIREMENTS**

```
D = in-scope requirements of F with status NOT IN ('na','not_mapped')
N = requirements with status = 'satisfied'
conformity = N / D

BAND  (material override checked FIRST, wins regardless of percentage):
  any control in D with is_material AND designation='deficient' -> MATERIAL_WEAKNESS
  conformity = 1.00                                             -> STRICTLY_CONFORMS
  conformity >= 0.80                                            -> CONFORMS
  conformity >= 0.70                                            -> SIGNIFICANT_DEFICIENCY
  else                                                          -> MATERIAL_WEAKNESS
```

A QSA scores PCI 8.3.1, not SCF `IAC-06`. A control-level denominator would let one control mapped to 40 requirements swing the score 40× its true weight — `ctl → req` fan-out is mean **48.9**, max **1,244**.

### Publish THREE numbers per framework, never one

| Number | Formula | Role |
|---|---|---|
| **Conformity %** | `N / D` above | Headline. Unweighted, explainable to an auditor |
| **Risk-weighted %** | `SUM(weight) over N / SUM(weight) over D` | Offered, never headline. SCF's own 1-10 weights, so one failed weight-10 control visibly outweighs ten weight-2s. A weighted-only percentage is unexplainable |
| **Automation coverage %** | applicable AOs with ≥1 non-manual L0 row / applicable AOs | Measured at **AO** level. Control level inflates it — 15 SOC 2 codes "touch" 232 SCF controls but nowhere near prove them |

Plus **maturity** as a fourth, orthogonal axis, never folded in.

**`not_assessed` is always its own third bar. Never silently rolled into fail.** A fresh tenant is 0% assessed, not 0% compliant.

### Write path and the day-one number

`rollup.py` recomputes L1/L2 for the affected `scf_id`s at the end of every plugin run and every manual attestation, caching `designation` + `coverage_num/den` onto `grc_scf_control_state`. L3/L4 are pure SELECTs over that cache joined to `grc_scf_mapping` — **no materialised framework tables**, Powerpipe-style: the benchmark is a tree of references recomputed at query time.

> **Compute the real day-one conformity number before Phase 6, with `scripts/scf_dry_run_score.py`, on a real tenant.** Today's 239 checks reach 15 SOC 2 criteria touching ~232 of 1,534 SCF controls. If the honest conformity lands in single digits, every tenant flips into `MATERIAL_WEAKNESS` the day the flag turns on and the correctness of the algebra is irrelevant. If that is the result, the `not_assessed` third bar is not a UI nicety — it is the only thing that makes the screen truthful, and the launch messaging must lead with automation coverage, not conformity.

### The one runnable check

`assert`-based `demo()` in `rollup.py`, no framework, no fixtures:

```
Fixture control, 4 AOs: 1 pass · 1 fail · 1 manual attestation · 1 uncovered
  => designation 'deficient', coverage 3/4
Flip the failing AO to pass
  => 'partial', NOT 'satisfactory'
Age the passing rows past expires_at
  => 'not_assessed', NOT 'satisfactory'
Set truncated=true on the passing summary
  => never 'satisfactory'
```

That single assertion is what stops the roll-up silently over-claiming.

---

## 9. API + UI surface

### Backend — new: `backend/grc/modules/scf/{__init__,router,applicability,rollup,exporters}.py`, mounted in `main.py`

| Route | Purpose |
|---|---|
| `GET /grc/scf/controls` | Catalog list. Filters: domain, pptdf, weight, baseline, designation, applicable. **Explicit column projection — never `SELECT *`** |
| `GET /grc/scf/controls/{scf_id}` | Detail: description, control_question, AOs, ERL artifacts, mappings grouped by source, CMM levels (lazy), compensating alternatives, firm-size solutions |
| `GET /grc/scf/controls/orphans` | The **107** controls with no framework mapping |
| `GET /grc/scf/frameworks` | 249-source registry with `mapped_control_count` + the three coverage numbers |
| `GET /grc/scf/frameworks/{slug}` | Requirement-level L3 status |
| `GET/POST/PUT /grc/scf/scopes` | Tailoring profiles |
| `POST /grc/scf/scopes/{id}/recompute` | Diff preview; applies on `?commit=true` |
| `PUT /grc/scf/scopes/{id}/controls/{scf_id}` | Applicability + designation. Enforces material/compensating and SoD |
| `POST /grc/scf/scopes/{id}/attest` | Manual evidence → `grc_scf_check_result(connector='manual')` |
| `GET /grc/scf/scopes/{id}/evidence-requests` | ERL-driven manual queue, `next_due_at` ordered |
| `GET/POST /grc/scf/audit-periods` · `POST /{id}/freeze` | Period model + SoA freeze |
| `GET /grc/scf/scopes/{id}/soa?format=oscal\|xlsx` | Statement of Applicability |
| `GET /grc/scf/exports/assessment-results?run_id=` · `/ssp` · `/poam` | OSCAL exporters, generated on demand. **Never an SCF catalog or profile containing SCF text** |
| `GET /grc/scf/health/collectors` | `last_success_at` per connection — collection health, separate from control status |

All return `503 {"status":"not_provisioned"}` when no `grc_scf_release` has `import_status='ready'`.

### Frontend — new: `grc-frontend/src/app/(dashboard)/scf/`

`page.tsx` (control library) · `[scf_id]/page.tsx` (detail) · `scope/page.tsx` (four-question wizard + recompute diff) · `frameworks/page.tsx` · `frameworks/[slug]/page.tsx` · `evidence-requests/page.tsx` (the ERL manual queue — **ships with the cutover, not after**) · `audit-periods/page.tsx`.
Reuse `grc-frontend/src/components/soc2/ui.tsx` — already the right presentational vocabulary. Sidebar entries gated on `Tenant.settings['control_library'] === 'scf'` (`models/_01_multi_tenancy_models.py:17` — already a JSON column, no new table).

### Changed

| Where | Change |
|---|---|
| `runners/live_api_catalog.py:111` `_finding()` | New fields; the single chokepoint |
| `runners/live_api_runner.py:31` | Persist summary findings to `grc_scf_check_result` |
| `runners/evidence_engine.py:263` | `transport=` parameter |
| `automation/router.py:239` `_plugins_by_control_code` / `:598` `list_controls` | Read `grc_scf_check_result` + `grc_scf_mapping`. Deleted in Phase 8 |
| `seed_data/evidence/connector_checks.json` | → `checks/<connector>.json` with `covers` |
| `seed_data/frameworks/*.json` | `full_text` stripped, Phase 0 |

### Retired

| What | Why |
|---|---|
| `lib_router` + `GET /automation/{framework}/{controls,criteria}` (`automation/router.py:63, 574-655`) | **Zero frontend callers** (repo-wide grep) |
| `automationApi.listControls` / `listCriteria` (`lib/api.ts:4999-5006`) | same |
| `seed_data/automation/{soc2,iso27001,gdpr}/` | Serving the above; removes the old crosswalk indirection **before** SCF arrives |
| `seed_data/automation/gap_requirement_texts.json` | AI-reconstructed ISO clauses — self-attested derivative |
| Sidebar `/frameworks`, `/controls`, `/control-library` (`Sidebar.tsx:155-157, 194-196`) | **Nav hidden, routes kept mounted** |

> **Hide nav, keep routes.** Unregistering routers in `main.py` turns a nav change into a 404 storm inside pages that are still bundled and still reachable by URL from old emails, saved reports and audit packages. Un-hiding is a one-line revert.

### The sunset clause — because the repo must eventually get smaller

Every "kept for now" item has a named deletion condition, written into the phase tickets, not left to memory:

| Kept | Deleted when |
|---|---|
| Legacy `controls` key on all 239 checks | **90 days** after Phase 6 completes fleet-wide |
| `automation/router.py::_plugins_by_control_code` + union-based `PluginControlMapping` seeding | Phase 8, immediately after the reader flip is stable |
| `aws_runner._evaluate_expectation` / `_resolve_path` | Phase 8, when `aws_sdk` is a transport (−120 lines) |
| `/frameworks`, `/controls`, `/control-library` routers + pages | **Zero tenants on `control_library != 'scf'` for 90 consecutive days**, measured by a metric, not a feeling |
| The 2,332-row `normalization_baseline.json` run | Never deleted while any tenant row still points at it — but stops being seeded into **new** tenants at Phase 6 |

---

## 10. Phased migration plan

Phases −1 through 5 are each independently releasable **and** independently revertable, and none changes what a user sees. Only 6 and 7 need the tenant flag.

---

**PHASE −1 · LICENCE GATE (blocking, no code)**
Email the SCF Council describing exactly what we render: *unmodified SCF control text, filtered by tenant scope, with adjacent tenant status columns, in a paid multi-tenant SaaS, with attribution on every screen and export.* The question is narrow and answerable in an email: is that "reproduction in part" (permitted) or Adapted Material (prohibited)? They run an SCF Marketplace of GRC tools; this is a routine ask. **Sequencing this after the seeder exists is the wrong order for a dependency priced at $25k/yr Tier 1 and $200k/yr + 20% of net sales Tier 2.** Pin a dated copy of the terms with each ingested version.
*Rollback:* n/a. *Exit criterion:* written answer, or a signed commercial licence.

---

**PHASE 0 · LICENCE REMEDIATION + THE LIVE BUG (no flag, ships alone)**
This is the **largest live exposure in the repo today** and it is entirely independent of SCF, so it goes first — the migration is the excuse to do it, and later phases slip.
- Strip `full_text` from all 35 `seed_data/frameworks/*.json` (**4,022 controls, 100% currently populated**) down to `{control_id, original_reference, domain, source_url}`, starting with `iso_27001`, `pci_dss`, `cis_controls`, `hitrust_csf`.
- Delete `seed_data/automation/gap_requirement_texts.json`.
- **Fix the live bug:** `modules/compliance_plugins/seed_soc2_connectors.py:97` resolves controls with `db.query(FrameworkControl).filter(FrameworkControl.code == code).first()` and `continue`s on miss. `grc_framework_controls` is **empty on every tenant that never used the publish-framework flow**, because `seed_frameworks()` returns at `seed_frameworks.py:165` after printing *"Pre-seeded frameworks disabled"* — everything below line 174 is unreachable. So `POST /grc/automation/soc2/seed` silently returns `framework_mappings_created=0`. Point it at `ParsedFrameworkControl` and scope by framework so a bare-code `.first()` stops being ambiguous.
*Verify:* that count stops being 0. *Rollback:* git revert. *Tenant data:* untouched.

---

**PHASE 1 · DELETE DEAD WEIGHT (no flag)**
Remove `lib_router` + its two endpoints, the `api.ts` definitions, the `automation_frameworks_router` include in `main.py:271`, and `seed_data/automation/{soc2,iso27001,gdpr}/`. Verified zero callers. **This removes the old crosswalk indirection before SCF arrives so you never migrate two mapping schemes at once.**
*Rollback:* git revert. *Tenant data:* untouched.

---

**PHASE 2 · BUILD THE SEED ARTIFACTS (offline, nothing deployed)**
Write `backend/grc/tools/build_scf_seed.py`; run against the 22 MB source; commit `seed_data/scf/*` and `crosswalk_registry.json`. All 8 assertions green. Write the resolver and its coverage report — with `exact` and `parent` counts printed **separately**.
Also in this phase: **re-extract `sama_csf.json`, delete the 5 invented `soc2.json` criteria, replace `nist_csf.json` with CSF 2.0.** These cost more than the mapping code does and the crosswalk is what exposed them.
*Rollback:* delete the files. *Tenant data:* untouched.

---

**PHASE 3 · SCF IMPORT, INVISIBLE**
Add `models/_56_scf_catalog_models.py` (11 tables, `create_all` handles them) + the 3 `_COLUMN_ADDS` tuples. Add `backend/grc/tools/scf_import.py` and `grc/tasks/scf.py`. **Not called from `startup_seed.py`.** Run `grc.tasks.scf.fleet_import('2026.2')` out of band. It writes the catalog with COPY and emits the bridge `NormalizationRun(label='SCF 2026.2', is_baseline=False)` with 1,534 `grc_normalized_controls` rows coded `SCF-<scf_id>`.
Both libraries now coexist; the old 2,332-row baseline is still `is_baseline=True`, so every existing page renders byte-identically.
*Verify:* SQL counts 1,534 / 5,956 / 69,791 / 810 / 316 / 249, `import_status='ready'`.
*Rollback:* `DELETE FROM grc_scf_release WHERE version='2026.2'` (cascades) + drop the bridge run using the existing cascade sequence at `control_library/routers/groups.py:567-590`.
> ⚠️ **`NormalizedControl.code` is globally unique**, not per-run. The `SCF-` prefix is mandatory or a re-import raises `IntegrityError` partway and leaves a half-populated run. Wrap in one transaction; key idempotency on the release row.

---

**PHASE 4 · BIND THE CHECKS (data-only, reversible)**
Change `_finding()`. Split `connector_checks.json` into `checks/<connector>.json`. Hand-author `covers` on all 239 checks with `covers_review.csv` (§6.3). Add the `grc_scf_check_result` write for `kind='summary'`. Add the 3-part CI assertion. Make config-load failure loud.
The legacy `controls` array stays and stays populated by derivation, so `automation/router.py:239` and the existing `/automation/soc2-controls` UI are untouched. **Finding-level, control-level data exists for the first time and can be compared side-by-side against the old connector-level aggregate.**
*Rollback:* stop reading the new table.

---

**PHASE 5 · BUILD THE SURFACE (behind the flag, pilot tenant only)**
`modules/scf/*` + the `(dashboard)/scf/` pages including the ERL evidence-request queue and audit periods. Add the Celery beat entry for the attestation sweep. Gate the Sidebar on `Tenant.settings['control_library']=='scf'`.
**Run `scripts/scf_dry_run_score.py` here.** If day-one conformity is single digits, adjust launch messaging *before* anyone sees a screen.
*Rollback:* flip the settings key.

---

**PHASE 6 · FLIP THE LIBRARY (the only user-visible change)**
Two UPDATEs in one transaction: `is_baseline=false` on the old run, `true` on the SCF run. `control_library/routers/groups.py:549` (`ORDER BY is_baseline DESC, id DESC`) picks it up immediately and every consumer follows.
**Backfills, all additive — new rows, never in-place updates, so the old rows are the rollback:**
- `grc_evidence_control_mappings`: walk each row's `parsed_control_id` → `grc_scf_mapping` → the SCF bridge NC, **write a new row**. The table already carries `normalized_control_id`, `framework_control_id`, `parsed_control_id`, `uploaded_framework_id` **and** a denormalised `control_code`, so it survives a spine change by design.
- `grc_clause_applicability` → `grc_scf_control_state`: forward-map `is_applicable` / `justification` / `owner_id`. **Where SCF maps N parsed controls to one SCF control and they disagree, take the union (applicable wins) and set `status='pending'` so a human re-approves. Never silently resolve a conflict in a Statement of Applicability.**
- `grc_control_work_items`: create new rows for the SCF bridge NCs. `UniqueConstraint(tenant_id, source_type, source_id)` permits both; the old rows keep their tests, evidence, escalations and assurance snapshots so **no audit history moves**.
*Rollback:* the same two UPDATEs reversed. **No data is deleted at any point.**
> ⚠️ **Operational landmine:** `ensure_static_control_library_baseline()` bails early on `status='completed' AND is_baseline=True` (`startup_seed.py:196-202`). After the flip the SCF run satisfies that guard, so it stays a no-op. But if someone rolls back `is_baseline` **and then** deletes the SCF run, the guard passes and startup regenerates the 2,332-row baseline into a **third** run. **Delete-run and flip-baseline must never both be available in the same operator command.**

---

**PHASE 7 · HIDE THE COMPLIANCE MODULE**
Sidebar entries only, behind the same tenant setting. Routers stay mounted.
*Rollback:* one line.
> Ship 6 and 7 close together, or gate the new roll-up behind the flag — while `grc_scf_check_result` exists but `list_controls` still reads `_plugins_by_control_code`, the platform shows two different answers for the same control.

---

**PHASE 8 · SCALE + DELETE**
`transport=` parameter; the five transports; the `/me` → `/organization` fix; 429/Retry-After + concurrency cap; delete `aws_runner._evaluate_expectation` and `_resolve_path`; author connectors #66-150 as JSON; layer `c7n_runner`, `scuba_runner`, `oscap_runner`, `trivy_runner`. Then execute the §9 sunset clause. Rename "Common Controls" → "Control Library" **in its own release** — the SOC 2 naming (`/automation/soc2-controls`, `components/soc2/ui.tsx`, `_soc2_plugins()`) is cosmetic and multiplies the blast radius if bundled.

---

### One verify function for the whole migration

`verify_scf_cutover(db, tenant_id)` in `modules/scf/rollup.py`, run **before and after** every flip. A non-zero orphan count is the abort signal.

```
(a) exactly one NormalizationRun has is_baseline=TRUE
(b) SELECT count(*) FROM grc_evidence_control_mappings
      WHERE normalized_control_id IS NOT NULL
        AND normalized_control_id NOT IN (SELECT id FROM grc_normalized_controls)  == 0
    ... same orphan check for grc_exceptions, grc_compliance_assessments,
        grc_control_work_items
(c) SCF bridge NC count == 1534 == grc_scf_control count for the current release
(d) grc_scf_mapping (provenance='scf') count == 69791
(e) every `covers` token in checks/*.json resolves
(f) no grc_scf_check_result row inside an open audit period has been pruned
```

---

## 11. Risks & open decisions

### Decisions the user must make

| # | Decision | Why it cannot wait |
|---|---|---|
| **D1** | **SCF licensing — written confirmation or a commercial licence.** Is a tenant-filtered subset of unmodified SCF text in a paid multi-tenant SaaS "reproduction in part"? | Phase −1 gate. The catalog is the product's core asset. $25k/yr Tier 1, $200k/yr + 20% net sales Tier 2 if the answer is negative |
| **D2** | **Six framework libraries are behind SCF's mapped versions.** `nist_csf` v1.1 vs 2.0, `nist_800_171` R2 vs R3, `cis_controls` 8.0 vs 8.1, `csa_ccm_v4` 4.0 vs 4.1.0, `sama_csf` 2023 vs 2017, `swift_cscf` 2024 vs 2025. Upgrade the libraries, or accept partial crosswalk and say so on the tile? | **The single largest hidden cost in the migration.** Cross-version mapping is not text matching (`PR.AC-1` vs `PR.AA-01`) |
| **D3** | **Who authors and signs the 239 `covers` values**, and who does the quarterly 10% re-review? | 2–3 days of a compliance reviewer's time, not a dev's. Phase 4 blocks on it |
| **D4** | **Day-one conformity acceptance.** If the dry-run says single digits, is the launch story "automation coverage %" with conformity behind a disclosure? | Phase 5. Every tenant otherwise lands in `MATERIAL_WEAKNESS` on flip day |
| **D5** | **Retention policy for `grc_scf_check_result`** outside open audit periods — 90 days hot + monthly rollup, or keep everything? | Largest table in the tenant DB at daily × 3 years × N tenants |
| **D6** | **Do we buy STRM relationship strength?** Parsing the 249 STRM PDFs upgrades framework numbers from *indicative* to *assured* as a pure data edit | Deferred by design. The `relationship` column exists to receive it |
| **D7** | **`gcrf_global_cyber_resilience.json`** self-declares as synthetic — delete or keep excluded? | Phase 2 |

### Risks

**Correctness / audit**
- **Mapping-derived coverage is navigation, not assurance.** SCF says so itself (p.12). An assessor may reject *"SCF says GOV-01 satisfies CC1.1"*. Our evidence and narrative stay the primary assertion. Mitigated by the relationship gate, `match_mode`, the INDICATIVE badge and "contributes to" — but it is a permanent product-communication risk.
- **AO coverage tracks how granularly SCF wrote objectives, not assurance.** 447 controls have 1 AO; `IAO-03` has 65. Mitigated by rendering the AO count next to the fraction and by signed binding rationales.
- **`MAX_ITEMS=300` truncation** exists today and silently reports pass on a 400-repo org. The `truncated` column makes it visible; the concurrency/pagination work in Phase 8 makes it rarer. Between Phase 4 and Phase 8 the honest answer for large populations is `partial`, and that is the correct answer.
- **The 17 baseline ratios are a snapshot, not proof.** They catch drift, not systematic error. COBIT's 40/40 is known overclaiming.
- **The retirement path is untested against real data** — 2026.2 retired nothing. Write it with a hand-built fixture; it will be exercised eventually (NIST 800-53 R4 is already flagged deprecated as a mapping source).

**Data / SCF-specific**
- **The `compensating_controls` column shift** is a real parser bug we correct on ingest, and SCF may *fix* it in 2027.x — at which point a naive remap silently inverts. Assertion 3 is the only guard.
- **`authoritative_sources` is an empty array** (`authoritative_source_count = 0`) despite being a documented key. Nothing may depend on it; `grc_scf_source` is built by grouping the 249 mapping keys ourselves.
- **`mappings` is sparse** (4–224 keys). Any code assuming a fixed 333-column shape breaks on the first control. Same for `extra` — baseline membership is **key presence**, not truthiness, and would break the day SCF writes `'x'` where it currently writes the `scf_id`.
- **Key names drift across releases.** `SWIFT CSF 2025` becomes 2026. The allow-list in `sources.json` is pinned so a rename **breaks the build** rather than silently zeroing a framework's coverage.
- **`~1,990 of 4,022` seeded controls (49%) have no SCF crosswalk.** "SCF crosswalks every framework we support" is false. Plan the hybrid from day one.

**Operational**
- **The catalog load must never re-enter a request path.** `_ensure_for_engine` is memoized per engine and lazy per tenant. The `503 not_provisioned` gate plus the out-of-band importer is the design; the risk is a future contributor "helpfully" adding a seed call to `startup_seed.py`. Put a comment there saying why not.
- **`_COLUMN_ADDS` retry storm:** a single failing entry retries on every request against that tenant and looks like unrelated latency. Three columns; add them once; watch the logs.
- **Provisioning cost:** ~81,500 catalog rows per tenant at 30–90 s with COPY. A naive ORM loop is 10+ minutes and will be blamed on the provisioning endpoint.
- **Framework filenames are frozen** for the migration. A rename silently reseeds a duplicate and orphans every applicability and assessment row.
- **Quarterly cadence means this path runs ~4×/year.** The fleet importer, the delta screen and the per-scope pin are the difference between a routine import and a support incident every 90 days.

**Legal**
- **CIS is CC BY-NC-ND** — NonCommercial alone bars redistribution in a paid product regardless of attribution. **HITRUST excludes vendors and service providers from being licensed users at all** (SimpleRisk publicly cites this as why they never shipped it). **ISO grants no redistribution right in any form. PCI SSC requires express written permission.** None of this is cured by attribution. Phase 0 is not optional cleanup.
- **AGPL is a hard line.** Steampipe, Powerpipe, `sc2in/scf` and `trycompai/comp` are AGPL-3.0 and §13 triggers on network use. Read them; vendor nothing; keep them out of the dependency manifest and the deployed image. Their *mods* and *plugins* are Apache-2.0 and are harvested freely.
- **"Common Controls Framework" is SCF-trademarked** with exclusive rights asserted, while our Sidebar ships a label reading "Common Controls". Small, cheap, entirely avoidable — and awkward precisely when we start shipping SCF content.

---

**Skipped deliberately:** materialised closure/bridge tables, edge-weight columns, a graph database, per-node typed subtables, an OSCAL-native internal model, a `grc_scf_check_binding` table, and separate tables for domains / compensating alternatives / CMM prose. Add the closure table when a framework dashboard is *measurably* slow; add binding rows when a tenant asks to author custom bindings; never add the OSCAL internal model — Defense Unicorns' Lula publicly dropped OSCAL in v2 as *"too complex for most teams"*, and OSCAL belongs at the export boundary only.

---

## Appendix: Adversarial judge findings (16 gaps the design had to close)

1. ALL THREE PUT A 30-90 SECOND, 81,000-ROW SEED IN A REQUEST PATH AND NONE OF THEM NOTICED. _ensure_for_engine (schema_migrations.py:954) calls safe_metadata_create_all at line 970 on first touch of each tenant engine, and every proposal hangs its SCF seed off startup_seed.py, which is itself lazy per tenant. So the first HTTP request against tenant N after deploy pays the catalog load. All three say 'use COPY, budget 30-90s' and none proposes the only correct shape: an offline management command plus a backfill queue, with the app treating a missing catalog as 'not provisioned' rather than seeding it inline. This is the single most likely way this migration takes production down.

2. NOBODY DESIGNED THE QUARTERLY UPGRADE AS AN OPERATION, ONLY AS A SCHEMA. SCF ships ~4 releases/year (GEN-FAQ-003); 2026.2 alone added 67 controls and an entire new domain. All three have release_id / catalog_version / delta tables and a per-scope pin -- the data model is right in every proposal. But the repo has no fleet-wide data-migration runner (schema_migrations walks tenant slugs for DDL only), and no proposal writes one. At ~24MB x N tenant DBs x 4 times a year, the thing that actually kills this project is an ops task nobody costed: who runs the import, in what order, with what rollback, while tenants are mid-audit.

3. THE REPO ONLY GETS BIGGER. THE STATED GOAL IS THAT THE COMPLIANCE MODULE GETS HIDDEN BEHIND SCF, AND ALL THREE MAKE IT PERMANENT. Every proposal correctly says 'hide nav, keep routes' -- right for deep links -- and then never sets a condition for deleting anything. Kept forever: /frameworks, /controls, /control-library and its 10 sub-routers, /framework-upload, /compliance/policies, the 2,332-row normalization_baseline run ('never delete, it is the rollback anchor'), BOTH check engines during an unbounded transition, and the legacy `controls` array on all 239 checks ('for one release', with no release named). A small team now operates two control planes indefinitely. At minimum: name the metric that permits deletion (e.g. zero tenants on control_library!='scf' for 90 days) and put a dated TODO on the legacy `controls` field, or the dual-write is the permanent state.

4. THE 239 `covers` VALUES ARE THE ONLY IRREDUCIBLE WORK AND NO PROPOSAL SAYS WHO DOES IT OR HOW A WRONG ONE IS CAUGHT. All three price it at 2-3 days, all three correctly refuse to automate it (CC6.1 reverse-maps to 28 SCF controls), and all three propose the same CI assertion: every covers token resolves to a real scf_id/ao_id. That assertion catches a TYPO. It cannot catch a check bound to a plausible-but-wrong objective, which is the actual failure mode, and which then silently propagates through 69,889 crosswalk rows into 250 framework views. This is a compliance-expert task, not a dev task, and it needs a reviewable artifact (a CSV of check_id -> ao_id -> AO objective text, signed off by a human) plus a spot-check protocol. Nobody proposed either.

5. EVERY PROPOSAL BUILDS THE SCHEMA FIRST AND ASKS THE LICENSING QUESTION LATER, ON THE ONE ASSET THE ENTIRE PRODUCT SPINE DEPENDS ON. All three flag CC BY-ND 4.0 honestly and all three defer to 'get counsel / get written confirmation before GA'. But the gating question is narrower than they make it and is answerable in an email TODAY: is serving a tenant-filtered SUBSET of unmodified SCF controls, inside a paid multi-tenant SaaS, with tenant status columns adjacent, 'reproduction in part' (permitted) or Adapted Material (prohibited)? P1 and P3 both concede that is OUR reading, not SCF's written blessing. Sequencing that letter after Phase 2 -- after the seeder, the tables and the crosswalk registry exist -- is the wrong order for a dependency priced at $25k/yr Tier 1 and $200k/yr + 20% of net sales Tier 2 if the answer comes back wrong.

6. NOBODY RAN THE PROPOSED STATUS ALGEBRA OVER THE REAL DATA, AND THE ANSWER MAY MAKE THE PRODUCT UNSELLABLE ON DAY ONE. All three adopt CDPAS Standard 8 bands verbatim (100% strictly conforms / >=80% conforms / >=70% significant deficiency / <70% MATERIAL WEAKNESS, with any deficient weight-10 control forcing MATERIAL WEAKNESS regardless of percentage). Today's 239 checks reach 15 SOC 2 criteria touching 232 of 1,534 SCF controls. Nobody computed what conformity% a real tenant actually scores under those bands after the cutover. If the honest answer is single digits, every tenant lands in MATERIAL WEAKNESS the day the flag flips, and the correctness of the algebra is irrelevant. P1 ships one hand-built 4-AO fixture; P2 and P3 ship no runnable check of the roll-up at all. Compute the real number against the seeded catalog BEFORE Phase 5, and if it is what it looks like, the 'unassessed' third bar is not a UI nicety -- it is the only thing making the screen truthful.

7. next_due_at IS A COLUMN THAT LIES IN ALL THREE DESIGNS. Every proposal stores conformity_cadence (Annual 1,292 / Quarterly 141 / Semi-Annual 100), computes next_due_at, and indexes it. None of them names the scheduler that fires it. There is no job runner described anywhere in these proposals, and a re-attestation clock with nothing pulling from it is a sorted list nobody reads. Same for the ERL manual-evidence workflow (316 artifacts, 465 controls): all three say it must ship 'in the same release' as the cutover because 57% of the catalog is Process/People and will read ~1,300 unassessed, and all three specify it in exactly one sentence. The two features that make the day-one dashboard defensible are the two least designed things in every proposal.

8. ALL THREE ASSUME THE CROSSWALK RESOLVER'S 17 BASELINE RATIOS ARE A TEST SUITE. They are a snapshot. pci 205/205, iso_27001 93/93, soc2 60/65 and the rest assert that a resolver run TODAY reproduces numbers measured TODAY -- they cannot distinguish 'the mapping is correct' from 'the mapping is consistently wrong'. cobit scores 40/40 purely because APO01 is a string prefix of APO01.01; every proposal notes this and stores match_mode, and then still counts it in the headline ratio. A regression check whose green state includes a known-overclaiming 100% will not be believed the first time it goes red.

9. NO AUDIT-PERIOD MODEL — the largest gap, and all three have it. Every proposal answers 'what is the status now' via DISTINCT ON ... ORDER BY collected_at DESC. No proposal can answer 'what was CC6.1 on 2026-03-14' or 'did this control operate effectively THROUGHOUT 2026-01-01..2026-12-31', which is the entire question a SOC 2 Type II, an ISO surveillance audit and a PCI ROC ask. Needed: a grc_audit_period table (start, end, pinned catalog release, frozen SoA snapshot, status in {open, fieldwork, closed}), every roll-up query taking an as_of parameter, and a days-deficient-in-period metric. Worse, P1's stated retention plan ('roll older rows into a monthly summary') and P2's identical line actively DESTROY the record the Type II opinion rests on. Nothing inside an open period may ever be aggregated away.

10. POPULATION COMPLETENESS AND SILENT TRUNCATION — all three treat a check as a scalar pass/fail over 'the directory' and persist only the SUMMARY finding, leaving per-item results in evidence_snapshot JSON where nothing queries them. But the engine runs MAX_ITEMS=300 with serial pagination, so a min_count / all_true / none_match check against a 400-repo GitHub org tests 300 and reports pass. That is a materially misleading result and NOT ONE of the three flags truncation as a distinct outcome. Needed on the result row: population_size, tested_size, truncated BOOL — and truncated must be incapable of yielding 'satisfactory'. An auditor's first question about any automated test is 'was the population complete', and today the honest answer is 'we do not know'.

11. COLLECTION HEALTH IS NOT MODELLED AS DISTINCT FROM CONTROL FAILURE. live_api_runner returns status='error' for connectivity and it is indistinguishable downstream from a control problem. P2 launders it further into 'not-assessed'. So a revoked OAuth scope, an expired secret or a 429 storm produces either a false deficiency or a silent gap, and no proposal has an alerting surface for 'this control has not been successfully collected in 90 days'. An auditor who finds the tool was serving stale-but-green data writes the finding against the TOOL, which is worse than writing it against the customer. Needed: a per-connection last_successful_collection_at with its own dashboard, separate from control status.

12. EVIDENCE IMMUTABILITY IS ASSERTED, NOT DESIGNED. live_api_runner's docstring says the snapshot is 'durable, hashed by run_service' and all three cite it as the immutable audit record — but no proposal specifies what is in the hash, whether it is signed, whether the store is append-only, or who can UPDATE grc_compliance_plugin_runs. Critically, none of them snapshots the COLLECTION IDENTITY: which IntegrationConnection, which account, which scopes/permissions were held at collection time. IntegrationConnection is mutable, so 'what could this collector see when it produced this evidence' is unanswerable after the fact. That question is asked in every cloud audit.

13. THE AO-COVERAGE DENOMINATOR IS NOT THE RIGOR IT IS SOLD AS, AND ALL THREE BUILD THE HEADLINE NUMBER ON IT. Verified in the file: 447 of 1,534 controls have exactly ONE assessment objective (max 65, mean 3.88). So a 1-AO control reaches coverage=1.0 from a single connector check and reads 'satisfactory', while IAO-03 with 65 AOs can never leave 'partial' — coverage tracks how granularly SCF happened to write objectives, not assurance. And procedure and expected_result are NULL on all 5,956 AOs (verified), so 'this check satisfies this objective' is entirely OUR assertion with no published test step behind it. All three present AO-binding as SCF-derived defensibility. It needs a signed, human-authored rationale per binding, and that turns the 239-row hand-authoring job from an engineering task into an audit artifact that a reviewer must approve — a cost none of them priced.

14. NO SEGREGATION OF DUTIES ON THE ASSESSMENT ITSELF. All three ship owner_user_id + reviewer_user_id + a requested_by/reviewed_by trail and none prevents the same human from being preparer and approver of an N/A justification, a compensating-control justification, or a control designation. Self-approval of scope exclusions is a standard ITGC finding, and it is a two-line constraint in the writer.

15. THE EXCEPTION / RISK-ACCEPTANCE PATH IS DISCONNECTED FROM THE STATUS ALGEBRA. grc_exceptions already exists and is FK'd to normalized controls, but no proposal routes a deficient control through an approved, time-boxed exception so it reads as 'deficient — accepted, expires 2026-11-30' rather than an open finding, and none makes an EXPIRED exception automatically flip the control back to deficient. P2 mentions projecting a POA&M from grc_exceptions at export time but wires no state linkage. Without this, the first thing a customer does with a red control is argue about it in a spreadsheet.

16. NO PROPOSAL COSTS THE LICENCE REMEDIATION AS BLOCKING WORK. All three correctly identify that seed_data/frameworks/ ships verbatim ISO 27001 Annex A, PCI DSS 4.0.1, CIS (CC BY-NC-ND — NonCommercial kills it in a paid SaaS regardless of attribution) and HITRUST text, plus a self-documented AI reconstruction of ISO clauses in gap_requirement_texts.json. All three schedule it as cleanup. It is the largest live exposure in the repo and it is INDEPENDENT of SCF — it should ship before or alongside Phase 0, not in a later phase, because the migration is the excuse to do it and the phases before the cutover are the ones most likely to slip.

