"""P5 — the review flow around ai_control_mapping: generate proposals for a
scope/tenant, then human accept / reject. Suggest-only by construction: the
ONLY path that writes a VulnerabilityControlLink is `accept_proposal`, and it
records who accepted. Never commits — the router owns the transaction.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .ai_control_mapping import suggest_controls, classify_finding, PROMPT_VERSION

logger = logging.getLogger(__name__)


def generate_proposals(db: Session, tenant_id: int, *, vulnerability_ids: Optional[List[int]] = None,
                       ctem_scope_id: Optional[int] = None, triggered_by: Optional[int] = None,
                       client=None, model: Optional[str] = None, limit: int = 500) -> Dict[str, Any]:
    """Run the mapper over the tenant's (or a scope's) findings and persist the
    suggestions as PROPOSALS. Idempotent per (finding, control): a re-run
    refreshes reason/confidence on a still-`proposed` row, but NEVER touches a
    row a human already accepted or rejected — their decision stands.
    Inventory findings are counted, never sent. Returns the run summary."""
    from ..models import Vulnerability, ITAsset, VulnerabilityAssetLink, AiControlProposal, AiControlProposalRun

    run_id = uuid.uuid4().hex[:24]
    run = AiControlProposalRun(tenant_id=tenant_id, run_id=run_id, prompt_version=PROMPT_VERSION,
                               ctem_scope_id=ctem_scope_id, triggered_by=triggered_by)
    db.add(run)
    # Commit the run row NOW so a poller sees "running" (started_at set,
    # finished_at null) while the model calls proceed — this is what lets the
    # background pattern report progress instead of silence.
    db.commit()

    q = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id)
    if vulnerability_ids is not None:
        if not vulnerability_ids:
            run.finished_at = datetime.utcnow()
            return _summary(run)
        q = q.filter(Vulnerability.id.in_(vulnerability_ids))
    findings = q.limit(limit).all()
    run.findings_total = len(findings)

    # one primary asset per finding for asset_context (first linked asset)
    asset_for: Dict[int, Any] = {}
    if findings:
        links = db.query(VulnerabilityAssetLink.vulnerability_id, VulnerabilityAssetLink.asset_id).filter(
            VulnerabilityAssetLink.vulnerability_id.in_([f.id for f in findings])).all()
        first_asset = {}
        for vid, aid in links:
            first_asset.setdefault(vid, aid)
        assets = {a.id: a for a in db.query(ITAsset).filter(ITAsset.id.in_(set(first_asset.values()))).all()} if first_asset else {}
        asset_for = {vid: assets.get(aid) for vid, aid in first_asset.items()}

    for v in findings:
        bucket, _ = classify_finding(v)
        if bucket == "inventory":
            run.findings_inventory += 1
            continue
        run.findings_sent += 1
        res = suggest_controls(db, v, asset=asset_for.get(v.id), client=client, model=model)
        if res.get("error"):
            run.model_errors += 1
            continue
        run.invalid_ids_dropped += len(res.get("dropped_invalid_ids") or [])
        for s in res.get("suggestions") or []:
            existing = db.query(AiControlProposal).filter(
                AiControlProposal.vulnerability_id == v.id,
                AiControlProposal.normalized_control_id == s["control_id"],
            ).first()
            if existing is None:
                db.add(AiControlProposal(
                    tenant_id=tenant_id, vulnerability_id=v.id, normalized_control_id=s["control_id"],
                    confidence=s["confidence"], reason=s["reason"], driven_by=s["driven_by"],
                    prompt_version=PROMPT_VERSION, bucket=res["bucket"], status="proposed",
                    run_id=run_id, prompt_inputs=res.get("prompt"), raw_output=res.get("raw_output"),
                ))
                run.proposals_created += 1
            elif existing.status == "proposed":        # refresh, but never override a human decision
                existing.confidence, existing.reason, existing.driven_by = s["confidence"], s["reason"], s["driven_by"]
                existing.prompt_version, existing.run_id = PROMPT_VERSION, run_id
                existing.prompt_inputs, existing.raw_output = res.get("prompt"), res.get("raw_output")
                run.proposals_updated += 1
        # persist progress every few findings so a poller sees movement and a
        # mid-run crash keeps what was already decided
        if run.findings_sent % 5 == 0:
            db.commit()
    run.finished_at = datetime.utcnow()
    db.flush()
    return _summary(run)


def _summary(run) -> Dict[str, Any]:
    return {"run_id": run.run_id, "prompt_version": run.prompt_version,
            "findings_total": run.findings_total, "findings_inventory": run.findings_inventory,
            "findings_sent": run.findings_sent, "proposals_created": run.proposals_created,
            "proposals_updated": run.proposals_updated, "model_errors": run.model_errors,
            "invalid_ids_dropped": run.invalid_ids_dropped,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "running": run.finished_at is None}


def accept_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """The ONE path that turns a suggestion into a real link. Idempotent: an
    already-accepted proposal returns its existing link. Records the approver."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    if p.status == "accepted" and p.control_link_id:
        return {"proposal_id": p.id, "status": "accepted", "control_link_id": p.control_link_id, "created": False}
    link = db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.vulnerability_id == p.vulnerability_id,
        VulnerabilityControlLink.normalized_control_id == p.normalized_control_id,
    ).first()
    created = False
    if link is None:
        link = VulnerabilityControlLink(
            vulnerability_id=p.vulnerability_id, normalized_control_id=p.normalized_control_id,
            compliance_impact="at_risk",
            notes=f"ai_suggested:{p.prompt_version} · {p.confidence} · {p.reason or ''}"[:500],
            created_by=user_id,
        )
        db.add(link)
        db.flush()
        created = True
    p.status, p.decided_by, p.decided_at, p.decision_note, p.control_link_id = "accepted", user_id, datetime.utcnow(), note, link.id
    db.flush()
    return {"proposal_id": p.id, "status": "accepted", "control_link_id": link.id, "created": created}


