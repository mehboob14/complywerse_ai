"""Shared helpers for the BCM module: tenant-scoped fetch, serializers,
derived status, and the cross-module integration hooks (Issue/CAPA, Risk).

Every write path in BCM funnels its audit through ``audit()`` and its
Issue/Risk hand-offs through the helpers here, so the integration surface is
in exactly one place.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    BcmPlan, BcmBiaRecord, BcmBiaDependency, BcmRecoveryStrategy,
    BcmDrill, BcmDrillResult, BcmFinding, BcmSettings,
    GRCUser, GovernanceDocument, Risk, RiskIncident, Issue, ITAsset,
)
from ....rich_audit import write_rich_audit_log

# ── Vocabularies ────────────────────────────────────────────────────────────
PLAN_STATUSES = {"draft", "under_review", "approved", "retired"}
DRILL_STATUSES = {"scheduled", "in_progress", "completed", "under_review", "closed", "cancelled"}
DRILL_TYPES = {"tabletop", "simulation", "full_failover", "call_tree"}
SOURCE_TYPES = {"scheduled_test", "incident_triggered"}
SEVERITIES = {"critical", "high", "medium", "low"}
CRITICALITIES = {"critical", "high", "medium", "low"}
DEPENDENCY_TYPES = {"system", "vendor", "staff", "facility"}
EXTERNAL_BCP_STATUSES = {"confirmed", "requested", "not_provided", "na"}
STRATEGY_TYPES = {
    "alternate_site", "remote_work", "manual_workaround", "vendor_failover",
    "warm_site", "cold_site", "hot_site",
}
STRATEGY_STATUSES = {"proposed", "approved", "rejected"}
TESTING_FREQUENCIES = {"annual", "semi_annual", "quarterly"}

SEVERITY_ORDER = {"low": 1, "medium": 2, "high": 3, "critical": 4}

# Issue workflow_states considered still-open (mirrors issue module).
ISSUE_OPEN_STATES = {"new", "triage", "in_progress", "resolution", "closure_review"}


def severity_at_or_above(sev: Optional[str], threshold: str) -> bool:
    return SEVERITY_ORDER.get((sev or "").lower(), 0) >= SEVERITY_ORDER.get(threshold, 3)


# ── Tenant-scoped fetch ─────────────────────────────────────────────────────
def get_or_404(model, obj_id: int, tenant_ids: List[int], db: Session, label: str):
    obj = db.query(model).filter(
        model.id == obj_id,
        model.tenant_id.in_(tenant_ids),
    ).first()
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return obj


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


_USER_CACHE_KEY = "_bcm_user_names"


def user_name(db: Session, user_id: Optional[int]) -> Optional[str]:
    if not user_id:
        return None
    u = db.query(GRCUser).filter(GRCUser.id == user_id).first()
    return (u.display_name if u else None)


def get_or_create_settings(db: Session, tenant_id: int) -> BcmSettings:
    s = db.query(BcmSettings).filter(BcmSettings.tenant_id == tenant_id).first()
    if not s:
        s = BcmSettings(tenant_id=tenant_id, finding_issue_threshold="high")
        db.add(s)
        db.flush()
    return s


# ── Audit ───────────────────────────────────────────────────────────────────
def audit(db: Session, *, tenant_id: int, user_id: Optional[int], action: str,
          resource_type: str, resource_id: Optional[int], resource_name: Optional[str] = None,
          summary: Optional[str] = None, before: Optional[dict] = None, after: Optional[dict] = None) -> None:
    """Thin wrapper over the shared audit service (swallows its own errors)."""
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=user_id, action=action,
        resource_type=resource_type, resource_id=resource_id, resource_name=resource_name,
        summary=summary, before=before, after=after,
    )


# ── Derived finding status (read live from the linked Issue) ─────────────────
def finding_issue_view(db: Session, finding: BcmFinding) -> dict:
    """The finding's status is DERIVED from its linked Issue, never stored."""
    if finding.linked_issue_id:
        issue = db.query(Issue).filter(Issue.id == finding.linked_issue_id).first()
        if issue:
            return {
                "status": issue.workflow_state,
                "is_open": issue.workflow_state in ISSUE_OPEN_STATES,
                "issue_id": issue.id,
                "issue_code": issue.code,
                "issue_severity": issue.severity,
            }
    # No linked issue yet — the finding is simply open/unremediated.
    return {"status": "open", "is_open": True, "issue_id": None, "issue_code": None, "issue_severity": None}


