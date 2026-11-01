from ....config import get_openai_api_key, get_openai_model

from typing import Any, Dict, List, Optional
from datetime import date, datetime, time as dtime, timedelta, timezone
import json
import logging
import io

import os
import unicodedata
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Query, File, UploadFile, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_, select
from sqlalchemy.exc import IntegrityError
from openai import OpenAI
from pydantic import BaseModel, Field

from ....models import (
    GovernanceCommittee, CommitteeMember, CommitteeCharter, CommitteeMeeting,
    MeetingAgendaItem, MeetingMinutes, OversightAction, GovernanceDocument,
    Risk, RegulatoryChange, GRCUser, Tenant, get_db,
    UploadedFramework, ParsedFrameworkControl, MeetingAttachment, MeetingAttendance,
    MeetingAgendaItemVote, AuditExtensionRequest
)
# the control-exception model under its own name: imported as "Exception" it hid Python's, and every `except Exception:` here
# raised TypeError instead of catching the error
from ....models import Exception as ControlException
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
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission
from .. import committee_tasks

logger = logging.getLogger(__name__)

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


def get_openai_client() -> OpenAI:
    api_key = get_openai_api_key()
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


class AutoPopulateRequest(BaseModel):
    include_documents: bool = True
    include_exceptions: bool = True
    include_regulatory_changes: bool = True


class ManualOversightActionCreate(BaseModel):
    committee_id: int
    meeting_id: Optional[int] = None
    action_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    action_type: str = "follow_up"
    priority: Optional[str] = None
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


# ── Deactivating a committee ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
# The reversible way to retire a committee (the screens have no Delete): POST /{id}/deactivate sets is_active false and removes nothing (members,
# charters, meetings, agendas, votes, minutes, actions and their Task Management copies all stay, open actions and scheduled meetings as they are);
# POST /{id}/reactivate sets it back. While it is off the ways to add to it (a meeting, an action from the committee or from one of its meetings, a
# member) answer 400. Both calls need the delete right (governance:committees:delete), enforced here; the other committee routes keep the behaviour
# they had (PUT can still set is_active, as before, but it too is refused while an extension request waits).
# is_active NULL counts as ACTIVE everywhere below: nothing writes NULL (the column defaults to true), and the readers used to disagree about it.
INACTIVE_REFUSED = "This committee is inactive: reactivate it first"
_remove = Depends(require_tenant_permission("governance:committees:delete"))


def _is_active(committee: GovernanceCommittee) -> bool:
    return committee.is_active is not False


def _refuse_if_inactive(committee: Optional[GovernanceCommittee]) -> None:
    if committee is not None and not _is_active(committee):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INACTIVE_REFUSED)


def _extension_requests_on(db: Session, committee_id: int, open_only: bool) -> int:
    """Audit-register extension requests that point at a meeting (or an agenda item of a meeting) of the committee. `open_only`: just the ones still
    waiting for the committee's decision. Any status blocks a hard delete (both columns are foreign keys); only an open one blocks Deactivate."""
    meetings = select(CommitteeMeeting.id).where(CommitteeMeeting.committee_id == committee_id)
    items = select(MeetingAgendaItem.id).where(MeetingAgendaItem.meeting_id.in_(meetings))
    query = db.query(AuditExtensionRequest.id).filter(or_(
        AuditExtensionRequest.meeting_id.in_(meetings), AuditExtensionRequest.agenda_item_id.in_(items)))
    if open_only:
        query = query.filter(AuditExtensionRequest.status == "requested")
    return query.count()


def _refuse_deactivation_while_a_request_waits(db: Session, committee: GovernanceCommittee) -> None:
    """409 with words while an audit-register extension request waits for the committee's decision at one of its meetings (Deactivate and PUT is_active false)."""
    waiting = _extension_requests_on(db, committee.id, open_only=True)
    if waiting:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"{waiting} audit extension {'request is' if waiting == 1 else 'requests are'} still waiting for a decision at a meeting of "
                    "this committee. Decide or withdraw it in Auditor Portal > Issue Register, then deactivate the committee"))


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
        "is_active": _is_active(committee),
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
        # Structured sections — populated by the upload-new endpoint or
        # by an AI-generate result the operator saved. NULL on legacy
        # plain-text rows; the frontend renders content directly in that case.
        "sections": getattr(charter, "sections_json", None) or None,
    }


def _count_by(db: Session, column, ids: List[int]) -> Dict[int, int]:
    """How many rows point at each of `ids` through `column`, in one grouped query."""
    return dict(db.query(column, func.count()).filter(column.in_(ids)).group_by(column).all()) if ids else {}


def _meeting_counts(db: Session, meetings: List[CommitteeMeeting]) -> Dict[int, Dict[str, Any]]:
    """What a meeting row says about its readiness, for a whole page of meetings in a few grouped queries (not a few per row): agenda items, actions,
    whether minutes exist, papers (attachments) and invitees (the committee's active members: there is no separate invite list)."""
    counts = {m.id: {"agenda": 0, "actions": 0, "minutes": False, "papers": 0, "invitees": 0} for m in meetings}
    if not counts:
        return counts
    ids = list(counts)

    for column, key in ((MeetingAgendaItem.meeting_id, "agenda"), (OversightAction.meeting_id, "actions"), (MeetingAttachment.meeting_id, "papers")):
        for meeting_id, n in _count_by(db, column, ids).items():
            counts[meeting_id][key] = n
    for (meeting_id,) in db.query(MeetingMinutes.meeting_id).filter(MeetingMinutes.meeting_id.in_(ids)):
        counts[meeting_id]["minutes"] = True
    invitees = dict(db.query(CommitteeMember.committee_id, func.count()).filter(
        CommitteeMember.committee_id.in_({m.committee_id for m in meetings}), CommitteeMember.is_active == True,  # noqa: E712
    ).group_by(CommitteeMember.committee_id).all())
    for m in meetings:
        counts[m.id]["invitees"] = invitees.get(m.committee_id, 0)
    return counts


def _quorum_met(meeting: CommitteeMeeting) -> Optional[bool]:
    """Has the meeting reached its quorum? None when there is nothing to judge it by: no threshold set (or one below 1), or no roll recorded."""
    if not meeting.quorum_required or meeting.quorum_required < 1 or meeting.quorum_present is None:
        return None
    return meeting.quorum_present >= meeting.quorum_required


def serialize_meeting(meeting: CommitteeMeeting, db: Session, counts: Optional[Dict[str, Any]] = None) -> dict:
    """`counts` is this meeting's entry of _meeting_counts, which a list computes once for its page."""
    counts = counts or _meeting_counts(db, [meeting])[meeting.id]

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
        "agenda_item_count": counts["agenda"],
        "action_count": counts["actions"],
        "has_minutes": counts["minutes"],
        # readiness and quorum, for the Committees lanes and the meeting's live bar
        "papers_count": counts["papers"],
        "invitees_count": counts["invitees"],
        "quorum_met": _quorum_met(meeting),
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


def serialize_action(action: OversightAction, sla_settings: Optional[dict] = None) -> dict:
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
        "priority": action.priority or "medium",
        "sla": committee_tasks.sla_of(action, sla_settings),
        "critical_task_id": action.critical_task_id,
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


def _action_overdue(action, now: datetime) -> bool:
    """"overdue" is both a persistable status (the OversightAction model documents it and the update endpoint accepts it) AND a derived state (an
    open or in-progress action past its due date). Count both, so a row saved literally as "overdue" is not dropped from every KPI bucket.
    `action` is an object or a row with .status and .due_date."""
    if action.status == "overdue":
        return True
    return action.status in ("open", "in_progress") and action.due_date is not None and action.due_date < now


