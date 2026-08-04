"""Comments + activity feed on an Issue."""
from datetime import datetime
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import Issue, IssueComment, IssueActivity, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

router = APIRouter(prefix="/issues", tags=["Issue Management - Comments & Activity"])

_require_view = require_tenant_permission("issue_management:issues:view")
_require_edit = require_tenant_permission("issue_management:issues:edit")


def _get_issue(issue_id: int, current_user: GRCUser, db: Session) -> Issue:
    user_tenants = get_user_tenants(current_user, db)
    issue = db.query(Issue).filter(
        Issue.id == issue_id,
        Issue.tenant_id.in_(user_tenants),
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


# ── Comments ────────────────────────────────────────────────────────────
@router.get("/{issue_id}/comments", dependencies=[Depends(_require_view)])
def list_comments(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueComment).options(joinedload(IssueComment.user)).filter(
        IssueComment.issue_id == issue_id
    ).order_by(IssueComment.created_at.asc()).all()
    return [{
        "id": c.id,
        "parent_id": c.parent_id,
        "user": {
            "id": c.user.id if c.user else None,
            "display_name": getattr(c.user, "display_name", None) or getattr(c.user, "username", None) if c.user else None,
        },
        "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "edited_at": c.edited_at.isoformat() if c.edited_at else None,
    } for c in rows]


@router.post("/{issue_id}/comments", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_comment(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue = _get_issue(issue_id, current_user, db)
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="body is required")
    comment = IssueComment(
        issue_id=issue.id, user_id=current_user.id,
        body=text, parent_id=body.get("parent_id"),
    )
    db.add(comment)
    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="commented",
        payload={"comment_preview": text[:120]},
    ))
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "parent_id": comment.parent_id,
        "body": comment.body,
        "created_at": comment.created_at.isoformat(),
    }


# ── Activity feed ───────────────────────────────────────────────────────
@router.get("/{issue_id}/activity", dependencies=[Depends(_require_view)])
def list_activity(
    issue_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueActivity).options(joinedload(IssueActivity.user)).filter(
        IssueActivity.issue_id == issue_id
    ).order_by(IssueActivity.created_at.desc()).limit(limit).all()
    return [{
        "id": a.id,
        "type": a.type,
        "user": {
            "id": a.user.id if a.user else None,
            "display_name": getattr(a.user, "display_name", None) or getattr(a.user, "username", None) if a.user else None,
        },
        "payload": a.payload,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in rows]
