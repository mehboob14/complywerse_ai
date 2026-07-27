# Compliverse — session handoff (2026-07-21)

Context ran out mid-session. This is the state of the work so a fresh session can pick it up.

## How to run it

- **Backend**: `cd backend && python main.py` → port 4000, everything mounted under `/grc`. **No auto-reload — restart after any Python change.**
- **Frontend**: `cd grc-frontend && npm run dev` → port 3000.
- **Use the hostname `complyverse.localhost:3000`**, not `localhost:3000` — tenant routing resolves from the subdomain.
- DB: Postgres on `127.0.0.1:5433`, databases `grc_master` and `grc_complyverse`.
- Tables are created by `Base.metadata.create_all` at startup (`db.py:137`). **There is no Alembic.** See the top open item.

## What this session was about

Restructuring the Cybersecurity Assurance module (vulnerability detail + asset detail) against a reference product called Command Center. The recurring theme, and the thing to keep watching for: **the same concept rendered in several places, often with different numbers.**

## Vulnerability detail page — done

Five tabs: Analysis, Remediation, Exploit Test, History, Notes.

- **Remediation tab regrouped 6 blocks → 3**: "The fix" → "Who owns it" → "If we're not fixing it yet".
- **Exploit Test regrouped 10 blocks → 3**: "Can it be reached?" → "How far would it spread?" → "Prove it". Deleted "How an attack would unfold" and "What would stop it" (prose restatements); merged "Reachability checks" + "Controls that would block this" into one Evidence table (they were one dataset shown twice, inverted). The written narrative moved into the downloadable report, where prose earns its place.
- **Four copies of the AI recommendation removed.** It rendered as a second plan generator, as a raw-markdown "Recommendation" blob, as an "AI Recommendation" card on Analysis, and as a "Remediation recommendation" block in RiskAnalysisPanel. One remains, correctly scoped.
- **The AI prompt was re-scoped** to compensating controls only. It had been asserting "no vendor patch is available" — a fact it cannot verify — directly contradicting the plan above it. It is now forbidden from proposing the patch, asserting patch availability, or setting deadlines.
- **Accept Risk now writes a real expiry** (`exception_expires_at`) via `POST /vulnerabilities/{id}/accept-risk`. Previously the review date went only into note text, so acceptances never lapsed.
- **The expiry sweep now runs and reopens findings.** `expire_due_exceptions()` existed but was only called from a Celery task with no worker running; it also only flipped `exception_status` while leaving `status='accepted'`, so a lapsed acceptance stayed invisible. It now runs at request time on the register load, tenant-scoped, and reopens the finding.
- **Approve requires an owner** — a person or a department. Approving work nobody is assigned to now 409s with an explanation, and the button is disabled with that reason shown.
- **Verify requires evidence** (min 10 chars) and no longer fabricates proof. It previously wrote "is recorded as no longer present" with nothing checked; it now records an attestation attributed to a named person.
- **Applied admits it is simulated** — an amber banner where the green tick is, because the executor never touches a host.
- **Kill-chain stages are clickable**, each explaining why it is in its state and what would stop it.
- **Re-test actually re-tests** — it previously refetched only the asset and IP peers, never the vulnerability, so KEV/EPSS/exploit-count changes could never move the verdict. It now stamps "Re-assessed HH:MM".
- **History tab de-duplicated** — it had two things both called "History", plus three blocks whose only content was the word "no". The workflow section now hides when empty.
- `cvss_vector` is now **backfilled from NVD** during enrichment (`nvd_client.py` reads `metrics.cvssMetricV31/V30/V2`). Only scanner imports used to supply it, so manual findings scored on a 0.5 guess worth 10% of the total.

## Asset detail page — done

**17 tabs → 12.** Folded, not deleted:

| Removed | Into | Why |
|---|---|---|
| Discovery | Overview | All 9 fields already there, no query, no history |
| Assignments | Overview | 8 of 9 rows already in Identity & Ownership |
| Activity | Compliance | Same endpoint, smaller limit — identical rows |
| Alerts | Vulnerabilities | A severity ranking of the same join |
| Mapping Recommendations | Risk & Controls | Writes the same link table |

Also fixed: **coverage was computed three different ways** (÷10 with partials at 0.5 on Overview, ÷12 counting partials fully in ControlsTab, ÷12 again in the risk engine) — so the number on screen was never the one driving the risk score. Now one number, verified at 33.3% from both sources with 4 controls linked. `ip-peers` was fetched twice under two cache keys → now one. Lifecycle's "Transition history" placeholder removed (no transition table exists).

