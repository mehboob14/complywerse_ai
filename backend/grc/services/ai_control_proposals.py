"""P5 — the review flow around ai_control_mapping: generate proposals for a
scope/tenant, then human accept / reject. Suggest-only by construction: the
ONLY paths that write a VulnerabilityControlLink are `accept_proposal` and the
reuse of a HUMAN's earlier accept on the same (CWE, control) pair. Never
commits — the router owns the transaction.

REASON ONCE, APPLY MANY (L4 of CTEM_VALIDATE_REASONING_PLAN):
  * weakness key = the finding's CWE id. Findings collapse ~10:1 on it.
  * before calling the model for a finding, look at what humans already
    decided for that key: ACCEPTED (key, control) pairs are applied to this
    finding as accepted proposals (provenance "reused", decided_by = the
    original approver) and linked; REJECTED pairs are never re-proposed.
  * the model is called only for findings whose key has NO human decision yet.
  So a bank with 10k findings on ~100 CWEs makes ~100 model calls, and a
  reviewer's decision propagates deterministically instead of being re-asked.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from .ai_control_mapping import suggest_controls, classify_finding, PROMPT_VERSION

logger = logging.getLogger(__name__)

_LINK_NOTE_PREFIXES = ("ai_suggested:", "ai_reused:")


def _ref_kwargs(kind: str, control_id: int) -> Dict[str, Any]:
    """The FK kwargs for a control ref, for both AiControlProposal and VulnerabilityControlLink."""
    if kind == "parsed_framework_control":
        return {"parsed_framework_control_id": control_id, "normalized_control_id": None}
    return {"normalized_control_id": control_id, "parsed_framework_control_id": None}


def _decided_pairs_for_key(db, tenant_id: int, cwe_id: str) -> Tuple[Dict[Tuple[str, int], Any], set]:
    """Human decisions on this weakness key across ALL findings:
    accepted → {(kind, control_id): proposal_row}, rejected → {(kind, control_id)}."""
    from ..models import AiControlProposal, Vulnerability
    rows = db.query(AiControlProposal).join(Vulnerability, Vulnerability.id == AiControlProposal.vulnerability_id
                                            ).filter(AiControlProposal.tenant_id == tenant_id,
                                                     Vulnerability.cwe_id == cwe_id,
                                                     AiControlProposal.status.in_(("accepted", "rejected"))).all()
    accepted: Dict[Tuple[str, int], Any] = {}
    rejected: set = set()
    for p in rows:
        key = p.control_ref
        if p.status == "accepted":
            accepted.setdefault(key, p)   # first approver wins as the provenance source
        else:
            rejected.add(key)
    return accepted, rejected


def _link_for(db, vulnerability_id: int, kind: str, control_id: int):
    from ..models import VulnerabilityControlLink
    col = getattr(VulnerabilityControlLink, "parsed_framework_control_id" if kind == "parsed_framework_control"
                  else "normalized_control_id")
    return db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.vulnerability_id == vulnerability_id, col == control_id).first()


def generate_proposals(db: Session, tenant_id: int, *, vulnerability_ids: Optional[List[int]] = None,
                       ctem_scope_id: Optional[int] = None, triggered_by: Optional[int] = None,
                       client=None, model: Optional[str] = None, limit: int = 500) -> Dict[str, Any]:
    """Run the mapper over the tenant's (or a scope's) findings and persist the
    suggestions as PROPOSALS. Idempotent per (finding, control): a re-run
    refreshes reason/confidence on a still-`proposed` row, but NEVER touches a
    row a human already accepted or rejected — their decision stands.
    Inventory findings are counted, never sent. Reused decisions are applied
    without a model call. Returns the run summary."""
    from ..models import (Vulnerability, ITAsset, VulnerabilityAssetLink, VulnerabilityControlLink,
                          AiControlProposal, AiControlProposalRun)

    run_id = uuid.uuid4().hex[:24]
    run = AiControlProposalRun(tenant_id=tenant_id, run_id=run_id, prompt_version=PROMPT_VERSION,
                               ctem_scope_id=ctem_scope_id, triggered_by=triggered_by)
    db.add(run)
    # Commit the run row NOW so a poller sees "running" (started_at set,
    # finished_at null) while the model calls proceed.
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

    decided_cache: Dict[str, Tuple[Dict, set]] = {}
    reused = 0
    for v in findings:
        bucket, _ = classify_finding(v)
        if bucket == "inventory":
            run.findings_inventory += 1
            continue

        # ── reason once, apply many: human decisions on this CWE come first ──
        cwe = (getattr(v, "cwe_id", None) or "").strip()
        accepted, rejected = ({}, set())
        if cwe:
            if cwe not in decided_cache:
                decided_cache[cwe] = _decided_pairs_for_key(db, tenant_id, cwe)
            accepted, rejected = decided_cache[cwe]
            for (kind, cid), src in accepted.items():
                existing = db.query(AiControlProposal).filter(
                    AiControlProposal.vulnerability_id == v.id).filter_by(**_ref_kwargs(kind, cid)).first()
                if existing is not None:
                    continue                                   # already proposed/decided for THIS finding
                link = _link_for(db, v.id, kind, cid)
                if link is None:
                    link = VulnerabilityControlLink(
                        vulnerability_id=v.id, compliance_impact="at_risk",
                        notes=f"ai_reused:{cwe} · from proposal {src.id} · {src.reason or ''}"[:500],
                        created_by=src.decided_by, **_ref_kwargs(kind, cid))
                    db.add(link); db.flush()
                db.add(AiControlProposal(
                    tenant_id=tenant_id, vulnerability_id=v.id, confidence=src.confidence, reason=src.reason,
                    driven_by=src.driven_by, prompt_version=src.prompt_version, bucket=bucket,
                    status="accepted", provenance="reused", decided_by=src.decided_by,
                    decided_at=datetime.utcnow(), decision_note=f"reused human decision on {cwe} (proposal {src.id})",
                    control_link_id=link.id, run_id=run_id, **_ref_kwargs(kind, cid)))
                reused += 1
            if accepted or rejected:
                # the key has been reviewed by a human — do NOT re-ask the model for it.
                # (New candidates for a decided key arrive on a prompt/corpus version bump.)
                run.findings_reused = (run.findings_reused or 0) + 1
                continue

        run.findings_sent += 1
        res = suggest_controls(db, v, asset=asset_for.get(v.id), client=client, model=model)
        if res.get("error"):
            run.model_errors += 1
            continue
        run.invalid_ids_dropped += len(res.get("dropped_invalid_ids") or [])
        for s in res.get("suggestions") or []:
            kind = s.get("kind", "normalized_control")
            if (kind, s["control_id"]) in rejected:
                continue                                       # a human said no for this CWE — never re-propose
            existing = db.query(AiControlProposal).filter(
                AiControlProposal.vulnerability_id == v.id).filter_by(**_ref_kwargs(kind, s["control_id"])).first()
            if existing is None:
                db.add(AiControlProposal(
                    tenant_id=tenant_id, vulnerability_id=v.id, confidence=s["confidence"], reason=s["reason"],
                    driven_by=s["driven_by"], prompt_version=PROMPT_VERSION, bucket=res["bucket"],
                    status="proposed", provenance="model", run_id=run_id,
                    prompt_inputs=res.get("prompt"), raw_output=res.get("raw_output"),
                    **_ref_kwargs(kind, s["control_id"])))
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
    run.proposals_reused = reused
    run.finished_at = datetime.utcnow()
    db.flush()
    return _summary(run)


def _summary(run) -> Dict[str, Any]:
    return {"run_id": run.run_id, "prompt_version": run.prompt_version,
            "findings_total": run.findings_total, "findings_inventory": run.findings_inventory,
            "findings_sent": run.findings_sent, "findings_reused": getattr(run, "findings_reused", 0) or 0,
            "proposals_created": run.proposals_created, "proposals_updated": run.proposals_updated,
            "proposals_reused": getattr(run, "proposals_reused", 0) or 0,
            "model_errors": run.model_errors, "invalid_ids_dropped": run.invalid_ids_dropped,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "running": run.finished_at is None}


def accept_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """The ONE human path that turns a suggestion into a real link. Idempotent: an
    already-accepted proposal returns its existing link. Records the approver."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    if p.status == "accepted" and p.control_link_id:
        return {"proposal_id": p.id, "status": "accepted", "control_link_id": p.control_link_id, "created": False}
    kind, cid = p.control_ref
    link = _link_for(db, p.vulnerability_id, kind, cid)
    created = False
    if link is None:
        link = VulnerabilityControlLink(
            vulnerability_id=p.vulnerability_id, compliance_impact="at_risk",
            notes=f"ai_suggested:{p.prompt_version} · {p.confidence} · {p.reason or ''}"[:500],
            created_by=user_id, **_ref_kwargs(kind, cid))
        db.add(link)
        db.flush()
        created = True
    p.status, p.decided_by, p.decided_at, p.decision_note, p.control_link_id = "accepted", user_id, datetime.utcnow(), note, link.id
    db.flush()
    return {"proposal_id": p.id, "status": "accepted", "control_link_id": link.id, "created": created}