def _committee_health(db: Session, committee_ids: List[int], meetings_by_committee: Dict[int, list], actions_by_committee: Dict[int, list],
                      invitees_by_committee: Dict[int, int], now: datetime) -> Dict[int, Dict[str, Any]]:
    """The health fields of each committee: ONE function for the rows of GET /overview and for GET /{id}, so a committee reads the same in both.
    Meetings (objects or rows) need .id .title .status .scheduled_date, actions .status .due_date. Fields:
      attendance_pct       the mean, over the committee's completed meetings of the last 365 days that have a recorded roll, of
                           (present + late) / (members who count toward quorum, i.e. not observers), x 100, one decimal; None when there is no such meeting
      next_meeting         the earliest scheduled meeting dated now or later, with its readiness; None if there is none
      charter_in_force     the active, unexpired charter (the Governance overview's "current charter" test); the latest effective date wins; None if none
      meetings_in_progress meetings whose status is in_progress
      open_actions, in_progress_actions, overdue_actions   as the overview rows have always counted them"""
    year_ago = now - timedelta(days=365)
    held = {m.id for ms in meetings_by_committee.values() for m in ms
            if m.status == "completed" and m.scheduled_date is not None and m.scheduled_date >= year_ago}
    roll: Dict[int, list] = {}
    if held:
        for meeting_id, state, role in db.query(MeetingAttendance.meeting_id, MeetingAttendance.status, MeetingAttendance.role).filter(
                MeetingAttendance.meeting_id.in_(held)):
            if (role or "member") != "observer":
                roll.setdefault(meeting_id, []).append(state)

    coming = {}
    for cid in committee_ids:
        scheduled = [m for m in meetings_by_committee.get(cid, []) if m.status == "scheduled" and m.scheduled_date is not None and m.scheduled_date >= now]
        if scheduled:
            coming[cid] = min(scheduled, key=lambda m: (m.scheduled_date, m.id))
    next_ids = [m.id for m in coming.values()]
    agenda, papers = _count_by(db, MeetingAgendaItem.meeting_id, next_ids), _count_by(db, MeetingAttachment.meeting_id, next_ids)

    in_force: Dict[int, CommitteeCharter] = {}
    if committee_ids:
        for charter in db.query(CommitteeCharter).filter(CommitteeCharter.committee_id.in_(committee_ids), CommitteeCharter.status == "active"):
            if charter.expiry_date is not None and charter.expiry_date < now:
                continue
            best = in_force.get(charter.committee_id)
            if best is None or (charter.effective_date or datetime.min, charter.id) > (best.effective_date or datetime.min, best.id):
                in_force[charter.committee_id] = charter

    health = {}
    for cid in committee_ids:
        meetings, actions = meetings_by_committee.get(cid, []), actions_by_committee.get(cid, [])
        ratios = []
        for m in meetings:
            states = roll.get(m.id) if m.id in held else None
            if states:
                ratios.append(sum(1 for s in states if s in ("present", "late")) / len(states))
        upcoming, charter = coming.get(cid), in_force.get(cid)
        health[cid] = {
            "attendance_pct": round(sum(ratios) / len(ratios) * 100, 1) if ratios else None,
            "next_meeting": {
                "id": upcoming.id, "date": upcoming.scheduled_date.isoformat(), "title": upcoming.title,
                "has_agenda": agenda.get(upcoming.id, 0) > 0, "papers_count": papers.get(upcoming.id, 0),
                "invitees_count": invitees_by_committee.get(cid, 0),
            } if upcoming else None,
            "charter_in_force": {
                "id": charter.id, "version": charter.version,
                "expires_on": charter.expiry_date.date().isoformat() if charter.expiry_date else None,
            } if charter else None,
            "meetings_in_progress": sum(1 for m in meetings if m.status == "in_progress"),
            "open_actions": sum(1 for a in actions if a.status == "open"),
            "in_progress_actions": sum(1 for a in actions if a.status == "in_progress"),
            "overdue_actions": sum(1 for a in actions if _action_overdue(a, now)),
        }
    return health


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
        model=get_openai_model(),
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

_BOOL_WORDS = {"true": True, "1": True, "yes": True, "on": True, "t": True, "y": True,
               "false": False, "0": False, "no": False, "off": False, "f": False, "n": False}


@router.get("")
def list_committees(
    tenant_id: Optional[int] = None,
    committee_type: Optional[str] = None,
    # "true" (the default: active committees only, as ever), "false" (inactive only) or "all" (both: the Oversight Actions filter offers a
    # deactivated committee's actions). Any other word the old boolean accepted still means what it meant.
    is_active: Optional[str] = "true",
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    wanted = (is_active or "").strip().lower()
    if wanted != "all" and wanted not in _BOOL_WORDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="is_active must be true, false or all")

    query = db.query(GovernanceCommittee).options(
        joinedload(GovernanceCommittee.chair),
        joinedload(GovernanceCommittee.secretary)
    ).filter(GovernanceCommittee.tenant_id.in_(user_tenants))

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceCommittee.tenant_id == tenant_id)
    if committee_type:
        query = query.filter(GovernanceCommittee.committee_type == committee_type)
    if wanted != "all":
        # NULL counts as active (see _is_active)
        query = query.filter(GovernanceCommittee.is_active.isnot(False) if _BOOL_WORDS[wanted]
                             else GovernanceCommittee.is_active.is_(False))
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
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [committee.chair_id, committee.secretary_id])
    
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


