from typing import List, Optional
from datetime import datetime
import os
import uuid
import json
import csv
import zipfile
import shutil
from io import StringIO
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    AuditPackage, AuditPackageEvidence, AuditPackageAccessLog,
    Evidence, Framework, GRCUser, Tenant, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ....rich_audit import write_rich_audit_log, model_to_dict

AUDIT_PACKAGES_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "uploads", "audit_packages"
)
os.makedirs(AUDIT_PACKAGES_UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/audit-packages", tags=["Audit Packages"])


class AuditPackageCreate(BaseModel):
    name: str
    description: Optional[str] = None
    framework_id: Optional[int] = None
    audit_period_start: Optional[datetime] = None
    audit_period_end: Optional[datetime] = None


class AuditPackageUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    framework_id: Optional[int] = None
    audit_period_start: Optional[datetime] = None
    audit_period_end: Optional[datetime] = None


class AddEvidenceRequest(BaseModel):
    evidence_ids: List[int]
    notes: Optional[str] = None


class ReorderEvidenceRequest(BaseModel):
    new_sequence: int


class LegalHoldRequest(BaseModel):
    is_legal_hold: bool


class LogAccessRequest(BaseModel):
    action: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_package_or_404(package_id: int, user: GRCUser, db: Session) -> AuditPackage:
    user_tenants = get_user_tenants(user, db)
    package = db.query(AuditPackage).filter(
        AuditPackage.id == package_id,
        AuditPackage.tenant_id.in_(user_tenants)
    ).first()
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit package not found"
        )
    return package


def serialize_package(package: AuditPackage, db: Session, include_details: bool = False) -> dict:
    evidence_count = db.query(func.count(AuditPackageEvidence.id)).filter(
        AuditPackageEvidence.package_id == package.id
    ).scalar() or 0
    
    result = {
        "id": package.id,
        "tenant_id": package.tenant_id,
        "name": package.name,
        "description": package.description,
        "framework_id": package.framework_id,
        "framework_name": package.framework.name if package.framework else None,
        "audit_period_start": package.audit_period_start.isoformat() if package.audit_period_start else None,
        "audit_period_end": package.audit_period_end.isoformat() if package.audit_period_end else None,
        "status": package.status,
        "created_by": package.created_by,
        "creator_name": package.creator.display_name if package.creator else None,
        "created_at": package.created_at.isoformat() if package.created_at else None,
        "finalized_at": package.finalized_at.isoformat() if package.finalized_at else None,
        "finalized_by": package.finalized_by,
        "export_path": package.export_path,
        "exported_at": package.exported_at.isoformat() if package.exported_at else None,
        "retention_until": package.retention_until.isoformat() if package.retention_until else None,
        "is_legal_hold": package.is_legal_hold,
        "evidence_count": evidence_count,
    }
    
    if include_details:
        result["evidence_items"] = [
            {
                "id": item.id,
                "evidence_id": item.evidence_id,
                "sequence": item.sequence,
                "notes": item.notes,
                "added_at": item.added_at.isoformat() if item.added_at else None,
                "added_by": item.added_by,
                "evidence": {
                    "id": item.evidence.id,
                    "name": item.evidence.name,
                    "description": item.evidence.description,
                    "file_name": item.evidence.file_name,
                    "file_type": item.evidence.file_type,
                    "evidence_type": item.evidence.evidence_type,
                    "status": item.evidence.status,
                    "collection_date": item.evidence.collection_date.isoformat() if item.evidence.collection_date else None,
                } if item.evidence else None
            }
            for item in sorted(package.evidence_items, key=lambda x: x.sequence)
        ]
        
        result["access_logs"] = [
            {
                "id": log.id,
                "user_id": log.user_id,
                "user_name": log.user.display_name if log.user else None,
                "action": log.action,
                "accessed_at": log.accessed_at.isoformat() if log.accessed_at else None,
                "ip_address": log.ip_address,
            }
            for log in sorted(package.access_logs, key=lambda x: x.accessed_at, reverse=True)[:20]
        ]
    
    return result


