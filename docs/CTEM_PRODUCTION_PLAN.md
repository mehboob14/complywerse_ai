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

**P1.5 — Generate reachability chains (content lever).** The 206 now-linked
findings still read "no chain yet" because no reachability snapshot exists for
them. Run the attack engine over the scope's (vuln × asset) pairs and persist
snapshots so Prioritisation / choke-points fill with real viable/severed/
undeterminable verdicts. This is what makes the redesigned card meaningful.

**P2 — Enrich the EXISTING command-center payload (backend).** NOT a new
dashboard — the user's direction is to modify/redesign the command center
already on the scopes page. Enrich `command_center()`: add the exposure funnel
(findings → chained → viable → ticketed), a real top-choke-points list with
drill-down data, assurance framework breakdown, cost LEC points, and honest gap
flags — feeding the redesigned cards. Reuse existing services. Extend the test.

**P3 — Redesign the command-center cards (production UI).** Rework the cards
in-place on `erm/ctem-scopes` (`CommandCenter` component): stronger visual
hierarchy, the loop as a funnel, a ranked choke-point mini-table, an assurance
tier bar, the cost curve, honest empty/gaps states — a real design pass on what
exists, not a second page.

**P4 — Validation evidence path (make "tested" reachable).** A UI action to
record a retest / manual test result on a control, flowing into the tier so
controls can move past "attested only" without waiting on an external BAS feed.