@router.get("/overview")
def get_committee_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Executive single-snapshot for the Board & Committee dashboard.

    Everything committee-wise, computed from live data and tenant-scoped:
      • kpis        — headline counts (committees, meetings, actions, attendance)
      • committees  — per-committee rollup (next/last meeting, open/overdue actions) and
                      the health fields (attendance_pct, next_meeting, charter_in_force,
                      meetings_in_progress: see _committee_health)
      • upcoming_meetings — the next few scheduled meetings
      • top_performers — members ranked by action completion + on-time rate
      • progress_over_time — 6-month trend (meetings held, actions completed, %)

    Returns zeroed/empty structures on a fresh tenant so the UI degrades
    gracefully ("No meetings recorded yet") rather than erroring. Registered
    BEFORE the parametric /{committee_id} route so "overview" is never parsed
    as an id.
    """
    from collections import defaultdict

    empty = {
        "kpis": {
            "total_committees": 0, "active_committees": 0,
            "meetings_upcoming": 0, "meetings_completed": 0, "meetings_this_quarter": 0,
            "actions": {"open": 0, "in_progress": 0, "overdue": 0, "completed": 0, "total": 0, "pct_done": 0.0},
            "avg_attendance_pct": None, "charters_active": 0,
        },
        "committees": [], "upcoming_meetings": [], "top_performers": [], "progress_over_time": [],
    }

    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return empty
    filter_tenants = [tenant_id] if tenant_id and tenant_id in user_tenants else user_tenants
    now = datetime.utcnow()

    committees = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.tenant_id.in_(filter_tenants)
    ).all()
    if not committees:
        return empty

    meetings = db.query(CommitteeMeeting).options(
        joinedload(CommitteeMeeting.committee)
    ).filter(CommitteeMeeting.tenant_id.in_(filter_tenants)).all()
    actions = db.query(OversightAction).filter(
        OversightAction.tenant_id.in_(filter_tenants)
    ).all()

    member_rows = db.query(
        CommitteeMember.committee_id, func.count(CommitteeMember.id)
    ).filter(
        CommitteeMember.tenant_id.in_(filter_tenants),
        CommitteeMember.is_active == True,  # noqa: E712
    ).group_by(CommitteeMember.committee_id).all()
    members_by_committee = {cid: cnt for cid, cnt in member_rows}

    charters_active = db.query(CommitteeCharter).filter(
        CommitteeCharter.tenant_id.in_(filter_tenants),
        CommitteeCharter.status == "active",
    ).count()

    def is_overdue(a) -> bool:
        return _action_overdue(a, now)          # the rule is documented there, and shared with GET /{id}

    def month_key(dt) -> str:
        return f"{dt.year:04d}-{dt.month:02d}"

    # ── KPI tallies ──
    a_open = sum(1 for a in actions if a.status == "open")
    a_prog = sum(1 for a in actions if a.status == "in_progress")
    a_done = sum(1 for a in actions if a.status == "completed")
    a_overdue = sum(1 for a in actions if is_overdue(a))
    a_total = len(actions)
    pct_done = round((a_done / a_total) * 100, 1) if a_total else 0.0

    m_upcoming = sum(1 for m in meetings if m.status == "scheduled" and m.scheduled_date and m.scheduled_date >= now)
    m_completed = sum(1 for m in meetings if m.status == "completed")
    q_start = datetime(now.year, 3 * ((now.month - 1) // 3) + 1, 1)
    m_quarter = sum(1 for m in meetings if m.scheduled_date and m.scheduled_date >= q_start)

    # Attendance = attendees / committee membership (capped at 100%), averaged
    # over held meetings with quorum data; falls back to the quorum threshold
    # as the base when a committee has no member records. The previous
    # quorum_present/quorum_required average could exceed 100% (attendance
    # above the threshold), which is a quorum figure, not attendance.
    held_with_quorum = [m for m in meetings
                        if m.status == "completed" and m.quorum_present is not None
                        and m.quorum_required and m.quorum_required > 0]
    attendance_ratios = []
    for m in held_with_quorum:
        base = members_by_committee.get(m.committee_id, 0) or m.quorum_required
        attendance_ratios.append(min(1.0, m.quorum_present / base))
    avg_attendance = round((sum(attendance_ratios) / len(attendance_ratios)) * 100, 1) if attendance_ratios else None
    quorum_met = sum(1 for m in held_with_quorum if m.quorum_present >= m.quorum_required)
    quorum_met_rate = round((quorum_met / len(held_with_quorum)) * 100, 1) if held_with_quorum else None

    # ── committee performance score — same five formulas as the governance
    # overview's Committees section, so both pages always agree ──
    def _metric(key, label, weight, num, den, formula, inverse=False, empty_score=None):
        if den:
            pct = (num / den) * 100
            score = round(100 - pct, 1) if inverse else round(pct, 1)
        else:
            score = empty_score
        return {"key": key, "label": label, "weight": weight, "score": score,
                "numerator": num, "denominator": den, "formula": formula,
                "inverse": inverse, "target": 85}

    open_actions = [a for a in actions if a.status in ("open", "in_progress", "overdue")]
    overdue_open = sum(1 for a in open_actions if is_overdue(a))
    active_committee_ids = {c.id for c in committees if _is_active(c)}
    active_committee_count = len(active_committee_ids)
    # "active committees that met / active committees": a deactivated committee that met would otherwise count in the numerator only (6 of 5 = 120%)
    recent_meeting_committees = {m.committee_id for m in meetings
                                 if m.committee_id in active_committee_ids
                                 and m.scheduled_date and m.scheduled_date >= now - timedelta(days=90)
                                 and m.status != "cancelled"}
    completed_180 = [m for m in meetings if m.status == "completed" and m.scheduled_date
                     and m.scheduled_date >= now - timedelta(days=180)]
    minute_meeting_ids = {r.meeting_id for r in db.query(MeetingMinutes.meeting_id).filter(
        MeetingMinutes.meeting_id.in_([m.id for m in meetings])).all()} if meetings else set()
    minuted_180 = sum(1 for m in completed_180 if m.id in minute_meeting_ids)

    perf_metrics = [
        _metric("action_health", "Action health", 0.30, overdue_open, len(open_actions),
                "1 - (overdue oversight actions / open oversight actions)",
                inverse=True, empty_score=100),
        _metric("action_completion", "Actions completed", 0.20, a_done, a_total,
                "completed oversight actions / all oversight actions"),
        _metric("meeting_cadence", "Meeting cadence", 0.20, len(recent_meeting_committees),
                active_committee_count,
                "active committees that met in the last 90 days / active committees"),
        _metric("minutes_discipline", "Minutes recorded", 0.15, minuted_180, len(completed_180),
                "completed meetings (180d) with minutes recorded / completed meetings (180d)"),
        _metric("quorum_rate", "Quorum met", 0.15, quorum_met, len(held_with_quorum),
                "held meetings that reached their quorum threshold / held meetings with quorum data"),
    ]
    _avail = [m for m in perf_metrics if m["score"] is not None]
    _wsum = sum(m["weight"] for m in _avail)
    perf_score = round(sum(m["score"] * m["weight"] for m in _avail) / _wsum, 1) if _avail and _wsum else None
    if perf_score is None:
        perf_grade = None
    elif perf_score >= 85:
        perf_grade = "excellent"
    elif perf_score >= 70:
        perf_grade = "good"
    elif perf_score >= 50:
        perf_grade = "fair"
    else:
        perf_grade = "poor"

    # ── per-committee rollup ──
    actions_by_committee = defaultdict(list)
    for a in actions:
        actions_by_committee[a.committee_id].append(a)
    meetings_by_committee = defaultdict(list)
    for m in meetings:
        meetings_by_committee[m.committee_id].append(m)

    health = _committee_health(db, [c.id for c in committees], meetings_by_committee, actions_by_committee, members_by_committee, now)
    committee_rows = []
    for c in committees:
        c_actions = actions_by_committee.get(c.id, [])
        c_meetings = meetings_by_committee.get(c.id, [])
        upcoming = [m for m in c_meetings if m.scheduled_date and m.scheduled_date >= now and m.status != "cancelled"]
        past = [m for m in c_meetings if m.scheduled_date and m.scheduled_date < now]
        next_meeting = min(upcoming, key=lambda m: m.scheduled_date) if upcoming else None
        last_meeting = max(past, key=lambda m: m.scheduled_date) if past else None
        committee_rows.append({
            "id": c.id,
            "name": c.name,
            "committee_type": c.committee_type,
            "is_active": _is_active(c),
            "members_count": members_by_committee.get(c.id, 0),
            "next_meeting_date": next_meeting.scheduled_date.isoformat() if next_meeting else None,
            "last_meeting": {
                "date": last_meeting.scheduled_date.isoformat(),
                "status": last_meeting.status,
            } if last_meeting else None,
            "open_actions": sum(1 for a in c_actions if a.status == "open"),
            "in_progress_actions": sum(1 for a in c_actions if a.status == "in_progress"),
            "overdue_actions": sum(1 for a in c_actions if is_overdue(a)),
            "completed_actions": sum(1 for a in c_actions if a.status == "completed"),
            "total_actions": len(c_actions),
            # the health strip (see _committee_health): additive, the same values GET /{id} carries
            "attendance_pct": health[c.id]["attendance_pct"],
            "next_meeting": health[c.id]["next_meeting"],
            "charter_in_force": health[c.id]["charter_in_force"],
            "meetings_in_progress": health[c.id]["meetings_in_progress"],
        })
    # attention-first ordering: most overdue, then most open
    committee_rows.sort(key=lambda r: (-r["overdue_actions"], -r["open_actions"], r["name"].lower()))

    # ── upcoming meetings (next 6) ──
    upcoming_sorted = sorted(
        [m for m in meetings if m.status == "scheduled" and m.scheduled_date and m.scheduled_date >= now],
        key=lambda m: m.scheduled_date,
    )[:6]
    upcoming_meetings = [
        {
            "id": m.id, "title": m.title,
            "committee_id": m.committee_id,
            "committee_name": m.committee.name if m.committee else None,
            "scheduled_date": m.scheduled_date.isoformat() if m.scheduled_date else None,
            "status": m.status,
        }
        for m in upcoming_sorted
    ]

    # ── top performers (members by completion + on-time rate) ──
    perf = defaultdict(lambda: {"assigned": 0, "completed": 0, "on_time": 0})
    for a in actions:
        if not a.assigned_to:
            continue
        p = perf[a.assigned_to]
        p["assigned"] += 1
        if a.status == "completed":
            p["completed"] += 1
            if a.completed_at and a.due_date and a.completed_at <= a.due_date:
                p["on_time"] += 1
    names = {}
    if perf:
        for u in db.query(GRCUser).filter(GRCUser.id.in_(list(perf.keys()))).all():
            names[u.id] = getattr(u, "display_name", None) or getattr(u, "username", None) or getattr(u, "email", None) or f"User {u.id}"
    top_performers = []
    for uid, p in perf.items():
        completion_pct = round((p["completed"] / p["assigned"]) * 100, 1) if p["assigned"] else 0.0
        on_time_pct = round((p["on_time"] / p["completed"]) * 100, 1) if p["completed"] else 0.0
        top_performers.append({
            "user_id": uid, "name": names.get(uid, f"User {uid}"),
            "assigned": p["assigned"], "completed": p["completed"], "on_time": p["on_time"],
            "completion_pct": completion_pct, "on_time_pct": on_time_pct,
        })
    top_performers.sort(key=lambda r: (-r["completion_pct"], -r["completed"], -r["on_time"]))
    top_performers = top_performers[:6]

    # ── progress over time (trailing 6 months) ──
    months = []
    yy, mm = now.year, now.month
    for _ in range(6):
        months.append((yy, mm))
        mm -= 1
        if mm == 0:
            mm = 12
            yy -= 1
    months.reverse()
    progress_over_time = []
    for (y, m) in months:
        key = f"{y:04d}-{m:02d}"
        meetings_held = sum(1 for mt in meetings if mt.status == "completed" and mt.scheduled_date and month_key(mt.scheduled_date) == key)
        # Bucket completed actions by completion date, falling back to created_at
        # when completed_at was never stamped — so this monthly sum reconciles
        # with the KPI/per-committee "completed" counts (which key purely on status).
        actions_completed = sum(
            1 for a in actions
            if a.status == "completed" and (a.completed_at or a.created_at)
            and month_key(a.completed_at or a.created_at) == key
        )
        due_in_month = sum(1 for a in actions if a.due_date and month_key(a.due_date) == key)
        done_of_due = sum(1 for a in actions if a.due_date and month_key(a.due_date) == key and a.status == "completed")
        completion_pct = round((done_of_due / due_in_month) * 100, 1) if due_in_month else None
        progress_over_time.append({
            "month": key,
            "meetings_held": meetings_held,
            "actions_completed": actions_completed,
            "completion_pct": completion_pct,
        })

    return {
        "kpis": {
            "total_committees": len(committees),
            "active_committees": active_committee_count,
            "meetings_upcoming": m_upcoming,
            "meetings_completed": m_completed,
            "meetings_this_quarter": m_quarter,
            "actions": {
                "open": a_open, "in_progress": a_prog, "overdue": a_overdue,
                "completed": a_done, "total": a_total, "pct_done": pct_done,
            },
            "avg_attendance_pct": avg_attendance,
            "quorum_met": quorum_met,
            "quorum_meetings": len(held_with_quorum),
            "quorum_met_rate_pct": quorum_met_rate,
            "charters_active": charters_active,
            "performance": {
                "score": perf_score,
                "grade": perf_grade,
                "metrics": perf_metrics,
            },
        },
        "committees": committee_rows,
        "upcoming_meetings": upcoming_meetings,
        "top_performers": top_performers,
        "progress_over_time": progress_over_time,
    }





# ── Decisions feed ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
# What the committees decided: every agenda item that has an outcome or a decision text, newest meeting first, across committees. Read-only, with
# the same rule as GET /committees (a signed-in user). Registered before /{committee_id}, so "decisions" is never parsed as an id.

def _fold(text: Any) -> str:
    """Lower case without accents or Arabic vowel marks, so a search for 'cafe' finds 'Café' and one for a word finds it with its marks."""
    return "".join(c for c in unicodedata.normalize("NFKD", str(text or "").casefold()) if not unicodedata.combining(c))


def _filled(column):
    return and_(column.isnot(None), func.trim(column) != "")


@router.get("/decisions")
def list_decisions(
    q: Optional[str] = None,
    committee_id: Optional[int] = None,
    from_date: Optional[date] = Query(None, alias="from", description="meeting date, on or after this day"),
    to_date: Optional[date] = Query(None, alias="to", description="meeting date, on or before this day"),
    outcome: Optional[str] = None,
    # "all" (the default), "true" (active committees only: what the Committees lane shows) or "false". A deactivated committee's decisions stay on the record.
    is_active: Optional[str] = "all",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Decisions of the committees, newest meeting first (then agenda order). `q`: every word must appear in the item's title or decision text, ignoring
    case and accents. `total` is the true count after every filter, whatever the page. Who recorded a decision and when are not stored on the item."""
    wanted = (is_active or "all").strip().lower()
    if wanted != "all" and wanted not in _BOOL_WORDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="is_active must be true, false or all")
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    query = (db.query(MeetingAgendaItem.id, MeetingAgendaItem.item_number, MeetingAgendaItem.title, MeetingAgendaItem.outcome,
                      MeetingAgendaItem.decision_made, MeetingAgendaItem.status,
                      CommitteeMeeting.id.label("meeting_id"), CommitteeMeeting.title.label("meeting_title"),
                      CommitteeMeeting.scheduled_date, CommitteeMeeting.status.label("meeting_status"),
                      GovernanceCommittee.id.label("committee_id"), GovernanceCommittee.name.label("committee_name"), GovernanceCommittee.is_active)
             .join(CommitteeMeeting, CommitteeMeeting.id == MeetingAgendaItem.meeting_id)
             .join(GovernanceCommittee, GovernanceCommittee.id == CommitteeMeeting.committee_id)
             .filter(MeetingAgendaItem.tenant_id.in_(tenants), CommitteeMeeting.tenant_id.in_(tenants), GovernanceCommittee.tenant_id.in_(tenants),
                     or_(_filled(MeetingAgendaItem.outcome), _filled(MeetingAgendaItem.decision_made))))
    if committee_id:
        query = query.filter(GovernanceCommittee.id == committee_id)
    if wanted != "all":
        query = query.filter(GovernanceCommittee.is_active.isnot(False) if _BOOL_WORDS[wanted] else GovernanceCommittee.is_active.is_(False))
    if outcome and outcome.strip():
        query = query.filter(func.lower(func.trim(MeetingAgendaItem.outcome)) == outcome.strip().lower())
    if from_date:
        query = query.filter(CommitteeMeeting.scheduled_date >= datetime.combine(from_date, dtime.min))
    if to_date:
        query = query.filter(CommitteeMeeting.scheduled_date < datetime.combine(to_date + timedelta(days=1), dtime.min))
    query = query.order_by(CommitteeMeeting.scheduled_date.desc(), MeetingAgendaItem.item_number.asc(), MeetingAgendaItem.id.asc())

    terms = _fold(q).split()
    if terms:
        # accents and case are folded in Python (neither database does it the same way); a tenant has hundreds of decisions, not millions
        rows = [r for r in query.all() if all(t in _fold(f"{r.title} {r.decision_made or ''}") for t in terms)]
        total, page = len(rows), rows[offset:offset + limit]
    else:
        total, page = query.count(), query.offset(offset).limit(limit).all()

    return {
        "items": [
            {
                "id": r.id, "item_number": r.item_number, "title": r.title, "outcome": r.outcome, "decision_made": r.decision_made, "status": r.status,
                "committee_id": r.committee_id, "committee_name": r.committee_name, "committee_is_active": r.is_active is not False,
                "meeting_id": r.meeting_id, "meeting_title": r.meeting_title, "meeting_date": r.scheduled_date, "meeting_status": r.meeting_status,
            }
            for r in page
        ],
        "total": total, "limit": limit, "offset": offset,
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

def _meeting_detail(meeting_id: int, current_user: GRCUser, db: Session) -> dict:
    """The meeting with its agenda and minutes: GET /meetings/{id}, and what start and end answer."""
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


@router.get("/meetings/{meeting_id}")
def get_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return _meeting_detail(meeting_id, current_user, db)


# ── Meeting life cycle: start, end, roll call and quorum ──────────────────────────────────────────────────────────────────────────────────────────
# scheduled -> in_progress -> completed, and nothing else: cancelling or editing a meeting stays the raw PUT /meetings/{id}, as before. Both calls
# are idempotent (a meeting already in the target state answers 200 and changes nothing), a past meeting that is still "scheduled" can be ended
# (closed) without being started, and neither touches quorum, the agenda, the minutes or the actions. Like every committee write they need a sign-in
# and nothing more (the permission pass will decide who may run a meeting).

def _meeting_of(meeting_id: int, current_user: GRCUser, db: Session, lock: bool = False) -> CommitteeMeeting:
    """The meeting in the caller's tenant (404 otherwise). `lock` holds its row for this transaction (PostgreSQL), so two people writing to it queue."""
    query = db.query(CommitteeMeeting).filter(CommitteeMeeting.id == meeting_id, CommitteeMeeting.tenant_id.in_(get_user_tenants(current_user, db)))
    meeting = (query.with_for_update() if lock else query).first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting


def _refuse_transition(meeting: CommitteeMeeting, what: str) -> None:
    said = {"completed": "This meeting is already completed", "cancelled": "This meeting was cancelled"}
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=said.get(meeting.status) or f"A meeting that is {meeting.status or 'in an unknown state'} cannot be {what}")