# ── Serializers ─────────────────────────────────────────────────────────────
def serialize_plan(db: Session, plan: BcmPlan, *, with_children: bool = False) -> dict:
    doc_title = None
    if plan.document_ref_id:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == plan.document_ref_id).first()
        doc_title = doc.title if doc else None
    data = {
        "id": plan.id,
        "tenant_id": plan.tenant_id,
        "title": plan.title,
        "description": plan.description,
        "business_unit": plan.business_unit,
        "status": plan.status,
        "document_ref_id": plan.document_ref_id,
        "document_title": doc_title,
        "owner_id": plan.owner_id,
        "owner_name": user_name(db, plan.owner_id),
        "rto_hours": plan.rto_hours,
        "rpo_hours": plan.rpo_hours,
        "testing_frequency": plan.testing_frequency,
        "version": plan.version,
        "approved_by": plan.approved_by,
        "approved_by_name": user_name(db, plan.approved_by),
        "approved_date": _iso(plan.approved_date),
        "next_review_due": _iso(plan.next_review_due),
        "created_by": plan.created_by,
        "created_at": _iso(plan.created_at),
        "updated_at": _iso(plan.updated_at),
        "bia_count": db.query(BcmBiaRecord).filter(BcmBiaRecord.plan_id == plan.id).count(),
        "drill_count": db.query(BcmDrill).filter(BcmDrill.plan_id == plan.id).count(),
    }
    if with_children:
        data["bia_records"] = [
            serialize_bia(db, b, with_children=True)
            for b in db.query(BcmBiaRecord).filter(BcmBiaRecord.plan_id == plan.id)
            .order_by(BcmBiaRecord.created_at.asc()).all()
        ]
        data["drills"] = [
            serialize_drill(db, d)
            for d in db.query(BcmDrill).filter(BcmDrill.plan_id == plan.id)
            .order_by(BcmDrill.scheduled_date.desc().nullslast()).all()
        ]
    return data


def serialize_bia(db: Session, bia: BcmBiaRecord, *, with_children: bool = False) -> dict:
    data = {
        "id": bia.id,
        "plan_id": bia.plan_id,
        "process_name": bia.process_name,
        "description": bia.description,
        "criticality_rating": bia.criticality_rating,
        "rto_hours": bia.rto_hours,
        "rpo_hours": bia.rpo_hours,
        "mtpd_hours": bia.mtpd_hours,
        "linked_risk_id": bia.linked_risk_id,
        "is_complete": bia.is_complete,
        "created_at": _iso(bia.created_at),
        "updated_at": _iso(bia.updated_at),
        "dependency_count": db.query(BcmBiaDependency).filter(BcmBiaDependency.bia_id == bia.id).count(),
        "strategy_count": db.query(BcmRecoveryStrategy).filter(BcmRecoveryStrategy.bia_id == bia.id).count(),
    }
    if bia.linked_risk_id:
        r = db.query(Risk).filter(Risk.id == bia.linked_risk_id).first()
        data["linked_risk_title"] = r.title if r else None
    # Resolve linked IT assets to id + name for display.
    asset_ids = bia.linked_asset_ids or []
    data["linked_asset_ids"] = asset_ids
    if asset_ids:
        assets = db.query(ITAsset).filter(
            ITAsset.id.in_(asset_ids), ITAsset.tenant_id == bia.tenant_id
        ).all()
        data["linked_assets"] = [{"id": a.id, "name": a.name, "asset_type": a.asset_type} for a in assets]
    else:
        data["linked_assets"] = []
    if with_children:
        data["dependencies"] = [
            serialize_dependency(d)
            for d in db.query(BcmBiaDependency).filter(BcmBiaDependency.bia_id == bia.id)
            .order_by(BcmBiaDependency.created_at.asc()).all()
        ]
        data["recovery_strategies"] = [
            serialize_strategy(db, s)
            for s in db.query(BcmRecoveryStrategy).filter(BcmRecoveryStrategy.bia_id == bia.id)
            .order_by(BcmRecoveryStrategy.created_at.asc()).all()
        ]
    return data


