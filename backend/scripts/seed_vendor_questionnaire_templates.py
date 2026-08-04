"""Seed real, framework-aligned vendor questionnaire templates (TPRM-007).

Replaces the "only a junk template exists" gap with a starter library of
industry-standard questionnaires (SIG-Lite / CAIQ / privacy / resilience).
Every question carries the fields the scoring engine and coverage reporting need:

    id, text, type, domain, weight, critical_control, evidence_required,
    framework, control_ref   ← the question→framework/control MAPPING

Idempotent: upserts by (tenant, name). Safe to re-run.

Usage (from backend/):
    py -3 scripts/seed_vendor_questionnaire_templates.py --slug layeronon
    py -3 scripts/seed_vendor_questionnaire_templates.py --slug layeronon --replace  # overwrite existing questions
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND / ".env")
except Exception:
    pass

from grc.db import open_tenant_session               # noqa: E402
from grc.models import VendorQuestionnaireTemplate, Tenant  # noqa: E402


def _q(qid, text, domain, framework, control_ref, *, qtype="yes_no",
       weight=1.0, critical=False, evidence=False, options=None):
    return {
        "id": qid, "text": text, "type": qtype, "domain": domain,
        "weight": weight, "critical_control": critical, "evidence_required": evidence,
        "required": True, "framework": framework, "control_ref": control_ref,
        "options": options or [],
    }


TEMPLATES = [
    {
        "name": "Security & Data Protection (SIG-Lite)",
        "category": "security",
        "description": "A standardised information-security & data-protection assessment aligned to SIG-Lite, ISO/IEC 27001 and SOC 2.",
        "questions": [
            _q("sig_isp", "Do you maintain a board-approved information security policy reviewed at least annually?", "cybersecurity", "ISO 27001", "5.1", evidence=True),
            _q("sig_iam", "Is access to systems handling our data based on least-privilege with periodic access reviews?", "cybersecurity", "ISO 27001", "5.15", critical=True, evidence=True),
            _q("sig_mfa", "Is multi-factor authentication enforced for all remote and administrative access?", "cybersecurity", "ISO 27001", "5.17", critical=True),
            _q("sig_enc", "Is data encrypted in transit (TLS 1.2+) and at rest (AES-256 or equivalent)?", "cybersecurity", "ISO 27001", "8.24", critical=True, evidence=True),
            _q("sig_vuln", "Do you run regular vulnerability scans and remediate to a defined SLA?", "cybersecurity", "ISO 27001", "8.8", evidence=True),
            _q("sig_pentest", "Is an independent penetration test performed at least annually?", "cybersecurity", "SOC 2", "CC4.1", evidence=True),
            _q("sig_ir", "Do you have a documented, tested incident-response plan with breach-notification timelines?", "cybersecurity", "ISO 27001", "5.24", evidence=True),
            _q("sig_soc2", "Do you hold a current SOC 2 Type II or ISO/IEC 27001 certification?", "compliance", "SOC 2", "CC1.1", critical=True, evidence=True),
            _q("sig_backup", "Are backups performed, encrypted and restore-tested on a defined schedule?", "operational", "ISO 27001", "8.13", evidence=True),
            _q("sig_awareness", "Do staff complete security-awareness training at onboarding and at least annually?", "cybersecurity", "ISO 27001", "6.3"),
        ],
    },
    {
        "name": "Cloud & Infrastructure Security (CAIQ-Lite)",
        "category": "security",
        "description": "Cloud service provider assessment aligned to the CSA CAIQ / Cloud Controls Matrix and ISO/IEC 27017.",
        "questions": [
            _q("caiq_tenant", "Is customer data logically segregated between tenants with enforced isolation?", "cybersecurity", "CSA CCM", "DSP-03", critical=True, evidence=True),
            _q("caiq_region", "Can you guarantee data residency in the regions we specify?", "geographic", "CSA CCM", "DSP-19", evidence=True),
            _q("caiq_keys", "Do we retain control of, or can we bring, our own encryption keys (BYOK/HYOK)?", "cybersecurity", "CSA CCM", "CEK-03"),
            _q("caiq_logging", "Are security and access logs retained and available to us for investigation?", "operational", "CSA CCM", "LOG-08", evidence=True),
            _q("caiq_ha", "Is the service architected for high availability across multiple availability zones?", "operational", "ISO 27017", "CLD.8.1", evidence=True),
            _q("caiq_subproc", "Do you maintain and disclose a current subprocessor list with flow-down obligations?", "fourth_party", "CSA CCM", "STA-07", evidence=True),
            _q("caiq_change", "Do you follow a formal change-management process with rollback for production changes?", "operational", "CSA CCM", "CCC-01"),
            _q("caiq_exit", "On termination, do you provide data export and certified deletion within a defined window?", "legal", "CSA CCM", "DSP-16", evidence=True),
        ],
    },
    {
        "name": "Privacy & Data Handling (GDPR / HIPAA)",
        "category": "privacy",
        "description": "Data-protection and privacy assessment for processors handling personal or health data, aligned to GDPR and HIPAA.",
        "questions": [
            _q("priv_dpa", "Will you sign our Data Processing Agreement including SCCs for cross-border transfers?", "data_privacy", "GDPR", "Art. 28", critical=True, evidence=True),
            _q("priv_purpose", "Do you process personal data strictly per our documented instructions and purpose?", "data_privacy", "GDPR", "Art. 29"),
            _q("priv_dsar", "Do you have a process to support data-subject rights requests (access, erasure, portability)?", "data_privacy", "GDPR", "Art. 15-20", evidence=True),
            _q("priv_breach", "Will you notify us of a personal-data breach without undue delay (within 72h)?", "data_privacy", "GDPR", "Art. 33", critical=True),
            _q("priv_baa", "For health data, will you sign a HIPAA Business Associate Agreement?", "compliance", "HIPAA", "164.504(e)", evidence=True),
            _q("priv_min", "Do you apply data minimisation and defined retention/disposal schedules?", "data_privacy", "GDPR", "Art. 5", evidence=True),
            _q("priv_dpia", "Have you conducted a DPIA where processing is likely high-risk?", "data_privacy", "GDPR", "Art. 35", evidence=True),
            _q("priv_transfer", "Are international transfers covered by an approved mechanism (SCCs, adequacy)?", "geographic", "GDPR", "Art. 46"),
        ],
    },
    {
        "name": "Operational Resilience & Continuity",
        "category": "operational",
        "description": "Business-continuity, resilience and financial-viability assessment aligned to ISO 22301 and DORA.",
        "questions": [
            _q("res_bcp", "Do you maintain a business-continuity and disaster-recovery plan tested at least annually?", "operational", "ISO 22301", "8.4", critical=True, evidence=True),
            _q("res_rto", "Can you meet defined RTO/RPO targets for the service we consume?", "operational", "ISO 22301", "8.4.2", evidence=True),
            _q("res_sla", "Do you commit to measurable uptime SLAs with service credits?", "operational", "DORA", "Art. 30", evidence=True),
            _q("res_conc", "Do you rely on any single critical fourth party we should be aware of (concentration)?", "fourth_party", "DORA", "Art. 29", qtype="text"),
            _q("res_fin", "Can you provide audited financial statements or evidence of going-concern strength?", "financial", "SOC 2", "A1.1", evidence=True),
            _q("res_insurance", "Do you carry cyber and professional-liability insurance at adequate limits?", "financial", "Internal", "INS-1", evidence=True),
            _q("res_exit", "Do you support a documented exit/transition plan on termination?", "operational", "DORA", "Art. 28"),
        ],
    },
]


def seed(slug: str, replace: bool) -> None:
    db = open_tenant_session(slug)
    try:
        tenant = db.query(Tenant).first()
        if not tenant:
            raise SystemExit(f"No tenant row for slug '{slug}'.")
        created = updated = skipped = 0
        for t in TEMPLATES:
            existing = db.query(VendorQuestionnaireTemplate).filter(
                VendorQuestionnaireTemplate.tenant_id == tenant.id,
                VendorQuestionnaireTemplate.name == t["name"],
            ).first()
            if existing:
                if replace:
                    existing.category = t["category"]
                    existing.description = t["description"]
                    existing.questions = t["questions"]
                    updated += 1
                else:
                    skipped += 1
                continue
            db.add(VendorQuestionnaireTemplate(
                tenant_id=tenant.id, name=t["name"], category=t["category"],
                description=t["description"], questions=t["questions"], is_default=False,
            ))
            created += 1
        db.commit()
        total_q = sum(len(t["questions"]) for t in TEMPLATES)
        print(f"[seed-templates] slug={slug} created={created} updated={updated} skipped={skipped} "
              f"({len(TEMPLATES)} templates, {total_q} mapped questions)", flush=True)
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed framework-aligned vendor questionnaire templates.")
    ap.add_argument("--slug", required=True, help="Tenant slug (e.g. layeronon)")
    ap.add_argument("--replace", action="store_true", help="Overwrite questions of templates that already exist")
    args = ap.parse_args()
    seed(args.slug, args.replace)


if __name__ == "__main__":
    main()