@router.post("/meetings/{meeting_id}/start")
def start_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """scheduled -> in_progress. Already in progress: nothing to do (200). Completed or cancelled: 409."""
    meeting = _meeting_of(meeting_id, current_user, db, lock=True)
    if meeting.status == "scheduled":
        meeting.status = "in_progress"
        db.commit()
    elif meeting.status != "in_progress":
        _refuse_transition(meeting, "started")
    return _meeting_detail(meeting_id, current_user, db)


@router.post("/meetings/{meeting_id}/end")
def end_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """in_progress -> completed; a scheduled meeting whose date has passed -> completed too (closing a meeting nobody started). One that is still
    to come must be started or cancelled (409). Already completed: nothing to do (200). Cancelled: 409. Nothing else is required to end a meeting."""
    meeting = _meeting_of(meeting_id, current_user, db, lock=True)
    if meeting.status == "in_progress" or (meeting.status == "scheduled" and meeting.scheduled_date <= datetime.utcnow()):
        meeting.status = "completed"
        db.commit()
    elif meeting.status == "scheduled":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This meeting has not started yet: start it first, or cancel it")
    elif meeting.status != "completed":
        _refuse_transition(meeting, "ended")
    return _meeting_detail(meeting_id, current_user, db)


# The roll: one row per member and meeting (models/_29 MeetingAttendance). present and late count toward quorum, absent does not, and nobody who
# sits on the committee as an observer ever does. quorum_present on the meeting is kept equal to that count after every write (the overviews read it as a
# count); quorum_met compares it with quorum_required. A meeting nobody took a roll for has no rows and quorum_present stays NULL: "not recorded".
ATTENDANCE_WORDS = ("present", "late", "absent")
_ROLE_ORDER = {"chair": 0, "secretary": 1, "member": 2, "observer": 3}


class AttendanceEntry(BaseModel):
    user_id: int
    status: str            # present | late | absent (any case)


class AttendanceBody(BaseModel):
    members: List[AttendanceEntry] = Field(default_factory=list, max_length=200)


