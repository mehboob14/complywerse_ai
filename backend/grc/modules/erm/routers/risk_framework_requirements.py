"""The register's Controls tab, for the framework library: pick a control of an installed framework (UAE IA, ISO 27001, ...) and link it to a
risk, or take the link off. Reads need the module's view right (`erm:risks:view`, the ERM router's); linking and unlinking need
`erm:risks:edit` or `erm:risks:create`."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, ParsedFrameworkControl, Risk, RiskFrameworkRequirementLink, get_db
from ....routers.auth_router import get_user_tenants, require_auth, require_tenant_permission
from ..services import risk_framework_requirements as svc

router = APIRouter(tags=["ERM - Risk framework controls"])
_may_link = require_tenant_permission("erm:risks:edit", "erm:risks:create")


@router.get("/framework-requirements/frameworks")
def list_installed_frameworks(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The frameworks this organisation has installed, to pick a control from."""
    return {"items": svc.installed(db, get_user_tenants(current_user, db))}


@router.get("/framework-requirements")
def search_framework_controls(
    framework_id: int = Query(...),
    q: Optional[str] = Query(None, description="Words in the control's id, title, domain or category"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if framework_id not in {f["id"] for f in svc.installed(db, get_user_tenants(current_user, db))}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That framework is not installed")
    total, items = svc.search_controls(db, framework_id, q, skip, limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


class LinkControls(BaseModel):
    framework_id: int
    control_ids: List[int] = Field(..., min_length=1, max_length=200)      # ParsedFrameworkControl ids, from the search above
    mitigation_effectiveness: str = "partial"
    notes: Optional[str] = None


def _risk(db: Session, user: GRCUser, risk_id: int) -> Risk:
    risk = db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id.in_(get_user_tenants(user, db) or [-1])).first()
    if risk is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Risk not found")
    return risk


@router.post("/risks/{risk_id}/framework-requirements", status_code=status.HTTP_201_CREATED)
def link_framework_controls(
    risk_id: int,
    body: LinkControls,
    _perm: bool = Depends(_may_link),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    risk = _risk(db, current_user, risk_id)
    framework = next((f for f in svc.installed(db, get_user_tenants(current_user, db)) if f["id"] == body.framework_id), None)
    if framework is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That framework is not installed")
    if body.mitigation_effectiveness not in svc.EFFECTIVENESS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Effectiveness must be one of: {', '.join(svc.EFFECTIVENESS)}")
    controls = (db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == body.framework_id,
                                                         ParsedFrameworkControl.id.in_(body.control_ids))
                .order_by(ParsedFrameworkControl.id.asc()).all())
    if len(controls) != len(set(body.control_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One of those controls is not in that framework")
    from ....models import UploadedFramework
    done = svc.link_controls(db, risk, db.get(UploadedFramework, body.framework_id), controls,
                             body.mitigation_effectiveness, (body.notes or "").strip() or None, current_user.id)
    db.commit()
    db.refresh(risk)
    return {**done, "links": svc.serialize_links(risk)}


@router.delete("/risks/{risk_id}/framework-requirements/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_framework_control(
    risk_id: int,
    link_id: int,
    _perm: bool = Depends(_may_link),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    risk = _risk(db, current_user, risk_id)
    link = db.query(RiskFrameworkRequirementLink).filter(RiskFrameworkRequirementLink.id == link_id,
                                                         RiskFrameworkRequirementLink.risk_id == risk.id).first()
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That link is not on this risk")
    db.delete(link)
    db.commit()
    return None
