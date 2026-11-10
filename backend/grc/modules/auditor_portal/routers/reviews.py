"""Auditor portal — review/approve/reject/remarks across artifacts.

A single POST endpoint routes the auditor's decision to the appropriate
existing approval workflow on each artifact type. This deliberately
*reuses* the existing approval fields on each model rather than adding a
parallel "auditor_review" layer — the auditor's verdict is the same
verdict any reviewer would record, so it must land on the same column.

Supported artifact types:
- evidence              → ImplementationEvidence.review_status
- applicability         → ClauseApplicability.status
- policy_exception      → PolicyException.status (+ approved/rejected fields)
- exception             → Exception.status

Each call also writes an AuditLog row so the audit trail shows who did
what and when.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from ....models import (
    GRCUser,
    get_db,
    AuditLog,
    ControlImplementation,
    ImplementationEvidence,
    ClauseApplicability,
    ParsedFrameworkControl,
    PolicyException,
    Exception as ComplianceException,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context


router = APIRouter()


ArtifactType = Literal["evidence", "applicability", "policy_exception", "exception"]
ReviewAction = Literal["approved", "rejected", "pending"]


class ReviewBody(BaseModel):
    artifact_type: ArtifactType
    artifact_id: int = Field(..., gt=0)
    action: ReviewAction
    remarks: Optional[str] = Field(None, max_length=4000)


def _write_audit(
    db: Session,
    user: GRCUser,
    tenant_id: int,
    artifact_type: str,
    artifact_id: int,
    action: str,
    remarks: Optional[str],
) -> None:
    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user.id,
        action=f"auditor_review.{action}",
        resource_type=artifact_type,
        resource_id=artifact_id,
        changes={"remarks": (remarks or "")[:1000]},
    )
    db.add(log)


@router.post("/reviews")
def submit_review(
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Apply an auditor decision to the artifact. Idempotent: re-posting
    the same action with new remarks updates the existing record (this
    is how an auditor amends remarks without resetting the workflow)."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access.")

    now = datetime.utcnow()

    if body.artifact_type == "evidence":
        row = db.query(ImplementationEvidence).join(
            ImplementationEvidence.implementation
        ).filter(ImplementationEvidence.id == body.artifact_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        # Tenant guard via parent implementation's journey tenant
        tenant_id = getattr(row.implementation, "tenant_id", None) if row.implementation else None
        if tenant_id is None or tenant_id not in user_tenants:
            # Fall back: many ImplementationEvidence rows inherit tenant
            # from the parent journey; check via the chain explicitly.
            from ....models import ControlImplementation, CertificationJourney
            impl = db.query(ControlImplementation).filter(
                ControlImplementation.id == row.implementation_id
            ).first()
            journey = db.query(CertificationJourney).filter(
                CertificationJourney.id == (impl.journey_id if impl else 0),
                CertificationJourney.tenant_id.in_(user_tenants),
            ).first() if impl else None
            if not journey:
                raise HTTPException(status_code=403, detail="Access denied to this evidence.")
            tenant_id = journey.tenant_id

        row.review_status = body.action
        row.review_notes = body.remarks
        row.reviewed_by = current_user.id
        row.reviewed_at = now
        _write_audit(db, current_user, tenant_id, "implementation_evidence", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "evidence",
            "artifact_id": row.id,
            "status": row.review_status,
            "reviewed_at": row.reviewed_at,
            "reviewed_by": current_user.id,
            "remarks": row.review_notes,
        }

    if body.artifact_type == "applicability":
        row = db.query(ClauseApplicability).filter(
            ClauseApplicability.id == body.artifact_id,
            ClauseApplicability.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Applicability record not found.")
        row.status = body.action
        row.review_comment = body.remarks
        row.reviewed_by = current_user.id
        row.reviewed_at = now
        _write_audit(db, current_user, row.tenant_id, "clause_applicability", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "applicability",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": row.reviewed_at,
            "reviewed_by": current_user.id,
            "remarks": row.review_comment,
        }

    if body.artifact_type == "policy_exception":
        row = db.query(PolicyException).filter(
            PolicyException.id == body.artifact_id,
            PolicyException.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Policy exception not found.")
        row.status = body.action
        if body.action == "approved":
            row.approved_by = current_user.id
            row.approved_at = now
            row.rejected_by = None
            row.rejected_at = None
            row.rejection_reason = None
        elif body.action == "rejected":
            row.rejected_by = current_user.id
            row.rejected_at = now
            row.rejection_reason = body.remarks
        _write_audit(db, current_user, row.tenant_id, "policy_exception", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "policy_exception",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": now,
            "reviewed_by": current_user.id,
            "remarks": body.remarks,
        }

    if body.artifact_type == "exception":
        row = db.query(ComplianceException).filter(
            ComplianceException.id == body.artifact_id,
            ComplianceException.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Exception not found.")
        row.status = body.action
        if body.action == "approved":
            row.approved_by = current_user.id
            row.approval_date = now
        _write_audit(db, current_user, row.tenant_id, "exception", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "exception",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": now,
            "reviewed_by": current_user.id,
            "remarks": body.remarks,
        }

    raise HTTPException(status_code=400, detail=f"Unsupported artifact_type {body.artifact_type!r}.")


# ─── The review queue ────────────────────────────────────────────────
# What the Auditor Portal's journey page reads (GET only, writes nothing): the files sent for review, the requests to put a requirement in or out of
# scope, the requirements nobody has asked about, and what was already decided, each as a page of rows with a true total. The payload carries what a
# person needs to decide (names, not ids of people; the requirement's text; the library id the file previews by) and nothing the server keeps for itself
# (no file path on disk, no e-mail address). Deciding goes through the routes that always decided: POST /certifications/evidence/{id}/review for a file
# and PUT /governance/applicability/{id}/review for a scope request.

QUEUE_KINDS = ("files", "scope", "untouched", "decided")
_WORDS = ("pending", "approved", "rejected")


def _person(user: Optional[GRCUser]) -> Optional[str]:
    """The name a person is known by: never the e-mail address."""
    if user is None:
        return None
    return getattr(user, "display_name", None) or getattr(user, "username", None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _control_view(control: Any, implementation_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """The requirement a row is about: what it is called, its text (cut), whether it is critical, and the journey's own row id for the link into Frameworks."""
    if control is None:
        return None
    text = getattr(control, "full_text", None) or getattr(control, "description", None) or ""
    return {
        "id": control.id,
        "implementation_id": implementation_id,
        "ref": getattr(control, "original_reference", None) or getattr(control, "control_id", None) or getattr(control, "code", None),
        "title": getattr(control, "title", None) or getattr(control, "name", None),
        "requirement": text[:2000] or None,
        "is_critical": bool(getattr(control, "is_critical", False)),
    }