def reject_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """Reject — and if it had been accepted, remove the link it created (only
    that link, only if it was ai-created by this proposal). Never re-proposed."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    unlinked = False
    if p.control_link_id:
        link = db.query(VulnerabilityControlLink).get(p.control_link_id)
        if link is not None and (link.notes or "").startswith("ai_suggested:"):
            db.delete(link)
            unlinked = True
        p.control_link_id = None
    p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", user_id, datetime.utcnow(), note
    db.flush()
    return {"proposal_id": p.id, "status": "rejected", "unlinked": unlinked}


def list_proposals(db: Session, tenant_id: int, *, status: Optional[str] = None,
                   vulnerability_ids: Optional[List[int]] = None, limit: int = 500) -> List[Dict[str, Any]]:
    from ..models import AiControlProposal, Vulnerability, NormalizedControl
    q = db.query(AiControlProposal, Vulnerability, NormalizedControl).join(
        Vulnerability, Vulnerability.id == AiControlProposal.vulnerability_id).join(
        NormalizedControl, NormalizedControl.id == AiControlProposal.normalized_control_id
    ).filter(AiControlProposal.tenant_id == tenant_id)
    if status:
        q = q.filter(AiControlProposal.status == status)
    if vulnerability_ids is not None:
        if not vulnerability_ids:
            return []
        q = q.filter(AiControlProposal.vulnerability_id.in_(vulnerability_ids))
    rows = q.order_by(AiControlProposal.status.asc(), AiControlProposal.confidence.asc(),
                      AiControlProposal.vulnerability_id.asc()).limit(limit).all()
    out = []
    for p, v, c in rows:
        out.append({
            "id": p.id, "status": p.status, "confidence": p.confidence, "reason": p.reason,
            "driven_by": p.driven_by, "bucket": p.bucket, "prompt_version": p.prompt_version,
            "vulnerability": {"id": v.id, "vuln_id": v.vuln_id, "title": v.title, "cve_id": v.cve_id,
                              "cwe_id": v.cwe_id, "severity": v.severity},
            "control": {"id": c.id, "code": c.code, "name": c.name, "domain": c.domain},
            "decided_at": p.decided_at.isoformat() if p.decided_at else None,
            "control_link_id": p.control_link_id,
        })
    return out
