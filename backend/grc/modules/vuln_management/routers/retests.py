from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityRetest, Vulnerability, GRCUser, get_db
)
from ....schemas import (
    VulnerabilityRetestCreate, VulnerabilityRetestResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vulnerability Retests"])


def get_vuln_or_404(vuln_id: int, user_tenants: List[int], db: Session) -> Vulnerability:
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vulnerability not found"
        )
    return vuln


@router.get("/vulnerabilities/{vuln_id}/retests", response_model=List[VulnerabilityRetestResponse])
def list_retests(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    retests = db.query(VulnerabilityRetest).options(
        joinedload(VulnerabilityRetest.tester)
    ).filter(VulnerabilityRetest.vulnerability_id == vuln_id).order_by(
        VulnerabilityRetest.retest_date.desc()
    ).all()
    
    return [
        VulnerabilityRetestResponse(
            id=r.id,
            vulnerability_id=r.vulnerability_id,
            tenant_id=r.tenant_id,
            retest_date=r.retest_date,
            tester_id=r.tester_id,
            result=r.result,
            findings=r.findings,
            evidence=r.evidence,
            created_at=r.created_at,
            tester_name=r.tester.display_name if r.tester else None
        )
        for r in retests
    ]


@router.post("/vulnerabilities/{vuln_id}/retests", response_model=VulnerabilityRetestResponse, status_code=status.HTTP_201_CREATED)
def create_retest(
    vuln_id: int,
    request: VulnerabilityRetestCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    valid_results = ["pass", "fail", "partial"]
    if request.result not in valid_results:
        raise HTTPException(status_code=400, detail=f"Invalid result. Must be one of: {valid_results}")
    
    retest = VulnerabilityRetest(
        vulnerability_id=vuln_id,
        tenant_id=vuln.tenant_id,
        retest_date=request.retest_date or datetime.utcnow(),
        tester_id=current_user.id,
        result=request.result,
        findings=request.findings,
        evidence=request.evidence
    )
    db.add(retest)
    
    if request.result == "pass":
        vuln.status = "resolved"
        vuln.resolved_at = datetime.utcnow()
        vuln.verified_by = current_user.id
        vuln.verified_at = datetime.utcnow()

    # CTEM Phase 2: a retest is a GENUINE effectiveness signal for the
    # controls linked to this finding — pass reaches the full tested tier,
    # fail/partial dominate as a fail (the original result is preserved in
    # the evidence details).
    try:
        from ....services.control_assurance import record_vuln_evidence
        record_vuln_evidence(
            db, vuln, source_type="retest",
            result="pass" if request.result == "pass" else "fail",
            tested_at=retest.retest_date or datetime.utcnow(),
            details={"retest_result": request.result,
                     "tester_id": current_user.id,
                     "vuln_id": vuln.vuln_id},
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "retest evidence write failed for vuln %s (non-fatal)", vuln.id
        )

    db.commit()
    db.refresh(retest)
    
    return VulnerabilityRetestResponse(
        id=retest.id,
        vulnerability_id=retest.vulnerability_id,
        tenant_id=retest.tenant_id,
        retest_date=retest.retest_date,
        tester_id=retest.tester_id,
        result=retest.result,
        findings=retest.findings,
        evidence=retest.evidence,
        created_at=retest.created_at,
        tester_name=current_user.display_name
    )
