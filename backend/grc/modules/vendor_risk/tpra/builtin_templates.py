"""Built-in TPRA questionnaire templates.

Each template is industry-standard (SIG, CAIQ, NIST CSF, ISO 27001 Annex A,
HECVAT, Privacy/DPA, Financial Viability). Questions carry a `domain`, a scoring
`weight`, and a `critical_control` flag so the scoring engine can weight critical
controls and attribute findings to the ten risk domains. The same question shape
feeds BOTH the legacy template.questions JSON (back-compat with the external
token flow) and the normalized TPRAQuestion rows.

Answer scale for scored questions is Yes / Partial / No / N-A (qtype "yes_no").
"""
from __future__ import annotations

from typing import Dict, List


def _q(key, text, domain, weight=1.0, critical=False, evidence=False, qtype="yes_no", options=None, order=0):
    return {
        "id": key,
        "key": key,
        "text": text,
        "domain": domain,
        "qtype": qtype,
        "type": qtype,                 # legacy alias used by the external flow
        "weight": weight,
        "critical_control": critical,
        "evidence_required": evidence,
        "options": options or [],
        "order": order,
    }


SIG_LITE: Dict = {
    "name": "SIG Lite",
    "category": "security",
    "description": "Standardized Information Gathering — Lite: a broad first-pass security & risk baseline.",
    "questions": [
        _q("sl_isms", "Do you maintain a documented information security program reviewed at least annually?", "cybersecurity", 1.0, True, True, order=1),
        _q("sl_mfa", "Is multi-factor authentication enforced for all remote and administrative access?", "cybersecurity", 1.5, True, True, order=2),
        _q("sl_enc", "Is sensitive data encrypted in transit and at rest using industry-standard algorithms?", "cybersecurity", 1.5, True, True, order=3),
        _q("sl_ir", "Do you have a documented and tested incident response plan?", "operational", 1.0, False, True, order=4),
        _q("sl_bcp", "Do you maintain business continuity and disaster recovery plans with defined RTO/RPO?", "operational", 1.0, False, True, order=5),
        _q("sl_vuln", "Do you perform regular vulnerability scanning and timely remediation?", "cybersecurity", 1.0, False, False, order=6),
        _q("sl_pentest", "Is an independent penetration test performed at least annually?", "cybersecurity", 1.0, False, True, order=7),
        _q("sl_subproc", "Do you assess the security of your own subcontractors / fourth parties?", "fourth_party", 1.0, False, False, order=8),
        _q("sl_breach", "Will you notify us of a security breach affecting our data within a defined timeframe?", "legal", 1.0, True, False, order=9),
        _q("sl_soc2", "Do you hold a current SOC 2 Type II or equivalent independent attestation?", "compliance", 1.0, False, True, order=10),
    ],
}

SIG_CORE: Dict = {
    "name": "SIG Core",
    "category": "security",
    "description": "Standardized Information Gathering — Core: comprehensive control-by-control diligence for higher-risk vendors.",
    "questions": [
        _q("sc_gov", "Is there an accountable executive owner for the information security program?", "cybersecurity", 1.0, False, False, order=1),
        _q("sc_access", "Is access granted on least-privilege and reviewed at least quarterly?", "cybersecurity", 1.5, True, True, order=2),
        _q("sc_mfa", "Is phishing-resistant MFA enforced for privileged accounts?", "cybersecurity", 1.5, True, True, order=3),
        _q("sc_keymgmt", "Are encryption keys managed in an HSM or dedicated key-management service?", "cybersecurity", 1.0, False, False, order=4),
        _q("sc_logging", "Are security events centrally logged and monitored 24/7?", "cybersecurity", 1.0, False, False, order=5),
        _q("sc_change", "Is there a formal change-management process with segregation of duties?", "operational", 1.0, False, False, order=6),
        _q("sc_dr_test", "Are DR plans tested at least annually with documented results?", "operational", 1.0, False, True, order=7),
        _q("sc_data_ret", "Are data retention and secure disposal procedures defined and enforced?", "data_privacy", 1.0, False, False, order=8),
        _q("sc_fourth", "Do you maintain an inventory of fourth parties that process our data?", "fourth_party", 1.0, True, False, order=9),
        _q("sc_geo", "Is data processed or stored only in approved geographic locations?", "geographic", 1.0, False, False, order=10),
        _q("sc_insurance", "Do you carry cyber liability insurance adequate to the engagement?", "financial", 1.0, False, True, order=11),
    ],
}