@router.get("")
def list_audit_packages(
    tenant_id: Optional[int] = None,
    framework_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(AuditPackage).options(
        joinedload(AuditPackage.creator),
        joinedload(AuditPackage.framework)
    ).filter(AuditPackage.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(AuditPackage.tenant_id == tenant_id)
    if framework_id:
        query = query.filter(AuditPackage.framework_id == framework_id)
    if status_filter:
        query = query.filter(AuditPackage.status == status_filter)
    
    total = query.count()
    packages = query.order_by(AuditPackage.created_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_package(p, db) for p in packages],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_audit_package(
    package_data: AuditPackageCreate,
    tenant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    
    if package_data.framework_id:
        framework = db.query(Framework).filter(Framework.id == package_data.framework_id).first()
        if not framework:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")
    
    db_package = AuditPackage(
        tenant_id=tenant_id,
        name=package_data.name,
        description=package_data.description,
        framework_id=package_data.framework_id,
        audit_period_start=package_data.audit_period_start,
        audit_period_end=package_data.audit_period_end,
        status="draft",
        created_by=current_user.id
    )
    db.add(db_package)
    db.commit()
    db.refresh(db_package)

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="evidence",
        resource_id=db_package.id,
        resource_name=db_package.name,
        summary=f"Created audit package '{db_package.name}'",
        snapshot=model_to_dict(db_package),
        resource_url=f"/evidence/audit-packages/{db_package.id}",
    )
    db.commit()

    return serialize_package(db_package, db)


@router.get("/{package_id}")
def get_audit_package(
    package_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    package = db.query(AuditPackage).options(
        joinedload(AuditPackage.creator),
        joinedload(AuditPackage.finalizer),
        joinedload(AuditPackage.framework),
        joinedload(AuditPackage.evidence_items).joinedload(AuditPackageEvidence.evidence),
        joinedload(AuditPackage.access_logs).joinedload(AuditPackageAccessLog.user)
    ).filter(
        AuditPackage.id == package_id,
        AuditPackage.tenant_id.in_(user_tenants)
    ).first()
    
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit package not found")
    
    return serialize_package(package, db, include_details=True)


@router.put("/{package_id}")
def update_audit_package(
    package_id: int,
    package_data: AuditPackageUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only update packages in draft status"
        )

    _before_pkg = model_to_dict(package)

    if package_data.framework_id is not None:
        if package_data.framework_id:
            framework = db.query(Framework).filter(Framework.id == package_data.framework_id).first()
            if not framework:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")
        package.framework_id = package_data.framework_id
    
    if package_data.name is not None:
        package.name = package_data.name
    if package_data.description is not None:
        package.description = package_data.description
    if package_data.audit_period_start is not None:
        package.audit_period_start = package_data.audit_period_start
    if package_data.audit_period_end is not None:
        package.audit_period_end = package_data.audit_period_end
    
    db.commit()
    db.refresh(package)

    write_rich_audit_log(
        db=db,
        tenant_id=package.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="evidence",
        resource_id=package.id,
        resource_name=package.name,
        summary=f"Updated audit package '{package.name}'",
        before=_before_pkg,
        after=model_to_dict(package),
        resource_url=f"/evidence/audit-packages/{package.id}",
    )
    db.commit()

    return serialize_package(package, db)


@router.delete("/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_package(
    package_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.is_legal_hold:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete package on legal hold"
        )
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only delete packages in draft status"
        )

    _snap_pkg = model_to_dict(package)
    _pkg_name = package.name
    _pkg_tenant_id = package.tenant_id

    db.delete(package)
    db.commit()

    write_rich_audit_log(
        db=db,
        tenant_id=_pkg_tenant_id,
        user_id=current_user.id,
        action="delete",
        resource_type="evidence",
        resource_id=package_id,
        resource_name=_pkg_name,
        summary=f"Deleted audit package '{_pkg_name}'",
        snapshot=_snap_pkg,
        resource_url=f"/evidence/audit-packages/{package_id}",
    )
    db.commit()

    return None


@router.post("/{package_id}/evidence")
def add_evidence_to_package(
    package_id: int,
    request: AddEvidenceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only add evidence to packages in draft status"
        )
    
    user_tenants = get_user_tenants(current_user, db)
    
    evidence_items = db.query(Evidence).filter(
        Evidence.id.in_(request.evidence_ids),
        Evidence.tenant_id.in_(user_tenants)
    ).all()
    
    found_ids = {e.id for e in evidence_items}
    missing_ids = set(request.evidence_ids) - found_ids
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evidence not found: {list(missing_ids)}"
        )
    
    for e in evidence_items:
        if e.tenant_id != package.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Evidence {e.id} belongs to a different tenant"
            )
    
    existing = db.query(AuditPackageEvidence).filter(
        AuditPackageEvidence.package_id == package_id
    ).all()
    existing_evidence_ids = {e.evidence_id for e in existing}
    
    max_sequence = db.query(func.max(AuditPackageEvidence.sequence)).filter(
        AuditPackageEvidence.package_id == package_id
    ).scalar() or 0
    
    added_count = 0
    for evidence_id in request.evidence_ids:
        if evidence_id not in existing_evidence_ids:
            max_sequence += 1
            db_item = AuditPackageEvidence(
                package_id=package_id,
                evidence_id=evidence_id,
                sequence=max_sequence,
                notes=request.notes,
                added_by=current_user.id
            )
            db.add(db_item)
            added_count += 1
    
    db.commit()
    
    package = db.query(AuditPackage).options(
        joinedload(AuditPackage.creator),
        joinedload(AuditPackage.framework),
        joinedload(AuditPackage.evidence_items).joinedload(AuditPackageEvidence.evidence),
        joinedload(AuditPackage.access_logs).joinedload(AuditPackageAccessLog.user)
    ).filter(AuditPackage.id == package_id).first()
    
    return serialize_package(package, db, include_details=True)


