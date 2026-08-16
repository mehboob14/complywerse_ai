# CTEM — Production Build Plan

Goal: take CTEM from "skeleton wired" to **production-grade** — logically-correct
backend, real content, and a proper dashboard + UI. Driven by the honest
scorecard: the five stages exist and link, but content is thin and the surface
is poor.

Standing rules (unchanged): **local commits only, never push**; hermetic pytest
for every new invariant; honest labels (no faked numbers); reuse the service
that owns each stage — never re-derive.

## Where we are (honest baseline)

| Stage | State | The real gap |
|---|---|---|
| Scoping | MET | works (scope + cycle created live) |
| Discovery | PARTLY | 215 Nessus findings exist, but finding↔asset links are thin (register shows 0 assets on most) → scopes see too little |
| Prioritisation | MET | CVSS·EPSS·exploit·KEV·reachability engine works; low fuel due to thin links |
| Validation | PARTLY | tier logic correct, but every control is "attested only" — no live test-evidence source |
| Mobilisation | NOT PROVEN | ServiceNow push coded + lab-tested, never run against a real instance |
| Cost (CRQM) | PARTLY | real Monte Carlo, but portfolio-only (risks not scope-linked) |

## Phases (priority order)

**P1 — Finding↔asset spine (backend).** THE highest-leverage fix: rich content
depends on it. Investigate why findings read 0-linked; add a host-name
auto-linker (match a finding's affected host to an asset's host_name/name),
backfill existing findings, and stamp provenance. Makes Discovery/Prioritisation
light up with real numbers. Hermetic test on the matcher.

**P2 — CTEM program dashboard (backend aggregator).** New tenant-level
`program_dashboard()` + read-only endpoint: exposure funnel (findings → chained
→ viable → ticketed), the 3-lever coverage, top choke points, assurance tier
distribution + by framework, mobilisation status, cost + loss-exceedance curve,
scope/cycle counts, and honest gap metrics. Reuses coverage / assurance_summary
/ rank_choke_points / ITSM / sim. Hermetic test.

**P3 — CTEM dashboard frontend (production UI).** A dedicated, polished page
(not the thin per-scope cards): KPI funnel, the loop with real counts, a
ranked choke-point table with drill-down, an assurance donut + framework
breakdown, mobilisation panel, the cost curve, and an honest "gaps to close"
banner. Proper design system, charts, loading/empty states.

**P4 — Validation evidence path (make "tested" reachable).** A UI action to
record a retest / manual test result on a control, flowing into the tier so
controls can move past "attested only" without waiting on an external BAS feed.

**Blocked on you (can't do solo):**
- **ServiceNow live** — needs your PDI + credentials in the connectors UI (I must
  never enter credentials). Then Mobilisation flips from "coded" to "proven."
- **Per-scope CRQM** — needs a risk↔scope (or risk↔asset) link in the
  quantification model: a real modelling decision, your call.

## Execution log

- P1: _in progress_
