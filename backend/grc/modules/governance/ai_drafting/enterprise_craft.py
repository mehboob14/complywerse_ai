"""Enterprise drafting craft — how SMEs actually write governance documents.

Generic LLM output reads like a SaaS startup blog post:
- "Ensure that information is protected"
- "Make sure you have a process in place"
- "Consider implementing controls"

A real bank's policy reads nothing like that. It reads like:
- "The Bank shall classify all information assets in accordance with the
  Information Classification Standard within 30 calendar days of asset
  on-boarding, with classification reviewed annually by the Asset Owner."
- "Privileged access shall be granted only following risk-based approval by
  the Information Security Function with mandatory four-eyes review; all
  granting and revocation actions shall be logged in the Identity Management
  System and retained for a minimum of seven (7) years."

This module captures the *craft* — what makes a banking-grade governance
document feel real to an internal auditor, a regulator, and a Board Risk
Committee — and injects it into every Stage B section prompt.

The blocks here are deliberately concrete, not aspirational. We list the
exact verbs, the exact retention periods, the exact governance bodies, the
exact escalation chains that a real bank uses. The LLM is told to mirror
those, not invent new ones.

The module is pure data + small string helpers; no DB or LLM imports.
Strings are designed to be appended directly to the user-side prompt
without further interpolation.
"""

from __future__ import annotations

from typing import Optional


# ─── Universal banking reality block ─────────────────────────────────────────
#
# Goes into every section prompt regardless of doc_type. Sets the writing
# environment so the LLM stops imagining a generic mid-market company and
# instead anchors to a regulated bank's actual operating reality.

BANKING_REALITY_BLOCK = """\
ENTERPRISE WRITING REALITY — write as if you are a Subject Matter Expert
inside a regulated bank's Information Security & Governance function:

Self-reference and voice
- Refer to the organisation as "the Bank" (or by its actual name if supplied).
  Never use "the company", "the organization", "we", or "our". Avoid SaaS-startup
  voice — no first person, no marketing language, no aspirational verbs.
- Active voice with clear actors. Every obligation has a named responsible
  function. Never use ownerless passive ("shall be reviewed" → "the
  Information Security Function shall review …").

Governance bodies that already exist in a bank — use these names verbatim
when they fit; do NOT invent parallel committees:
- Board of Directors
- Board Risk Management Committee (BRMC)
- Board Audit Committee
- Executive Management Committee (EXCO)
- Risk Management Committee (RMC)
- Information Security Steering Committee (ISSC)
- IT Steering Committee (ITSC)
- Operational Risk Committee
- Change Advisory Board (CAB)
- Crisis Management Committee
- New Product Approval Committee
When tenant context names specific committees, prefer those exactly.

Function / role nomenclature — use the canonical bank titles:
- Chief Risk Officer (CRO), Chief Information Security Officer (CISO),
  Chief Information Officer (CIO), Chief Compliance Officer, Chief
  Internal Auditor, Data Protection Officer
- Heads of: Information Security, IT Operations, Technology Risk, Internal
  Audit, Operational Risk, Compliance, Procurement, Human Resources, Legal
- Lines of defence: First Line (business + IT operations), Second Line
  (Risk, Compliance, Information Security), Third Line (Internal Audit)
- Reference roles, never named individuals.

Concrete numbers a banking SME would actually write
- Retention: regulatory records 7–10 years (use 7 unless context says
  otherwise); audit logs minimum 1 year online + 6 years archived; access
  reviews quarterly for privileged, semi-annually for standard.
- SLAs / cadence: Critical incidents acknowledged ≤ 15 minutes / contained
  ≤ 4 hours / reported to regulator within the local regulatory window
  (typically 24–72 hours); patching critical CVEs within 14–30 days; user
  recertification at least semi-annually; policy review at least annually.
- Crypto: TLS 1.2+, AES-256, RSA-2048+ (ECC P-256+); key rotation annually
  for static keys, on-event for compromise.
- Passwords (when no tenant-specific number is supplied): 14+ chars,
  complexity, 90-day rotation for non-privileged, 60-day for privileged,
  MFA mandatory for all external + privileged access.

Hallmarks of real enterprise governance writing
- Every obligation states: WHO (named function/role), WHAT (specific
  action), WHEN (timing, cadence, or trigger), HOW MUCH/MANY (a number
  where applicable), EVIDENCE (the artefact created).
- Cross-references are by document category (e.g. "Access Control
  Standard"), not by file name or system name.
- Tools are referenced by category, not brand ("the corporate Identity
  Management System", "the centralised log repository", "the change
  management system") — banks resist hard-coding vendor names in policy.
- Out-of-scope is stated explicitly when the topic invites confusion.
- Segregation of duties (SoD) and four-eyes review appear wherever
  initiation and approval are different functions.
- Sensitive data handling references the Information Classification
  Standard rather than redefining classes.
- Exception handling references the formal exception process, never
  ad-hoc workarounds.

Anti-patterns a real bank SME would reject in review
- "Ensure that …", "Make sure …", "Consider …", "Where possible …",
  "Best efforts to …", "As appropriate", "May be required to …".
  Replace every one of those with prescriptive language and a named owner.
- Single-line obligations with no owner ("All systems must be patched").
- Reusing the same control statement across multiple clauses with minor
  rewording (one clause per atomic obligation; no duplication).
- Generic regulatory hand-waving ("aligned with industry best practice")
  without naming the specific framework + clause.
- Tool brand names ("install CrowdStrike", "use Splunk") — write to the
  capability, not the product.
"""


