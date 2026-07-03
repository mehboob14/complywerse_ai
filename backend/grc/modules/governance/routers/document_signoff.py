"""Production document Sign-off & Document Control flow.

A clean, self-contained approval system layered on the governance document:
  • per-document PARTICIPANTS: prepared_by / reviewer / approver, each targeting a
    user, a role, or a team (roles/teams expand to member users when routing);
  • SEND for review → reviewers sign → (auto) pending approval → approvers sign → approved;
  • each SIGN records a structured DocumentSignature AND stamps the signer's row in
    the document's Approval Signoff table (reusing the content patcher), versioned + audited;
  • a per-user PENDING queue that expands role/team membership so each assignee
    sees exactly the documents awaiting their signature.

Deliberately independent of the two legacy approval engines (DocumentApprovalStep
"approve-one-approves-all" and the template engine) which are over-broad / unwired.
"""
from typing import List, Optional, Dict, Set
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, GRCUser, get_db,
    DocumentSignoffAssignment, DocumentSignature,
)
from ....routers.auth_router import require_auth, get_user_tenants
from .documents import _patch_signoff_content, _snapshot_content_version, create_audit_log

router = APIRouter(prefix="/documents", tags=["Governance - Sign-off"])

_ROLE_TYPES = ("prepared_by", "reviewer", "approver")
_ROLE_LABEL = {"prepared_by": "Prepared by", "reviewer": "Reviewed by", "approver": "Approved by"}
# Which document.status corresponds to each stage awaiting signatures.
_STAGE_STATUS = {"reviewer": "pending_review", "approver": "pending_approval"}


# ── schemas ──────────────────────────────────────────────────────────────
class ParticipantIn(BaseModel):
    target_type: str   # user | role | team
    target_id: int


class ParticipantsUpdate(BaseModel):
    prepared_by: List[ParticipantIn] = []
    reviewers: List[ParticipantIn] = []
    approvers: List[ParticipantIn] = []


class SignRequest(BaseModel):
    comment: Optional[str] = None
    signature_text: Optional[str] = None   # typed name of record (defaults to display name)


class RejectRequest(BaseModel):
    comment: str


# ── helpers ──────────────────────────────────────────────────────────────
def _doc_or_404(document_id: int, user_tenants: List[int], db: Session) -> GovernanceDocument:
    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


def _resolve_target_users(db: Session, tenant_ids: List[int], target_type: str, target_id: int) -> Set[int]:
    """Expand a participant target to its distinct member user ids."""
    from ....models import UserRole
    if target_type == "user":
        return {int(target_id)}
    if target_type == "role":
        rows = db.query(UserRole.user_id).filter(
            UserRole.role_id == target_id, UserRole.tenant_id.in_(tenant_ids)
        ).all()
        return {r[0] for r in rows}
    if target_type == "team":
        try:
            from ....models import TeamMember, Team
        except Exception:
            return set()
        rows = db.query(TeamMember.user_id).filter(TeamMember.team_id == target_id).all()
        out = {r[0] for r in rows}
        team = db.query(Team).filter(Team.id == target_id).first()
        if team and getattr(team, "lead_user_id", None):
            out.add(team.lead_user_id)
        return out
    return set()


def _target_display(db: Session, target_type: str, target_id: int) -> str:
    if target_type == "user":
        u = db.query(GRCUser).filter(GRCUser.id == target_id).first()
        return (u.display_name or u.username) if u else f"User #{target_id}"
    if target_type == "role":
        from ....models import Role
        r = db.query(Role).filter(Role.id == target_id).first()
        return f"Role: {r.name}" if r else f"Role #{target_id}"
    if target_type == "team":
        try:
            from ....models import Team
            t = db.query(Team).filter(Team.id == target_id).first()
            return f"Team: {t.name}" if t else f"Team #{target_id}"
        except Exception:
            return f"Team #{target_id}"
    return f"{target_type} #{target_id}"


def _assignments(db: Session, document_id: int) -> List[DocumentSignoffAssignment]:
    return db.query(DocumentSignoffAssignment).filter(
        DocumentSignoffAssignment.document_id == document_id
    ).all()


def _signatures(db: Session, document_id: int) -> List[DocumentSignature]:
    return db.query(DocumentSignature).filter(
        DocumentSignature.document_id == document_id,
        DocumentSignature.decision == "signed",
    ).all()


def _stage_complete(db: Session, tenant_ids: List[int], document_id: int, role_type: str,
                    assignments: List[DocumentSignoffAssignment],
                    signatures: List[DocumentSignature]) -> bool:
    """A stage is complete when EVERY required assignment for that role has at least
    one signature from a member of its expanded user set. (Named users must each
    sign; a role/team is satisfied by any one member.)"""
    stage_assignments = [a for a in assignments if a.role_type == role_type]
    if not stage_assignments:
        return False
    signer_ids = {s.signer_user_id for s in signatures if s.role_type == role_type}
    for a in stage_assignments:
        members = _resolve_target_users(db, tenant_ids, a.target_type, a.target_id)
        if not (members & signer_ids):
            return False
    return True