@router.delete("/{package_id}/evidence/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_evidence_from_package(
    package_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only remove evidence from packages in draft status"
        )
    
    item = db.query(AuditPackageEvidence).filter(
        AuditPackageEvidence.id == item_id,
        AuditPackageEvidence.package_id == package_id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence item not found in package"
        )
    
    db.delete(item)
    db.commit()
    return None


@router.put("/{package_id}/evidence/{item_id}/reorder")
def reorder_evidence(
    package_id: int,
    item_id: int,
    request: ReorderEvidenceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only reorder evidence in packages in draft status"
        )
    
    item = db.query(AuditPackageEvidence).filter(
        AuditPackageEvidence.id == item_id,
        AuditPackageEvidence.package_id == package_id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence item not found in package"
        )
    
    item.sequence = request.new_sequence
    db.commit()
    
    return {"message": "Evidence reordered successfully", "new_sequence": request.new_sequence}


@router.post("/{package_id}/finalize")
def finalize_package(
    package_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only finalize packages in draft status"
        )
    
    evidence_count = db.query(func.count(AuditPackageEvidence.id)).filter(
        AuditPackageEvidence.package_id == package_id
    ).scalar() or 0
    
    if evidence_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot finalize package with no evidence"
        )
    
    package.status = "finalized"
    package.finalized_at = datetime.utcnow()
    package.finalized_by = current_user.id
    
    db.commit()
    db.refresh(package)
    
    return serialize_package(package, db)


