"""Risk actions (Actions & Acceptances). Since wave 2-E they are CAPA actions (IssueAction) on the risk's treatment
issue: see issue_management/services/risk_actions.py. This API keeps the old /mitigation-actions paths and fields;
the ids it returns and takes are IssueAction ids. The old grc_risk_mitigation_actions rows are copied over on first
use and kept, read-only, for audit."""
from ....config import get_openai_api_key
from collections import defaultdict
from typing import List, Optional
import os, json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, contains_eager, joinedload
from openai import OpenAI

from ....models import (
    Risk, GRCUser, Issue, IssueAction, IssueActionEvidence,
    InternalControl, NormalizedControl, Evidence, get_db
)
from ..services.risk_control_links import risk_control_links
from ....schemas import (
    RiskMitigationActionCreate, RiskMitigationActionUpdate, RiskMitigationActionComplete, MessageResponse
)
from ....routers.auth_router import (
    require_auth, require_tenant_permission, get_user_tenants, refuse_imported_accounts,
)
from ....services.ai_gateway.field_policies import ai_view
from ...issue_management.routers import actions as capa
from ...issue_management.services.risk_actions import (
    LEGACY_STATUS, OPEN_ACTION_STATUSES, add_risk_action, migrate_legacy_actions, risk_actions_query,
)

router = APIRouter(prefix="/mitigation-actions", tags=["ERM - Mitigation Actions"])

# Writes need the module's own grant, or the broad risk-editor one that kept today's editors working.
CAN_CREATE = [Depends(require_tenant_permission("erm:mitigation_actions:create", "erm:risks:create"))]
CAN_EDIT = [Depends(require_tenant_permission("erm:mitigation_actions:edit", "erm:risks:edit"))]
CAN_DELETE = [Depends(require_tenant_permission("erm:mitigation_actions:delete", "erm:risks:delete"))]

# The CAPA engine's open statuses: the ERM dashboard's overdue count (dashboard.py) uses the same rule.
OPEN_STATUSES = OPEN_ACTION_STATUSES


def _get_openai_client() -> OpenAI:
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API key not configured"
        )
    return OpenAI(api_key=api_key, base_url=base_url)


class AISuggestMitigationsRequest(BaseModel):
    risk_id: Optional[int] = None
    title: Optional[str] = None


class SuggestedMitigation(BaseModel):
    title: str
    description: str
    action_type: str
    priority: str
    expected_residual_reduction: float


class AISuggestMitigationsResponse(BaseModel):
    suggestions: List[SuggestedMitigation]


@router.post("/ai-suggest", response_model=AISuggestMitigationsResponse, dependencies=[Depends(require_tenant_permission(
    "erm:mitigation_actions:create", "erm:risks:create", "erm:mitigation_actions:edit", "erm:risks:edit"))])  # AI budget