## Scoring, for reference

`composite_priority`, 0–10, shown ×10 as N/100. Seven weighted signals:

```
CVSS 0.20 | EPSS 0.20 | exploit maturity 0.15 | KEV 0.15
attack vector 0.10 | internet exposure 0.10 | asset criticality 0.10
KEV floor: anything on CISA KEV is floored at 8.0
```

**Priority ranks the queue. It does not start remediation.** That is done by six independent red flags in `_red_flags()` (`remediation_plans.py:143`): KEV listed, any public exploit, EPSS ≥ 10%, past due date, internet-facing asset, business-critical asset. An empty flag list is a real answer — the finding waits for the normal patch cycle.

## Open items, highest value first

1. **Migrations.** A model gained four columns (`triggers`, `cancelled_at`, `cancelled_by_name`, `cancel_reason`) and the whole remediation-plans feature 500'd, because `create_all` never alters an existing table. Repaired by hand with `ALTER TABLE`. **This will happen again.**
2. **Two unreconciled criticality scores** — the CIA card derives one, the formal ISCA/IACA workflow stores another, and `asset.criticality` appears a third time on Overview. None of them know about each other.
3. **Accept Risk bypasses the exception FSM** — it writes `none → approved` directly, which `_ALLOWED_TRANSITIONS` forbids (`none` may only go to `requested`). It works only because `approved → expired` happens to be legal.
4. **Stale-asset rule implemented twice** — backend alert (30 days) and a separate frontend check in the Discovery panel.
5. **Exploit-test blockers are not mapped to real ISO/NIST controls.** They are heuristics, so a "blocked" step is not usable as control evidence — a genuine gap for a GRC product.
6. **No Discovery Details card** on the vulnerability page (Source / Detected / **Last seen**). Last-seen matters most: it says whether the finding is still real.
7. **Trajectory tab** — a fifth view of the same asset→vuln→risk rows. Keep only if it earns its place in demos.
8. `formatAIText` in the vulnerability page is now dead code.

## Test data notes

- The 15 demo findings use synthetic CVEs (`CVE-2024-2001`–`2015`) that **do not exist in NVD**. Enrichment correctly finds nothing for them, so the `cvss_vector` backfill is invisible on demo data.
- There are **no control links and no asset relationships** seeded, so coverage reads 0% and blast radius is empty until some are created.
- NVD rate-limits without an API key (~5 requests / 30s). Worth setting one before any bulk enrichment.

## Security

The backend prints a live OpenAI key on every boot (`sk-proj-…N3NohPAA`). It was previously exposed in the repo along with a Gmail app password. **Both should be rotated.**

## QA sweep round 1 — findings and fixes (2026-07-21)

An autonomous QA agent ran `QA-AGENT-PROMPT.md` against VULN-37/42 and Assets 44/49/51.
Its verdict — "the remediation lifecycle is solid, the scoring/propagation layer is not" —
was correct. Five bugs found and fixed:

- **Assign was 422-ing on every attempt**, blocking the whole person-based ownership path
  (and therefore Approve, which now requires an owner). The caller passed
  `{ assigned_to: userId } as any` into a client that already wraps it as `{ user_id }`.
  The `as any` cast is what let it ship.
- **The "primary" affected asset could silently swap.** There was no `ORDER BY` on either
  `_primary_asset()` or the asset-links endpoint, so Postgres returned rows in heap order —
  and updating an asset moves its row. Raising an asset to Critical/internet-facing could
  make the finding read "medium / not exposed" because the primary had quietly become a
  different asset. Both paths now order worst-first (criticality → internet-facing → id),
  matching each other. This was the root cause under several other reported symptoms.
- **No lifecycle event was journalled.** Adopt/approve/apply/verify wrote no audit rows,
  and verify changed status without one — so History said "edits from here on are
  journalled" directly beneath four unjournalled decisions.
- **Asset "Open Findings" never dropped.** It counted every linked finding regardless of
  status, so a Verified or Risk-Accepted one still reported as open while the register's
  own count correctly fell.
- **"Risk contribution 41 → 0" contradicted a header still reading 41.** Neither was wrong:
  the finding stops counting toward open risk, but its own score describes the flaw.
  Wording now says both.

Still open from that report, all non-structural: severity donut vs stat-card scoping on the
dashboard; a "has/has not" template bug in the threat narrative; silent 422 when Department
Code is blank (no required marker); empty-textarea attest silently no-ops while 2 chars
validates; the Reopen button renders with no visible label; duplicate Create Department
buttons; a duplicated reference URL; and the register list badge showing EPSS **percentile**
labelled "EPSS" (37% vs the real 0.5%).