def serialize_dependency(dep: BcmBiaDependency) -> dict:
    return {
        "id": dep.id,
        "bia_id": dep.bia_id,
        "dependency_type": dep.dependency_type,
        "name": dep.name,
        "criticality": dep.criticality,
        "external_bcp_status": dep.external_bcp_status,
        "notes": dep.notes,
        "created_at": _iso(dep.created_at),
    }


def serialize_strategy(db: Session, s: BcmRecoveryStrategy) -> dict:
    doc_title = None
    if s.activation_procedure_ref:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == s.activation_procedure_ref).first()
        doc_title = doc.title if doc else None
    return {
        "id": s.id,
        "bia_id": s.bia_id,
        "strategy_type": s.strategy_type,
        "description": s.description,
        "activation_procedure_ref": s.activation_procedure_ref,
        "activation_procedure_title": doc_title,
        "status": s.status,
        "approved_by": s.approved_by,
        "approved_by_name": user_name(db, s.approved_by),
        "approved_date": _iso(s.approved_date),
        "review_comments": s.review_comments,
        "created_at": _iso(s.created_at),
        "updated_at": _iso(s.updated_at),
    }


def is_drill_overdue(drill: BcmDrill) -> bool:
    return bool(
        drill.status == "scheduled"
        and drill.scheduled_date is not None
        and drill.scheduled_date < datetime.utcnow()
    )


def serialize_drill(db: Session, drill: BcmDrill, *, with_children: bool = False) -> dict:
    plan = db.query(BcmPlan).filter(BcmPlan.id == drill.plan_id).first()
    incident_title = None
    if drill.linked_incident_id:
        inc = db.query(RiskIncident).filter(RiskIncident.id == drill.linked_incident_id).first()
        incident_title = inc.title if inc else None
    data = {
        "id": drill.id,
        "plan_id": drill.plan_id,
        "plan_title": plan.title if plan else None,
        "title": drill.title,
        "drill_type": drill.drill_type,
        "scenario": drill.scenario,
        "scheduled_date": _iso(drill.scheduled_date),
        "actual_start": _iso(drill.actual_start),
        "actual_end": _iso(drill.actual_end),
        "owner_id": drill.owner_id,
        "owner_name": user_name(db, drill.owner_id),
        "participants": drill.participants or [],
        "status": drill.status,
        "is_overdue": is_drill_overdue(drill),
        # Effective status shown in UIs: overdue overrides scheduled.
        "effective_status": "overdue" if is_drill_overdue(drill) else drill.status,
        "source_type": drill.source_type,
        "linked_incident_id": drill.linked_incident_id,
        "linked_incident_title": incident_title,
        "created_at": _iso(drill.created_at),
        "updated_at": _iso(drill.updated_at),
        "has_result": db.query(BcmDrillResult).filter(BcmDrillResult.drill_id == drill.id).first() is not None,
        "finding_count": db.query(BcmFinding).filter(BcmFinding.drill_id == drill.id).count(),
    }
    if with_children:
        res = db.query(BcmDrillResult).filter(BcmDrillResult.drill_id == drill.id).first()
        data["result"] = serialize_result(db, res) if res else None
        data["findings"] = [
            serialize_finding(db, f)
            for f in db.query(BcmFinding).filter(BcmFinding.drill_id == drill.id)
            .order_by(BcmFinding.created_at.asc()).all()
        ]
    return data


def serialize_result(db: Session, res: BcmDrillResult) -> dict:
    return {
        "id": res.id,
        "drill_id": res.drill_id,
        "rto_met": res.rto_met,
        "rpo_met": res.rpo_met,
        "actual_rto_hours": res.actual_rto_hours,
        "actual_rpo_hours": res.actual_rpo_hours,
        "summary": res.summary,
        "evidence_ref_id": res.evidence_ref_id,
        "recorded_by": res.recorded_by,
        "recorded_by_name": user_name(db, res.recorded_by),
        "recorded_at": _iso(res.recorded_at),
    }