@router.post("/{package_id}/export")
def export_package(
    package_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    if package.status not in ["finalized", "exported"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only export finalized packages"
        )
    
    package = db.query(AuditPackage).options(
        joinedload(AuditPackage.creator),
        joinedload(AuditPackage.finalizer),
        joinedload(AuditPackage.framework),
        joinedload(AuditPackage.evidence_items).joinedload(AuditPackageEvidence.evidence)
    ).filter(AuditPackage.id == package_id).first()
    
    tenant_dir = os.path.join(AUDIT_PACKAGES_UPLOAD_DIR, str(package.tenant_id))
    os.makedirs(tenant_dir, exist_ok=True)
    
    export_id = str(uuid.uuid4())
    zip_filename = f"audit_package_{package.id}_{export_id}.zip"
    zip_path = os.path.join(tenant_dir, zip_filename)
    
    metadata = {
        "package_id": package.id,
        "name": package.name,
        "description": package.description,
        "framework": package.framework.name if package.framework else None,
        "framework_id": package.framework_id,
        "audit_period_start": package.audit_period_start.isoformat() if package.audit_period_start else None,
        "audit_period_end": package.audit_period_end.isoformat() if package.audit_period_end else None,
        "status": package.status,
        "created_by": package.creator.display_name if package.creator else None,
        "created_at": package.created_at.isoformat() if package.created_at else None,
        "finalized_by": package.finalizer.display_name if package.finalizer else None,
        "finalized_at": package.finalized_at.isoformat() if package.finalized_at else None,
        "exported_at": datetime.utcnow().isoformat(),
        "evidence_count": len(package.evidence_items)
    }
    
    evidence_index = []
    for item in sorted(package.evidence_items, key=lambda x: x.sequence):
        if item.evidence:
            evidence_index.append({
                "sequence": item.sequence,
                "evidence_id": item.evidence.id,
                "name": item.evidence.name,
                "description": item.evidence.description or "",
                "file_name": item.evidence.file_name or "",
                "evidence_type": item.evidence.evidence_type or "",
                "status": item.evidence.status or "",
                "collection_date": item.evidence.collection_date.isoformat() if item.evidence.collection_date else "",
                "notes": item.notes or ""
            })
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr("metadata.json", json.dumps(metadata, indent=2))
        
        csv_buffer = StringIO()
        if evidence_index:
            fieldnames = list(evidence_index[0].keys())
            writer = csv.DictWriter(csv_buffer, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(evidence_index)
        zipf.writestr("evidence_index.csv", csv_buffer.getvalue())
        
        evidence_dir = "evidence_files"
        for item in package.evidence_items:
            if item.evidence and item.evidence.file_path:
                if os.path.exists(item.evidence.file_path):
                    file_name = item.evidence.file_name or os.path.basename(item.evidence.file_path)
                    safe_name = f"{item.sequence:03d}_{file_name}"
                    zipf.write(item.evidence.file_path, os.path.join(evidence_dir, safe_name))
    
    package.status = "exported"
    package.export_path = zip_path
    package.exported_at = datetime.utcnow()
    
    access_log = AuditPackageAccessLog(
        package_id=package_id,
        user_id=current_user.id,
        action="exported"
    )
    db.add(access_log)
    
    db.commit()
    db.refresh(package)
    
    return {
        "message": "Package exported successfully",
        "export_path": zip_path,
        "exported_at": package.exported_at.isoformat(),
        "download_url": f"/api/grc/evidence-mgmt/audit-packages/{package_id}/download"
    }


@router.post("/{package_id}/legal-hold")
def set_legal_hold(
    package_id: int,
    request: LegalHoldRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    package.is_legal_hold = request.is_legal_hold
    db.commit()
    db.refresh(package)
    
    action = "legal_hold_set" if request.is_legal_hold else "legal_hold_removed"
    access_log = AuditPackageAccessLog(
        package_id=package_id,
        user_id=current_user.id,
        action=action
    )
    db.add(access_log)
    db.commit()
    
    return {
        "message": f"Legal hold {'set' if request.is_legal_hold else 'removed'} successfully",
        "is_legal_hold": package.is_legal_hold
    }


@router.get("/{package_id}/access-log")
def get_access_log(
    package_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    query = db.query(AuditPackageAccessLog).options(
        joinedload(AuditPackageAccessLog.user)
    ).filter(AuditPackageAccessLog.package_id == package_id)
    
    total = query.count()
    logs = query.order_by(AuditPackageAccessLog.accessed_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "user_name": log.user.display_name if log.user else None,
                "action": log.action,
                "accessed_at": log.accessed_at.isoformat() if log.accessed_at else None,
                "ip_address": log.ip_address,
                "user_agent": log.user_agent
            }
            for log in logs
        ],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("/{package_id}/log-access")
def log_access(
    package_id: int,
    request: LogAccessRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    package = get_package_or_404(package_id, current_user, db)
    
    ip_address = request.ip_address
    if not ip_address:
        ip_address = http_request.client.host if http_request.client else None
    
    user_agent = request.user_agent
    if not user_agent:
        user_agent = http_request.headers.get("user-agent")
    
    access_log = AuditPackageAccessLog(
        package_id=package_id,
        user_id=current_user.id,
        action=request.action,
        ip_address=ip_address,
        user_agent=user_agent
    )
    db.add(access_log)
    db.commit()
    db.refresh(access_log)
    
    return {
        "message": "Access logged successfully",
        "log_id": access_log.id,
        "action": access_log.action,
        "accessed_at": access_log.accessed_at.isoformat()
    }