Never exercised in that pass, worth a round 2: Relationships, Software promotion, Lifecycle,
Attachments, Compliance/CIS scan, Trajectory, Criticality Assessments, Change Status, the
MITRE "Why?" drill-downs, Vulnerability Chain linking, and Bulk Upload / NCA import.

**Unattributed data:** five remediation plans exist on vulns 33, 34, 41, 43, 44. They are not
from the QA run or from verification testing, and I left them rather than delete something I
could not account for. Worth checking.

## Late-session fixes (after the QA round)

- **Exploit counts were inflated on every finding.** `github_poc_client.py` queried
  `"{cve} in:name,description,readme"`, which matches every CVE catalogue, scanner and
  "awesome-security" list on GitHub. A CVE that does not exist returned 258 hits, led by
  PocOrExp_in_Github, SploitScan and cve-scores — none of them exploits. That count then made
  `_maturity_from_exploits` stamp "weaponized" (count > 2), worth 36% of the score, and fired
  the "N public exploits" red flag that triggers remediation.
  Query is now `in:name` only (real PoCs name themselves after the CVE; catalogues do not),
  plus an aggregator filter on the displayed list. Measured: Log4Shell 183 genuine repos,
  nonexistent CVE 0. **All 15 demo findings were re-enriched** — counts fell from 208–623 to
  0–1 and VULN-37 dropped from 41/100 to 29/100, so every score in the demo data has moved.

- **Loopback was being treated as a host identity.** `window 11`, `VERIFY PostgreSQL 16` and
  `Windows MSRPC` all carry `127.0.0.1`, so the IP-group logic merged three unrelated assets
  into one host and shared their CIS compliance. Asset 51, which has zero scan runs, was
  reporting `cis known=True` off a peer's 470 runs while the UI beside it said "not scanned".
  `_is_groupable_ip()` now excludes loopback / link-local / unspecified / multicast in both
  `risk_posture/service.py` and the `ip-peers` endpoint. Asset 51: cis now `known=False`,
  score 32.4 → 34.9 (the borrowed score had been flattering it).

**The recurring defect in one sentence:** something unknown presented as something known —
fabricated verification evidence, a guessed attack vector drawn as a green tick, keyword hits
reported as exploits, a stranger's compliance score reported as this asset's own. When
reviewing any page here, that is the thing to look for first.

**Risk posture page: still unaudited.** Only its service layer has been touched. The page
itself has never been opened, compared, or tested. Known service-layer issue: an asset with
3 of 5 dimensions unknown still gets a confident band label ("contained / Healthy posture"),
so absence of evidence reads as good news.

## Risk Posture audit (2026-07-21) — fixed and outstanding

**Fixed:**
- **Every band pill on both risk-posture pages rendered grey.** `BAND_COLOR`/`BAND_BAR`/`RING`
  were keyed `low/moderate/high/critical` — the band names from *before* the rename to
  `contained/watch/elevated/severe`. Every lookup missed and fell through to the grey
  "unknown" default, so an entire risk colour scale had silently switched itself off.
  (Self-inflicted: caused by the earlier band rename, not caught then.)
- **`GET /risk-posture/dashboard` wrote and committed once per asset, per load, and the page
  polls every 30s.** Justified in a comment as "warming the cache" — but nothing in the repo
  ever reads `effective_risk_score` / `_reason` / `_computed_at`. Pure write amplification.
  Now `persist=False`; verified the timestamps stop moving across repeated loads.
- **`POST /asset/{id}/preview` wrote too**, despite a docstring promising it was read-only —
  committing every linked vuln's effective_risk columns plus the user's *unsaved* form values,
  on every toggle (`staleTime: 0`). The old snapshot-and-restore workaround is no longer needed.
- **An estate with nothing scored reported `avg_score = 0.0`**, rendered as a green 0 captioned
  "avg risk / 100" — "measured nothing" was indistinguishable from "flawless". Now null → "—".
- **Saving weights never refreshed anything** — `['risk-posture-dashboard']` vs the page's
  `['risk-posture.dashboard']` (hyphen vs dot), in two files.

**Still outstanding (audit found ~40; these are the ones that matter):**
- `_cis_gap` sets `known: True` from peers alone, and the asset page then renders `1.000`
  (worst possible CIS gap) because `pass_rate` is None for that path.
