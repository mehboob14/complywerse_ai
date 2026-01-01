from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..models import (
    Framework, NormalizedControl, Evidence, Risk, 
    Document, ITAsset, GRCUser, get_db
)
from .auth_router import require_auth

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    frameworks_count = db.query(func.count(Framework.id)).filter(Framework.is_active == True).scalar()
    controls_count = db.query(func.count(NormalizedControl.id)).scalar()
    evidence_count = db.query(func.count(Evidence.id)).scalar()
    open_risks = db.query(func.count(Risk.id)).filter(
        Risk.status.in_(["identified", "under_review", "mitigating"])
    ).scalar()
    documents_count = db.query(func.count(Document.id)).scalar()
    assets_count = db.query(func.count(ITAsset.id)).scalar()
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    compliance_overview = []
    for fw in frameworks[:5]:
        compliance_overview.append({
            "framework": fw.name,
            "short_code": fw.short_code,
            "score": 85,
            "status": "partial"
        })
    
    return {
        "stats": {
            "frameworks": frameworks_count or 0,
            "controls": controls_count or 0,
            "evidence": evidence_count or 0,
            "open_risks": open_risks or 0,
            "documents": documents_count or 0,
            "assets": assets_count or 0
        },
        "compliance_overview": compliance_overview,
        "recent_activity": []
    }
