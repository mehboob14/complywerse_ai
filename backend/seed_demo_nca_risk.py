"""Reversible DEMO for the NCA Risk Register: adds realistic risks carrying an
inherent rating that has (or hasn't) been reduced to a residual rating through
treatment, plus deadlines for the SLA dimension. Reversible: cleanup deletes only
the [DEMO] rows (item_number DEMO-R*), leaving any real risks intact.

Usage (from backend/):  python seed_demo_nca_risk.py seed|cleanup [--tenant complyverse]
"""
import argparse
import json
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# (inherent, residual, resolved, deadline)  deadline: 'overdue' | 'future' | None
RISKS = [
    ("Critical", "Medium", True, None),      # treated well + closed
    ("Critical", "High", False, "overdue"),  # barely reduced, overdue
    ("High", "Low", True, None),             # strong reduction, closed
    ("High", "Medium", False, "future"),     # reduced, in progress
    ("High", "High", False, "overdue"),      # untreated, overdue
    ("Medium", "Low", True, None),
    ("Medium", "Medium", False, "future"),
    ("High", "Medium", False, "future"),
    ("Critical", "High", False, "overdue"),
    ("Medium", "Low", True, None),
    ("Low", "Very Low", True, None),
    ("High", "Medium", False, "future"),
]
AREAS = ["Business process", "IT assets", "Third party", "People", "Facilities"]


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "nca_risk_register",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    n = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.item_number.like("DEMO-R%")).delete(synchronize_session=False)
    db.commit()
    return {"demo_risks_removed": n}


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no NCA risk register"}
    cleanup(db, tids)  # avoid duplicates
    for i, (inh, res, resolved, deadline) in enumerate(RISKS, start=1):
        remarks = json.dumps({
            "Risk identifier": f"DEMO-R{i:02d}",
            "Risk area (scope of risk)": AREAS[i % len(AREAS)],
            "Description of the risk": f"[DEMO] Risk scenario {i}",
            "Overall Inherent Risk Rating": inh,
            "Updated Overall Inherent Risk Rating": res,
        })
        it = ComplianceAssessmentDocumentItem(
            assessment_id=doc.id, tenant_id=tid, item_number=f"DEMO-R{i:02d}",
            area_domain=AREAS[i % len(AREAS)], control_description=f"[DEMO] Risk scenario {i}",
            risk_rating=inh, priority=("high" if inh in ("High", "Critical") else "medium"),
            compliance_status=("complied" if resolved else "not_complied"),
            remediation_status=("closed" if resolved else "open"),
            # resolved: alternate closed-on-time (before target) vs late (after)
            closed_at=((now - timedelta(days=14) if i % 2 == 0 else now - timedelta(days=6))
                       if resolved else None),
            target_date=(now - timedelta(days=15) if deadline == "overdue"
                         else now + timedelta(days=30) if deadline == "future"
                         else now - timedelta(days=10) if resolved else None),
            remarks=remarks)
        db.add(it)
    db.commit()
    total = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).count()
    return {"assessment": doc.name, "demo_risks_added": len(RISKS), "total_items_now": total}


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
