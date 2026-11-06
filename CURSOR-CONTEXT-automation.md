# Cursor context — Automation / compliance engine

**Temporary handoff file.** Written 2026-09-11 on branch `scf-control-plane`. Delete when the
work lands. Every number below was verified against the code or the `1link` tenant DB at the
time of writing, not recalled.

---

## 1. Read this first — the licence hard lines

These are not style preferences. They constrain what you may write.

| Thing | Licence | Rule |
|---|---|---|
| SCF 2026.2 control catalogue | CC BY-ND 4.0 | **Render verbatim only.** Never feed SCF text to an LLM to generate policies, standards, procedures, metrics, risks or threats. The SCF guidebook (p.92, GEN-FAQ-006) prohibits exactly that. Attribution lives in `NOTICE.md`; attribution is not permission. |
| Steampipe, Powerpipe, `sc2in/scf`, `trycompai/comp` | AGPL-3.0 | **Read for ideas, vendor nothing.** §13 triggers on network use and a hosted multi-tenant SaaS is the canonical trigger. Keep them out of the dependency manifest and the deployed image. Their *mods* and *plugins* are Apache-2.0 and are harvested freely. |
| The 34 framework libraries in `backend/grc/seed_data/frameworks/` | mixed | They ship verbatim ISO 27001 / PCI DSS / CIS / HITRUST text. This is a live exposure and already public on GitHub. Two licensing questions are open and unresolved. |
| NIST publications | public domain (17 U.S.C. §105) | Free to reproduce verbatim. CSF 2.0 was rebuilt from NIST's own export. |

Deeper detail: `docs/scf-control-plane-architecture.md` (the AGPL table is around line 31).

There is **no Alembic**. Schema self-heals via `create_all` + `_COLUMN_ADDS` /
`_COLUMN_TYPE_FIXUPS` in `backend/grc/modules/compliance/schema_migrations.py`, applied per
tenant engine and memoised. Column *type* changes go in `_COLUMN_TYPE_FIXUPS`.

---

## 2. The shape of the thing

```
Control  →  Test  →  Scope  →  Data sources  →  Assertion  →  Evidence  →  Status  →  Monitoring
 SCF        check    select      connectors      predicate    findings    verdict     (not built)
 1,534      spec     population  66 of them      + aggregate  + counts    4 values
```

| stage | state | where |
|---|---|---|
| Control | done | `SCFControl`, 1,534 controls / 34 domains, crosswalked to 33 frameworks |
| Test | **binds to the wrong thing** — see §6 | `CONNECTOR_CHECKS`, `CLOUD_CHECKS` |
| Scope | done | `assertions.select()` |
| Data sources | done, no cursor pagination | `PROVIDER_API`, `cloud_transport` |
| Assertion | done | `assertions.py` |
| Evidence | done | `population_size` / `tested_size` / `truncated` on findings |
| Status | done | 4 verdicts at test level, 9 at control level |
| Monitoring | **not built** | plan in §9 |

---

## 3. File map

Backend, all under `backend/grc/`:

```
modules/automation/router.py                   the API. /automation/common/{controls,overview,
                                               coverage,review-queue,review,controls/{scf_id}}
                                               plus /automation/soc2/{catalog,collectors,checks}
modules/compliance_plugins/
  runners/live_api_catalog.py                  PROVIDER_API (66 connectors), run_provider,
                                               provider_checks, _finding
  runners/evidence_engine.py                   collect → normalize → check. _eval_check is the
                                               legacy `kind` path; _eval_spec_check is the new one
  runners/assertions.py                        NEW. scope, predicates, operators, joins, aggregation
  runners/cloud_transport.py                   cloud transports. AWS on boto3 + CLOUD_CHECKS
  runners/aws_runner.py                        per-check boto3 runner with a read-only verb guard
  services/check_result_recorder.py            NEW. writes SCFCheckResult after every run
  services/run_service.py                      execute_plugin. calls the recorder after the cascade
  seed_soc2_connectors.py                      generates one plugin per PROVIDER_API entry
models/_56_scf_catalog_models.py               SCFControl, SCFObjective, SCFMapping, SCFCheckResult,
                                               SCFControlState, SCFScope, SCFAuditPeriod,
                                               SCFMappingReview
tools/scf_import.py                            loads seed_data/scf into a tenant DB. OUT OF BAND
tools/artifact_resolver.py                     artifact catalogue → SCF controls
tools/evidence_consolidation.py                per-control evidence sets
seed_data/scf/                                 the catalogue. 21 MB, 50 files
seed_data/evidence/                            connector_checks.json, steampipe_catalog.json (117)
```

