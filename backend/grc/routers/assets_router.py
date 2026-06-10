import random
import csv
import io
import os
import json
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Request, Cookie
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from pydantic import BaseModel

from ..models import (
    ITAsset, AssetControlLink, AssetInternalControlLink, AssetRiskAssessment, AssetFrameworkControlLink,
    AssetEvidenceLink, NormalizedControl, FrameworkControl, Evidence, Risk, InternalControl,
    Vulnerability, VulnerabilityAssetLink, AssetSecurityComplianceSelection,
    SoftwareIdentifier,
    # Trajectory-map endpoint pulls these in to traverse Asset → Vuln → Control → Risk
    VulnerabilityControlLink, ParsedFrameworkControl,
    RiskAssetLink, RiskControlLink, RiskFrameworkControlLink,
    Framework,
    GRCUser, Tenant, TenantUser, get_db
)
from ..schemas import (
    ITAssetCreate, ITAssetUpdate, ITAssetResponse,
    AssetValuation, AssetControlLinkCreate, AssetRiskAssessmentResponse,
    AssetDashboard, AssetCoverage, MessageResponse,
    AssetFrameworkControlLinkCreate, AssetEvidenceLinkCreate,
    AssetDetailResponse, AssetCoverageAnalysis,
    LifecycleTransitionRequest,
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant, decode_token
# Phase 5.4 + 5.3 helpers — keep all logic out of the router body.
from ..services.asset_criticality import recompute_for_asset as recompute_asset_criticality
from ..services import asset_lifecycle
from ..services.asset_control_recommender import recommend_for_asset
# Per-database-per-tenant: the tenant DB *is* the active session, so tenant
# users are just GRCUser rows in the current request's session.

router = APIRouter(prefix="/assets", tags=["IT Assets"])

SECURITY_COMPLIANCE_BENCHMARK = "CIS_WS2012R2"
SECURITY_COMPLIANCE_CONTROLS_FILE = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "seed_data",
        "CIS",
        "CIS_WS2012R2_Controls.json",
    )
)


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def _security_compliance_sort_tokens(value: str) -> Tuple[Any, ...]:
    """Natural sort for control IDs with sub-points like 1.2.10."""
    chunks = re.findall(r"\d+|[^\d]+", str(value or ""))
    tokens: List[Any] = []
    for chunk in chunks:
        if chunk.isdigit():
            tokens.append(int(chunk))
        else:
            tokens.append(chunk.lower())
    return tuple(tokens)


@lru_cache(maxsize=1)
def _load_security_compliance_controls() -> Dict[str, Any]:
    if not os.path.exists(SECURITY_COMPLIANCE_CONTROLS_FILE):
        raise FileNotFoundError(
            f"Security compliance controls file not found: {SECURITY_COMPLIANCE_CONTROLS_FILE}"
        )
    with open(SECURITY_COMPLIANCE_CONTROLS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_asset_for_user(asset_id: int, current_user: GRCUser, db: Session) -> ITAsset:
    user_tenants = get_user_tenants(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants),
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )
    return asset


class SecurityComplianceSelectionRequest(BaseModel):
    control_ids: List[str]


