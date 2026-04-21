from typing import List, Optional
import io
import csv
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Vulnerability, VulnerabilityReport, VulnerabilitySLAConfig,
    VulnerabilityAssetLink, GRCUser, get_db
)
from ....schemas import (
    VulnerabilityCreate, VulnerabilityUpdate, VulnerabilityResponse,
    VulnerabilityAssign, VulnerabilityStatusChange, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission

router = APIRouter(tags=["Vulnerabilities"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


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


def get_sla_days(tenant_id: int, severity: str, db: Session) -> int:
    sla = db.query(VulnerabilitySLAConfig).filter(
        VulnerabilitySLAConfig.tenant_id == tenant_id,
        VulnerabilitySLAConfig.severity == severity,
        VulnerabilitySLAConfig.is_active == True
    ).first()
    if sla:
        return sla.remediation_days
    defaults = {"critical": 7, "high": 30, "medium": 90, "low": 180, "info": 365}
    return defaults.get(severity, 90)


def generate_vuln_id(tenant_id: int, db: Session) -> str:
    count = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id).count()
    return f"VULN-{count + 1:05d}"


def _build_vulnerability_response(v: Vulnerability) -> VulnerabilityResponse:
    linked_assets = []
    if getattr(v, "asset_links", None):
        linked_assets = [
            link.asset.name
            for link in v.asset_links
            if getattr(link, "asset", None) and getattr(link.asset, "name", None)
        ]

    return VulnerabilityResponse(
        id=v.id,
        tenant_id=v.tenant_id,
        report_id=v.report_id,
        vuln_id=v.vuln_id,
        title=v.title,
        description=v.description,
        severity=v.severity,
        cvss_score=v.cvss_score,
        cvss_vector=v.cvss_vector,
        cve_id=v.cve_id,
        cwe_id=v.cwe_id,
        affected_component=v.affected_component,
        affected_host=v.affected_host,
        affected_port=v.affected_port,
        affected_url=v.affected_url,
        evidence=v.evidence,
        reproduction_steps=v.reproduction_steps,
        recommendation=v.recommendation,
        ai_recommendation=v.ai_recommendation,
        ai_impact_assessment=v.ai_impact_assessment,
        status=v.status,
        resolution_notes=v.resolution_notes,
        discovered_at=v.discovered_at,
        due_date=v.due_date,
        resolved_at=v.resolved_at,
        assigned_to=v.assigned_to,
        verified_by=v.verified_by,
        verified_at=v.verified_at,
        is_exception=v.is_exception,
        exception_reason=v.exception_reason,
        exception_approved_by=v.exception_approved_by,
        exception_expiry=v.exception_expiry,
        created_at=v.created_at,
        updated_at=v.updated_at,
        assignee_name=v.assignee.display_name if v.assignee else None,
        verifier_name=v.verifier.display_name if v.verifier else None,
        linked_assets=linked_assets,
    )


@router.get("/vulnerabilities", response_model=List[VulnerabilityResponse])
def list_vulnerabilities(
    tenant_id: Optional[int] = None,
    report_id: Optional[int] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    assigned_to: Optional[int] = None,
    cve_id: Optional[str] = None,
    is_exception: Optional[bool] = None,
    is_overdue: Optional[bool] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view"))
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee),
        joinedload(Vulnerability.verifier),
        joinedload(Vulnerability.asset_links).joinedload(VulnerabilityAssetLink.asset),
    ).filter(Vulnerability.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Vulnerability.tenant_id == tenant_id)
    if report_id:
        query = query.filter(Vulnerability.report_id == report_id)
    if severity:
        query = query.filter(Vulnerability.severity == severity)
    if status_filter:
        query = query.filter(Vulnerability.status == status_filter)
    if assigned_to:
        query = query.filter(Vulnerability.assigned_to == assigned_to)
    if cve_id:
        query = query.filter(Vulnerability.cve_id.ilike(f"%{cve_id}%"))
    if is_exception is not None:
        query = query.filter(Vulnerability.is_exception == is_exception)
    if is_overdue:
        query = query.filter(
            Vulnerability.due_date < datetime.utcnow(),
            Vulnerability.status.notin_(["resolved", "accepted", "false_positive"])
        )
    if search:
        query = query.filter(
            (Vulnerability.title.ilike(f"%{search}%")) |
            (Vulnerability.vuln_id.ilike(f"%{search}%")) |
            (Vulnerability.cve_id.ilike(f"%{search}%"))
        )
    
    vulns = query.order_by(Vulnerability.created_at.desc()).offset(skip).limit(limit).all()
    
    return [_build_vulnerability_response(v) for v in vulns]


@router.post("/vulnerabilities", response_model=VulnerabilityResponse, status_code=status.HTTP_201_CREATED)
def create_vulnerability(
    request: VulnerabilityCreate,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:create"))
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            tenant_id = user_tenants[0]
    
    vuln_id = request.vuln_id or generate_vuln_id(tenant_id, db)
    
    sla_days = get_sla_days(tenant_id, request.severity, db)
    due_date = request.due_date or (datetime.utcnow() + timedelta(days=sla_days))
    
    vuln = Vulnerability(
        tenant_id=tenant_id,
        report_id=request.report_id,
        vuln_id=vuln_id,
        title=request.title,
        description=request.description,
        severity=request.severity,
        cvss_score=request.cvss_score,
        cvss_vector=request.cvss_vector,
        cve_id=request.cve_id,
        cwe_id=request.cwe_id,
        affected_component=request.affected_component,
        affected_host=request.affected_host,
        affected_port=request.affected_port,
        affected_url=request.affected_url,
        evidence=request.evidence,
        reproduction_steps=request.reproduction_steps,
        recommendation=request.recommendation,
        status="open",
        discovered_at=request.discovered_at or datetime.utcnow(),
        due_date=due_date
    )
    db.add(vuln)
    db.commit()
    db.refresh(vuln)
    
    db.refresh(vuln)
    return _build_vulnerability_response(vuln)


@router.post("/vulnerabilities/bulk-upload")
async def bulk_upload_vulnerabilities(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:create"))
):
    """Bulk import vulnerabilities from CSV or Excel file."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        user_tenants = get_user_tenants(current_user, db)
        if not user_tenants:
            raise HTTPException(status_code=403, detail="User not associated with any tenant")
        tenant_id = user_tenants[0]

    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type '.{ext}'. Please upload a CSV or Excel file.")

    contents = await file.read()

    rows: list[dict] = []
    try:
        if ext == "csv":
            decoded = contents.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(decoded))
            rows = [dict(r) for r in reader]
        else:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
            ws = wb.active
            headers = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
            for row in ws.iter_rows(min_row=2, values_only=True):
                rows.append({headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)})
            wb.close()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {str(e)}. Ensure it matches the template format.")

    if not rows:
        raise HTTPException(status_code=422, detail="The file is empty or contains no data rows.")

    VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}
    VALID_STATUSES = {"open", "in_progress", "remediated", "verified", "closed", "accepted", "false_positive"}

    created = 0
    skipped = 0
    errors: list[str] = []

    # Calculate base count once so each row in this batch gets a unique ID
    existing_count = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id).count()
    id_counter = existing_count

    for idx, row in enumerate(rows, start=2):
        title = (row.get("title") or "").strip()
        if not title:
            skipped += 1
            continue

        severity = (row.get("severity") or "medium").strip().lower()
        if severity not in VALID_SEVERITIES:
            errors.append(f"Row {idx}: invalid severity '{severity}' — using 'medium'")
            severity = "medium"

        vul_status = (row.get("status") or "open").strip().lower()
        if vul_status not in VALID_STATUSES:
            vul_status = "open"

        cvss_raw = row.get("cvss_score") or ""
        try:
            cvss_score = float(cvss_raw) if cvss_raw else None
        except ValueError:
            cvss_score = None

        due_date_raw = (row.get("due_date") or "").strip()
        due_date = None
        if due_date_raw:
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
                try:
                    due_date = datetime.strptime(due_date_raw, fmt)
                    break
                except ValueError:
                    continue
        if not due_date:
            sla_days = get_sla_days(tenant_id, severity, db)
            due_date = datetime.utcnow() + timedelta(days=sla_days)

        id_counter += 1
        vuln_id_str = f"VULN-{id_counter:05d}"
        # If this ID already exists for the tenant (e.g. from a prior partial import), keep incrementing
        while db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.vuln_id == vuln_id_str
        ).count() > 0:
            id_counter += 1
            vuln_id_str = f"VULN-{id_counter:05d}"

        vuln = Vulnerability(
            tenant_id=tenant_id,
            vuln_id=vuln_id_str,
            title=title,
            description=(row.get("description") or "").strip() or None,
            severity=severity,
            status=vul_status,
            cvss_score=cvss_score,
            cve_id=(row.get("cve_id") or "").strip() or None,
            affected_component=(row.get("affected_asset") or row.get("affected_component") or "").strip() or None,
            recommendation=(row.get("remediation") or row.get("recommendation") or "").strip() or None,
            discovered_at=datetime.utcnow(),
            due_date=due_date,
        )
        db.add(vuln)
        created += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error while saving vulnerabilities: {str(e)}")

    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/vulnerabilities/{vuln_id}", response_model=VulnerabilityResponse)
def get_vulnerability(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view"))
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee),
        joinedload(Vulnerability.verifier),
        joinedload(Vulnerability.asset_links).joinedload(VulnerabilityAssetLink.asset),
    ).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    return _build_vulnerability_response(vuln)


@router.put("/vulnerabilities/{vuln_id}", response_model=VulnerabilityResponse)
def update_vulnerability(
    vuln_id: int,
    request: VulnerabilityUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit"))
):
    user_tenants = get_user_tenants(current_user, db)
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(vuln, field, value)
    
    vuln.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vuln)

    vuln = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee),
        joinedload(Vulnerability.verifier),
        joinedload(Vulnerability.asset_links).joinedload(VulnerabilityAssetLink.asset),
    ).filter(Vulnerability.id == vuln.id).first()

    return _build_vulnerability_response(vuln)


@router.delete("/vulnerabilities/{vuln_id}", response_model=MessageResponse)
def delete_vulnerability(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:delete"))
):
    user_tenants = get_user_tenants(current_user, db)
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    db.delete(vuln)
    db.commit()
    
    return MessageResponse(message="Vulnerability deleted successfully")


@router.post("/vulnerabilities/{vuln_id}/assign", response_model=VulnerabilityResponse)
def assign_vulnerability(
    vuln_id: int,
    request: VulnerabilityAssign,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit"))
):
    user_tenants = get_user_tenants(current_user, db)
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    user = db.query(GRCUser).filter(GRCUser.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    vuln.assigned_to = request.user_id
    vuln.updated_at = datetime.utcnow()
    
    if vuln.status == "open":
        vuln.status = "in_progress"
    
    db.commit()
    db.refresh(vuln)

    vuln = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee),
        joinedload(Vulnerability.verifier),
        joinedload(Vulnerability.asset_links).joinedload(VulnerabilityAssetLink.asset),
    ).filter(Vulnerability.id == vuln.id).first()

    return _build_vulnerability_response(vuln)

@router.post("/vulnerabilities/{vuln_id}/status", response_model=VulnerabilityResponse)
def change_vulnerability_status(
    vuln_id: int,
    request: VulnerabilityStatusChange,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit"))
):
    user_tenants = get_user_tenants(current_user, db)
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    valid_statuses = ["open", "in_progress", "remediated", "verified", "closed", "resolved", "accepted", "false_positive"]
    if request.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    vuln.status = request.status
    vuln.updated_at = datetime.utcnow()
    
    if request.resolution_notes:
        vuln.resolution_notes = request.resolution_notes
    
    if request.status in ["resolved", "remediated", "verified", "closed", "accepted", "false_positive"]:
        vuln.resolved_at = datetime.utcnow()
    if request.status in ["verified", "resolved", "closed"]:
        vuln.verified_by = current_user.id
        vuln.verified_at = datetime.utcnow()
    
    db.commit()
    db.refresh(vuln)

    vuln = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee),
        joinedload(Vulnerability.verifier),
        joinedload(Vulnerability.asset_links).joinedload(VulnerabilityAssetLink.asset),
    ).filter(Vulnerability.id == vuln.id).first()

    return _build_vulnerability_response(vuln)