Frontend, under `grc-frontend/src/`:

```
app/(dashboard)/automation/overview/page.tsx             the dashboard
app/(dashboard)/automation/soc2-controls/page.tsx        the library table
app/(dashboard)/automation/soc2-controls/[code]/page.tsx control detail. CoveragePanel lives here
app/(dashboard)/automation/soc2-controls/review/page.tsx crosswalk review queue
app/(dashboard)/admin/evidence-collectors/page.tsx       connect a connector
components/soc2/ui.tsx                                   CONTROL_STATUS is the status vocabulary
```

Docs worth reading: `docs/control-plane-plan.md` (task status),
`docs/compliance-engine/design-record.md` (the engine design + its critique),
`docs/compliance-engine/authored-check-specs.json` (81 specs, **not loadable yet**).

---

## 4. Connectors

66 connectors across 16 categories. All read-only.

```
cloud 12   identity 9   productivity 9   observability 6   comms 5   security 5
scm 4      email 4      incident 2       ai 2              hr 2      mdm 2
crm 1      itsm 1       data 1           payments 1
```

Two transports:

- **HTTP + static token** — 65 connectors. Declared as data in `CONNECTOR_CHECKS`
  (`seed_data/evidence/connector_checks.json`): `resources[]` to collect, `checks[]` to run.
  Pure stdlib `urllib`, no new dependency.
- **`transport` key** — cloud accounts that cannot use a static bearer. Only `aws` today, on
  boto3 with 6 declarative checks plus an IAM MFA sweep. Azure, Entra, GCP and Kubernetes are
  each a `_call` implementation plus a `CLOUD_CHECKS` list against the same shape.

`provider_checks(provider)` is the single accessor both binders use, so a new transport is bound
to controls by the same code that binds the other 65.

Adding a connector: add to `PROVIDER_API`, add resources/checks, re-run the seed. Plugin
creation and control mapping are generated from `PROVIDER_API` — no hand-maintained list.

---

## 5. The check engine

### Legacy path — 239 shipped checks, untouched

A check declares `kind` and one `resource`:

```json
{"id": "github.org_2fa_required", "resource": "org_detail", "kind": "all_true",
 "field": "two_factor_required", "controls": ["CC6.1"],
 "title": "Organizations require 2FA", "item_name": "login"}
```

Kinds: `all_true` 74, `min_count` 52, `none_match` 34, `present` 32, `all_match` 24,
`max_count` 12, `all_false` 11.

### New path — opt in by declaring `assert`

```json
{"id": "dch.endpoint_encrypted", "resource": "devices", "controls": ["CC6.7"],
 "scope":  {"and": [["type","eq","laptop"], ["ownership","eq","corporate"]]},
 "join":   {"resource": "agents", "on": ["serial","device_serial"], "unmatched": "fail"},
 "assert": {"all": ["encrypted","truthy"]},
 "empty":  "not_applicable"}
```

- **predicate** — leaf `[field, op]` or `[field, op, value]`; nodes `{and}` `{or}` `{not}`
  `{exists: {in, where}}`.
- **operators** — `eq ne in not_in contains gt lt gte lte matches truthy falsy`, plus temporal
  `within older_than before after`. Durations are written as controls write them: `15d`, `90d`,
  `12mo`, `1y`, `36h`.