# ─── Per-doc-type SME craft characteristics ──────────────────────────────────
#
# Each block describes the artefact's *purpose*, *voice*, *structure*, and
# *concrete must-haves* the way a senior governance SME would brief a junior
# author. The pipeline picks the right block based on `doc_type` and appends
# it to every Stage B section prompt.

POLICY_CRAFT_BLOCK = """\
POLICY DRAFTING CRAFT — characteristics of a real bank Policy:

Purpose of the artefact
- A Policy is the Board-endorsed statement of WHAT the Bank requires and
  WHY. It is the apex document in its domain. Standards derive from it,
  Procedures implement it, Guidelines explain it.
- It is read by: the Board, regulators, external auditors, senior
  management, and (selectively) all staff. It must read as one cohesive
  voice — never as a stitched-together checklist.

Voice
- Authoritative, prescriptive, regulator-grade. Verbs are "shall" and
  "must". "Should" appears only for clearly recommended (non-mandatory)
  practice — and only inside the body of a clause, never as the main verb.
- Sentences are dense but plain. A regulator should be able to read a
  clause aloud in a hearing without it sounding ambiguous.
- No examples, no illustrations, no implementation steps. Those belong in
  Standards / Procedures / Guidelines.

Structure of the artefact
- Numbered atomic clauses (7.1, 7.2, 7.2.1 …). Each clause expresses
  exactly ONE obligation. Compound obligations are split.
- Every clause has an implied or explicit owner. Where the owner is
  ambiguous, the clause specifies the function by name.
- Policy Statements section is the heart of the document — at least
  12–20 substantive clauses for a domain Policy, organised by sub-topic.
- Roles & Responsibilities lists the named functions and their accountabilities.
- Governance & Oversight names the actual committees that own the policy.
- Compliance & Enforcement covers measurement, internal audit engagement,
  disciplinary consequences, and contractual obligations on third parties.
- Exception Handling refers to the formal exception process and the
  approving authority.

Must-haves
- Specific retention periods, review cadences, and metrics — never
  "appropriate" or "regular".
- Direct linkage to the regulator (SAMA / NCA / SBP / RBI / OCC / FCA /
  ECB / MAS / HKMA / NBE — use the one in tenant scope).
- Cross-reference at least one named standard the policy derives requirements
  for (e.g. "as detailed in the Access Control Standard").
- Approval levels named by committee, not by individual.
- Out-of-scope statement when the topic invites confusion.

Things to NEVER do in a Policy
- Do not include step-by-step procedures.
- Do not name specific tools or vendors.
- Do not include screenshots, diagrams, or examples.
- Do not write aspirational language ("strives to", "is committed to") —
  the Policy mandates behaviour; commitment statements belong on a webpage.
"""


