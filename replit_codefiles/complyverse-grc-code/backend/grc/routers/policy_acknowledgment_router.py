import os
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..models import PolicyAttestation, GovernanceDocument, GRCUser, TenantUser, get_db
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/policy-acknowledgments", tags=["Policy Acknowledgments"])


@router.get("/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.doc_type.in_(["policy", "standard", "procedure"])
    ).all()

    now = datetime.utcnow()
    result = []
    for doc in documents:
        attestations = db.query(PolicyAttestation).filter(
            PolicyAttestation.document_id == doc.id,
            PolicyAttestation.tenant_id.in_(user_tenants)
        ).all()

        total_required = len(attestations)
        completed_count = sum(1 for a in attestations if a.status == "completed")
        overdue_count = sum(1 for a in attestations if a.status == "pending" and a.due_date and a.due_date < now)
        pending_count = total_required - completed_count

        result.append({
            "policy_id": doc.id,
            "policy_name": doc.title,
            "total_required": total_required,
            "completed_count": completed_count,
            "pending_count": pending_count,
            "overdue_count": overdue_count,
            "completion_percentage": round((completed_count / total_required * 100), 1) if total_required > 0 else 0
        })

    return result


@router.get("/policy/{document_id}/users")
def get_policy_users(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.document_id == document_id,
        PolicyAttestation.tenant_id.in_(user_tenants)
    ).all()

    now = datetime.utcnow()
    users_list = []
    for att in attestations:
        user = db.query(GRCUser).filter(GRCUser.id == att.user_id).first()
        if not user:
            continue

        if att.status == "completed":
            user_status = "acknowledged"
        elif att.due_date and att.due_date < now:
            user_status = "overdue"
        else:
            user_status = "pending"

        users_list.append({
            "user_id": user.id,
            "user_name": user.display_name or user.username,
            "email": user.email,
            "status": user_status,
            "due_date": att.due_date.isoformat() if att.due_date else None,
            "completed_at": att.completed_at.isoformat() if att.completed_at else None,
            "attestation_id": att.id
        })

    return users_list


@router.post("/policy/{document_id}/send-reminders")
def send_reminders(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    pending_attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.document_id == document_id,
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "pending"
    ).all()

    if not pending_attestations:
        return {"message": "No pending acknowledgments to remind", "reminders_sent": 0}

    import resend
    resend.api_key = os.environ.get("RESEND_API_KEY")

    sent_count = 0
    errors = []
    for att in pending_attestations:
        user = db.query(GRCUser).filter(GRCUser.id == att.user_id).first()
        if not user or not user.email:
            continue

        try:
            if resend.api_key:
                resend.Emails.send({
                    "from": "ComplyVerse <noreply@complyverse.com>",
                    "to": [user.email],
                    "subject": f"Reminder: Policy Acknowledgment Required - {doc.title}",
                    "html": f"<p>Dear {user.display_name or user.username},</p>"
                            f"<p>This is a reminder that you need to acknowledge the policy: <strong>{doc.title}</strong>.</p>"
                            f"<p>Please log in to the ComplyVerse platform to complete your acknowledgment.</p>"
                            f"{'<p>Due date: ' + att.due_date.strftime('%Y-%m-%d') + '</p>' if att.due_date else ''}"
                            f"<p>Thank you.</p>"
                })
            sent_count += 1
        except Exception as e:
            errors.append({"user_id": user.id, "error": str(e)})

    return {
        "message": f"Reminders sent to {sent_count} users",
        "reminders_sent": sent_count,
        "errors": errors if errors else None
    }


@router.get("/user/{user_id}/status")
def get_user_status(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.user_id == user_id,
        PolicyAttestation.tenant_id.in_(user_tenants)
    ).all()

    now = datetime.utcnow()
    result = []
    for att in attestations:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == att.document_id).first()

        if att.status == "completed":
            att_status = "acknowledged"
        elif att.due_date and att.due_date < now:
            att_status = "overdue"
        else:
            att_status = "pending"

        result.append({
            "attestation_id": att.id,
            "document_id": att.document_id,
            "document_title": doc.title if doc else None,
            "status": att_status,
            "due_date": att.due_date.isoformat() if att.due_date else None,
            "completed_at": att.completed_at.isoformat() if att.completed_at else None,
            "attestation_type": att.attestation_type
        })

    return result


@router.get("/overdue")
def get_overdue(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    now = datetime.utcnow()
    overdue = db.query(PolicyAttestation).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "pending",
        PolicyAttestation.due_date < now
    ).all()

    result = []
    for att in overdue:
        user = db.query(GRCUser).filter(GRCUser.id == att.user_id).first()
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == att.document_id).first()

        result.append({
            "attestation_id": att.id,
            "document_id": att.document_id,
            "document_title": doc.title if doc else None,
            "user_id": att.user_id,
            "user_name": (user.display_name or user.username) if user else None,
            "email": user.email if user else None,
            "due_date": att.due_date.isoformat() if att.due_date else None,
            "days_overdue": (now - att.due_date).days if att.due_date else None
        })

    return result
