"""Reversible DEMO for the NCA Vulnerability Register: adds realistic CVEs with a
CVSS spread and remediation status/dates (some resolved on-time, some overdue) so
the CVSS-severity-weighted formula + SLA are exercised. Reversible: cleanup deletes
only the [DEMO] rows (DEMO-V*).

Usage (from backend/):  python seed_demo_nca_vuln.py seed|cleanup [--tenant complyverse]
"""
import argparse
import json
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# (cvss, resolved, deadline)  deadline: 'overdue' | 'future' | None(=resolved)
VULNS = [
    (10.0, True, None), (9.1, False, "overdue"), (8.5, True, None), (7.8, False, "future"),
    (7.2, True, None), (6.5, False, "future"), (5.0, True, None), (9.8, False, "overdue"),
    (8.0, True, None), (4.3, False, "future"), (7.5, False, "overdue"), (3.1, True, None),
]


def _sev(c):
    return "Critical" if c >= 9 else "High" if c >= 7 else "Medium" if c >= 4 else "Low"


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "nca_vuln_register",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    n = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.item_number.like("DEMO-V%")).delete(synchronize_session=False)
    db.commit()
    return {"demo_vulns_removed": n}


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no vuln register"}
    cleanup(db, tids)
    for i, (cvss, resolved, deadline) in enumerate(VULNS, start=1):
        due = now - timedelta(days=15) if deadline == "overdue" else now + timedelta(days=20) if deadline == "future" else now - timedelta(days=10)
        resolution = (now - timedelta(days=14) if i % 2 == 0 else now - timedelta(days=6)) if resolved else None
        remarks = json.dumps({
            "Vulnerability ID": f"DEMO-V{i:02d}", "Title": f"[DEMO] CVE finding {i}",
            "CVE Number": f"2023-{1000 + i}", "CVE Score": f"CVSS:3.1 {cvss}",
            "Risk Level": _sev(cvss), "Status": "RESOLVED" if resolved else "OPEN",
            "Due date": due.strftime("%Y-%m-%d"),
            "Resolution Date": resolution.strftime("%Y-%m-%d") if resolution else "-",
        })
        db.add(ComplianceAssessmentDocumentItem(
            assessment_id=doc.id, tenant_id=tid, item_number=f"DEMO-V{i:02d}",
            area_domain=_sev(cvss), control_description=f"[DEMO] CVE finding {i}",
            risk_rating=_sev(cvss), priority=("high" if cvss >= 7 else "medium"),
            compliance_status=("complied" if resolved else "not_complied"),
            remediation_status=("closed" if resolved else "open"),
            target_date=due, closed_at=resolution, remarks=remarks))
    db.commit()
    total = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).count()
    return {"assessment": doc.name, "demo_vulns_added": len(VULNS), "total_now": total}


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