CAIQ: Dict = {
    "name": "CAIQ (Cloud Controls)",
    "category": "security",
    "description": "Cloud Security Alliance Consensus Assessments Initiative Questionnaire — cloud control posture.",
    "questions": [
        _q("caiq_tenant", "Is customer data logically isolated in a multi-tenant environment?", "cybersecurity", 1.5, True, True, order=1),
        _q("caiq_enc", "Is data encrypted at rest with customer-segregated keys available on request?", "cybersecurity", 1.5, True, False, order=2),
        _q("caiq_iam", "Do you support SSO/SAML and granular role-based access control?", "cybersecurity", 1.0, False, False, order=3),
        _q("caiq_avail", "Is there a published uptime SLA with historical availability reporting?", "operational", 1.0, False, True, order=4),
        _q("caiq_portability", "Can customers export their data in a standard format on termination?", "legal", 1.0, False, False, order=5),
        _q("caiq_vuln", "Are container/host images scanned and hardened to a recognized benchmark?", "cybersecurity", 1.0, False, False, order=6),
        _q("caiq_csa", "Are you listed on the CSA STAR registry or equivalent?", "compliance", 0.5, False, True, order=7),
        _q("caiq_subproc", "Is a current list of cloud subprocessors maintained and disclosed?", "fourth_party", 1.0, False, False, order=8),
    ],
}

NIST_CSF: Dict = {
    "name": "NIST CSF Profile",
    "category": "security",
    "description": "NIST Cybersecurity Framework profile across Identify, Protect, Detect, Respond, Recover.",
    "questions": [
        _q("csf_id", "IDENTIFY: Do you maintain an inventory of assets and data flows relevant to our service?", "cybersecurity", 1.0, False, False, order=1),
        _q("csf_pr_ac", "PROTECT: Are identity and access controls enforced with MFA and least privilege?", "cybersecurity", 1.5, True, True, order=2),
        _q("csf_pr_ds", "PROTECT: Is data-at-rest and in-transit protection implemented?", "cybersecurity", 1.5, True, False, order=3),
        _q("csf_de", "DETECT: Are anomalies and security events continuously monitored?", "cybersecurity", 1.0, False, False, order=4),
        _q("csf_rs", "RESPOND: Is an incident response plan defined, assigned, and exercised?", "operational", 1.0, False, True, order=5),
        _q("csf_rc", "RECOVER: Are recovery plans maintained and improvements captured post-incident?", "operational", 1.0, False, False, order=6),
        _q("csf_supply", "Is cyber supply-chain risk (fourth party) managed under the program?", "fourth_party", 1.0, False, False, order=7),
    ],
}

ISO_27001: Dict = {
    "name": "ISO 27001 Annex A",
    "category": "compliance",
    "description": "ISO/IEC 27001 Annex A control coverage and certification status.",
    "questions": [
        _q("iso_cert", "Do you hold a current ISO/IEC 27001 certification covering the in-scope service?", "compliance", 1.0, True, True, order=1),
        _q("iso_a5", "A.5 Are information security policies defined, approved, and communicated?", "compliance", 1.0, False, False, order=2),
        _q("iso_a8", "A.8 Is asset management (inventory, ownership, classification) in place?", "cybersecurity", 1.0, False, False, order=3),
        _q("iso_a9", "A.9 Is access control implemented per a documented policy?", "cybersecurity", 1.5, True, False, order=4),
        _q("iso_a12", "A.12 Are operations security controls (logging, malware, backup) implemented?", "cybersecurity", 1.0, False, False, order=5),
        _q("iso_a15", "A.15 Are supplier relationships and their security managed?", "fourth_party", 1.0, False, False, order=6),
        _q("iso_a16", "A.16 Is information security incident management defined?", "operational", 1.0, False, True, order=7),
        _q("iso_a18", "A.18 Is compliance with legal/regulatory requirements reviewed?", "legal", 1.0, False, False, order=8),
    ],
}

