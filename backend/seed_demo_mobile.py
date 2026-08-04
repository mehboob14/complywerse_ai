"""Reversible DEMO for Mobile App Security (MASVS): sets pass/fail on the testable
requirements (leaves N/A markers intact), with pass rates by level tier (L1 high,
L2 mid, Resilience low) and iOS slightly ahead of Android, plus remediation dates
for the SLA dimension. Reversible: cleanup resets all non-N/A items to 'Not tested'.

Usage (from backend/):  python seed_demo_mobile.py seed|cleanup [--tenant complyverse]
"""
import argparse
import re
from datetime import datetime, timedelta
from grc.models import (GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

MASVS_RE = re.compile(r"MASVS:\s*([LR0-9,\s]+)", re.I)
PLAT_RE = re.compile(r"Platform:\s*([A-Za-z ]+)", re.I)
# complied-out-of-10 per tier and platform — iOS app noticeably more mature.
PAT = {"L1": {"ios": 8, "android": 6}, "L2": {"ios": 6, "android": 4}, "R": {"ios": 4, "android": 3}}


def _tier(it):
    m = MASVS_RE.search(it.remarks or "")
    lvls = set(re.split(r"[,\s]+", m.group(1).strip().upper())) if m else set()
    if "R" in lvls or "RESILIENCE" in lvls:
        return "R"
    if "L2" in lvls or "2" in lvls:
        return "L2"
    return "L1"


def _plat(it):
    m = PLAT_RE.search(it.remarks or "")
    return (m.group(1).strip() if m else "General")


def _doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "mobile_app_security",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


def cleanup(db, tids):
    doc = _doc(db, tids)
    if not doc:
        return {"doc": 0}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).all()
    n = 0
    for it in items:
        if it.compliance_status != "na":
            it.compliance_status = "in_progress"
            it.remediation_status = None
            it.target_date = None
            it.closed_at = None
            n += 1
    db.commit()
    return {"items_reset": n}


def seed(db, tids):
    now = datetime.utcnow()
    doc = _doc(db, tids)
    if not doc:
        return {"error": "no Mobile assessment"}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).order_by(
        ComplianceAssessmentDocumentItem.id).all()
    idx = {}
    for it in items:
        if it.compliance_status == "na":
            continue
        tier = _tier(it)
        plat = "ios" if _plat(it).lower().startswith("ios") else "android"
        n = PAT[tier][plat]
        pat = ["c"] * n + ["n"] * (10 - n)
        k = (tier, plat)
        it.compliance_status = "complied" if pat[idx.get(k, 0) % 10] == "c" else "not_complied"
        idx[k] = idx.get(k, 0) + 1

    fails = [it for it in items if it.compliance_status == "not_complied"]
    for i, it in enumerate(fails):
        if i % 4 == 0:  # remediated
            it.compliance_status = "complied"
            it.remediation_status = "closed"
            it.target_date = now - timedelta(days=10)
            it.closed_at = now - timedelta(days=14 if (i // 4) % 2 == 0 else 6)
        else:
            it.remediation_status = "open"
            it.target_date = now - timedelta(days=15) if i % 2 == 0 else now + timedelta(days=30)

    doc.complied_count = sum(1 for it in items if it.compliance_status == "complied")
    doc.not_complied_count = sum(1 for it in items if it.compliance_status == "not_complied")
    doc.na_count = sum(1 for it in items if it.compliance_status == "na")
    doc.in_progress_count = sum(1 for it in items if it.compliance_status == "in_progress")
    db.commit()
    return {"assessment": doc.name, "requirements": len(items),
            "complied": doc.complied_count, "failed": doc.not_complied_count, "na": doc.na_count}


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