@router.get("/tenant-users")
def get_tenant_users(
    http_request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all users in the current tenant DB for owner selection."""
    users = db.query(GRCUser).filter(GRCUser.is_active == True).all()
    return [
        {
            "id": u.id,
            "display_name": u.display_name or u.username,
            "email": u.email
        }
        for u in users
    ]


class CIARecommendationRequest(BaseModel):
    name: str
    description: Optional[str] = None
    asset_type: str
    vendor: Optional[str] = None
    location: Optional[str] = None
    criticality: Optional[str] = None


@router.post("/cia-recommendation")
def get_cia_recommendation(
    request: CIARecommendationRequest,
    current_user: GRCUser = Depends(require_auth)
):
    """Get AI-driven CIA rating recommendations based on asset details"""
    
    # Check if OpenAI API key is available
    openai_key = os.getenv("OPENAI_API_KEY")
    
    if not openai_key:
        # Fallback to rule-based recommendations
        return get_rule_based_cia_recommendation(request)
    
    try:
        import openai
        openai.api_key = openai_key
        
        # Build prompt for AI
        prompt = f"""Based on the following IT asset information, recommend appropriate CIA (Confidentiality, Integrity, Availability) ratings on a scale of 1-5 where:
- 1 = Very Low
- 2 = Low  
- 3 = Medium
- 4 = High
- 5 = Very High/Critical

Asset Details:
- Name: {request.name}
- Type: {request.asset_type}
- Description: {request.description or 'Not provided'}
- Vendor: {request.vendor or 'Not provided'}
- Location: {request.location or 'Not provided'}
- Business Criticality: {request.criticality or 'Not specified'}

Provide a brief 2-line recommendation explaining the suggested CIA ratings (Confidentiality, Integrity, Availability) and the specific numeric ratings.
Format: First line with explanation, second line with ratings in format "Recommended: C=X, I=Y, A=Z"
"""
        
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an IT security expert specializing in asset risk assessment and CIA triad ratings."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=200
        )
        
        recommendation_text = response.choices[0].message.content.strip()
        
        # Parse ratings from response
        lines = recommendation_text.split('\n')
        rating_line = next((line for line in lines if 'C=' in line and 'I=' in line and 'A=' in line), '')
        
        conf_rating = 3
        int_rating = 3
        avail_rating = 3
        
        if rating_line:
            import re
            conf_match = re.search(r'C=(\d)', rating_line)
            int_match = re.search(r'I=(\d)', rating_line)
            avail_match = re.search(r'A=(\d)', rating_line)
            
            if conf_match:
                conf_rating = int(conf_match.group(1))
            if int_match:
                int_rating = int(int_match.group(1))
            if avail_match:
                avail_rating = int(avail_match.group(1))
        
        # Format recommendation as 2 lines
        recommendation_lines = [line for line in lines if line.strip() and not line.startswith('Recommended:')][:2]
        if len(recommendation_lines) < 2 and rating_line:
            recommendation_lines.append(rating_line)
        
        recommendation = '\n'.join(recommendation_lines[:2])
        
        return {
            "recommendation": recommendation,
            "confidentiality_rating": conf_rating,
            "integrity_rating": int_rating,
            "availability_rating": avail_rating
        }
        
    except Exception as e:
        # Fallback to rule-based on error
        return get_rule_based_cia_recommendation(request)


def get_rule_based_cia_recommendation(request: CIARecommendationRequest):
    """Rule-based CIA recommendations when AI is unavailable"""
    
    asset_type = request.asset_type.lower()
    criticality = (request.criticality or 'medium').lower()
    
    # Base ratings
    conf_rating = 3
    int_rating = 3
    avail_rating = 3
    
    # Adjust by asset type
    if asset_type == 'data':
        conf_rating = 5
        int_rating = 5
        avail_rating = 4
        recommendation = "Data assets require maximum protection for confidentiality and integrity to prevent unauthorized access and corruption.\nRecommended: C=5, I=5, A=4"
    
    elif asset_type == 'application':
        conf_rating = 4
        int_rating = 4
        avail_rating = 4
        recommendation = "Business applications need high protection across all CIA dimensions to ensure secure and reliable operations.\nRecommended: C=4, I=4, A=4"
    
    elif asset_type == 'infrastructure':
        conf_rating = 3
        int_rating = 4
        avail_rating = 5
        recommendation = "Infrastructure assets prioritize availability and integrity to maintain operational continuity and system reliability.\nRecommended: C=3, I=4, A=5"
    
    elif asset_type == 'cloud':
        conf_rating = 4
        int_rating = 4
        avail_rating = 5
        recommendation = "Cloud resources require high availability and strong confidentiality controls due to shared responsibility model.\nRecommended: C=4, I=4, A=5"
    
    elif asset_type == 'third_party':
        conf_rating = 4
        int_rating = 3
        avail_rating = 3
        recommendation = "Third-party systems need elevated confidentiality controls due to external access and data sharing requirements.\nRecommended: C=4, I=3, A=3"
    
    else:
        recommendation = "Standard protection levels recommended based on general IT asset best practices and industry standards.\nRecommended: C=3, I=3, A=3"
    
    # Adjust by criticality
    if criticality == 'critical':
        conf_rating = min(5, conf_rating + 1)
        int_rating = min(5, int_rating + 1)
        avail_rating = min(5, avail_rating + 1)
    elif criticality == 'high':
        avail_rating = min(5, avail_rating + 1)
    elif criticality == 'low':
        conf_rating = max(1, conf_rating - 1)
        int_rating = max(1, int_rating - 1)
    
    return {
        "recommendation": recommendation,
        "confidentiality_rating": conf_rating,
        "integrity_rating": int_rating,
        "availability_rating": avail_rating
    }


@router.get("", response_model=List[ITAssetResponse])
def list_assets(
    tenant_id: Optional[int] = None,
    asset_type: Optional[str] = None,
    criticality: Optional[str] = None,
    owner_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    # Phase 5 list filters. All optional, default behavior unchanged.
    lifecycle_state: Optional[str] = None,
    data_classification: Optional[str] = None,
    internet_facing: Optional[bool] = None,
    stale_only: bool = Query(False, description="When true, return assets where last_seen_at is older than `stale_days` (default 30)."),
    stale_days: int = Query(30, ge=1, le=365),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(ITAsset).filter(ITAsset.tenant_id.in_(user_tenants))

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(ITAsset.tenant_id == tenant_id)
    if asset_type:
        query = query.filter(ITAsset.asset_type == asset_type)
    if criticality:
        query = query.filter(ITAsset.criticality == criticality)
    if owner_id:
        # Match the legacy `owner_id` OR the new Phase 5.2 `primary_owner_id`
        # so callers don't have to know which one is populated.
        query = query.filter(
            (ITAsset.owner_id == owner_id) | (ITAsset.primary_owner_id == owner_id)
        )
    if status_filter:
        query = query.filter(ITAsset.status == status_filter)
    if lifecycle_state:
        query = query.filter(ITAsset.lifecycle_state == lifecycle_state)
    if data_classification:
        query = query.filter(ITAsset.data_classification == data_classification)
    if internet_facing is not None:
        query = query.filter(ITAsset.internet_facing == internet_facing)
    if stale_only:
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(days=stale_days)
        # NULL last_seen_at is treated as "never seen", which is also stale —
        # match the UI semantics for the stale filter.
        query = query.filter(
            (ITAsset.last_seen_at == None) | (ITAsset.last_seen_at < cutoff)  # noqa: E711
        )

    assets = query.order_by(ITAsset.created_at.desc()).offset(skip).limit(limit).all()
    return assets


@router.post("", response_model=ITAssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset: ITAssetCreate,
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    # Validate any manual criticality override up-front so we don't
    # persist a half-valid row. Override requires both a valid bucket
    # AND a reason; the recompute call below will keep the override
    # bucket but still write the derived `criticality_score` for audit.
    from ..services.asset_criticality import is_valid_bucket
    manual_override = bool(asset.criticality_manual_override) and bool(asset.criticality)
    if manual_override:
        if not is_valid_bucket(asset.criticality):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="criticality override must be one of low/medium/high/critical",
            )
        if not (asset.criticality_override_reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="criticality_override_reason is required when overriding the derived criticality",
            )

    db_asset = ITAsset(
        tenant_id=tenant_id,
        name=asset.name,
        description=asset.description,
        asset_type=asset.asset_type,
        owner_id=asset.owner_id,
        owner_name=asset.owner_name,
        custodian=asset.custodian,
        host_name=asset.host_name,
        ip_address=asset.ip_address,
        # `criticality` is set here only when the user is overriding the
        # derived value. Otherwise it's left blank and the recompute
        # below fills it from the CIA + exposure inputs.
        criticality=(asset.criticality if manual_override else None),
        criticality_manual_override=manual_override,
        criticality_override_reason=asset.criticality_override_reason if manual_override else None,
        vendor=asset.vendor,
        location=asset.location,
        confidentiality_rating=asset.confidentiality_rating,
        integrity_rating=asset.integrity_rating,
        availability_rating=asset.availability_rating,
        valuation=asset.valuation,
        cde_environment=asset.cde_environment,
        # Phase 5.1 — Exposure metadata. None values are stored as NULL.
        internet_facing=bool(asset.internet_facing) if asset.internet_facing is not None else False,
        network_segment=asset.network_segment,
        data_classification=asset.data_classification,
        business_function=asset.business_function,
        compliance_scope=asset.compliance_scope if asset.compliance_scope is not None else [],
        # Phase 5.2 — Ownership chain.
        primary_owner_id=asset.primary_owner_id,
        secondary_owner_id=asset.secondary_owner_id,
        owning_team=asset.owning_team,
        owning_team_id=asset.owning_team_id,
        escalation_contact_id=asset.escalation_contact_id,
        business_owner_id=asset.business_owner_id,
        # Phase 5.3 — Lifecycle state (only the starting state on create;
        # subsequent moves go through /lifecycle-transition so the machine
        # validates them).
        lifecycle_state=(asset.lifecycle_state or "active"),
        # CIS Compliance tab — operator-supplied OS profile so the strict
        # matcher resolves a benchmark immediately without needing a
        # Connect Wizard handshake first.
        os_family=getattr(asset, "os_family", None),
        os_version=getattr(asset, "os_version", None),
        os_normalized=getattr(asset, "os_normalized", None) or getattr(asset, "os_family", None),
        os_build=getattr(asset, "os_build", None),
        os_edition=getattr(asset, "os_edition", None),
    )

    # Auto-resolve owner_name from owner_id if not provided
    if asset.owner_id and not asset.owner_name:
        owner = db.query(GRCUser).filter(GRCUser.id == asset.owner_id).first()
        if owner:
            db_asset.owner_name = owner.display_name or owner.username

    # ISO 27005 derived criticality (bucket + 0-10 score). When the row
    # carries `criticality_manual_override=True`, the bucket is preserved
    # but the score is still re-derived from the inputs so the audit log
    # shows what the system would have chosen.
    recompute_asset_criticality(db_asset)

    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset


@router.get("/dashboard", response_model=AssetDashboard)
def get_asset_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return AssetDashboard(
            total_assets=0,
            by_type={},
            by_criticality={},
            by_status={},
            high_value_assets=0,
            assets_needing_assessment=0
        )
    
    query = db.query(ITAsset).filter(ITAsset.tenant_id.in_(user_tenants))
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(ITAsset.tenant_id == tenant_id)
    
    assets = query.all()
    total = len(assets)
    
    by_type = {}
    by_criticality = {}
    by_status = {}
    high_value_assets = 0
    assets_needing_assessment = 0
    
    for asset in assets:
        by_type[asset.asset_type] = by_type.get(asset.asset_type, 0) + 1
        by_criticality[asset.criticality] = by_criticality.get(asset.criticality, 0) + 1
        by_status[asset.status] = by_status.get(asset.status, 0) + 1
        
        if asset.criticality in ["high", "critical"]:
            high_value_assets += 1
        
        if not asset.risk_assessments:
            assets_needing_assessment += 1
    
    return AssetDashboard(
        total_assets=total,
        by_type=by_type,
        by_criticality=by_criticality,
        by_status=by_status,
        high_value_assets=high_value_assets,
        assets_needing_assessment=assets_needing_assessment
    )


@router.get("/coverage", response_model=AssetCoverage)
def get_asset_coverage(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return AssetCoverage(
            total_assets=0,
            assets_with_controls=0,
            coverage_percentage=0.0,
            by_criticality={}
        )
    
    query = db.query(ITAsset).options(joinedload(ITAsset.control_links)).filter(ITAsset.tenant_id.in_(user_tenants))
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(ITAsset.tenant_id == tenant_id)
    
    assets = query.all()
    total = len(assets)
    assets_with_controls = sum(1 for a in assets if a.control_links)
    
    coverage_by_criticality = {}
    for asset in assets:
        if asset.criticality not in coverage_by_criticality:
            coverage_by_criticality[asset.criticality] = {
                "total": 0,
                "with_controls": 0,
                "coverage_percentage": 0.0
            }
        coverage_by_criticality[asset.criticality]["total"] += 1
        if asset.control_links:
            coverage_by_criticality[asset.criticality]["with_controls"] += 1
    
    for crit, data in coverage_by_criticality.items():
        if data["total"] > 0:
            data["coverage_percentage"] = round(
                (data["with_controls"] / data["total"]) * 100, 2
            )
    
    return AssetCoverage(
        total_assets=total,
        assets_with_controls=assets_with_controls,
        coverage_percentage=round((assets_with_controls / total) * 100, 2) if total > 0 else 0.0,
        by_criticality=coverage_by_criticality
    )


# ─── Criticality helper endpoints ─────────────────────────────────
# Two helpers powering the new IT-Asset form:
#   * `/criticality/business-functions` — catalogue of categories the
#     form's "Business function" dropdown should render. Grouped, with
#     each entry's `high_impact` flag exposed so the UI can show a
#     small "boosts criticality" tag next to those options.
#   * `/criticality/preview` — pure compute. Lets the form show the
#     calculated bucket + 0-10 score live as the user fills the
#     inputs, before they save. No database writes.

@router.get("/criticality/business-functions")
def list_business_functions(
    current_user: GRCUser = Depends(require_auth),
):
    from ..services.asset_criticality import list_business_function_categories
    return {"items": list_business_function_categories()}


class CriticalityPreviewRequest(BaseModel):
    confidentiality_rating: Optional[int] = None
    integrity_rating: Optional[int] = None
    availability_rating: Optional[int] = None
    data_classification: Optional[str] = None
    internet_facing: Optional[bool] = None
    business_function: Optional[str] = None


@router.post("/criticality/preview")
def preview_criticality(
    payload: CriticalityPreviewRequest,
    current_user: GRCUser = Depends(require_auth),
):
    from ..services.asset_criticality import compute_criticality_score, score_to_bucket
    score = compute_criticality_score(
        confidentiality_rating=payload.confidentiality_rating,
        integrity_rating=payload.integrity_rating,
        availability_rating=payload.availability_rating,
        data_classification=payload.data_classification,
        internet_facing=payload.internet_facing,
        business_function=payload.business_function,
    )
    return {
        "score": score,
        "bucket": score_to_bucket(score),
    }


ASSET_TEMPLATE_COLUMNS = [
    # ── Identity ────────────────────────────────────────────────────
    ("name",                   "Asset Name (Required)", "ERP System"),
    ("description",            "Description", "Enterprise Resource Planning system for finance and operations"),
    ("asset_type",             "Asset Type (Required: application/infrastructure/data/cloud/third_party)", "application"),
    ("host_name",              "Host Name / FQDN", "erp-prod-01.example.com"),
    ("ip_address",             "IP Address", "10.20.30.40"),
    ("vendor",                 "Vendor", "SAP"),
    ("location",               "Location", "Primary Data Center"),
    # ── CIA ratings (drive criticality) ─────────────────────────────
    ("confidentiality_rating", "Confidentiality Rating (1-5)", "4"),
    ("integrity_rating",       "Integrity Rating (1-5)", "5"),
    ("availability_rating",    "Availability Rating (1-5)", "5"),
    # ── Exposure metadata (drive criticality) ───────────────────────
    ("data_classification",    "Data Classification (public/internal/confidential/restricted)", "confidential"),
    ("internet_facing",        "Internet Facing (true/false)", "true"),
    ("business_function",      "Business Function (category id — see catalogue, e.g. payment_processing / authentication_iam / customer_data / other)", "payment_processing"),
    ("network_segment",        "Network Segment", "dmz"),
    ("compliance_scope",       "Compliance Scope (comma-separated framework short codes, e.g. PCI-DSS,SWIFT)", "PCI-DSS,SWIFT"),
    # ── Ownership ───────────────────────────────────────────────────
    ("owner_name",             "Owner Display Name", "Jane Doe"),
    ("owning_team",            "Owning Team Name", "Payments Engineering"),
    # ── Business + lifecycle ────────────────────────────────────────
    ("valuation",              "Valuation (USD)", "500000"),
    ("status",                 "Status (active/inactive/decommissioned)", "active"),
    ("lifecycle_state",        "Lifecycle State (planned/active/maintenance/decommissioned/retired)", "active"),
    ("cde_environment",        "CDE Environment (true/false)", "false"),
    # ── Optional criticality override ───────────────────────────────
    ("criticality",            "Criticality OVERRIDE (low/medium/high/critical) — LEAVE BLANK to let the system calculate from CIA + exposure inputs above", ""),
    ("criticality_override_reason", "Reason for override (required if Criticality column is filled)", ""),
]


@router.get("/template/download")
def download_asset_template(
    current_user: GRCUser = Depends(require_auth)
):
    """Download CSV template for bulk asset import"""
    output = io.StringIO()
    writer = csv.writer(output)
    
    headers = [col[0] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(headers)
    
    descriptions = [col[1] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(descriptions)
    
    examples = [col[2] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(examples)
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=it_assets_template.csv"}
    )


@router.post("/import/upload")
async def upload_assets_file(
    file: UploadFile = File(...),
    tenant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Upload CSV or Excel file to bulk import IT assets"""
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided"
        )
    
    filename = file.filename.lower()
    if not (filename.endswith('.csv') or filename.endswith('.xlsx') or filename.endswith('.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be CSV or Excel format (.csv, .xlsx, .xls)"
        )
    
    content = await file.read()
    rows = []
    
    try:
        if filename.endswith('.csv'):
            text_content = content.decode('utf-8')
            reader = csv.DictReader(io.StringIO(text_content))
            rows = list(reader)
        else:
            from openpyxl import load_workbook
            wb = load_workbook(filename=io.BytesIO(content), read_only=True)
            ws = wb.active
            
            headers = []
            for idx, row in enumerate(ws.iter_rows(values_only=True)):
                if idx == 0:
                    headers = [str(cell).strip() if cell else "" for cell in row]
                    continue
                if idx == 1:
                    first_cell = str(row[0]).lower() if row[0] else ""
                    if "required" in first_cell or "description" in first_cell or "name" in first_cell:
                        continue
                
                if not any(row):
                    continue
                    
                row_dict = {}
                for col_idx, cell in enumerate(row):
                    if col_idx < len(headers) and headers[col_idx]:
                        row_dict[headers[col_idx]] = cell
                rows.append(row_dict)
            wb.close()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error parsing file: {str(e)}"
        )
    
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No data rows found in file"
        )
    
    valid_asset_types = ["application", "infrastructure", "data", "cloud", "third_party"]
    valid_criticality = ["low", "medium", "high", "critical"]
    valid_status = ["active", "inactive", "decommissioned"]
    valid_data_class = ["public", "internal", "confidential", "restricted"]
    valid_lifecycle = ["planned", "active", "maintenance", "decommissioned", "retired"]

    from ..services.asset_criticality import recompute_for_asset, is_valid_bucket

    imported = []
    errors = []

    def _bool(val) -> bool:
        if val is None:
            return False
        return str(val).strip().lower() in ("true", "yes", "1", "y")

    def parse_int(val, min_val=None, max_val=None):
        if val is None or val == "":
            return None
        try:
            v = int(float(str(val)))
            if min_val is not None and v < min_val:
                return min_val
            if max_val is not None and v > max_val:
                return max_val
            return v
        except Exception:
            return None

    def parse_float(val):
        if val is None or val == "":
            return None
        try:
            return float(str(val).replace(",", ""))
        except Exception:
            return None

    def parse_str(val) -> Optional[str]:
        if val is None:
            return None
        s = str(val).strip()
        return s or None

    def parse_csv_list(val):
        if val is None:
            return None
        raw = str(val).strip()
        if not raw:
            return None
        return [item.strip() for item in raw.split(",") if item.strip()]

    for idx, row in enumerate(rows, start=1):
        row_num = idx + 2

        name = str(row.get("name", "")).strip() if row.get("name") else ""
        if not name:
            errors.append({"row": row_num, "error": "Name is required"})
            continue

        asset_type = str(row.get("asset_type", "")).strip().lower() if row.get("asset_type") else ""
        if not asset_type:
            errors.append({"row": row_num, "error": "Asset type is required"})
            continue
        if asset_type not in valid_asset_types:
            errors.append({"row": row_num, "error": f"Invalid asset_type '{asset_type}'. Must be one of: {', '.join(valid_asset_types)}"})
            continue

        # Optional manual override of the derived criticality bucket. If the
        # cell is empty, we let `recompute_for_asset` derive it from the CIA
        # ratings + exposure metadata.
        override_raw = parse_str(row.get("criticality"))
        override_reason = parse_str(row.get("criticality_override_reason"))
        manual_override = False
        criticality_value: Optional[str] = None
        if override_raw:
            override_norm = override_raw.lower()
            if override_norm not in valid_criticality:
                errors.append({
                    "row": row_num,
                    "error": (
                        f"Invalid criticality override '{override_raw}'. Must be one "
                        f"of {valid_criticality} or blank to let the system compute it."
                    ),
                })
                continue
            if not override_reason:
                errors.append({
                    "row": row_num,
                    "error": "When 'criticality' is set the 'criticality_override_reason' column is required.",
                })
                continue
            manual_override = True
            criticality_value = override_norm

        asset_status_raw = parse_str(row.get("status"))
        asset_status = asset_status_raw.lower() if asset_status_raw else "active"
        if asset_status not in valid_status:
            asset_status = "active"

        data_classification_raw = parse_str(row.get("data_classification"))
        data_classification = data_classification_raw.lower() if data_classification_raw else None
        if data_classification and data_classification not in valid_data_class:
            errors.append({
                "row": row_num,
                "error": f"Invalid data_classification '{data_classification_raw}'. Must be one of {valid_data_class}.",
            })
            continue

        lifecycle_raw = parse_str(row.get("lifecycle_state"))
        lifecycle_state = lifecycle_raw.lower() if lifecycle_raw else None
        if lifecycle_state and lifecycle_state not in valid_lifecycle:
            errors.append({
                "row": row_num,
                "error": f"Invalid lifecycle_state '{lifecycle_raw}'. Must be one of {valid_lifecycle}.",
            })
            continue

        try:
            asset = ITAsset(
                tenant_id=tenant_id,
                name=name,
                description=parse_str(row.get("description")),
                asset_type=asset_type,
                host_name=parse_str(row.get("host_name")),
                ip_address=parse_str(row.get("ip_address")),
                vendor=parse_str(row.get("vendor")),
                location=parse_str(row.get("location")),
                owner_name=parse_str(row.get("owner_name")),
                owning_team=parse_str(row.get("owning_team")),
                # CIA — drive the derived criticality.
                confidentiality_rating=parse_int(row.get("confidentiality_rating"), 1, 5),
                integrity_rating=parse_int(row.get("integrity_rating"), 1, 5),
                availability_rating=parse_int(row.get("availability_rating"), 1, 5),
                # Exposure metadata — also drive the derived criticality.
                data_classification=data_classification,
                internet_facing=_bool(row.get("internet_facing")) if parse_str(row.get("internet_facing")) is not None else None,
                business_function=parse_str(row.get("business_function")),
                network_segment=parse_str(row.get("network_segment")),
                compliance_scope=parse_csv_list(row.get("compliance_scope")) or [],
                # Business + lifecycle.
                valuation=parse_float(row.get("valuation")),
                status=asset_status,
                lifecycle_state=lifecycle_state or "active",
                cde_environment=_bool(row.get("cde_environment")),
                # Override (if present, validated above).
                criticality=criticality_value,
                criticality_manual_override=manual_override,
                criticality_override_reason=override_reason if manual_override else None,
            )
            # Always run the derived-criticality calculation. When
            # `criticality_manual_override` is True, the service keeps
            # the user's bucket but still writes the audit score; when
            # False, both the bucket and score are system-computed.
            recompute_for_asset(asset)
            db.add(asset)
            db.flush()
            imported.append({"id": asset.id, "name": asset.name})
        except Exception as e:
            errors.append({"row": row_num, "error": str(e)})

    db.commit()
    
    imported_count = len(imported)
    error_count = len(errors)
    error_messages = [f"Row {e['row']}: {e['error']}" for e in errors[:20]]
    
    return {
        "success": True,
        "imported": imported_count,
        "total_rows": len(rows),
        "errors": error_messages,
        "total_errors": error_count,
        "message": f"Successfully imported {imported_count} assets" + (f" with {error_count} errors" if error_count > 0 else "")
    }