def reject_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """Reject — and if it had been accepted (by a human OR by reuse), remove the
    link it created (only that link, only if it was ai-created). Never re-proposed
    for this finding, and never re-proposed for any other finding with the same CWE."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    unlinked = False
    if p.control_link_id:
        link = db.query(VulnerabilityControlLink).get(p.control_link_id)
        if link is not None and (link.notes or "").startswith(_LINK_NOTE_PREFIXES):
            db.delete(link)
            unlinked = True
        p.control_link_id = None
    p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", user_id, datetime.utcnow(), note
    db.flush()
    return {"proposal_id": p.id, "status": "rejected", "unlinked": unlinked}


def list_proposals(db: Session, tenant_id: int, *, status: Optional[str] = None,
                   vulnerability_ids: Optional[List[int]] = None, limit: int = 500) -> List[Dict[str, Any]]:
    from ..models import AiControlProposal, Vulnerability, NormalizedControl, ParsedFrameworkControl, UploadedFramework
    q = db.query(AiControlProposal, Vulnerability, NormalizedControl, ParsedFrameworkControl, UploadedFramework
                 ).join(Vulnerability, Vulnerability.id == AiControlProposal.vulnerability_id
                 ).outerjoin(NormalizedControl, NormalizedControl.id == AiControlProposal.normalized_control_id
                 ).outerjoin(ParsedFrameworkControl, ParsedFrameworkControl.id == AiControlProposal.parsed_framework_control_id
                 ).outerjoin(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
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
    for p, v, c, pc, fw in rows:
        if pc is not None:
            control = {"id": pc.id, "kind": "parsed_framework_control",
                       "code": pc.original_reference or pc.control_id, "name": pc.title,
                       "domain": pc.domain, "framework": fw.name if fw else None}
        elif c is not None:
            control = {"id": c.id, "kind": "normalized_control", "code": c.code, "name": c.name,
                       "domain": c.domain, "framework": "Unified Control Library"}
        else:
            continue
        out.append({
            "id": p.id, "status": p.status, "confidence": p.confidence, "reason": p.reason,
            "driven_by": p.driven_by, "bucket": p.bucket, "prompt_version": p.prompt_version,
            "provenance": getattr(p, "provenance", "model") or "model",
            "vulnerability": {"id": v.id, "vuln_id": v.vuln_id, "title": v.title, "cve_id": v.cve_id,
                              "cwe_id": v.cwe_id, "severity": v.severity},
            "control": control,
            "decided_at": p.decided_at.isoformat() if p.decided_at else None,
            "control_link_id": p.control_link_id,
        })
    return out