def _roll(meeting: CommitteeMeeting, db: Session) -> dict:
    """The roll of a meeting: every active member of the committee (marked or not yet) and anyone marked who has since left, with the quorum figures."""
    members = db.query(CommitteeMember).options(joinedload(CommitteeMember.user)).filter(
        CommitteeMember.committee_id == meeting.committee_id, CommitteeMember.is_active == True).all()  # noqa: E712
    rows = {r.user_id: r for r in db.query(MeetingAttendance).options(joinedload(MeetingAttendance.user)).filter(MeetingAttendance.meeting_id == meeting.id)}

    def line(user_id: int, user: Optional[GRCUser], member_role: Optional[str], active: bool) -> dict:
        row = rows.get(user_id)
        role = (row.role if row is not None and row.role else member_role) or "member"      # the role it was recorded under counts, not today's
        return {
            "user_id": user_id,
            "user_name": (user.display_name or user.username) if user else None,
            "user_email": user.email if user else None,
            "role": role,
            "counts_toward_quorum": role != "observer",
            "status": row.status if row is not None else None,                 # None: not marked yet
            "marked_by": row.marked_by if row is not None else None,
            "marked_at": row.marked_at if row is not None else None,
            "is_active_member": active,
        }

    people = [line(m.user_id, m.user, m.role, True) for m in members]
    on_committee = {m.user_id for m in members}
    people += [line(uid, r.user, r.role, False) for uid, r in rows.items() if uid not in on_committee]
    people.sort(key=lambda p: (_ROLE_ORDER.get(p["role"], 2), (p["user_name"] or "").casefold(), p["user_id"]))
    return {
        "meeting_id": meeting.id,
        "committee_id": meeting.committee_id,
        "meeting_status": meeting.status,
        "quorum_required": meeting.quorum_required,
        "quorum_present": meeting.quorum_present,
        "quorum_met": _quorum_met(meeting),
        "recorded": bool(rows),
        "voting_members": sum(1 for p in people if p["counts_toward_quorum"]),
        "members": people,
    }


@router.get("/meetings/{meeting_id}/attendance")
def get_meeting_roll(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return _roll(_meeting_of(meeting_id, current_user, db), db)


@router.put("/meetings/{meeting_id}/attendance")
def record_roll_call(
    meeting_id: int,
    body: AttendanceBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Mark members present, late or absent (one entry or many; the last entry for a person wins) while the meeting is in progress, or after it ended to
    correct the roll. Only active members of the committee can be marked (400). The FIRST marks on a meeting also record every other active member
    absent, so the roll is complete from then on. Marking someone with the status they already have changes nothing. Answers with the roll."""
    meeting = _meeting_of(meeting_id, current_user, db, lock=True)
    if meeting.status not in ("in_progress", "completed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=(
            "This meeting was cancelled" if meeting.status == "cancelled" else "Start the meeting before taking the roll call"))
    wanted: Dict[int, str] = {}
    for entry in body.members:
        word = (entry.status or "").strip().lower()
        if word not in ATTENDANCE_WORDS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"status must be one of: {', '.join(sorted(ATTENDANCE_WORDS))}")
        wanted[entry.user_id] = word
    members = {m.user_id: m for m in db.query(CommitteeMember).filter(
        CommitteeMember.committee_id == meeting.committee_id, CommitteeMember.is_active == True)}  # noqa: E712
    strangers = sorted(uid for uid in wanted if uid not in members)
    if strangers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"User {strangers[0]} is not an active member of this committee")
    if wanted:
        rows = {r.user_id: r for r in db.query(MeetingAttendance).filter(MeetingAttendance.meeting_id == meeting.id)}
        if not rows:
            wanted = {**{uid: "absent" for uid in members}, **wanted}
        now = datetime.utcnow()
        for uid, word in wanted.items():
            row = rows.get(uid)
            if row is None:
                row = rows[uid] = MeetingAttendance(tenant_id=meeting.tenant_id, meeting_id=meeting.id, user_id=uid, status=word,
                                                    role=members[uid].role, marked_by=current_user.id, marked_at=now)
                db.add(row)
            elif row.status != word:
                row.status, row.role, row.marked_by, row.marked_at = word, members[uid].role, current_user.id, now
        meeting.quorum_present = sum(1 for r in rows.values() if r.status in ("present", "late") and (r.role or "member") != "observer")
        db.commit()
    return _roll(meeting, db)

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
    
    # Auto-assign item_number if not provided
    if item.item_number is None:
        max_num = db.query(func.max(MeetingAgendaItem.item_number)).filter(
            MeetingAgendaItem.meeting_id == meeting_id
        ).scalar() or 0
        item_number = max_num + 1
    else:
        item_number = item.item_number

    # Support duration_minutes as alias for time_allocated_minutes
    allocated_minutes = item.time_allocated_minutes or item.duration_minutes

    db_item = MeetingAgendaItem(
        tenant_id=meeting.tenant_id,
        meeting_id=meeting_id,
        item_number=item_number,
        title=item.title,
        description=item.description,
        item_type=item.item_type,
        presenter_id=item.presenter_id,
        linked_document_id=item.linked_document_id,
        linked_risk_id=item.linked_risk_id,
        linked_regulatory_change_id=item.linked_regulatory_change_id,
        time_allocated_minutes=allocated_minutes,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)

    return serialize_agenda_item(db_item)


@router.post("/meetings/{meeting_id}/agenda/upload-parse", status_code=status.HTTP_201_CREATED)
async def upload_and_parse_agenda(
    meeting_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Take a PDF/DOCX/TXT agenda document, parse it into structured
    agenda items via the heuristic + AI parser, and bulk-insert them
    against the meeting. Existing items are NOT touched — new ones get
    appended after the highest current item_number.

    Returns the freshly inserted items so the UI can render them
    immediately without an extra GET round-trip.
    """
    user_tenants = get_user_tenants(current_user, db)

    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants),
    ).first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file provided")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    try:
        file.file.seek(0)
    except Exception:
        pass

    # Extract plain text using the existing helper.
    try:
        extracted = extract_text_from_uploaded_action_file(file, file_bytes) or ""
    except Exception:
        logger.exception("Agenda upload-parse: text extraction failed for %s", file.filename)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the uploaded document.",
        )

    if not extracted.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The document is empty or unreadable.",
        )

    # Parse into agenda items.
    try:
        from ....services.agenda_parser import parse_agenda_items
        parsed = parse_agenda_items(extracted)
    except Exception:
        logger.exception("Agenda upload-parse: parser raised")
        parsed = []

    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Couldn't extract any agenda items from the document. "
                "Try formatting items with numbered headers (1. Title) "
                "or upload a more structured agenda."
            ),
        )

    # Append after the highest existing item_number.
    max_num = db.query(func.max(MeetingAgendaItem.item_number)).filter(
        MeetingAgendaItem.meeting_id == meeting_id,
    ).scalar() or 0

    inserted: List[MeetingAgendaItem] = []
    for idx, p in enumerate(parsed, start=1):
        row = MeetingAgendaItem(
            tenant_id=meeting.tenant_id,
            meeting_id=meeting_id,
            item_number=max_num + idx,
            title=p.get("title") or "Untitled agenda item",
            description=p.get("description"),
            item_type=p.get("item_type") or "discussion",
            time_allocated_minutes=p.get("time_allocated_minutes"),
            status="pending",
        )
        db.add(row)
        inserted.append(row)

    db.commit()
    for row in inserted:
        db.refresh(row)

    return {
        "inserted": len(inserted),
        "agenda_items": [serialize_agenda_item(r) for r in inserted],
    }


# ── Agenda item voting ─────────────────────────────────────────────────────
# One vote per user per agenda item. Re-posting updates (upsert). Tally is
# computed on every GET so it's always fresh. Comments are optional and
# free-text; the UI shows each vote alongside its commenter's display name.

_VALID_AGENDA_VOTES = {"agreed", "disagreed", "partial", "abstain"}


class AgendaVoteBody(BaseModel):
    vote: str
    comment: Optional[str] = None


