import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    ArtifactCatalogItem,
    TenantArtifact,
    GRCUser,
    ITAsset,
    Risk,
    get_db,
)
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artifacts", tags=["Artifacts"])

# ---------------------------------------------------------------------------
# Catalog seed path
# ---------------------------------------------------------------------------
_CATALOG_PATH = Path(__file__).parent.parent / "seed_data" / "artifact_catalog.json"

# Map assessment_type strings → catalog framework_key
ASSESSMENT_TYPE_MAP: dict[str, str] = {
    # ISO 27001
    "iso_27001": "iso_27001_2022",
    "iso27001": "iso_27001_2022",
    "iso_iec_27001": "iso_27001_2022",
    "iso 27001": "iso_27001_2022",
    "iso/iec 27001": "iso_27001_2022",
    "iso/iec 27001:2022": "iso_27001_2022",
    "iso 27001:2022": "iso_27001_2022",
    # ISO 41001
    "iso_41001": "iso_41001_2018",
    "iso41001": "iso_41001_2018",
    "iso 41001": "iso_41001_2018",
    "iso 41001:2018": "iso_41001_2018",
    # PCI DSS
    "pci_dss": "pci_dss_v4",
    "pci dss": "pci_dss_v4",
    "pci": "pci_dss_v4",
    "pci dss v4": "pci_dss_v4",
    "pci dss v4.0": "pci_dss_v4",
    "pci dss v4.0.1": "pci_dss_v4",
    # SWIFT
    "swift": "swift_cscf",
    "swift_cscf": "swift_cscf",
    "swift cscf": "swift_cscf",
    # COBIT
    "cobit": "cobit_2019",
    "cobit_2019": "cobit_2019",
    "cobit 2019": "cobit_2019",
    # DORA
    "dora": "dora",
    # HIPAA
    "hipaa": "hipaa",
    # GDPR
    "gdpr": "gdpr",
    # PDPL / KSA
    "pdpl": "pdpl_ksa",
    "pdpl_ksa": "pdpl_ksa",
    "saudi_pdpl": "pdpl_ksa",
    "ksa pdpl": "pdpl_ksa",
    # CIS Controls
    "cis": "cis_v8",
    "cis_controls": "cis_v8",
    "cis_v8": "cis_v8",
    "cis controls": "cis_v8",
    "cis controls v8": "cis_v8",
    # SOX
    "sox": "sox_itgc",
    "sox_itgc": "sox_itgc",
    "sox itgc": "sox_itgc",
    # SOC 2
    "soc2": "soc2",
    "soc_2": "soc2",
    "soc 2": "soc2",
    "soc 2 type ii": "soc2",
    # NIST CSF
    "nist_csf": "nist_csf_2",
    "nist csf": "nist_csf_2",
    "nist_csf_2.0": "nist_csf_2",
    "nist_csf_2": "nist_csf_2",
    "nist csf 2.0": "nist_csf_2",
    # ISO 22301
    "iso_22301": "iso_22301_2019",
    "iso22301": "iso_22301_2019",
    "bcm": "iso_22301_2019",
    "iso 22301": "iso_22301_2019",
    "iso 22301:2019": "iso_22301_2019",
    "iso/iec 22301": "iso_22301_2019",
    "iso/iec 22301:2019": "iso_22301_2019",
    # NIS 2
    "nis2": "nis2",
    "nis_2": "nis2",
    "nis 2": "nis2",
    "nis2 directive": "nis2",
}

# Artifact names that map to real platform data
PLATFORM_NATIVE_PATTERNS = {
    "risk register": "risk_register",
    "risk_register": "risk_register",
    "asset inventory": "asset_inventory",
    "asset register": "asset_inventory",
    "it asset": "asset_inventory",
    "enterprise risk register": "risk_register",
    "supply chain risk register": "risk_register",
}


def _get_platform_data_type(artifact_name: str) -> Optional[str]:
    name_lower = artifact_name.lower()
    for pattern, dtype in PLATFORM_NATIVE_PATTERNS.items():
        if pattern in name_lower:
            return dtype
    return None