@router.get("/{asset_id}", response_model=dict)
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.risk_links),
        joinedload(ITAsset.risk_assessments)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    latest_assessment = None
    if asset.risk_assessments:
        latest = sorted(asset.risk_assessments, key=lambda x: x.assessment_date, reverse=True)[0]
        latest_assessment = {
            "id": latest.id,
            "assessment_date": latest.assessment_date.isoformat(),
            "risk_score": latest.risk_score,
            "coverage_percentage": latest.coverage_percentage,
            "gaps": latest.gaps,
            "assessor_id": latest.assessor_id
        }
    
    return {
        "id": asset.id,
        "tenant_id": asset.tenant_id,
        "name": asset.name,
        "description": asset.description,
        "asset_type": asset.asset_type,
        "owner_id": asset.owner_id,
        "custodian": asset.custodian,
        "host_name": asset.host_name,
        "ip_address": asset.ip_address,
        "criticality": asset.criticality,
        "confidentiality_rating": asset.confidentiality_rating,
        "integrity_rating": asset.integrity_rating,
        "availability_rating": asset.availability_rating,
        "valuation": asset.valuation,
        "vendor": asset.vendor,
        "location": asset.location,
        "status": asset.status,
        "cde_environment": asset.cde_environment or False,
        "created_at": asset.created_at.isoformat(),
        # Phase 5 operational context fields.
        "internet_facing": bool(asset.internet_facing) if asset.internet_facing is not None else False,
        "network_segment": asset.network_segment,
        "data_classification": asset.data_classification,
        "business_function": asset.business_function,
        "compliance_scope": asset.compliance_scope or [],
        "primary_owner_id": asset.primary_owner_id,
        "secondary_owner_id": asset.secondary_owner_id,
        "owning_team": asset.owning_team,
        "escalation_contact_id": asset.escalation_contact_id,
        "business_owner_id": asset.business_owner_id,
        "lifecycle_state": asset.lifecycle_state,
        "decommissioned_at": asset.decommissioned_at.isoformat() if asset.decommissioned_at else None,
        "retirement_reason": asset.retirement_reason,
        "replacement_asset_id": asset.replacement_asset_id,
        "criticality_score": asset.criticality_score,
        "last_seen_at": asset.last_seen_at.isoformat() if asset.last_seen_at else None,
        "last_seen_source": asset.last_seen_source,
        "linked_controls": [link.normalized_control_id for link in asset.control_links],
        "linked_risks": [link.risk_id for link in asset.risk_links],
        "latest_assessment": latest_assessment
    }


