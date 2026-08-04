"""Public token-based approval endpoint (no session auth required) — Task #46.

The email-link approver clicks Approve/Reject in their inbox; that link hits
``/governance/email-approvals/decide?token=...&decision=...`` which:
  1. verifies + consumes the HMAC-signed single-use token
  2. records the decision against the proposal as if the approver had clicked
     the inline UI button (advancing the chain step, applying patch, audit log)
  3. returns a tiny HTML confirmation page
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ....models import (
    GovernanceDocument,
    GRCUser,
    PolicyPatchProposal,
    get_db,
)
from ....rich_audit import write_rich_audit_log
from ..services.approval_tokens import verify_and_consume


router = APIRouter(prefix="/email-approvals", tags=["Policy AI Email Approvals"])


def _page(title: str, body: str, accent: str = "#1f4b99") -> HTMLResponse:
    html = (
        "<html><head><meta charset='utf-8'>"
        f"<title>{title}</title>"
        "<style>body{font-family:Arial,Helvetica,sans-serif;background:#f5f6f8;"
        "padding:48px;color:#222}.card{background:#fff;border-radius:8px;"
        "padding:32px;max-width:560px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,0.06)}"
        f"h2{{color:{accent};margin-top:0}}</style></head>"
        f"<body><div class='card'><h2>{title}</h2>{body}</div></body></html>"
    )
    return HTMLResponse(content=html)


@router.get("/decide", response_class=HTMLResponse)
def decide_via_token(
    request: Request,
    token: str = Query(..., min_length=10),
    decision: str = Query(..., regex="^(approve|reject)$"),
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else None
    row = verify_and_consume(db, token, decision, ip_address=ip)
    if not row:
        return _page(
            "Approval link invalid",
            "<p>This approval link is invalid, has already been used, or has expired. "
            "Please ask the policy owner to send a fresh link.</p>",
            accent="#dc2626",
        )

    proposal = (
        db.query(PolicyPatchProposal)
        .filter(PolicyPatchProposal.id == row.proposal_id)
        .first()
    )
    if not proposal:
        return _page("Proposal not found", "<p>This proposal no longer exists.</p>", accent="#dc2626")
    if proposal.status != "pending_approval":
        return _page(
            "Already decided",
            f"<p>This proposal is already <b>{proposal.status}</b>.</p>",
        )
    if proposal.is_blocked_by_critical:
        return _page(
            "Blocked by critical exception",
            "<p>This patch is blocked pending an Allow/Deny decision on a critical rule. "
            "Open the policy in the app to resolve.</p>",
            accent="#dc2626",
        )

    # Enforce approver-step authorization: token must be for the user/role
    # assigned to the current chain step. Both user_id and role variants are
    # validated to prevent token-based authz bypass on role-based chains.
    approver = db.query(GRCUser).filter(GRCUser.id == row.approver_user_id).first()
    chain = list(proposal.approver_chain or [])
    if chain:
        step = next(
            (s for s in chain if int(s.get("step", 0)) == int(proposal.current_step)),
            None,
        )
        if step is None:
            return _page(
                "Workflow misconfigured",
                f"<p>The approver chain has no step #{proposal.current_step}. "
                "Please contact the policy owner.</p>",
                accent="#dc2626",
            )
        target_user_id = step.get("user_id")
        if target_user_id is not None and int(target_user_id) != int(row.approver_user_id):
            return _page(
                "Not your turn",
                f"<p>This approval link is for step {step.get('step')} but the proposal is currently "
                f"awaiting a different approver. Please coordinate with the policy owner.</p>",
                accent="#dc2626",
            )
        role_name = step.get("role")
        if role_name and target_user_id is None and approver is not None:
            from .patch_proposals import _user_has_role  # local import to avoid cycle

            if not _user_has_role(db, approver, proposal.tenant_id, role_name):
                return _page(
                    "Insufficient role",
                    f"<p>Step {step.get('step')} requires the role <b>{role_name}</b>, "
                    "which the link recipient does not hold.</p>",
                    accent="#dc2626",
                )
    history = list(proposal.approval_history or [])
    history.append(
        {
            "step": proposal.current_step,
            "decision": decision,
            "by": row.approver_user_id,
            "by_username": (approver.username if approver else None),
            "at": datetime.utcnow().isoformat(),
            "comment": "(email link)",
            "via": "email",
        }
    )
    proposal.approval_history = history
    proposal.decided_by = row.approver_user_id
    proposal.decided_at = datetime.utcnow()

    if decision == "reject":
        proposal.status = "rejected"
    else:
        chain_len = len(proposal.approver_chain or [])
        if proposal.current_step >= chain_len:
            proposal.status = "approved"
            from .patch_proposals import _apply_to_document
            _apply_to_document(db, proposal)
        else:
            proposal.current_step += 1

    db.add(proposal)
    write_rich_audit_log(
        db,
        tenant_id=proposal.tenant_id,
        user_id=row.approver_user_id,
        action=f"policy_patch.{decision}",
        resource_type="policy_patch_proposal",
        resource_id=proposal.id,
        resource_name=f"clause {proposal.clause_reference}",
        summary=f"{decision} via email link (token_id={row.id})",
        ip_address=ip,
        snapshot={"approval_email_token_id": row.id, "via": "email_link"},
    )
    db.commit()

    accent = "#16a34a" if decision == "approve" else "#dc2626"
    return _page(
        f"Decision recorded: {decision}",
        f"<p>Thank you — your <b>{decision}</b> has been recorded for clause "
        f"<b>{proposal.clause_reference or ''}</b>.</p>"
        f"<p>You may close this page.</p>",
        accent=accent,
    )