def ai_suggest_mitigations(
    request: AISuggestMitigationsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not request.risk_id and not request.title:
        raise HTTPException(status_code=400, detail="Either risk_id or title must be provided")

    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Tenant not found")

    risk = None
    if request.risk_id:
        risk = db.query(Risk).filter(
            Risk.id == request.risk_id,
            Risk.tenant_id.in_(user_tenants)
        ).first()
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")

    existing_controls = []
    try:
        if risk:     # the controls actually linked to this risk; SCF wording is licensed text, not sent to a model
            existing_controls = [f"Linked control {c['control_id']} (wording withheld: licensed text)" if c["restricted"]
                                 else c["name"] for c in risk_control_links(db, [risk.id])[risk.id] if c["name"]]
        if not existing_controls:
            controls = db.query(InternalControl).filter(
                InternalControl.tenant_id.in_(user_tenants)
            ).limit(20).all()
            existing_controls = [c.name for c in controls if c.name]
    except Exception:
        pass

    existing_action_titles: list = []
    if risk:
        existing_action_titles = [a.title for a in risk_actions_query(db, [risk.tenant_id]).filter(
            Issue.source_id == risk.id).all()]

    if risk:
        v = ai_view(risk, "erm.mitigation_suggest")     # what the field policy lets this prompt carry
        prompt = f"""You are an enterprise risk management expert. Given the following risk details, suggest 3-5 concrete mitigation actions.

Risk Title: {v['title']}
Risk Description: {v['description'] or 'N/A'}
Risk Category: {v['category'] or 'N/A'}
Risk Sub-Category: {v['risk_sub_category'] or 'N/A'}
Inherent Likelihood: {v['inherent_likelihood'] or 'N/A'}
Inherent Impact: {v['inherent_impact'] or 'N/A'}
Residual Likelihood: {v['residual_likelihood'] or 'N/A'}
Residual Impact: {v['residual_impact'] or 'N/A'}
Current Treatment Status: {v['status'] or 'N/A'}
Existing Controls: {', '.join(existing_controls[:10]) if existing_controls else 'None identified'}
Existing Mitigation Actions: {', '.join(existing_action_titles) if existing_action_titles else 'None yet'}

Return a JSON object with a "suggestions" array containing 3-5 mitigation actions. Each suggestion must have:
- "title": concise action title (max 100 chars)
- "description": detailed description of what to do (2-3 sentences)
- "action_type": one of "mitigate", "transfer", "avoid", "accept"
- "priority": one of "critical", "high", "medium", "low"
- "expected_residual_reduction": estimated percentage reduction in residual risk (number 5-50)

Do NOT duplicate existing mitigation actions. Focus on practical, actionable items.
Return ONLY valid JSON, no markdown."""
    else:
        prompt = f"""You are an enterprise risk management expert. Given the following mitigation action title, suggest 3-5 related concrete mitigation actions.

Action Title: {request.title}
Existing Controls: {', '.join(existing_controls[:10]) if existing_controls else 'None identified'}

Return a JSON object with a "suggestions" array containing 3-5 mitigation actions. Each suggestion must have:
- "title": concise action title (max 100 chars)
- "description": detailed description of what to do (2-3 sentences)
- "action_type": one of "mitigate", "transfer", "avoid", "accept"
- "priority": one of "critical", "high", "medium", "low"
- "expected_residual_reduction": estimated percentage reduction in residual risk (number 5-50)

Focus on practical, actionable items related to the given title.
Return ONLY valid JSON, no markdown."""

    try:
        client = _get_openai_client()
        model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an enterprise risk management expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000,
        )

        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        data = json.loads(content)
        suggestions = data.get("suggestions", data if isinstance(data, list) else [])

        valid_types = {"mitigate", "transfer", "avoid", "accept"}
        valid_priorities = {"critical", "high", "medium", "low"}

        result = []
        for s in suggestions[:5]:
            result.append(SuggestedMitigation(
                title=s.get("title", "Untitled Action")[:100],
                description=s.get("description", ""),
                action_type=s.get("action_type", "mitigate") if s.get("action_type") in valid_types else "mitigate",
                priority=s.get("priority", "medium") if s.get("priority") in valid_priorities else "medium",
                expected_residual_reduction=min(max(float(s.get("expected_residual_reduction", 15)), 1), 100),
            ))

        return AISuggestMitigationsResponse(suggestions=result)

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {str(e)}")


# ─── Responses: the old mitigation-action fields, read from the CAPA action ──────────────────────────────────────

class _MitigationEvidenceLinkCreate(BaseModel):
    evidence_id: int
    notes: Optional[str] = None


class _MitigationEvidenceLinkResponse(BaseModel):
    id: int
    evidence_id: int
    title: str
    description: Optional[str] = None
    evidence_type: Optional[str] = None
    status: Optional[str] = None
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    notes: Optional[str] = None
    linked_at: Optional[datetime] = None


class TreatmentActionResponse(BaseModel):
    """`id` is the IssueAction id; `issue_id` the risk's treatment issue. Status is the CAPA engine's
    (planned, in_progress, blocked, completed, verified, cancelled); overdue is an open action past its due date."""
    id: int
    issue_id: int
    risk_id: Optional[int] = None
    risk_title: Optional[str] = None
    title: str
    description: Optional[str] = None
    action_type: str
    status: str
    priority: str = "medium"
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    due_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    completed_by: Optional[int] = None
    verified_by_id: Optional[int] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[datetime] = None
    expected_residual_reduction: Optional[float] = None
    actual_residual_reduction: Optional[float] = None
    evidence_id: Optional[int] = None
    evidence: List[_MitigationEvidenceLinkResponse] = []
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    legacy_mitigation_action_id: Optional[int] = None


