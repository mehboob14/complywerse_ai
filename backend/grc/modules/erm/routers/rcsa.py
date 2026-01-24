from typing import List, Optional
from datetime import datetime
from io import BytesIO
import os
import json

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

try:
    import openpyxl
    from openpyxl import Workbook
except ImportError:
    openpyxl = None

try:
    from openai import OpenAI
    client = OpenAI()
except Exception:
    client = None

from ....models import (
    RCSATemplate, RCSAQuestion, RCSACampaign, RCSAAssessment,
    RCSAResponse, RCSAFinding, RCSAApprovalWorkflow, RCSAApprovalTier,
    RCSAApprovalHistory, Risk, InternalControl, RiskMitigationAction,
    BusinessUnit, GRCUser, Tenant, get_db
)
from ....schemas import (
    RCSATemplateCreate, RCSATemplateUpdate, RCSATemplateResponse, RCSATemplateDetailResponse,
    RCSAQuestionCreate, RCSAQuestionUpdate, RCSAQuestionResponse,
    RCSACampaignCreate, RCSACampaignUpdate, RCSACampaignResponse,
    RCSAAssessmentResponse, RCSAResponseCreate, RCSAResponseUpdate, RCSAResponseResponse,
    RCSABulkResponseSave, RCSAFindingCreate, RCSAFindingUpdate, RCSAFindingResponse,
    RCSAApprovalWorkflowCreate, RCSAApprovalWorkflowUpdate, RCSAApprovalWorkflowResponse,
    RCSAApprovalTierCreate, RCSAApprovalTierResponse, RCSAApprovalHistoryResponse,
    RCSAApprovalAction, RCSADelegateAction, RCSABUAssignRequest,
    RCSADashboardSummary, RCSAFindingsBySeverity, RCSABUProgress, RCSAAISuggestionResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/rcsa", tags=["RCSA - Risk and Control Self-Assessment"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


# =============================================================================
# Template Management Endpoints
# =============================================================================

@router.get("/templates", response_model=List[RCSATemplateResponse])
def list_templates(
    tenant_id: Optional[int] = None,
    category: Optional[str] = None,
    source: Optional[str] = None,
    include_system: bool = True,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSATemplate).filter(
        or_(
            RCSATemplate.tenant_id.in_(user_tenants),
            and_(RCSATemplate.is_system_template == True, include_system)
        ),
        RCSATemplate.is_active == True
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(
            or_(
                RCSATemplate.tenant_id == tenant_id,
                RCSATemplate.is_system_template == True
            )
        )
    if category:
        query = query.filter(RCSATemplate.category == category)
    if source:
        query = query.filter(RCSATemplate.source == source)
    
    templates = query.order_by(RCSATemplate.name).offset(skip).limit(limit).all()
    
    return [
        RCSATemplateResponse(
            id=t.id,
            tenant_id=t.tenant_id,
            name=t.name,
            description=t.description,
            category=t.category,
            source=t.source,
            version=t.version,
            is_system_template=t.is_system_template,
            is_active=t.is_active,
            risk_categories=t.risk_categories or [],
            regulatory_mapping=t.regulatory_mapping or {},
            created_by=t.created_by,
            created_at=t.created_at,
            updated_at=t.updated_at,
            question_count=len(t.questions)
        )
        for t in templates
    ]


@router.get("/templates/{template_id}", response_model=RCSATemplateDetailResponse)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(RCSATemplate).options(
        joinedload(RCSATemplate.questions)
    ).filter(
        RCSATemplate.id == template_id,
        or_(
            RCSATemplate.tenant_id.in_(user_tenants),
            RCSATemplate.is_system_template == True
        )
    ).first()
    
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    return RCSATemplateDetailResponse(
        id=template.id,
        tenant_id=template.tenant_id,
        name=template.name,
        description=template.description,
        category=template.category,
        source=template.source,
        version=template.version,
        is_system_template=template.is_system_template,
        is_active=template.is_active,
        risk_categories=template.risk_categories or [],
        regulatory_mapping=template.regulatory_mapping or {},
        created_by=template.created_by,
        created_at=template.created_at,
        updated_at=template.updated_at,
        question_count=len(template.questions),
        questions=[
            RCSAQuestionResponse(
                id=q.id,
                template_id=q.template_id,
                section=q.section,
                question_order=q.question_order,
                question_text=q.question_text,
                question_type=q.question_type,
                is_required=q.is_required,
                options=q.options or [],
                risk_category=q.risk_category,
                control_objective=q.control_objective,
                guidance_text=q.guidance_text,
                ai_suggestion_enabled=q.ai_suggestion_enabled,
                created_at=q.created_at
            )
            for q in sorted(template.questions, key=lambda x: (x.section or "", x.question_order))
        ]
    )


@router.post("/templates", response_model=RCSATemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    template: RCSATemplateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    db_template = RCSATemplate(
        tenant_id=tenant_id,
        name=template.name,
        description=template.description,
        category=template.category,
        source=template.source,
        version=template.version,
        is_system_template=False,
        risk_categories=template.risk_categories,
        regulatory_mapping=template.regulatory_mapping,
        created_by=current_user.id
    )
    db.add(db_template)
    db.flush()
    
    for q in template.questions:
        db_question = RCSAQuestion(
            template_id=db_template.id,
            section=q.section,
            question_order=q.question_order,
            question_text=q.question_text,
            question_type=q.question_type,
            is_required=q.is_required,
            options=q.options,
            risk_category=q.risk_category,
            control_objective=q.control_objective,
            guidance_text=q.guidance_text,
            ai_suggestion_enabled=q.ai_suggestion_enabled
        )
        db.add(db_question)
    
    db.commit()
    db.refresh(db_template)
    
    return RCSATemplateResponse(
        id=db_template.id,
        tenant_id=db_template.tenant_id,
        name=db_template.name,
        description=db_template.description,
        category=db_template.category,
        source=db_template.source,
        version=db_template.version,
        is_system_template=db_template.is_system_template,
        is_active=db_template.is_active,
        risk_categories=db_template.risk_categories or [],
        regulatory_mapping=db_template.regulatory_mapping or {},
        created_by=db_template.created_by,
        created_at=db_template.created_at,
        updated_at=db_template.updated_at,
        question_count=len(template.questions)
    )


@router.put("/templates/{template_id}", response_model=RCSATemplateResponse)
def update_template(
    template_id: int,
    template: RCSATemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_template = db.query(RCSATemplate).filter(
        RCSATemplate.id == template_id,
        RCSATemplate.tenant_id.in_(user_tenants),
        RCSATemplate.is_system_template == False
    ).first()
    
    if not db_template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or not editable")
    
    update_data = template.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_template, key, value)
    
    db.commit()
    db.refresh(db_template)
    
    return RCSATemplateResponse(
        id=db_template.id,
        tenant_id=db_template.tenant_id,
        name=db_template.name,
        description=db_template.description,
        category=db_template.category,
        source=db_template.source,
        version=db_template.version,
        is_system_template=db_template.is_system_template,
        is_active=db_template.is_active,
        risk_categories=db_template.risk_categories or [],
        regulatory_mapping=db_template.regulatory_mapping or {},
        created_by=db_template.created_by,
        created_at=db_template.created_at,
        updated_at=db_template.updated_at,
        question_count=len(db_template.questions)
    )


@router.delete("/templates/{template_id}", response_model=MessageResponse)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_template = db.query(RCSATemplate).filter(
        RCSATemplate.id == template_id,
        RCSATemplate.tenant_id.in_(user_tenants),
        RCSATemplate.is_system_template == False
    ).first()
    
    if not db_template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or cannot be deleted")
    
    campaign_count = db.query(RCSACampaign).filter(RCSACampaign.template_id == template_id).count()
    if campaign_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete template. It is used by {campaign_count} campaign(s)"
        )
    
    db.delete(db_template)
    db.commit()
    
    return MessageResponse(message="Template deleted successfully", id=template_id)


@router.post("/templates/{template_id}/clone", response_model=RCSATemplateResponse)
def clone_template(
    template_id: int,
    new_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    source_template = db.query(RCSATemplate).options(
        joinedload(RCSATemplate.questions)
    ).filter(
        RCSATemplate.id == template_id,
        or_(
            RCSATemplate.tenant_id.in_(user_tenants),
            RCSATemplate.is_system_template == True
        )
    ).first()
    
    if not source_template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    cloned_template = RCSATemplate(
        tenant_id=tenant_id,
        name=new_name or f"{source_template.name} (Copy)",
        description=source_template.description,
        category=source_template.category,
        source="custom",
        version="1.0",
        is_system_template=False,
        risk_categories=source_template.risk_categories,
        regulatory_mapping=source_template.regulatory_mapping,
        created_by=current_user.id
    )
    db.add(cloned_template)
    db.flush()
    
    for q in source_template.questions:
        db_question = RCSAQuestion(
            template_id=cloned_template.id,
            section=q.section,
            question_order=q.question_order,
            question_text=q.question_text,
            question_type=q.question_type,
            is_required=q.is_required,
            options=q.options,
            risk_category=q.risk_category,
            control_objective=q.control_objective,
            guidance_text=q.guidance_text,
            ai_suggestion_enabled=q.ai_suggestion_enabled
        )
        db.add(db_question)
    
    db.commit()
    db.refresh(cloned_template)
    
    return RCSATemplateResponse(
        id=cloned_template.id,
        tenant_id=cloned_template.tenant_id,
        name=cloned_template.name,
        description=cloned_template.description,
        category=cloned_template.category,
        source=cloned_template.source,
        version=cloned_template.version,
        is_system_template=cloned_template.is_system_template,
        is_active=cloned_template.is_active,
        risk_categories=cloned_template.risk_categories or [],
        regulatory_mapping=cloned_template.regulatory_mapping or {},
        created_by=cloned_template.created_by,
        created_at=cloned_template.created_at,
        updated_at=cloned_template.updated_at,
        question_count=len(source_template.questions)
    )


@router.post("/templates/upload", response_model=RCSATemplateResponse)
async def upload_template(
    file: UploadFile = File(...),
    name: str = Query(...),
    category: str = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if openpyxl is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel support not available")
    
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    content = await file.read()
    
    try:
        if file.filename.endswith('.csv'):
            import csv
            from io import StringIO
            csv_content = content.decode('utf-8')
            reader = csv.DictReader(StringIO(csv_content))
            questions = []
            for i, row in enumerate(reader):
                questions.append(RCSAQuestionCreate(
                    section=row.get('section', ''),
                    question_order=i,
                    question_text=row.get('question_text', row.get('question', '')),
                    question_type=row.get('question_type', 'risk_rating'),
                    is_required=row.get('is_required', 'true').lower() == 'true',
                    risk_category=row.get('risk_category', None),
                    control_objective=row.get('control_objective', None),
                    guidance_text=row.get('guidance_text', None)
                ))
        else:
            wb = openpyxl.load_workbook(BytesIO(content))
            ws = wb.active
            headers = [cell.value for cell in ws[1]]
            questions = []
            for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True)):
                if not row[0]:
                    continue
                row_dict = dict(zip(headers, row))
                questions.append(RCSAQuestionCreate(
                    section=row_dict.get('section', ''),
                    question_order=i,
                    question_text=row_dict.get('question_text', row_dict.get('question', '')),
                    question_type=row_dict.get('question_type', 'risk_rating'),
                    is_required=str(row_dict.get('is_required', 'true')).lower() == 'true',
                    risk_category=row_dict.get('risk_category', None),
                    control_objective=row_dict.get('control_objective', None),
                    guidance_text=row_dict.get('guidance_text', None)
                ))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to parse file: {str(e)}")
    
    db_template = RCSATemplate(
        tenant_id=tenant_id,
        name=name,
        description=f"Uploaded from {file.filename}",
        category=category,
        source="custom",
        version="1.0",
        is_system_template=False,
        created_by=current_user.id
    )
    db.add(db_template)
    db.flush()
    
    for q in questions:
        db_question = RCSAQuestion(
            template_id=db_template.id,
            section=q.section,
            question_order=q.question_order,
            question_text=q.question_text,
            question_type=q.question_type,
            is_required=q.is_required,
            options=q.options,
            risk_category=q.risk_category,
            control_objective=q.control_objective,
            guidance_text=q.guidance_text,
            ai_suggestion_enabled=q.ai_suggestion_enabled
        )
        db.add(db_question)
    
    db.commit()
    db.refresh(db_template)
    
    return RCSATemplateResponse(
        id=db_template.id,
        tenant_id=db_template.tenant_id,
        name=db_template.name,
        description=db_template.description,
        category=db_template.category,
        source=db_template.source,
        version=db_template.version,
        is_system_template=db_template.is_system_template,
        is_active=db_template.is_active,
        risk_categories=db_template.risk_categories or [],
        regulatory_mapping=db_template.regulatory_mapping or {},
        created_by=db_template.created_by,
        created_at=db_template.created_at,
        updated_at=db_template.updated_at,
        question_count=len(questions)
    )


@router.get("/templates/download/{template_id}")
def download_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if openpyxl is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel support not available")
    
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(RCSATemplate).options(
        joinedload(RCSATemplate.questions)
    ).filter(
        RCSATemplate.id == template_id,
        or_(
            RCSATemplate.tenant_id.in_(user_tenants),
            RCSATemplate.is_system_template == True
        )
    ).first()
    
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    wb = Workbook()
    ws = wb.active
    ws.title = "RCSA Template"
    
    headers = ["section", "question_text", "question_type", "is_required", "risk_category", "control_objective", "guidance_text"]
    ws.append(headers)
    
    for q in sorted(template.questions, key=lambda x: (x.section or "", x.question_order)):
        ws.append([
            q.section,
            q.question_text,
            q.question_type,
            str(q.is_required),
            q.risk_category,
            q.control_objective,
            q.guidance_text
        ])
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"rcsa_template_{template.name.replace(' ', '_')}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# =============================================================================
# Campaign Management Endpoints
# =============================================================================

@router.get("/campaigns", response_model=List[RCSACampaignResponse])
def list_campaigns(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSACampaign).options(
        joinedload(RCSACampaign.template),
        joinedload(RCSACampaign.assessments)
    ).filter(RCSACampaign.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RCSACampaign.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(RCSACampaign.status == status_filter)
    
    campaigns = query.order_by(RCSACampaign.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        RCSACampaignResponse(
            id=c.id,
            tenant_id=c.tenant_id,
            template_id=c.template_id,
            template_name=c.template.name if c.template else None,
            name=c.name,
            description=c.description,
            period_type=c.period_type,
            period_label=c.period_label,
            start_date=c.start_date,
            due_date=c.due_date,
            status=c.status,
            approval_workflow_id=c.approval_workflow_id,
            reminder_days_before=c.reminder_days_before,
            escalation_days_after=c.escalation_days_after,
            created_by=c.created_by,
            created_at=c.created_at,
            updated_at=c.updated_at,
            assessment_count=len(c.assessments),
            completed_count=sum(1 for a in c.assessments if a.status == "approved")
        )
        for c in campaigns
    ]


@router.get("/campaigns/{campaign_id}", response_model=RCSACampaignResponse)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(RCSACampaign).options(
        joinedload(RCSACampaign.template),
        joinedload(RCSACampaign.assessments).joinedload(RCSAAssessment.business_unit),
        joinedload(RCSACampaign.assessments).joinedload(RCSAAssessment.assessor)
    ).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    return RCSACampaignResponse(
        id=campaign.id,
        tenant_id=campaign.tenant_id,
        template_id=campaign.template_id,
        template_name=campaign.template.name if campaign.template else None,
        name=campaign.name,
        description=campaign.description,
        period_type=campaign.period_type,
        period_label=campaign.period_label,
        start_date=campaign.start_date,
        due_date=campaign.due_date,
        status=campaign.status,
        approval_workflow_id=campaign.approval_workflow_id,
        reminder_days_before=campaign.reminder_days_before,
        escalation_days_after=campaign.escalation_days_after,
        created_by=campaign.created_by,
        created_at=campaign.created_at,
        updated_at=campaign.updated_at,
        assessment_count=len(campaign.assessments),
        completed_count=sum(1 for a in campaign.assessments if a.status == "approved")
    )


@router.post("/campaigns", response_model=RCSACampaignResponse, status_code=status.HTTP_201_CREATED)
def create_campaign(
    campaign: RCSACampaignCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    template = db.query(RCSATemplate).filter(RCSATemplate.id == campaign.template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    db_campaign = RCSACampaign(
        tenant_id=tenant_id,
        template_id=campaign.template_id,
        name=campaign.name,
        description=campaign.description,
        period_type=campaign.period_type,
        period_label=campaign.period_label,
        start_date=campaign.start_date,
        due_date=campaign.due_date,
        approval_workflow_id=campaign.approval_workflow_id,
        reminder_days_before=campaign.reminder_days_before,
        escalation_days_after=campaign.escalation_days_after,
        created_by=current_user.id
    )
    db.add(db_campaign)
    db.flush()
    
    for bu_id in campaign.business_unit_ids:
        bu = db.query(BusinessUnit).filter(
            BusinessUnit.id == bu_id,
            BusinessUnit.tenant_id == tenant_id
        ).first()
        if bu:
            assessment = RCSAAssessment(
                tenant_id=tenant_id,
                campaign_id=db_campaign.id,
                business_unit_id=bu_id
            )
            db.add(assessment)
    
    db.commit()
    db.refresh(db_campaign)
    
    return RCSACampaignResponse(
        id=db_campaign.id,
        tenant_id=db_campaign.tenant_id,
        template_id=db_campaign.template_id,
        template_name=template.name,
        name=db_campaign.name,
        description=db_campaign.description,
        period_type=db_campaign.period_type,
        period_label=db_campaign.period_label,
        start_date=db_campaign.start_date,
        due_date=db_campaign.due_date,
        status=db_campaign.status,
        approval_workflow_id=db_campaign.approval_workflow_id,
        reminder_days_before=db_campaign.reminder_days_before,
        escalation_days_after=db_campaign.escalation_days_after,
        created_by=db_campaign.created_by,
        created_at=db_campaign.created_at,
        updated_at=db_campaign.updated_at,
        assessment_count=len(campaign.business_unit_ids),
        completed_count=0
    )


@router.put("/campaigns/{campaign_id}", response_model=RCSACampaignResponse)
def update_campaign(
    campaign_id: int,
    campaign: RCSACampaignUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_campaign = db.query(RCSACampaign).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    update_data = campaign.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_campaign, key, value)
    
    db.commit()
    db.refresh(db_campaign)
    
    template = db.query(RCSATemplate).filter(RCSATemplate.id == db_campaign.template_id).first()
    assessment_count = db.query(RCSAAssessment).filter(RCSAAssessment.campaign_id == campaign_id).count()
    completed_count = db.query(RCSAAssessment).filter(
        RCSAAssessment.campaign_id == campaign_id,
        RCSAAssessment.status == "approved"
    ).count()
    
    return RCSACampaignResponse(
        id=db_campaign.id,
        tenant_id=db_campaign.tenant_id,
        template_id=db_campaign.template_id,
        template_name=template.name if template else None,
        name=db_campaign.name,
        description=db_campaign.description,
        period_type=db_campaign.period_type,
        period_label=db_campaign.period_label,
        start_date=db_campaign.start_date,
        due_date=db_campaign.due_date,
        status=db_campaign.status,
        approval_workflow_id=db_campaign.approval_workflow_id,
        reminder_days_before=db_campaign.reminder_days_before,
        escalation_days_after=db_campaign.escalation_days_after,
        created_by=db_campaign.created_by,
        created_at=db_campaign.created_at,
        updated_at=db_campaign.updated_at,
        assessment_count=assessment_count,
        completed_count=completed_count
    )


@router.delete("/campaigns/{campaign_id}", response_model=MessageResponse)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_campaign = db.query(RCSACampaign).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    if db_campaign.status == "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete an active campaign")
    
    db.delete(db_campaign)
    db.commit()
    
    return MessageResponse(message="Campaign deleted successfully", id=campaign_id)


@router.post("/campaigns/{campaign_id}/activate", response_model=RCSACampaignResponse)
def activate_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_campaign = db.query(RCSACampaign).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    if db_campaign.status != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Campaign can only be activated from draft status")
    
    db_campaign.status = "active"
    db.commit()
    db.refresh(db_campaign)
    
    template = db.query(RCSATemplate).filter(RCSATemplate.id == db_campaign.template_id).first()
    assessment_count = db.query(RCSAAssessment).filter(RCSAAssessment.campaign_id == campaign_id).count()
    
    return RCSACampaignResponse(
        id=db_campaign.id,
        tenant_id=db_campaign.tenant_id,
        template_id=db_campaign.template_id,
        template_name=template.name if template else None,
        name=db_campaign.name,
        description=db_campaign.description,
        period_type=db_campaign.period_type,
        period_label=db_campaign.period_label,
        start_date=db_campaign.start_date,
        due_date=db_campaign.due_date,
        status=db_campaign.status,
        approval_workflow_id=db_campaign.approval_workflow_id,
        reminder_days_before=db_campaign.reminder_days_before,
        escalation_days_after=db_campaign.escalation_days_after,
        created_by=db_campaign.created_by,
        created_at=db_campaign.created_at,
        updated_at=db_campaign.updated_at,
        assessment_count=assessment_count,
        completed_count=0
    )


@router.post("/campaigns/{campaign_id}/close", response_model=RCSACampaignResponse)
def close_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_campaign = db.query(RCSACampaign).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    db_campaign.status = "closed"
    db.commit()
    db.refresh(db_campaign)
    
    template = db.query(RCSATemplate).filter(RCSATemplate.id == db_campaign.template_id).first()
    assessment_count = db.query(RCSAAssessment).filter(RCSAAssessment.campaign_id == campaign_id).count()
    completed_count = db.query(RCSAAssessment).filter(
        RCSAAssessment.campaign_id == campaign_id,
        RCSAAssessment.status == "approved"
    ).count()
    
    return RCSACampaignResponse(
        id=db_campaign.id,
        tenant_id=db_campaign.tenant_id,
        template_id=db_campaign.template_id,
        template_name=template.name if template else None,
        name=db_campaign.name,
        description=db_campaign.description,
        period_type=db_campaign.period_type,
        period_label=db_campaign.period_label,
        start_date=db_campaign.start_date,
        due_date=db_campaign.due_date,
        status=db_campaign.status,
        approval_workflow_id=db_campaign.approval_workflow_id,
        reminder_days_before=db_campaign.reminder_days_before,
        escalation_days_after=db_campaign.escalation_days_after,
        created_by=db_campaign.created_by,
        created_at=db_campaign.created_at,
        updated_at=db_campaign.updated_at,
        assessment_count=assessment_count,
        completed_count=completed_count
    )


@router.post("/campaigns/{campaign_id}/assign", response_model=MessageResponse)
def assign_business_units(
    campaign_id: int,
    request: RCSABUAssignRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_campaign = db.query(RCSACampaign).filter(
        RCSACampaign.id == campaign_id,
        RCSACampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    created_count = 0
    for bu_id in request.business_unit_ids:
        existing = db.query(RCSAAssessment).filter(
            RCSAAssessment.campaign_id == campaign_id,
            RCSAAssessment.business_unit_id == bu_id
        ).first()
        
        if not existing:
            assessor_id = request.assessor_ids.get(bu_id) if request.assessor_ids else None
            assessment = RCSAAssessment(
                tenant_id=db_campaign.tenant_id,
                campaign_id=campaign_id,
                business_unit_id=bu_id,
                assessor_id=assessor_id,
                assigned_at=datetime.utcnow() if assessor_id else None
            )
            db.add(assessment)
            created_count += 1
    
    db.commit()
    
    return MessageResponse(message=f"Assigned {created_count} business units to campaign", id=campaign_id)


# =============================================================================
# Assessment Management Endpoints
# =============================================================================

@router.get("/assessments", response_model=List[RCSAAssessmentResponse])
def list_assessments(
    campaign_id: Optional[int] = None,
    business_unit_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    assessor_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor),
        joinedload(RCSAAssessment.responses),
        joinedload(RCSAAssessment.findings)
    ).filter(RCSAAssessment.tenant_id.in_(user_tenants))
    
    if campaign_id:
        query = query.filter(RCSAAssessment.campaign_id == campaign_id)
    if business_unit_id:
        query = query.filter(RCSAAssessment.business_unit_id == business_unit_id)
    if status_filter:
        query = query.filter(RCSAAssessment.status == status_filter)
    if assessor_id:
        query = query.filter(RCSAAssessment.assessor_id == assessor_id)
    
    assessments = query.order_by(RCSAAssessment.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        RCSAAssessmentResponse(
            id=a.id,
            tenant_id=a.tenant_id,
            campaign_id=a.campaign_id,
            business_unit_id=a.business_unit_id,
            business_unit_name=a.business_unit.name if a.business_unit else None,
            status=a.status,
            current_approval_tier=a.current_approval_tier,
            assessor_id=a.assessor_id,
            assessor_name=a.assessor.display_name if a.assessor else None,
            assigned_at=a.assigned_at,
            started_at=a.started_at,
            submitted_at=a.submitted_at,
            completed_at=a.completed_at,
            overall_risk_score=a.overall_risk_score,
            overall_control_score=a.overall_control_score,
            ai_quality_score=a.ai_quality_score,
            ai_suggestions_used=a.ai_suggestions_used,
            ai_gaps_identified=a.ai_gaps_identified,
            notes=a.notes,
            created_at=a.created_at,
            updated_at=a.updated_at,
            response_count=len(a.responses),
            finding_count=len(a.findings)
        )
        for a in assessments
    ]


@router.get("/assessments/{assessment_id}", response_model=RCSAAssessmentResponse)
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor),
        joinedload(RCSAAssessment.responses).joinedload(RCSAResponse.question),
        joinedload(RCSAAssessment.findings),
        joinedload(RCSAAssessment.approval_history)
    ).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=assessment.business_unit.name if assessment.business_unit else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=len(assessment.responses),
        finding_count=len(assessment.findings)
    )


@router.post("/assessments/{assessment_id}/start", response_model=RCSAAssessmentResponse)
def start_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    if assessment.status not in ["not_started", "requires_changes"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment cannot be started")
    
    assessment.status = "in_progress"
    assessment.started_at = datetime.utcnow()
    if not assessment.assessor_id:
        assessment.assessor_id = current_user.id
        assessment.assigned_at = datetime.utcnow()
    
    db.commit()
    db.refresh(assessment)
    
    bu = db.query(BusinessUnit).filter(BusinessUnit.id == assessment.business_unit_id).first()
    assessor = db.query(GRCUser).filter(GRCUser.id == assessment.assessor_id).first()
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=bu.name if bu else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessor.display_name if assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=0,
        finding_count=0
    )


@router.post("/assessments/{assessment_id}/save", response_model=MessageResponse)
def save_assessment_responses(
    assessment_id: int,
    request: RCSABulkResponseSave,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    if assessment.status not in ["in_progress", "requires_changes"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not in editable status")
    
    saved_count = 0
    for resp in request.responses:
        existing = db.query(RCSAResponse).filter(
            RCSAResponse.assessment_id == assessment_id,
            RCSAResponse.question_id == resp.question_id
        ).first()
        
        risk_score = None
        if resp.likelihood_rating and resp.impact_rating:
            risk_score = resp.likelihood_rating * resp.impact_rating
        
        if existing:
            existing.response_value = resp.response_value
            existing.likelihood_rating = resp.likelihood_rating
            existing.impact_rating = resp.impact_rating
            existing.risk_score = risk_score
            existing.control_effectiveness = resp.control_effectiveness
            existing.control_description = resp.control_description
            existing.last_tested_date = resp.last_tested_date
            existing.responded_by = current_user.id
            existing.responded_at = datetime.utcnow()
        else:
            db_response = RCSAResponse(
                assessment_id=assessment_id,
                question_id=resp.question_id,
                response_value=resp.response_value,
                likelihood_rating=resp.likelihood_rating,
                impact_rating=resp.impact_rating,
                risk_score=risk_score,
                control_effectiveness=resp.control_effectiveness,
                control_description=resp.control_description,
                last_tested_date=resp.last_tested_date,
                responded_by=current_user.id,
                responded_at=datetime.utcnow()
            )
            db.add(db_response)
        saved_count += 1
    
    db.commit()
    
    return MessageResponse(message=f"Saved {saved_count} responses", id=assessment_id)


@router.post("/assessments/{assessment_id}/submit", response_model=RCSAAssessmentResponse)
def submit_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.responses),
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor)
    ).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    if assessment.status not in ["in_progress", "requires_changes"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment cannot be submitted")
    
    risk_scores = [r.risk_score for r in assessment.responses if r.risk_score]
    if risk_scores:
        assessment.overall_risk_score = sum(risk_scores) / len(risk_scores)
    
    effectiveness_map = {"effective": 3, "partially_effective": 2, "ineffective": 1, "not_applicable": None}
    control_scores = [
        effectiveness_map.get(r.control_effectiveness)
        for r in assessment.responses
        if r.control_effectiveness and effectiveness_map.get(r.control_effectiveness)
    ]
    if control_scores:
        assessment.overall_control_score = sum(control_scores) / len(control_scores)
    
    assessment.status = "submitted"
    assessment.submitted_at = datetime.utcnow()
    assessment.current_approval_tier = 1
    
    history = RCSAApprovalHistory(
        assessment_id=assessment_id,
        action="submitted",
        tier_number=0,
        performed_by=current_user.id
    )
    db.add(history)
    
    db.commit()
    db.refresh(assessment)
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=assessment.business_unit.name if assessment.business_unit else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=len(assessment.responses),
        finding_count=len(assessment.findings) if hasattr(assessment, 'findings') else 0
    )


@router.get("/assessments/{assessment_id}/ai-suggestions", response_model=List[RCSAAISuggestionResponse])
def get_ai_suggestions(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    campaign = db.query(RCSACampaign).filter(RCSACampaign.id == assessment.campaign_id).first()
    template = db.query(RCSATemplate).options(
        joinedload(RCSATemplate.questions)
    ).filter(RCSATemplate.id == campaign.template_id).first()
    
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    bu = db.query(BusinessUnit).filter(BusinessUnit.id == assessment.business_unit_id).first()
    bu_name = bu.name if bu else "Unknown Business Unit"
    
    suggestions = []
    
    for question in template.questions:
        if not question.ai_suggestion_enabled:
            continue
        
        existing_response = db.query(RCSAResponse).filter(
            RCSAResponse.assessment_id == assessment_id,
            RCSAResponse.question_id == question.id
        ).first()
        
        if existing_response and existing_response.response_value:
            continue
        
        suggestion_text = ""
        confidence = 0.0
        gaps = []
        
        if client:
            try:
                prompt = f"""You are an enterprise risk management expert. Generate a suggestion for the following RCSA question.

Business Unit: {bu_name}
Question: {question.question_text}
Question Type: {question.question_type}
Risk Category: {question.risk_category or 'General'}
Control Objective: {question.control_objective or 'Not specified'}

Provide a professional, concise suggestion for how to respond to this question.
Also identify any potential gaps or areas of concern.

Format your response as JSON:
{{"suggestion": "your suggestion", "confidence": 0.8, "gaps": ["gap1", "gap2"]}}"""

                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                
                result = json.loads(response.choices[0].message.content)
                suggestion_text = result.get("suggestion", "")
                confidence = result.get("confidence", 0.7)
                gaps = result.get("gaps", [])
            except Exception:
                suggestion_text = f"Consider reviewing controls and risks related to {question.risk_category or 'this area'}."
                confidence = 0.5
        else:
            if question.question_type == "risk_rating":
                suggestion_text = f"For {bu_name}, assess the likelihood and impact of risks in {question.risk_category or 'this area'} based on historical data and current controls."
            elif question.question_type == "control_rating":
                suggestion_text = f"Evaluate the design and operating effectiveness of controls related to {question.control_objective or 'this control objective'}."
            else:
                suggestion_text = f"Provide a detailed response based on {bu_name}'s current practices."
            confidence = 0.5
        
        suggestions.append(RCSAAISuggestionResponse(
            question_id=question.id,
            suggestion=suggestion_text,
            confidence=confidence,
            reasoning=f"Based on {bu_name}'s operational context",
            gaps_detected=gaps
        ))
    
    return suggestions


# =============================================================================
# Approval Workflow Endpoints
# =============================================================================

@router.get("/approval-workflows", response_model=List[RCSAApprovalWorkflowResponse])
def list_approval_workflows(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSAApprovalWorkflow).options(
        joinedload(RCSAApprovalWorkflow.tiers)
    ).filter(
        RCSAApprovalWorkflow.tenant_id.in_(user_tenants),
        RCSAApprovalWorkflow.is_active == True
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RCSAApprovalWorkflow.tenant_id == tenant_id)
    
    workflows = query.all()
    
    return [
        RCSAApprovalWorkflowResponse(
            id=w.id,
            tenant_id=w.tenant_id,
            name=w.name,
            description=w.description,
            is_default=w.is_default,
            is_active=w.is_active,
            created_by=w.created_by,
            created_at=w.created_at,
            updated_at=w.updated_at,
            tier_count=len(w.tiers),
            tiers=[
                RCSAApprovalTierResponse(
                    id=t.id,
                    workflow_id=t.workflow_id,
                    tier_order=t.tier_order,
                    tier_name=t.tier_name,
                    approver_type=t.approver_type,
                    approver_role_id=t.approver_role_id,
                    approver_user_id=t.approver_user_id,
                    can_delegate=t.can_delegate,
                    auto_approve_days=t.auto_approve_days
                )
                for t in sorted(w.tiers, key=lambda x: x.tier_order)
            ]
        )
        for w in workflows
    ]


@router.post("/approval-workflows", response_model=RCSAApprovalWorkflowResponse, status_code=status.HTTP_201_CREATED)
def create_approval_workflow(
    workflow: RCSAApprovalWorkflowCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    db_workflow = RCSAApprovalWorkflow(
        tenant_id=tenant_id,
        name=workflow.name,
        description=workflow.description,
        is_default=workflow.is_default,
        created_by=current_user.id
    )
    db.add(db_workflow)
    db.flush()
    
    for tier in workflow.tiers:
        db_tier = RCSAApprovalTier(
            workflow_id=db_workflow.id,
            tier_order=tier.tier_order,
            tier_name=tier.tier_name,
            approver_type=tier.approver_type,
            approver_role_id=tier.approver_role_id,
            approver_user_id=tier.approver_user_id,
            can_delegate=tier.can_delegate,
            auto_approve_days=tier.auto_approve_days
        )
        db.add(db_tier)
    
    db.commit()
    db.refresh(db_workflow)
    
    return RCSAApprovalWorkflowResponse(
        id=db_workflow.id,
        tenant_id=db_workflow.tenant_id,
        name=db_workflow.name,
        description=db_workflow.description,
        is_default=db_workflow.is_default,
        is_active=db_workflow.is_active,
        created_by=db_workflow.created_by,
        created_at=db_workflow.created_at,
        updated_at=db_workflow.updated_at,
        tier_count=len(workflow.tiers),
        tiers=[]
    )


@router.put("/approval-workflows/{workflow_id}", response_model=RCSAApprovalWorkflowResponse)
def update_approval_workflow(
    workflow_id: int,
    workflow: RCSAApprovalWorkflowUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_workflow = db.query(RCSAApprovalWorkflow).filter(
        RCSAApprovalWorkflow.id == workflow_id,
        RCSAApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    
    update_data = workflow.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_workflow, key, value)
    
    db.commit()
    db.refresh(db_workflow)
    
    return RCSAApprovalWorkflowResponse(
        id=db_workflow.id,
        tenant_id=db_workflow.tenant_id,
        name=db_workflow.name,
        description=db_workflow.description,
        is_default=db_workflow.is_default,
        is_active=db_workflow.is_active,
        created_by=db_workflow.created_by,
        created_at=db_workflow.created_at,
        updated_at=db_workflow.updated_at,
        tier_count=len(db_workflow.tiers),
        tiers=[]
    )


@router.post("/assessments/{assessment_id}/approve", response_model=RCSAAssessmentResponse)
def approve_assessment(
    assessment_id: int,
    action: RCSAApprovalAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor)
    ).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    if assessment.status not in ["submitted", "under_review"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not pending approval")
    
    campaign = db.query(RCSACampaign).filter(RCSACampaign.id == assessment.campaign_id).first()
    workflow = None
    if campaign and campaign.approval_workflow_id:
        workflow = db.query(RCSAApprovalWorkflow).options(
            joinedload(RCSAApprovalWorkflow.tiers)
        ).filter(RCSAApprovalWorkflow.id == campaign.approval_workflow_id).first()
    
    current_tier = assessment.current_approval_tier
    max_tiers = len(workflow.tiers) if workflow else 1
    
    history = RCSAApprovalHistory(
        assessment_id=assessment_id,
        action="approved",
        tier_number=current_tier,
        performed_by=current_user.id,
        comments=action.comments
    )
    db.add(history)
    
    if current_tier >= max_tiers:
        assessment.status = "approved"
        assessment.completed_at = datetime.utcnow()
    else:
        assessment.status = "under_review"
        assessment.current_approval_tier = current_tier + 1
    
    db.commit()
    db.refresh(assessment)
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=assessment.business_unit.name if assessment.business_unit else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=0,
        finding_count=0
    )


@router.post("/assessments/{assessment_id}/reject", response_model=RCSAAssessmentResponse)
def reject_assessment(
    assessment_id: int,
    action: RCSAApprovalAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor)
    ).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    if assessment.status not in ["submitted", "under_review"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not pending approval")
    
    history = RCSAApprovalHistory(
        assessment_id=assessment_id,
        action="rejected",
        tier_number=assessment.current_approval_tier,
        performed_by=current_user.id,
        comments=action.comments
    )
    db.add(history)
    
    assessment.status = "rejected"
    
    db.commit()
    db.refresh(assessment)
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=assessment.business_unit.name if assessment.business_unit else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=0,
        finding_count=0
    )


@router.post("/assessments/{assessment_id}/return", response_model=RCSAAssessmentResponse)
def return_assessment(
    assessment_id: int,
    action: RCSAApprovalAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit),
        joinedload(RCSAAssessment.assessor)
    ).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    history = RCSAApprovalHistory(
        assessment_id=assessment_id,
        action="returned",
        tier_number=assessment.current_approval_tier,
        performed_by=current_user.id,
        comments=action.comments
    )
    db.add(history)
    
    assessment.status = "requires_changes"
    assessment.current_approval_tier = 0
    
    db.commit()
    db.refresh(assessment)
    
    return RCSAAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        campaign_id=assessment.campaign_id,
        business_unit_id=assessment.business_unit_id,
        business_unit_name=assessment.business_unit.name if assessment.business_unit else None,
        status=assessment.status,
        current_approval_tier=assessment.current_approval_tier,
        assessor_id=assessment.assessor_id,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assigned_at=assessment.assigned_at,
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        completed_at=assessment.completed_at,
        overall_risk_score=assessment.overall_risk_score,
        overall_control_score=assessment.overall_control_score,
        ai_quality_score=assessment.ai_quality_score,
        ai_suggestions_used=assessment.ai_suggestions_used,
        ai_gaps_identified=assessment.ai_gaps_identified,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        response_count=0,
        finding_count=0
    )


