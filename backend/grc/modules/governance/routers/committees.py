from typing import List, Optional
from datetime import datetime
import json
import logging
import io

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Query, File, UploadFile, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_
from openai import OpenAI
from pydantic import BaseModel

from ....models import (
    GovernanceCommittee, CommitteeMember, CommitteeCharter, CommitteeMeeting,
    MeetingAgendaItem, MeetingMinutes, OversightAction, GovernanceDocument,
    Risk, RegulatoryChange, GRCUser, Tenant, get_db, Exception,
    UploadedFramework, ParsedFrameworkControl
)
from ....schemas import (
    GovernanceCommitteeCreate, GovernanceCommitteeUpdate, GovernanceCommitteeResponse,
    CommitteeMemberCreate, CommitteeMemberResponse,
    CommitteeCharterCreate, CommitteeCharterUpdate, CommitteeCharterResponse,
    CommitteeMeetingCreate, CommitteeMeetingUpdate, CommitteeMeetingResponse,
    MeetingAgendaItemCreate, MeetingAgendaItemUpdate, MeetingAgendaItemResponse,
    MeetingMinutesCreate, MeetingMinutesUpdate, MeetingMinutesResponse,
    OversightActionCreate, OversightActionUpdate, OversightActionResponse,
    CommitteeDashboardStats, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

logger = logging.getLogger(__name__)

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if is_modelfarm and api_key:
        return OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)
    if not api_key or api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)


COMMITTEE_TYPE_KEYWORDS = {
    "audit_committee": ["audit", "internal audit", "external audit", "financial reporting", "accounting", "assurance", "internal control", "fraud"],
    "risk_committee": ["risk", "risk management", "risk assessment", "risk appetite", "risk tolerance", "enterprise risk", "risk mitigation"],
    "compliance_committee": ["compliance", "regulatory", "legal", "regulation", "law", "enforcement", "sanctions", "anti-money laundering", "aml", "kyc"],
    "board": ["governance", "board", "oversight", "strategic", "fiduciary", "shareholder", "corporate governance", "policy"],
    "it_steering": ["technology", "information technology", "IT", "cybersecurity", "information security", "data protection", "digital", "cloud", "system", "network", "software"],
    "custom": [],
}


def gather_framework_context(committee_type: str, user_tenants: list, db: Session, framework_ids: Optional[List[int]] = None) -> dict:
    # include any frameworks that have been parsed, published, classified, or completed
    # include frameworks owned by any of the user's tenants, shared ones, or global ones (tenant_id null)
    query = db.query(UploadedFramework).filter(
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.tenant_id == None,
            UploadedFramework.is_shared == True,
        ),
        UploadedFramework.upload_status.in_( ["published", "parsed", "classified", "completed"] )
    )
    
    # Filter by specific framework IDs if provided
    if framework_ids and len(framework_ids) > 0:
        query = query.filter(UploadedFramework.id.in_(framework_ids))
    
    frameworks = query.all()

    if not frameworks:
        return {"frameworks": [], "controls": [], "framework_names": []}

    framework_ids = [f.id for f in frameworks]
    framework_names = [f.name for f in frameworks]

    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id.in_(framework_ids)
    ).all()

    keywords = COMMITTEE_TYPE_KEYWORDS.get(committee_type, [])

    relevant_controls = []
    for ctrl in controls:
        text = f"{ctrl.domain or ''} {ctrl.category or ''} {ctrl.full_text or ''}".lower()
        relevance = sum(1 for kw in keywords if kw.lower() in text)
        if relevance > 0 or not keywords:
            fw_name = next((f.name for f in frameworks if f.id == ctrl.uploaded_framework_id), "Unknown")
            relevant_controls.append({
                "reference": ctrl.original_reference,
                "text": (ctrl.full_text or "")[:300],
                "domain": ctrl.domain,
                "category": ctrl.category,
                "framework": fw_name,
                "relevance": relevance,
            })

    relevant_controls.sort(key=lambda c: c["relevance"], reverse=True)
    top_controls = relevant_controls[:60]

    framework_summaries = []
    for fw in frameworks:
        framework_summaries.append({
            "name": fw.name,
            "purpose": (fw.description or "")[:200],
            "classification": fw.classification,
        })

    return {
        "frameworks": framework_summaries,
        "controls": top_controls,
        "framework_names": framework_names,
    }


class AIGenerateCharterRequest(BaseModel):
    framework_ids: Optional[List[int]] = None


class CharterCompareRequest(BaseModel):
    charter_id: Optional[int] = None
    charter_text: Optional[str] = None


class ManualOversightActionCreate(BaseModel):
    committee_id: int
    meeting_id: Optional[int] = None
    action_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    action_type: str = "follow_up"
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    linked_policy_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    agenda_item_id: Optional[int] = None

