"""Reversible DEMO data for the ASVS assessment so the new formula produces
realistic numbers. Sets a believable pass/fail/N-A/not-tested mix per level,
attaches evidence to some passing requirements, and gives failed requirements
remediation dates (some overdue, some closed on-time/late) to exercise the SLA
dimension. Fully reversible: `cleanup` resets every requirement to 'Not tested'
and removes the [DEMO] evidence, returning the assessment to a blank template.

Usage (from backend/):
    python seed_demo_asvs.py seed     [--tenant complyverse]
    python seed_demo_asvs.py cleanup  [--tenant complyverse]
"""
import argparse
import re
from datetime import datetime, timedelta

from grc.models import (
    GRCUser, ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem,
    Evidence, AssessmentItemEvidence,
)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

LEVEL_RE = re.compile(r"ASVS Level:\s*([0-9]+)", re.I)
DEMO_TAG = "[DEMO ASVS]"


def _level(it):
    m = LEVEL_RE.search(it.remarks or "")
    try:
        return int(m.group(1)) if m else 1
    except Exception:
        return 1


def _asvs_doc(db, tids):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.assessment_format == "asvs_checklist",
        ComplianceAssessmentDocument.tenant_id.in_(tids)).first()


# Realistic status mix per level (repeating patterns → stable proportions).
PATTERNS = {
    1: (["complied"] * 16 + ["not_complied"] * 2 + ["na"] + ["in_progress"]),          # ~80/10/5/5
    2: (["complied"] * 10 + ["not_complied"] * 6 + ["na"] * 2 + ["in_progress"] * 2),  # 50/30/10/10
    3: (["complied"] * 5 + ["not_complied"] * 9 + ["na"] + ["in_progress"] * 5),       # 25/45/5/25
}


def cleanup(db, tids):
    doc = _asvs_doc(db, tids)
    if not doc:
        return {"asvs_doc": 0}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).all()
    ids = [it.id for it in items]
    ev_removed = 0
    if ids:
        demo_ev = db.query(Evidence).filter(Evidence.name.like(f"{DEMO_TAG}%")).all()
        demo_ev_ids = [e.id for e in demo_ev]
        db.query(AssessmentItemEvidence).filter(
            AssessmentItemEvidence.assessment_item_id.in_(ids),
            AssessmentItemEvidence.evidence_id.in_(demo_ev_ids or [-1])).delete(synchronize_session=False)
        for e in demo_ev:
            db.delete(e)
        ev_removed = len(demo_ev)
    for it in items:
        it.compliance_status = "in_progress"
        it.remediation_status = None
        it.target_date = None
        it.closed_at = None
        it.asset_status = None
    doc.linked_asset_ids = []
    doc.asset_levels = {}
    doc.complied_count = doc.not_complied_count = doc.partially_complied_count = 0
    doc.in_progress_count = len(items)
    doc.na_count = 0
    doc.overall_score = 0.0
    db.commit()
    return {"items_reset": len(items), "evidence_removed": ev_removed}


def seed(db, tids):
    now = datetime.utcnow()
    user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
    tid = tids[0]
    doc = _asvs_doc(db, tids)
    if not doc:
        return {"error": "no ASVS assessment found"}
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id).order_by(
        ComplianceAssessmentDocumentItem.id).all()

    # 1) assign a realistic status per level
    per_level_idx = {1: 0, 2: 0, 3: 0}
    for it in items:
        L = _level(it)
        pat = PATTERNS[L]
        it.compliance_status = pat[per_level_idx[L] % len(pat)]
        per_level_idx[L] += 1
        it.remediation_status = None
        it.target_date = None
        it.closed_at = None

    # 2) remediation timeline over the failed requirements (SLA dimension)
    failed = [it for it in items if it.compliance_status == "not_complied"]
    for i, it in enumerate(failed):
        if i % 3 == 0:  # ~1/3 remediated (closed) → now passing
            it.compliance_status = "complied"
            it.remediation_status = "closed"
            it.target_date = now - timedelta(days=10)
            it.closed_at = now - timedelta(days=14 if (i // 3) % 2 == 0 else 6)  # on-time vs late
        else:  # still an open gap
            it.remediation_status = "open"
            it.target_date = now - timedelta(days=15) if i % 2 == 0 else now + timedelta(days=30)

    # 3) evidence on ~45% of passing requirements
    passing = [it for it in items if it.compliance_status == "complied"]
    ev_added = 0
    for i, it in enumerate(passing):
        if i % 20 < 9:
            e = Evidence(tenant_id=tid, name=f"{DEMO_TAG} proof for {it.item_number}",
                         status="approved", is_stale=False, evidence_type="test_result",
                         uploaded_by=user.id, ocr_status="completed")
            db.add(e)
            db.flush()
            db.add(AssessmentItemEvidence(
                assessment_item_id=it.id, evidence_id=e.id, tenant_id=tid,
                status="approved", current_tier=0, submitted_by=user.id, submitted_at=now))
            ev_added += 1

    # 4) refresh the document rollup counts
    doc.complied_count = sum(1 for it in items if it.compliance_status == "complied")
    doc.not_complied_count = sum(1 for it in items if it.compliance_status == "not_complied")
    doc.partially_complied_count = 0
    doc.na_count = sum(1 for it in items if it.compliance_status == "na")
    doc.in_progress_count = sum(1 for it in items if it.compliance_status == "in_progress")
    doc.status = "in_progress"

    db.commit()
    return {"assessment": doc.name, "requirements": len(items),
            "complied": doc.complied_count, "failed": doc.not_complied_count,
            "na": doc.na_count, "not_tested": doc.in_progress_count,
            "evidence_added": ev_added, "gaps_remediated": len(failed) // 3 + (1 if len(failed) % 3 else 0)}


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
            print("Cleared prior demo:", cleanup(db, tids))
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