**Blocked on you (can't do solo):**
- **ServiceNow live** — needs your PDI + credentials in the connectors UI (I must
  never enter credentials). Then Mobilisation flips from "coded" to "proven."
- **Per-scope CRQM** — needs a risk↔scope (or risk↔asset) link in the
  quantification model: a real modelling decision, your call.

## AUDIT RULE — no green without a shown trace (user-directed, 16 Aug)

My earlier audits produced FALSE GREEN FLAGS (stage 3 called "MET"/"engine
fine" twice, then a real logic flaw found in it). Root cause, three habits:
(1) I audited COUNTS (205 linked, 0 orphans) not DECISIONS (is this finding
dangerous? which controls?); (2) I marked stages "met" when the code existed
but had NEVER RUN on real data ("green before the beef"); (3) I declared then
verified, instead of: pick a real case → predict the correct answer → check
the system → then a verdict.

Rule now: a stage is **shown-correct** only with a real traced case where the
decision matches an engineer's answer; **built-not-exercised** when code exists
but hasn't run on real data; **unverified** when it can't be tested yet. Only
the first is green.

Decision-level audit result (16 Aug):
- Scope: shown-correct (name rule → 142/144, not 143). Caveat: only the name
  rule exercised on real data.
- Discover: shown-correct (205 real findings, each on its machine, per user).
- Prioritise: shown-correct on 3 traced cases — (A) PG 8.8 net-only/no
  exploit/internal → unlikely-blocked; (B) WinVerifyTrust KEV+UI:R/internal →
  likely (user opens file); (C) TLS 1.1 no CVE/vector → was possible (BUG,
  fixed f722db8) → now can't-tell, flip auditable in history. 3 of 6
  "dangerous" hand-traced; other 3 follow rule B, not individually traced.
- Validate: LINKING shown-correct (VULN-289 → A.8.8/RA-5/SI-2/6.3.3/11.3.1;
  every CVE finding linked, none missed). JUDGING half (tier from evidence)
  built-not-exercised — 0 evidence rows ever. NOT green.
- Mobilise: unverified — no ServiceNow. NOT green.
- Cycle: open shown-correct; CLOSE built-not-exercised on real data. NOT green.

## HARD RULE — no fake data, no demo data (user-directed)

The app must never show invented or sample data as if real. Real frameworks
and real controls exist in the system — use them. Audit finding on 16 Aug:
**all 12 risks in the register are `[DEMO]` seeds (0 real), so the FAIR
$495.5K figure is a real Monte Carlo on fake inputs.** The command center must
NOT present it as the user's cost. Fix: detect demo-only inputs and say so
plainly ("computed on sample risks — add real risks to quantify"), never a
bare dollar figure. Hermetic unit tests may seed rows in a throwaway in-memory
SQLite (never the tenant DB) — and when they do, they use the tenant's REAL
values (e.g. "ISO/IEC 27001:2022 · A.8.8") so they prove the real data shape.

## Validation gap identified (user-directed, 17 Aug)

**How a finding is linked to controls today is a hand-written lookup, not
computed understanding.** `cwe_control_map.py` = two row types: (1) GENERAL —
"any open CVE" → the fixed patch/vuln-mgmt set (PCI 6.3.3/11.3, ISO A.8.8,
NIST RA-5/SI-2, CSF DE.CM, NIS2 Art.21, DORA Art.9), matched by EXACT control
code in the tenant's uploaded frameworks; (2) SPECIFIC — per-CWE rows (e.g.
CWE-89 → PCI 6.5.1) — but the specific table has almost no rows, and e.g.
CWE-1287 has none. Result: every finding links to the SAME general set (the
user's 60, 48 of them PCI). Correct but shallow — it can't say "this weakness
needs input-validation controls."

**User's direction (right):** use the **Unified Control Library** (5,290
normalized controls, `grc_normalized_controls`) + the platform's existing
OpenAI mapping (`control_library/services/normalization.py`) to propose the
SPECIFIC controls per finding — AI reads CVE + CWE + description, ranks
candidates from the library with a stated reason, human approves. Keeps the
general rows as the floor; adds real intelligence on top. **Proposed as P5
(needs go-ahead; touches OpenAI cost + an approval UI).**

Also clarified: validation = TWO halves — (a) which controls a finding falls
under (linking, above) and (b) is each control PROVEN to work (tier from
evidence: retest / breach-sim / scanner-closure). (b) is downstream and only
matters once (a) is meaningful; the user asked to defer explaining (b).

## Decisions from the visibility review (user-directed)

- **Frozen-cycle history stays OUT of the live view.** No "compare with last
  quarter" charts forced on the user. Open = live; close = save a record; history
  is a separate, quiet section. (User: the previous cycle has no place in the
  live session.)
- **Restore the 5-stage loop strip** above the cards — the loop is the whole
  idea, and removing it lost visibility. Show it as a flow (scope → discover →
  prioritise → validate → mobilise) with the CURRENT state numbers, not the
  confusing "since opened" zeros.
- **List the controls, don't just count them.** The "60 controls" card must
  show which controls (grouped by framework: ISO 27001 A.8.8, NIST RA-5/SI-2,
  PCI 6.3.3/11.3.1 …) so the user can see the crosswalk, not a bare number.
- **Cost link → the Risk Register DASHBOARD** (`/erm/risks`), where the FAIR
  panel actually shows $495.5K / p95 $2M / p99 $3M — not `/erm/risks/list`.
- **Mobilisation must run officially** — needs a ServiceNow connection; the
  user will provide the instance/credentials via the connectors UI (agent never
  types credentials). Adapter + push + resolve-sync already built.
- **Control-matching technique (for the record):** deterministic, hand-curated
  CWE → framework-control-code crosswalk (`cwe_control_map.py`) + two
  always-applicable rules (open CVE → vuln-mgmt controls; KEV → IR controls),
  matched by EXACT control code against the tenant's uploaded frameworks. Not
  AI, not fuzzy keyword matching. Auditable and reproducible.

## Execution log

- **P1 — root cause found, linker shipped, one decision pending.**
  Built + tested + committed `finding_asset_linker.backfill_host_links` +
  endpoint (`7ebf4e9`). Ran it LIVE on the tenant. Result:
  `{assets:3, findings_with_host:215, matched:10, already_linked:10,
  unmatched:205}`. The real cause is deeper than a name mismatch: 205 of 215
  findings carry `affected_host = "nessus-<sha256>"` — an **opaque Nessus
  host-key**, not a hostname — and none of the 3 inventoried assets regenerate
  that hash (verified by recomputing `_stable_asset_id`). So those findings were
  scanned against a host that isn't cleanly represented in the asset inventory;
  there is no stored external-id column on ITAsset to match against either.
  The host-name linker correctly handles the clean cases (the 10) and correctly
  refuses to guess the 205 — linking them to the wrong box would be worse than
  leaving them honest-unmatched.
  **Decision needed (real-world fact I can't derive):** the 205 are all desktop
  software (Node.js, PostgreSQL 18, pnpm, WinRAR, Windows bulletins) — almost
  certainly all on the one `DESKTOP-CE3EFJB` machine. If confirmed, add a
  one-click "assign N orphaned findings → asset X" (endpoint param
  `assign_unmatched_to_asset_id`) and content jumps 10 → 215. Until confirmed,
  no fabricated links.
- **P1 — DONE & verified live.** Operator confirmed all orphans are on
  `DESKTOP-CE3EFJB`. Ran the backfill against the tenant DB with
  `assign_unmatched_to_asset_id=142`: `newly_linked=205`, links 20 → 225. Impact
  proven via `command_center` on the "Desktop estate" scope:
  `scope_findings 10 → 215`, controls `35 → 60`. The content-is-thin problem is
  fixed at the spine. (Follow-on for full richness: generate reachability
  snapshots for the 206 now-linked-but-chainless findings so Prioritisation /
  choke-points light up — currently `findings_ranked=0` because only 9 have
  stored chains. Tracked into P2/P3.)
- P2 (dashboard aggregator): next.
