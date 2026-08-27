"""P5 — AI control-mapping review API.

generate → list → accept / reject. Suggest-only: the ONLY write to
VulnerabilityControlLink is `accept`, and it records the approver. Generation
+ decisions are edit-gated (a decision-bearing write); listing is view-gated.
"""

import logging
import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, require_tenant_permission
from ....db import open_tenant_session
from ....services import ai_control_proposals as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-control-proposals", tags=["Vulnerabilities - AI Control Proposals"])
_edit = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit"))
_view = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view"))


class Decision(BaseModel):
    note: Optional[str] = None


def _scope_vuln_ids(db, tenant_id, ctem_scope_id) -> Optional[List[int]]:
    if not ctem_scope_id:
        return None
    from ....models import CtemScope
    from ....services.ctem_scopes import scope_vulnerability_ids
    scope = db.query(CtemScope).filter(CtemScope.id == ctem_scope_id, CtemScope.tenant_id == tenant_id).first()
    if not scope:
        raise HTTPException(status_code=404, detail="CTEM scope not found")
    return scope_vulnerability_ids(db, tenant_id, scope.membership_rule)


@router.post("/generate")
def generate(
    request: Request,
    ctem_scope_id: Optional[int] = None,
    auto_link: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Run the AI mapper over the tenant (or one CTEM scope).

    `auto_link=True` (the CTEM Validate "Map controls" action) is the owner's
    production model: the AI picks the control that CLOSES each finding and links
    it DIRECTLY — the analyst never browses the control library. Auditable and
    reversible (Reject removes an ai_auto link; a human reject on a CWE still
    wins). `auto_link=False` keeps the review workflow (proposals await accept).

    Runs in a BACKGROUND worker with its own tenant session (the house pattern
    from the scanner sync): ~75 sequential model calls take 60-120s, and holding
    the HTTP request open that long trips the proxy's 30s timeout — the browser
    saw a 500 while the server was still working. Returns immediately; the
    panel polls `last_run` (started_at set, finished_at null = running)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    # SINGLE-FLIGHT: one mapping run at a time per tenant. A second click (or a
    # second tab) must join the running one, not spawn a racing duplicate —
    # two concurrent runs were proven to collide on the unique (finding, control)
    # constraint and kill each other.
    from ....models import AiControlProposalRun
    active = db.query(AiControlProposalRun).filter(
        AiControlProposalRun.tenant_id == tenant_id,
        AiControlProposalRun.finished_at.is_(None)).first()
    if active is not None:
        return {"status": "running", "run_id": active.run_id,
                "message": "A mapping run is already in progress — its progress shows below."}
    vuln_ids = _scope_vuln_ids(db, tenant_id, ctem_scope_id)
    user_id = current_user.id
    slug = getattr(request.state, "tenant_slug", None)
    if not slug:
        # no tenant context for a worker session — synchronous fallback
        try:
            summary = svc.generate_proposals(db, tenant_id, vulnerability_ids=vuln_ids,
                                             ctem_scope_id=ctem_scope_id, triggered_by=user_id)
            db.commit()
            return {"status": "finished", **summary}
        except Exception as e:
            db.rollback()
            logger.exception("ai-control-proposals generate failed")
            raise HTTPException(status_code=500, detail=f"Generation failed: {type(e).__name__}")

    def _run_bg():
        # usage_scope: a background thread has no request context, so without this
        # every model call's usage event is DROPPED ("no tenant context resolved") —
        # the house pattern from tasks/control_library.py.
        from ....services.ai_usage import usage_scope
        bg = open_tenant_session(slug)
        try:
            with usage_scope(tenant_slug=slug, actor_user_id=user_id,
                             module_key="vuln_management", feature_key="ai_control_mapping"):
                svc.generate_proposals(bg, tenant_id, vulnerability_ids=vuln_ids,
                                       ctem_scope_id=ctem_scope_id, triggered_by=user_id)
            bg.commit()
        except Exception:
            bg.rollback()
            logger.exception("Background AI control mapping failed (tenant %s scope %s)", tenant_id, ctem_scope_id)
        finally:
            bg.close()

    threading.Thread(target=_run_bg, name=f"ai-map-{tenant_id}-{ctem_scope_id or 'all'}", daemon=True).start()
    return {"status": "running",
            "message": "AI mapping started — it runs in the background; the panel updates when it finishes."}


@router.get("")
def list_proposals(
    status: Optional[str] = None,
    ctem_scope_id: Optional[int] = None,
    run_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _view,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    vuln_ids = _scope_vuln_ids(db, tenant_id, ctem_scope_id)
    items = svc.list_proposals(db, tenant_id, status=status, vulnerability_ids=vuln_ids, run_id=run_id)
    from ....models import AiControlProposalRun, AiControlProposal
    from sqlalchemy import func as _f
    last = db.query(AiControlProposalRun).filter(AiControlProposalRun.tenant_id == tenant_id).order_by(
        AiControlProposalRun.started_at.desc()).first()
    # per-status counts for the tab badges — same scope filter, ALL statuses so
    # the "To review" tab shows its true size (the status-filtered `items` only
    # holds one tab's rows). Guards the misleading "1 of 1" run line vs 69 queued.
    cq = db.query(AiControlProposal.status, _f.count(AiControlProposal.id)).filter(
        AiControlProposal.tenant_id == tenant_id)
    if run_id:
        cq = cq.filter(AiControlProposal.run_id == run_id)   # per-run tab counts
    if vuln_ids is not None:
        cq = cq.filter(AiControlProposal.vulnerability_id.in_(vuln_ids)) if vuln_ids else cq.filter(False)
    # no_control = the "analysed, no specific control" markers (patch-only / no-specific);
    # they carry the finding's answer but never appear in the review list.
    counts = {"proposed": 0, "accepted": 0, "rejected": 0, "no_control": 0}
    for st, n in cq.group_by(AiControlProposal.status).all():
        counts[st] = n
    # per-run tally for the LIVE progress display — the totals above include every
    # earlier cycle's decisions; the running bar must narrate THIS run only.
    last_run_counts = {"proposed": 0, "accepted": 0, "rejected": 0, "no_control": 0}
    if last is not None:
        for st, n in db.query(AiControlProposal.status, _f.count(AiControlProposal.id)).filter(
                AiControlProposal.tenant_id == tenant_id,
                AiControlProposal.run_id == last.run_id).group_by(AiControlProposal.status).all():
            last_run_counts[st] = n
    # recent runs — each mapping run is its own reviewable session
    runs = [{"run_id": r.run_id,
             "started_at": r.started_at.isoformat() if r.started_at else None,
             "finished_at": r.finished_at.isoformat() if r.finished_at else None,
             "findings_sent": r.findings_sent, "findings_total": r.findings_total,
             "error": bool(r.error)}
            for r in db.query(AiControlProposalRun).filter(
                AiControlProposalRun.tenant_id == tenant_id
            ).order_by(AiControlProposalRun.started_at.desc()).limit(10).all()]
    return {"items": items, "count": len(items), "counts": counts,
            "last_run_counts": last_run_counts, "runs": runs,
            "last_run": svc._summary(last) if last else None}


@router.post("/{proposal_id}/accept")
def accept(proposal_id: int, body: Decision = Decision(), db: Session = Depends(get_db),
           current_user: GRCUser = Depends(require_auth), _perm: bool = _edit):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        out = svc.accept_proposal(db, tenant_id, proposal_id, user_id=current_user.id, note=body.note)
        db.commit()
        return out
    except LookupError:
        raise HTTPException(status_code=404, detail="Proposal not found")
    except Exception:
        db.rollback()
        logger.exception("accept proposal failed")
        raise HTTPException(status_code=500, detail="Accept failed")


@router.post("/{proposal_id}/reject")
def reject(proposal_id: int, body: Decision = Decision(), db: Session = Depends(get_db),
           current_user: GRCUser = Depends(require_auth), _perm: bool = _edit):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        out = svc.reject_proposal(db, tenant_id, proposal_id, user_id=current_user.id, note=body.note)
        db.commit()
        return out
    except LookupError:
        raise HTTPException(status_code=404, detail="Proposal not found")
    except Exception:
        db.rollback()
        logger.exception("reject proposal failed")
        raise HTTPException(status_code=500, detail="Reject failed")