def serialize_finding(db: Session, f: BcmFinding) -> dict:
    view = finding_issue_view(db, f)
    risk_title = None
    if f.linked_risk_id:
        r = db.query(Risk).filter(Risk.id == f.linked_risk_id).first()
        risk_title = r.title if r else None
    return {
        "id": f.id,
        "drill_id": f.drill_id,
        "title": f.title,
        "description": f.description,
        "severity": f.severity,
        "linked_issue_id": view["issue_id"],
        "issue_code": view["issue_code"],
        "issue_status": view["status"],       # DERIVED from the issue
        "is_open": view["is_open"],
        "linked_risk_id": f.linked_risk_id,
        "linked_risk_title": risk_title,
        "created_at": _iso(f.created_at),
        "updated_at": _iso(f.updated_at),
    }


# ── Integration: Issue/CAPA auto-create ─────────────────────────────────────
_SEV_TO_IMPACT_URGENCY = {
    "critical": ("high", "high"),
    "high": ("high", "medium"),
    "medium": ("medium", "medium"),
    "low": ("low", "low"),
}


def create_issue_for_finding(db: Session, finding: BcmFinding, *, tenant_id: int,
                             user_id: Optional[int], drill_title: str = "") -> Optional[int]:
    """Hand a BCM finding to the existing Issue/CAPA module via from_event().
    Sets finding.linked_issue_id. Caller commits. Returns the issue id or None
    (None => de-duped against an existing open issue, or the module is off)."""
    from ....modules.issue_management.services.auto_create import from_event

    impact, urgency = _SEV_TO_IMPACT_URGENCY.get((finding.severity or "medium").lower(), ("medium", "medium"))
    desc = finding.description or ""
    context = f"Raised from BCM drill" + (f' "{drill_title}"' if drill_title else "") + f" (finding #{finding.id})."
    issue = from_event(
        db=db,
        tenant_id=tenant_id,
        source_type="bcm_finding",
        source_id=finding.id,
        title=f"[BCM] {finding.title}",
        description=(desc + ("\n\n" if desc else "") + context).strip(),
        impact=impact,
        urgency=urgency,
        issue_type="non_conformance",
        category="operations",
        reporter_id=user_id,
    )
    if issue is not None:
        db.flush()
        finding.linked_issue_id = issue.id
        return issue.id
    # De-dup: an open issue may already exist for this finding — relink it.
    existing = db.query(Issue).filter(
        Issue.tenant_id == tenant_id,
        Issue.source_type == "bcm_finding",
        Issue.source_id == finding.id,
    ).order_by(Issue.id.desc()).first()
    if existing is not None:
        finding.linked_issue_id = existing.id
        return existing.id
    return None


# ── Integration: Risk Register create/link ──────────────────────────────────
_SEV_TO_SCORE = {"low": 2, "medium": 3, "high": 4, "critical": 5}


def create_risk(db: Session, *, tenant_id: int, user_id: Optional[int], title: str,
                description: str, severity: str, owner_id: Optional[int],
                source_reference: str) -> Risk:
    """Create a Risk Register entry stamped with BCM provenance (mirrors the
    gap-analysis accept-risk pattern). Caller commits."""
    impact_value = _SEV_TO_SCORE.get((severity or "medium").lower(), 3)
    likelihood_value = 3
    risk = Risk(
        tenant_id=tenant_id,
        title=title[:250],
        description=description,
        category="operational",
        risk_category="operational",
        risk_sub_category="business_continuity",
        register_type="Business Continuity",
        owner_id=owner_id or user_id,
        inherent_likelihood=likelihood_value,
        inherent_impact=impact_value,
        inherent_score=float(likelihood_value * impact_value),
        residual_likelihood=likelihood_value,
        residual_impact=impact_value,
        residual_score=float(likelihood_value * impact_value),
        status="open",
        source_type="bcm",
        source_reference=source_reference,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(risk)
    db.flush()
    return risk