HECVAT: Dict = {
    "name": "HECVAT",
    "category": "security",
    "description": "Higher Education Community Vendor Assessment Toolkit — for vendors handling institutional/research data.",
    "questions": [
        _q("hecvat_data", "Do you classify and handle institutional data per its sensitivity?", "data_privacy", 1.0, False, False, order=1),
        _q("hecvat_ferpa", "If applicable, do you comply with FERPA / student-data obligations?", "compliance", 1.0, False, True, order=2),
        _q("hecvat_access", "Is access to institutional data restricted and logged?", "cybersecurity", 1.0, True, False, order=3),
        _q("hecvat_breach", "Do you provide breach notification consistent with our policy?", "legal", 1.0, True, False, order=4),
        _q("hecvat_acc", "Does the product meet WCAG accessibility requirements?", "reputational", 0.5, False, False, order=5),
        _q("hecvat_thirdparty", "Are third-party integrations and their data sharing disclosed?", "fourth_party", 1.0, False, False, order=6),
    ],
}

PRIVACY_DPA: Dict = {
    "name": "Privacy & DPA",
    "category": "privacy",
    "description": "Data protection / DPA diligence (GDPR/CCPA/PDPL-aligned) for vendors processing personal data.",
    "questions": [
        _q("dpa_role", "Are you acting as a processor under a signed Data Processing Agreement?", "data_privacy", 1.5, True, True, order=1),
        _q("dpa_lawful", "Do you process personal data only on documented instructions?", "data_privacy", 1.0, True, False, order=2),
        _q("dpa_dsar", "Can you support data-subject rights requests (access, erasure, portability)?", "data_privacy", 1.0, False, False, order=3),
        _q("dpa_transfer", "Are international transfers covered by an approved mechanism (SCCs/adequacy)?", "geographic", 1.0, True, False, order=4),
        _q("dpa_retention", "Are personal-data retention and deletion timelines defined and enforced?", "data_privacy", 1.0, False, False, order=5),
        _q("dpa_pia", "Do you support data protection impact assessments where required?", "compliance", 0.5, False, False, order=6),
        _q("dpa_subproc", "Are sub-processors approved, listed, and bound by equivalent terms?", "fourth_party", 1.0, False, False, order=7),
        _q("dpa_breach", "Will you notify us of a personal-data breach without undue delay (≤72h)?", "legal", 1.0, True, False, order=8),
    ],
}

FINANCIAL: Dict = {
    "name": "Financial Viability",
    "category": "financial",
    "description": "Financial health and operational viability diligence.",
    "questions": [
        _q("fin_audited", "Can you provide audited financial statements for the last two years?", "financial", 1.0, False, True, order=1),
        _q("fin_going", "Are there any going-concern qualifications or material adverse changes?", "financial", 1.5, True, False, order=2),
        _q("fin_insurance", "Do you carry adequate general and professional liability insurance?", "financial", 1.0, False, True, order=3),
        _q("fin_concentration", "Is our engagement free of undue revenue concentration risk on your side?", "fourth_party", 0.5, False, False, order=4),
        _q("fin_esg", "Do you maintain an ESG / sustainability program relevant to our requirements?", "esg", 0.5, False, False, order=5),
        _q("fin_sanctions", "Are you screened against applicable sanctions and PEP lists?", "compliance", 1.0, True, False, order=6),
        _q("fin_term", "Are termination, exit, and data-return terms commercially acceptable?", "legal", 1.0, False, False, order=7),
    ],
}


BUILTIN_TEMPLATES: List[Dict] = [
    SIG_LITE, SIG_CORE, CAIQ, NIST_CSF, ISO_27001, HECVAT, PRIVACY_DPA, FINANCIAL,
]

# Tier → suggested built-in templates (right-sizing diligence depth at stage 03).
TIER_SUGGESTED_TEMPLATES: Dict[str, List[str]] = {
    "critical": ["SIG Core", "Privacy & DPA", "ISO 27001 Annex A", "Financial Viability"],
    "high": ["SIG Core", "Privacy & DPA", "Financial Viability"],
    "medium": ["SIG Lite", "Privacy & DPA"],
    "low": ["SIG Lite"],
}