- **field prefixes** — `date:x` parses a timestamp, `joined:x` reads the counterpart of a join,
  `joined:date:x` does both. Value positions accept `{{self.field}}` and `{{row.field}}`.
- **aggregation** — `{all}` `{any}` `{none}` `{count: [op, n, pred?]}` `{ratio: [op, share, pred]}`.
- **`empty`** — what an empty population means. **The author decides, not the engine.**
  "No public buckets" over zero buckets is `not_applicable`; "at least one backup exists" over
  zero backups is `fail`.

### Three rules that stop the engine inventing findings

Break these and you will generate confident nonsense.

1. An unparseable **timestamp** is unknown, not 1970. Otherwise bad data makes everything overdue.
2. An unparseable **duration** is `None`, not zero. Otherwise every age breaches every window.
3. A malformed **predicate** raises `SpecError`. It must never evaluate to `False`, because
   `False` for every row marks the whole population as offending and is indistinguishable from a
   real total failure. This bit me during the build: a nested-by-mistake predicate reported
   `2 of 2 failed` with total confidence.

---

## 6. The binding problem — the most important thing to understand

**Checks bind to SOC 2 criteria. That is the bottleneck.**

Only 15 SOC 2 criteria are named by any check. They crosswalk to 145 SCF controls, and the SOC 2
path caps at 288 of 1,534 because 81% of the library never touches SOC 2.

The concrete absurdity: **`IAC-06 Multi-Factor Authentication` maps to 18 frameworks and zero
SOC 2 criteria**, so none of the four MFA collectors we ship (Okta, AWS IAM, GitHub, Google
Workspace) can reach the control literally named "Multi-Factor Authentication".

**The fix is to bind checks to SCF assessment objectives instead.** SCF ships 5,956 objectives,
each with a stable id like `IAC-06_A01` and a PPTDF tag. `IAC-06_A01` reads (paraphrased)
"multi-factor authentication for privileged accounts is implemented" — that *is* a check spec.
A check bound to an objective reaches every control carrying it across all 33 frameworks.

Ceilings, measured:

| | count |
|---|---|
| controls total | 1,534 |
| have ≥1 `Technology` objective (automatable in principle) | 676 |
| reachable by a check today | 145 |
| genuinely manual, no Technology objective | 858 |
| Technology objectives | 1,381 |
| of those, machine-checkable by hand sample | ~974 (29.5% of Technology objectives are not) |

Objective shape distribution from a 200-objective hand sample: not automatable 29.5%,
RESOURCE 27.5%, POPULATION 21.5%, EVENT 8.5%, CORRELATION 6.5%, TEMPORAL 6.5%.

**This needs a human reviewer** (task C1 in `docs/control-plane-plan.md`, 2–3 days). A machine
binding inflates coverage roughly twentyfold, because one SOC 2 criterion reverse-maps to 28 SCF
controls. Do not automate it.

---

## 7. Status vocabulary

**Test level**, in `assertions.py` — 4 values:

| | meaning |
|---|---|
| `pass` / `fail` | we looked and we know |
| `not_applicable` | scope selected nobody, nothing to judge |
| `not_run` | we could not look |

`SCFCheckResult.status` is `VARCHAR(20)` (widened from 10, which would have truncated
`not_applicable` to `not_applic` in silence).

**Control level**, in `router.py` + `components/soc2/ui.tsx`:

| | meaning |
|---|---|
| `passed` `failed` `partial` | aggregate of in-scope connected providers |
| `expired` | result older than the control's SCF reassessment cadence (Quarterly 90 / Semi-Annual 180 / Annual 365, unset defaults to Annual) |
| `collection_failed` | the collector could not collect. **Never a control failure.** |
| `connect_one` | automatable, tenant runs none of the systems that would prove it |
| `unbound` | SCF says a machine could assess it, no check reaches it. A *check-authoring gap* |
| `manual` | no collector could ever prove it. Board oversight, training, contracts |
| `not_run` | connected, ran, produced no finding for this control |

