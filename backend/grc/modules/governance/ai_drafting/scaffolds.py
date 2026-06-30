"""Document-type scaffolds (Policy / Standard / Procedure / Guideline / Charter).

Each scaffold defines:
  * `mandatory_sections` — the structural skeleton the document MUST
    contain, in order. Each section names its citation `topic` so the
    pipeline can hand the LLM the relevant slice of framework controls
    for that section (e.g. "Access Control Statements" → access_control).
    Front-matter (Document Description, Approval Signoff) is rendered
    deterministically by the pipeline; annex sections carry headings that
    already include "Annex X — …".
  * `approval_matrix` — committee/role types for the Approval Signoff
    page. The pipeline resolves each tier against the tenant's actual
    committees and falls back to a generic role label when no committee
    of that type exists.
  * `annexures` — declarative list of the annex titles this doc type
    carries (the same annexes also appear as `Annex *` SectionSpecs; this
    list is the human-readable manifest and is asserted to match in tests).
  * `minimum_words`, `prompt_voice` — call-level tuning.
  * `clause_engine_breadth` — when True (Policy / Standard), the clause
    engine fans out across every cited area absent an explicit focus or
    parent scope; when False (Procedure / Guideline / Charter), it stays
    on a single dominant topic to preserve focused, single-process output.

The scaffold is consumed by `pipeline.run_drafting_pipeline()` and is
intentionally pure data — no DB or LLM imports here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


# Citation topics map 1:1 to `framework_index.TOPIC_KEYWORDS` buckets.
TOPIC_GOVERNANCE = "governance_oversight"
TOPIC_RISK = "risk_management"
TOPIC_ASSET = "asset_management"
TOPIC_ACCESS = "access_control"
TOPIC_PASSWORD = "password_policy"
TOPIC_LOGGING = "logging_monitoring"
TOPIC_INCIDENT = "incident_management"
TOPIC_BCP = "business_continuity"
TOPIC_VULN = "vulnerability_management"
TOPIC_CHANGE = "change_management"
TOPIC_3P = "third_party_management"
TOPIC_DATA = "data_protection"
TOPIC_SDLC = "secure_development"
TOPIC_PHYSICAL = "physical_security"
TOPIC_AWARENESS = "awareness_training"
TOPIC_CRYPTO = "cryptography"
TOPIC_NETWORK = "network_security"
TOPIC_EXCEPTION = "exception_management"


@dataclass
class SectionSpec:
    """One mandatory section of the document."""
    number: str                            # "4.1", "5", "Annex A" — drives ordering & heading
    heading: str                           # "Policy Statements", "Roles and Responsibilities"
    topic: Optional[str] = None            # citation topic the section pulls from
    expansion_focus: str = ""              # one-paragraph LLM instruction unique to this section
    min_clauses: Optional[int] = None      # for clause-bearing sections (4.x numbered statements)
    min_words: int = 250                   # per-section floor; LLM is told to exceed this
    inject_password_policy: bool = False   # inline PasswordPolicy numbers when True
    # When True this is the document's "clause engine" — the section whose
    # body is the heart of the document and which the pipeline may fan out
    # across multiple governance areas (one sub-section per planned area).
    # Replaces the old "topic is None and min_clauses" heuristic.
    is_clause_engine: bool = False

    @property
    def full_heading(self) -> str:
        # Annex sections already carry "Annex X — …" in their heading; do not
        # prepend the bare letter (which produced "A. Annex A — …").
        if self.heading.strip().lower().startswith("annex"):
            return self.heading.strip()
        return f"{self.number}. {self.heading}".strip()


@dataclass
class ApprovalTier:
    """One row on the Approval Signoff page."""
    label: str                              # "Prepared by", "Reviewed by", "Approved by"
    role_hint: str                          # "Chief Information Security Officer"
    committee_types: List[str] = field(default_factory=list)
    # When set, the pipeline resolves these committee types against
    # `TenantContextBundle.committees` and uses the actual committee
    # name if a match is found. Otherwise falls back to `role_hint`.


@dataclass
class DocScaffold:
    doc_type: str                           # "policy" | "standard" | "procedure" | "guideline" | "charter"
    label: str                              # "Policy" | "Standard" | "Procedure" | "Guideline" | "Charter"
    minimum_words: int
    prompt_voice: str
    mandatory_sections: List[SectionSpec]
    approval_matrix: List[ApprovalTier]
    annexures: List[str]
    # Topics the doc most often touches, used to enrich Stage A outline
    # when the user supplied no description.
    default_topic_hints: List[str] = field(default_factory=list)
    # When True, the clause engine fans out across all cited areas absent an
    # explicit focus / parent scope (broad requirement docs: Policy, Standard).
    # When False, it stays on a single dominant topic (Procedure, Guideline,
    # Charter) — preserving today's focused output.
    clause_engine_breadth: bool = False


# ─── Shared building blocks ──────────────────────────────────────────

_POLICY_FRONT_MATTER = [
    SectionSpec(
        number="1",
        heading="Document Description",
        topic=None,
        expansion_focus=(
            "Render the Document Description as a markdown table with rows for: "
            "Document Title, Document Owner, Document Classification, Version, "
            "Effective Date, Next Review Date, Approval Authority, Distribution "
            "Scope. Use the organisation's actual name and the supplied owner."
        ),
        min_words=120,
    ),
    SectionSpec(
        number="2",
        heading="Approval Signoff",
        topic=None,
        expansion_focus=(
            "Render the Approval Signoff page as a markdown table with three "
            "columns: Role, Name, Designation, Signature/Date. Include one row "
            "per approval tier supplied. Do not invent names — use exactly the "
            "names supplied; if no name is supplied for a tier, leave the Name "
            "cell empty with a horizontal rule placeholder."
        ),
        min_words=80,
    ),
]

_POLICY_BACK_MATTER = [
    SectionSpec(
        number="A",
        heading="Annex A — Risk Acceptance / Exception Request Form",
        topic=TOPIC_EXCEPTION,
        expansion_focus=(
            "Provide a complete exception request form: requester details, "
            "control / clause reference, business justification, risk treatment "
            "plan, compensating controls, requested duration, approver, and "
            "review checkpoints. Format as a fillable markdown table."
        ),
        min_words=220,
    ),
    SectionSpec(
        number="B",
        heading="Annex B — Roles and Responsibilities Matrix",
        topic=TOPIC_GOVERNANCE,
        expansion_focus=(
            "Render a RACI-style markdown table covering the roles named in "
            "Section 6, mapped against the major obligations expressed in the "
            "policy statements. Include at minimum Information Security Function, "
            "IT Operations, Internal Audit, Business / Asset Owners, and HR."
        ),
        min_words=220,
    ),
    SectionSpec(
        number="C",
        heading="Annex C — Definitions and Acronyms",
        topic=None,
        expansion_focus=(
            "Render a glossary as a markdown table (Term | Definition). Define "
            "at least 12 of the technical and regulatory terms used in the body "
            "of the policy. Acronyms appear with their expansion alongside."
        ),
        min_words=220,
    ),
    SectionSpec(
        number="D",
        heading="Annex D — Revision History",
        topic=None,
        expansion_focus=(
            "Render the Revision History as a markdown table (Version | Date | "
            "Author | Summary of Changes | Approved By). Seed with version 1.0 "
            "showing today's date and 'Initial issue' as the change summary."
        ),
        min_words=80,
    ),
]


# ─── Doc-type scaffolds ──────────────────────────────────────────────

POLICY_SCAFFOLD = DocScaffold(
    doc_type="policy",
    label="Policy",
    minimum_words=2400,
    prompt_voice=(
        "You are a senior governance and compliance consultant with twenty years "
        "of authoring information security policies for regulated banks. Write "
        "as someone who has been on both sides of audits — prescriptive, "
        "auditable, regulator-aligned, and free of generic SaaS-startup tone. "
        "Use numbered atomic clauses. Cite framework clauses inline using the "
        "bracketed format `[<FrameworkCode> <Version>, clause <Ref>]`. Never "
        "fabricate a framework code; use only the ones in the provided list."
    ),
    mandatory_sections=[
        *_POLICY_FRONT_MATTER,
        SectionSpec(
            number="3",
            heading="Purpose",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State the policy's purpose in 2–3 dense paragraphs. Tie the "
                "purpose to the organisation's regulatory perimeter and to the "
                "named active frameworks. Avoid generic safety-of-information "
                "language; speak to the auditor."
            ),
            min_words=180,
        ),
        SectionSpec(
            number="4",
            heading="Scope and Applicability",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Cover applicability across employees, contractors, third "
                "parties, all information assets, all environments (production, "
                "non-production, cloud, on-premise), and business units. State "
                "in/out-of-scope explicitly. If the tenant has named business "
                "units, list them by name as in-scope entities."
            ),
            min_words=220,
        ),
        SectionSpec(
            number="5",
            heading="Governance and Oversight",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Describe the governance bodies that own this policy. Reference "
                "the actual committee names supplied in the tenant context "
                "(Board, Risk Management Committee, IT Steering Committee, "
                "Information Security Steering Committee, Audit Committee). "
                "For each, state its responsibility relative to this policy, "
                "meeting frequency, and reporting line."
            ),
            min_words=320,
        ),
        SectionSpec(
            number="6",
            heading="Roles and Responsibilities",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Enumerate each role with a paragraph of accountabilities. "
                "Cover at minimum: Chief Information Security Officer / Head "
                "of Information Security, Information Security & Governance "
                "Function, IT Group / IT Operations, Technology Compliance, "
                "Human Resources, Business / Asset Owners, Internal Audit, "
                "All Employees. Where the tenant has named roles, reference "
                "them by name."
            ),
            min_words=420,
        ),
        SectionSpec(
            number="7",
            heading="Policy Statements",
            topic=None,    # filled per-doc — pipeline picks the dominant topic
            expansion_focus=(
                "This is the heart of the document. Produce numbered atomic "
                "clauses (7.1, 7.2, 7.2.1 …). Every clause must:\n"
                "  • express a single obligation;\n"
                "  • use prescriptive language (`shall`, `must`);\n"
                "  • where the section's topic concerns access control or "
                "    passwords, use the configured numeric thresholds verbatim "
                "    (do not invent numbers);\n"
                "  • avoid cross-referencing other unspecified policies."
            ),
            min_clauses=20,
            min_words=900,
            inject_password_policy=True,
            is_clause_engine=True,
        ),
        SectionSpec(
            number="8",
            heading="Compliance and Enforcement",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Describe how compliance with this policy is monitored, "
                "measured, and enforced. Cover metrics, internal audit "
                "engagement, disciplinary action, and contractual obligations "
                "for third parties. Reference HR processes for staff "
                "violations."
            ),
            min_words=260,
        ),
        SectionSpec(
            number="9",
            heading="Exception Handling",
            topic=TOPIC_EXCEPTION,
            expansion_focus=(
                "Describe the exception lifecycle: submission via Annex A, "
                "risk assessment, compensating controls, approval authority "
                "(must reference the actual committee resolved in Stage C), "
                "validity period, periodic re-review, and revocation triggers."
            ),
            min_words=220,
        ),
        SectionSpec(
            number="10",
            heading="Review and Maintenance",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State review cadence (annually at minimum; trigger-based "
                "interim reviews for material changes), the owner of the "
                "review process, version-control conventions, distribution "
                "approach for revised versions, and superseded-version "
                "retention."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="11",
            heading="Related Documents and References",
            topic=None,
            expansion_focus=(
                "List supporting standards, procedures, and guidelines this "
                "policy depends upon (use labels — `Information "
                "Classification Standard`, `Access Control Standard`, etc.). "
            ),
            min_words=140,
        ),
        *_POLICY_BACK_MATTER,
    ],
    approval_matrix=[
        ApprovalTier(
            label="Prepared by",
            role_hint="Head of Information Security Governance",
            committee_types=[],
        ),
        ApprovalTier(
            label="Reviewed by",
            role_hint="Information Security Steering Committee",
            committee_types=["it_steering", "compliance_committee"],
        ),
        ApprovalTier(
            label="Endorsed by",
            role_hint="Risk Management Committee",
            committee_types=["risk_committee"],
        ),
        ApprovalTier(
            label="Approved by",
            role_hint="Board Risk Management Committee",
            committee_types=["board", "audit_committee"],
        ),
    ],
    annexures=[
        "Annex A — Risk Acceptance / Exception Request Form",
        "Annex B — Roles and Responsibilities Matrix",
        "Annex C — Definitions and Acronyms",
        "Annex D — Revision History",
    ],
    default_topic_hints=[TOPIC_GOVERNANCE, TOPIC_ACCESS, TOPIC_DATA],
    clause_engine_breadth=True,
)


STANDARD_SCAFFOLD = DocScaffold(
    doc_type="standard",
    label="Standard",
    minimum_words=2200,
    prompt_voice=(
        "You are a senior security architect authoring a mandatory technical "
        "standard. Express every requirement as a measurable, testable, "
        "prescriptive statement. Use numbered clauses. "
        "Do not include guidance or examples — those belong "
        "in a separate guideline."
    ),
    mandatory_sections=[
        *_POLICY_FRONT_MATTER,
        SectionSpec(
            number="3",
            heading="Purpose",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State what the standard mandates and the policy it derives "
                "from. Two short paragraphs."
            ),
            min_words=140,
        ),
        SectionSpec(
            number="4",
            heading="Scope",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "List in-scope systems, environments, data classifications, "
                "and personnel. Be specific."
            ),
            min_words=180,
        ),
        SectionSpec(
            number="5",
            heading="Normative References",
            topic=None,
            expansion_focus=(
                "List the parent policy and every cited regulatory framework "
                "with version. Plain bullet list, no narrative."
            ),
            min_words=120,
        ),
        SectionSpec(
            number="6",
            heading="Mandatory Requirements",
            topic=None,    # filled at runtime
            expansion_focus=(
                "Produce numbered mandatory requirements (6.1, 6.2 …). Each "
                "must be atomic, testable (i.e. an auditor can collect "
                "evidence proving compliance), and prescriptive. Use exact "
                "numeric thresholds from the supplied configuration where "
                "available. Cite the source framework clause inline."
            ),
            min_clauses=22,
            is_clause_engine=True,
            min_words=900,
            inject_password_policy=True,
        ),
        SectionSpec(
            number="7",
            heading="Measurement and Evidence",
            topic=TOPIC_LOGGING,
            expansion_focus=(
                "For each requirement category list the evidence types an "
                "auditor would collect (configuration export, log sample, "
                "ticket record, screenshot of admin console, signed "
                "attestation, etc.) and the review cadence."
            ),
            min_words=280,
        ),
        SectionSpec(
            number="8",
            heading="Roles and Responsibilities",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Map each requirement group to the role accountable for it. "
                "Use a markdown table."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="9",
            heading="Exceptions",
            topic=TOPIC_EXCEPTION,
            expansion_focus=(
                "Reference the parent policy's exception process. Specify "
                "the maximum validity period and the approval authority for "
                "exceptions to this standard specifically."
            ),
            min_words=160,
        ),
        SectionSpec(
            number="10",
            heading="Review and Maintenance",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State review cadence, owner, and trigger events that force "
                "an interim review."
            ),
            min_words=140,
        ),
        SectionSpec(
            number="A",
            heading="Annex A — Revision History",
            topic=None,
            expansion_focus=(
                "Render the Revision History as a markdown table. Seed with "
                "version 1.0 / today's date / Initial issue."
            ),
            min_words=80,
        ),
    ],
    approval_matrix=[
        ApprovalTier(label="Prepared by", role_hint="Head of Information Security Architecture"),
        ApprovalTier(
            label="Reviewed by",
            role_hint="Information Security Steering Committee",
            committee_types=["it_steering"],
        ),
        ApprovalTier(
            label="Approved by",
            role_hint="Chief Information Security Officer",
            committee_types=["risk_committee", "board"],
        ),
    ],
    annexures=[
        "Annex A — Revision History",
        "Annex B — Definitions and Acronyms",
    ],
    default_topic_hints=[TOPIC_ACCESS, TOPIC_PASSWORD, TOPIC_NETWORK, TOPIC_CRYPTO],
    clause_engine_breadth=True,
)


PROCEDURE_SCAFFOLD = DocScaffold(
    doc_type="procedure",
    label="Procedure",
    minimum_words=2400,
    prompt_voice=(
        "You are a senior IT operations lead authoring a procedure that "
        "engineers will follow step-by-step under audit observation. Be "
        "operational: roles, inputs, outputs, decision points, error "
        "handling, evidence captured, escalation paths. Use ordered lists "
        "and decision trees where appropriate."
    ),
    mandatory_sections=[
        *_POLICY_FRONT_MATTER,
        SectionSpec(
            number="3",
            heading="Purpose",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State what this procedure operationalises and which "
                "policy/standard it derives from."
            ),
            min_words=120,
        ),
        SectionSpec(
            number="4",
            heading="Scope and Triggers",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "List trigger events that initiate this procedure (request "
                "submitted, alert fired, scheduled cadence, escalation "
                "received). State who can trigger it."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="5",
            heading="Preconditions and Inputs",
            topic=None,
            expansion_focus=(
                "Enumerate prerequisites (access rights required, tools, "
                "approvals already secured) and the inputs each step expects."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="6",
            heading="Roles and Responsibilities",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Name each role involved with one-paragraph accountabilities. "
                "Indicate which role performs vs. approves vs. is informed."
            ),
            min_words=260,
        ),
        SectionSpec(
            number="7",
            heading="Procedure Steps",
            topic=None,
            expansion_focus=(
                "Produce numbered procedural steps (1.1, 2.4, 4.4 …). For "
                "each step:\n"
                "  • Owner role\n"
                "  • Action description\n"
                "  • Decision points / branches\n"
                "  • Records / evidence captured\n"
                "  • Tool / system used\n"
                "  • Expected duration\n"
            ),
            min_clauses=14,
            is_clause_engine=True,
            min_words=900,
        ),
        SectionSpec(
            number="8",
            heading="Outputs and Records",
            topic=TOPIC_LOGGING,
            expansion_focus=(
                "List the outputs (artefacts, tickets, log entries, signed "
                "approvals) the procedure produces, where they are stored, "
                "and the retention period."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="9",
            heading="Exceptions and Escalation",
            topic=TOPIC_EXCEPTION,
            expansion_focus=(
                "Describe escalation triggers, escalation contacts, and how "
                "exceptions to procedure steps are requested and approved."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="10",
            heading="Review and Maintenance",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State review cadence and triggers for interim updates."
            ),
            min_words=120,
        ),
        SectionSpec(
            number="A",
            heading="Annex A — Definitions and Acronyms",
            topic=None,
            expansion_focus=(
                "Glossary table covering technical terms used in the steps."
            ),
            min_words=160,
        ),
        SectionSpec(
            number="B",
            heading="Annex B — Revision History",
            topic=None,
            expansion_focus="Revision History markdown table seeded with v1.0 / today / Initial issue.",
            min_words=80,
        ),
    ],
    approval_matrix=[
        ApprovalTier(label="Prepared by", role_hint="Process Owner"),
        ApprovalTier(
            label="Reviewed by",
            role_hint="Information Security",
            committee_types=["compliance_committee"],
        ),
        ApprovalTier(
            label="Approved by",
            role_hint="Head of IT Operations",
            committee_types=["it_steering"],
        ),
    ],
    annexures=[
        "Annex A — Definitions and Acronyms",
        "Annex B — Revision History",
    ],
    default_topic_hints=[TOPIC_INCIDENT, TOPIC_CHANGE, TOPIC_ACCESS],
)


GUIDELINE_SCAFFOLD = DocScaffold(
    doc_type="guideline",
    label="Guideline",
    minimum_words=1800,
    prompt_voice=(
        "You are a senior governance practitioner authoring a guideline. "
        "Unlike a standard, a guideline is recommended rather than "
        "mandatory — use `should` and `recommended` language. Include "
        "worked examples, anti-patterns to avoid, and implementation "
        "notes. "
    ),
    mandatory_sections=[
        *_POLICY_FRONT_MATTER,
        SectionSpec(
            number="3",
            heading="Purpose and Intended Audience",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State what the guideline advises on and who should read it."
            ),
            min_words=160,
        ),
        SectionSpec(
            number="4",
            heading="Background",
            topic=None,
            expansion_focus=(
                "Explain the regulatory or risk context that motivates the "
                "guidance. Reference the named active frameworks where "
                "relevant."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="5",
            heading="Guiding Principles",
            topic=None,
            expansion_focus=(
                "Lay out 5–8 principles in numbered form. Each principle "
                "is a short prescriptive sentence followed by 2–3 sentences "
                "of rationale."
            ),
            min_clauses=5,
            min_words=420,
            is_clause_engine=True,
        ),
        SectionSpec(
            number="6",
            heading="Recommended Practices",
            topic=None,
            expansion_focus=(
                "Detailed recommendations grouped by sub-topic. Use a mix "
                "of prose and bullet lists. Include at least one worked "
                "example or scenario."
            ),
            min_words=500,
        ),
        SectionSpec(
            number="7",
            heading="Anti-Patterns",
            topic=None,
            expansion_focus=(
                "List 5–8 common anti-patterns the audience should avoid. "
                "For each, describe the anti-pattern in one paragraph and "
                "the recommended alternative in a second."
            ),
            min_clauses=5,
            min_words=400,
            is_clause_engine=True,
        ),
        SectionSpec(
            number="8",
            heading="Roles and Responsibilities",
            topic=TOPIC_GOVERNANCE,
            expansion_focus="Brief table of who owns adoption and review of this guideline.",
            min_words=180,
        ),
        SectionSpec(
            number="9",
            heading="Related Documents",
            topic=None,
            expansion_focus="List parent policies, related standards, and reference frameworks.",
            min_words=120,
        ),
        SectionSpec(
            number="A",
            heading="Annex A — Definitions and Acronyms",
            topic=None,
            expansion_focus="Glossary markdown table.",
            min_words=160,
        ),
        SectionSpec(
            number="B",
            heading="Annex B — Revision History",
            topic=None,
            expansion_focus="Revision history table seeded with v1.0 / today / Initial issue.",
            min_words=80,
        ),
    ],
    approval_matrix=[
        ApprovalTier(label="Prepared by", role_hint="Subject-Matter Expert"),
        ApprovalTier(
            label="Approved by",
            role_hint="Head of Information Security Governance",
            committee_types=["it_steering", "compliance_committee"],
        ),
    ],
    annexures=[
        "Annex A — Definitions and Acronyms",
        "Annex B — Revision History",
    ],
    default_topic_hints=[TOPIC_GOVERNANCE],
)


CHARTER_SCAFFOLD = DocScaffold(
    doc_type="charter",
    label="Charter",
    minimum_words=1800,
    prompt_voice=(
        "You are a senior corporate governance and board-advisory professional "
        "authoring a formal Charter for a governance body, committee, or function "
        "within a regulated bank. A Charter is CONSTITUTIONAL, not operational: it "
        "establishes the body's mandate, the authority delegated to it, its "
        "composition and quorum, its decision rights, and its reporting line to the "
        "Board. Write in formal, board-ready prose — precise about authority and "
        "accountability, never aspirational and never a how-to. Use the actual "
        "committee and role names supplied in the tenant context; never fabricate a "
        "committee. Cite framework clauses inline using the bracketed format "
        "`[<FrameworkCode> <Version>, clause <Ref>]`, only from the active set."
    ),
    mandatory_sections=[
        *_POLICY_FRONT_MATTER,
        SectionSpec(
            number="3",
            heading="Purpose and Authority",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State which body this Charter constitutes, why it exists, and the "
                "AUTHORISING INSTRUMENT that establishes it (Board resolution, "
                "regulatory requirement, or parent-committee delegation) — name the "
                "instrument explicitly. Tie its purpose to the organisation's "
                "regulatory perimeter and the named active frameworks. Describe what "
                "the body is accountable for, not how it operates day to day."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="4",
            heading="Scope and Mandate",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Define the body's mandate and the boundaries of its remit: the "
                "entities, business units, and domains in scope, and what is "
                "explicitly out of scope (to prevent overlap with adjacent "
                "committees). Where the tenant has named business units, list them "
                "by name."
            ),
            min_words=220,
        ),
        SectionSpec(
            number="5",
            heading="Composition and Membership",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Define composition: the Chair (and how appointed), voting members "
                "by role/title, standing invitees/advisors, the Secretary, term and "
                "tenure, appointment and removal, and the QUORUM required for a valid "
                "meeting. Reference the actual committee chair and roles from the "
                "tenant context where supplied."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="6",
            heading="Decision Rights and Delegated Authority",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Define the decisions this body may take in its own right versus "
                "those it may only recommend, and the DELEGATED AUTHORITY THRESHOLDS "
                "that bound them (e.g. risk-acceptance value limits, approval limits, "
                "the point beyond which a matter is reserved to the Board). State the "
                "source of the delegation and what remains reserved to the Board."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="7",
            heading="Meeting Cadence and Operating Rules",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Specify meeting frequency (use the configured committee frequency "
                "where supplied), how meetings are convened, agenda-setting, the "
                "quorum for decisions, the decision/voting mechanism (consensus, "
                "majority, Chair's casting vote), minute-keeping and retention, and "
                "conflict-of-interest handling."
            ),
            min_words=240,
        ),
        SectionSpec(
            number="8",
            heading="Reporting Lines and Escalation",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State to whom this body reports, the reporting cadence and form "
                "(minutes, dashboards, exception reports), and the named escalation "
                "path with the triggers/thresholds that force escalation to the Board "
                "or a parent committee. Use the actual committee names from the "
                "tenant context."
            ),
            min_words=220,
        ),
        SectionSpec(
            number="9",
            heading="Interfaces with Other Committees and Functions",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Describe how this body interfaces with adjacent committees and "
                "functions (e.g. Board Risk, Audit Committee, IT Steering, Internal "
                "Audit, the Information Security Function): what it provides to each, "
                "what it receives, and how overlapping mandates are de-conflicted."
            ),
            min_words=200,
        ),
        SectionSpec(
            number="10",
            heading="Performance and Self-Assessment",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Define how the body's effectiveness is measured and reviewed: the "
                "self-assessment cadence, the criteria assessed, who reviews the "
                "outcome, and how findings feed back into the Charter or the body's "
                "operation."
            ),
            min_words=180,
        ),
        SectionSpec(
            number="11",
            heading="Review and Amendment",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "State the review cadence for the Charter itself (at least annually, "
                "plus trigger-based reviews on material organisational or regulatory "
                "change), who owns the review, the approval authority for amendments "
                "(the Board or its delegate), and version-control / supersession "
                "conventions."
            ),
            min_words=180,
        ),
        SectionSpec(
            number="A",
            heading="Annex A — Membership Roster",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Render a markdown table of the body's seats (Role/Title | Member "
                "Name | Voting (Y/N) | Status). Use the actual chair/roles from the "
                "tenant context where supplied; leave name cells as a placeholder "
                "rule where unknown. Below the table, state the quorum in one line."
            ),
            min_words=140,
        ),
        SectionSpec(
            number="B",
            heading="Annex B — Roles and Responsibilities (RACI)",
            topic=TOPIC_GOVERNANCE,
            expansion_focus=(
                "Render a RACI-style markdown table mapping the body's roles (Chair, "
                "Members, Secretary, key invited functions) against its principal "
                "responsibilities and decisions. Mark each cell R, A, C, or I."
            ),
            min_words=180,
        ),
        SectionSpec(
            number="C",
            heading="Annex C — Revision History",
            topic=None,
            expansion_focus=(
                "Render the Revision History as a markdown table (Version | Date | "
                "Author | Summary of Changes | Approved By). Seed with version 1.0 "
                "showing today's date and 'Initial issue' as the change summary."
            ),
            min_words=80,
        ),
        SectionSpec(
            number="D",
            heading="Annex D — Definitions and Acronyms",
            topic=None,
            expansion_focus=(
                "Render a glossary as a markdown table (Term | Definition). Define "
                "at least 10 governance and regulatory terms used in the body of the "
                "Charter. Acronyms appear with their expansion alongside."
            ),
            min_words=160,
        ),
    ],
    approval_matrix=[
        ApprovalTier(
            label="Prepared by",
            role_hint="Committee Secretary / Head of Governance",
            committee_types=[],
        ),
        ApprovalTier(
            label="Reviewed by",
            role_hint="Information Security Steering Committee",
            committee_types=["it_steering", "compliance_committee"],
        ),
        ApprovalTier(
            label="Endorsed by",
            role_hint="Risk Management Committee",
            committee_types=["risk_committee"],
        ),
        ApprovalTier(
            label="Approved by",
            role_hint="Board of Directors",
            committee_types=["board", "audit_committee"],
        ),
    ],
    annexures=[
        "Annex A — Membership Roster",
        "Annex B — Roles and Responsibilities (RACI)",
        "Annex C — Revision History",
        "Annex D — Definitions and Acronyms",
    ],
    default_topic_hints=[TOPIC_GOVERNANCE],
)


_SCAFFOLD_REGISTRY = {
    "policy": POLICY_SCAFFOLD,
    "standard": STANDARD_SCAFFOLD,
    "procedure": PROCEDURE_SCAFFOLD,
    "guideline": GUIDELINE_SCAFFOLD,
    "charter": CHARTER_SCAFFOLD,
}


def get_scaffold(doc_type: str) -> DocScaffold:
    """Return the scaffold for the requested doc type (falls back to Policy)."""
    return _SCAFFOLD_REGISTRY.get((doc_type or "").lower().strip(), POLICY_SCAFFOLD)
