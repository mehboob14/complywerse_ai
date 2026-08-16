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
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Run the AI mapper over the tenant (or one CTEM scope) and store
    PROPOSALS. Inventory findings are counted, never sent. Never links.

    Runs in a BACKGROUND worker with its own tenant session (the house pattern
    from the scanner sync): ~75 sequential model calls take 60-120s, and holding
    the HTTP request open that long trips the proxy's 30s timeout — the browser
    saw a 500 while the server was still working. Returns immediately; the
    panel polls `last_run` (started_at set, finished_at null = running)."""
    tenant_id = get_user_primary_tenant(current_user, db)
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
        bg = open_tenant_session(slug)
        try:
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
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _view,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    vuln_ids = _scope_vuln_ids(db, tenant_id, ctem_scope_id)
    items = svc.list_proposals(db, tenant_id, status=status, vulnerability_ids=vuln_ids)
    from ....models import AiControlProposalRun
    last = db.query(AiControlProposalRun).filter(AiControlProposalRun.tenant_id == tenant_id).order_by(
        AiControlProposalRun.started_at.desc()).first()
    return {"items": items, "count": len(items),
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