def _word(status_value: Optional[str]) -> str:
    """A review state as one of the three words (a missing or unknown one is waiting, as the Overview has always counted it)."""
    word = (status_value or "pending").lower()
    return word if word in _WORDS else "pending"


def _file_filter(query, word: Optional[str]):
    if word == "pending":
        return query.filter(or_(ImplementationEvidence.review_status == "pending", ImplementationEvidence.review_status.is_(None)))
    if word in ("approved", "rejected"):
        return query.filter(ImplementationEvidence.review_status == word)
    return query


def _file_query(db: Session, journey_ids: List[int]):
    return db.query(ImplementationEvidence).join(
        ControlImplementation, ImplementationEvidence.implementation_id == ControlImplementation.id,
    ).outerjoin(
        ParsedFrameworkControl, ControlImplementation.parsed_control_id == ParsedFrameworkControl.id,
    ).filter(ControlImplementation.journey_id.in_(journey_ids))


def _search_files(query, term: Optional[str]):
    term = (term or "").strip()
    if not term:
        return query
    like = f"%{term}%"
    return query.filter(or_(
        ImplementationEvidence.file_name.ilike(like), ParsedFrameworkControl.title.ilike(like),
        ParsedFrameworkControl.original_reference.ilike(like), ParsedFrameworkControl.control_id.ilike(like),
    ))


