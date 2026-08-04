"""HITL approval endpoints for AI-drafted policy patches (Task #46 steps 6-7).

Workflow:
- ``GET  /governance/patch-proposals`` — inbox (filter by status, document)
- ``GET  /governance/patch-proposals/{id}`` — single proposal
- ``POST /governance/patch-proposals/{id}/decision`` — approve / reject / edit
- ``POST /governance/patch-proposals/{id}/critical-decision`` — Allow/Deny gate
- ``POST /governance/patch-proposals/{id}/send-email`` — issue email approval link

Each decision advances the multi-step approver chain (``current_step`` ->
``current_step + 1``); when the last step approves, the patch is applied to the
governance document content (best-effort append + version bump).
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    GovernanceDocument,
    GovernanceDocumentVersion,
    PolicyGapFinding,
    PolicyPatchProposal,
    Role,
    UserRole,
    get_db,
)
from ....rich_audit import write_rich_audit_log
from ....routers.auth_router import (
    get_user_primary_tenant,
    get_user_tenants,
    require_auth,
)
from ..services.approval_tokens import issue_token
from ..services.critical_rules import default_approver_chain

import logging as _logging

_logger = _logging.getLogger(__name__)


def _require_approval_permission(db: Session, user: GRCUser, tenant_id: int) -> None:
    """Enforce governance:approvals:approve permission. Raises 403 on denial.

    Checks whether the user holds a role in the given tenant that has the
    ``governance:approvals:approve`` permission attached via
    ``RolePermission → Permission``.  Falls back to checking any role at all
    only when the permission row hasn't been seeded yet (graceful migration).
    """
    from ....models import Permission, RolePermission

    perm_row = db.query(Permission).filter(Permission.name == "governance:approvals:approve").first()
    if perm_row:
        has_perm = (
            db.query(RolePermission)
            .join(UserRole, UserRole.role_id == RolePermission.role_id)
            .filter(
                UserRole.user_id == user.id,
                UserRole.tenant_id == tenant_id,
                RolePermission.permission_id == perm_row.id,
            )
            .first()
        )
        if not has_perm:
            raise HTTPException(
                status_code=403,
                detail="Permission denied: governance:approvals:approve",
            )
        return

    has_any_role = (
        db.query(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.user_id == user.id,
            UserRole.tenant_id == tenant_id,
        )
        .first()
    )
    if not has_any_role:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: governance:approvals:approve",
        )


router = APIRouter(prefix="/patch-proposals", tags=["Policy AI Patch Proposals"])


# ─── Schemas ────────────────────────────────────────────────────────────────


class ProposalOut(BaseModel):
    id: int
    tenant_id: int
    document_id: int
    finding_id: Optional[int]
    clause_reference: Optional[str]
    clause_title: Optional[str]
    draft_text: str
    edited_text: Optional[str]
    rationale: Optional[str]
    status: str
    approver_chain: list
    current_step: int
    approval_history: list
    is_blocked_by_critical: bool
    drafted_by_user_id: Optional[int]
    decided_by: Optional[int]
    decided_at: Optional[datetime]
    decision_comment: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DecisionRequest(BaseModel):
    decision: str  # approve | reject | edit
    comment: Optional[str] = None
    edited_text: Optional[str] = None  # required when decision == "edit"


class CriticalDecisionRequest(BaseModel):
    decision: str  # allow | deny
    justification: str


class SendEmailRequest(BaseModel):
    approver_user_id: int


# ─── Helpers ────────────────────────────────────────────────────────────────


def _ensure_proposal(
    db: Session, proposal_id: int, current_user: GRCUser
) -> PolicyPatchProposal:
    user_tenants = get_user_tenants(current_user, db)
    p = (
        db.query(PolicyPatchProposal)
        .filter(
            PolicyPatchProposal.id == proposal_id,
            PolicyPatchProposal.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return p


def _user_has_role(db: Session, user: GRCUser, tenant_id: int, role_name: str) -> bool:
    """Strict check: does this user hold the named role in tenant?

    Fails closed — returns False when the role is not found so a missing
    role assignment cannot silently bypass the approver gate.
    """
    if not role_name:
        return True
    return bool(
        db.query(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.user_id == user.id,
            UserRole.tenant_id == tenant_id,
            Role.name == role_name,
        )
        .first()
    )


def _authorize_current_step(
    db: Session, p: PolicyPatchProposal, current_user: GRCUser
) -> None:
    """Raise 403 unless current_user matches the active approver chain step.

    Step entry shapes accepted: ``{"step": N, "user_id": X}`` or
    ``{"step": N, "role": "Approver"}``. Missing chain ⇒ permissive (single
    approver = caller, already permission-gated by `require_auth`).
    """
    chain = list(p.approver_chain or [])
    if not chain:
        return
    step = next((s for s in chain if int(s.get("step", 0)) == int(p.current_step)), None)
    if not step:
        # Fail closed: a non-empty chain whose current_step has no matching
        # entry is a misconfigured workflow; do NOT silently permit decisions.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Approver chain has no step #{p.current_step}; resolve the "
                "workflow configuration before deciding."
            ),
        )
    target_user_id = step.get("user_id")
    if target_user_id is not None and int(target_user_id) != int(current_user.id):
        raise HTTPException(
            status_code=403,
            detail=f"Only the assigned approver (user #{target_user_id}) may act on step {p.current_step}",
        )
    role_name = step.get("role")
    if role_name and target_user_id is None:
        if not _user_has_role(db, current_user, p.tenant_id, role_name):
            raise HTTPException(
                status_code=403,
                detail=f"Approver role '{role_name}' required for step {p.current_step}",
            )


def _apply_to_document(db: Session, proposal: PolicyPatchProposal) -> None:
    """When all approval steps are complete, append the patch and bump version."""
    doc = (
        db.query(GovernanceDocument)
        .filter(GovernanceDocument.id == proposal.document_id)
        .first()
    )
    if not doc:
        return
    text_to_append = (proposal.edited_text or proposal.draft_text or "").strip()
    if not text_to_append:
        return
    header = f"\n\n[Auto-merged patch — clause {proposal.clause_reference or ''}]\n"
    new_content = (doc.content or "") + header + text_to_append

    old_version = doc.current_version or "1.0"
    parts = old_version.split(".")
    if len(parts) == 2:
        major, minor = int(parts[0]), int(parts[1])
        new_version = f"{major}.{minor + 1}"
    elif len(parts) == 3:
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
        new_version = f"{major}.{minor + 1}.0"
    else:
        new_version = "1.1"

    db.query(GovernanceDocumentVersion).filter(
        GovernanceDocumentVersion.document_id == doc.id,
        GovernanceDocumentVersion.status == "current",
    ).update({"status": "superseded"})

    version_row = GovernanceDocumentVersion(
        document_id=doc.id,
        version_number=new_version,
        change_type="minor",
        title=doc.title,
        content=new_content,
        change_summary=f"Auto-merged patch for clause {proposal.clause_reference or 'N/A'}",
        change_reason=f"Approved policy patch proposal #{proposal.id}",
        status="current",
        created_by=proposal.decided_by,
        created_at=datetime.utcnow(),
    )
    db.add(version_row)

    doc.content = new_content
    doc.current_version = new_version
    doc.updated_at = datetime.utcnow()
    db.add(doc)
    _logger.info(
        "policy_patch.version_bump doc=%s old=%s new=%s proposal=%s",
        doc.id, old_version, new_version, proposal.id,
    )


# ─── Endpoints ──────────────────────────────────────────────────────────────


@router.get("", response_model=List[ProposalOut])
def list_proposals(
    document_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    q = db.query(PolicyPatchProposal).filter(PolicyPatchProposal.tenant_id.in_(user_tenants))
    if document_id is not None:
        q = q.filter(PolicyPatchProposal.document_id == document_id)
    if status:
        q = q.filter(PolicyPatchProposal.status == status)
    return q.order_by(PolicyPatchProposal.created_at.desc()).all()


@router.get("/{proposal_id}", response_model=ProposalOut)
def get_proposal(
    proposal_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    return _ensure_proposal(db, proposal_id, current_user)


@router.post("/{proposal_id}/decision", response_model=ProposalOut)
def decide_proposal(
    proposal_id: int,
    body: DecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if body.decision not in ("approve", "reject", "edit"):
        raise HTTPException(status_code=400, detail="Invalid decision")
    p = _ensure_proposal(db, proposal_id, current_user)
    _require_approval_permission(db, current_user, p.tenant_id)
    if p.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Proposal is {p.status}, not pending")
    if p.is_blocked_by_critical:
        raise HTTPException(
            status_code=400,
            detail="Patch is blocked by an unresolved critical exception (Allow/Deny first)",
        )
    _authorize_current_step(db, p, current_user)

    history = list(p.approval_history or [])
    decision_norm = "approve" if body.decision == "edit" else body.decision
    history.append(
        {
            "step": p.current_step,
            "decision": decision_norm,
            "by": current_user.id,
            "by_username": current_user.username,
            "at": datetime.utcnow().isoformat(),
            "comment": body.comment,
            "edited": body.decision == "edit",
        }
    )
    p.approval_history = history
    p.decided_by = current_user.id
    p.decided_at = datetime.utcnow()
    p.decision_comment = body.comment

    if body.decision == "edit":
        if not body.edited_text:
            raise HTTPException(status_code=400, detail="edited_text required for 'edit' decision")
        p.edited_text = body.edited_text

    if decision_norm == "reject":
        p.status = "rejected"
    else:
        chain_len = len(p.approver_chain or [])
        if p.current_step >= chain_len:
            p.status = "approved"
            _apply_to_document(db, p)
        else:
            p.current_step += 1
            # Stays pending_approval, awaiting next step.

    write_rich_audit_log(
        db,
        tenant_id=p.tenant_id,
        user_id=current_user.id,
        action=f"policy_patch.{decision_norm}",
        resource_type="policy_patch_proposal",
        resource_id=p.id,
        resource_name=f"clause {p.clause_reference}",
        summary=(
            f"Step {p.current_step - (1 if p.status == 'pending_approval' else 0)}: "
            f"{decision_norm}"
            + (" (edited)" if body.decision == "edit" else "")
        ),
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(p)
    return p


@router.post("/{proposal_id}/critical-decision", response_model=ProposalOut)
def critical_decision(
    proposal_id: int,
    body: CriticalDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if body.decision not in ("allow", "deny"):
        raise HTTPException(status_code=400, detail="Invalid critical decision")
    if not body.justification or len(body.justification.strip()) < 5:
        raise HTTPException(status_code=400, detail="Justification required (>=5 chars)")
    p = _ensure_proposal(db, proposal_id, current_user)
    _require_approval_permission(db, current_user, p.tenant_id)
    if not p.is_blocked_by_critical:
        raise HTTPException(status_code=400, detail="Proposal is not blocked by a critical rule")
    _authorize_current_step(db, p, current_user)

    finding = (
        db.query(PolicyGapFinding).filter(PolicyGapFinding.id == p.finding_id).first()
        if p.finding_id
        else None
    )
    if finding:
        finding.critical_decision = body.decision
        finding.critical_decision_by = current_user.id
        finding.critical_decision_at = datetime.utcnow()
        finding.critical_justification = body.justification
        db.add(finding)

    if body.decision == "allow":
        p.is_blocked_by_critical = False
    else:
        p.status = "rejected"

    write_rich_audit_log(
        db,
        tenant_id=p.tenant_id,
        user_id=current_user.id,
        action=f"policy_patch.critical_{body.decision}",
        resource_type="policy_patch_proposal",
        resource_id=p.id,
        resource_name=f"clause {p.clause_reference}",
        summary=f"Critical exception: {body.decision} — {body.justification[:120]}",
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(p)
    return p


@router.post("/{proposal_id}/send-email")
def send_email_link(
    proposal_id: int,
    body: SendEmailRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    p = _ensure_proposal(db, proposal_id, current_user)
    _require_approval_permission(db, current_user, p.tenant_id)
    approver = db.query(GRCUser).filter(GRCUser.id == body.approver_user_id).first()
    if not approver or not approver.email:
        raise HTTPException(status_code=404, detail="Approver has no email on file")
    # Tenant-isolation: do not leak draft policy text to users outside the
    # proposal's tenant.
    approver_tenants = get_user_tenants(approver, db)
    if p.tenant_id not in approver_tenants:
        raise HTTPException(
            status_code=403,
            detail="Approver does not belong to this tenant",
        )
    # Step-isolation: only emit a link to the approver authorised for the
    # current chain step (exact user match or holder of the required role).
    chain = list(p.approver_chain or [])
    if chain:
        step = next(
            (s for s in chain if int(s.get("step", 0)) == int(p.current_step)),
            None,
        )
        if step is None:
            raise HTTPException(
                status_code=400,
                detail=f"Approver chain has no step #{p.current_step}",
            )
        target_user_id = step.get("user_id")
        role_name = step.get("role")
        if target_user_id is not None and int(target_user_id) != int(approver.id):
            raise HTTPException(
                status_code=403,
                detail=f"Step {step.get('step')} is assigned to user #{target_user_id}",
            )
        if role_name and target_user_id is None and not _user_has_role(
            db, approver, p.tenant_id, role_name
        ):
            raise HTTPException(
                status_code=403,
                detail=f"Recipient does not hold required role '{role_name}'",
            )

    plaintext, _row = issue_token(db, p.tenant_id, p.id, approver.id)

    base_url = os.environ.get("PUBLIC_BASE_URL") or os.environ.get("REPLIT_DEV_DOMAIN") or ""
    if base_url and not base_url.startswith("http"):
        base_url = f"https://{base_url}"
    approve_url = f"{base_url}/grc/governance/email-approvals/decide?token={plaintext}&decision=approve"
    reject_url = f"{base_url}/grc/governance/email-approvals/decide?token={plaintext}&decision=reject"

    body_html = (
        f"<p>You have been requested to review an AI-drafted policy patch for "
        f"clause <b>{p.clause_reference or ''}</b>.</p>"
        f"<p><b>Draft:</b></p><blockquote>{(p.draft_text or '').replace(chr(10), '<br/>')}</blockquote>"
        f"<p style='margin-top:18px'>"
        f"<a href='{approve_url}' style='display:inline-block;padding:10px 14px;"
        f"background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;margin-right:8px'>Approve</a>"
        f"<a href='{reject_url}' style='display:inline-block;padding:10px 14px;"
        f"background:#dc2626;color:#fff;text-decoration:none;border-radius:6px'>Reject</a>"
        f"</p><p style='color:#666;font-size:12px'>Link is single-use and expires in 7 days.</p>"
    )

    sent = False
    try:
        from ...workflow_engine.services.email_service import send_email

        sent = send_email(
            db=db,
            tenant_id=p.tenant_id,
            to=approver.email,
            subject=f"[Policy Approval] Patch for clause {p.clause_reference}",
            body_html=body_html,
        )
    except Exception:  # pragma: no cover
        sent = False

    write_rich_audit_log(
        db,
        tenant_id=p.tenant_id,
        user_id=current_user.id,
        action="policy_patch.email_sent",
        resource_type="policy_patch_proposal",
        resource_id=p.id,
        resource_name=f"clause {p.clause_reference}",
        summary=f"Issued approval email to {approver.email} (sent={sent})",
    )
    db.commit()
    return {"sent": bool(sent), "approver_email": approver.email}