Aggregate precedence in `_aggregate_status`: `failed` > `collection_failed` > `error` >
`running` > `expired` > all-passed > any-passed(`partial`).

`unbound` vs `manual` matters: on `1link` the split is 792 manual + 597 unbound. Before that
distinction existed, 597 automatable controls were filed alongside staff training.

---

## 8. Connector substitution — bound connectors are ALTERNATIVES, not a checklist

53 providers claim CC6.1 because 53 systems can prove logical access. No tenant runs 53.

**The rule, in two halves:**
- A provider the tenant has **not** configured is not a gap. Not in their estate, never enters
  the aggregate. (`_connected_providers`, `_plugin_in_scope`)
- Every provider they **have** configured stays in it. Weak MFA in AWS is not excused by Okta
  passing, because both are in scope.

Before this, a control GitHub had actually evidenced reported `partial` against 52 systems the
tenant did not own. Fixing it moved 8 controls from `partial` to `passed` and 109 from `not_run`
to `connect_one`.

`_plugin_in_scope` also covers plugins with no `provider`: the SOC 2 quantitative checks are
boto3 calls and are as out of scope without an AWS account as a GitHub check is without GitHub.

### Known-wrong, not yet fixed

`_coverage_for` presents categories as though connecting **any one** proves the control. The
design run established that is honest for only **3 of 16 categories** (incident, the SAST subset
of security, the `count>=1` core of observability).

Two demonstrated consequences:
- Connect only **Semgrep** and every change-management control reports `covered`.
- `MON-01 Continuous Monitoring` lists **Calendly, Confluence, Jira** as evidence sources.

The fix is a per-test `across: authoritative | all | any` mode (see the design record). It
belongs **with** the objective binding, not ahead of it.

---

## 9. Monitoring — planned, not built

The engine answers "is this satisfied now". Monitoring answers "what happens when that changes".
Three of the four pieces already exist:

- **State comparison** — genuinely new but small. Compare each run's verdict against the last
  `SCFCheckResult` for the same check and control. Only transitions matter: pass→fail opens,
  fail→fail updates, fail→pass resolves. The recorder already writes the history this reads.
- **Issue model** — exists. `Issue` + `IssueAction` in `models/_12_governance.py` is a full
  finding tracker with CAPA actions. Use it; do not invent a parallel concept.
- **Scheduler** — exists. Per-plugin `schedule_cron` with a tenant override in
  `compliance_plugins/router.py`, plus `run_connector_sync`. Daily re-evaluation is config.
- **Event-driven rescan** — missing, and the only piece with real new surface. Build it last: a
  webhook that triggers a broken evaluation is worse than a slow correct one.

---

## 10. Reports and where numbers surface

- **`GET /automation/common/overview`** — the dashboard payload. `library`, `automation.posture`,
  `collection` (per-connector health), `frameworks` (incl. `inferred_pct`), `crosswalk`,
  `evidence`, `assurance`, `trend`. Runs in ~0.5s over 1,534 controls.
- **`GET /automation/common/coverage`** — every requirement and what accounts for it: mapped, or
  dispositioned with the written reason. 100% dispositioned.
- **`GET /automation/common/review-queue`** / **`POST /review`** — crosswalk review, worst-first
  by confidence then fan-out. Decisions keyed on mapping identity so they survive a re-import.
  10,854 reviewable rows, 0 reviewed.
- **Assurance trend** — `ControlAssuranceSnapshot`, one row per tenant per day, written by the
  control library. Its own `controls` count is a *different denominator* from the 1,534 and is
  deliberately not shown beside them.
- **`SCFCheckResult`** — the as-of record. `collected_at <= X AND expires_at > X` answers "what
  did we know on date X". This is the only thing that makes an audit period answerable.