def _scope_query(db: Session, framework_id: int, tenants: List[int]):
    return db.query(ClauseApplicability).join(
        ParsedFrameworkControl, ClauseApplicability.control_id == ParsedFrameworkControl.id,
    ).filter(ClauseApplicability.uploaded_framework_id == framework_id, ClauseApplicability.tenant_id.in_(tenants))


def _search_scope(query, term: Optional[str]):
    term = (term or "").strip()
    if not term:
        return query
    like = f"%{term}%"
    return query.filter(or_(
        ParsedFrameworkControl.title.ilike(like), ParsedFrameworkControl.original_reference.ilike(like),
        ParsedFrameworkControl.control_id.ilike(like), ClauseApplicability.justification.ilike(like),
    ))


def _untouched_query(db: Session, framework_id: int, tenants: List[int]):
    decided = db.query(ClauseApplicability.control_id).filter(
        ClauseApplicability.uploaded_framework_id == framework_id, ClauseApplicability.tenant_id.in_(tenants),
    )
    return db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id, ~ParsedFrameworkControl.id.in_(decided),
    )


def queue_counts(db: Session, journey_ids: List[int], framework_id: Optional[int], tenants: List[int]) -> Dict[str, Any]:
    """How many rows each list of the queue has: the chips of the journey page, true whatever page is shown."""
    files = {"pending": 0, "approved": 0, "rejected": 0, "total": 0}
    if journey_ids:
        word = func.coalesce(ImplementationEvidence.review_status, "pending")
        rows = db.query(word, func.count(ImplementationEvidence.id)).join(
            ControlImplementation, ImplementationEvidence.implementation_id == ControlImplementation.id,
        ).filter(ControlImplementation.journey_id.in_(journey_ids)).group_by(word).all()
        for value, count in rows:
            files[_word(value)] += count
            files["total"] += count
    scope = {"pending": 0, "approved": 0, "rejected": 0, "in_scope": 0, "out_of_scope": 0, "total": 0}
    untouched = 0
    untouched_manual = 0
    if framework_id:
        rows = db.query(ClauseApplicability.status, ClauseApplicability.is_applicable, func.count(ClauseApplicability.id)).filter(
            ClauseApplicability.uploaded_framework_id == framework_id, ClauseApplicability.tenant_id.in_(tenants),
        ).group_by(ClauseApplicability.status, ClauseApplicability.is_applicable).all()
        for value, applicable, count in rows:
            word_ = _word(value)
            scope[word_] += count
            scope["total"] += count
            if word_ == "approved":
                scope["in_scope" if applicable else "out_of_scope"] += count
        untouched = _untouched_query(db, framework_id, tenants).count()
        untouched_manual = _untouched_query(db, framework_id, tenants).filter(ParsedFrameworkControl.is_critical == True).count()  # noqa: E712
    return {
        "files": files, "scope": scope, "untouched": untouched, "untouched_manual": untouched_manual,
        "decided": files["approved"] + files["rejected"] + scope["approved"] + scope["rejected"],
    }


def _implementation_ids(db: Session, journey_ids: List[int], parsed_ids: List[int]) -> Dict[int, int]:
    """parsed control id -> the journey's own row id for it (what the Frameworks page opens a requirement by)."""
    if not journey_ids or not parsed_ids:
        return {}
    rows = db.query(ControlImplementation.parsed_control_id, func.min(ControlImplementation.id)).filter(
        ControlImplementation.journey_id.in_(journey_ids), ControlImplementation.parsed_control_id.in_(parsed_ids),
    ).group_by(ControlImplementation.parsed_control_id).all()
    return {parsed: impl for parsed, impl in rows}


