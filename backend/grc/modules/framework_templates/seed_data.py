"""Default template content for the ISO 27001 framework template tabs.

Mirrors the official ISO 27001:2022 template spreadsheets/documents: the Gap
Analysis clause areas, the Internal Audit checklist questions, and the two
document templates (ISMS Scope Statement, Internal Audit Procedure). Registers
are auto-seeded with these rows on first open; documents are created from the
section templates. Users then edit / add / delete freely.
"""

# ── Register types ───────────────────────────────────────────────────────────
REGISTER_TYPES = ("gap_analysis", "internal_audit", "risk_treatment")

# Human labels used for move-to-risk provenance ("ISO 27001 <label> — <ref>").
REGISTER_LABELS = {
    "gap_analysis": "Gap Analysis",
    "internal_audit": "Internal Audit",
    "risk_treatment": "Risk Treatment",
}

# ── Gap Analysis (ISO 27001:2022 clauses 4–10 + Annex A groups) ──────────────
# Columns used: reference, title (requirement), status, action (gap/action),
# owner, target_date.
GAP_ANALYSIS_SEED = [
    ("4 Context", "Internal/external issues and interested parties determined; ISMS scope defined."),
    ("5 Leadership", "Leadership commitment, information security policy, roles & responsibilities established."),
    ("6 Planning", "Risk assessment & treatment, Statement of Applicability, and security objectives in place."),
    ("7 Support", "Resources, competence, awareness, communication and documented information provided."),
    ("8 Operation", "Operational planning and control; risk assessment and treatment performed."),
    ("9 Performance evaluation", "Monitoring & measurement, internal audit and management review conducted."),
    ("10 Improvement", "Nonconformity & corrective action and continual improvement demonstrated."),
    ("A.5 Organizational", "Policies, roles, supplier & cloud security, incident & continuity (37 controls)."),
    ("A.6 People", "Screening, awareness, disciplinary process, remote working (8 controls)."),
    ("A.7 Physical", "Secure areas, equipment, clear desk/screen, media handling (14 controls)."),
    ("A.8 Technological", "Access, cryptography, malware, logging, backup, secure development (34 controls)."),
]

# ── Internal Audit Checklist (management clauses + Annex A samples) ───────────
# Columns used: reference, title (audit question), evidence_reviewed, result,
# finding_type, notes/action.
INTERNAL_AUDIT_SEED = [
    ("4.1", "Are external/internal issues affecting the ISMS determined?"),
    ("4.2", "Are interested parties and their requirements identified?"),
    ("4.3", "Is the ISMS scope documented and appropriate?"),
    ("5.1", "Does leadership demonstrate commitment to the ISMS?"),
    ("5.2", "Is the information security policy established and communicated?"),
    ("5.3", "Are roles, responsibilities and authorities assigned?"),
    ("6.1", "Are risks and opportunities, and risk assessment/treatment, addressed?"),
    ("6.2", "Are measurable information security objectives set and planned?"),
    ("7.2", "Are competence and training ensured and recorded?"),
    ("7.5", "Is documented information controlled (versioning, access)?"),
    ("8.1", "Is operational planning and control implemented?"),
    ("8.2", "Is information security risk assessment performed at intervals?"),
    ("8.3", "Is the risk treatment plan implemented?"),
    ("9.1", "Are monitoring, measurement, analysis & evaluation performed?"),
    ("9.2", "Are internal audits conducted at planned intervals?"),
    ("9.3", "Is management review carried out with required inputs/outputs?"),
    ("10.1", "Are nonconformities managed and corrective actions taken?"),
    ("10.2", "Is continual improvement of the ISMS demonstrated?"),
    ("A.5.15", "Is access control implemented per policy and business need? (Annex A sample)"),
    ("A.8.7", "Is protection against malware implemented across endpoints? (Annex A sample)"),
]

# Risk Treatment starts empty — risks are brought over from the register / moved
# in from Gap Analysis or Internal Audit findings.
RISK_TREATMENT_SEED = []

REGISTER_SEEDS = {
    "gap_analysis": GAP_ANALYSIS_SEED,
    "internal_audit": INTERNAL_AUDIT_SEED,
    "risk_treatment": RISK_TREATMENT_SEED,
}