router = APIRouter(prefix="/committees", tags=["Governance - Committees"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_committee(committee: GovernanceCommittee, db: Session) -> dict:
    member_count = db.query(CommitteeMember).filter(
        CommitteeMember.committee_id == committee.id,
        CommitteeMember.is_active == True
    ).count()
    
    meeting_count = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.committee_id == committee.id
    ).count()
    
    pending_actions_count = db.query(OversightAction).filter(
        OversightAction.committee_id == committee.id,
        OversightAction.status.in_(["open", "in_progress", "overdue"])
    ).count()
    
    return {
        "id": committee.id,
        "tenant_id": committee.tenant_id,
        "name": committee.name,
        "description": committee.description,
        "committee_type": committee.committee_type,
        "chair_id": committee.chair_id,
        "chair_name": committee.chair.display_name if committee.chair else None,
        "secretary_id": committee.secretary_id,
        "secretary_name": committee.secretary.display_name if committee.secretary else None,
        "meeting_frequency": committee.meeting_frequency,
        "is_active": committee.is_active,
        "created_at": committee.created_at,
        "updated_at": committee.updated_at,
        "member_count": member_count,
        "meeting_count": meeting_count,
        "pending_actions_count": pending_actions_count,
    }


def serialize_member(member: CommitteeMember) -> dict:
    return {
        "id": member.id,
        "tenant_id": member.tenant_id,
        "committee_id": member.committee_id,
        "user_id": member.user_id,
        "user_name": member.user.display_name if member.user else None,
        "user_email": member.user.email if member.user else None,
        "role": member.role,
        "joined_at": member.joined_at,
        "left_at": member.left_at,
        "is_active": member.is_active,
    }


def serialize_charter(charter: CommitteeCharter) -> dict:
    return {
        "id": charter.id,
        "tenant_id": charter.tenant_id,
        "committee_id": charter.committee_id,
        "version": charter.version,
        "title": charter.title,
        "content": charter.content,
        "effective_date": charter.effective_date,
        "expiry_date": charter.expiry_date,
        "status": charter.status,
        "approved_by": charter.approved_by,
        "approver_name": charter.approver.display_name if charter.approver else None,
        "approved_at": charter.approved_at,
        "created_by": charter.created_by,
        "creator_name": charter.creator.display_name if charter.creator else None,
        "created_at": charter.created_at,
        "file_path": charter.file_path,
        "file_name": charter.file_name,
        "file_type": charter.file_type,
        "file_size": charter.file_size,
    }


def serialize_meeting(meeting: CommitteeMeeting, db: Session) -> dict:
    agenda_count = db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.meeting_id == meeting.id
    ).count()
    
    action_count = db.query(OversightAction).filter(
        OversightAction.meeting_id == meeting.id
    ).count()
    
    has_minutes = db.query(MeetingMinutes).filter(
        MeetingMinutes.meeting_id == meeting.id
    ).first() is not None
    
    return {
        "id": meeting.id,
        "tenant_id": meeting.tenant_id,
        "committee_id": meeting.committee_id,
        "committee_name": meeting.committee.name if meeting.committee else None,
        "meeting_number": meeting.meeting_number,
        "title": meeting.title,
        "meeting_type": meeting.meeting_type,
        "scheduled_date": meeting.scheduled_date,
        "location": meeting.location,
        "virtual_link": meeting.virtual_link,
        "status": meeting.status,
        "quorum_required": meeting.quorum_required,
        "quorum_present": meeting.quorum_present,
        "created_by": meeting.created_by,
        "creator_name": meeting.creator.display_name if meeting.creator else None,
        "created_at": meeting.created_at,
        "agenda_item_count": agenda_count,
        "action_count": action_count,
        "has_minutes": has_minutes,
    }


def serialize_agenda_item(item: MeetingAgendaItem) -> dict:
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "meeting_id": item.meeting_id,
        "item_number": item.item_number,
        "title": item.title,
        "description": item.description,
        "item_type": item.item_type,
        "presenter_id": item.presenter_id,
        "presenter_name": item.presenter.display_name if item.presenter else None,
        "linked_document_id": item.linked_document_id,
        "linked_document_title": item.linked_document.title if item.linked_document else None,
        "linked_risk_id": item.linked_risk_id,
        "linked_risk_title": item.linked_risk.title if item.linked_risk else None,
        "linked_regulatory_change_id": item.linked_regulatory_change_id,
        "linked_regulatory_change_title": item.linked_regulatory_change.title if item.linked_regulatory_change else None,
        "time_allocated_minutes": item.time_allocated_minutes,
        "status": item.status,
        "outcome": item.outcome,
        "decision_made": item.decision_made,
    }


def serialize_minutes(minutes: MeetingMinutes) -> dict:
    return {
        "id": minutes.id,
        "tenant_id": minutes.tenant_id,
        "meeting_id": minutes.meeting_id,
        "content": minutes.content,
        "attendees": minutes.attendees or [],
        "status": minutes.status,
        "drafted_by": minutes.drafted_by,
        "drafter_name": minutes.drafter.display_name if minutes.drafter else None,
        "drafted_at": minutes.drafted_at,
        "approved_by": minutes.approved_by,
        "approver_name": minutes.approver.display_name if minutes.approver else None,
        "approved_at": minutes.approved_at,
    }


def serialize_action(action: OversightAction) -> dict:
    is_overdue = False
    if action.status in ["open", "in_progress"] and action.due_date:
        is_overdue = action.due_date < datetime.utcnow()
    
    return {
        "id": action.id,
        "tenant_id": action.tenant_id,
        "committee_id": action.committee_id,
        "committee_name": action.committee.name if action.committee else None,
        "meeting_id": action.meeting_id,
        "meeting_title": action.meeting.title if action.meeting else None,
        "agenda_item_id": action.agenda_item_id,
        "action_number": action.action_number,
        "title": action.title,
        "description": action.description,
        "action_type": action.action_type,
        "assigned_to": action.assigned_to,
        "assignee_name": action.assignee.display_name if action.assignee else None,
        "due_date": action.due_date,
        "status": action.status,
        "completed_at": action.completed_at,
        "completion_notes": action.completion_notes,
        "linked_policy_id": action.linked_policy_id,
        "linked_policy_title": action.linked_policy.title if action.linked_policy else None,
        "linked_risk_id": action.linked_risk_id,
        "linked_risk_title": action.linked_risk.title if action.linked_risk else None,
        "created_by": action.created_by,
        "creator_name": action.creator.display_name if action.creator else None,
        "created_at": action.created_at,
        "is_overdue": is_overdue,
    }


def extract_text_from_uploaded_action_file(upload_file: UploadFile, file_bytes: bytes) -> str:
    filename = (upload_file.filename or "").lower()
    ext = filename.split(".")[-1] if "." in filename else ""

    if ext in ["txt", "md", "csv", "json", "log"]:
        return file_bytes.decode("utf-8", errors="ignore")

    if ext == "pdf":
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            extracted = "\n\n".join((page.extract_text() or "") for page in reader.pages)
            return extracted.strip()
        except Exception:
            return ""

    if ext in ["docx", "doc"]:
        try:
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs if p.text).strip()
        except Exception:
            return ""

    return ""


def generate_action_ai_text(prompt: str) -> str:
    client = get_openai_client()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a governance risk and compliance writing assistant. Return concise, professional output.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=700,
    )
    return (response.choices[0].message.content or "").strip()


# =============================================================================
# Committee CRUD Endpoints
# =============================================================================

