"""A document's change chain: every version with what it changed from -> to, who changed it and on whose request, the approvals
between the versions, the document as a redline against any earlier version (with a way to take a change back), and the whole
chain as an Excel / PDF / CSV catalog. Tenants that do not have the document life cycle get ``{"enabled": false}``.

Reading never writes. Taking a change back is an ordinary edit: a new version by the person who did it, which sends an approved
or published document back to review (the same rule the AI Studio follows when it saves a document).
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GovernanceDocumentVersion, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import change_chain as C
from .. import change_chain_export, doc_lifecycle, doc_version
from ..permissions import ensure_not_archived, require_doc_editor, require_doc_reader, version_for
from .document_signoff import _doc_or_404
from .documents import _snapshot_content_version, create_audit_log

router = APIRouter(prefix="/documents", tags=["Governance - Change chain"])


def _enabled_or_404(db: Session) -> None:
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The change chain is not enabled for this organisation")


@router.get("/{document_id}/change-chain", dependencies=[Depends(require_doc_reader)])
def get_chain(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    return C.chain(db, doc, upto=version_for(db, current_user, doc))       # ends at the version in force for who reads that one


@router.get("/{document_id}/change-chain/redline", dependencies=[Depends(require_doc_reader)])
def get_redline(document_id: int, from_version: int = Query(..., alias="from"), to: Optional[int] = None,
                db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The document as it changed from version ``from`` to version ``to`` (the document as it is now when ``to`` is left out):
    rows to read, the changes with who made each and on whose request, and whether they can be taken back here. Someone who reads
    the version in force compares with that one, never with a newer version."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    in_force = version_for(db, current_user, doc)
    if in_force is not None:
        if from_version > in_force.id or (to or 0) > in_force.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That version was not found for this document.")
        to = to or in_force.id
    try:
        out = C.redline(db, doc, from_version, to)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    out["versions"] = [v for v in C.baseline_options(db, doc) if in_force is None or v["id"] <= in_force.id]
    return out


class RevertIn(BaseModel):
    from_version_id: int                         # the version the changes are counted from
    hunks: List[int]                             # the changes to take back, by the ids the redline gave them
    hash: Optional[str] = None                   # the redline's fingerprint of the document: an edit made meanwhile is refused
    reason: Optional[str] = None


@router.post("/{document_id}/change-chain/revert", dependencies=[Depends(require_doc_editor)])
def revert_changes(document_id: int, body: RevertIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Take chosen changes back to what an earlier version had, leaving every other change as it is. A new version."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    _enabled_or_404(db)
    ensure_not_archived(doc)
    is_file = not (doc.content or "").strip()            # an uploaded Word or PDF: the file is the document
    base_v = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.id == body.from_version_id,
                                                        GovernanceDocumentVersion.document_id == doc.id).first()
    if base_v is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That version was not found for this document.")
    base_text = C.version_text(base_v)
    if base_text is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The text of that version cannot be read.")
    old_content = C.document_text(doc)
    if old_content is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The text of this document's file cannot be read, so a change cannot be taken back here.")
    if body.hash and body.hash != C.content_hash(old_content):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The document was edited while you were looking at it. Open the changes again.")
    wanted = set(body.hunks)
    locked = [h for h in C.hunks_of(base_text, old_content) if h["id"] in wanted and h["locked"]]
    if locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A sign-off record cannot be taken back: it is stamped by the sign-off.")
    try:
        new_content = C.revert(base_text, old_content, wanted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if C.content_hash(new_content) == C.content_hash(old_content):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing would change.")

    n = len(wanted)
    done = f"Took back {n} change{'' if n == 1 else 's'} made since version {base_v.version_number}"
    why = (body.reason or "").strip()[:2000]          # the person's why
    reason, summary = why or done, f"{done}: {why}" if why else done
    kind = doc_version.by_rule(old_content, new_content)        # major or minor, as any version (the rule: no AI call)
    old_title, old_version, old_status = doc.title, doc.current_version or "1.0", doc.status
    name = current_user.display_name or current_user.username or "A user"
    notes: List[str] = []
    # not published yet: the take back goes into the one pending version, which keeps who made each change it holds
    pending = doc_version.pending_row(db, doc)
    held = dict(pending.change_set) if pending is not None and isinstance(pending.change_set, dict) else None
    if is_file:
        # the file is the document: a Word file gets the change written into it (its fonts, header and footer stay), a PDF becomes a
        # Word copy; the file it replaces stays as the earlier version, so the original is never lost
        from ..studio import service as studio

        data, notes = studio.file_bytes(db, doc, new_content)
        row, new_version, _ = studio.write_file_version(db, doc, current_user, data, change_type=kind, summary=summary, reason=reason,
                                                        done="Changes were taken back")
    else:
        doc.content, doc.updated_at = new_content, datetime.utcnow()
        new_version = _snapshot_content_version(db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
                                                change_type=kind, change_reason=reason, user_id=current_user.id, summary=summary)
        db.flush()
        row = (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id, GovernanceDocumentVersion.version_number == new_version)
               .order_by(GovernanceDocumentVersion.id.desc()).first())
    if row is not None and pending is not None and row.id == pending.id:
        before = doc_version.before_pending(db, doc, row)
        maker = db.get(GRCUser, row.created_by) if row.created_by else None
        cs = C.fold(C.version_text(before) if before is not None else "", old_content, new_content, held, kind="revert", by=name,
                    by_id=current_user.id, at=datetime.utcnow().isoformat(), version=new_version, reason=reason,
                    held_by=(maker.display_name or maker.username) if maker is not None else "", held_by_id=row.created_by,
                    held_at=row.created_at.isoformat() if row.created_at else None)
        if cs is not None:
            cs.update({"reverts": {"since_version": base_v.version_number, "changes": n}, "stage_before": old_status})
            row.change_set = cs
    elif row is not None:
        cs = C.build_change_set(old_content, new_content, [], default_kind="revert", by=name, by_id=current_user.id, at=datetime.utcnow().isoformat(),
                                extra={"reverts": {"since_version": base_v.version_number, "changes": n}, "stage_before": old_status})
        for item in cs["items"]:
            item["reason"] = reason
        row.change_set = cs
    if not is_file:               # (a file's status and history are written with its new version)
        doc_lifecycle.changed_after_review(db, doc, old_status, current_user.id,
                                           f"Changes were taken back (version {new_version}), so it needs approving again")
        create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="content_edited", field_changed="current_version",
                         old_value=old_version, new_value=new_version, action_details=f"{reason}; version {new_version}"
                         + doc_lifecycle.outcome(old_status, doc.status, doc))
    db.commit()
    if is_file:
        studio.reanchor(db, doc, current_user.id)
    return {"version": new_version, "status": doc.status, "changes_taken_back": n, "notes": notes}


@router.get("/{document_id}/change-chain/export", dependencies=[Depends(require_doc_reader)])
def export_chain(document_id: int, format: str = "xlsx", db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The whole chain as one file: Excel (a sheet each for versions, changes, sources and approvals), PDF or CSV."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    _enabled_or_404(db)
    fmt = (format or "xlsx").lower()
    if fmt not in ("xlsx", "pdf", "csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose xlsx, pdf or csv.")
    data, media_type, filename = change_chain_export.build(C.chain(db, doc, upto=version_for(db, current_user, doc)), fmt,
                                                           current_user.display_name or current_user.username or "a user")
    return Response(content=data, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
