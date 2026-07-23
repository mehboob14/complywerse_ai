"""Seed demo COMPLIANCE data so the compliance sections-overview is alive:
a published framework + verified/aligned parsed controls, a framework
assessment with items/evidence/remediations, linked evidence, and enriched
policy statements. Tagged [DEMO] for clean removal.

Usage (from backend/):
    python seed_demo_compliance.py seed     [--tenant complyverse]
    python seed_demo_compliance.py cleanup  [--tenant complyverse]
"""
import argparse
import sys
from datetime import datetime, timedelta

from grc.models import (
    GRCUser, UploadedFramework, ParsedFrameworkControl, FrameworkControlAlignment,
    ClauseApplicability, FrameworkAssessment, AssessmentItem, AssessmentEvidence,
    AssessmentRemediation, Evidence, EvidenceControlMapping, NormalizedControl,
    NormalizationRun, PolicyStatement, PolicyStatementCompliance,
    ControlEvidenceRequirement,
)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants


def cleanup(db):
    removed = {}
    ufs = db.query(UploadedFramework).filter(UploadedFramework.name.like("[DEMO]%")).all()
    for uf in ufs:
        pfc_ids = [r.id for r in db.query(ParsedFrameworkControl.id).filter(
            ParsedFrameworkControl.uploaded_framework_id == uf.id).all()]
        fas = db.query(FrameworkAssessment).filter(
            FrameworkAssessment.uploaded_framework_id == uf.id).all()
        for fa in fas:
            item_ids = [r.id for r in db.query(AssessmentItem.id).filter(
                AssessmentItem.assessment_id == fa.id).all()]
            if item_ids:
                db.query(AssessmentEvidence).filter(
                    AssessmentEvidence.assessment_item_id.in_(item_ids)).delete(synchronize_session=False)
                db.query(AssessmentRemediation).filter(
                    AssessmentRemediation.assessment_item_id.in_(item_ids)).delete(synchronize_session=False)
            db.query(AssessmentItem).filter(
                AssessmentItem.assessment_id == fa.id).delete(synchronize_session=False)
            db.delete(fa)
        if pfc_ids:
            db.query(EvidenceControlMapping).filter(
                EvidenceControlMapping.parsed_control_id.in_(pfc_ids)).delete(synchronize_session=False)
            db.query(ControlEvidenceRequirement).filter(
                ControlEvidenceRequirement.parsed_control_id.in_(pfc_ids)).delete(synchronize_session=False)
            db.query(FrameworkControlAlignment).filter(
                FrameworkControlAlignment.parsed_control_id.in_(pfc_ids)).delete(synchronize_session=False)
        db.query(ClauseApplicability).filter(
            ClauseApplicability.uploaded_framework_id == uf.id).delete(synchronize_session=False)
        db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == uf.id).delete(synchronize_session=False)
        db.delete(uf)
    removed["uploaded_frameworks"] = len(ufs)
    demo_ev = db.query(Evidence).filter(Evidence.name.like("[DEMO]%")).all()
    for e in demo_ev:
        db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.evidence_id == e.id).delete(synchronize_session=False)
        db.delete(e)
    removed["evidence"] = len(demo_ev)
    # policy statement compliance demo rows
    removed["statement_compliance"] = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.findings.like("[DEMO]%")).delete(synchronize_session=False)
    db.commit()
    return removed