- CIS pass-rate computed two ways (`_cis_gap_self` includes never-scanned rules in the
  denominator; `_asset_own_compliance` counts only passed+failed) and BOTH render on the asset
  page ~300px apart with no label distinguishing them.
- The IP-group blend is implemented twice with divergent math (penalty and clamping applied in
  `assets_router` but not in `service.py`), while a comment claims they are the same formula.
- An all-errored CIS scan scores as **perfect** (`scanned == 0 → score 0.0`) at full weight,
  while the card above shows 0% pass rate.
- `effective_risk.py` docstring weights contradict its own code (`w1` 0.35 vs 0.30).
- Business-impact multiplier tables duplicated in the UI and disagree with the backend
  (PII 1.3x vs 1.4x); effective-risk weights hardcoded again in the UI to print the equation.
- "Ignore EPSS + KEV" changes sort order only — the Effective column it claims to change is
  unchanged; and the printed weighted-base equation does not equal its own total for escalated
  vulns (base is overwritten to the 0.85 floor).
- `cia` is `known=True` unconditionally, so the `composite = None` / "unknown" band branch is
  unreachable — and all the frontend handling for it is dead.
- No panel for the Risk dimension despite it carrying 15% weight.
- Dead: `external_feeds.py` (zero importers), `VULN_POINTS_CAP`, `sortKey: 'data_quality'`,
  the IP-group penalty note (reads `composite.penalty`, backend sends `penalties`), and three
  disagreeing permission gates on the weights panel.

## Next piece of work: UI pass (not started)

Requested: improve the UI of IT Assets + its sub-pages, Risk Posture, and Vulnerabilities.
Deliberately NOT started — it needs a fresh session with room to re-read before each edit.
The structural work is done; this is presentation only. Do not re-architect.

**Ground rules for whoever picks this up**
- The asset suite uses a warm scoped design system under `.asset-suite` (`--as-*` variables,
  IBM Plex). The vulnerability and risk-posture pages use the default Tailwind slate palette.
  That split is the single biggest visual inconsistency in the module — decide on one and
  apply it, rather than polishing each page in its own direction.
- Tailwind is v3: only `order-1`..`order-12` exist. Arbitrary values like `order-20` are
  silently dropped (this already caused the Remediation tab to render upside down).
- Band colour keys must stay `contained / watch / elevated / severe`. A previous rename left
  three colour maps keyed to the old names and every pill rendered grey for weeks.
- Severity colour (critical/high/medium/low) is semantic and separate from the brand accent.
  Do not merge them.

**Highest-value targets, in order**
1. **Asset detail tab bar** — 12 tabs on one row wraps badly at laptop widths. Group them
   (What it is · What is wrong · How it is protected · How it connects · The record) or make
   it a scrollable rail with sticky active state.
2. **Risk Posture asset page** — the five dimension panels are visually flat; the score, the
   band and the data-quality figure should read as one unit, and data quality needs to be
   prominent (a 45%-quality score is a different claim from a 95% one).
3. **Vulnerability Analysis score card** — the 7-signal breakdown is the best explanatory
   element in the product and currently looks like a debug table. It deserves the strongest
   visual treatment on the page.
4. **Empty states** — many read as failures rather than "nothing here yet". They were made
   honest in wording; they have not been made calm in appearance.
5. **The register list** — severity, priority, status and SLA all compete for attention.
   Establish one primary scan column (priority) and demote the rest.

**Do not**
- Touch scoring, endpoints, or query keys during a UI pass. Every regression today came from
  mixing presentation edits with logic edits in the same change.
- Add new cards or tabs. The last two sessions removed 5 asset tabs and 9 vulnerability
  blocks as duplication; do not reintroduce surface area.

## TOP PRIORITY — build a GUIDED REPLICA of the module (not a docs site)

I misread this request three times and built documentation websites. The user corrected it
plainly: **"it will be seen same to same as product mode. The difference is that product has
no guidance and explanation and has no data. Here, you have data and complete explanation."**

**What to build:** a pixel-faithful CLONE of the Cybersecurity Assurance UI — same sidebar,
same asset detail page with its real 12-tab bar, same risk-posture screens, same vulnerability
detail with its 5 tabs — that is:
  1. **Fully populated with realistic data** (no empty states, no 0%, no "—"), and
  2. **Annotated**, so every field, number, badge and button carries an explanation of what it
     is, where the value comes from, and why it exists.

It should feel like using the product with a teacher standing beside you.

**What NOT to build:** another sidebar-of-headings documentation site with diagrams. Three
already exist and none of them is what was asked for. Do not add a fourth.

