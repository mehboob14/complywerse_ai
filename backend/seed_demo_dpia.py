"""Reversible DEMO for DPIA/PIA: adds risk-register rows (R-D*) with inherent and
residual likelihood×impact so the residual-reduction formula is exercised.
Reversible: cleanup deletes only the [DEMO] rows (item_number R-D*).

Usage (from backend/):  python seed_demo_dpia.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# (L, I, ResL, ResI, resolved, deadline)
RISKS = [
    (5, 5, 2, 3, False, "future"), (4, 4, 4, 4, False, "overdue"), (3, 5, 2, 2, True, None),
    (5, 4, 3, 3, False, "future"), (4, 3, 2, 2, False, "future"), (3, 3, 1, 2, True, None),
    (5, 5, 3, 4, False, "overdue"), (4, 4, 2, 3, True, None),
]
SUBJECTS = ["Customers", "Employees", "Applicants", "Patients", "Minors", "Vendors", "Website visitors", "Members"]


def _rating(score):
    return "Critical" if score >= 15 else "High" if score >= 10 else "Medium" if score >= 5 else "Low"


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "dpia_pia",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    n = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.item_number.like("R-D%")).delete(synchronize_session=False)
    db.commit()
    return {"demo_risks_removed": n}


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no DPIA assessment"}
    cleanup(db, tids)
    for i, (L, I, rl, ri, resolved, deadline) in enumerate(RISKS, start=1):
        inh, res = L * I, rl * ri
        due = now - timedelta(days=15) if deadline == "overdue" else now + timedelta(days=30) if deadline == "future" else now - timedelta(days=10)
        remarks = (f"Section: risk | Subjects: {SUBJECTS[i % len(SUBJECTS)]} | L: {L} | I: {I} | "
                   f"Inherent: {inh} | InherentRating: {_rating(inh)} | Controls: [DEMO] mitigations | "
                   f"Owner: DPO | ResL: {rl} | ResI: {ri} | Residual: {res} | ResidualRating: {_rating(res)} | "
                   f"Framework: PDPL | Target: {due.strftime('%Y-%m-%d')}")
        db.add(ComplianceAssessmentDocumentItem(
            assessment_id=doc.id, tenant_id=tid, item_number=f"R-D{i:02d}",
            area_domain=f"[DEMO] Risk {i}", control_description=f"[DEMO] privacy risk {i}",
            risk_rating=_rating(inh), priority=("high" if inh >= 10 else "medium"),
            compliance_status=("complied" if resolved else "not_complied"),
            remediation_status=("closed" if resolved else "open"),
            closed_at=((now - timedelta(days=14) if i % 2 == 0 else now - timedelta(days=6)) if resolved else None),
            target_date=due, remarks=remarks))
    db.commit()
    total = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.item_number.like("R-%")).count()
    return {"assessment": doc.name, "demo_risks_added": len(RISKS), "risk_rows_now": total}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
        tids = get_user_tenants(user, db)
        print(("Reset:" if args.command == "cleanup" else "Seeded:"),
              cleanup(db, tids) if args.command == "cleanup" else seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
