"""Read-only lists the Risk Management monitoring pages (appetite, analytics, dependencies, the pickers of KRI / incident / mitigation forms) need whole.

`GET /erm/risks` caps at the newest 100 risks; the pages that count or pick over EVERY risk read this lean list instead. Same gate as the rest of the
/erm router (erm:risks:view, see modules/erm/router.py) and the same tenant scoping as the other readers: nothing here widens access.
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ....models import GRCUser, Risk, get_db
from ....routers.auth_router import get_user_tenants, require_auth

router = APIRouter(prefix="/monitoring", tags=["ERM - Monitoring lists"])

LEAN_RISK_LIMIT = 20000


@router.get("/risks")
def list_lean_risks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every risk of the tenant, one small row each, in creation order. `total` is the real count; `items` is cut at LEAN_RISK_LIMIT."""
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"items": [], "total": 0}
    query = db.query(Risk).options(joinedload(Risk.owner), joinedload(Risk.business_unit)).filter(Risk.tenant_id.in_(tenants))
    total = query.count()
    rows: List[Risk] = query.order_by(Risk.id.asc()).limit(LEAN_RISK_LIMIT).all()
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "title": r.title,
                "category": r.category,
                "risk_category": r.risk_category,
                "status": r.status,
                "closure_status": r.closure_status,
                "inherent_likelihood": r.inherent_likelihood,
                "inherent_impact": r.inherent_impact,
                "inherent_score": r.inherent_score,
                "residual_likelihood": r.residual_likelihood,
                "residual_impact": r.residual_impact,
                "residual_score": r.residual_score,
                "owner_id": r.owner_id,
                "owner_name": (r.owner.display_name or r.owner.username) if r.owner else None,
                "business_unit_id": r.business_unit_id,
                "business_unit": r.business_unit.name if r.business_unit else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ],
    }