# ── Document templates ───────────────────────────────────────────────────────
DOC_TYPES = ("isms_scope_statement", "internal_audit_procedure")

DOCUMENT_TEMPLATES = {
    "isms_scope_statement": {
        "title": "ISMS Scope Statement",
        "control_ref": "Cl. 4.3",
        "sections": [
            {"heading": "1. Purpose", "body": "This document defines the boundaries and applicability of the Information Security Management System (ISMS): what it covers and what it excludes."},
            {"heading": "2. Scope", "body": "The boundaries of the ISMS for [Company Name]."},
            {"heading": "3. Organisational Context", "body": "Summarise the business, the information services it provides, and the interested parties (such as customers, regulators and partners)."},
            {"heading": "4. Scope Boundaries", "body": "State precisely what is in scope, as everything not listed here is out of scope:\n- Locations in scope: [FILL IN: e.g. HQ and cloud (AWS eu-west-2)].\n- Services and products in scope: [FILL IN: e.g. the SaaS platform].\n- Organisational units and people in scope: [FILL IN: e.g. all staff]."},
            {"heading": "5. Assets & Technology", "body": "The information assets, systems and technologies covered by the ISMS are identified so the controls can be applied to them."},
            {"heading": "6. Interfaces & Dependencies", "body": "Where the scope touches third parties, such as cloud providers and suppliers, the interfaces and the split of responsibilities are defined."},
            {"heading": "7. Exclusions", "body": "Anything excluded from the scope is stated with a justification, for example physical data centres that are operated and secured by a cloud provider."},
        ],
    },
    "internal_audit_procedure": {
        "title": "Internal Audit Procedure",
        "control_ref": "Cl. 9.2",
        "sections": [
            {"heading": "1. Purpose", "body": "This procedure ensures the Information Security Management System is audited at planned intervals, by people independent of the area being audited."},
            {"heading": "2. Scope", "body": "All ISMS processes and controls within scope."},
            {"heading": "3. Audit Programme", "body": "Audits are planned, not ad hoc:\n- An audit programme schedules audits across the year, covering all in-scope processes and controls over time.\n- Higher-risk and more important areas are audited more often.\n- The programme takes account of the results of previous audits and any significant change.\n- [FILL IN: your audit frequency and how you prioritise areas.]"},
            {"heading": "4. Auditor Independence & Competence", "body": "Audits are credible because of who performs them:\n- Auditors are objective and impartial and do not audit their own work.\n- Auditors are competent to audit the area, through training or experience.\n- Where in-house independence is not possible, an external auditor may be used."},
            {"heading": "5. Conducting the Audit", "body": "Each audit follows the same three steps:\n- Plan: confirm the scope, criteria and schedule.\n- Conduct: gather evidence through interview, observation and document review.\n- Report: record conformities, nonconformities (NC) and opportunities for improvement (OFI)."},
            {"heading": "6. Follow-up", "body": "Nonconformities are logged and resolved through the Corrective Action procedure, and their resolution is verified."},
            {
                "heading": "Annual Audit Programme",
                "body": "Schedule of audits across the year (example — edit to fit).",
                "table": {
                    "columns": ["Quarter", "Area audited", "Auditor"],
                    "rows": [
                        ["Q1", "Governance, context and risk management", ""],
                        ["Q2", "People and physical controls", ""],
                        ["Q3", "Technological controls", ""],
                        ["Q4", "Performance evaluation and improvement", ""],
                    ],
                },
            },
            {
                "heading": "Internal Audit Report",
                "body": "Record each audit's outcome (one report per audit).",
                "table": {
                    "columns": ["Field", "Entry"],
                    "rows": [
                        ["Audit scope/date", ""],
                        ["Auditor", ""],
                        ["Findings (NC/OFI)", ""],
                        ["Conclusion", ""],
                        ["Follow-up actions", ""],
                    ],
                },
            },
            {
                "heading": "7. Roles & Responsibilities",
                "body": "",
                "table": {
                    "columns": ["Role", "Responsibilities"],
                    "rows": [
                        ["Audit programme manager", "Plans and oversees audits."],
                        ["Internal auditors", "Conduct audits objectively."],
                    ],
                },
            },
        ],
    },
}