@router.get("")
def list_committees(
    tenant_id: Optional[int] = None,
    committee_type: Optional[str] = None,
    is_active: Optional[bool] = True,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(GovernanceCommittee).options(
        joinedload(GovernanceCommittee.chair),
        joinedload(GovernanceCommittee.secretary)
    ).filter(GovernanceCommittee.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceCommittee.tenant_id == tenant_id)
    if committee_type:
        query = query.filter(GovernanceCommittee.committee_type == committee_type)
    if is_active is not None:
        query = query.filter(GovernanceCommittee.is_active == is_active)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                GovernanceCommittee.name.ilike(search_term),
                GovernanceCommittee.description.ilike(search_term)
            )
        )
    
    total = query.count()
    committees = query.order_by(GovernanceCommittee.name).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_committee(c, db) for c in committees],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_committee(
    committee: GovernanceCommitteeCreate,
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
    
    db_committee = GovernanceCommittee(
        tenant_id=tenant_id,
        name=committee.name,
        description=committee.description,
        committee_type=committee.committee_type,
        chair_id=committee.chair_id,
        secretary_id=committee.secretary_id,
        meeting_frequency=committee.meeting_frequency,
    )
    db.add(db_committee)
    db.commit()
    db.refresh(db_committee)
    
    return serialize_committee(db_committee, db)

# =============================================================================
# Dashboard Endpoint
# =============================================================================

@router.get("/dashboard")
def get_committee_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return CommitteeDashboardStats(
            total_committees=0, active_committees=0, by_type={},
            total_meetings=0, upcoming_meetings=0, completed_meetings=0,
            total_actions=0, open_actions=0, overdue_actions=0,
            in_progress_actions=0, completed_actions=0
        )
    
    filter_tenants = [tenant_id] if tenant_id and tenant_id in user_tenants else user_tenants
    
    total_committees = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.tenant_id.in_(filter_tenants)
    ).count()
    
    active_committees = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.tenant_id.in_(filter_tenants),
        GovernanceCommittee.is_active == True
    ).count()
    
    by_type = {}
    type_counts = db.query(
        GovernanceCommittee.committee_type,
        func.count(GovernanceCommittee.id)
    ).filter(
        GovernanceCommittee.tenant_id.in_(filter_tenants)
    ).group_by(GovernanceCommittee.committee_type).all()
    for ct, count in type_counts:
        by_type[ct] = count
    
    total_meetings = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.tenant_id.in_(filter_tenants)
    ).count()
    
    upcoming_meetings = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.tenant_id.in_(filter_tenants),
        CommitteeMeeting.status == "scheduled",
        CommitteeMeeting.scheduled_date >= datetime.utcnow()
    ).count()
    
    completed_meetings = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.tenant_id.in_(filter_tenants),
        CommitteeMeeting.status == "completed"
    ).count()
    
    total_actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants)
    ).count()
    
    open_actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants),
        OversightAction.status == "open"
    ).count()
    
    in_progress_actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants),
        OversightAction.status == "in_progress"
    ).count()
    
    completed_actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants),
        OversightAction.status == "completed"
    ).count()
    
    overdue_actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants),
        OversightAction.status.in_(["open", "in_progress"]),
        OversightAction.due_date < datetime.utcnow()
    ).count()
    
    action_completion_rate = 0.0
    if total_actions > 0:
        action_completion_rate = round((completed_actions / total_actions) * 100, 1)
    
    upcoming_meetings_list = db.query(CommitteeMeeting).options(
        joinedload(CommitteeMeeting.committee)
    ).filter(
        CommitteeMeeting.tenant_id.in_(filter_tenants),
        CommitteeMeeting.status == "scheduled",
        CommitteeMeeting.scheduled_date >= datetime.utcnow()
    ).order_by(CommitteeMeeting.scheduled_date.asc()).limit(5).all()
    
    overdue_actions_list = db.query(OversightAction).options(
        joinedload(OversightAction.committee),
        joinedload(OversightAction.assignee)
    ).filter(
        OversightAction.tenant_id.in_(filter_tenants),
        OversightAction.status.in_(["open", "in_progress"]),
        OversightAction.due_date < datetime.utcnow()
    ).order_by(OversightAction.due_date.asc()).limit(10).all()
    
    return {
        "total_committees": total_committees,
        "active_committees": active_committees,
        "by_type": by_type,
        "total_meetings": total_meetings,
        "upcoming_meetings": upcoming_meetings,
        "completed_meetings": completed_meetings,
        "total_actions": total_actions,
        "open_actions": open_actions,
        "overdue_actions": overdue_actions,
        "in_progress_actions": in_progress_actions,
        "completed_actions": completed_actions,
        "action_completion_rate": action_completion_rate,
        "upcoming_meetings_list": [
            {
                "id": m.id,
                "title": m.title,
                "committee_name": m.committee.name if m.committee else None,
                "scheduled_date": m.scheduled_date.isoformat() if m.scheduled_date else None,
            }
            for m in upcoming_meetings_list
        ],
        "overdue_actions_list": [
            {
                "id": a.id,
                "title": a.title,
                "action_number": a.action_number,
                "committee_name": a.committee.name if a.committee else None,
                "assignee_name": a.assignee.display_name if a.assignee else None,
                "due_date": a.due_date.isoformat() if a.due_date else None,
            }
            for a in overdue_actions_list
        ],
    }