@router.put("/{asset_id}", response_model=ITAssetResponse)
def update_asset(
    asset_id: int,
    asset_update: ITAssetUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    update_data = asset_update.model_dump(exclude_unset=True)

    # Validate any criticality override before applying any fields so we
    # don't half-update the row.
    from ..services.asset_criticality import is_valid_bucket
    if update_data.get("criticality_manual_override"):
        override_bucket = update_data.get("criticality") or asset.criticality
        override_reason = (
            update_data.get("criticality_override_reason")
            or asset.criticality_override_reason
            or ""
        )
        if not is_valid_bucket(override_bucket):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="criticality override must be one of low/medium/high/critical",
            )
        if not str(override_reason).strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="criticality_override_reason is required when overriding the derived criticality",
            )

    for field, value in update_data.items():
        # ── Risk Posture v2 column rename translation ───────────────────
        # The wire field `operational_dependency` (v2 spec) maps to the
        # asset column `op_dep_business_impact` (renamed to avoid
        # collision with the Criticality-Assessments Integer column of
        # the same name). Without this mapping, the Save button on the
        # Risk Posture asset detail page would silently no-op.
        if field == "operational_dependency":
            setattr(asset, "op_dep_business_impact", value)
            continue
        setattr(asset, field, value)

    # Auto-derive os_normalized from os_family when the caller set the
    # family but didn't supply a normalized key. Lets the operator pick
    # "windows" from a dropdown without having to know the canonical
    # normalized_key. The family-fallback BenchmarkOsMapping (e.g.
    # pattern='windows' → Win 11 v5.0.1) picks it up from there.
    if (
        "os_family" in update_data
        and update_data.get("os_family")
        and not asset.os_normalized
    ):
        asset.os_normalized = update_data["os_family"]

    # When the caller explicitly turns the override OFF, clear the
    # reason so we don't keep stale audit text around. The recompute
    # below will overwrite `criticality` with the derived bucket.
    if update_data.get("criticality_manual_override") is False:
        asset.criticality_override_reason = None

    # Auto-resolve owner_name when owner_id is updated without owner_name
    if 'owner_id' in update_data and 'owner_name' not in update_data and update_data.get('owner_id'):
        owner = db.query(GRCUser).filter(GRCUser.id == update_data['owner_id']).first()
        if owner:
            asset.owner_name = owner.display_name or owner.username

    # Recompute derived criticality whenever any of its inputs changed
    # OR the override flag was toggled. The recompute respects
    # `criticality_manual_override` so it never clobbers an active override.
    _criticality_inputs = {
        "confidentiality_rating", "integrity_rating", "availability_rating",
        "data_classification", "internet_facing", "business_function",
        "criticality_manual_override", "criticality",
    }
    if _criticality_inputs.intersection(update_data.keys()):
        recompute_asset_criticality(asset)

    db.commit()
    db.refresh(asset)
    return asset