class _CompleteBody(RiskMitigationActionComplete):
    evidence_id: Optional[int] = None       # the proof, linked to the action as it is marked done


class _VerifyBody(BaseModel):
    notes: Optional[str] = None


def _name(user: Optional[GRCUser]) -> Optional[str]:
    return (user.display_name or user.username) if user else None


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value and value.tzinfo else value


def _serialize_evidence_link(link: IssueActionEvidence) -> _MitigationEvidenceLinkResponse:
    ev = link.evidence
    return _MitigationEvidenceLinkResponse(
        id=link.id,
        evidence_id=ev.id,
        title=getattr(ev, "name", None) or ev.file_name or "",
        description=ev.description,
        evidence_type=ev.evidence_type,
        status=ev.status,
        file_name=ev.file_name,
        file_url=getattr(ev, "file_url", None),
        notes=link.notes,
        linked_at=link.linked_at,
    )


def _serialize(db: Session, actions: List[IssueAction]) -> List[TreatmentActionResponse]:
    if not actions:
        return []
    links = defaultdict(list)
    for link in db.query(IssueActionEvidence).options(joinedload(IssueActionEvidence.evidence)).filter(
            IssueActionEvidence.issue_action_id.in_([a.id for a in actions])).order_by(IssueActionEvidence.id):
        if link.evidence is not None:
            links[link.issue_action_id].append(_serialize_evidence_link(link))
    risk_titles = dict(db.query(Risk.id, Risk.title).filter(Risk.id.in_({a.issue.source_id for a in actions})).all())
    return [TreatmentActionResponse(
        id=a.id, issue_id=a.issue_id, risk_id=a.issue.source_id, risk_title=risk_titles.get(a.issue.source_id),
        title=a.title, description=a.description, action_type=a.action_type or "mitigate", status=a.status,
        priority=a.priority or "medium", owner_id=a.assignee_id, owner_name=_name(a.assignee),
        due_date=a.due_date, completed_at=a.completed_at, completed_by=a.completed_by,
        verified_by_id=a.verified_by_id, verified_by_name=_name(a.verifier), verified_at=a.verified_at,
        expected_residual_reduction=a.expected_residual_reduction,
        actual_residual_reduction=a.actual_residual_reduction,
        evidence_id=a.evidence_id, evidence=links[a.id], notes=a.notes, created_at=a.created_at,
        updated_at=a.verified_at or a.completed_at or a.created_at,
        legacy_mitigation_action_id=a.legacy_mitigation_action_id,
    ) for a in actions]


def _actions(db: Session, tenant_ids):
    return risk_actions_query(db, tenant_ids).options(
        contains_eager(IssueAction.issue), joinedload(IssueAction.assignee), joinedload(IssueAction.verifier))


def _get_action_or_404(action_id: int, db: Session, current_user: GRCUser) -> IssueAction:
    """A risk action in one of the caller's tenants (the CAPA actions of other issues are not served here)."""
    action = _actions(db, get_user_tenants(current_user, db) or []).filter(IssueAction.id == action_id).first()
    if not action:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitigation action not found")
    return action


def _one(db: Session, current_user: GRCUser, action_id: int) -> TreatmentActionResponse:
    db.expire_all()
    return _serialize(db, [_get_action_or_404(action_id, db, current_user)])[0]


def _capa_status(value: str) -> str:
    """The CAPA status for a status sent in the old words or the new ones."""
    word = value.strip().lower()
    mapped = "verified" if word == "verified" else LEGACY_STATUS.get(word)
    if not mapped:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status '{value}'")
    return mapped


def get_risk_for_user(risk_id: int, db: Session, current_user: GRCUser):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return None
    return db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id.in_(user_tenants)).first()