def _user_actionable_role(db: Session, tenant_ids: List[int], doc: GovernanceDocument,
                          user_id: int, assignments: List[DocumentSignature]) -> Optional[str]:
    """The role_type the given user may sign RIGHT NOW for this doc, or None."""
    # Map current status → the stage awaiting signatures.
    stage = None
    if doc.status == "pending_review":
        stage = "reviewer"
    elif doc.status == "pending_approval":
        stage = "approver"
    if not stage:
        return None
    # Is the user a member of any assignment for that stage, and not yet signed?
    stage_assignments = [a for a in _assignments(db, doc.id) if a.role_type == stage]
    already = {s.signer_user_id for s in _signatures(db, doc.id) if s.role_type == stage}
    if user_id in already:
        return None
    for a in stage_assignments:
        if user_id in _resolve_target_users(db, tenant_ids, a.target_type, a.target_id):
            return stage
    return None


# ── endpoints ────────────────────────────────────────────────────────────
@router.get("/{document_id}/signoff")
def get_signoff(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    assignments = _assignments(db, document_id)
    signatures = _signatures(db, document_id)
    all_sigs = db.query(DocumentSignature).filter(
        DocumentSignature.document_id == document_id
    ).order_by(DocumentSignature.signed_at.asc()).all()

    def _part_out(a):
        return {
            "id": a.id, "role_type": a.role_type, "target_type": a.target_type,
            "target_id": a.target_id, "display": _target_display(db, a.target_type, a.target_id),
        }

    signer_names = {}
    for s in all_sigs:
        u = db.query(GRCUser).filter(GRCUser.id == s.signer_user_id).first()
        signer_names[s.signer_user_id] = (u.display_name or u.username) if u else f"User #{s.signer_user_id}"

    progress = {}
    for rt in ("reviewer", "approver"):
        stage_assignments = [a for a in assignments if a.role_type == rt]
        signed = 0
        for a in stage_assignments:
            members = _resolve_target_users(db, user_tenants, a.target_type, a.target_id)
            if members & {s.signer_user_id for s in signatures if s.role_type == rt}:
                signed += 1
        progress[rt] = {"required": len(stage_assignments), "signed": signed}

    actionable = _user_actionable_role(db, user_tenants, doc, current_user.id, signatures)

    return {
        "document_id": document_id,
        "status": doc.status,
        "participants": {
            rt: [_part_out(a) for a in assignments if a.role_type == rt] for rt in _ROLE_TYPES
        },
        "signatures": [
            {
                "id": s.id, "role_type": s.role_type, "role_label": s.role_label,
                "signer_user_id": s.signer_user_id, "signer_name": signer_names.get(s.signer_user_id),
                "decision": s.decision, "comment": s.comment,
                "signed_at": s.signed_at.isoformat() if s.signed_at else None,
            } for s in all_sigs
        ],
        "progress": progress,
        "my_actionable_role": actionable,   # 'reviewer' | 'approver' | null — can sign now
    }


@router.put("/{document_id}/signoff/participants")
def set_participants(
    document_id: int,
    body: ParticipantsUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Replace the document's sign-off participants. Prepared-by defaults to the
    document owner/author (the creator) when none supplied."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    if doc.status not in ("draft", "pending_review", "pending_approval"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Participants can only be edited before the document is approved.")

    db.query(DocumentSignoffAssignment).filter(
        DocumentSignoffAssignment.document_id == document_id
    ).delete()

    def _add(role_type, items):
        for it in items:
            if it.target_type not in ("user", "role", "team"):
                continue
            db.add(DocumentSignoffAssignment(
                tenant_id=doc.tenant_id, document_id=document_id, role_type=role_type,
                target_type=it.target_type, target_id=int(it.target_id),
                added_by=current_user.id, added_at=datetime.utcnow(),
            ))

    prepared = body.prepared_by or []
    if not prepared:
        default_uid = doc.owner_id or doc.author_id or current_user.id
        prepared = [ParticipantIn(target_type="user", target_id=default_uid)]
    _add("prepared_by", prepared)
    _add("reviewer", body.reviewers or [])
    _add("approver", body.approvers or [])
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/send-for-review")
def send_for_review(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Send the document to its reviewers (or straight to approvers if no reviewers
    are assigned). Routes it to each assignee's Pending Approvals queue."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    assignments = _assignments(db, document_id)
    has_reviewers = any(a.role_type == "reviewer" for a in assignments)
    has_approvers = any(a.role_type == "approver" for a in assignments)
    if not (has_reviewers or has_approvers):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Assign at least one reviewer or approver before sending.")
    new_status = "pending_review" if has_reviewers else "pending_approval"
    doc.status = new_status
    doc.updated_at = datetime.utcnow()
    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="sent_for_review" if has_reviewers else "sent_for_approval",
        action_details=f"Document sent for {'review' if has_reviewers else 'approval'}",
        field_changed="status", old_value="draft", new_value=new_status,
    )
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/sign")
def sign_document(
    document_id: int,
    body: SignRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Sign the document in the current user's actionable role. Records a
    DocumentSignature, stamps the signer's row in the Approval Signoff table, and
    advances the document status when the stage completes."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    signatures = _signatures(db, document_id)
    role_type = _user_actionable_role(db, user_tenants, doc, current_user.id, signatures)
    if not role_type:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not an assigned signer for this document at its current stage, or you have already signed.")

    role_label = _ROLE_LABEL[role_type]
    signer_name = body.signature_text or current_user.display_name or current_user.username

    # Stamp the signer's row in the Approval Signoff table (content patch).
    old_content = doc.content
    old_title = doc.title
    old_version = doc.current_version or "1.0"
    today = datetime.utcnow().strftime("%Y-%m-%d")
    new_content = _patch_signoff_content(
        old_content,
        [{"role": role_label, "name": signer_name, "designation": None, "date": f"{today} · Signed"}],
        {},
    )
    content_changed = new_content != (old_content or "")
    if content_changed:
        doc.content = new_content
        _snapshot_content_version(
            db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
            change_type="signoff", change_reason=f"{role_label}: {signer_name}", user_id=current_user.id,
        )

    db.add(DocumentSignature(
        tenant_id=doc.tenant_id, document_id=document_id, signer_user_id=current_user.id,
        role_type=role_type, role_label=role_label, decision="signed",
        signature_text=signer_name, comment=body.comment, signed_at=datetime.utcnow(),
    ))
    doc.updated_at = datetime.utcnow()

    # Recompute stage completion (include this new signature).
    all_assignments = _assignments(db, document_id)
    fresh_sigs = _signatures(db, document_id) + [type("S", (), {"role_type": role_type, "signer_user_id": current_user.id})()]
    advanced_to = None
    if role_type == "reviewer" and _stage_complete(db, user_tenants, document_id, "reviewer", all_assignments, fresh_sigs):
        # Reviews done → move to approval if approvers exist, else approved.
        if any(a.role_type == "approver" for a in all_assignments):
            doc.status = "pending_approval"
            advanced_to = "pending_approval"
        else:
            doc.status = "approved"
            doc.approved_by = current_user.id
            doc.approved_at = datetime.utcnow()
            advanced_to = "approved"
    elif role_type == "approver" and _stage_complete(db, user_tenants, document_id, "approver", all_assignments, fresh_sigs):
        doc.status = "approved"
        doc.approved_by = current_user.id
        doc.approved_at = datetime.utcnow()
        advanced_to = "approved"

    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="signed", field_changed="signoff",
        old_value=None, new_value=f"{role_label}: {signer_name}",
        action_details=(body.comment or f"Signed as {role_label}") + (f" → {advanced_to}" if advanced_to else ""),
    )
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/reject")
def reject_document(
    document_id: int,
    body: RejectRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Reject at the current stage — returns the document to draft and records the
    rejection. Only an assigned reviewer/approver at the current stage may reject."""
    if not (body.comment or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A reason is required to reject.")
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    signatures = _signatures(db, document_id)
    role_type = _user_actionable_role(db, user_tenants, doc, current_user.id, signatures)
    if not role_type:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not an assigned signer at this stage.")
    role_label = _ROLE_LABEL[role_type]
    db.add(DocumentSignature(
        tenant_id=doc.tenant_id, document_id=document_id, signer_user_id=current_user.id,
        role_type=role_type, role_label=role_label, decision="rejected",
        signature_text=current_user.display_name or current_user.username,
        comment=body.comment, signed_at=datetime.utcnow(),
    ))
    doc.status = "draft"
    doc.updated_at = datetime.utcnow()
    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="rejected", field_changed="status", old_value=None, new_value="draft",
        action_details=f"Rejected at {role_label}: {body.comment}",
    )
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.get("/signoff/my-pending")
def my_pending_signoffs(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Documents awaiting the current user's signature — expands role/team
    membership so a user assigned via a role or team still sees the document."""
    user_tenants = get_user_tenants(current_user, db)
    # Candidate docs: in a pending stage, in the user's tenant(s).
    docs = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.status.in_(("pending_review", "pending_approval")),
    ).all()
    out = []
    for doc in docs:
        role = _user_actionable_role(db, user_tenants, doc, current_user.id, _signatures(db, doc.id))
        if not role:
            continue
        out.append({
            "document_id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "status": doc.status,
            "stage_role": role,                # reviewer | approver
            "stage_label": _ROLE_LABEL[role],
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        })
    return {"total": len(out), "items": out}
