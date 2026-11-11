# From an approved onboarding to a compliance programme (the hand-off)

Written 2026-11-12 on the onboarding branch. Phase 4 of `docs/framework-onboarding-universal-plan.md` (sections 2, 3, 6, 7). Not applied to the main checkout, not pushed.

## 1. The rule this keeps

Onboarding **configures** a framework; compliance execution **does the work**. The hand-off sits between them and only *starts* and *proposes*. It never writes a requirement, a control status or a compliance result from an answer, from an item of "What exists" or from an uploaded certificate. Everything it starts is empty of judgement: controls load as `not_started`, nothing is assessed, nothing is compliant.

## 2. What already exists and is reused

| Need in the brief | Already there | Used how |
|---|---|---|
| Create the journey, load the framework's requirements and controls | `POST /certifications` (`certification_router.create_certification`) and its twin `scf/scope_service._create_journey_for_framework` (what the Controls Automation scope sync calls). One `ControlImplementation` per parsed control, `status = not_started`, evidence already mapped to the framework seeded as `pending` | The hand-off calls `_create_journey_for_framework` (same code the scope sync uses). It never creates a second journey: any journey of the tenant for that framework, whatever its status, is the one linked |
| Assign control owners | `ControlImplementation.assigned_user_ids` (+ legacy `assigned_to_user_id`), `PATCH .../controls/{id}/assign` | Proposed from `ownership`; applied only on request and only to controls nobody owns |
| Start evidence collection, freshness, review | Evidence library (`grc_evidence`: `expiry_date`, `is_stale`, review status), `ImplementationEvidence`, `EvidenceControlMapping`, the review pipeline | "What exists" items are offered as **candidates** (a derived list, nothing copied into a control) |
| Assessment workflows, control testing, findings, remediation, dashboards, reassessment, completion, status tracking | The journey itself: criteria, evidence review, gaps, snapshots, `ComplianceHistory`, progress, the Controls Automation checks | Start when the journey exists; the hand-off adds nothing here |
| Scope | `SCFScope` (tenant-wide: business units, locations) | **Not touched**: it is shared by every framework, one framework's onboarding must not move it |
| Assessment assignees (`ItemAssignees`) | Per item of a document assessment (`compliance_assessments_router`) | Different object; not part of a journey. Not used |

## 3. What the hand-off does

`POST /compliance/framework-onboarding/{id}/programme` (needs the edit right; the onboarding must be **complete** or **underway**, else 409):

1. **Journey** - links the tenant's journey for the framework, or creates it (`journey_started` event, same as the Frameworks page). A target date answered in "Objective" is set on a journey the hand-off *creates*; an existing journey is never edited.
2. **Scope** - records the boundary the controls are assessed against (whole organisation or selected parts; departments, systems, locations, processes, third parties, hosting; exclusions with their reasons; the statement; the scope document). Names are written out, so the record reads without the tables it came from. For an approved onboarding the frozen snapshot is the source; for an underway one, its current answers. **No control's applicability is changed**: whether a control is in or out is compliance work.
3. **Proposals** - the programme owner, coordinator, approver, control teams and assessor from "Ownership", each marked with whether the person has an account. The programme owner is proposed as the owner of controls that have none.
4. **Evidence candidates** - the items of "What exists", each with its kind, issuer, date, validity, verification status (declared, document attached, reviewed, verified), its documents and its source ("declared in onboarding by ..."). A claim with no document is listed as that. They are read live from `grc_fw_existing_compliance`, so a later verification shows.

`POST .../programme/owners` applies proposal 3: every control of the journey with no assignee gets the programme owner. Never replaces an assignee, never needs doing twice.

`GET .../programme` reads it all back (never writes) for the screen.

## 4. Idempotent, recorded as events

One table, `grc_fw_programmes` (additive; one row per onboarding, unique on the onboarding): the journey, whether the hand-off created it, the scope and the proposals as written out, and the evidence candidates as they stood (`offered`). A second run builds the same four things again and compares them with the row: **all equal -> nothing is written, no event**. Something differs (an item verified, a certificate expired, a person or the scope changed) -> the row is updated and one `programme_updated` event names what changed (`journey`, `scope`, `people`, `evidence`).

Events on the onboarding's history (kinds fit the 30-character column): `journey_started` (existing kind), `programme_started`, `programme_updated`, `owners_applied`.

If the journey is deleted later, the row keeps its scope and the next run starts a new journey (recorded).

## 5. Screen

The Review stage of an approved or underway onboarding gets a "Compliance programme" card above Readiness (the header action "Start the journey" now starts the programme and lands there). It separates **Started** (journey with link, controls loaded and none assessed, scope, target date), **Proposed** (people and teams, with the button that applies the owner), **Offered** (candidates, each with its status), and one line for what has not started (assessments, testing, evidence review, findings: they begin in the journey).

## 6. Not built (and why)

- **Per-control scoping and applicability** (which control applies to which system): compliance work, needs the document analysis of phase 5 or a person's decision; today there is no per-control scope column.
- **Adding the framework to the Controls Automation scope**: tenant-wide effect; left to the Automation page.
- **Assigning teams**: a control holds users only; the team is carried as a proposal.
- **Accepting a candidate as evidence of a control**: stays the journey's own evidence flow.
- **Periodic reassessment schedule and an evidence-freshness alert for candidates**: the journey and the Evidence library own those; candidates only show `valid_until` and whether it has passed.
- **Re-run when the onboarding is reopened and approved again**: works (the digest changes); the old snapshot is not kept.
