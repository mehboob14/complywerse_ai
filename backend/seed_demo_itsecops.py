"""Reversible DEMO for IT Security Operations Maturity: sets a realistic current
maturity per capability, varied by dimension (Process strong, Technology lagging
— a common real pattern) so the dimension/domain breakdowns are meaningful.
Targets already in the workbook are left untouched. Reversible: cleanup nulls the
maturity scores and resets status.

Usage (from backend/):  python seed_demo_itsecops.py seed|cleanup [--tenant complyverse]
"""
import argparse
import re
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

DIM_RE = re.compile(r"Dimension:\s*([A-Za-z/ ]+)", re.I)
TGT_RE = re.compile(r"Target:\s*([0-9]+)", re.I)
# realistic current-maturity patterns per dimension (cycled)
DIM_PATTERN = {
    "POLICY": [3, 2, 3, 2, 3, 3],
    "PROCESS": [3, 4, 3, 2, 4, 3, 3, 4, 2, 3],
    "PEOPLE": [2, 2, 3, 1, 2],
    "TECHNOLOGY": [1, 2, 1, 2, 1],
}


def _dim(it):
    m = DIM_RE.search(it.remarks or "")
    return (m.group(1).strip() if m else (it.subdomain_name or "PROCESS")).upper()


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "itsecops_maturity",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).all()
    for it in items:
        it.maturity_score = None
        it.compliance_status = "in_progress"
    doc.in_progress_count = len(items)
    doc.complied_count = doc.partially_complied_count = doc.not_complied_count = doc.na_count = 0
    db.commit()
    return {"items_reset": len(items)}


def seed(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no IT Sec Ops assessment"}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).order_by(
        ComplianceAssessmentDocumentItem.id).all()
    idx = {}
    for it in items:
        d = _dim(it)
        pat = DIM_PATTERN.get(d, DIM_PATTERN["PROCESS"])
        cur = pat[idx.get(d, 0) % len(pat)]
        idx[d] = idx.get(d, 0) + 1
        it.maturity_score = cur
        tgt_m = TGT_RE.search(it.remarks or "")
        tgt = int(tgt_m.group(1)) if tgt_m else 3
        it.compliance_status = "complied" if cur >= tgt else ("partially_complied" if cur >= 1 else "in_progress")
    doc.complied_count = sum(1 for it in items if it.compliance_status == "complied")
    doc.partially_complied_count = sum(1 for it in items if it.compliance_status == "partially_complied")
    doc.in_progress_count = sum(1 for it in items if it.compliance_status == "in_progress")
    doc.status = "in_progress"
    db.commit()
    return {"assessment": doc.name, "capabilities": len(items),
            "complied": doc.complied_count, "partial": doc.partially_complied_count}


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