@router.put("/charters/{charter_id}")
def update_charter(
    charter_id: int,
    charter_update: CommitteeCharterUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    charter = db.query(CommitteeCharter).options(
        joinedload(CommitteeCharter.approver),
        joinedload(CommitteeCharter.creator)
    ).filter(
        CommitteeCharter.id == charter_id,
        CommitteeCharter.tenant_id.in_(user_tenants)
    ).first()
    
    if not charter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charter not found")
    
    update_data = charter_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "active" and charter.status != "active":
        update_data["approved_by"] = current_user.id
        update_data["approved_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(charter, key, value)
    
    db.commit()
    db.refresh(charter)
    
    return serialize_charter(charter)


@router.delete("/{committee_id}/charters/{charter_id}", status_code=status.HTTP_200_OK)
def delete_charter(
    committee_id: int,
    charter_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    charter = db.query(CommitteeCharter).filter(
        CommitteeCharter.id == charter_id,
        CommitteeCharter.committee_id == committee_id,
        CommitteeCharter.tenant_id.in_(user_tenants)
    ).first()

    if not charter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charter not found")

    db.delete(charter)
    db.commit()
    return {"message": "Charter deleted successfully"}


@router.get("/charters/{charter_id}/download")
def download_charter_file(
    charter_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    charter = db.query(CommitteeCharter).filter(
        CommitteeCharter.id == charter_id,
        CommitteeCharter.tenant_id.in_(user_tenants)
    ).first()
    
    if not charter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charter not found")
    
    if not charter.file_path or not os.path.exists(charter.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No file attached to this charter")
    
    return FileResponse(
        path=charter.file_path,
        filename=charter.file_name or "charter_file",
        media_type="application/octet-stream"
    )

@router.get("/meetings/{meeting_id}")
def get_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).options(
        joinedload(CommitteeMeeting.committee),
        joinedload(CommitteeMeeting.creator),
        joinedload(CommitteeMeeting.agenda_items),
        joinedload(CommitteeMeeting.minutes),
    ).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    result = serialize_meeting(meeting, db)
    result["agenda_items"] = [serialize_agenda_item(a) for a in sorted(meeting.agenda_items, key=lambda x: x.item_number)]
    result["minutes"] = serialize_minutes(meeting.minutes) if meeting.minutes else None
    
    return result

@router.put("/meetings/{meeting_id}")
def update_meeting(
    meeting_id: int,
    meeting_update: CommitteeMeetingUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    update_data = meeting_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(meeting, key, value)
    
    db.commit()
    db.refresh(meeting)
    
    return serialize_meeting(meeting, db)

@router.get("/meetings/{meeting_id}/agenda")
def get_meeting_agenda(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    items = db.query(MeetingAgendaItem).options(
        joinedload(MeetingAgendaItem.presenter),
        joinedload(MeetingAgendaItem.linked_document),
        joinedload(MeetingAgendaItem.linked_risk),
        joinedload(MeetingAgendaItem.linked_regulatory_change),
    ).filter(
        MeetingAgendaItem.meeting_id == meeting_id
    ).order_by(MeetingAgendaItem.item_number).all()
    
    return [serialize_agenda_item(a) for a in items]

@router.post("/meetings/{meeting_id}/agenda", status_code=status.HTTP_201_CREATED)
def add_agenda_item(
    meeting_id: int,
    item: MeetingAgendaItemCreate,
    auto_populate_approvals: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    db_item = MeetingAgendaItem(
        tenant_id=meeting.tenant_id,
        meeting_id=meeting_id,
        item_number=item.item_number,
        title=item.title,
        description=item.description,
        item_type=item.item_type,
        presenter_id=item.presenter_id,
        linked_document_id=item.linked_document_id,
        linked_risk_id=item.linked_risk_id,
        linked_regulatory_change_id=item.linked_regulatory_change_id,
        time_allocated_minutes=item.time_allocated_minutes,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    
    result = [serialize_agenda_item(db_item)]
    
    if auto_populate_approvals:
        pending_docs = db.query(GovernanceDocument).filter(
            GovernanceDocument.tenant_id == meeting.tenant_id,
            GovernanceDocument.status == "pending_approval"
        ).all()
        
        max_item = db.query(func.max(MeetingAgendaItem.item_number)).filter(
            MeetingAgendaItem.meeting_id == meeting_id
        ).scalar() or 0
        
        for i, doc in enumerate(pending_docs):
            new_item = MeetingAgendaItem(
                tenant_id=meeting.tenant_id,
                meeting_id=meeting_id,
                item_number=max_item + i + 1,
                title=f"Approval: {doc.title}",
                description=f"Review and approve: {doc.description or doc.title}",
                item_type="approval",
                linked_document_id=doc.id,
            )
            db.add(new_item)
        
        db.commit()
    
    return result[0]

@router.put("/meetings/agenda/{item_id}")
def update_agenda_item(
    item_id: int,
    item_update: MeetingAgendaItemUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(MeetingAgendaItem).options(
        joinedload(MeetingAgendaItem.presenter),
        joinedload(MeetingAgendaItem.linked_document),
        joinedload(MeetingAgendaItem.linked_risk),
        joinedload(MeetingAgendaItem.linked_regulatory_change),
    ).filter(
        MeetingAgendaItem.id == item_id,
        MeetingAgendaItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agenda item not found")
    
    update_data = item_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    
    return serialize_agenda_item(item)


@router.get("/meetings/{meeting_id}/suggested-agenda-items")
def get_suggested_agenda_items(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Returns list of pending items that could be added to agenda without creating them"""
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    suggested_items = []
    
    pending_documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == meeting.tenant_id,
        GovernanceDocument.status == "pending_approval"
    ).all()
    
    for doc in pending_documents:
        suggested_items.append({
            "source_type": "document",
            "source_id": doc.id,
            "title": f"Document Approval: {doc.title}",
            "description": doc.description or f"Review and approve document: {doc.title}",
            "item_type": "decision",
            "linked_document_id": doc.id,
            "linked_risk_id": None,
            "linked_regulatory_change_id": None,
            "document_type": doc.doc_type,
            "document_status": doc.status,
        })
    
    pending_exceptions = db.query(Exception).filter(
        Exception.tenant_id == meeting.tenant_id,
        Exception.status == "pending"
    ).all()
    
    for exc in pending_exceptions:
        suggested_items.append({
            "source_type": "exception",
            "source_id": exc.id,
            "title": f"Risk Exception Review: {exc.title}",
            "description": exc.justification or f"Review risk exception: {exc.title}",
            "item_type": "decision",
            "linked_document_id": None,
            "linked_risk_id": exc.id,
            "linked_regulatory_change_id": None,
            "exception_status": exc.status,
        })
    
    pending_regulatory_changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id == meeting.tenant_id,
        RegulatoryChange.status == "under_assessment"
    ).all()
    
    for reg in pending_regulatory_changes:
        suggested_items.append({
            "source_type": "regulatory_change",
            "source_id": reg.id,
            "title": f"Regulatory Change: {reg.title}",
            "description": reg.description or f"Review regulatory change: {reg.title}",
            "item_type": "information",
            "linked_document_id": None,
            "linked_risk_id": None,
            "linked_regulatory_change_id": reg.id,
            "regulatory_source": reg.source,
            "regulatory_status": reg.status,
            "effective_date": reg.effective_date.isoformat() if reg.effective_date else None,
        })
    
    return {
        "meeting_id": meeting_id,
        "suggested_items": suggested_items,
        "total_count": len(suggested_items),
        "by_type": {
            "documents": len(pending_documents),
            "exceptions": len(pending_exceptions),
            "regulatory_changes": len(pending_regulatory_changes),
        }
    }


@router.post("/meetings/{meeting_id}/auto-populate-agenda", status_code=status.HTTP_201_CREATED)
def auto_populate_agenda_from_pending_approvals(
    meeting_id: int,
    include_documents: bool = True,
    include_exceptions: bool = True,
    include_regulatory_changes: bool = True,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Auto-populate meeting agenda from pending governance approvals"""
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    max_item_number = db.query(func.max(MeetingAgendaItem.item_number)).filter(
        MeetingAgendaItem.meeting_id == meeting_id
    ).scalar() or 0
    
    created_items = []
    current_item_number = max_item_number
    
    if include_documents:
        pending_documents = db.query(GovernanceDocument).filter(
            GovernanceDocument.tenant_id == meeting.tenant_id,
            GovernanceDocument.status == "pending_approval"
        ).all()
        
        for doc in pending_documents:
            current_item_number += 1
            agenda_item = MeetingAgendaItem(
                tenant_id=meeting.tenant_id,
                meeting_id=meeting_id,
                item_number=current_item_number,
                title=f"Document Approval: {doc.title}",
                description=doc.description or f"Review and approve document: {doc.title}",
                item_type="decision",
                linked_document_id=doc.id,
                status="pending",
            )
            db.add(agenda_item)
            created_items.append(agenda_item)
    
    if include_exceptions:
        pending_exceptions = db.query(Exception).filter(
            Exception.tenant_id == meeting.tenant_id,
            Exception.status == "pending"
        ).all()
        
        for exc in pending_exceptions:
            current_item_number += 1
            agenda_item = MeetingAgendaItem(
                tenant_id=meeting.tenant_id,
                meeting_id=meeting_id,
                item_number=current_item_number,
                title=f"Risk Exception Review: {exc.title}",
                description=exc.justification or f"Review risk exception: {exc.title}",
                item_type="decision",
                linked_risk_id=exc.id,
                status="pending",
            )
            db.add(agenda_item)
            created_items.append(agenda_item)
    
    if include_regulatory_changes:
        pending_regulatory_changes = db.query(RegulatoryChange).filter(
            RegulatoryChange.tenant_id == meeting.tenant_id,
            RegulatoryChange.status == "under_assessment"
        ).all()
        
        for reg in pending_regulatory_changes:
            current_item_number += 1
            agenda_item = MeetingAgendaItem(
                tenant_id=meeting.tenant_id,
                meeting_id=meeting_id,
                item_number=current_item_number,
                title=f"Regulatory Change: {reg.title}",
                description=reg.description or f"Review regulatory change: {reg.title}",
                item_type="information",
                linked_regulatory_change_id=reg.id,
                status="pending",
            )
            db.add(agenda_item)
            created_items.append(agenda_item)
    
    db.commit()
    
    for item in created_items:
        db.refresh(item)
    
    return {
        "meeting_id": meeting_id,
        "created_items": [serialize_agenda_item(item) for item in created_items],
        "total_created": len(created_items),
        "by_type": {
            "documents": sum(1 for item in created_items if item.linked_document_id is not None),
            "exceptions": sum(1 for item in created_items if item.linked_risk_id is not None),
            "regulatory_changes": sum(1 for item in created_items if item.linked_regulatory_change_id is not None),
        }
    }


@router.post("/meetings/{meeting_id}/minutes", status_code=status.HTTP_201_CREATED)
def create_or_update_minutes(
    meeting_id: int,
    minutes: MeetingMinutesCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    existing = db.query(MeetingMinutes).filter(
        MeetingMinutes.meeting_id == meeting_id
    ).first()
    
    if existing:
        existing.content = minutes.content
        existing.attendees = minutes.attendees
        existing.status = minutes.status
        db.commit()
        db.refresh(existing)
        return serialize_minutes(existing)
    
    db_minutes = MeetingMinutes(
        tenant_id=meeting.tenant_id,
        meeting_id=meeting_id,
        content=minutes.content,
        attendees=minutes.attendees,
        status=minutes.status,
        drafted_by=current_user.id,
    )
    db.add(db_minutes)
    db.commit()
    db.refresh(db_minutes)
    
    return serialize_minutes(db_minutes)

@router.put("/meetings/minutes/{minutes_id}")
def update_minutes(
    minutes_id: int,
    minutes_update: MeetingMinutesUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    minutes = db.query(MeetingMinutes).options(
        joinedload(MeetingMinutes.drafter),
        joinedload(MeetingMinutes.approver)
    ).filter(
        MeetingMinutes.id == minutes_id,
        MeetingMinutes.tenant_id.in_(user_tenants)
    ).first()
    
    if not minutes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Minutes not found")
    
    update_data = minutes_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "approved" and minutes.status != "approved":
        update_data["approved_by"] = current_user.id
        update_data["approved_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(minutes, key, value)
    
    db.commit()
    db.refresh(minutes)
    
    return serialize_minutes(minutes)

@router.post("/meetings/{meeting_id}/actions", status_code=status.HTTP_201_CREATED)
def create_oversight_action(
    meeting_id: int,
    action: OversightActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants)
    ).first()
    
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    
    action_count = db.query(OversightAction).filter(
        OversightAction.committee_id == meeting.committee_id
    ).count()
    action_number = action.action_number or f"ACT-{meeting.committee_id}-{action_count + 1:04d}"
    
    db_action = OversightAction(
        tenant_id=meeting.tenant_id,
        committee_id=meeting.committee_id,
        meeting_id=meeting_id,
        agenda_item_id=action.agenda_item_id,
        action_number=action_number,
        title=action.title,
        description=action.description,
        action_type=action.action_type,
        assigned_to=action.assigned_to,
        due_date=action.due_date,
        linked_policy_id=action.linked_policy_id,
        linked_risk_id=action.linked_risk_id,
        created_by=current_user.id,
    )
    db.add(db_action)
    db.commit()
    db.refresh(db_action)
    
    return serialize_action(db_action)

@router.get("/actions")
def list_actions(
    tenant_id: Optional[int] = None,
    committee_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    action_type: Optional[str] = None,
    assigned_to: Optional[int] = None,
    overdue_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(OversightAction).options(
        joinedload(OversightAction.committee),
        joinedload(OversightAction.meeting),
        joinedload(OversightAction.assignee),
        joinedload(OversightAction.creator),
        joinedload(OversightAction.linked_policy),
        joinedload(OversightAction.linked_risk),
    ).filter(OversightAction.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(OversightAction.tenant_id == tenant_id)
    if committee_id:
        query = query.filter(OversightAction.committee_id == committee_id)
    if status_filter:
        query = query.filter(OversightAction.status == status_filter)
    if action_type:
        query = query.filter(OversightAction.action_type == action_type)
    if assigned_to:
        query = query.filter(OversightAction.assigned_to == assigned_to)
    if overdue_only:
        query = query.filter(
            OversightAction.status.in_(["open", "in_progress"]),
            OversightAction.due_date < datetime.utcnow()
        )
    
    total = query.count()
    actions = query.order_by(OversightAction.due_date.asc().nullslast()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_action(a) for a in actions],
        "total": total,
        "skip": skip,
        "limit": limit
    }
@router.patch("/actions/{action_id}")
def update_action_status(
    action_id: int,
    action_update: OversightActionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    action = db.query(OversightAction).options(
        joinedload(OversightAction.committee),
        joinedload(OversightAction.meeting),
        joinedload(OversightAction.assignee),
        joinedload(OversightAction.creator),
        joinedload(OversightAction.linked_policy),
        joinedload(OversightAction.linked_risk),
    ).filter(
        OversightAction.id == action_id,
        OversightAction.tenant_id.in_(user_tenants)
    ).first()
    
    if not action:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
    
    update_data = action_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "completed" and action.status != "completed":
        update_data["completed_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(action, key, value)
    
    db.commit()
    db.refresh(action)
    
    return serialize_action(action)


@router.post("/actions/manual", status_code=status.HTTP_201_CREATED)
def create_manual_action(
    action: ManualOversightActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == action.committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()

    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")

    meeting = None
    if action.meeting_id:
        meeting = db.query(CommitteeMeeting).filter(
            CommitteeMeeting.id == action.meeting_id,
            CommitteeMeeting.committee_id == committee.id,
            CommitteeMeeting.tenant_id == committee.tenant_id
        ).first()
        if not meeting:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found for committee")

    action_count = db.query(OversightAction).filter(
        OversightAction.committee_id == committee.id
    ).count()
    action_number = action.action_number or f"ACT-{committee.id}-{action_count + 1:04d}"

    db_action = OversightAction(
        tenant_id=committee.tenant_id,
        committee_id=committee.id,
        meeting_id=meeting.id if meeting else None,
        agenda_item_id=action.agenda_item_id,
        action_number=action_number,
        title=action.title,
        description=action.description,
        action_type=action.action_type,
        assigned_to=action.assigned_to,
        due_date=action.due_date,
        linked_policy_id=action.linked_policy_id,
        linked_risk_id=action.linked_risk_id,
        created_by=current_user.id,
    )
    db.add(db_action)
    db.commit()
    db.refresh(db_action)

    db_action = db.query(OversightAction).options(
        joinedload(OversightAction.committee),
        joinedload(OversightAction.meeting),
        joinedload(OversightAction.assignee),
        joinedload(OversightAction.creator),
        joinedload(OversightAction.linked_policy),
        joinedload(OversightAction.linked_risk),
    ).filter(OversightAction.id == db_action.id).first()

    return serialize_action(db_action)


@router.post("/actions/ai/reword")
async def ai_reword_action_text(
    text: Optional[str] = Form(None),
    tone: str = Form("professional"),
    file: Optional[UploadFile] = File(None),
    current_user: GRCUser = Depends(require_auth)
):
    _ = current_user
    source_text = (text or "").strip()

    if file:
        file_bytes = await file.read()
        extracted = extract_text_from_uploaded_action_file(file, file_bytes)
        if extracted:
            source_text = f"{source_text}\n\n{extracted}".strip()

    if not source_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please provide text or an upload file")

    prompt = f"""Rewrite the following governance oversight action content in a {tone} tone.
Keep it clear, concise, and actionable.
Return ONLY the rewritten text, no markdown and no extra commentary.

CONTENT:
{source_text[:12000]}
"""

    try:
        rewritten_text = generate_action_ai_text(prompt)
        return {"text": rewritten_text}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to reword action text")
        raise HTTPException(status_code=500, detail=f"AI reword failed: {str(exc)}")


@router.post("/actions/ai/summary")
async def ai_generate_action_summary(
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: GRCUser = Depends(require_auth)
):
    _ = current_user
    source_text = (text or "").strip()

    if file:
        file_bytes = await file.read()
        extracted = extract_text_from_uploaded_action_file(file, file_bytes)
        if extracted:
            source_text = f"{source_text}\n\n{extracted}".strip()

    if not source_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please provide text or an upload file")

    prompt = f"""Summarize the following governance action content into a concise action summary.
Focus on objective, owner/accountability cues, timeline cues, and expected outcome.
Keep it to 3-6 sentences.
Return ONLY the summary text.

CONTENT:
{source_text[:12000]}
"""

    try:
        summary_text = generate_action_ai_text(prompt)
        return {"text": summary_text}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to summarize action text")
        raise HTTPException(status_code=500, detail=f"AI summary failed: {str(exc)}")


@router.get("/{committee_id}")
def get_committee(
    committee_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).options(
        joinedload(GovernanceCommittee.chair),
        joinedload(GovernanceCommittee.secretary),
        joinedload(GovernanceCommittee.members).joinedload(CommitteeMember.user),
        joinedload(GovernanceCommittee.charters),
    ).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    result = serialize_committee(committee, db)
    result["members"] = [serialize_member(m) for m in committee.members if m.is_active]
    result["charters"] = [serialize_charter(c) for c in committee.charters]
    
    return result


@router.put("/{committee_id}")
def update_committee(
    committee_id: int,
    committee_update: GovernanceCommitteeUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    update_data = committee_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(committee, key, value)
    
    db.commit()
    db.refresh(committee)
    
    return serialize_committee(committee, db)


@router.delete("/{committee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_committee(
    committee_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    db.delete(committee)
    db.commit()
    return None


# =============================================================================
# Committee Members Endpoints
# =============================================================================

@router.get("/{committee_id}/members")
def list_committee_members(
    committee_id: int,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    query = db.query(CommitteeMember).options(
        joinedload(CommitteeMember.user)
    ).filter(CommitteeMember.committee_id == committee_id)
    
    if not include_inactive:
        query = query.filter(CommitteeMember.is_active == True)
    
    members = query.order_by(CommitteeMember.role, CommitteeMember.joined_at).all()
    
    return [serialize_member(m) for m in members]


@router.post("/{committee_id}/members", status_code=status.HTTP_201_CREATED)
def add_committee_member(
    committee_id: int,
    member: CommitteeMemberCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    existing = db.query(CommitteeMember).filter(
        CommitteeMember.committee_id == committee_id,
        CommitteeMember.user_id == member.user_id,
        CommitteeMember.is_active == True
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already an active member of this committee"
        )
    
    db_member = CommitteeMember(
        tenant_id=committee.tenant_id,
        committee_id=committee_id,
        user_id=member.user_id,
        role=member.role,
    )
    db.add(db_member)
    db.commit()
    db.refresh(db_member)
    
    return serialize_member(db_member)


@router.delete("/{committee_id}/members/{user_id}")
def remove_committee_member(
    committee_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    member = db.query(CommitteeMember).filter(
        CommitteeMember.committee_id == committee_id,
        CommitteeMember.user_id == user_id,
        CommitteeMember.is_active == True
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    member.is_active = False
    member.left_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Member removed from committee", "id": member.id}


# =============================================================================
# Committee Charters Endpoints
# =============================================================================

@router.get("/{committee_id}/charters")
def list_committee_charters(
    committee_id: int,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    query = db.query(CommitteeCharter).options(
        joinedload(CommitteeCharter.approver),
        joinedload(CommitteeCharter.creator)
    ).filter(CommitteeCharter.committee_id == committee_id)
    
    if status_filter:
        query = query.filter(CommitteeCharter.status == status_filter)
    
    charters = query.order_by(CommitteeCharter.created_at.desc()).all()
    
    return [serialize_charter(c) for c in charters]


@router.post("/{committee_id}/charters", status_code=status.HTTP_201_CREATED)
def create_committee_charter(
    committee_id: int,
    charter: CommitteeCharterCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    db_charter = CommitteeCharter(
        tenant_id=committee.tenant_id,
        committee_id=committee_id,
        version=charter.version,
        title=charter.title,
        content=charter.content,
        effective_date=charter.effective_date,
        expiry_date=charter.expiry_date,
        status=charter.status,
        created_by=current_user.id,
    )
    db.add(db_charter)
    db.commit()
    db.refresh(db_charter)
    
    return serialize_charter(db_charter)




UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))), "uploads", "charters")


@router.post("/{committee_id}/charters/{charter_id}/upload")
async def upload_charter_file(
    committee_id: int,
    charter_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    charter = db.query(CommitteeCharter).options(
        joinedload(CommitteeCharter.approver),
        joinedload(CommitteeCharter.creator)
    ).filter(
        CommitteeCharter.id == charter_id,
        CommitteeCharter.committee_id == committee_id,
        CommitteeCharter.tenant_id.in_(user_tenants)
    ).first()
    
    if not charter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charter not found")
    
    tenant_upload_dir = os.path.join(UPLOAD_DIR, str(charter.tenant_id))
    os.makedirs(tenant_upload_dir, exist_ok=True)
    
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    unique_filename = f"{charter_id}_{uuid.uuid4().hex[:8]}{file_ext}"
    file_path = os.path.join(tenant_upload_dir, unique_filename)
    
    content = await file.read()
    file_size = len(content)
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    charter.file_path = file_path
    charter.file_name = file.filename
    charter.file_type = file_ext.lstrip(".") if file_ext else None
    charter.file_size = file_size
    
    db.commit()
    db.refresh(charter)
    
    return serialize_charter(charter)




# =============================================================================
# Committee Meetings Endpoints
# =============================================================================

@router.get("/{committee_id}/meetings")
def list_committee_meetings(
    committee_id: int,
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    query = db.query(CommitteeMeeting).options(
        joinedload(CommitteeMeeting.committee),
        joinedload(CommitteeMeeting.creator)
    ).filter(CommitteeMeeting.committee_id == committee_id)
    
    if status_filter:
        query = query.filter(CommitteeMeeting.status == status_filter)
    if from_date:
        query = query.filter(CommitteeMeeting.scheduled_date >= from_date)
    if to_date:
        query = query.filter(CommitteeMeeting.scheduled_date <= to_date)
    
    total = query.count()
    meetings = query.order_by(CommitteeMeeting.scheduled_date.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_meeting(m, db) for m in meetings],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("/{committee_id}/meetings", status_code=status.HTTP_201_CREATED)
def schedule_meeting(
    committee_id: int,
    meeting: CommitteeMeetingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    
    meeting_count = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.committee_id == committee_id
    ).count()
    meeting_number = meeting.meeting_number or f"{committee_id}-{meeting_count + 1:03d}"
    
    db_meeting = CommitteeMeeting(
        tenant_id=committee.tenant_id,
        committee_id=committee_id,
        meeting_number=meeting_number,
        title=meeting.title,
        meeting_type=meeting.meeting_type,
        scheduled_date=meeting.scheduled_date,
        location=meeting.location,
        virtual_link=meeting.virtual_link,
        quorum_required=meeting.quorum_required,
        created_by=current_user.id,
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    
    return serialize_meeting(db_meeting, db)






# =============================================================================
# Meeting Agenda Endpoints
# =============================================================================







# =============================================================================
# Meeting Minutes Endpoints
# =============================================================================


# =============================================================================
# Oversight Actions Endpoints
# =============================================================================


# =============================================================================
# AI Charter Generation & Comparison Endpoints
# =============================================================================

@router.post("/{committee_id}/ai-generate-charter")
def ai_generate_charter(
    committee_id: int,
    request: AIGenerateCharterRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    if not committee:
        raise HTTPException(status_code=404, detail="Committee not found")

    context = gather_framework_context(committee.committee_type, user_tenants, db, request.framework_ids)

# log context at INFO so it's visible in standard logs
    logger.info(f"AI charter request: committee={committee_id}, tenant={committee.tenant_id}, user_tenants={user_tenants}, framework_ids={request.framework_ids}")
    logger.info(f"framework context: {context}")

    if not context["frameworks"]:
        # include tenant/committee info in error for easier troubleshooting
        raise HTTPException(
            status_code=400,
            detail=f"No eligible frameworks found for tenant(s) {user_tenants}. Ensure selected frameworks are accessible (tenant-owned/shared/global) and in parsed/published/classified/completed status."
        )

    client = get_openai_client()

    frameworks_text = ""
    for fw in context["frameworks"]:
        frameworks_text += f"\n- {fw['name']} ({fw['classification'] or 'N/A'}): {fw['purpose']}"

    controls_text = ""
    for ctrl in context["controls"][:40]:
        controls_text += f"\n- [{ctrl['framework']}] {ctrl['reference']}: {ctrl['text'][:200]}"

    prompt = f"""You are a GRC governance expert. Generate a comprehensive committee charter for the following committee based on ALL the regulatory frameworks and controls provided.

COMMITTEE DETAILS:
- Name: {committee.name}
- Type: {committee.committee_type}
- Description: {committee.description or 'N/A'}

UPLOADED REGULATORY FRAMEWORKS IN THE ORGANIZATION:
{frameworks_text}

RELEVANT CONTROLS FROM THESE FRAMEWORKS:
{controls_text}

Generate a detailed charter document with the following sections. For each section, reference which specific frameworks and controls drove that requirement.

Return a JSON object with this exact structure:
{{
  "charter_title": "Charter for [Committee Name]",
  "sections": [
    {{
      "title": "Purpose & Mission",
      "content": "Detailed purpose statement...",
      "framework_references": ["Framework Name - Control Ref", ...]
    }},
    {{
      "title": "Scope of Authority",
      "content": "Detailed scope...",
      "framework_references": [...]
    }},
    {{
      "title": "Composition & Membership",
      "content": "Required roles, qualifications, minimum members...",
      "framework_references": [...]
    }},
    {{
      "title": "Roles & Responsibilities",
      "content": "Chair duties, Secretary duties, Member responsibilities...",
      "framework_references": [...]
    }},
    {{
      "title": "Meeting Frequency & Quorum",
      "content": "How often, quorum requirements, special meetings...",
      "framework_references": [...]
    }},
    {{
      "title": "Key Oversight Responsibilities",
      "content": "Specific oversight duties mapped to framework requirements...",
      "framework_references": [...]
    }},
    {{
      "title": "Reporting Requirements",
      "content": "What reports to produce, to whom, how often...",
      "framework_references": [...]
    }},
    {{
      "title": "Charter Review & Amendment",
      "content": "Review cycle, amendment process...",
      "framework_references": [...]
    }}
  ],
  "summary": "Brief summary of the charter and its framework basis"
}}

Make the charter comprehensive, professional, and specific to the committee type. Reference specific framework controls where applicable. Return ONLY valid JSON."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a governance expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000
        )

        response_text = response.choices[0].message.content.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        charter_data = json.loads(response_text.strip())

        return {
            "committee_id": committee_id,
            "committee_name": committee.name,
            "committee_type": committee.committee_type,
            "frameworks_analyzed": context["framework_names"],
            "controls_analyzed": len(context["controls"]),
            "charter": charter_data,
        }

    except json.JSONDecodeError as e:
        logger.error(f"AI charter generation JSON parse error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response. Please try again.")
    except Exception as e:
        logger.error(f"AI charter generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI charter generation failed: {str(e)}")


@router.post("/{committee_id}/ai-compare-charter")
def ai_compare_charter(
    committee_id: int,
    request: CharterCompareRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants)
    ).first()
    if not committee:
        raise HTTPException(status_code=404, detail="Committee not found")

    existing_charter_text = request.charter_text
    if request.charter_id:
        charter = db.query(CommitteeCharter).filter(
            CommitteeCharter.id == request.charter_id,
            CommitteeCharter.tenant_id.in_(user_tenants)
        ).first()
        if not charter:
            raise HTTPException(status_code=404, detail="Charter not found")
        existing_charter_text = charter.content

    if not existing_charter_text:
        raise HTTPException(status_code=400, detail="No charter content provided for comparison.")

    context = gather_framework_context(committee.committee_type, user_tenants, db)

    if not context["frameworks"]:
        raise HTTPException(
            status_code=400,
            detail="No published frameworks found. Upload and publish at least one framework for comparison."
        )

    client = get_openai_client()

    frameworks_text = ""
    for fw in context["frameworks"]:
        frameworks_text += f"\n- {fw['name']} ({fw['classification'] or 'N/A'}): {fw['purpose']}"

    controls_text = ""
    for ctrl in context["controls"][:40]:
        controls_text += f"\n- [{ctrl['framework']}] {ctrl['reference']}: {ctrl['text'][:200]}"

    prompt = f"""You are a GRC governance expert. Compare the following EXISTING committee charter against the requirements from the organization's regulatory frameworks.

COMMITTEE DETAILS:
- Name: {committee.name}
- Type: {committee.committee_type}

EXISTING CHARTER CONTENT:
{existing_charter_text[:6000]}

REGULATORY FRAMEWORKS IN THE ORGANIZATION:
{frameworks_text}

RELEVANT FRAMEWORK CONTROLS:
{controls_text}

Analyze the existing charter and compare it against what the frameworks require. Return a JSON object with this exact structure:
{{
  "overall_score": 75,
  "overall_assessment": "Brief overall assessment...",
  "sections": [
    {{
      "title": "Purpose & Mission",
      "status": "covered",
      "score": 90,
      "existing_content_summary": "What the charter currently says...",
      "recommendation": "What should be improved...",
      "framework_requirements": ["Framework - Control requiring this"]
    }},
    {{
      "title": "Scope of Authority",
      "status": "partial",
      "score": 60,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Composition & Membership",
      "status": "missing",
      "score": 0,
      "existing_content_summary": "Not addressed in current charter",
      "recommendation": "Add section covering...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Roles & Responsibilities",
      "status": "covered|partial|missing|exceeds",
      "score": 0-100,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Meeting Frequency & Quorum",
      "status": "...",
      "score": 0-100,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Key Oversight Responsibilities",
      "status": "...",
      "score": 0-100,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Reporting Requirements",
      "status": "...",
      "score": 0-100,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }},
    {{
      "title": "Charter Review & Amendment",
      "status": "...",
      "score": 0-100,
      "existing_content_summary": "...",
      "recommendation": "...",
      "framework_requirements": [...]
    }}
  ],
  "gaps": [
    {{
      "description": "Missing requirement...",
      "severity": "high|medium|low",
      "frameworks": ["Framework names requiring this"]
    }}
  ],
  "strengths": [
    "Well-covered area 1",
    "Well-covered area 2"
  ],
  "recommendations": [
    "Specific improvement 1",
    "Specific improvement 2"
  ],
  "framework_coverage": {{
    "addressed": ["Framework names well-covered"],
    "partially_addressed": ["Framework names partially covered"],
    "not_addressed": ["Framework names missing"]
  }}
}}

Status values: "covered" (80-100%), "partial" (40-79%), "missing" (0-39%), "exceeds" (charter goes beyond framework requirements).
Return ONLY valid JSON."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a governance compliance expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000
        )

        response_text = response.choices[0].message.content.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        comparison_data = json.loads(response_text.strip())

        return {
            "committee_id": committee_id,
            "committee_name": committee.name,
            "charter_id": request.charter_id,
            "frameworks_analyzed": context["framework_names"],
            "controls_analyzed": len(context["controls"]),
            "comparison": comparison_data,
        }

    except json.JSONDecodeError as e:
        logger.error(f"AI charter comparison JSON parse error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to parse AI comparison response. Please try again.")
    except Exception as e:
        logger.error(f"AI charter comparison failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI charter comparison failed: {str(e)}")