# ─── Tenant-wide lists ───────────────────────────────────────────────────────────────────────────────────────────

@router.get("/overdue", response_model=List[TreatmentActionResponse])
def list_overdue_actions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    migrate_legacy_actions(db, user_tenants)
    actions = _actions(db, user_tenants).filter(
        IssueAction.status.in_(OPEN_STATUSES), IssueAction.due_date < datetime.utcnow(),
    ).order_by(IssueAction.due_date.asc()).all()
    return _serialize(db, actions)


@router.get("", response_model=List[TreatmentActionResponse])
def list_actions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Every risk action across the caller's tenants, earliest due first."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    migrate_legacy_actions(db, user_tenants)
    actions = _actions(db, user_tenants).order_by(IssueAction.due_date.asc().nullslast(), IssueAction.id).all()
    return _serialize(db, actions)


@router.get("/{action_id}", response_model=TreatmentActionResponse)
def get_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return _serialize(db, [_get_action_or_404(action_id, db, current_user)])[0]


# ─── Writes: through the CAPA engine's own rules ─────────────────────────────────────────────────────────────────

@router.put("/{action_id}", response_model=TreatmentActionResponse, dependencies=CAN_EDIT)
def update_action(
    action_id: int,
    action_update: RiskMitigationActionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    action = _get_action_or_404(action_id, db, current_user)
    data = action_update.model_dump(exclude_unset=True)
    refuse_imported_accounts(db, [data.get("owner_id")], kept=[action.assignee_id])
    for key in ("priority", "expected_residual_reduction", "actual_residual_reduction", "notes"):
        if key in data:
            setattr(action, key, data[key])
    body = {key: data[key] for key in ("title", "description", "action_type", "evidence_id") if key in data}
    if "owner_id" in data:
        body["assignee_id"] = data["owner_id"]
    if "due_date" in data:
        body["due_date"] = _naive_utc(data["due_date"])
    if data.get("status") is not None:
        body["status"] = _capa_status(data["status"])
    capa.update_action(action.id, body, db=db, current_user=current_user)   # stamps completion, refuses self-verification
    return _one(db, current_user, action.id)


@router.delete("/{action_id}", response_model=MessageResponse, dependencies=CAN_DELETE)
def delete_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    action = _get_action_or_404(action_id, db, current_user)
    capa.delete_action(action.id, db=db, current_user=current_user)
    return {"message": "Action deleted", "id": action_id}


@router.post("/{action_id}/complete", response_model=TreatmentActionResponse, dependencies=CAN_EDIT)
def complete_action(
    action_id: int,
    body: Optional[_CompleteBody] = None,
    actual_reduction: Optional[float] = None,       # the older query-parameter form, still accepted
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Mark done, optionally with the achieved reduction and the evidence. A second person then verifies it."""
    body = body or _CompleteBody()
    if body.actual_residual_reduction is not None:
        actual_reduction = body.actual_residual_reduction
    action = _get_action_or_404(action_id, db, current_user)
    if actual_reduction is not None:
        action.actual_residual_reduction = actual_reduction
    if body.evidence_id is not None:
        _link_evidence(db, action, body.evidence_id, current_user, refuse_duplicate=False)
    if action.status in ("completed", "verified"):
        db.commit()
    else:
        capa.update_action(action.id, {"status": "completed"}, db=db, current_user=current_user)
    return _one(db, current_user, action.id)


@router.post("/{action_id}/verify", response_model=TreatmentActionResponse, dependencies=CAN_EDIT)
def verify_action(
    action_id: int,
    body: Optional[_VerifyBody] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """A second person checks the evidence. Whoever completed the action, or is assigned it, gets 409."""
    action = _get_action_or_404(action_id, db, current_user)
    capa.verify_action(action.id, {"notes": (body or _VerifyBody()).notes}, db=db, current_user=current_user)
    return _one(db, current_user, action.id)


# ─── Per risk ────────────────────────────────────────────────────────────────────────────────────────────────────

risk_actions_router = APIRouter(prefix="/risks", tags=["ERM - Risk Mitigation Actions"])


@risk_actions_router.get("/{risk_id}/mitigation-actions", response_model=List[TreatmentActionResponse])
def list_risk_actions(
    risk_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = get_risk_for_user(risk_id, db, current_user)
    if not risk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found")
    migrate_legacy_actions(db, [risk.tenant_id])
    query = _actions(db, [risk.tenant_id]).filter(Issue.source_id == risk_id)
    if status_filter:
        query = query.filter(IssueAction.status == LEGACY_STATUS.get(status_filter, status_filter))
    return _serialize(db, query.order_by(IssueAction.due_date.asc().nullslast(), IssueAction.id).all())


@risk_actions_router.post("/{risk_id}/mitigation-actions", response_model=TreatmentActionResponse,
                          status_code=status.HTTP_201_CREATED, dependencies=CAN_CREATE)
def create_risk_action(
    risk_id: int,
    action: RiskMitigationActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """A new action on the risk's treatment issue (made on first use). No due date: the issue's SLA date."""
    risk = get_risk_for_user(risk_id, db, current_user)
    if not risk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found")
    refuse_imported_accounts(db, [action.owner_id])
    created = add_risk_action(
        db, risk, current_user.id, title=action.title, description=action.description,
        action_type=action.action_type or "mitigate", priority=action.priority or "medium",
        assignee_id=action.owner_id, due_date=_naive_utc(action.due_date),
        expected_residual_reduction=action.expected_residual_reduction, notes=action.notes,
    )
    db.commit()
    return _one(db, current_user, created.id)


# ─── Evidence on an action (several per action; IssueAction.evidence_id holds the first) ────────────────────────

def _link_evidence(db: Session, action: IssueAction, evidence_id: int, current_user: GRCUser,
                   notes: Optional[str] = None, refuse_duplicate: bool = True) -> Optional[IssueActionEvidence]:
    ev = db.query(Evidence).filter(Evidence.id == evidence_id, Evidence.tenant_id == action.issue.tenant_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    existing = db.query(IssueActionEvidence).filter(
        IssueActionEvidence.issue_action_id == action.id, IssueActionEvidence.evidence_id == ev.id).first()
    if existing:
        if refuse_duplicate:
            raise HTTPException(status_code=409, detail="Evidence already linked")
        return existing
    link = IssueActionEvidence(issue_action_id=action.id, evidence_id=ev.id, tenant_id=action.issue.tenant_id,
                               linked_by=current_user.id, notes=notes)
    db.add(link)
    if action.evidence_id is None:
        action.evidence_id = ev.id
    return link


@router.get("/{action_id}/evidence", response_model=List[_MitigationEvidenceLinkResponse])
def list_mitigation_action_evidence(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    return _serialize(db, [_get_action_or_404(action_id, db, current_user)])[0].evidence


@router.post(
    "/{action_id}/evidence",
    response_model=_MitigationEvidenceLinkResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=CAN_EDIT,
)
def link_evidence_to_mitigation_action(
    action_id: int,
    data: _MitigationEvidenceLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    action = _get_action_or_404(action_id, db, current_user)
    link = _link_evidence(db, action, data.evidence_id, current_user, notes=data.notes)
    db.commit()
    db.refresh(link)
    return _serialize_evidence_link(link)


@router.delete("/{action_id}/evidence/{link_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=CAN_EDIT)
def unlink_evidence_from_mitigation_action(
    action_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    action = _get_action_or_404(action_id, db, current_user)
    link = db.query(IssueActionEvidence).filter(
        IssueActionEvidence.id == link_id, IssueActionEvidence.issue_action_id == action.id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Evidence link not found")
    db.delete(link)
    db.flush()
    if action.evidence_id == link.evidence_id:      # the first evidence went: the next one, if any, takes its place
        nxt = db.query(IssueActionEvidence.evidence_id).filter(
            IssueActionEvidence.issue_action_id == action.id).order_by(IssueActionEvidence.id).first()
        action.evidence_id = nxt[0] if nxt else None
    db.commit()
    return None