@router.post("/{asset_id}/lifecycle-transition", response_model=dict)
def transition_asset_lifecycle(
    asset_id: int,
    payload: LifecycleTransitionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Phase 5.3 — Move an asset through the lifecycle state machine.

    States:  planned → active ↔ maintenance → decommissioned → retired.
    Decommissioning or retiring auto-closes the asset's open vulnerabilities
    (best-effort; the transition still succeeds if the close fails).
    """
    user_tenants = get_user_tenants(current_user, db)

    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants),
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    # If a replacement is named, ensure it exists in a tenant the user can see.
    if payload.replacement_asset_id is not None:
        replacement = db.query(ITAsset).filter(
            ITAsset.id == payload.replacement_asset_id,
            ITAsset.tenant_id.in_(user_tenants),
        ).first()
        if not replacement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Replacement asset not found",
            )
        if replacement.id == asset.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An asset cannot be its own replacement",
            )

    try:
        summary = asset_lifecycle.transition(
            db,
            asset,
            payload.to_state,
            reason=payload.reason,
            replacement_asset_id=payload.replacement_asset_id,
            actor_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    db.commit()
    db.refresh(asset)

    # Stamp into the response for the UI; include the new asset state so the
    # frontend can refresh without a follow-up GET.
    summary["asset_id"] = asset.id
    summary["lifecycle_state"] = asset.lifecycle_state
    summary["retirement_reason"] = asset.retirement_reason
    summary["replacement_asset_id"] = asset.replacement_asset_id
    return summary


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    db.delete(asset)
    db.commit()
    return None


@router.post("/{asset_id}/valuation", response_model=ITAssetResponse)
def update_asset_valuation(
    asset_id: int,
    valuation: AssetValuation,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    asset.valuation = valuation.valuation
    if valuation.confidentiality_rating is not None:
        asset.confidentiality_rating = valuation.confidentiality_rating
    if valuation.integrity_rating is not None:
        asset.integrity_rating = valuation.integrity_rating
    if valuation.availability_rating is not None:
        asset.availability_rating = valuation.availability_rating
    
    db.commit()
    db.refresh(asset)
    return asset


@router.post("/{asset_id}/controls", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_control(
    asset_id: int,
    link: AssetControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    control = db.query(NormalizedControl).filter(
        NormalizedControl.id == link.normalized_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    existing = db.query(AssetControlLink).filter(
        AssetControlLink.asset_id == asset_id,
        AssetControlLink.normalized_control_id == link.normalized_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetControlLink(
        asset_id=asset_id,
        normalized_control_id=link.normalized_control_id
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Control linked successfully")


@router.post("/{asset_id}/assess", response_model=AssetRiskAssessmentResponse)
def assess_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.internal_control_links),
        joinedload(ITAsset.framework_control_links)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    num_controls = len(asset.control_links) + len(asset.internal_control_links) + len(asset.framework_control_links)
    coverage = min(num_controls * 10, 100)
    
    base_risk = 5
    if asset.criticality == "critical":
        base_risk = 8
    elif asset.criticality == "high":
        base_risk = 6
    elif asset.criticality == "low":
        base_risk = 3
    
    risk_score = max(1, base_risk - (num_controls * 0.5))
    
    gaps = {
        "missing_controls": max(0, 10 - num_controls),
        "recommendations": []
    }
    if num_controls < 3:
        gaps["recommendations"].append("Add more controls to improve coverage")
    if asset.criticality in ["high", "critical"] and num_controls < 5:
        gaps["recommendations"].append("Critical assets should have at least 5 controls")
    
    assessment = AssetRiskAssessment(
        asset_id=asset_id,
        risk_score=round(risk_score, 2),
        coverage_percentage=float(coverage),
        gaps=gaps,
        assessor_id=current_user.id
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


@router.get("/{asset_id}/assessment", response_model=AssetRiskAssessmentResponse)
def get_latest_assessment(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    assessment = db.query(AssetRiskAssessment).filter(
        AssetRiskAssessment.asset_id == asset_id
    ).order_by(AssetRiskAssessment.assessment_date.desc()).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessment found for this asset"
        )
    
    return assessment


@router.get("/{asset_id}/detail", response_model=AssetDetailResponse)
def get_asset_detail(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.internal_control_links),
        joinedload(ITAsset.risk_links),
        joinedload(ITAsset.risk_assessments),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.evidence_links),
        joinedload(ITAsset.owner)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    linked_controls = []
    for link in asset.control_links:
        control = db.query(NormalizedControl).filter(NormalizedControl.id == link.normalized_control_id).first()
        if control:
            linked_controls.append({
                "id": link.id,
                "control_id": control.id,
                "code": control.code,
                "name": control.name
            })
    
    linked_internal_controls = []
    for link in asset.internal_control_links:
        ctrl = db.query(InternalControl).filter(InternalControl.id == link.internal_control_id).first()
        if ctrl:
            linked_internal_controls.append({
                "id": link.id,
                "internal_control_id": ctrl.id,
                "code": ctrl.control_id,
                "name": ctrl.name,
                "category": ctrl.category,
                "coverage_status": link.coverage_status
            })

    linked_framework_controls = []
    for link in asset.framework_control_links:
        fc = db.query(FrameworkControl).filter(FrameworkControl.id == link.framework_control_id).first()
        if fc:
            linked_framework_controls.append({
                "id": link.id,
                "framework_control_id": fc.id,
                "code": fc.code,
                "name": fc.name,
                "coverage_status": link.coverage_status,
                "notes": link.notes
            })
    
    linked_risks = []
    for link in asset.risk_links:
        risk = db.query(Risk).filter(
            Risk.id == link.risk_id,
            Risk.tenant_id.in_(user_tenants)
        ).first()
        if risk:
            linked_risks.append({
                "risk_id": risk.id,
                "title": risk.title,
                "status": risk.status,
                "inherent_score": risk.inherent_score,
                "residual_score": risk.residual_score,
            })
    
    linked_evidence = []
    for link in asset.evidence_links:
        ev = db.query(Evidence).filter(Evidence.id == link.evidence_id).first()
        if ev:
            linked_evidence.append({
                "id": link.id,
                "evidence_id": ev.id,
                "name": ev.name,
                "relationship_type": link.relationship_type
            })

    linked_vulnerabilities = []
    vuln_links = db.query(VulnerabilityAssetLink).options(
        joinedload(VulnerabilityAssetLink.vulnerability)
    ).join(Vulnerability).filter(
        VulnerabilityAssetLink.asset_id == asset_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).all()
    for link in vuln_links:
        vuln = link.vulnerability
        if vuln:
            linked_vulnerabilities.append({
                "link_id": link.id,
                "vulnerability_id": vuln.id,
                "vuln_id": vuln.vuln_id,
                "title": vuln.title,
                "severity": vuln.severity,
                "status": vuln.status,
                "impact_on_asset": link.impact_on_asset,
                "notes": link.notes,
                "created_at": link.created_at,
                # Provenance — Auto badge + source chip on the UI.
                "link_source": getattr(link, "link_source", "manual") or "manual",
                "auto_linked": bool(getattr(link, "auto_linked", False)),
            })
    
    risk_assessments = []
    for assessment in asset.risk_assessments:
        risk_assessments.append({
            "id": assessment.id,
            "assessment_date": assessment.assessment_date.isoformat(),
            "risk_score": assessment.risk_score,
            "coverage_percentage": assessment.coverage_percentage,
            "gaps": assessment.gaps
        })
    
    total_controls = len(linked_controls) + len(linked_internal_controls) + len(linked_framework_controls)
    coverage = min(total_controls * 10, 100) if total_controls > 0 else 0

    # Phase 5.2 — Resolve owner-chain display names with a single batch query
    # so the response carries human-readable labels for the UI.
    owner_ids = {
        i for i in (
            asset.primary_owner_id, asset.secondary_owner_id,
            asset.escalation_contact_id, asset.business_owner_id,
        ) if i is not None
    }
    owner_names: Dict[int, str] = {}
    if owner_ids:
        for u in db.query(GRCUser).filter(GRCUser.id.in_(owner_ids)).all():
            owner_names[u.id] = u.display_name or u.username

    replacement_name: Optional[str] = None
    if asset.replacement_asset_id is not None:
        rep = db.query(ITAsset.name).filter(ITAsset.id == asset.replacement_asset_id).first()
        replacement_name = rep[0] if rep else None

    # Owning team name — prefer FK, fall back to the legacy free-text field
    # so old rows still render something useful.
    owning_team_name: Optional[str] = asset.owning_team
    if asset.owning_team_id is not None:
        try:
            from ..models import Team
            t = db.query(Team.name).filter(Team.id == asset.owning_team_id).first()
            if t and t[0]:
                owning_team_name = t[0]
        except Exception:
            pass

    return AssetDetailResponse(
        id=asset.id,
        tenant_id=asset.tenant_id,
        name=asset.name,
        description=asset.description,
        asset_type=asset.asset_type,
        owner_id=asset.owner_id,
        owner_name=asset.owner.display_name if asset.owner else None,
        custodian=asset.custodian,
        host_name=asset.host_name,
        ip_address=asset.ip_address,
        criticality=asset.criticality,
        confidentiality_rating=asset.confidentiality_rating,
        integrity_rating=asset.integrity_rating,
        availability_rating=asset.availability_rating,
        valuation=asset.valuation,
        vendor=asset.vendor,
        location=asset.location,
        status=asset.status,
        created_at=asset.created_at,
        linked_controls=linked_controls,
        linked_internal_controls=linked_internal_controls,
        linked_framework_controls=linked_framework_controls,
        linked_risks=linked_risks,
        linked_evidence=linked_evidence,
        linked_vulnerabilities=linked_vulnerabilities,
        risk_assessments=risk_assessments,
        coverage_percentage=float(coverage),
        # Phase 5 fields.
        internet_facing=bool(asset.internet_facing) if asset.internet_facing is not None else False,
        network_segment=asset.network_segment,
        data_classification=asset.data_classification,
        business_function=asset.business_function,
        compliance_scope=asset.compliance_scope or [],
        primary_owner_id=asset.primary_owner_id,
        primary_owner_name=owner_names.get(asset.primary_owner_id) if asset.primary_owner_id else None,
        secondary_owner_id=asset.secondary_owner_id,
        secondary_owner_name=owner_names.get(asset.secondary_owner_id) if asset.secondary_owner_id else None,
        owning_team=asset.owning_team,
        owning_team_id=asset.owning_team_id,
        owning_team_name=owning_team_name,
        escalation_contact_id=asset.escalation_contact_id,
        escalation_contact_name=owner_names.get(asset.escalation_contact_id) if asset.escalation_contact_id else None,
        business_owner_id=asset.business_owner_id,
        business_owner_name=owner_names.get(asset.business_owner_id) if asset.business_owner_id else None,
        lifecycle_state=asset.lifecycle_state,
        decommissioned_at=asset.decommissioned_at,
        retirement_reason=asset.retirement_reason,
        replacement_asset_id=asset.replacement_asset_id,
        replacement_asset_name=replacement_name,
        criticality_score=asset.criticality_score,
        last_seen_at=asset.last_seen_at,
        last_seen_source=asset.last_seen_source,
    )


@router.get("/{asset_id}/trajectory")
def get_asset_trajectory(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Asset → Vulnerability → linked Risk trajectory map data.

    Three-column flow for the asset detail page diagram:

       Asset ──(VulnerabilityAssetLink)──▶ Vulnerabilities
       Vuln  ──(VulnerabilityControlLink × RiskFrameworkControlLink|RiskControlLink)──▶ Risk
       Asset ──(RiskAssetLink, direct)──▶ Risk

    Controls sit *between* a vuln and a risk in the data model (and we
    auto-CWE-map them), but the user-facing graph collapses that bridge into
    a single edge with the bridge-control list attached as edge metadata.
    Two reasons: (a) auto-mapped vulns point at `parsed_framework_control_id`
    rows while risks can only link to `framework_control_id` / `normalized_
    control_id`, so middle-column control nodes would frequently dead-end
    with no outgoing edge; (b) the user's mental model is "this vuln drives
    this risk" — controls are the mechanism, not the destination.
    """
    asset = _get_asset_for_user(asset_id, current_user, db)

    # ── 1. Vulnerabilities affecting this asset ──────────────────────────
    val_rows = db.query(VulnerabilityAssetLink).options(
        joinedload(VulnerabilityAssetLink.vulnerability),
    ).filter(
        VulnerabilityAssetLink.asset_id == asset_id,
    ).all()

    open_vals = [
        l for l in val_rows
        if l.vulnerability is not None and l.vulnerability.status in ("open", "in_progress")
    ]
    vuln_ids = [l.vulnerability_id for l in open_vals]

    vulnerabilities_payload = []
    asset_vuln_edges = []
    kev_count = 0
    for link in open_vals:
        v = link.vulnerability
        if v.kev_flag:
            kev_count += 1
        vulnerabilities_payload.append({
            "id": v.id,
            "vuln_id": v.vuln_id,
            "title": v.title,
            "severity": v.severity,
            "cvss_score": v.cvss_score,
            "composite_priority": v.composite_priority,
            "kev_flag": bool(v.kev_flag),
            "epss_score": v.epss_score,
            "status": v.status,
            "cve_id": v.cve_id,
            "cwe_id": v.cwe_id,
        })
        asset_vuln_edges.append({
            "from": "asset",
            "to": f"vuln:{v.id}",
            "kind": "affects",
            "link_source": link.link_source or "manual",
            "auto_linked": bool(link.auto_linked),
            "impact": link.impact_on_asset,
            "severity": v.severity,
        })

    # ── 2. Resolve the vuln-control-risk bridge ──────────────────────────
    # We don't emit control nodes; we use the controls solely to *join*
    # vulnerabilities to risks. The result is a per-(vuln, risk) summary
    # with the list of bridge controls and their mitigation effectiveness.
    vcl_rows: List[VulnerabilityControlLink] = []
    if vuln_ids:
        vcl_rows = db.query(VulnerabilityControlLink).filter(
            VulnerabilityControlLink.vulnerability_id.in_(vuln_ids)
        ).all()

    # Pre-fetch the control tables we need by id list. Parsed controls are
    # included so we can show the user *why* a vuln auto-mapped, even though
    # parsed controls themselves cannot connect to risks in the data model.
    parsed_ids = sorted({r.parsed_framework_control_id for r in vcl_rows if r.parsed_framework_control_id})
    framework_ids = sorted({r.framework_control_id for r in vcl_rows if r.framework_control_id})
    normalized_ids = sorted({r.normalized_control_id for r in vcl_rows if r.normalized_control_id})
    internal_ids = sorted({r.internal_control_id for r in vcl_rows if r.internal_control_id})

    parsed_map: Dict[int, ParsedFrameworkControl] = {}
    if parsed_ids:
        for c in db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id.in_(parsed_ids)).all():
            parsed_map[c.id] = c

    framework_map: Dict[int, FrameworkControl] = {}
    framework_short_codes: Dict[int, str] = {}
    if framework_ids:
        for c in db.query(FrameworkControl).filter(FrameworkControl.id.in_(framework_ids)).all():
            framework_map[c.id] = c
        try:
            fw_pairs = db.query(FrameworkControl.id, Framework.short_code).join(
                Framework, Framework.id == FrameworkControl.framework_id, isouter=True
            ).filter(FrameworkControl.id.in_(framework_ids)).all()
            for cid, sc in fw_pairs:
                if sc:
                    framework_short_codes[cid] = sc
        except Exception:
            pass

    normalized_map: Dict[int, NormalizedControl] = {}
    if normalized_ids:
        for c in db.query(NormalizedControl).filter(NormalizedControl.id.in_(normalized_ids)).all():
            normalized_map[c.id] = c

    internal_map: Dict[int, InternalControl] = {}
    if internal_ids:
        for c in db.query(InternalControl).filter(InternalControl.id.in_(internal_ids)).all():
            internal_map[c.id] = c

    def _classify_source(notes: Optional[str]) -> Tuple[str, Optional[str]]:
        if notes and notes.startswith("auto:cwe:"):
            cwe = notes.split(":", 2)[-1].strip() or None
            return ("auto_cwe", cwe)
        return ("manual", None)

    # Map vuln_id → list of bridge-control descriptors (only those that can
    # *actually* reach a risk: framework_control_id + normalized_control_id).
    # Parsed/internal entries are captured for tooltip context but don't
    # contribute to risk linkage in the current data model.
    BridgeCtrl = Dict[str, Any]  # {target_type, target_id, code, name, framework_short_code, source, auto_cwe}
    vuln_bridges: Dict[int, List[BridgeCtrl]] = {}
    vuln_total_ctrls: Dict[int, int] = {}  # total VCL links per vuln (all target types) for context chips

    for vcl in vcl_rows:
        source, auto_cwe = _classify_source(vcl.notes)
        target_type: Optional[str] = None
        target_id: Optional[int] = None
        code = name = None
        framework_short_code: Optional[str] = None

        if vcl.parsed_framework_control_id and vcl.parsed_framework_control_id in parsed_map:
            target_type, target_id = "parsed", vcl.parsed_framework_control_id
            c = parsed_map[target_id]
            code, name = c.control_id, c.title
        elif vcl.framework_control_id and vcl.framework_control_id in framework_map:
            target_type, target_id = "framework", vcl.framework_control_id
            c = framework_map[target_id]
            code, name = c.code, c.name
            framework_short_code = framework_short_codes.get(target_id)
        elif vcl.normalized_control_id and vcl.normalized_control_id in normalized_map:
            target_type, target_id = "normalized", vcl.normalized_control_id
            c = normalized_map[target_id]
            code = getattr(c, "code", None) or getattr(c, "control_id", None)
            name = getattr(c, "name", None) or getattr(c, "title", None)
        elif vcl.internal_control_id and vcl.internal_control_id in internal_map:
            target_type, target_id = "internal", vcl.internal_control_id
            c = internal_map[target_id]
            code, name = c.control_id, c.name
        else:
            continue

        vuln_total_ctrls[vcl.vulnerability_id] = vuln_total_ctrls.get(vcl.vulnerability_id, 0) + 1
        vuln_bridges.setdefault(vcl.vulnerability_id, []).append({
            "target_type": target_type,
            "target_id": target_id,
            "code": code,
            "name": name,
            "framework_short_code": framework_short_code,
            "source": source,
            "auto_cwe": auto_cwe,
        })

    # ── 3. Bridge controls → risks ───────────────────────────────────────
    # ctrl_risk_map[(target_type, target_id)] → list of (risk_id, effectiveness)
    ctrl_risk_map: Dict[Tuple[str, int], List[Tuple[int, Optional[str]]]] = {}
    risk_objects: Dict[int, Risk] = {}

    if framework_ids:
        rfcl = db.query(RiskFrameworkControlLink).options(
            joinedload(RiskFrameworkControlLink.risk),
        ).filter(RiskFrameworkControlLink.framework_control_id.in_(framework_ids)).all()
        for link in rfcl:
            r = link.risk
            if r is None:
                continue
            risk_objects[r.id] = r
            ctrl_risk_map.setdefault(("framework", link.framework_control_id), []).append(
                (r.id, link.mitigation_effectiveness),
            )

    if normalized_ids:
        rcl = db.query(RiskControlLink).options(
            joinedload(RiskControlLink.risk),
        ).filter(RiskControlLink.normalized_control_id.in_(normalized_ids)).all()
        for link in rcl:
            r = link.risk
            if r is None:
                continue
            risk_objects[r.id] = r
            ctrl_risk_map.setdefault(("normalized", link.normalized_control_id), []).append(
                (r.id, None),
            )

    # ── 4. Compose vuln → risk edges with bridge_controls metadata ───────
    # For each vuln, for each of its bridge controls, for each risk that
    # control links to → record the edge. Deduplicate by (vuln_id, risk_id),
    # accumulating bridge controls so the UI can show "via 2 controls".
    EFFECTIVENESS_RANK = {"full": 3, "partial": 2, "minimal": 1, "none": 0}

    def _weakest_effectiveness(bridges: List[Dict[str, Any]]) -> Optional[str]:
        # Lowest mitigation wins (worst case for residual risk).
        ranked = [b.get("effectiveness") for b in bridges if b.get("effectiveness")]
        if not ranked:
            return None
        return min(ranked, key=lambda x: EFFECTIVENESS_RANK.get(x, 99))

    vuln_risk_edges_map: Dict[Tuple[int, int], Dict[str, Any]] = {}
    risks_from_chain: Dict[int, Risk] = {}

    for vuln_id, bridges in vuln_bridges.items():
        for b in bridges:
            risks_via = ctrl_risk_map.get((b["target_type"], b["target_id"]), [])
            for rid, effectiveness in risks_via:
                key = (vuln_id, rid)
                entry = vuln_risk_edges_map.setdefault(key, {
                    "from": f"vuln:{vuln_id}",
                    "to": f"risk:{rid}",
                    "kind": "via_control",
                    "bridge_controls": [],
                })
                # Attach this bridge to the edge metadata
                entry["bridge_controls"].append({
                    "code": b["code"],
                    "name": b["name"],
                    "framework_short_code": b["framework_short_code"],
                    "target_type": b["target_type"],
                    "source": b["source"],
                    "auto_cwe": b["auto_cwe"],
                    "effectiveness": effectiveness,
                })
                risks_from_chain[rid] = risk_objects[rid]

    # Recompute weakest effectiveness per edge after accumulation
    vuln_risk_edges = list(vuln_risk_edges_map.values())
    for e in vuln_risk_edges:
        e["weakest_effectiveness"] = _weakest_effectiveness(e["bridge_controls"])

    # ── 5. Direct asset → risk linkages ──────────────────────────────────
    direct_links = db.query(RiskAssetLink).options(
        joinedload(RiskAssetLink.risk),
    ).filter(RiskAssetLink.asset_id == asset_id).all()

    direct_risk_ids: set[int] = set()
    asset_risk_edges: List[Dict[str, Any]] = []
    risks_direct: Dict[int, Risk] = {}
    for rl in direct_links:
        r = rl.risk
        if r is None:
            continue
        direct_risk_ids.add(r.id)
        risks_direct[r.id] = r
        asset_risk_edges.append({
            "from": "asset",
            "to": f"risk:{r.id}",
            "kind": "direct",
        })

    # ── 6. Union of risks (direct + via_control). Direct provenance wins
    # for the "source" tag on the node, but the via_control edges remain
    # so the user can see the chain too.
    all_risks: Dict[int, Tuple[Risk, str]] = {}
    for rid, r in risks_from_chain.items():
        all_risks[rid] = (r, "via_control")
    for rid, r in risks_direct.items():
        all_risks[rid] = (r, "direct")  # overwrite — direct wins

    def _risk_tier(score: Optional[float]) -> str:
        if score is None: return "unknown"
        if score >= 15: return "critical"
        if score >= 10: return "high"
        if score >= 5:  return "medium"
        return "low"

    risks_payload = []
    for rid, (r, source_tag) in all_risks.items():
        inherent = getattr(r, "inherent_score", None) or getattr(r, "inherent_risk_score", None)
        residual = getattr(r, "residual_score", None) or getattr(r, "residual_risk_score", None)
        risks_payload.append({
            "id": r.id,
            "title": r.title,
            "status": r.status,
            "inherent_score": inherent,
            "residual_score": residual,
            "tier": _risk_tier(residual if residual is not None else inherent),
            "source": source_tag,
        })
    risks_payload.sort(key=lambda r: (r["residual_score"] or 0), reverse=True)

    edges = asset_vuln_edges + vuln_risk_edges + asset_risk_edges

    stats = {
        "open_vulns": len(vulnerabilities_payload),
        "kev_count": kev_count,
        "vulns_with_risk_path": len({e["from"] for e in vuln_risk_edges}),
        "bridge_controls_total": sum(len(b) for b in vuln_bridges.values()),
        "risks_direct": sum(1 for r in risks_payload if r["source"] == "direct"),
        "risks_transitive": sum(1 for r in risks_payload if r["source"] == "via_control"),
        "max_residual": max(
            (r["residual_score"] for r in risks_payload if r["residual_score"] is not None),
            default=0,
        ),
    }

    return {
        "asset": {
            "id": asset.id,
            "name": asset.name,
            "type": asset.asset_type,
            "criticality": asset.criticality,
            "criticality_score": asset.criticality_score,
            "internet_facing": bool(getattr(asset, "internet_facing", False)),
            "confidentiality_rating": asset.confidentiality_rating,
            "integrity_rating": asset.integrity_rating,
            "availability_rating": asset.availability_rating,
        },
        "vulnerabilities": vulnerabilities_payload,
        "risks": risks_payload,
        "edges": edges,
        "stats": stats,
    }