@router.post("/assessments/{assessment_id}/delegate", response_model=MessageResponse)
def delegate_approval(
    assessment_id: int,
    action: RCSADelegateAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    delegate_user = db.query(GRCUser).filter(GRCUser.id == action.delegate_to_user_id).first()
    if not delegate_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegate user not found")
    
    history = RCSAApprovalHistory(
        assessment_id=assessment_id,
        action="delegated",
        tier_number=assessment.current_approval_tier,
        performed_by=current_user.id,
        delegated_to=action.delegate_to_user_id,
        comments=action.comments
    )
    db.add(history)
    db.commit()
    
    return MessageResponse(
        message=f"Approval delegated to {delegate_user.display_name or delegate_user.username}",
        id=assessment_id
    )


# =============================================================================
# Findings Endpoints
# =============================================================================

@router.get("/findings", response_model=List[RCSAFindingResponse])
def list_findings(
    tenant_id: Optional[int] = None,
    assessment_id: Optional[int] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    finding_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSAFinding).options(
        joinedload(RCSAFinding.remediation_owner)
    ).filter(RCSAFinding.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RCSAFinding.tenant_id == tenant_id)
    if assessment_id:
        query = query.filter(RCSAFinding.assessment_id == assessment_id)
    if severity:
        query = query.filter(RCSAFinding.severity == severity)
    if status_filter:
        query = query.filter(RCSAFinding.status == status_filter)
    if finding_type:
        query = query.filter(RCSAFinding.finding_type == finding_type)
    
    findings = query.order_by(RCSAFinding.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        RCSAFindingResponse(
            id=f.id,
            tenant_id=f.tenant_id,
            assessment_id=f.assessment_id,
            finding_type=f.finding_type,
            severity=f.severity,
            title=f.title,
            description=f.description,
            risk_category=f.risk_category,
            affected_controls=f.affected_controls or [],
            ai_generated=f.ai_generated,
            ai_recommendation=f.ai_recommendation,
            linked_risk_id=f.linked_risk_id,
            linked_internal_control_id=f.linked_internal_control_id,
            linked_mitigation_action_id=f.linked_mitigation_action_id,
            status=f.status,
            remediation_due_date=f.remediation_due_date,
            remediation_owner_id=f.remediation_owner_id,
            remediation_owner_name=f.remediation_owner.display_name if f.remediation_owner else None,
            created_at=f.created_at,
            updated_at=f.updated_at,
            closed_at=f.closed_at
        )
        for f in findings
    ]


@router.post("/findings", response_model=RCSAFindingResponse, status_code=status.HTTP_201_CREATED)
def create_finding(
    finding: RCSAFindingCreate,
    assessment_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(RCSAAssessment).filter(
        RCSAAssessment.id == assessment_id,
        RCSAAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    
    db_finding = RCSAFinding(
        tenant_id=assessment.tenant_id,
        assessment_id=assessment_id,
        finding_type=finding.finding_type,
        severity=finding.severity,
        title=finding.title,
        description=finding.description,
        risk_category=finding.risk_category,
        affected_controls=finding.affected_controls,
        remediation_due_date=finding.remediation_due_date,
        remediation_owner_id=finding.remediation_owner_id
    )
    db.add(db_finding)
    db.commit()
    db.refresh(db_finding)
    
    return RCSAFindingResponse(
        id=db_finding.id,
        tenant_id=db_finding.tenant_id,
        assessment_id=db_finding.assessment_id,
        finding_type=db_finding.finding_type,
        severity=db_finding.severity,
        title=db_finding.title,
        description=db_finding.description,
        risk_category=db_finding.risk_category,
        affected_controls=db_finding.affected_controls or [],
        ai_generated=db_finding.ai_generated,
        ai_recommendation=db_finding.ai_recommendation,
        linked_risk_id=db_finding.linked_risk_id,
        linked_internal_control_id=db_finding.linked_internal_control_id,
        linked_mitigation_action_id=db_finding.linked_mitigation_action_id,
        status=db_finding.status,
        remediation_due_date=db_finding.remediation_due_date,
        remediation_owner_id=db_finding.remediation_owner_id,
        remediation_owner_name=None,
        created_at=db_finding.created_at,
        updated_at=db_finding.updated_at,
        closed_at=db_finding.closed_at
    )


@router.put("/findings/{finding_id}", response_model=RCSAFindingResponse)
def update_finding(
    finding_id: int,
    finding: RCSAFindingUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_finding = db.query(RCSAFinding).filter(
        RCSAFinding.id == finding_id,
        RCSAFinding.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    
    update_data = finding.model_dump(exclude_unset=True)
    
    if "status" in update_data and update_data["status"] == "closed":
        db_finding.closed_at = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(db_finding, key, value)
    
    db.commit()
    db.refresh(db_finding)
    
    owner = db.query(GRCUser).filter(GRCUser.id == db_finding.remediation_owner_id).first() if db_finding.remediation_owner_id else None
    
    return RCSAFindingResponse(
        id=db_finding.id,
        tenant_id=db_finding.tenant_id,
        assessment_id=db_finding.assessment_id,
        finding_type=db_finding.finding_type,
        severity=db_finding.severity,
        title=db_finding.title,
        description=db_finding.description,
        risk_category=db_finding.risk_category,
        affected_controls=db_finding.affected_controls or [],
        ai_generated=db_finding.ai_generated,
        ai_recommendation=db_finding.ai_recommendation,
        linked_risk_id=db_finding.linked_risk_id,
        linked_internal_control_id=db_finding.linked_internal_control_id,
        linked_mitigation_action_id=db_finding.linked_mitigation_action_id,
        status=db_finding.status,
        remediation_due_date=db_finding.remediation_due_date,
        remediation_owner_id=db_finding.remediation_owner_id,
        remediation_owner_name=owner.display_name if owner else None,
        created_at=db_finding.created_at,
        updated_at=db_finding.updated_at,
        closed_at=db_finding.closed_at
    )


@router.post("/findings/{finding_id}/link-risk", response_model=RCSAFindingResponse)
def link_finding_to_risk(
    finding_id: int,
    risk_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_finding = db.query(RCSAFinding).filter(
        RCSAFinding.id == finding_id,
        RCSAFinding.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    
    risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found")
    
    db_finding.linked_risk_id = risk_id
    db.commit()
    db.refresh(db_finding)
    
    return RCSAFindingResponse(
        id=db_finding.id,
        tenant_id=db_finding.tenant_id,
        assessment_id=db_finding.assessment_id,
        finding_type=db_finding.finding_type,
        severity=db_finding.severity,
        title=db_finding.title,
        description=db_finding.description,
        risk_category=db_finding.risk_category,
        affected_controls=db_finding.affected_controls or [],
        ai_generated=db_finding.ai_generated,
        ai_recommendation=db_finding.ai_recommendation,
        linked_risk_id=db_finding.linked_risk_id,
        linked_internal_control_id=db_finding.linked_internal_control_id,
        linked_mitigation_action_id=db_finding.linked_mitigation_action_id,
        status=db_finding.status,
        remediation_due_date=db_finding.remediation_due_date,
        remediation_owner_id=db_finding.remediation_owner_id,
        remediation_owner_name=None,
        created_at=db_finding.created_at,
        updated_at=db_finding.updated_at,
        closed_at=db_finding.closed_at
    )


@router.post("/findings/{finding_id}/link-control", response_model=RCSAFindingResponse)
def link_finding_to_control(
    finding_id: int,
    control_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_finding = db.query(RCSAFinding).filter(
        RCSAFinding.id == finding_id,
        RCSAFinding.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    
    control = db.query(InternalControl).filter(
        InternalControl.id == control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    
    if not control:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal control not found")
    
    db_finding.linked_internal_control_id = control_id
    db.commit()
    db.refresh(db_finding)
    
    return RCSAFindingResponse(
        id=db_finding.id,
        tenant_id=db_finding.tenant_id,
        assessment_id=db_finding.assessment_id,
        finding_type=db_finding.finding_type,
        severity=db_finding.severity,
        title=db_finding.title,
        description=db_finding.description,
        risk_category=db_finding.risk_category,
        affected_controls=db_finding.affected_controls or [],
        ai_generated=db_finding.ai_generated,
        ai_recommendation=db_finding.ai_recommendation,
        linked_risk_id=db_finding.linked_risk_id,
        linked_internal_control_id=db_finding.linked_internal_control_id,
        linked_mitigation_action_id=db_finding.linked_mitigation_action_id,
        status=db_finding.status,
        remediation_due_date=db_finding.remediation_due_date,
        remediation_owner_id=db_finding.remediation_owner_id,
        remediation_owner_name=None,
        created_at=db_finding.created_at,
        updated_at=db_finding.updated_at,
        closed_at=db_finding.closed_at
    )


@router.post("/findings/{finding_id}/create-action", response_model=MessageResponse)
def create_mitigation_action_from_finding(
    finding_id: int,
    risk_id: Optional[int] = Query(None, description="Risk ID to link the action to. Required if finding is not linked to a risk."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_finding = db.query(RCSAFinding).filter(
        RCSAFinding.id == finding_id,
        RCSAFinding.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    
    target_risk_id = risk_id or db_finding.linked_risk_id
    if not target_risk_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Finding must be linked to a risk or risk_id must be provided to create a mitigation action"
        )
    
    risk = db.query(Risk).filter(
        Risk.id == target_risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found")
    
    action = RiskMitigationAction(
        risk_id=target_risk_id,
        title=f"Remediate: {db_finding.title}",
        description=db_finding.description or f"Mitigation action for RCSA finding: {db_finding.title}",
        action_type="mitigate",
        priority="high" if db_finding.severity in ["critical", "high"] else "medium",
        status="open",
        due_date=db_finding.remediation_due_date,
        owner_id=db_finding.remediation_owner_id
    )
    db.add(action)
    db.flush()
    
    db_finding.linked_mitigation_action_id = action.id
    if not db_finding.linked_risk_id:
        db_finding.linked_risk_id = target_risk_id
    db.commit()
    
    return MessageResponse(message="Mitigation action created and linked to risk", id=action.id)


# =============================================================================
# Dashboard Endpoints
# =============================================================================

@router.get("/dashboard/summary", response_model=RCSADashboardSummary)
def get_dashboard_summary(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return RCSADashboardSummary(
            total_campaigns=0, active_campaigns=0, total_assessments=0,
            completed_assessments=0, pending_approval=0, overdue_assessments=0,
            completion_rate=0.0, avg_risk_score=None, avg_control_score=None
        )
    
    campaign_query = db.query(RCSACampaign).filter(RCSACampaign.tenant_id.in_(user_tenants))
    assessment_query = db.query(RCSAAssessment).filter(RCSAAssessment.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        campaign_query = campaign_query.filter(RCSACampaign.tenant_id == tenant_id)
        assessment_query = assessment_query.filter(RCSAAssessment.tenant_id == tenant_id)
    
    total_campaigns = campaign_query.count()
    active_campaigns = campaign_query.filter(RCSACampaign.status == "active").count()
    
    assessments = assessment_query.all()
    total_assessments = len(assessments)
    completed_assessments = sum(1 for a in assessments if a.status == "approved")
    pending_approval = sum(1 for a in assessments if a.status in ["submitted", "under_review"])
    
    overdue_count = 0
    for a in assessments:
        if a.status not in ["approved", "rejected"]:
            campaign = db.query(RCSACampaign).filter(RCSACampaign.id == a.campaign_id).first()
            if campaign and campaign.due_date and campaign.due_date < datetime.utcnow():
                overdue_count += 1
    
    completion_rate = (completed_assessments / total_assessments * 100) if total_assessments > 0 else 0.0
    
    risk_scores = [a.overall_risk_score for a in assessments if a.overall_risk_score]
    control_scores = [a.overall_control_score for a in assessments if a.overall_control_score]
    
    return RCSADashboardSummary(
        total_campaigns=total_campaigns,
        active_campaigns=active_campaigns,
        total_assessments=total_assessments,
        completed_assessments=completed_assessments,
        pending_approval=pending_approval,
        overdue_assessments=overdue_count,
        completion_rate=round(completion_rate, 1),
        avg_risk_score=round(sum(risk_scores) / len(risk_scores), 2) if risk_scores else None,
        avg_control_score=round(sum(control_scores) / len(control_scores), 2) if control_scores else None
    )


@router.get("/dashboard/findings-by-severity", response_model=RCSAFindingsBySeverity)
def get_findings_by_severity(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return RCSAFindingsBySeverity(critical=0, high=0, medium=0, low=0, total=0, by_type={})
    
    query = db.query(RCSAFinding).filter(RCSAFinding.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RCSAFinding.tenant_id == tenant_id)
    
    findings = query.all()
    
    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_type = {}
    
    for f in findings:
        sev = f.severity.lower() if f.severity else "medium"
        if sev in by_severity:
            by_severity[sev] += 1
        
        ft = f.finding_type or "other"
        by_type[ft] = by_type.get(ft, 0) + 1
    
    return RCSAFindingsBySeverity(
        critical=by_severity["critical"],
        high=by_severity["high"],
        medium=by_severity["medium"],
        low=by_severity["low"],
        total=len(findings),
        by_type=by_type
    )


@router.get("/dashboard/business-unit-progress", response_model=List[RCSABUProgress])
def get_business_unit_progress(
    campaign_id: Optional[int] = None,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.business_unit)
    ).filter(RCSAAssessment.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RCSAAssessment.tenant_id == tenant_id)
    if campaign_id:
        query = query.filter(RCSAAssessment.campaign_id == campaign_id)
    
    assessments = query.all()
    
    bu_stats = {}
    for a in assessments:
        bu_id = a.business_unit_id
        if bu_id not in bu_stats:
            bu_stats[bu_id] = {
                "name": a.business_unit.name if a.business_unit else f"BU {bu_id}",
                "total": 0,
                "completed": 0,
                "in_progress": 0,
                "not_started": 0,
                "risk_scores": []
            }
        
        bu_stats[bu_id]["total"] += 1
        
        if a.status == "approved":
            bu_stats[bu_id]["completed"] += 1
        elif a.status in ["in_progress", "submitted", "under_review"]:
            bu_stats[bu_id]["in_progress"] += 1
        else:
            bu_stats[bu_id]["not_started"] += 1
        
        if a.overall_risk_score:
            bu_stats[bu_id]["risk_scores"].append(a.overall_risk_score)
    
    return [
        RCSABUProgress(
            business_unit_id=bu_id,
            business_unit_name=stats["name"],
            total_assessments=stats["total"],
            completed=stats["completed"],
            in_progress=stats["in_progress"],
            not_started=stats["not_started"],
            completion_rate=round(stats["completed"] / stats["total"] * 100, 1) if stats["total"] > 0 else 0.0,
            avg_risk_score=round(sum(stats["risk_scores"]) / len(stats["risk_scores"]), 2) if stats["risk_scores"] else None
        )
        for bu_id, stats in bu_stats.items()
    ]
