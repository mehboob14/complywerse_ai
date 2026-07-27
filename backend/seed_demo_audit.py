"""Reversible DEMO for the NCA Audit Plan: adds planned audits with a status and
schedule (some completed on-time, some overdue) so completion + schedule-adherence
are exercised. Reversible: cleanup deletes only the [DEMO] rows (DEMO-A*).

Usage (from backend/):  python seed_demo_audit.py seed|cleanup [--tenant complyverse]
"""
import argparse
import json
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# (status, end_offset_days, done_on_time)
AUDITS = [
    ("completed", -30, True), ("completed", -20, False), ("in progress", 20, None),
    ("in progress", -5, None), ("planned", 40, None), ("completed", -10, True),
    ("planned", 60, None), ("in progress", 12, None),
]
TYPES = ["Design effectiveness", "Operational effectiveness", "Compliance review", "Thematic review"]


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "nca_audit_register",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    n = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.item_number.like("DEMO-A%")).delete(synchronize_session=False)
    db.commit()
    return {"demo_audits_removed": n}


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no audit plan"}
    cleanup(db, tids)
    for i, (status, end_off, on_time) in enumerate(AUDITS, start=1):
        end = now + timedelta(days=end_off)
        done = status == "completed"
        closed = (end - timedelta(days=4) if on_time else end + timedelta(days=6)) if done else None
        remarks = json.dumps({
            "Type": "Audit", "Audit ID": f"DEMO-A{i:02d}", "Audit name": f"[DEMO] audit {i}",
            "Type of audit": TYPES[i % len(TYPES)], "Lead Auditor": "Demo Auditor",
            "Status": status.title(), "Audit End": end.strftime("%Y-%m-%d")})
        db.add(ComplianceAssessmentDocumentItem(
            assessment_id=doc.id, tenant_id=tid, item_number=f"DEMO-A{i:02d}",
            area_domain=TYPES[i % len(TYPES)], control_description=f"[DEMO] audit {i}",
            priority=("high" if end_off < 0 and not done else "medium"),
            compliance_status=("complied" if done else "in_progress"),
            remediation_status=("closed" if done else "open"),
            target_date=end, closed_at=closed, remarks=remarks))
    db.commit()
    total = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).count()
    return {"assessment": doc.name, "demo_audits_added": len(AUDITS), "total_now": total}


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