def _rating(score: Any) -> Optional[int]:
    """The AI rating of a file as a whole percent. The column holds 0-1 on some paths and 0-100 on others."""
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        return None
    return round(score * 100) if 0 <= score <= 1 else round(score)


def _file_row(ev: ImplementationEvidence) -> Dict[str, Any]:
    impl = ev.implementation
    control = (impl.parsed_control or impl.framework_control) if impl else None
    return {
        "type": "file",
        "id": ev.id,
        "file_name": ev.file_name,
        "file_size": ev.file_size,
        "mime_type": ev.mime_type,
        "status": _word(ev.review_status),
        "uploaded_at": _iso(ev.uploaded_at),
        "uploaded_by": _person(ev.uploader),
        # the library row the file previews and downloads by (/evidence/{id}/preview); the journey-evidence id above is NOT that id
        "library_evidence_id": ev.evidence_id,
        "ai_confidence": _rating(ev.ai_confidence_score),
        "ai_notes": ev.ai_assessment_notes,
        "reviewed_by": _person(ev.reviewer),
        "reviewed_at": _iso(ev.reviewed_at),
        "review_notes": ev.review_notes,
        "control": _control_view(control, ev.implementation_id),
    }


def _scope_row(rec: ClauseApplicability, impl_ids: Dict[int, int]) -> Dict[str, Any]:
    return {
        "type": "scope",
        "id": rec.id,
        "status": _word(rec.status),
        "is_applicable": bool(rec.is_applicable),
        "justification": rec.justification,
        "requested_by": _person(rec.requester),
        "requested_at": _iso(rec.requested_at or rec.created_at),
        "reviewed_by": _person(rec.reviewer),
        "reviewed_at": _iso(rec.reviewed_at),
        "review_notes": rec.review_comment,
        "control": _control_view(rec.control, impl_ids.get(rec.control_id)),
    }


def _untouched_row(control: ParsedFrameworkControl, impl_ids: Dict[int, int]) -> Dict[str, Any]:
    view = _control_view(control, impl_ids.get(control.id)) or {}
    return {"type": "untouched", "id": control.id, "can_auto_approve": not view.get("is_critical", False), "control": view}


def _page_files(db: Session, journey_ids: List[int], word: Optional[str], term: Optional[str], skip: int, limit: int):
    query = _search_files(_file_filter(_file_query(db, journey_ids), word), term)
    total = query.count()
    if word == "pending":
        order = [ImplementationEvidence.uploaded_at.asc(), ImplementationEvidence.id.asc()]
    else:
        order = [ImplementationEvidence.reviewed_at.desc().nullslast(), ImplementationEvidence.id.desc()]
    rows = query.options(
        joinedload(ImplementationEvidence.uploader), joinedload(ImplementationEvidence.reviewer),
        joinedload(ImplementationEvidence.implementation).joinedload(ControlImplementation.parsed_control),
        joinedload(ImplementationEvidence.implementation).joinedload(ControlImplementation.framework_control),
    ).order_by(*order).offset(skip).limit(limit).all()
    return total, [_file_row(ev) for ev in rows]


def _page_scope(db: Session, framework_id: int, tenants: List[int], journey_ids: List[int], word: Optional[str], term: Optional[str], skip: int, limit: int):
    query = _search_scope(_scope_query(db, framework_id, tenants), term)
    if word in _WORDS:
        query = query.filter(ClauseApplicability.status == word)
    total = query.count()
    if word == "pending":
        order = [ClauseApplicability.requested_at.asc(), ClauseApplicability.id.asc()]
    else:
        order = [ClauseApplicability.reviewed_at.desc().nullslast(), ClauseApplicability.id.desc()]
    rows = query.options(
        joinedload(ClauseApplicability.requester), joinedload(ClauseApplicability.reviewer), joinedload(ClauseApplicability.control),
    ).order_by(*order).offset(skip).limit(limit).all()
    impl_ids = _implementation_ids(db, journey_ids, [r.control_id for r in rows])
    return total, [_scope_row(r, impl_ids) for r in rows]


