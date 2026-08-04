"""Reversible DEMO for the remaining assessments so the overview is fully alive:
maturity (CSIR, CTI, Incident, Digital Ops), OWASP Testing checklist, and NCA DCC
(Essential controls implemented more than Sub). Reversible: cleanup resets
maturity to None and statuses to 'Not tested'.

Usage (from backend/):  python seed_demo_rest.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

MATURITY = ["csir_maturity", "cti_maturity", "incident_maturity", "digital_ops_maturity"]
CHECKLIST = ["owasp_v4_testing_checklist", "nca_dcc_tool"]
MAT_PATTERN = [3, 2, 4, 3, 2, 3, 4, 2, 3, 1]          # avg ~2.7
CHK_PATTERN = list("cccccc" "nnn" "a")                 # 60% pass / 30% fail / 10% n/a
DCC_ESS = list("ccccccc" "nnn")                        # essential ~70%
DCC_SUB = list("ccccc" "nnnnn")                        # sub ~50%


def _docs(db, tids, fmts):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format.in_(fmts),
        ComplianceAssessmentDocument.tenant_id.in_(tids)).all()


def cleanup(db, tids):
    n = 0
    for d in _docs(db, tids, MATURITY + CHECKLIST):
        for it in db.query(ComplianceAssessmentDocumentItem).filter(
                ComplianceAssessmentDocumentItem.assessment_id == d.id).all():
            it.maturity_score = None
            it.compliance_status = "in_progress"
            it.remediation_status = None
            it.target_date = None
            it.closed_at = None
            n += 1
    db.commit()
    return {"items_reset": n}


def seed(db, tids):
    now = datetime.utcnow()
    cleanup(db, tids)
    out = {}
    # maturity models
    for d in _docs(db, tids, MATURITY):
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == d.id).order_by(
            ComplianceAssessmentDocumentItem.id).all()
        for i, it in enumerate(items):
            ms = MAT_PATTERN[i % len(MAT_PATTERN)]
            it.maturity_score = ms
            it.compliance_status = "complied" if ms >= 3 else "partially_complied"
        out[d.assessment_format] = len(items)
    # OWASP testing checklist
    for d in _docs(db, tids, ["owasp_v4_testing_checklist"]):
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == d.id).order_by(
            ComplianceAssessmentDocumentItem.id).all()
        for i, it in enumerate(items):
            ch = CHK_PATTERN[i % len(CHK_PATTERN)]
            it.compliance_status = {"c": "complied", "n": "not_complied", "a": "na"}[ch]
        out["owasp_v4_testing_checklist"] = len(items)
    # DCC — essential vs sub
    for d in _docs(db, tids, ["nca_dcc_tool"]):
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == d.id).order_by(
            ComplianceAssessmentDocumentItem.id).all()
        ei = si = 0
        for it in items:
            essential = (it.priority or "").lower() == "high"
            pat = DCC_ESS if essential else DCC_SUB
            k = ei if essential else si
            it.compliance_status = "complied" if pat[k % len(pat)] == "c" else "not_complied"
            if essential:
                ei += 1
            else:
                si += 1
        out["nca_dcc_tool"] = len(items)
    # light SLA: give ~half the fresh gaps a deadline
    for d in _docs(db, tids, MATURITY + CHECKLIST):
        gaps = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == d.id,
            ComplianceAssessmentDocumentItem.compliance_status.in_(["not_complied", "partially_complied"])).all()
        for i, it in enumerate(gaps):
            if i % 2 == 0:
                it.remediation_status = "open"
                it.target_date = now - timedelta(days=12) if i % 4 == 0 else now + timedelta(days=25)
    db.commit()
    return out


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
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