@router.get("/{asset_id}/security-compliance/controls")
def list_security_compliance_controls(
    asset_id: int,
    search: Optional[str] = Query(None),
    sort_by: str = Query("control_id"),
    sort_order: str = Query("asc"),
    level: Optional[str] = Query(None),
    section: Optional[str] = Query(None),
    selected_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    asset = _get_asset_for_user(asset_id, current_user, db)
    if sort_by not in {"control_id", "title", "level", "section"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid sort_by")
    if sort_order not in {"asc", "desc"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid sort_order")

    try:
        payload = _load_security_compliance_controls()
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e

    controls = payload.get("controls") or []
    if not isinstance(controls, list):
        controls = []

    selected_control_ids = {
        row.control_id
        for row in db.query(AssetSecurityComplianceSelection).filter(
            AssetSecurityComplianceSelection.asset_id == asset.id,
            AssetSecurityComplianceSelection.benchmark == SECURITY_COMPLIANCE_BENCHMARK,
        ).all()
    }

    search_term = (search or "").strip().lower()
    level_term = (level or "").strip().lower()
    section_term = (section or "").strip().lower()

    filtered_controls: List[Dict[str, Any]] = []
    for entry in controls:
        if not isinstance(entry, dict):
            continue

        control_id = str(entry.get("ControlID") or "").strip()
        if not control_id:
            continue

        title = str(entry.get("Title") or "")
        section_value = str(entry.get("Section") or "")
        level_value = str(entry.get("Level") or "")
        description = str(entry.get("Description") or "")

        if search_term:
            haystack = " ".join([control_id, title, section_value, level_value, description]).lower()
            if search_term not in haystack:
                continue

        if level_term and level_term != level_value.lower():
            continue
        if section_term and section_term not in section_value.lower():
            continue

        is_selected = control_id in selected_control_ids
        if selected_only and not is_selected:
            continue

        enriched = dict(entry)
        enriched["control_id"] = control_id
        enriched["selected"] = is_selected
        filtered_controls.append(enriched)

    reverse = sort_order == "desc"
    if sort_by == "control_id":
        filtered_controls.sort(
            key=lambda item: _security_compliance_sort_tokens(item.get("ControlID", "")),
            reverse=reverse,
        )
    elif sort_by == "title":
        filtered_controls.sort(key=lambda item: str(item.get("Title") or "").lower(), reverse=reverse)
    elif sort_by == "level":
        filtered_controls.sort(key=lambda item: str(item.get("Level") or "").lower(), reverse=reverse)
    else:
        filtered_controls.sort(key=lambda item: str(item.get("Section") or "").lower(), reverse=reverse)

    total_filtered = len(filtered_controls)
    paged_items = filtered_controls[skip: skip + limit]
    return {
        "benchmark": payload.get("benchmark") or SECURITY_COMPLIANCE_BENCHMARK,
        "version": payload.get("version"),
        "published": payload.get("published"),
        "total_controls_in_source": payload.get("total_controls") or len(controls),
        "total": total_filtered,
        "skip": skip,
        "limit": limit,
        "selected_count": len(selected_control_ids),
        "controls": paged_items,
    }


@router.get("/{asset_id}/security-compliance/selections")
def get_security_compliance_selections(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_asset_for_user(asset_id, current_user, db)
    selections = db.query(AssetSecurityComplianceSelection).filter(
        AssetSecurityComplianceSelection.asset_id == asset_id,
        AssetSecurityComplianceSelection.benchmark == SECURITY_COMPLIANCE_BENCHMARK,
    ).order_by(AssetSecurityComplianceSelection.control_id.asc()).all()

    control_ids = [row.control_id for row in selections]
    return {
        "benchmark": SECURITY_COMPLIANCE_BENCHMARK,
        "count": len(control_ids),
        "control_ids": control_ids,
    }


@router.post(
    "/{asset_id}/security-compliance/selections",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_security_compliance_selections(
    asset_id: int,
    payload: SecurityComplianceSelectionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_asset_for_user(asset_id, current_user, db)

    requested_ids = sorted({str(control_id).strip() for control_id in payload.control_ids if str(control_id).strip()})
    if not requested_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No control IDs provided")

    try:
        source_payload = _load_security_compliance_controls()
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e

    valid_ids = {
        str(item.get("ControlID") or "").strip()
        for item in (source_payload.get("controls") or [])
        if isinstance(item, dict) and str(item.get("ControlID") or "").strip()
    }
    invalid_ids = [control_id for control_id in requested_ids if control_id not in valid_ids]
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown control IDs: {', '.join(invalid_ids[:10])}",
        )

    existing_ids = {
        row.control_id
        for row in db.query(AssetSecurityComplianceSelection).filter(
            AssetSecurityComplianceSelection.asset_id == asset_id,
            AssetSecurityComplianceSelection.benchmark == SECURITY_COMPLIANCE_BENCHMARK,
            AssetSecurityComplianceSelection.control_id.in_(requested_ids),
        ).all()
    }

    created_count = 0
    for control_id in requested_ids:
        if control_id in existing_ids:
            continue
        db.add(
            AssetSecurityComplianceSelection(
                asset_id=asset_id,
                benchmark=SECURITY_COMPLIANCE_BENCHMARK,
                control_id=control_id,
                selected_by=current_user.id,
            )
        )
        created_count += 1

    db.commit()
    return MessageResponse(message=f"{created_count} control(s) selected", id=created_count)


@router.delete(
    "/{asset_id}/security-compliance/selections/{control_id}",
    response_model=MessageResponse,
)
def remove_security_compliance_selection(
    asset_id: int,
    control_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_asset_for_user(asset_id, current_user, db)

    db_row = db.query(AssetSecurityComplianceSelection).filter(
        AssetSecurityComplianceSelection.asset_id == asset_id,
        AssetSecurityComplianceSelection.benchmark == SECURITY_COMPLIANCE_BENCHMARK,
        AssetSecurityComplianceSelection.control_id == control_id,
    ).first()
    if not db_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Selected control not found for this asset",
        )

    db.delete(db_row)
    db.commit()
    return MessageResponse(message="Control unselected")


@router.post("/{asset_id}/link-framework-control", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_framework_control(
    asset_id: int,
    link: AssetFrameworkControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    control = db.query(FrameworkControl).filter(
        FrameworkControl.id == link.framework_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework control not found"
        )
    
    existing = db.query(AssetFrameworkControlLink).filter(
        AssetFrameworkControlLink.asset_id == asset_id,
        AssetFrameworkControlLink.framework_control_id == link.framework_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetFrameworkControlLink(
        asset_id=asset_id,
        framework_control_id=link.framework_control_id,
        coverage_status=link.coverage_status,
        notes=link.notes
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Framework control linked successfully", id=db_link.id)


@router.delete("/{asset_id}/link-framework-control/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_framework_control_link(
    asset_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    link = db.query(AssetFrameworkControlLink).filter(
        AssetFrameworkControlLink.id == link_id,
        AssetFrameworkControlLink.asset_id == asset_id
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found"
        )
    
    db.delete(link)
    db.commit()
    return None


# ── Mapping recommendations ───────────────────────────────────────────────────
# Regex-driven recommender that scores every framework control against this
# asset's profile (OS family, asset type, network exposure, data class,
# criticality, business function, vendor). See
# services/asset_control_recommender.py for the signal library.

class _AcceptRecommendationsRequest(BaseModel):
    framework_control_ids: List[int]
    coverage_status: str = "partial"
    notes: Optional[str] = None


@router.get("/{asset_id}/mapping-recommendations")
def get_mapping_recommendations(
    asset_id: int,
    framework_id: Optional[int] = Query(None, description="Restrict to a single framework"),
    min_score: int = Query(1, ge=1, le=20, description="Minimum score to surface (default 1 — surfaces universal-only matches for sparse-profile assets)"),
    limit: int = Query(100, ge=1, le=500),
    include_linked: bool = Query(False, description="Include controls already linked"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants),
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    result = recommend_for_asset(
        db,
        asset,
        min_score=min_score,
        limit=limit,
        framework_id=framework_id,
        include_linked=include_linked,
    )

    return {
        "recommendations": [
            {
                "framework_control_id": r.framework_control_id,
                "framework_id": r.framework_id,
                "framework_name": r.framework_name,
                "framework_short_code": r.framework_short_code,
                "code": r.code,
                "name": r.name,
                "statement": r.statement,
                "score": r.score,
                "confidence": r.confidence,
                "matched_signals": [
                    {"key": s.key, "label": s.label, "weight": s.weight}
                    for s in r.matched_signals
                ],
                "negative_notes": r.negative_notes,
            }
            for r in result.recommendations
        ],
        "total_controls_scanned": result.total_controls_scanned,
        "total_already_linked": result.total_already_linked,
        "asset_profile": result.asset_profile,
    }


@router.post("/{asset_id}/mapping-recommendations/accept", status_code=status.HTTP_200_OK)
def accept_mapping_recommendations(
    asset_id: int,
    payload: _AcceptRecommendationsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants),
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    coverage = (payload.coverage_status or "partial").lower()
    if coverage not in {"partial", "full", "minimal"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="coverage_status must be one of: partial, full, minimal",
        )

    ids = list({int(fc_id) for fc_id in payload.framework_control_ids if int(fc_id) > 0})
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="framework_control_ids is required",
        )

    existing_ids = {
        row.framework_control_id
        for row in db.query(AssetFrameworkControlLink.framework_control_id).filter(
            AssetFrameworkControlLink.asset_id == asset_id,
            AssetFrameworkControlLink.framework_control_id.in_(ids),
        )
    }
    valid_ids = {
        row.id
        for row in db.query(FrameworkControl.id).filter(FrameworkControl.id.in_(ids))
    }

    linked: List[int] = []
    skipped_existing = 0
    skipped_missing = 0
    for fc_id in ids:
        if fc_id not in valid_ids:
            skipped_missing += 1
            continue
        if fc_id in existing_ids:
            skipped_existing += 1
            continue
        db_link = AssetFrameworkControlLink(
            asset_id=asset_id,
            framework_control_id=fc_id,
            coverage_status=coverage,
            notes=payload.notes,
        )
        db.add(db_link)
        db.flush()
        linked.append(db_link.id)

    db.commit()
    return {
        "linked": len(linked),
        "link_ids": linked,
        "skipped_existing": skipped_existing,
        "skipped_missing": skipped_missing,
    }


@router.post("/{asset_id}/link-evidence", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_evidence(
    asset_id: int,
    link: AssetEvidenceLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    evidence = db.query(Evidence).filter(
        Evidence.id == link.evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    existing = db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.asset_id == asset_id,
        AssetEvidenceLink.evidence_id == link.evidence_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetEvidenceLink(
        asset_id=asset_id,
        evidence_id=link.evidence_id,
        relationship_type=link.relationship_type
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Evidence linked successfully", id=db_link.id)


@router.delete("/{asset_id}/link-evidence/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_evidence_link(
    asset_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    link = db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.id == link_id,
        AssetEvidenceLink.asset_id == asset_id
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.get("/{asset_id}/coverage-analysis", response_model=AssetCoverageAnalysis)
def get_asset_coverage_analysis(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.internal_control_links),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.risk_assessments)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    total_controls = len(asset.control_links) + len(asset.internal_control_links) + len(asset.framework_control_links)
    
    full_framework_coverage = sum(1 for link in asset.framework_control_links if link.coverage_status == "full")
    partial_framework_coverage = sum(1 for link in asset.framework_control_links if link.coverage_status == "partial")
    full_internal_coverage = sum(1 for link in asset.internal_control_links if link.coverage_status == "full")
    partial_internal_coverage = sum(1 for link in asset.internal_control_links if link.coverage_status == "partial")
    covered_controls = (
        len(asset.control_links)
        + full_internal_coverage
        + (partial_internal_coverage * 0.5)
        + full_framework_coverage
        + (partial_framework_coverage * 0.5)
    )
    
    expected_controls = 10
    coverage_percentage = min((covered_controls / expected_controls) * 100, 100) if expected_controls > 0 else 0
    
    gaps = []
    if total_controls < 3:
        gaps.append({"type": "insufficient_controls", "message": "Asset has fewer than 3 controls linked"})
    if asset.criticality in ["high", "critical"] and total_controls < 5:
        gaps.append({"type": "critical_asset_gap", "message": "Critical/high priority asset should have at least 5 controls"})
    if not asset.framework_control_links:
        gaps.append({"type": "no_framework_controls", "message": "No framework controls linked to this asset"})
    
    latest_assessment = None
    risk_score = None
    if asset.risk_assessments:
        latest_assessment = sorted(asset.risk_assessments, key=lambda x: x.assessment_date, reverse=True)[0]
        risk_score = latest_assessment.risk_score
    
    return AssetCoverageAnalysis(
        asset_id=asset.id,
        asset_name=asset.name,
        total_controls=total_controls,
        covered_controls=int(covered_controls),
        coverage_percentage=round(coverage_percentage, 2),
        gaps=gaps,
        risk_score=risk_score
    )


@router.post("/{asset_id}/assess-risk", response_model=AssetRiskAssessmentResponse)
def perform_risk_assessment(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.internal_control_links),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.evidence_links)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    num_normalized_controls = len(asset.control_links)
    num_internal_controls = len(asset.internal_control_links)
    num_framework_controls = len(asset.framework_control_links)
    num_evidence = len(asset.evidence_links)
    
    total_controls = num_normalized_controls + num_internal_controls + num_framework_controls
    coverage = min(total_controls * 10, 100)
    
    base_risk = 5
    if asset.criticality == "critical":
        base_risk = 9
    elif asset.criticality == "high":
        base_risk = 7
    elif asset.criticality == "low":
        base_risk = 3
    
    control_reduction = total_controls * 0.4
    evidence_reduction = num_evidence * 0.2
    risk_score = max(1, base_risk - control_reduction - evidence_reduction)
    
    gaps = {
        "missing_controls": max(0, 10 - total_controls),
        "missing_evidence": max(0, 5 - num_evidence),
        "recommendations": []
    }
    if total_controls < 3:
        gaps["recommendations"].append("Add more controls to improve coverage")
    if asset.criticality in ["high", "critical"] and total_controls < 5:
        gaps["recommendations"].append("Critical assets should have at least 5 controls")
    if num_evidence < 2:
        gaps["recommendations"].append("Add more evidence documentation")
    if not asset.framework_control_links:
        gaps["recommendations"].append("Link to framework controls for better compliance tracking")
    
    assessment = AssetRiskAssessment(
        asset_id=asset_id,
        risk_score=round(risk_score, 2),
        coverage_percentage=float(coverage),
        gaps=gaps,
        assessor_id=current_user.id
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    
    return assessment


class AssetInternalControlLinkCreate(BaseModel):
    internal_control_id: int
    coverage_status: Optional[str] = "partial"


@router.post("/{asset_id}/internal-controls", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_internal_control(
    asset_id: int,
    link: AssetInternalControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Link an ERM internal control to an asset"""
    user_tenants = get_user_tenants(current_user, db)

    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    ctrl = db.query(InternalControl).filter(
        InternalControl.id == link.internal_control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    if not ctrl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal control not found")

    existing = db.query(AssetInternalControlLink).filter(
        AssetInternalControlLink.asset_id == asset_id,
        AssetInternalControlLink.internal_control_id == link.internal_control_id
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Link already exists")

    db_link = AssetInternalControlLink(
        asset_id=asset_id,
        internal_control_id=link.internal_control_id,
        coverage_status=link.coverage_status
    )
    db.add(db_link)
    db.commit()
    db.refresh(db_link)

    return MessageResponse(message="Internal control linked successfully", id=db_link.id)


@router.delete("/{asset_id}/internal-controls/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_asset_from_internal_control(
    asset_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Unlink an ERM internal control from an asset"""
    user_tenants = get_user_tenants(current_user, db)

    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    db_link = db.query(AssetInternalControlLink).filter(
        AssetInternalControlLink.id == link_id,
        AssetInternalControlLink.asset_id == asset_id
    ).first()
    if not db_link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    db.delete(db_link)
    db.commit()
    return None


# ── Phase 4: Software inventory (CPE / PURL) per asset ──────────────────────
# Feeds the CPE matcher (services/cpe_matcher.py). When an enrichment run
# pulls a CVE's affected_configurations, the matcher walks every
# SoftwareIdentifier row in the tenant and auto-creates the linked vuln rows.

class SoftwareIdentifierCreate(BaseModel):
    identifier_type: str  # "cpe" or "purl"
    identifier: str
    vendor: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None
    source: Optional[str] = "manual"


@router.get("/{asset_id}/software-identifiers")
def list_software_identifiers(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    asset = _get_asset_for_user(asset_id, current_user, db)
    rows = (
        db.query(SoftwareIdentifier)
        .filter(SoftwareIdentifier.asset_id == asset.id)
        .order_by(SoftwareIdentifier.identifier_type.asc(), SoftwareIdentifier.identifier.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "identifier_type": r.identifier_type,
            "identifier": r.identifier,
            "vendor": r.vendor,
            "product": r.product,
            "version": r.version,
            "source": r.source,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.post("/{asset_id}/software-identifiers", status_code=status.HTTP_201_CREATED)
def add_software_identifier(
    asset_id: int,
    payload: SoftwareIdentifierCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    asset = _get_asset_for_user(asset_id, current_user, db)
    ident_type = (payload.identifier_type or "").strip().lower()
    if ident_type not in ("cpe", "purl"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="identifier_type must be 'cpe' or 'purl'.",
        )
    ident = (payload.identifier or "").strip()
    if not ident:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="identifier is required.",
        )
    # Parse to extract vendor/product/version when the caller didn't supply
    # them — saves the matcher work later and keeps the row searchable.
    from ..services.cpe_matcher import parse_cpe, parse_purl
    parsed = parse_cpe(ident) if ident_type == "cpe" else parse_purl(ident)
    vendor = payload.vendor or (parsed.vendor if parsed else None)
    product = payload.product or (parsed.product if parsed else None)
    version = payload.version or (parsed.version if parsed and parsed.version != "*" else None)

    row = SoftwareIdentifier(
        tenant_id=asset.tenant_id,
        asset_id=asset.id,
        identifier_type=ident_type,
        identifier=ident,
        vendor=(vendor or None),
        product=(product or None),
        version=(version or None),
        source=(payload.source or "manual"),
    )
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create identifier: {exc.__class__.__name__} (possibly duplicate).",
        )
    return {"id": row.id, "identifier": row.identifier}


@router.delete("/{asset_id}/software-identifiers/{identifier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_software_identifier(
    asset_id: int,
    identifier_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    asset = _get_asset_for_user(asset_id, current_user, db)
    row = (
        db.query(SoftwareIdentifier)
        .filter(SoftwareIdentifier.id == identifier_id)
        .filter(SoftwareIdentifier.asset_id == asset.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Identifier not found.")
    db.delete(row)
    db.commit()
    return None