def _get_agenda_item_for_user(item_id: int, user: GRCUser, db: Session):
    """Tenant-scoped fetch of an agenda item via its meeting → tenant."""
    user_tenants = get_user_tenants(user, db)
    from ....models import MeetingAgendaItem as _AI
    item = (
        db.query(_AI)
        .filter(_AI.id == item_id)
        .filter(_AI.tenant_id.in_(user_tenants))
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agenda item not found")
    return item


@router.post("/meetings/agenda/{item_id}/votes")
def cast_agenda_vote(
    item_id: int,
    body: AgendaVoteBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Cast or update the current user's vote on an agenda item.

    Idempotent — re-posting the same vote with a new comment just
    updates the comment. Vote values are validated against the allowed
    set (agreed / disagreed / partial / abstain); anything else returns 400.
    """
    item = _get_agenda_item_for_user(item_id, current_user, db)

    vote = (body.vote or "").strip().lower()
    if vote not in _VALID_AGENDA_VOTES:
        raise HTTPException(
            status_code=400,
            detail=f"vote must be one of: {', '.join(sorted(_VALID_AGENDA_VOTES))}",
        )

    from ....models import MeetingAgendaItemVote
    existing = (
        db.query(MeetingAgendaItemVote)
        .filter(MeetingAgendaItemVote.agenda_item_id == item.id)
        .filter(MeetingAgendaItemVote.user_id == current_user.id)
        .first()
    )
    if existing:
        existing.vote = vote
        if body.comment is not None:
            existing.comment = (body.comment or "").strip() or None
        db.commit()
        db.refresh(existing)
        return {
            "id": existing.id, "vote": existing.vote, "comment": existing.comment,
            "updated": True,
        }
    new_row = MeetingAgendaItemVote(
        tenant_id=item.tenant_id,
        agenda_item_id=item.id,
        user_id=current_user.id,
        vote=vote,
        comment=(body.comment or "").strip() or None,
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    return {
        "id": new_row.id, "vote": new_row.vote, "comment": new_row.comment,
        "updated": False,
    }


@router.get("/meetings/agenda/{item_id}/votes")
def list_agenda_votes(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List votes + tally for an agenda item.

    Returns:
      - `total`: vote count
      - `tally`: counts by vote type (every value in _VALID_AGENDA_VOTES)
      - `my_vote`: the caller's vote if they've voted, else None
      - `votes`: full list with user display names + comments
    """
    item = _get_agenda_item_for_user(item_id, current_user, db)
    from ....models import MeetingAgendaItemVote

    rows = (
        db.query(MeetingAgendaItemVote)
        .options(joinedload(MeetingAgendaItemVote.user))
        .filter(MeetingAgendaItemVote.agenda_item_id == item.id)
        .order_by(MeetingAgendaItemVote.updated_at.desc())
        .all()
    )
    tally = {v: 0 for v in _VALID_AGENDA_VOTES}
    my_vote = None
    for r in rows:
        tally[r.vote] = tally.get(r.vote, 0) + 1
        if r.user_id == current_user.id:
            my_vote = {"vote": r.vote, "comment": r.comment}

    return {
        "total": len(rows),
        "tally": tally,
        "my_vote": my_vote,
        "votes": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_name": (r.user.display_name or r.user.username) if r.user else None,
                "vote": r.vote,
                "comment": r.comment,
                "voted_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ],
    }


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


# What a committee decided about an item. The words are the ones the audit register already writes when the committee decides an extension request
# ("Approved", "Rejected"), plus "Deferred" and "Noted"; the item's own status follows (deferred, otherwise discussed).
OUTCOME_WORDS = ("Approved", "Rejected", "Deferred", "Noted")


class AgendaOutcomeBody(BaseModel):
    outcome: str                                                   # Approved | Rejected | Deferred | Noted (any case)
    decision_made: Optional[str] = Field(None, max_length=10000)   # what was decided; left out keeps the text there is, empty clears it


@router.put("/meetings/agenda/{item_id}/outcome")
def record_agenda_outcome(
    item_id: int,
    body: AgendaOutcomeBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Record the outcome and decision of an agenda item while its meeting is in progress, or after it to correct it (the audit row keeps old and new).
    A meeting that has not started, or was cancelled, takes none (409). Answers with the item. The raw PUT /meetings/agenda/{id} still accepts any text."""
    item = db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.id == item_id, MeetingAgendaItem.tenant_id.in_(get_user_tenants(current_user, db))).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agenda item not found")
    word = next((w for w in OUTCOME_WORDS if w.lower() == (body.outcome or "").strip().lower()), None)
    if word is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"outcome must be one of: {', '.join(OUTCOME_WORDS)}")
    meeting = db.get(CommitteeMeeting, item.meeting_id)
    if meeting is None or meeting.status not in ("in_progress", "completed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=(
            "This meeting was cancelled" if meeting is not None and meeting.status == "cancelled" else "Start the meeting before recording outcomes"))
    item.outcome = word
    if "decision_made" in body.model_fields_set:
        item.decision_made = (body.decision_made or "").strip() or None
    item.status = "deferred" if word == "Deferred" else "discussed"
    db.commit()
    db.refresh(item)
    return serialize_agenda_item(item)


@router.delete("/meetings/agenda/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agenda_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    item = db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.id == item_id,
        MeetingAgendaItem.tenant_id.in_(user_tenants)
    ).first()

    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agenda item not found")

    # A vote, or an audit-register extension request, points at the item: the database refuses the delete (it used to surface as a bare 500).
    # Say so, and remove nothing. (The vote check also holds where foreign keys are not enforced.)
    if db.query(MeetingAgendaItemVote.id).filter(MeetingAgendaItemVote.agenda_item_id == item.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="A vote was cast on an agenda item, so it cannot be removed")
    if db.query(AuditExtensionRequest.id).filter(AuditExtensionRequest.agenda_item_id == item.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="An audit extension request is attached to this agenda item, so it cannot be removed")
    try:
        db.delete(item)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Another record still points at this agenda item, so it cannot be removed")
    return None


# =============================================================================
# Meeting Attachments Endpoints
# =============================================================================

MEETING_ATTACHMENT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))),
    "uploads",
    "meeting_attachments"
)


def _serialize_meeting_attachment(att: MeetingAttachment) -> dict:
    return {
        "id": att.id,
        "meeting_id": att.meeting_id,
        "file_name": att.file_name,
        "file_type": att.file_type,
        "file_size": att.file_size,
        "description": att.description,
        "uploaded_by": att.uploaded_by,
        "uploaded_by_name": att.uploader.display_name if att.uploader else None,
        "uploaded_at": att.uploaded_at.isoformat() if att.uploaded_at else None,
    }


@router.get("/meetings/{meeting_id}/attachments")
def list_meeting_attachments(
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

    attachments = db.query(MeetingAttachment).options(
        joinedload(MeetingAttachment.uploader)
    ).filter(
        MeetingAttachment.meeting_id == meeting_id
    ).order_by(MeetingAttachment.uploaded_at.desc()).all()

    return [_serialize_meeting_attachment(a) for a in attachments]


@router.post("/meetings/{meeting_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_meeting_attachment(
    meeting_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
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

    tenant_dir = os.path.join(MEETING_ATTACHMENT_DIR, str(meeting.tenant_id), str(meeting_id))
    os.makedirs(tenant_dir, exist_ok=True)

    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    unique_filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(tenant_dir, unique_filename)

    content = await file.read()
    file_size = len(content)

    with open(file_path, "wb") as f:
        f.write(content)

    attachment = MeetingAttachment(
        tenant_id=meeting.tenant_id,
        meeting_id=meeting_id,
        file_name=file.filename or unique_filename,
        file_path=file_path,
        file_type=file_ext.lstrip(".") if file_ext else None,
        file_size=file_size,
        description=description,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    db.commit()
    # eager-load uploader for serialization
    attachment = db.query(MeetingAttachment).options(
        joinedload(MeetingAttachment.uploader)
    ).filter(MeetingAttachment.id == attachment.id).first()

    return _serialize_meeting_attachment(attachment)


@router.get("/meetings/attachments/{attachment_id}/download")
def download_meeting_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    attachment = db.query(MeetingAttachment).filter(
        MeetingAttachment.id == attachment_id,
        MeetingAttachment.tenant_id.in_(user_tenants)
    ).first()

    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    if not attachment.file_path or not os.path.exists(attachment.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk")

    return FileResponse(
        path=attachment.file_path,
        filename=attachment.file_name,
        media_type="application/octet-stream",
    )


@router.delete("/meetings/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    attachment = db.query(MeetingAttachment).filter(
        MeetingAttachment.id == attachment_id,
        MeetingAttachment.tenant_id.in_(user_tenants)
    ).first()

    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    # Best-effort file removal — DB record is the source of truth
    try:
        if attachment.file_path and os.path.exists(attachment.file_path):
            os.remove(attachment.file_path)
    except OSError:
        logger.warning("Failed to remove attachment file %s", attachment.file_path, exc_info=True)

    db.delete(attachment)
    db.commit()
    return None


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
        GovernanceDocument.status.in_(["pending_review", "pending_approval"])
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
    
    pending_exceptions = db.query(ControlException).filter(
        ControlException.tenant_id == meeting.tenant_id,
        ControlException.status == "pending"
    ).all()

    for exc in pending_exceptions:
        suggested_items.append({
            "source_type": "exception",
            "source_id": exc.id,
            "title": f"Risk Exception Review: {exc.title}",
            "description": exc.justification or f"Review risk exception: {exc.title}",
            "item_type": "decision",
            "linked_document_id": None,
            "linked_risk_id": None,             # an exception is not a risk: its id names no risk
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
    body: AutoPopulateRequest = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Auto-populate meeting agenda from pending governance approvals"""
    # Support both body and query param for include_* flags
    opts = body or AutoPopulateRequest()
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
    
    if opts.include_documents:
        pending_documents = db.query(GovernanceDocument).filter(
            GovernanceDocument.tenant_id == meeting.tenant_id,
            GovernanceDocument.status.in_(["pending_review", "pending_approval"])
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
    
    exception_items = 0
    if opts.include_exceptions:
        pending_exceptions = db.query(ControlException).filter(
            ControlException.tenant_id == meeting.tenant_id,
            ControlException.status == "pending"
        ).all()

        for exc in pending_exceptions:
            current_item_number += 1
            agenda_item = MeetingAgendaItem(          # no risk link: an exception's id names no risk
                tenant_id=meeting.tenant_id,
                meeting_id=meeting_id,
                item_number=current_item_number,
                title=f"Risk Exception Review: {exc.title}",
                description=exc.justification or f"Review risk exception: {exc.title}",
                item_type="decision",
                status="pending",
            )
            db.add(agenda_item)
            created_items.append(agenda_item)
            exception_items += 1
    
    if opts.include_regulatory_changes:
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
        "items_added": len(created_items),
        "created_items": [serialize_agenda_item(item) for item in created_items],
        "total_created": len(created_items),
        "by_type": {
            "documents": sum(1 for item in created_items if item.linked_document_id is not None),
            "exceptions": exception_items,
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


@router.post("/meetings/{meeting_id}/minutes/upload", status_code=status.HTTP_201_CREATED)
async def upload_minutes_document(
    meeting_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Upload a minutes document (PDF / DOCX / TXT / MD / CSV) and store
    its extracted text as the meeting minutes content. If minutes already
    exist for this meeting, the upload replaces the content but preserves
    the existing approval state unless the existing record was already
    approved (in which case we drop back to draft and clear the approver
    so changes go through review again).

    The user can edit the extracted text afterwards via the existing
    PUT /meetings/minutes/{id} endpoint.
    """
    user_tenants = get_user_tenants(current_user, db)

    meeting = db.query(CommitteeMeeting).filter(
        CommitteeMeeting.id == meeting_id,
        CommitteeMeeting.tenant_id.in_(user_tenants),
    ).first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file provided")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    # 10 MB cap. Minutes documents shouldn't be larger than this in
    # practice; bigger uploads are almost always the wrong file.
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum allowed size is 10 MB.",
        )

    try:
        file.file.seek(0)
    except Exception:
        pass

    try:
        extracted = extract_text_from_uploaded_action_file(file, file_bytes) or ""
    except Exception:
        logger.exception("Minutes upload: text extraction failed for %s", file.filename)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the uploaded document.",
        )

    extracted = extracted.strip()
    if not extracted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The document is empty or unreadable. "
                "Scanned PDFs without OCR are not supported — upload a "
                "text-based PDF, DOCX, or TXT."
            ),
        )

    existing = db.query(MeetingMinutes).filter(
        MeetingMinutes.meeting_id == meeting_id,
    ).first()

    if existing:
        existing.content = extracted
        # Uploading a new doc invalidates any prior approval — drop back
        # to draft so reviewers see the change.
        if existing.status == "approved":
            existing.status = "draft"
            existing.approved_by = None
            existing.approved_at = None
        existing.drafted_by = current_user.id
        existing.drafted_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return {
            "uploaded": True,
            "filename": file.filename,
            "characters": len(extracted),
            "replaced_existing": True,
            "minutes": serialize_minutes(existing),
        }

    db_minutes = MeetingMinutes(
        tenant_id=meeting.tenant_id,
        meeting_id=meeting_id,
        content=extracted,
        attendees=[],
        status="draft",
        drafted_by=current_user.id,
    )
    db.add(db_minutes)
    db.commit()
    db.refresh(db_minutes)
    return {
        "uploaded": True,
        "filename": file.filename,
        "characters": len(extracted),
        "replaced_existing": False,
        "minutes": serialize_minutes(db_minutes),
    }


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
    _refuse_if_inactive(db.get(GovernanceCommittee, meeting.committee_id))

    action_count = db.query(OversightAction).filter(
        OversightAction.committee_id == meeting.committee_id
    ).count()
    action_number = action.action_number or f"ACT-{meeting.committee_id}-{action_count + 1:04d}"
    try:
        priority, due_date, raised_at = committee_tasks.prepare(
            db, meeting.tenant_id, action.priority, action.due_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [action.assigned_to])

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
        priority=priority,
        due_date=due_date,
        created_at=raised_at,
        linked_policy_id=action.linked_policy_id,
        linked_risk_id=action.linked_risk_id,
        created_by=current_user.id,
    )
    db.add(db_action)
    db.flush()
    committee_tasks.mirror(db, db_action, current_user.id)
    db.commit()
    db.refresh(db_action)

    return serialize_action(db_action)

def _due_bound(text: Optional[str], name: str, upper: bool) -> Optional[tuple]:
    """A due-date bound as (instant, exclusive). A bare date (2026-11-02) is a calendar day, as in Audit Logs' start and end dates: due_after begins at the
    start of that day and due_before runs to the END of it, so nobody adds a day or looks up the last day of a month. A date and time is that instant
    (an offset is converted to UTC, the server's clock), included at both ends, as Task Management's own due_after and due_before are."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            day = datetime.combine(date.fromisoformat(text), dtime.min)
            return (day + timedelta(days=1), True) if upper else (day, False)
        moment = datetime.fromisoformat(text.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"{name} must be a date (2026-11-02) or a date and time (2026-11-02T14:30:00)")
    return (moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment), False


@router.get("/actions")
def list_actions(
    tenant_id: Optional[int] = None,
    committee_id: Optional[int] = None,
    # one status word, or several separated by commas ("open,in_progress")
    status_filter: Optional[str] = Query(None, alias="status"),
    action_type: Optional[str] = None,
    # a user id, or "me" for the caller
    assigned_to: Optional[str] = None,
    overdue_only: bool = False,
    # a due-date range, exact at midnight and at the end of a month (see _due_bound): a bare date is the whole calendar day, so "this week" is
    # due_after=2026-11-02&due_before=2026-11-08 and November is due_after=2026-11-01&due_before=2026-11-30; a date and time is that instant, included at
    # both ends ("not overdue yet" is due_after=<now>). An action with no due date never matches.
    due_after: Optional[str] = None,
    due_before: Optional[str] = None,
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
    words = [w.strip() for w in (status_filter or "").split(",") if w.strip()]
    if words:
        query = query.filter(OversightAction.status.in_(words))
    if action_type:
        query = query.filter(OversightAction.action_type == action_type)
    if (assigned_to or "").strip():
        who = (assigned_to or "").strip().lower()
        if who == "me":
            who = current_user.id
        else:
            try:
                who = int(who)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="assigned_to must be a user id or me")
        if who:                                   # 0 has always meant no filter
            query = query.filter(OversightAction.assigned_to == who)
    if overdue_only:
        query = query.filter(
            OversightAction.status.in_(["open", "in_progress"]),
            OversightAction.due_date < datetime.utcnow()
        )
    after, before = _due_bound(due_after, "due_after", False), _due_bound(due_before, "due_before", True)
    if after:
        query = query.filter(OversightAction.due_date >= after[0])
    if before:
        query = query.filter(OversightAction.due_date < before[0] if before[1] else OversightAction.due_date <= before[0])

    total = query.count()
    # the id breaks a tie between equal due dates, so a page boundary never repeats or skips a row
    actions = query.order_by(OversightAction.due_date.asc().nullslast(), OversightAction.id.asc()).offset(skip).limit(limit).all()
    
    sla_settings = {tid: committee_tasks.sla_settings(db, tid) for tid in {a.tenant_id for a in actions}}
    return {
        "items": [serialize_action(a, sla_settings[a.tenant_id]) for a in actions],
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
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [update_data.get("assigned_to")], kept=[action.assigned_to])

    if update_data.get("status") == "completed" and action.status != "completed":
        update_data["completed_at"] = datetime.utcnow()
    if "priority" in update_data:
        try:
            update_data["priority"] = committee_tasks.clean_priority(update_data["priority"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
        if update_data["priority"] != (action.priority or "medium") and "due_date" not in update_data:
            update_data["due_date"] = committee_tasks.due_after_reprioritising(db, action, update_data["priority"])

    for key, value in update_data.items():
        setattr(action, key, value)

    committee_tasks.mirror(db, action, current_user.id)
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
    _refuse_if_inactive(committee)

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
    try:
        priority, due_date, raised_at = committee_tasks.prepare(db, committee.tenant_id, action.priority, action.due_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [action.assigned_to])

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
        priority=priority,
        due_date=due_date,
        created_at=raised_at,
        linked_policy_id=action.linked_policy_id,
        linked_risk_id=action.linked_risk_id,
        created_by=current_user.id,
    )
    db.add(db_action)
    db.flush()
    committee_tasks.mirror(db, db_action, current_user.id)
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
    # the health strip: the same function, and so the same values, as this committee's row in GET /overview
    result.update(_committee_health(
        db, [committee.id],
        {committee.id: db.query(CommitteeMeeting.id, CommitteeMeeting.title, CommitteeMeeting.status, CommitteeMeeting.scheduled_date).filter(
            CommitteeMeeting.committee_id == committee.id).all()},
        {committee.id: db.query(OversightAction.status, OversightAction.due_date).filter(OversightAction.committee_id == committee.id).all()},
        {committee.id: len(result["members"])}, datetime.utcnow())[committee.id])

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
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [update_data.get("chair_id"), update_data.get("secretary_id")],
                             kept=[committee.chair_id, committee.secretary_id])
    if update_data.get("is_active") is False and _is_active(committee):
        _refuse_deactivation_while_a_request_waits(db, committee)       # the same rule as POST /deactivate, whichever way in
    for key, value in update_data.items():
        setattr(committee, key, value)
    
    db.commit()
    db.refresh(committee)
    
    return serialize_committee(committee, db)


def _committee_of(committee_id: int, current_user: GRCUser, db: Session) -> GovernanceCommittee:
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(get_user_tenants(current_user, db))
    ).first()
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    return committee


@router.post("/{committee_id}/deactivate", dependencies=[_remove])
def deactivate_committee(
    committee_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Retire a committee without losing anything: it stops being offered (pickers, the audit register's meeting list) and accepts no new meetings,
    actions or members; every record it holds stays and stays readable, open actions and scheduled meetings exactly as they are. Reversible with
    /reactivate. Needs governance:committees:delete. Refused (409) while an audit-register extension request is waiting for its decision at one of
    its meetings. Already inactive: nothing to do, the committee comes back as it is."""
    committee = _committee_of(committee_id, current_user, db)
    if _is_active(committee):
        _refuse_deactivation_while_a_request_waits(db, committee)
        committee.is_active = False
        db.commit()
        db.refresh(committee)
    return serialize_committee(committee, db)


@router.post("/{committee_id}/reactivate", dependencies=[_remove])
def reactivate_committee(
    committee_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Undo /deactivate: the committee is offered again and accepts new meetings, actions and members. Needs governance:committees:delete."""
    committee = _committee_of(committee_id, current_user, db)
    if not _is_active(committee):
        committee.is_active = True
        db.commit()
        db.refresh(committee)
    return serialize_committee(committee, db)


@router.delete("/{committee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_committee(
    committee_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """An administrator's HARD delete, for API clients and scripts (the screens only Deactivate): removes the committee with its members, charters,
    meetings, agendas, minutes, attachment rows and actions, and the Task Management copy of every action. It cannot be undone. A vote on any of its
    agenda items, or an audit-register extension request on one of its meetings, makes it answer 409 and remove nothing: deactivate instead."""
    committee = _committee_of(committee_id, current_user, db)

    meetings = select(CommitteeMeeting.id).where(CommitteeMeeting.committee_id == committee.id)
    items = select(MeetingAgendaItem.id).where(MeetingAgendaItem.meeting_id.in_(meetings))
    if db.query(MeetingAgendaItemVote.id).filter(MeetingAgendaItemVote.agenda_item_id.in_(items)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="A vote was cast on an agenda item. Deactivate the committee instead")
    if _extension_requests_on(db, committee.id, open_only=False):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="An audit extension request points at a meeting of this committee. Deactivate the committee instead")

    for action in db.query(OversightAction).filter(OversightAction.committee_id == committee.id):
        committee_tasks.drop_twin(db, action)
    try:
        db.delete(committee)
        db.commit()
    except IntegrityError:
        # something else still points at it (the checks above name the two known ones): nothing was removed, the twins are back with the rollback
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Another record still points at this committee. Deactivate the committee instead")
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
    _refuse_if_inactive(committee)
    from ....routers.auth_router import refuse_imported_accounts

    refuse_imported_accounts(db, [member.user_id])

    # A removed member's row is kept (left_at set), and (committee, user) is unique: adding the same person again brings that row back
    # instead of failing on the unique constraint. joined_at / left_at / role are their new values; the audit row keeps the old ones.
    existing = db.query(CommitteeMember).filter(
        CommitteeMember.committee_id == committee_id,
        CommitteeMember.user_id == member.user_id,
    ).first()

    if existing and existing.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already an active member of this committee"
        )

    if existing:
        db_member = existing
        db_member.is_active = True
        db_member.left_at = None
        db_member.joined_at = datetime.utcnow()
        db_member.role = member.role
    else:
        db_member = CommitteeMember(
            tenant_id=committee.tenant_id,
            committee_id=committee_id,
            user_id=member.user_id,
            role=member.role,
        )
        db.add(db_member)

    # Mirror chair/secretary roles onto the committee record so that adding a
    # chair after creation is reflected on the overview header (chair_name,
    # secretary_name come from these denormalized FKs in serialize_committee).
    if member.role == "chair":
        committee.chair_id = member.user_id
    elif member.role == "secretary":
        committee.secretary_id = member.user_id

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

    # Clear the denormalized chair/secretary FK if the user being removed was
    # in that role; otherwise the committee header would keep showing them.
    if member.role == "chair" and committee.chair_id == user_id:
        committee.chair_id = None
    elif member.role == "secretary" and committee.secretary_id == user_id:
        committee.secretary_id = None

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


@router.post("/{committee_id}/charters/upload-new", status_code=status.HTTP_201_CREATED)
async def upload_new_charter(
    committee_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    version: Optional[str] = Form("1.0"),
    status_value: Optional[str] = Form("draft"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Create a new committee charter directly from an uploaded document.

    One round-trip from the UI: takes the file, extracts plain text into
    `content` (best-effort — empty content is fine, the operator can edit
    later), saves the file to the per-tenant upload directory, and stamps
    file_path/name/type/size on the new row. The returned shape matches
    the regular create endpoint so the frontend can reuse its render
    code.

    Use this when the customer already has a Word/PDF charter and wants
    to import it as the canonical version. The `AI Generate Charter`
    button is for the opposite case — drafting one from scratch.
    """
    user_tenants = get_user_tenants(current_user, db)

    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id.in_(user_tenants),
    ).first()
    if not committee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file provided")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    # Reset the SpooledTemporaryFile so extract_text can read again from
    # the start. The action-file extractor expects `file.file` to be seekable.
    try:
        file.file.seek(0)
    except Exception:
        pass

    # Best-effort text extraction (PDF / DOCX / TXT). Bad/unsupported
    # formats just leave content empty — the operator can edit later.
    extracted_text = ""
    try:
        extracted_text = extract_text_from_uploaded_action_file(file, file_bytes) or ""
    except Exception:
        logger.exception("Charter upload-new: text extraction failed for %s", file.filename)

    # Derive a sensible title from the filename when the caller didn't supply one.
    derived_title = (title or "").strip()
    if not derived_title:
        stem = os.path.splitext(file.filename)[0]
        derived_title = (stem or "Uploaded Charter").replace("_", " ").replace("-", " ")[:255]

    # Parse the extracted text into AI-style sections so the UI can
    # render the uploaded charter in the same beautiful panel as the
    # AI-drafted one. Best-effort — failure leaves sections NULL and the
    # plain content path still renders.
    parsed_sections = None
    try:
        from ....services.charter_parser import parse_charter_sections
        if extracted_text and extracted_text.strip():
            parsed_sections = parse_charter_sections(extracted_text)
    except Exception:
        logger.exception("Charter upload-new: section parsing failed")
        parsed_sections = None

    db_charter = CommitteeCharter(
        tenant_id=committee.tenant_id,
        committee_id=committee_id,
        version=(version or "1.0").strip() or "1.0",
        title=derived_title,
        content=extracted_text or None,
        sections_json=parsed_sections,
        status=(status_value or "draft").strip() or "draft",
        created_by=current_user.id,
    )
    db.add(db_charter)
    db.commit()
    db.refresh(db_charter)

    # Persist the file alongside the row so users can re-download it later.
    tenant_upload_dir = os.path.join(UPLOAD_DIR, str(db_charter.tenant_id))
    os.makedirs(tenant_upload_dir, exist_ok=True)
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    unique_filename = f"{db_charter.id}_{uuid.uuid4().hex[:8]}{file_ext}"
    file_path = os.path.join(tenant_upload_dir, unique_filename)
    try:
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        db_charter.file_path = file_path
        db_charter.file_name = file.filename
        db_charter.file_type = file_ext.lstrip(".") if file_ext else None
        db_charter.file_size = len(file_bytes)
        db.commit()
        db.refresh(db_charter)
    except Exception:
        logger.exception("Charter upload-new: file save failed (row already created)")
        # Row is intentionally kept — the operator has the extracted text;
        # they can re-upload the file separately.

    return serialize_charter(db_charter)




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
    counts = _meeting_counts(db, meetings)

    return {
        "items": [serialize_meeting(m, db, counts[m.id]) for m in meetings],
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
    _refuse_if_inactive(committee)

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
            model=get_openai_model(),
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
            model=get_openai_model(),
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









