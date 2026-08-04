"""Reversible DEMO for Saudi PDPL: realistic maturity (0-5) varied by domain so
some domains clear the compliant bar (>=3) and others don't; gaps (<3) get a risk
rating and a remediation timeline (some overdue, some closed) to exercise the
remediation/SLA dimension. Reversible: cleanup blanks everything back.

Usage (from backend/):  python seed_demo_pdpl.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

STRONG = {"Governance & Accountability", "Security", "Data Subject Rights", "Lawful Basis & Consent"}
WEAK = {"Cross-Border Transfers", "Marketing", "Special Categories", "Disclosure Controls"}
PAT = {"strong": [4, 3, 4, 3, 4], "mid": [3, 2, 3, 3, 2], "weak": [2, 1, 2, 1, 2]}


def _tier(dom):
    return "strong" if dom in STRONG else "weak" if dom in WEAK else "mid"


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "pdpl_assessment_toolkit",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).all()
    for it in items:
        it.maturity_score = None
        it.risk_rating = None
        it.remediation_status = None
        it.target_date = None
        it.closed_at = None
        it.compliance_status = "in_progress"
    doc.complied_count = doc.partially_complied_count = doc.not_complied_count = doc.na_count = 0
    doc.in_progress_count = len(items)
    db.commit()
    return {"items_reset": len(items)}


def seed(db, tids):
    now = datetime.utcnow()
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no PDPL assessment"}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).order_by(
        ComplianceAssessmentDocumentItem.id).all()
    idx = {}
    for it in items:
        tier = _tier(it.area_domain or "")
        pat = PAT[tier]
        it.maturity_score = pat[idx.get(tier, 0) % len(pat)]
        idx[tier] = idx.get(tier, 0) + 1
        it.compliance_status = "complied" if it.maturity_score >= 3 else "not_complied"

    gaps = [it for it in items if it.maturity_score < 3]
    for i, it in enumerate(gaps):
        it.risk_rating = "High" if it.maturity_score <= 1 else "Medium"
        if i % 3 == 0:  # remediated (closed) — on-time vs late
            it.remediation_status = "closed"
            it.target_date = now - timedelta(days=10)
            it.closed_at = now - timedelta(days=14 if (i // 3) % 2 == 0 else 6)
        else:  # open gap — overdue vs on-track
            it.remediation_status = "open"
            it.target_date = now - timedelta(days=15) if i % 2 == 0 else now + timedelta(days=30)

    doc.complied_count = sum(1 for it in items if it.compliance_status == "complied")
    doc.not_complied_count = sum(1 for it in items if it.compliance_status == "not_complied")
    doc.in_progress_count = 0
    doc.status = "in_progress"
    db.commit()
    return {"assessment": doc.name, "controls": len(items),
            "compliant": doc.complied_count, "gaps": len(gaps),
            "remediated": sum(1 for i in range(len(gaps)) if i % 3 == 0)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
        tids = get_user_tenants(user, db)
        if args.command == "cleanup":
            print("Reset:", cleanup(db, tids))
        else:
            print("Cleared:", cleanup(db, tids))
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