def _ensure_catalog_seeded(db: Session) -> None:
    """Ensure artifact tables exist and seed ArtifactCatalogItem table once if empty."""
    # Create tables if they don't exist yet (existing tenant DBs may be missing them)
    try:
        from ..models import Base
        bind = db.get_bind()
        engine = getattr(bind, "engine", bind)
        Base.metadata.create_all(engine, checkfirst=True)
    except Exception:
        logger.exception("Failed to auto-create artifact tables")

    try:
        count = db.query(func.count(ArtifactCatalogItem.id)).scalar()
    except Exception:
        logger.exception("Cannot query artifact catalog table")
        return
    if count and count > 0:
        return
    if not _CATALOG_PATH.exists():
        logger.warning("Artifact catalog JSON not found at %s", _CATALOG_PATH)
        return
    with open(_CATALOG_PATH, encoding="utf-8") as f:
        catalog: dict = json.load(f)
    items: list[ArtifactCatalogItem] = []
    for fw_key, fw_data in catalog.items():
        fw_name = fw_data["name"]
        for art in fw_data["artifacts"]:
            stage_str: str = art.get("stage", "")
            stage_num = None
            if stage_str.startswith("Stage "):
                try:
                    stage_num = int(stage_str.split(" ")[1].rstrip(":"))
                except (IndexError, ValueError):
                    pass
            platform_type = _get_platform_data_type(art.get("name", ""))
            items.append(
                ArtifactCatalogItem(
                    framework_key=fw_key,
                    framework_name=fw_name,
                    artifact_id=art.get("artifact_id", ""),
                    stage=stage_str,
                    stage_number=stage_num,
                    name=art.get("name", ""),
                    artifact_type=art.get("type", ""),
                    control_ref=art.get("control_ref") or None,
                    mandatory=art.get("mandatory", False),
                    description=art.get("description") or None,
                    format=art.get("format") or None,
                    owner=art.get("owner") or None,
                    is_platform_native=platform_type is not None,
                    platform_data_type=platform_type,
                )
            )
    db.bulk_save_objects(items)
    db.commit()
    logger.info("Seeded %d artifact catalog items", len(items))


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ArtifactCatalogOut(BaseModel):
    id: int
    framework_key: str
    framework_name: str
    artifact_id: str
    stage: str
    stage_number: Optional[int]
    name: str
    artifact_type: str
    control_ref: Optional[str]
    mandatory: bool
    description: Optional[str]
    format: Optional[str]
    owner: Optional[str]
    is_platform_native: bool
    platform_data_type: Optional[str]

    class Config:
        from_attributes = True


class TenantArtifactOut(BaseModel):
    id: int
    tenant_id: int
    catalog_item_id: Optional[int]
    assessment_id: Optional[int]
    framework_key: str
    name: str
    artifact_type: str
    stage: Optional[str]
    control_ref: Optional[str]
    description: Optional[str]
    format: Optional[str]
    content: Optional[str]
    file_name: Optional[str]
    file_size: Optional[int]
    status: str
    assigned_to_id: Optional[int]
    assigned_to_name: Optional[str] = None
    created_by_id: Optional[int]
    created_by_name: Optional[str] = None
    is_platform_native: bool
    platform_data_type: Optional[str]
    platform_record_count: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class TenantArtifactCreate(BaseModel):
    catalog_item_id: Optional[int] = None
    assessment_id: Optional[int] = None
    framework_key: str
    name: str
    artifact_type: str
    stage: Optional[str] = None
    control_ref: Optional[str] = None
    description: Optional[str] = None
    format: Optional[str] = None
    content: Optional[str] = None
    assigned_to_id: Optional[int] = None
    is_platform_native: bool = False
    platform_data_type: Optional[str] = None


class TenantArtifactUpdate(BaseModel):
    name: Optional[str] = None
    artifact_type: Optional[str] = None
    stage: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    assigned_to_id: Optional[int] = None
    format: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_framework_key(raw: str) -> Optional[str]:
    normalized = raw.lower().strip()
    # Exact match first
    hit = ASSESSMENT_TYPE_MAP.get(normalized)
    if hit:
        return hit
    # Substring fallback: find the longest key that appears in the normalized name
    best = None
    best_len = 0
    for key, val in ASSESSMENT_TYPE_MAP.items():
        if key in normalized and len(key) > best_len:
            best = val
            best_len = len(key)
    return best


