from typing import List, Optional
from datetime import datetime
import os
import json
import csv
import re
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

try:
    import openpyxl
except ImportError:
    openpyxl = None

from ....models import (
    InternalControl, InternalControlTest, InternalControlRiskLink,
    InternalControlFrameworkLink, InternalControlEscalation,
    InternalControlWorkflowAction, Risk, FrameworkControl,
    NormalizedControl, GRCUser, Tenant, BusinessUnit, get_db
)
from ....schemas import (
    InternalControlCreate, InternalControlUpdate, InternalControlResponse,
    InternalControlDetailResponse, InternalControlTestCreate,
    InternalControlTestUpdate, InternalControlTestResponse,
    InternalControlRiskLinkCreate, InternalControlRiskLinkResponse,
    InternalControlFrameworkLinkCreate, InternalControlFrameworkLinkResponse,
    InternalControlEscalationCreate, InternalControlEscalationUpdate,
    InternalControlEscalationResponse, InternalControlWorkflowActionCreate,
    InternalControlWorkflowActionResponse, InternalControlDashboard,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/internal-controls", tags=["ERM - Internal Controls"])


class InternalControlAIUploadItem(BaseModel):
    control_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    control_type: str = "preventive"
    frequency: Optional[str] = "monthly"
    regulatory_source: Optional[str] = None
    priority: str = "medium"
    is_key_control: bool = False


def _get_openai_client():
    from openai import OpenAI

    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        return None

    is_modelfarm = "modelfarm" in (base_url or "")
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        return None
    return OpenAI(api_key=api_key, base_url=base_url)


def _normalize_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in ["true", "yes", "1", "y"]


def _infer_control_type(text: str) -> str:
    value = (text or "").lower()
    if any(k in value for k in ["detect", "monitor", "alert"]):
        return "detective"
    if any(k in value for k in ["recover", "correct", "respond"]):
        return "corrective"
    return "preventive"


def _heuristic_control_enrichment(items: List[dict]) -> List[dict]:
    enriched = []
    for item in items:
        name = str(item.get("name") or "").strip()
        description = str(item.get("description") or "").strip()
        joined = f"{name} {description}".lower()

        category = item.get("category")
        sub_category = item.get("sub_category")
        if not category:
            if any(k in joined for k in ["access", "identity", "password", "authentication"]):
                category = "access_control"
                sub_category = sub_category or "identity_and_access"
            elif any(k in joined for k in ["backup", "recovery", "restore", "dr"]):
                category = "business_continuity"
                sub_category = sub_category or "backup_and_recovery"
            elif any(k in joined for k in ["vendor", "third party", "supplier"]):
                category = "third_party"
                sub_category = sub_category or "vendor_management"
            else:
                category = "operational"
                sub_category = sub_category or "general"

        control_type = item.get("control_type") or _infer_control_type(joined)
        priority = item.get("priority") or ("high" if "critical" in joined else "medium")

        enriched.append({
            "control_id": item.get("control_id"),
            "name": name,
            "description": description or None,
            "category": category,
            "sub_category": sub_category,
            "control_type": control_type,
            "frequency": item.get("frequency") or "monthly",
            "regulatory_source": item.get("regulatory_source"),
            "priority": priority,
            "is_key_control": _normalize_bool(item.get("is_key_control", False))
        })
    return enriched


def _ai_enrich_controls(items: List[dict]) -> List[dict]:
    if not items:
        return []

    client = _get_openai_client()
    if not client:
        return _heuristic_control_enrichment(items)

    prompt = f"""You are a GRC controls expert. Enrich internal controls parsed from a manually uploaded file.
Return ONLY valid JSON array with one object per input item and preserve input order.

Required keys for each object:
- control_id (string or null)
- name (string)
- description (string or null)
- category (string)
- sub_category (string)
- control_type (preventive|detective|corrective)
- frequency (daily|weekly|monthly|quarterly|annually)
- regulatory_source (string or null)
- priority (low|medium|high|critical)
- is_key_control (boolean)

Input items:
{json.dumps(items, ensure_ascii=False)}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a precise GRC assistant. Return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=3500
        )
        content = (response.choices[0].message.content or "").strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]

        parsed = json.loads(content.strip())
        if not isinstance(parsed, list) or len(parsed) != len(items):
            return _heuristic_control_enrichment(items)
        return _heuristic_control_enrichment(parsed)
    except Exception:
        return _heuristic_control_enrichment(items)


def _extract_controls_from_upload(filename: str, content: bytes) -> List[dict]:
    lower_name = (filename or "").lower()
    rows: List[dict] = []

    def _canonical_header(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (value or "").strip().lower())

    header_aliases = {
        "control_id": {"controlid", "id", "controlcode", "controlnumber"},
        "name": {"name", "controlname", "controltitle", "control"},
        "description": {"description", "controldescription", "details", "narrative"},
        "category": {"category", "controlcategory", "riskcategory"},
        "sub_category": {"subcategory", "subcategory", "controlsubcategory"},
        "control_type": {"controltype", "type"},
        "control_nature": {"automatedmanual", "controlnature", "nature"},
        "frequency": {"frequency", "controlfrequency", "testingfrequency", "cadence"},
        "regulatory_source": {"regulatorysource", "regulation", "framework", "riskids", "riskid", "riskids"},
        "priority": {"priority", "riskrating", "criticality"},
        "is_key_control": {"keycontrol", "iskeycontrol", "key"},
        "status": {"status", "controlstatus"},
        "effectiveness": {"effectiveness", "controleffectiveness"},
        "testing_method": {"testingmethod", "testmethod"},
    }

    def _normalize_key(raw_key: str) -> str:
        canonical = _canonical_header(raw_key)
        for target, aliases in header_aliases.items():
            if canonical in aliases:
                return target
        return (raw_key or "").strip().lower()

    if lower_name.endswith(".csv"):
        text = content.decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(text.splitlines())
        for row in reader:
            normalized = {}
            for key, value in (row or {}).items():
                if key:
                    normalized[_normalize_key(str(key))] = value
            rows.append(normalized)
    elif lower_name.endswith((".xlsx", ".xls")):
        if openpyxl is None:
            raise HTTPException(status_code=500, detail="openpyxl is not installed")
        workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)

        def _find_header_row_idx(all_rows: List[tuple]) -> Optional[int]:
            max_scan = min(len(all_rows), 30)
            for idx in range(max_scan):
                row_vals = all_rows[idx]
                normalized = [_normalize_key(str(v or "")) for v in row_vals]
                matched = set()
                for token in normalized:
                    for target, aliases in header_aliases.items():
                        if token in aliases:
                            matched.add(target)
                if "name" in matched and ("control_id" in matched or "description" in matched or "category" in matched or "control_type" in matched):
                    return idx
            return None

        best_rows: List[dict] = []
        for sheet in workbook.worksheets:
            all_rows = list(sheet.iter_rows(values_only=True))
            if not all_rows:
                continue

            header_idx = _find_header_row_idx(all_rows)
            if header_idx is None:
                continue

            headers = [_normalize_key(str(v or "")) for v in all_rows[header_idx]]
            sheet_rows: List[dict] = []
            for raw in all_rows[header_idx + 1:]:
                if not raw or not any(v is not None and str(v).strip() != "" for v in raw):
                    continue
                item = {}
                for idx, val in enumerate(raw):
                    if idx < len(headers) and headers[idx]:
                        item[headers[idx]] = val
                if item:
                    sheet_rows.append(item)

            if len(sheet_rows) > len(best_rows):
                best_rows = sheet_rows

        rows.extend(best_rows)
    elif lower_name.endswith(".txt"):
        text = content.decode("utf-8-sig", errors="ignore")
        for line in text.splitlines():
            cleaned = line.strip("-• \t\r\n")
            if cleaned:
                rows.append({"name": cleaned})
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Upload .csv, .xlsx/.xls, or .txt"
        )

    mapped: List[dict] = []
    for row in rows:
        name = row.get("name") or row.get("control") or row.get("control name") or row.get("control_title")
        if not name:
            continue

        control_nature = row.get("control_nature")
        if control_nature:
            nature_text = str(control_nature).strip().lower()
            if "auto" in nature_text:
                control_nature = "automated"
            elif "manual" in nature_text:
                control_nature = "manual"
            elif "it" in nature_text and "manual" in nature_text:
                control_nature = "it_dependent_manual"
            else:
                control_nature = "manual"

        regulatory_source = row.get("regulatory_source") or row.get("regulation") or row.get("framework")
        if not regulatory_source and (row.get("status") or row.get("effectiveness") or row.get("testing_method")):
            parts = []
            if row.get("status"):
                parts.append(f"Status: {str(row.get('status')).strip()}")
            if row.get("effectiveness"):
                parts.append(f"Effectiveness: {str(row.get('effectiveness')).strip()}")
            if row.get("testing_method"):
                parts.append(f"Testing: {str(row.get('testing_method')).strip()}")
            regulatory_source = " | ".join(parts) if parts else None

        mapped.append({
            "control_id": row.get("control_id") or row.get("id") or row.get("control code") or row.get("control_code"),
            "name": str(name).strip(),
            "description": row.get("description") or row.get("details") or row.get("control_description"),
            "category": row.get("category"),
            "sub_category": row.get("sub_category") or row.get("subcategory"),
            "control_type": row.get("control_type") or row.get("type"),
            "control_nature": control_nature,
            "frequency": row.get("frequency"),
            "regulatory_source": regulatory_source,
            "priority": row.get("priority"),
            "is_key_control": row.get("is_key_control") or row.get("key_control") or False
        })
    return mapped


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_control_or_404(control_id: int, user_tenants: List[int], db: Session) -> InternalControl:
    control = db.query(InternalControl).filter(
        InternalControl.id == control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal control not found"
        )
    return control


@router.get("/dashboard", response_model=InternalControlDashboard)
def get_internal_controls_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return InternalControlDashboard(
            total_controls=0, by_status={}, by_category={},
            by_control_type={}, by_department={}, key_controls=0,
            pending_approval=0, controls_needing_test=0,
            effective_controls=0, ineffective_controls=0
        )
    
    query = db.query(InternalControl).filter(InternalControl.tenant_id.in_(user_tenants))
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(InternalControl.tenant_id == tenant_id)
    
    controls = query.all()
    
    by_status = {}
    by_category = {}
    by_control_type = {}
    by_department = {}
    key_controls = 0
    pending_approval = 0
    controls_needing_test = 0
    effective_controls = 0
    ineffective_controls = 0
    
    for control in controls:
        status_val = control.status or "draft"
        by_status[status_val] = by_status.get(status_val, 0) + 1
        
        cat = control.category or "Other"
        by_category[cat] = by_category.get(cat, 0) + 1
        
        ctype = control.control_type or "preventive"
        by_control_type[ctype] = by_control_type.get(ctype, 0) + 1
        
        dept_name = control.department.name if control.department else "Unassigned"
        by_department[dept_name] = by_department.get(dept_name, 0) + 1
        
        if control.is_key_control:
            key_controls += 1
        
        if control.workflow_status == "pending_review":
            pending_approval += 1
        
        if control.next_test_date and control.next_test_date <= datetime.utcnow():
            controls_needing_test += 1
        
        if control.design_effectiveness == "effective" and control.operating_effectiveness == "effective":
            effective_controls += 1
        elif control.design_effectiveness == "ineffective" or control.operating_effectiveness == "ineffective":
            ineffective_controls += 1
    
    return InternalControlDashboard(
        total_controls=len(controls),
        by_status=by_status,
        by_category=by_category,
        by_control_type=by_control_type,
        by_department=by_department,
        key_controls=key_controls,
        pending_approval=pending_approval,
        controls_needing_test=controls_needing_test,
        effective_controls=effective_controls,
        ineffective_controls=ineffective_controls
    )


@router.get("", response_model=List[InternalControlResponse])
def list_internal_controls(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    category: Optional[str] = None,
    department_id: Optional[int] = None,
    control_type: Optional[str] = None,
    is_key_control: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(InternalControl).options(
        joinedload(InternalControl.owner),
        joinedload(InternalControl.department)
    ).filter(InternalControl.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(InternalControl.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(InternalControl.status == status_filter)
    if category:
        query = query.filter(InternalControl.category == category)
    if department_id:
        query = query.filter(InternalControl.department_id == department_id)
    if control_type:
        query = query.filter(InternalControl.control_type == control_type)
    if is_key_control is not None:
        query = query.filter(InternalControl.is_key_control == is_key_control)
    
    controls = query.order_by(InternalControl.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        InternalControlResponse(
            id=c.id,
            tenant_id=c.tenant_id,
            control_id=c.control_id,
            name=c.name,
            description=c.description,
            category=c.category,
            sub_category=c.sub_category,
            control_type=c.control_type,
            control_nature=c.control_nature,
            department_id=c.department_id,
            owner_id=c.owner_id,
            backup_owner_id=c.backup_owner_id,
            frequency=c.frequency,
            regulatory_source=c.regulatory_source,
            effective_date=c.effective_date,
            review_date=c.review_date,
            status=c.status,
            workflow_status=c.workflow_status,
            design_effectiveness=c.design_effectiveness,
            operating_effectiveness=c.operating_effectiveness,
            last_tested_at=c.last_tested_at,
            next_test_date=c.next_test_date,
            priority=c.priority,
            is_key_control=c.is_key_control,
            created_at=c.created_at,
            updated_at=c.updated_at,
            created_by=c.created_by,
            approved_by=c.approved_by,
            approved_at=c.approved_at,
            owner_name=c.owner.display_name if c.owner else None,
            department_name=c.department.name if c.department else None
        )
        for c in controls
    ]


@router.post("", response_model=InternalControlResponse, status_code=status.HTTP_201_CREATED)
def create_internal_control(
    control: InternalControlCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    
    existing = db.query(InternalControl).filter(
        InternalControl.tenant_id == tenant_id,
        InternalControl.control_id == control.control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Control ID '{control.control_id}' already exists for this tenant"
        )
    
    db_control = InternalControl(
        tenant_id=tenant_id,
        control_id=control.control_id,
        name=control.name,
        description=control.description,
        category=control.category,
        sub_category=control.sub_category,
        control_type=control.control_type,
        control_nature=control.control_nature,
        department_id=control.department_id,
        owner_id=control.owner_id,
        backup_owner_id=control.backup_owner_id,
        frequency=control.frequency,
        regulatory_source=control.regulatory_source,
        effective_date=control.effective_date,
        review_date=control.review_date,
        priority=control.priority,
        is_key_control=control.is_key_control,
        created_by=current_user.id
    )
    db.add(db_control)
    db.commit()
    db.refresh(db_control)
    return db_control


@router.post("/upload-manual", response_model=None)
def upload_internal_controls_manual(
    file: UploadFile = File(...),
    auto_create: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File name is missing")

    content = file.file.read()
    extracted = _extract_controls_from_upload(file.filename, content)
    enriched = _ai_enrich_controls(extracted)

    created = 0
    skipped = 0
    errors: List[str] = []

    if auto_create:
        existing_ids = {
            row[0] for row in db.query(InternalControl.control_id).filter(InternalControl.tenant_id == tenant_id).all()
        }
        sequence = db.query(func.count(InternalControl.id)).filter(InternalControl.tenant_id == tenant_id).scalar() or 0

        for idx, item in enumerate(enriched, start=1):
            try:
                control_id = str(item.get("control_id") or "").strip()
                if not control_id:
                    sequence += 1
                    control_id = f"IC-MAN-{sequence:04d}"

                if control_id in existing_ids:
                    skipped += 1
                    continue

                control_name = str(item.get("name") or "").strip()
                if not control_name:
                    skipped += 1
                    continue

                db_control = InternalControl(
                    tenant_id=tenant_id,
                    control_id=control_id,
                    name=control_name,
                    description=item.get("description"),
                    category=item.get("category"),
                    sub_category=item.get("sub_category"),
                    control_type=item.get("control_type") or "preventive",
                    control_nature=item.get("control_nature") or "manual",
                    frequency=item.get("frequency") or "monthly",
                    regulatory_source=item.get("regulatory_source"),
                    priority=item.get("priority") or "medium",
                    is_key_control=_normalize_bool(item.get("is_key_control", False)),
                    created_by=current_user.id
                )
                db.add(db_control)
                existing_ids.add(control_id)
                created += 1
            except Exception as exc:
                errors.append(f"Row {idx}: {str(exc)}")
                skipped += 1

        if created > 0:
            db.commit()

    return {
        "message": "Internal controls processed successfully",
        "file_name": file.filename,
        "auto_create": auto_create,
        "extracted_count": len(extracted),
        "suggested_count": len(enriched),
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "preview": enriched[:25]
    }


@router.get("/{control_id}", response_model=InternalControlDetailResponse)
def get_internal_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    control = db.query(InternalControl).options(
        joinedload(InternalControl.owner),
        joinedload(InternalControl.backup_owner),
        joinedload(InternalControl.department),
        joinedload(InternalControl.tests),
        joinedload(InternalControl.risk_links).joinedload(InternalControlRiskLink.risk),
        joinedload(InternalControl.framework_links),
        joinedload(InternalControl.escalations)
    ).filter(
        InternalControl.id == control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal control not found"
        )
    
    tests = [
        {
            "id": t.id,
            "test_type": t.test_type,
            "test_date": t.test_date.isoformat() if t.test_date else None,
            "result": t.result,
            "status": t.status,
            "exceptions_found": t.exceptions_found
        }
        for t in control.tests
    ]
    
    risk_links = [
        {
            "id": rl.id,
            "risk_id": rl.risk_id,
            "risk_title": rl.risk.title if rl.risk else None,
            "link_type": rl.link_type,
            "effectiveness_rating": rl.effectiveness_rating
        }
        for rl in control.risk_links
    ]
    
    framework_links = [
        {
            "id": fl.id,
            "framework_control_id": fl.framework_control_id,
            "normalized_control_id": fl.normalized_control_id,
            "mapping_type": fl.mapping_type,
            "coverage_percentage": fl.coverage_percentage
        }
        for fl in control.framework_links
    ]
    
    escalations = [
        {
            "id": e.id,
            "escalation_level": e.escalation_level,
            "escalation_name": e.escalation_name,
            "trigger_condition": e.trigger_condition,
            "is_active": e.is_active
        }
        for e in control.escalations
    ]
    
    return InternalControlDetailResponse(
        id=control.id,
        tenant_id=control.tenant_id,
        control_id=control.control_id,
        name=control.name,
        description=control.description,
        category=control.category,
        sub_category=control.sub_category,
        control_type=control.control_type,
        control_nature=control.control_nature,
        department_id=control.department_id,
        owner_id=control.owner_id,
        backup_owner_id=control.backup_owner_id,
        frequency=control.frequency,
        regulatory_source=control.regulatory_source,
        effective_date=control.effective_date,
        review_date=control.review_date,
        status=control.status,
        workflow_status=control.workflow_status,
        design_effectiveness=control.design_effectiveness,
        operating_effectiveness=control.operating_effectiveness,
        last_tested_at=control.last_tested_at,
        next_test_date=control.next_test_date,
        priority=control.priority,
        is_key_control=control.is_key_control,
        created_at=control.created_at,
        updated_at=control.updated_at,
        created_by=control.created_by,
        approved_by=control.approved_by,
        approved_at=control.approved_at,
        owner_name=control.owner.display_name if control.owner else None,
        backup_owner_name=control.backup_owner.display_name if control.backup_owner else None,
        department_name=control.department.name if control.department else None,
        tests=tests,
        risk_links=risk_links,
        framework_links=framework_links,
        escalations=escalations
    )


@router.put("/{control_id}", response_model=InternalControlResponse)
def update_internal_control(
    control_id: int,
    control_update: InternalControlUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    update_data = control_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(control, field, value)
    
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    return control


@router.delete("/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_internal_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    db.delete(control)
    db.commit()
    return None


@router.post("/{control_id}/submit", response_model=MessageResponse)
def submit_control_for_approval(
    control_id: int,
    action_data: InternalControlWorkflowActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    if control.status not in ["draft", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot submit control with status '{control.status}'"
        )
    
    from_status = control.status
    control.status = "pending_approval"
    control.workflow_status = "pending_review"
    control.updated_at = datetime.utcnow()
    
    workflow_action = InternalControlWorkflowAction(
        control_id=control_id,
        action="submit",
        action_by=current_user.id,
        from_status=from_status,
        to_status="pending_approval",
        comments=action_data.comments
    )
    db.add(workflow_action)
    db.commit()
    
    return MessageResponse(message="Control submitted for approval")


@router.post("/{control_id}/approve", response_model=MessageResponse)
def approve_control(
    control_id: int,
    action_data: InternalControlWorkflowActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    if control.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control is not pending approval"
        )
    
    from_status = control.status
    control.status = "active"
    control.workflow_status = "approved"
    control.approved_by = current_user.id
    control.approved_at = datetime.utcnow()
    control.updated_at = datetime.utcnow()
    
    workflow_action = InternalControlWorkflowAction(
        control_id=control_id,
        action="approve",
        action_by=current_user.id,
        from_status=from_status,
        to_status="active",
        comments=action_data.comments
    )
    db.add(workflow_action)
    db.commit()
    
    return MessageResponse(message="Control approved successfully")


@router.post("/{control_id}/reject", response_model=MessageResponse)
def reject_control(
    control_id: int,
    action_data: InternalControlWorkflowActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    if control.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control is not pending approval"
        )
    
    from_status = control.status
    control.status = "rejected"
    control.workflow_status = "rejected"
    control.updated_at = datetime.utcnow()
    
    workflow_action = InternalControlWorkflowAction(
        control_id=control_id,
        action="reject",
        action_by=current_user.id,
        from_status=from_status,
        to_status="rejected",
        comments=action_data.comments
    )
    db.add(workflow_action)
    db.commit()
    
    return MessageResponse(message="Control rejected")


@router.get("/{control_id}/workflow-history", response_model=List[InternalControlWorkflowActionResponse])
def get_workflow_history(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    actions = db.query(InternalControlWorkflowAction).options(
        joinedload(InternalControlWorkflowAction.actor)
    ).filter(
        InternalControlWorkflowAction.control_id == control_id
    ).order_by(InternalControlWorkflowAction.action_at.desc()).all()
    
    return [
        InternalControlWorkflowActionResponse(
            id=a.id,
            control_id=a.control_id,
            action=a.action,
            action_by=a.action_by,
            action_at=a.action_at,
            from_status=a.from_status,
            to_status=a.to_status,
            comments=a.comments,
            actor_name=a.actor.display_name if a.actor else None
        )
        for a in actions
    ]


@router.get("/{control_id}/tests", response_model=List[InternalControlTestResponse])
def list_control_tests(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    tests = db.query(InternalControlTest).options(
        joinedload(InternalControlTest.tester),
        joinedload(InternalControlTest.reviewer)
    ).filter(
        InternalControlTest.control_id == control_id
    ).order_by(InternalControlTest.test_date.desc()).all()
    
    return [
        InternalControlTestResponse(
            id=t.id,
            control_id=t.control_id,
            tenant_id=t.tenant_id,
            test_type=t.test_type,
            test_date=t.test_date,
            test_period_start=t.test_period_start,
            test_period_end=t.test_period_end,
            tester_id=t.tester_id,
            reviewer_id=t.reviewer_id,
            sample_size=t.sample_size,
            exceptions_found=t.exceptions_found,
            result=t.result,
            findings=t.findings,
            recommendations=t.recommendations,
            management_response=t.management_response,
            evidence_references=t.evidence_references or [],
            status=t.status,
            reviewed_at=t.reviewed_at,
            created_at=t.created_at,
            tester_name=t.tester.display_name if t.tester else None,
            reviewer_name=t.reviewer.display_name if t.reviewer else None
        )
        for t in tests
    ]


@router.post("/{control_id}/tests", response_model=InternalControlTestResponse, status_code=status.HTTP_201_CREATED)
def create_control_test(
    control_id: int,
    test_data: InternalControlTestCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    db_test = InternalControlTest(
        control_id=control_id,
        tenant_id=control.tenant_id,
        test_type=test_data.test_type,
        test_period_start=test_data.test_period_start,
        test_period_end=test_data.test_period_end,
        tester_id=current_user.id,
        sample_size=test_data.sample_size,
        exceptions_found=test_data.exceptions_found,
        result=test_data.result,
        findings=test_data.findings,
        recommendations=test_data.recommendations,
        evidence_references=test_data.evidence_references
    )
    db.add(db_test)
    
    if test_data.test_type == "design":
        control.design_effectiveness = test_data.result
    elif test_data.test_type == "operating":
        control.operating_effectiveness = test_data.result
    control.last_tested_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_test)
    
    return InternalControlTestResponse(
        id=db_test.id,
        control_id=db_test.control_id,
        tenant_id=db_test.tenant_id,
        test_type=db_test.test_type,
        test_date=db_test.test_date,
        test_period_start=db_test.test_period_start,
        test_period_end=db_test.test_period_end,
        tester_id=db_test.tester_id,
        reviewer_id=db_test.reviewer_id,
        sample_size=db_test.sample_size,
        exceptions_found=db_test.exceptions_found,
        result=db_test.result,
        findings=db_test.findings,
        recommendations=db_test.recommendations,
        management_response=db_test.management_response,
        evidence_references=db_test.evidence_references or [],
        status=db_test.status,
        reviewed_at=db_test.reviewed_at,
        created_at=db_test.created_at,
        tester_name=current_user.display_name
    )


@router.put("/{control_id}/tests/{test_id}", response_model=InternalControlTestResponse)
def update_control_test(
    control_id: int,
    test_id: int,
    test_update: InternalControlTestUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    test = db.query(InternalControlTest).filter(
        InternalControlTest.id == test_id,
        InternalControlTest.control_id == control_id
    ).first()
    
    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test not found"
        )
    
    update_data = test_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(test, field, value)
    
    if test_update.result:
        if test.test_type == "design":
            control.design_effectiveness = test_update.result
        elif test.test_type == "operating":
            control.operating_effectiveness = test_update.result
    
    db.commit()
    db.refresh(test)
    
    return InternalControlTestResponse(
        id=test.id,
        control_id=test.control_id,
        tenant_id=test.tenant_id,
        test_type=test.test_type,
        test_date=test.test_date,
        test_period_start=test.test_period_start,
        test_period_end=test.test_period_end,
        tester_id=test.tester_id,
        reviewer_id=test.reviewer_id,
        sample_size=test.sample_size,
        exceptions_found=test.exceptions_found,
        result=test.result,
        findings=test.findings,
        recommendations=test.recommendations,
        management_response=test.management_response,
        evidence_references=test.evidence_references or [],
        status=test.status,
        reviewed_at=test.reviewed_at,
        created_at=test.created_at,
        tester_name=test.tester.display_name if test.tester else None,
        reviewer_name=test.reviewer.display_name if test.reviewer else None
    )


@router.get("/{control_id}/risks", response_model=List[InternalControlRiskLinkResponse])
def list_linked_risks(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    links = db.query(InternalControlRiskLink).options(
        joinedload(InternalControlRiskLink.risk)
    ).filter(
        InternalControlRiskLink.control_id == control_id
    ).all()
    
    return [
        InternalControlRiskLinkResponse(
            id=link.id,
            control_id=link.control_id,
            risk_id=link.risk_id,
            link_type=link.link_type,
            effectiveness_rating=link.effectiveness_rating,
            notes=link.notes,
            created_at=link.created_at,
            created_by=link.created_by,
            risk_title=link.risk.title if link.risk else None
        )
        for link in links
    ]


@router.post("/{control_id}/risks", response_model=InternalControlRiskLinkResponse, status_code=status.HTTP_201_CREATED)
def link_control_to_risk(
    control_id: int,
    link_data: InternalControlRiskLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    risk = db.query(Risk).filter(
        Risk.id == link_data.risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    if risk.tenant_id != control.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Risk must belong to the same tenant as the control"
        )
    
    existing = db.query(InternalControlRiskLink).filter(
        InternalControlRiskLink.control_id == control_id,
        InternalControlRiskLink.risk_id == link_data.risk_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = InternalControlRiskLink(
        control_id=control_id,
        risk_id=link_data.risk_id,
        link_type=link_data.link_type,
        effectiveness_rating=link_data.effectiveness_rating,
        notes=link_data.notes,
        created_by=current_user.id
    )
    db.add(db_link)
    db.commit()
    db.refresh(db_link)
    
    return InternalControlRiskLinkResponse(
        id=db_link.id,
        control_id=db_link.control_id,
        risk_id=db_link.risk_id,
        link_type=db_link.link_type,
        effectiveness_rating=db_link.effectiveness_rating,
        notes=db_link.notes,
        created_at=db_link.created_at,
        created_by=db_link.created_by,
        risk_title=risk.title
    )


@router.delete("/{control_id}/risks/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_control_from_risk(
    control_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    link = db.query(InternalControlRiskLink).filter(
        InternalControlRiskLink.id == link_id,
        InternalControlRiskLink.control_id == control_id
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.get("/{control_id}/escalations", response_model=List[InternalControlEscalationResponse])
def list_escalations(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    escalations = db.query(InternalControlEscalation).options(
        joinedload(InternalControlEscalation.escalate_to_user),
        joinedload(InternalControlEscalation.escalate_to_department)
    ).filter(
        InternalControlEscalation.control_id == control_id
    ).order_by(InternalControlEscalation.escalation_level).all()
    
    return [
        InternalControlEscalationResponse(
            id=e.id,
            control_id=e.control_id,
            tenant_id=e.tenant_id,
            escalation_level=e.escalation_level,
            escalation_name=e.escalation_name,
            trigger_condition=e.trigger_condition,
            trigger_threshold=e.trigger_threshold,
            escalate_to_user_id=e.escalate_to_user_id,
            escalate_to_role=e.escalate_to_role,
            escalate_to_department_id=e.escalate_to_department_id,
            escalation_timeframe_hours=e.escalation_timeframe_hours,
            notification_required=e.notification_required,
            is_active=e.is_active,
            created_at=e.created_at,
            escalate_to_user_name=e.escalate_to_user.display_name if e.escalate_to_user else None,
            escalate_to_department_name=e.escalate_to_department.name if e.escalate_to_department else None
        )
        for e in escalations
    ]


@router.post("/{control_id}/escalations", response_model=InternalControlEscalationResponse, status_code=status.HTTP_201_CREATED)
def create_escalation(
    control_id: int,
    escalation_data: InternalControlEscalationCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    db_escalation = InternalControlEscalation(
        control_id=control_id,
        tenant_id=control.tenant_id,
        escalation_level=escalation_data.escalation_level,
        escalation_name=escalation_data.escalation_name,
        trigger_condition=escalation_data.trigger_condition,
        trigger_threshold=escalation_data.trigger_threshold,
        escalate_to_user_id=escalation_data.escalate_to_user_id,
        escalate_to_role=escalation_data.escalate_to_role,
        escalate_to_department_id=escalation_data.escalate_to_department_id,
        escalation_timeframe_hours=escalation_data.escalation_timeframe_hours,
        notification_required=escalation_data.notification_required,
        is_active=escalation_data.is_active
    )
    db.add(db_escalation)
    db.commit()
    db.refresh(db_escalation)
    
    return InternalControlEscalationResponse(
        id=db_escalation.id,
        control_id=db_escalation.control_id,
        tenant_id=db_escalation.tenant_id,
        escalation_level=db_escalation.escalation_level,
        escalation_name=db_escalation.escalation_name,
        trigger_condition=db_escalation.trigger_condition,
        trigger_threshold=db_escalation.trigger_threshold,
        escalate_to_user_id=db_escalation.escalate_to_user_id,
        escalate_to_role=db_escalation.escalate_to_role,
        escalate_to_department_id=db_escalation.escalate_to_department_id,
        escalation_timeframe_hours=db_escalation.escalation_timeframe_hours,
        notification_required=db_escalation.notification_required,
        is_active=db_escalation.is_active,
        created_at=db_escalation.created_at
    )


@router.put("/{control_id}/escalations/{esc_id}", response_model=InternalControlEscalationResponse)
def update_escalation(
    control_id: int,
    esc_id: int,
    escalation_update: InternalControlEscalationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    escalation = db.query(InternalControlEscalation).filter(
        InternalControlEscalation.id == esc_id,
        InternalControlEscalation.control_id == control_id
    ).first()
    
    if not escalation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Escalation not found"
        )
    
    update_data = escalation_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(escalation, field, value)
    
    db.commit()
    db.refresh(escalation)
    
    return InternalControlEscalationResponse(
        id=escalation.id,
        control_id=escalation.control_id,
        tenant_id=escalation.tenant_id,
        escalation_level=escalation.escalation_level,
        escalation_name=escalation.escalation_name,
        trigger_condition=escalation.trigger_condition,
        trigger_threshold=escalation.trigger_threshold,
        escalate_to_user_id=escalation.escalate_to_user_id,
        escalate_to_role=escalation.escalate_to_role,
        escalate_to_department_id=escalation.escalate_to_department_id,
        escalation_timeframe_hours=escalation.escalation_timeframe_hours,
        notification_required=escalation.notification_required,
        is_active=escalation.is_active,
        created_at=escalation.created_at,
        escalate_to_user_name=escalation.escalate_to_user.display_name if escalation.escalate_to_user else None,
        escalate_to_department_name=escalation.escalate_to_department.name if escalation.escalate_to_department else None
    )


@router.delete("/{control_id}/escalations/{esc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_escalation(
    control_id: int,
    esc_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    escalation = db.query(InternalControlEscalation).filter(
        InternalControlEscalation.id == esc_id,
        InternalControlEscalation.control_id == control_id
    ).first()
    
    if not escalation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Escalation not found"
        )
    
    db.delete(escalation)
    db.commit()
    return None


@router.get("/{control_id}/framework-links", response_model=List[InternalControlFrameworkLinkResponse])
def list_framework_links(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    links = db.query(InternalControlFrameworkLink).options(
        joinedload(InternalControlFrameworkLink.framework_control),
        joinedload(InternalControlFrameworkLink.normalized_control)
    ).filter(
        InternalControlFrameworkLink.internal_control_id == control_id
    ).all()
    
    return [
        InternalControlFrameworkLinkResponse(
            id=link.id,
            internal_control_id=link.internal_control_id,
            framework_control_id=link.framework_control_id,
            normalized_control_id=link.normalized_control_id,
            mapping_type=link.mapping_type,
            coverage_percentage=link.coverage_percentage,
            notes=link.notes,
            created_at=link.created_at,
            created_by=link.created_by,
            framework_control_code=link.framework_control.code if link.framework_control else None,
            framework_control_name=link.framework_control.name if link.framework_control else None,
            normalized_control_code=link.normalized_control.code if link.normalized_control else None,
            normalized_control_name=link.normalized_control.name if link.normalized_control else None
        )
        for link in links
    ]


@router.post("/{control_id}/framework-links", response_model=InternalControlFrameworkLinkResponse, status_code=status.HTTP_201_CREATED)
def create_framework_link(
    control_id: int,
    link_data: InternalControlFrameworkLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    if not link_data.framework_control_id and not link_data.normalized_control_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must specify either framework_control_id or normalized_control_id"
        )
    
    if link_data.framework_control_id:
        fc = db.query(FrameworkControl).filter(
            FrameworkControl.id == link_data.framework_control_id
        ).first()
        if not fc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework control not found"
            )
    
    if link_data.normalized_control_id:
        nc = db.query(NormalizedControl).filter(
            NormalizedControl.id == link_data.normalized_control_id
        ).first()
        if not nc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Normalized control not found"
            )
    
    existing_link = db.query(InternalControlFrameworkLink).filter(
        InternalControlFrameworkLink.internal_control_id == control_id,
        InternalControlFrameworkLink.framework_control_id == link_data.framework_control_id if link_data.framework_control_id else True,
        InternalControlFrameworkLink.normalized_control_id == link_data.normalized_control_id if link_data.normalized_control_id else True
    ).first()
    if existing_link:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Framework link already exists"
        )
    
    db_link = InternalControlFrameworkLink(
        internal_control_id=control_id,
        framework_control_id=link_data.framework_control_id,
        normalized_control_id=link_data.normalized_control_id,
        mapping_type=link_data.mapping_type,
        coverage_percentage=link_data.coverage_percentage,
        notes=link_data.notes,
        created_by=current_user.id
    )
    db.add(db_link)
    db.commit()
    db.refresh(db_link)
    
    fc = db.query(FrameworkControl).filter(FrameworkControl.id == db_link.framework_control_id).first() if db_link.framework_control_id else None
    nc = db.query(NormalizedControl).filter(NormalizedControl.id == db_link.normalized_control_id).first() if db_link.normalized_control_id else None
    
    return InternalControlFrameworkLinkResponse(
        id=db_link.id,
        internal_control_id=db_link.internal_control_id,
        framework_control_id=db_link.framework_control_id,
        normalized_control_id=db_link.normalized_control_id,
        mapping_type=db_link.mapping_type,
        coverage_percentage=db_link.coverage_percentage,
        notes=db_link.notes,
        created_at=db_link.created_at,
        created_by=db_link.created_by,
        framework_control_code=fc.code if fc else None,
        framework_control_name=fc.name if fc else None,
        normalized_control_code=nc.code if nc else None,
        normalized_control_name=nc.name if nc else None
    )


@router.delete("/{control_id}/framework-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_framework_link(
    control_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_control_or_404(control_id, user_tenants, db)
    
    link = db.query(InternalControlFrameworkLink).filter(
        InternalControlFrameworkLink.id == link_id,
        InternalControlFrameworkLink.internal_control_id == control_id
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework link not found"
        )
    
    db.delete(link)
    db.commit()
    return None
