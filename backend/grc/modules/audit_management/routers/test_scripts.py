import json
import os
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    AuditTestScript, AuditEngagement, AuditWorkpaper, AuditFinding,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/test-scripts", tags=["Audit - Test Scripts"])


class TestScriptCreate(BaseModel):
    title: str
    objective: Optional[str] = None
    procedure_steps: Optional[list] = []
    control_area: Optional[str] = None
    entity_type: Optional[str] = None
    framework_id: Optional[int] = None
    test_type: Optional[str] = "control_test"
    sampling_methodology: Optional[str] = None
    expected_evidence: Optional[str] = None
    tags: Optional[list] = []


class TestScriptUpdate(BaseModel):
    title: Optional[str] = None
    objective: Optional[str] = None
    procedure_steps: Optional[list] = None
    control_area: Optional[str] = None
    entity_type: Optional[str] = None
    framework_id: Optional[int] = None
    test_type: Optional[str] = None
    sampling_methodology: Optional[str] = None
    expected_evidence: Optional[str] = None
    tags: Optional[list] = None


class CloneToEngagementRequest(BaseModel):
    engagement_id: int


class GenerateFromEngagementRequest(BaseModel):
    engagement_id: int
    control_area: Optional[str] = None
    focus_area: Optional[str] = None
    create_scripts: Optional[bool] = True
    max_scripts: Optional[int] = 3