def seed(db, slug):
    now = datetime.utcnow()
    user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
    tid = get_user_tenants(user, db)[0]

    # ---- published framework + parsed controls (verified/aligned) ----
    uf = UploadedFramework(
        tenant_id=tid, name="[DEMO] ISO 27001:2022", file_name="iso27001.pdf",
        file_path="/demo/iso27001.pdf", file_type="pdf", uploaded_by=user.id,
        upload_status="published", published_framework_id=None, published_at=now - timedelta(days=20),
        parsed_at=now - timedelta(days=25))
    db.add(uf)
    db.flush()
    pfcs = []
    for i in range(10):
        p = ParsedFrameworkControl(
            uploaded_framework_id=uf.id, control_id=f"A.{5+i//3}.{i+1}",
            title=f"[DEMO] Control {i+1}", domain="Organizational",
            is_mandatory=True, priority="high" if i < 3 else "medium",
            is_verified=(i < 7))  # 7 of 10 verified
        db.add(p)
        pfcs.append(p)
    db.flush()
    # alignments: 6 of 8 confirmed
    base = db.query(NormalizationRun).filter(NormalizationRun.is_baseline == True).first()  # noqa: E712
    ncs = db.query(NormalizedControl.id).filter(
        NormalizedControl.run_id == base.id).limit(8).all() if base else []
    for i, p in enumerate(pfcs[:8]):
        db.add(FrameworkControlAlignment(
            parsed_control_id=p.id,
            normalized_control_id=ncs[i][0] if i < len(ncs) else None,
            alignment_type="exact" if i % 2 == 0 else "partial",
            match_score=0.9 - i * 0.03, is_confirmed=(i < 6),
            confirmed_by=user.id if i < 6 else None))
    # applicability: 5 decided (4 applicable, 1 not)
    for i, p in enumerate(pfcs[:5]):
        db.add(ClauseApplicability(
            tenant_id=tid, uploaded_framework_id=uf.id, control_id=p.id,
            is_applicable=(i != 4), status="approved" if i < 4 else "rejected",
            requested_by=user.id, reviewed_by=user.id, reviewed_at=now - timedelta(days=10)))
    # evidence requirements: 10 mandatory (6 approved, 2 pending_review, 2 draft)
    cer_status = ["approved"] * 6 + ["pending_review"] * 2 + ["draft"] * 2
    for i, p in enumerate(pfcs):
        db.add(ControlEvidenceRequirement(
            framework_id=uf.id, parsed_control_id=p.id,
            evidence_title=f"[DEMO] Evidence for control {i+1}",
            evidence_description="Required evidence artifact",
            evidence_type="policy", is_mandatory=True,
            status=cer_status[i], created_by=user.id))

    # ---- framework assessment + items + evidence + remediation ----
    fa = FrameworkAssessment(
        tenant_id=tid, uploaded_framework_id=uf.id, name="[DEMO] ISO 27001 gap assessment",
        status="in_progress", lead_assessor_id=user.id, created_by=user.id,
        assessment_date=now - timedelta(days=15),
        target_completion_date=now + timedelta(days=30))
    db.add(fa)
    db.flush()
    # 10 items: mix of statuses
    item_specs = ["compliant", "compliant", "compliant", "partially_compliant",
                  "partially_compliant", "non_compliant", "non_compliant",
                  "not_assessed", "not_assessed", "not_applicable"]
    items = []
    for i, cs in enumerate(item_specs):
        it = AssessmentItem(
            assessment_id=fa.id, parsed_control_id=pfcs[i].id, compliance_status=cs,
            compliance_score=(1.0 if cs == "compliant" else 0.5 if cs == "partially_compliant" else 0.0),
            owner_id=user.id, assessed_by=user.id if cs not in ("not_assessed",) else None,
            gap_description="[DEMO] gap" if cs in ("partially_compliant", "non_compliant") else None)
        db.add(it)
        items.append(it)
    db.flush()
    # assessment evidence: 4, 3 reviewed
    for i in range(4):
        db.add(AssessmentEvidence(
            assessment_item_id=items[i].id, evidence_type="policy",
            file_name=f"[DEMO] evidence{i}.pdf", file_path=f"/demo/ev{i}.pdf",
            uploaded_by=user.id,
            review_status="accepted" if i < 3 else "pending"))
    # remediations: 3, 1 completed
    rem_specs = [("completed", -5), ("in_progress", 20), ("open", 15)]
    for i, (st, due) in enumerate(rem_specs):
        db.add(AssessmentRemediation(
            assessment_item_id=items[5 + i].id, title=f"[DEMO] remediate item {5+i}",
            status=st, priority="high", owner_id=user.id, created_by=user.id,
            due_date=now + timedelta(days=due),
            completed_at=now - timedelta(days=3) if st == "completed" else None))

    # ---- evidence linked to normalized controls ----
    if base:
        nc_ids = [r[0] for r in db.query(NormalizedControl.id).filter(
            NormalizedControl.run_id == base.id).limit(20).all()]
        ev_specs = [("[DEMO] Access control policy", "approved", False, "completed"),
                    ("[DEMO] Encryption standard", "approved", False, "completed"),
                    ("[DEMO] Incident response plan", "pending_review", False, "pending"),
                    ("[DEMO] Backup log (expired)", "approved", True, "pending")]
        for j, (nm, stt, stale, ocr) in enumerate(ev_specs):
            e = Evidence(tenant_id=tid, name=nm, status=stt, is_stale=stale,
                         evidence_type="policy", uploaded_by=user.id, ocr_status=ocr)
            db.add(e)
            db.flush()
            # each evidence maps to several normalized controls (reuse)
            for k in range(4):
                idx = (j * 4 + k) % len(nc_ids)
                db.add(EvidenceControlMapping(
                    evidence_id=e.id, normalized_control_id=nc_ids[idx],
                    coverage_type="full", confidence_score=90.0))
            # ...and to a parsed framework control (Controls-page evidence coverage)
            if j < len(pfcs):
                db.add(EvidenceControlMapping(
                    evidence_id=e.id, parsed_control_id=pfcs[j].id,
                    coverage_type="full", confidence_score=88.0))

    # ---- enrich policy statements ----
    stmts = db.query(PolicyStatement).filter(PolicyStatement.tenant_id == tid).limit(10).all()
    for i, s in enumerate(stmts):
        if i < 8:  # 8 of 10 mapped
            s.ai_suggested_controls = [f"A.{5+i}.1"]
        if i < 6:  # 6 compliance records, 4 compliant
            db.add(PolicyStatementCompliance(
                tenant_id=tid, statement_id=s.id,
                compliance_status="compliant" if i < 4 else "partially_compliant",
                compliance_score=1.0 if i < 4 else 0.5, owner_id=user.id,
                findings="[DEMO] compliance record",
                assessment_date=now - timedelta(days=8)))

    db.commit()
    return {"framework": uf.name, "parsed": len(pfcs), "items": len(items)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        if args.command == "cleanup":
            print("Removed:", cleanup(db))
        else:
            removed = cleanup(db)
            print("Prior demo removed:", removed)
            print("Seeded:", seed(db, args.tenant))
    finally:
        db.close()


if __name__ == "__main__":
    main()