**Implementation notes**
- Reuse the REAL components where possible rather than re-drawing them. A route such as
  `/guide-mode` that renders the actual asset/vulnerability/risk-posture pages against a fixed
  demo payload, wrapped in an annotation layer, gets fidelity for free and cannot drift from
  the product. Re-implementing the UI by hand guarantees it will look subtly wrong and go
  stale.
- The annotation layer can be numbered hotspots, hover cards, or a right-hand explain rail —
  whichever keeps the underlying screen visually intact.
- Seed data must make every dimension non-empty: controls linked, relationships declared, CIS
  runs present, a KEV finding, an accepted risk with an expiry, a completed remediation
  lifecycle. Empty screens are the main reason the current product demos badly.
- Content is already written — pull it from `public/guide/index.html` and
  `public/guide/walkthrough.html`. This is a presentation problem, not a research one.

**The three existing docs** (`/guide`, `/guide/walkthrough.html`, and the published artifact)
are still useful as reference and as a source of copy. They are not the deliverable.

## Better idea from the user: put the guide INSIDE the product

The user proposed replacing the static replica with in-product contextual help: numbered
markers on the real UI that open the same explanation when clicked. This is the right call and
supersedes the guided-replica approach.

**Why it wins:** the replica at `public/guide/explore.html` WILL drift the moment anyone edits
the real asset page, and nobody will remember to update it. Markers on the live component
cannot disagree with what is on screen. It also stops being a demo artifact and becomes a
feature for new staff, auditors and customers.

**Design constraints**
- OFF by default. A "?" / "Guide" toggle in the app header enables it.
- Markers must be quiet — a small outlined number or superscript dot, ideally revealed on
  hover of the element it annotates. The replica used large filled teal circles and the user
  reported they look messy sitting on top of real UI.
- Clicking opens a side panel or popover, not a modal — the reader must still see the element.

**Implementation sketch**
- One content map, e.g. `src/lib/guide-notes.ts`:
  `{ 'asset.riskScore': { what, where, why, misreading }, 'vuln.epss': {...} }`
- A small `<GuideMarker id="asset.riskScore" />` component that renders nothing unless guide
  mode is on, and a `<GuidePanel />` that renders the looked-up entry.
- Guide mode state in context or a URL param (`?guide=1`) so it can be linked for demos.
- Content already exists — ~22,000 words across 126 entries in
  `public/guide/explore.html` (the NOTES object). Port it; do not rewrite it.

**Retire the replica once this ships.** Maintaining both guarantees they diverge.

## Small, well-defined UI jobs queued (asset register, /assets)

**1. Fill the empty grid slot on the charts row.**
`src/app/(dashboard)/assets/_suite/InventoryStats.tsx` has a charts row:
`gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)'`. The `1fr` column is now EMPTY —
the "By criticality" card that used to sit there was removed as a duplicate.
The owner wants the criticality card moved into that slot.
The card they want is `<SegmentedMixCard totalLabel="assets by criticality" data={chartData.dist} />`,
currently rendered in `src/app/(dashboard)/assets/_workspace/AssetsWorkspace.tsx`.
Move it into the empty slot in InventoryStats (it will need the criticality distribution —
InventoryStats already computes `critCounts`, map that to the `MixSlice` shape) and REMOVE it
from AssetsWorkspace so it does not duplicate again. Two files; verify tsc stays at 106.

**2. `onCrit` is now an unused prop** on `InventoryStats`. The click-to-filter behaviour lived
on the card that was removed. Either wire `onCrit` into the surviving criticality card or drop
the prop and its argument at the call site in `assets/page.tsx`.

**3. `/assets` renders BOTH `InventoryStats` and `AssetsWorkspace`,** one after the other, and
they overlap. Two duplicated cards have already been found and removed this way ("Assets added
over time", "By criticality"). Nobody has audited the rest of the overlap between those two
components — worth doing in one pass rather than one card at a time.

**4. IT Asset Discovery was re-linked in the sidebar at the owner's request**
(`src/components/layout/Sidebar.tsx`). The page is still a STATIC DESIGN PREVIEW — invented
devices, counts and timestamps, zero API calls. It is now reachable from the nav, so a demo can
land on fabricated inventory. Either wire its five tabs to the discovery endpoints, or add a
visible "Preview: sample data" banner to the page.

## Next step

`QA-AGENT-PROMPT.md` in this folder is a full autonomous QA sweep prompt for the Claude Chrome extension. Sign in first, then hand it the session. Mission 3 in that prompt — whether the pages are genuinely wired together — is the part worth reading first.
