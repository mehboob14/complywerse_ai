# Risk Management redesign: build plan

Approved 2026-11-11: the templates at https://claude.ai/artifact/HTP9GuEp9bANR4rXYCb5df with all five recommended decisions:

1. One Assessments engine (self-assessment, risk workshop, framework IT risk) replacing separate Risk Assessments and RCSA.
2. One action tracker: risk actions run on the Issues CAPA engine.
3. Sidebar by lifecycle: Overview, Identify, Assess, Treat, Monitor, Report; KRIs and Loss Events move under Risk Management.
4. Incidents become Basel loss events.
5. Risk types are categories on one register; Operational keeps the deep workflow.

Defect fixes (126) are already in the working tree with `backend/tests/test_erm_*_fixes.py`.

## Shared pieces (in place)

- `backend/grc/services/segregation.py` `ensure_independent(maker_id, user, what)`: maker-checker, 409 for the maker, no admin exception.
- `backend/grc/modules/erm/schema_migrations.py` `_ensure_for_engine`: adds new columns on existing tenant databases (lists `_REGISTER_COLUMNS`, `_LOSS_COLUMNS`, `_APPROVAL_COLUMNS`), called from `db._init_tenant_schema`.
- Bands: `risk_priority_for_score` (backend), `riskBandForScore` (`@/lib/riskBands`).

## Waves

Each wave's areas touch separate files and build in parallel; a wave ends with the full risk test set, a type check against the last commit and a live check.

**Wave 1: foundations**
- A. Sidebar by lifecycle (decision 3).
- B. Maker-checker on every existing approval: RCSA, internal controls and tests, issue close and verify, KRI values, risk assessments.
- C. Risk record: risk owner, target risk, response, acceptance with approver and expiry, review date, change history with reason, risk types (decision 5).
- D. Basel loss events: event type, business line, gross / recoveries / net, currency, dates, near miss, boundary, validation by a second person (decision 4).

**Wave 2: workflows**
- E. Actions & Acceptances on the CAPA engine (decision 2), with migration of existing mitigation actions.
- F. KRIs: owner, provider, due date, maker-checker screen, amber/red escalation on by default.
- G. Appetite: statements, versions, board approval, limits linked to KRIs, breach log and escalation.
- H. Reviews: approval of score changes, next review scheduled by band.

**Wave 3: engine and reporting**
- I. Assessments engine merge (decision 1), template versions, questions linked to risks and controls, approved results written to the register.
- J. Reports & committee packs: frozen packs from live data, commentary, approval.
- K. Dashboards per audience: Board/CRO, risk team, risk owner, audit, third-party.

**Wave 4: depth**
- L. Scenario analysis saved with loss estimates on the FAIR engine; editable bow-tie.
- M. Third-party: materiality, exit plan, sub-outsourcing approval, regulator notification, committee approval, vendor incidents to loss events, concentration to appetite.
- N. Library suggestions per unit; risk–control link tables merged.

## Rules for every wave

- Keep old URLs working (redirects); keep earlier uncommitted work.
- Tests first for new backend behaviour; one small test per non-trivial change.
- Test permissions and approvals as a non-admin; maker-checker has no admin exception.
- No new dependencies. Columns via the schema-migration lists above; new tables via models.