STANDARD_CRAFT_BLOCK = """\
STANDARD DRAFTING CRAFT — characteristics of a real bank Standard:

Purpose of the artefact
- A Standard expresses the mandatory, technically testable requirements
  that operationalise a Policy. It is the document an auditor uses to
  formulate test cases. It is the document an engineer reads to know
  what "compliant" actually means in numbers.
- A Standard is technology-aware but vendor-neutral. It states what the
  configuration must achieve, not how a specific product achieves it.

Voice
- Prescriptive, measurable, and unambiguous. Every requirement is
  testable: pass or fail, no judgement.
- Use "MUST" / "SHALL" only. "Should" is forbidden in a Standard — if
  it's not mandatory, it belongs in a Guideline.
- No rationale, no examples in the requirement body. A short purpose
  paragraph at the top is acceptable.

Structure of the artefact
- Numbered requirements grouped by technical area (cryptography, identity
  management, network segmentation, logging, etc.).
- Each requirement is the shortest sentence that fully expresses the
  obligation, followed by the numeric parameter (e.g. "Symmetric
  encryption keys SHALL be AES-256 or stronger" — not "Symmetric
  encryption keys should be reasonably strong").
- A Compliance & Verification section names the evidence used to test the
  Standard (configuration export, automated scan, SIEM query, etc., by
  category not by tool).
- An Exception Handling clause refers back to the formal exception process.

Must-haves — every Standard must contain explicit numbers / thresholds for:
- Algorithm strength (e.g. TLS 1.2+ / AES-256 / RSA-2048+ / SHA-256+).
- Time-bounds (e.g. patching window for criticals, session timeout in
  minutes, account-lockout duration).
- Cadence (e.g. access review frequency, password rotation, certificate
  rotation).
- Counts (e.g. minimum password length, MFA factors, log retention years).
- Naming conventions (when servers / users / accounts must follow a
  pattern, give the pattern).

Things to NEVER do in a Standard
- Do not write step-by-step operational instructions — those are
  Procedures.
- Do not write rationale or trade-offs — those are Guidelines.
- Do not use vague modifiers: "appropriate", "reasonable", "best-effort",
  "as needed". If the threshold is conditional, state the conditional
  explicitly.
- Do not reference named vendors or products.
"""


PROCEDURE_CRAFT_BLOCK = """\
PROCEDURE DRAFTING CRAFT — characteristics of a real bank Procedure:

Purpose of the artefact
- A Procedure is the operational runbook that translates a Policy/Standard
  obligation into the actual sequence of steps the operations team performs.
- It is the document a new joiner reads to know exactly what to do on
  shift; it is the document an internal auditor uses to test operational
  effectiveness against design.

Voice
- Imperative, role-prefixed, sequential. Every step starts with the role
  performing the action ("Information Security Analyst: …", "Change
  Manager: …"). No passive constructions.
- Operational tone — direct, time-bounded, evidence-aware. Each step
  produces an artefact that can be inspected.

Structure of the artefact
- For each scenario the Procedure covers, the structure is:
  1. Trigger — what initiates this procedure (a request, an event, a
     schedule, a threshold breach).
  2. Prerequisites — what must be true before the procedure begins
     (named approvals already held, named tools/access already in place,
     named upstream artefacts available).
  3. Inputs — the artefacts the procedure consumes by name.
  4. Roles — every named role that participates, with what they
     contribute (single-step or multi-step).
  5. Procedure Steps — numbered, role-prefixed, time-bounded where the
     SLA matters, with the artefact produced at each step.
  6. Outputs / Records — the artefacts produced and where they are stored.
  7. Evidence retained — the specific records that must be retained to
     prove the procedure executed correctly, with retention period.
  8. Exception handling — what happens if a step fails or the SLA is
     breached, and the escalation path by named role/committee.
  9. Cross-references — the Policy/Standard the procedure operationalises.

Must-haves
- Every step is concrete enough that a junior operator could follow it
  without asking questions.
- Time-bounds on every step that has one ("within 15 minutes",
  "by end of next business day", "within the current quarter").
- A four-eyes / segregation-of-duties checkpoint wherever initiation and
  approval are different.
- A named escalation path with named committees/functions for breach,
  failure, or out-of-policy condition.
- A clear handover point between functions ("Operations Analyst hands
  the ticket to the Change Manager").
- Reference to the central ticketing/ITSM/change-management system by
  category, never brand.

When the parent is a Policy or Standard, the Procedure MUST:
- Open each scenario with a citation to the parent statement(s) it
  operationalises (e.g. `[PS-003, PS-007]`).
- For every parent statement in scope, produce at least one ordered
  procedural step (often more than one) — never leave a parent statement
  un-operationalised.
- Map procedure outputs to the evidence the parent statement requires.

Things to NEVER do in a Procedure
- Do not write prescriptive Policy-style "shall" clauses — those have
  already been issued in the parent.
- Do not write rationale beyond a one-line scope statement at the top.
- Do not embed standards or thresholds inline; reference the Standard by
  name and version.
- Do not use vague verbs ("monitor", "review", "manage") without saying
  HOW the action is performed.
"""