def _page_decided(db: Session, framework_id: Optional[int], tenants: List[int], journey_ids: List[int], word: Optional[str], term: Optional[str], skip: int, limit: int):
    """The newest decisions of both kinds: each side gives its newest skip+limit rows and the merge keeps the page."""
    take = skip + limit
    words = [word] if word in ("approved", "rejected") else ["approved", "rejected"]
    total = 0
    rows: List[Dict[str, Any]] = []
    for one in words:
        if journey_ids:
            n, part = _page_files(db, journey_ids, one, term, 0, take)
            total += n
            rows.extend(part)
        if framework_id:
            n, part = _page_scope(db, framework_id, tenants, journey_ids, one, term, 0, take)
            total += n
            rows.extend(part)
    rows.sort(key=lambda row: (row.get("reviewed_at") or "", row["id"]), reverse=True)
    return total, rows[skip:skip + limit]


@router.get("/{framework_id}/review-queue")
def review_queue(
    framework_id: int,
    kind: str = Query("files", description="files | scope | untouched | decided"),
    status_filter: Optional[str] = Query(None, alias="status", description="pending | approved | rejected (decided: approved | rejected)"),
    q: Optional[str] = Query(None, max_length=200),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """A page of the Auditor Portal's review queue for one journey (or framework), with the counts of every list so the chips are true."""
    if kind not in QUEUE_KINDS:
        raise HTTPException(status_code=400, detail="Unknown list. Use files, scope, untouched or decided.")
    if status_filter is not None and status_filter not in _WORDS:
        raise HTTPException(status_code=400, detail="Unknown state. Use pending, approved or rejected.")
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    journey_ids = ctx.journey_ids
    fw_id = ctx.framework.id if ctx.framework else None
    counts = queue_counts(db, journey_ids, fw_id, user_tenants)

    word = status_filter or ("pending" if kind in ("files", "scope") else None)
    total = 0
    items: List[Dict[str, Any]] = []
    if kind == "files" and journey_ids:
        total, items = _page_files(db, journey_ids, word, q, skip, limit)
    elif kind == "scope" and fw_id:
        total, items = _page_scope(db, fw_id, user_tenants, journey_ids, word, q, skip, limit)
    elif kind == "untouched" and fw_id:
        query = _untouched_query(db, fw_id, user_tenants)
        term = (q or "").strip()
        if term:
            like = f"%{term}%"
            query = query.filter(or_(
                ParsedFrameworkControl.title.ilike(like), ParsedFrameworkControl.original_reference.ilike(like), ParsedFrameworkControl.control_id.ilike(like),
            ))
        total = query.count()
        rows = query.order_by(
            ParsedFrameworkControl.section_number.asc().nullsfirst(), ParsedFrameworkControl.control_id.asc(),
        ).offset(skip).limit(limit).all()
        impl_ids = _implementation_ids(db, journey_ids, [c.id for c in rows])
        items = [_untouched_row(c, impl_ids) for c in rows]
    elif kind == "decided":
        total, items = _page_decided(db, fw_id, user_tenants, journey_ids, word, q, skip, limit)

    journey = ctx.journeys[0] if ctx.journeys else None
    return {
        "framework": {"id": framework_id, "name": ctx.framework_label, "version": ctx.framework_version},
        "journey": {"id": journey.id, "name": journey.name, "status": journey.status} if journey else None,
        "counts": counts,
        "kind": kind,
        "status": word,
        "q": (q or "").strip() or None,
        "skip": skip,
        "limit": limit,
        "total": total,
        "items": items,
    }