def get_openai_client() -> Optional[OpenAI]:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        return None
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def serialize_test_script(s: AuditTestScript) -> dict:
    return {
        "id": s.id,
        "title": s.title,
        "objective": s.objective,
        "procedure_steps": s.procedure_steps or [],
        "control_area": s.control_area,
        "entity_type": s.entity_type,
        "framework_id": s.framework_id,
        "test_type": s.test_type,
        "sampling_methodology": s.sampling_methodology,
        "expected_evidence": s.expected_evidence,
        "tags": s.tags or [],
        "usage_count": s.usage_count or 0,
        "last_used_date": s.last_used_date.isoformat() if s.last_used_date else None,
        "created_by": s.created_by.display_name if s.created_by else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("")
def list_test_scripts(
    control_area: Optional[str] = None,
    entity_type: Optional[str] = None,
    search: Optional[str] = None,
    test_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"test_scripts": [], "total": 0}

    query = db.query(AuditTestScript).filter(AuditTestScript.tenant_id.in_(user_tenants))

    if control_area:
        query = query.filter(AuditTestScript.control_area == control_area)
    if entity_type:
        query = query.filter(AuditTestScript.entity_type == entity_type)
    if test_type:
        query = query.filter(AuditTestScript.test_type == test_type)
    if search:
        query = query.filter(
            or_(
                AuditTestScript.title.ilike(f"%{search}%"),
                AuditTestScript.objective.ilike(f"%{search}%")
            )
        )

    scripts = query.order_by(AuditTestScript.created_at.desc()).all()
    return {"test_scripts": [serialize_test_script(s) for s in scripts], "total": len(scripts)}


@router.get("/{script_id}")
def get_test_script(
    script_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    script = db.query(AuditTestScript).filter(
        AuditTestScript.id == script_id,
        AuditTestScript.tenant_id.in_(user_tenants)
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Test script not found")
    return serialize_test_script(script)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_test_script(
    data: TestScriptCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    primary_tenant = get_user_primary_tenant(current_user, db)
    if not primary_tenant:
        raise HTTPException(status_code=400, detail="No tenant assigned")

    script = AuditTestScript(
        tenant_id=primary_tenant,
        title=data.title,
        objective=data.objective,
        procedure_steps=data.procedure_steps or [],
        control_area=data.control_area,
        entity_type=data.entity_type,
        framework_id=data.framework_id,
        test_type=data.test_type,
        sampling_methodology=data.sampling_methodology,
        expected_evidence=data.expected_evidence,
        tags=data.tags or [],
        created_by_id=current_user.id,
    )
    db.add(script)
    db.commit()
    db.refresh(script)
    return serialize_test_script(script)


@router.put("/{script_id}")
def update_test_script(
    script_id: int,
    data: TestScriptUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    script = db.query(AuditTestScript).filter(
        AuditTestScript.id == script_id,
        AuditTestScript.tenant_id.in_(user_tenants)
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Test script not found")

    for field, value in data.dict(exclude_unset=True).items():
        setattr(script, field, value)

    script.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(script)
    return serialize_test_script(script)


@router.delete("/{script_id}")
def delete_test_script(
    script_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    script = db.query(AuditTestScript).filter(
        AuditTestScript.id == script_id,
        AuditTestScript.tenant_id.in_(user_tenants)
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Test script not found")

    db.delete(script)
    db.commit()
    return {"message": "Test script deleted"}


@router.post("/{script_id}/clone-to-engagement", status_code=status.HTTP_201_CREATED)
def clone_to_engagement(
    script_id: int,
    data: CloneToEngagementRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    script = db.query(AuditTestScript).filter(
        AuditTestScript.id == script_id,
        AuditTestScript.tenant_id.in_(user_tenants)
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Test script not found")

    engagement = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not engagement:
        raise HTTPException(status_code=404, detail="Engagement not found")

    workpaper = AuditWorkpaper(
        engagement_id=data.engagement_id,
        title=f"Test: {script.title}",
        description=json.dumps(script.procedure_steps or []),
        workpaper_type="test_procedure",
        reference_number=f"TS-{script.id}",
        preparer_id=current_user.id,
        prepared_at=datetime.utcnow(),
    )
    db.add(workpaper)

    script.usage_count = (script.usage_count or 0) + 1
    script.last_used_date = datetime.utcnow()

    db.commit()
    db.refresh(workpaper)

    return {
        "id": workpaper.id,
        "title": workpaper.title,
        "workpaper_type": workpaper.workpaper_type,
        "reference_number": workpaper.reference_number,
        "engagement_id": workpaper.engagement_id,
        "message": "Test script cloned to engagement as workpaper",
    }


@router.post("/generate-from-engagement")
def generate_test_scripts_from_engagement(
    data: GenerateFromEngagementRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    engagement = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not engagement:
        raise HTTPException(status_code=404, detail="Engagement not found")

    findings = db.query(AuditFinding).filter(
        AuditFinding.engagement_id == engagement.id,
        AuditFinding.tenant_id.in_(user_tenants)
    ).order_by(AuditFinding.created_at.desc()).limit(10).all()

    findings_context = [
        {
            "title": f.title,
            "severity": f.severity,
            "theme": f.theme,
            "condition": f.condition,
        }
        for f in findings
    ]

    generated_scripts = []
    client = get_openai_client()

    if client:
        try:
            completion = client.chat.completions.create(
                model="gpt-4o",
                temperature=0.2,
                messages=[
                    {
                        "role": "system",
                        "content": "Return strict JSON object with key scripts (array). Each script must include title, objective, procedure_steps (array of strings), control_area, test_type, sampling_methodology, expected_evidence, tags (array)."
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "engagement": {
                                "title": engagement.title,
                                "type": engagement.engagement_type,
                                "scope": engagement.scope,
                                "objectives": engagement.objectives,
                                "methodology": engagement.methodology,
                            },
                            "focus_area": data.focus_area,
                            "control_area": data.control_area,
                            "findings": findings_context,
                            "max_scripts": min(max(data.max_scripts or 3, 1), 5),
                        })
                    },
                ],
            )
            content = (completion.choices[0].message.content or "{}").strip()
            parsed = json.loads(content)
            generated_scripts = parsed.get("scripts") or []
        except Exception:
            generated_scripts = []

    if not generated_scripts:
        base_area = data.control_area or "general controls"
        generated_scripts = [
            {
                "title": f"{engagement.title} - {base_area.title()} Test Script",
                "objective": f"Validate design and operating effectiveness for {base_area} in this engagement.",
                "procedure_steps": [
                    "Obtain and review policy/procedure documentation.",
                    "Select a representative sample and inspect evidence.",
                    "Reperform a control step and document exceptions.",
                    "Conclude on control effectiveness and residual risk.",
                ],
                "control_area": base_area,
                "test_type": "control_test",
                "sampling_methodology": "risk_based",
                "expected_evidence": "Policy records, approvals, logs, and exception artifacts.",
                "tags": ["ai-generated", engagement.engagement_type or "assurance"],
            }
        ]

    created = []
    if data.create_scripts:
        for script in generated_scripts[: min(max(data.max_scripts or 3, 1), 5)]:
            row = AuditTestScript(
                tenant_id=engagement.tenant_id,
                title=script.get("title") or f"{engagement.title} Test Script",
                objective=script.get("objective"),
                procedure_steps=script.get("procedure_steps") or [],
                control_area=script.get("control_area") or data.control_area,
                entity_type=engagement.engagement_type,
                framework_id=engagement.framework_id,
                test_type=script.get("test_type") or "control_test",
                sampling_methodology=script.get("sampling_methodology") or "risk_based",
                expected_evidence=script.get("expected_evidence"),
                tags=script.get("tags") or ["ai-generated"],
                created_by_id=current_user.id,
            )
            db.add(row)
            db.flush()
            created.append(serialize_test_script(row))
        db.commit()

    return {
        "engagement_id": engagement.id,
        "generated_count": len(generated_scripts),
        "created_count": len(created),
        "scripts": created if data.create_scripts else generated_scripts,
    }