GUIDELINE_CRAFT_BLOCK = """\
GUIDELINE DRAFTING CRAFT — characteristics of a real bank Guideline:

Purpose of the artefact
- A Guideline is the advisory companion to a Policy or Standard. It
  explains how to implement a requirement in practice, names the trade-
  offs, gives concrete examples, and answers the questions a thoughtful
  engineer would raise.
- A Guideline is NOT mandatory. Verbs are "should", "may", "is
  recommended", "consider". A Guideline never invents an obligation that
  the Policy/Standard did not already create.

Voice
- Explanatory, contextual, slightly less formal than a Policy. The
  reader is a competent engineer or business owner trying to do the
  right thing — meet them at their level.
- Examples are welcomed. Trade-offs are discussed. Edge cases are named.

Structure of the artefact
- Organise by scenario or by decision the reader is trying to make
  ("How to classify customer data", "Choosing an authentication method
  for a new application").
- For each topic, include:
  1. Recommendation — the preferred approach, plainly stated.
  2. Rationale — why this is the preferred approach.
  3. Alternatives — what other approaches exist and when each fits.
  4. Examples — concrete walked-through cases.
  5. Common mistakes — what people get wrong and how to spot it.
  6. Cross-reference — the Policy/Standard this Guideline supports.

Must-haves
- Worked examples — at least one per major recommendation.
- Explicit trade-off discussion for any non-trivial choice.
- A "common pitfalls" or "anti-patterns" section per topic.
- Placeholders for screenshots where they help (e.g.
  `[Screenshot: IAM console showing the policy attachment view]`).
- A clear statement that the Guideline is non-mandatory and does not
  override the Policy/Standard.

Things to NEVER do in a Guideline
- Do not use mandatory verbs ("shall", "must") in recommendation text.
- Do not invent obligations the Policy/Standard does not contain.
- Do not write step-by-step operational sequences — that is a Procedure.
- Do not pretend a recommendation is universal when context matters; if
  the answer is "it depends", spell out the dependence.
"""


# ─── Module entry point ──────────────────────────────────────────────────────

_CRAFT_BLOCKS = {
    "policy":    POLICY_CRAFT_BLOCK,
    "standard":  STANDARD_CRAFT_BLOCK,
    "procedure": PROCEDURE_CRAFT_BLOCK,
    "guideline": GUIDELINE_CRAFT_BLOCK,
}


def craft_block_for(doc_type: Optional[str]) -> str:
    """Return the SME craft block for the requested doc_type.

    Falls back to the Policy block if doc_type is unknown — Policy is the
    most prescriptive of the four, so falling back to it errs on the side
    of "more rigorous, less generic" output.
    """
    key = (doc_type or "").strip().lower()
    return _CRAFT_BLOCKS.get(key, POLICY_CRAFT_BLOCK)


def enterprise_drafting_block(doc_type: Optional[str]) -> str:
    """The full enterprise-craft block injected into Stage B prompts.

    Combines the universal banking reality block with the doc-type-specific
    craft characteristics. Returned as one string so the pipeline can
    append it directly without additional formatting work.
    """
    return BANKING_REALITY_BLOCK + "\n" + craft_block_for(doc_type)


# Short system-message addendum so the model anchors immediately to the
# right tone before reading the user prompt. Kept short on purpose — the
# bulk of the guidance is in the user prompt, where it gets full attention.
SME_SYSTEM_ADDENDUM = (
    " You are a senior Subject Matter Expert inside a regulated bank's "
    "Information Security & Governance function with 15+ years of authoring "
    "Policies, Standards, Procedures, and Guidelines for regulator review. "
    "Write the way a banking SME writes — prescriptive, role-attributed, "
    "numerically specific, regulator-graded, never SaaS-marketing toned, "
    "never aspirational. When uncertain between two phrasings, pick the one "
    "an external auditor would have less to question."
)


__all__ = [
    "BANKING_REALITY_BLOCK",
    "POLICY_CRAFT_BLOCK",
    "STANDARD_CRAFT_BLOCK",
    "PROCEDURE_CRAFT_BLOCK",
    "GUIDELINE_CRAFT_BLOCK",
    "SME_SYSTEM_ADDENDUM",
    "craft_block_for",
    "enterprise_drafting_block",
]