`inferred_pct` counts **requirements, not mapping rows** — one code rolled up to five controls is
one inferred requirement. It reproduces the earlier audit exactly: COBIT 100%, GDPR 66%,
SAMA CSF 46%.

---

## 11. Gotchas that will cost you an hour each

1. **`lru_cache(maxsize=1)`** on `_consolidated_evidence`, `_disposition_index`,
   `_framework_evidence_index`. Editing those seed files requires a **backend restart**.
2. **`scf_import` runs out of band**, never at startup, never from a request. ~81,500 rows,
   30–90s per tenant. It now loads `.env` itself; it did not, and connected as
   `postgres:postgres@localhost` and failed auth.
3. **Tenant schema init is lazy**, from `get_tenant_engine(slug)`, not at app startup. A new
   table does not exist until something touches that tenant's engine.
4. **Connector plugin seeding is not automatic.** Neither `startup_seed.py` nor `main.py` calls
   it. Use `POST /automation/soc2/seed` or Admin → Evidence Collectors → Seed catalog, per tenant.
5. **`crosswalks/direct/*.json` is NOT a complete record of `direct.csv.gz`.** 968 of 4,858 rows
   have no JSON entry. Rebuilding from the JSONs loses them; `_merge_authored` unions instead.
6. **`build_scf_dispositions` reads `rationale`, not `unmappable_reason`.** Populate both.
7. **Windows dev**: run backend as `venv/Scripts/python.exe -m uvicorn grc_dev_server:application
   --host 127.0.0.1 --port 4000 --env-file .env` from `backend/`. `.claude/launch.json` has both
   servers. Health: `http://127.0.0.1:4000/health` → `{"status":"ok","mounted":"/grc"}`.
8. **Backfilling `SCFCheckResult` from historical `raw_output` will import an overstatement.**
   Runs stored before connectivity became `info` recorded it as `pass` against 28 controls each.

---

## 12. Tests

53 DB-free tests, all passing. `cd backend && ./venv/Scripts/python.exe -m pytest tests/ -q`.

```
tests/test_assertions.py            28  scope, predicates, temporal, joins, aggregation
tests/test_evidence_population.py   15  vacuous pass, population accounting, recorder rules
tests/test_automation_status.py     21  expiry, collection health, connector substitution
tests/test_cloud_transport.py       19  AWS collector against a fake boto3 client
```

Plus self-checks: `python -m grc.tools.artifact_resolver --selftest` (17 rules) and
`python -m grc.tools.evidence_consolidation selftest` (8 validator cases).

Convention: DB-free, no fixtures, no frameworks. Test the case where a plausible implementation
is *silently wrong*, not the happy path.

---

## 13. What is actually pending

**Engineering, unblocked:**
- Reconcile `_status_from_run` and `_aggregate_status` on what `not_run` means. They disagree.
- Cursor pagination in `_collect_one` (only `page` and `none` today). Notion, Dropbox and
  Databricks populations are first-page counts and `truncated` is undeterminable for them.
- Per-test `across` mode (§8).
- Monitoring transitions (§9).
- Azure, Entra, GCP, Kubernetes transports.

**Blocked on a person:**
- **C1** — 239 check-to-objective bindings, 2–3 days of a compliance reviewer. Everything in §6
  waits on this.
- **D3** — whether to retire the compliance module's artifact surface. It holds 527 authored
  document bodies the consolidated evidence sets do not replace. Recommendation: join, don't
  retire.
- The two SCF licensing questions.

**Known bad, recorded:** one GitHub 2FA finding writes 36 `SCFCheckResult` rows including `fail`
against four cryptography controls, because the crosswalk maps CC6.1 to them. Each row carries
`[CC6.1 via resolver]` in `detail` so the chain is auditable, but the claim is weak. This is the
strongest argument for doing §6 before anyone reads these rows as assurance.

**Branch state:** `scf-control-plane` is ahead of `main` by the commits listed in
`git log origin/main..HEAD` and behind by ~30. The last merge was clean; merging sooner is
cheaper than later.