def _artifact_out(artifact: TenantArtifact) -> dict:
    assigned_name = None
    if artifact.assigned_to:
        u = artifact.assigned_to
        assigned_name = getattr(u, "display_name", None) or getattr(u, "username", None) or getattr(u, "email", None)
    created_name = None
    if artifact.created_by:
        u = artifact.created_by
        created_name = getattr(u, "display_name", None) or getattr(u, "username", None) or getattr(u, "email", None)
    return {
        "id": artifact.id,
        "tenant_id": artifact.tenant_id,
        "catalog_item_id": artifact.catalog_item_id,
        "assessment_id": artifact.assessment_id,
        "framework_key": artifact.framework_key,
        "name": artifact.name,
        "artifact_type": artifact.artifact_type,
        "stage": artifact.stage,
        "control_ref": artifact.control_ref,
        "description": artifact.description,
        "format": artifact.format,
        "content": artifact.content,
        "file_name": artifact.file_name,
        "file_size": artifact.file_size,
        "status": artifact.status,
        "assigned_to_id": artifact.assigned_to_id,
        "assigned_to_name": assigned_name,
        "created_by_id": artifact.created_by_id,
        "created_by_name": created_name,
        "is_platform_native": artifact.is_platform_native or False,
        "platform_data_type": artifact.platform_data_type,
        "platform_record_count": artifact.platform_record_count,
        "created_at": artifact.created_at,
        "updated_at": artifact.updated_at,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/catalog")
def get_catalog(
    framework_key: Optional[str] = Query(None),
    assessment_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List catalog items for a framework. Accept either framework_key or assessment_type."""
    _ensure_catalog_seeded(db)
    resolved_key = framework_key
    if not resolved_key and assessment_type:
        resolved_key = _resolve_framework_key(assessment_type)
    if not resolved_key:
        return {"framework_key": None, "framework_name": None, "items": [], "stages": []}

    items = (
        db.query(ArtifactCatalogItem)
        .filter(ArtifactCatalogItem.framework_key == resolved_key)
        .order_by(ArtifactCatalogItem.stage_number, ArtifactCatalogItem.artifact_id)
        .all()
    )
    stages = sorted({i.stage for i in items}, key=lambda s: (s.split(" ")[1] if s.startswith("Stage ") else s))
    fw_name = items[0].framework_name if items else resolved_key
    return {
        "framework_key": resolved_key,
        "framework_name": fw_name,
        "items": [
            {
                "id": i.id,
                "artifact_id": i.artifact_id,
                "stage": i.stage,
                "stage_number": i.stage_number,
                "name": i.name,
                "artifact_type": i.artifact_type,
                "control_ref": i.control_ref,
                "mandatory": i.mandatory,
                "description": i.description,
                "format": i.format,
                "owner": i.owner,
                "is_platform_native": i.is_platform_native,
                "platform_data_type": i.platform_data_type,
            }
            for i in items
        ],
        "stages": stages,
    }


@router.get("/platform-data/risk-register")
def get_platform_risk_register(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    risks = (
        db.query(Risk)
        .filter(Risk.tenant_id == tenant_id)
        .order_by(Risk.created_at.desc())
        .limit(200)
        .all()
    )
    return {
        "total": db.query(func.count(Risk.id)).filter(Risk.tenant_id == tenant_id).scalar(),
        "items": [
            {
                "id": r.id,
                "title": r.title,
                "category": r.category,
                "status": r.status,
                "inherent_score": r.inherent_score,
                "residual_score": r.residual_score,
                "created_at": r.created_at,
            }
            for r in risks
        ],
    }


@router.get("/platform-data/asset-inventory")
def get_platform_asset_inventory(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    assets = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tenant_id)
        .order_by(ITAsset.created_at.desc())
        .limit(200)
        .all()
    )
    return {
        "total": db.query(func.count(ITAsset.id)).filter(ITAsset.tenant_id == tenant_id).scalar(),
        "items": [
            {
                "id": a.id,
                "name": a.name,
                "asset_type": a.asset_type,
                "criticality": a.criticality,
                "status": a.status,
                "owner_name": a.owner_name,
                "created_at": a.created_at,
            }
            for a in assets
        ],
    }


@router.get("")
def list_artifacts(
    assessment_id: Optional[int] = Query(None),
    framework_key: Optional[str] = Query(None),
    assessment_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    resolved_key = framework_key
    if not resolved_key and assessment_type:
        resolved_key = _resolve_framework_key(assessment_type)

    q = db.query(TenantArtifact).filter(TenantArtifact.tenant_id == tenant_id)
    if assessment_id is not None:
        q = q.filter(TenantArtifact.assessment_id == assessment_id)
    if resolved_key:
        q = q.filter(TenantArtifact.framework_key == resolved_key)
    if status_filter:
        q = q.filter(TenantArtifact.status == status_filter)
    artifacts = q.order_by(TenantArtifact.created_at.desc()).all()
    return [_artifact_out(a) for a in artifacts]


@router.post("")
def create_artifact(
    payload: TenantArtifactCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_id = current_user.id

    # Fetch platform record count if native
    platform_count = None
    if payload.is_platform_native and payload.platform_data_type:
        try:
            if payload.platform_data_type == "risk_register":
                platform_count = db.query(func.count(Risk.id)).filter(Risk.tenant_id == tenant_id).scalar()
            elif payload.platform_data_type == "asset_inventory":
                platform_count = db.query(func.count(ITAsset.id)).filter(ITAsset.tenant_id == tenant_id).scalar()
        except Exception:
            pass

    artifact = TenantArtifact(
        tenant_id=tenant_id,
        catalog_item_id=payload.catalog_item_id,
        assessment_id=payload.assessment_id,
        framework_key=payload.framework_key,
        name=payload.name,
        artifact_type=payload.artifact_type,
        stage=payload.stage,
        control_ref=payload.control_ref,
        description=payload.description,
        format=payload.format,
        content=payload.content,
        status="draft",
        assigned_to_id=payload.assigned_to_id,
        created_by_id=user_id,
        is_platform_native=payload.is_platform_native,
        platform_data_type=payload.platform_data_type,
        platform_record_count=platform_count,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    return _artifact_out(artifact)


@router.get("/{artifact_id}")
def get_artifact(
    artifact_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    artifact = db.query(TenantArtifact).filter(
        TenantArtifact.id == artifact_id,
        TenantArtifact.tenant_id == tenant_id,
    ).first()
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    # Refresh platform count if native
    if artifact.is_platform_native and artifact.platform_data_type:
        try:
            if artifact.platform_data_type == "risk_register":
                artifact.platform_record_count = db.query(func.count(Risk.id)).filter(Risk.tenant_id == tenant_id).scalar()
            elif artifact.platform_data_type == "asset_inventory":
                artifact.platform_record_count = db.query(func.count(ITAsset.id)).filter(ITAsset.tenant_id == tenant_id).scalar()
            db.commit()
        except Exception:
            pass
    return _artifact_out(artifact)


@router.put("/{artifact_id}")
def update_artifact(
    artifact_id: int,
    payload: TenantArtifactUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    artifact = db.query(TenantArtifact).filter(
        TenantArtifact.id == artifact_id,
        TenantArtifact.tenant_id == tenant_id,
    ).first()
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    if payload.name is not None:
        artifact.name = payload.name
    if payload.artifact_type is not None:
        artifact.artifact_type = payload.artifact_type
    if payload.stage is not None:
        artifact.stage = payload.stage
    if payload.description is not None:
        artifact.description = payload.description
    if payload.content is not None:
        artifact.content = payload.content
    if payload.status is not None:
        artifact.status = payload.status
    if payload.assigned_to_id is not None:
        artifact.assigned_to_id = payload.assigned_to_id
    if payload.format is not None:
        artifact.format = payload.format

    db.commit()
    db.refresh(artifact)
    return _artifact_out(artifact)


@router.delete("/{artifact_id}")
def delete_artifact(
    artifact_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    artifact = db.query(TenantArtifact).filter(
        TenantArtifact.id == artifact_id,
        TenantArtifact.tenant_id == tenant_id,
    ).first()
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    db.delete(artifact)
    db.commit()
    return {"ok": True}


@router.post("/{artifact_id}/assign")
def assign_artifact(
    artifact_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    artifact = db.query(TenantArtifact).filter(
        TenantArtifact.id == artifact_id,
        TenantArtifact.tenant_id == tenant_id,
    ).first()
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    user = db.query(GRCUser).filter(GRCUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    artifact.assigned_to_id = user_id
    db.commit()
    db.refresh(artifact)
    return _artifact_out(artifact)
