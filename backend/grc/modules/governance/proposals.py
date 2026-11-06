"""A change to a governance document by anyone who is not its owner or author waits for them (DECISIONS D35, the user's asks of
2026-10-21; answers: "Always", "Owner and author", "Sign as is, or propose again", "Required justification").

* Who: whoever may edit the document today (``permissions.can_edit``) and is neither its owner nor its author proposes; the owner,
  or the author when a different person, decides (``deciders``). When neither is an active user nothing is held (``required``) and
  an administrator decides on what was proposed before.
* What: the document's text or file - edited by hand, saved from the AI Studio, a new file, a version with text, a restore, a take
  back, a gap fix or its undo, statements written into the document - and its statements (added, edited, removed, rolled back).
  Always direct: sign-off stamps, the statements' re-reading after a new version (statement_reparse), document sync's matching,
  workflow actions, one-off data fixes, the AI Studio's Accept (it never writes the library), metadata, and every change by the
  owner or author.
* How: the writer computes what it would write and ``propose`` keeps it (a proposed file beside the library's files, never in place
  of the document's own); nothing in the document or its statements changes. ``accept`` runs that writer's own apply path as the
  proposer, so the version is theirs ("accepted by <owner>" in its summary), numbered when it is applied (D34); ``reject`` needs a
  note; the proposer may ``withdraw``. A proposal whose base no longer matches (another change landed meanwhile) is stale: it can
  only be rejected (``Stale``).
* In review or approval a proposed change to the document holds the route (a hold of kind "proposal", routes.py): nobody signs
  until the owner decides. Accepted, the hold ends as a resubmission does (minor: its stage again for everyone; major: the whole
  route). Not accepted, it stays: its proposer signs it as it is (their signature counts, nothing restarts), proposes again (the
  owner decides again) or withdraws it. One proposal holds the route at a time: one made meanwhile waits and takes the hold over
  when the one before ends without a change. A document is not sent for review while one waits. Statements hold nothing (they
  are not the text being signed).
* Both ends are told and asked, with a Task Management task: ``decide`` for the owner, ``revise`` for the proposer after a
  rejection (doc_lifecycle.py). The Change log reads ``change_proposed``, ``proposal_accepted``, ``proposal_rejected`` and
  ``proposal_withdrawn``.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from . import doc_lifecycle, permissions, routes

logger = logging.getLogger(__name__)

MESSAGE_REQUIRED = "Say why you are proposing this change."
NOTE_REQUIRED = "Say why it is not accepted: the person who proposed it reads it."
DECIDE_REFUSED = "Only the document's owner or its author accepts or rejects a proposed change."
WITHDRAW_REFUSED = "Only the person who proposed it can withdraw it."
STATEMENT_FIELDS = ("statement_text", "category", "priority", "is_mandatory", "source_section")
SOURCE_LABEL = {"edit": "edited by hand", "studio": "saved from the Comply AI Studio", "file": "a new file", "version": "a new version",
                "restore": "an earlier version restored", "take_back": "changes taken back", "gap_fix": "a gap fix",
                "gap_undo": "a gap fix taken back", "write_back": "statements written into the document",
                "statement_add": "a statement added", "statement_edit": "a statement edited", "statement_delete": "a statement removed",
                "statement_rollback": "a statement rolled back"}
_ORIGIN = {"edit": "manual", "studio": "manual", "file": "file", "version": "manual", "restore": "restore", "take_back": "revert",
           "gap_fix": "manual", "gap_undo": "revert", "write_back": "statement"}
_REANCHOR = ("studio", "restore", "take_back", "gap_fix", "gap_undo")     # a new file of a file document: statements found in it again


class Stale(Exception):
    """The document (or the statement) changed since the change was proposed: it can only be rejected. The text is for the person."""


def _models():
    from ... import models

    return models


def _name(db, user_id: Optional[int]) -> str:
    return doc_lifecycle._names(db, [user_id]).get(user_id, "Someone") if user_id else "Someone"


def _is_file(doc) -> bool:
    return bool(doc.file_path) and not (doc.content or "").strip()


# ── who ───────────────────────────────────────────────────────────────────────
def owners(db, doc) -> List[int]:
    """The document's owner and its author (one person when they are the same), those who are active users."""
    ids = [u for u in dict.fromkeys((doc.owner_id, doc.author_id)) if u]
    return doc_lifecycle._people(db, ids) if ids else []


def deciders(db, doc) -> List[int]:
    """Who accepts or rejects a proposed change: the owner and the author; when neither is an active user, the administrators."""
    return owners(db, doc) or sorted(permissions.admin_user_ids(db))


def required(db, user, doc) -> bool:
    """A change ``user`` makes waits for the owner or author: they are neither, and one of them is an active user."""
    return user.id not in (doc.owner_id, doc.author_id) and bool(owners(db, doc))


def may_decide(db, user, doc) -> bool:
    return user.id in deciders(db, doc)


def _decider_names(db, doc) -> str:
    ids = deciders(db, doc)
    names = doc_lifecycle._names(db, ids)
    return " or ".join(names[i] for i in ids if i in names) or "the owner"


# ── what it was made on ──────────────────────────────────────────────────────
def fingerprint(doc) -> str:
    """The document as a proposal is made on it: its number, its file and its text (a sign-off stamp changes the text too)."""
    raw = "\n".join((doc.current_version or "", doc.file_path or "", doc.content or ""))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def statement_fields(st) -> Optional[Dict[str, Any]]:
    return None if st is None else {k: getattr(st, k) for k in STATEMENT_FIELDS}


def _statement_hash(st) -> Optional[str]:
    if st is None:
        return None
    data = {k: getattr(st, k) for k in STATEMENT_FIELDS + ("statement_summary", "status")}
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def stale(db, doc, p) -> bool:
    """The base of a pending proposal no longer matches: the statement (or for a gap fix, its finding) or the document changed."""
    m = _models()
    if p.kind == "statement":
        if p.source == "statement_add":
            return False
        st = db.get(m.PolicyStatement, p.statement_id) if p.statement_id else None
        return st is None or st.document_id != doc.id or _statement_hash(st) != p.base_hash
    if p.source in ("gap_fix", "gap_undo"):
        f = db.get(m.PolicyGapFinding, p.finding_id) if p.finding_id else None
        if f is None or bool(f.applied_at) != (p.source == "gap_undo"):     # applied (or taken back) by someone else meanwhile
            return True
    return fingerprint(doc) != p.base_hash


def stale_text(db, doc, p) -> str:
    who = _name(db, p.proposed_by)
    if p.kind == "statement":
        code = (p.payload or {}).get("code") or "the statement"
        return f"This change was made to {code} as it was then; it has changed since. Ask {who} to propose it again."
    if (doc.current_version or "") != (p.base_number or ""):
        return f"This change was made on v{p.base_number}; the document is now v{doc.current_version}. Ask {who} to propose it again."
    return f"This change was made on v{p.base_number}, which has changed since. Ask {who} to propose it again."


# ── a proposed file ──────────────────────────────────────────────────────────
def store_file(data: bytes, name: str) -> Dict[str, Any]:
    """Keep a proposed file beside the library's files (never in place of a document's own)."""
    from .routers.documents import GOVERNANCE_UPLOAD_DIR

    safe = os.path.basename(name or "document.docx")
    path = os.path.join(GOVERNANCE_UPLOAD_DIR, f"{uuid.uuid4()}_proposed_{safe}")
    with open(path, "wb") as f:
        f.write(data)
    return {"path": path, "name": safe, "type": os.path.splitext(safe)[1].lower().lstrip(".") or "docx", "size": len(data)}


def file_of(db, doc, text: str) -> Optional[Dict[str, Any]]:
    """For a document that is its Word or PDF file: the file ``text`` makes of it, as its writers make it (studio.file_bytes: the Word
    file with the change written in, else a Word copy), kept for the owner to open. None for a text document, or when no file can be
    made (the texts still compare; accepting it then makes the file again)."""
    if not _is_file(doc):
        return None
    from .studio import service as studio

    try:
        data, _notes = studio.file_bytes(db, doc, text)
    except Exception:       # noqa: BLE001 - the proposal stands on its text
        logger.warning("document %s: the proposed file could not be made", doc.id, exc_info=True)
        return None
    return store_file(data, f"{os.path.splitext(doc.file_name or doc.title or 'document')[0]}.docx")


def file_data(p) -> Optional[bytes]:
    if p.proposed_file_path and os.path.exists(p.proposed_file_path):
        with open(p.proposed_file_path, "rb") as f:
            return f.read()
    return None


def proposed_text(p) -> Optional[str]:
    """The text the document would have: the proposal's own text, else the text of its file."""
    if (p.proposed_content or "").strip() or not p.proposed_file_path:
        return p.proposed_content
    from . import change_chain as C

    return C.version_text(SimpleNamespace(id=f"proposal-{p.id}", content=None, file_path=p.proposed_file_path,
                                          file_name=p.proposed_file_name or p.proposed_file_path, file_size=p.proposed_file_size))


# ── proposing ────────────────────────────────────────────────────────────────
def _audit(db, doc, user_id: int, action: str, p, detail: str) -> None:
    from .routers.versions import create_audit_log

    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user_id, action=action, field_changed="proposal",
                     old_value=None, new_value=str(p.id), action_details=detail[:4000])


def _what(p) -> str:
    code = (p.payload or {}).get("code")
    return SOURCE_LABEL.get(p.source, "a change") + (f" ({code})" if code else "")


def _change_set(db, doc, p, user) -> Optional[Dict[str, Any]]:
    """Who made what, as it is proposed (the change chain's change set against the document now)."""
    from . import change_chain as C

    try:
        before, after = C.document_text(doc), proposed_text(p)
        if before is None or after is None:
            return None
        return C.build_change_set(before, after, [], default_kind=_ORIGIN.get(p.source, "manual"), by=_name(db, user.id), by_id=user.id,
                                  at=datetime.utcnow().isoformat(), extra={"proposal_id": p.id})
    except Exception:       # noqa: BLE001 - the chain compares the texts when this is missing
        logger.warning("document %s: the change set of proposal %s could not be made", doc.id, p.id, exc_info=True)
        return None


def _hold(db, doc, p, user):
    """In review or approval the proposed change holds the route, unless something holds it already: then it waits - and when that
    is the proposer's own change the owner did not accept, this one takes its hold over (proposed again: the owner decides again)."""
    m = _models()
    if doc.status not in routes.PENDING:
        return None
    hold = routes.open_hold(db, doc)
    if hold is not None:
        current = db.get(m.DocumentChangeProposal, hold.proposal_id) if routes.is_proposal(hold) and hold.proposal_id else None
        if current is not None and current.proposed_by == user.id and current.status == "rejected":
            hold.proposal_id, hold.comment, p.hold_id = p.id, p.message, hold.id
            return hold
        return None
    from .routers.document_signoff import _hold_marks

    st = routes.current(db, doc)
    shown, newest = _hold_marks(db, doc)
    hold = m.DocumentRouteHold(tenant_id=doc.tenant_id, document_id=doc.id, round_at=doc.signoff_round_at,
                               stage_position=st.position if st else None, requested_by=user.id, requested_at=datetime.utcnow(),
                               comment=p.message, content_before=doc.content, version_id=shown, signature_mark=newest,
                               kind="proposal", proposal_id=p.id)
    db.add(hold)
    db.flush()
    p.hold_id = hold.id
    return hold


def propose(db, doc, user, *, source: str, message: Optional[str] = None, prefill: Optional[str] = None, content: Optional[str] = None,
            file: Optional[Dict[str, Any]] = None, payload: Optional[Dict[str, Any]] = None, change_type: Optional[str] = None,
            statement=None, finding=None, session_id: Optional[int] = None, change_set: Optional[Dict[str, Any]] = None):
    """Keep a change ``user`` made as a proposal for the owner to accept: ``content`` (the text the document would have) or ``file``
    (``store_file``'s answer), ``payload`` (what its writer needs to apply it). ``message`` (why) is required; a gap fix's comes from
    its finding (``prefill``). Nothing in the document or its statements changes. Does not commit."""
    m = _models()
    text = (message or "").strip() or (prefill or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MESSAGE_REQUIRED)
    kind = "statement" if source.startswith("statement_") else "document"
    V = m.GovernanceDocumentVersion
    base = db.query(V.id).filter(V.document_id == doc.id).order_by(V.id.desc()).first()
    file = file or {}
    p = m.DocumentChangeProposal(
        tenant_id=doc.tenant_id, document_id=doc.id, kind=kind, source=source, status="pending", proposed_by=user.id,
        proposed_at=datetime.utcnow(), message=text[:4000], change_type=change_type if change_type in ("major", "minor") else None,
        base_version_id=base[0] if base else None, base_number=doc.current_version or "1.0",
        base_hash=_statement_hash(statement) if kind == "statement" else fingerprint(doc),
        statement_id=getattr(statement, "id", None), finding_id=getattr(finding, "id", None), studio_session_id=session_id,
        proposed_content=content, proposed_file_path=file.get("path"), proposed_file_name=file.get("name"),
        proposed_file_type=file.get("type"), proposed_file_size=file.get("size"), payload=payload or {}, change_set=change_set)
    db.add(p)
    db.flush()
    if kind == "document" and change_set is None:
        p.change_set = _change_set(db, doc, p, user)
    hold = _hold(db, doc, p, user) if kind == "document" else None
    # proposing again answers the request to revise what was not accepted (of the same kind; a statement, the same statement)
    P = m.DocumentChangeProposal
    for earlier in db.query(P).filter(P.document_id == doc.id, P.proposed_by == user.id, P.status == "rejected", P.kind == kind,
                                      P.id != p.id).order_by(P.id).all():
        if kind == "document" or earlier.statement_id == p.statement_id:
            doc_lifecycle.on_proposal_closed(db, doc, user.id, earlier)
    _audit(db, doc, user.id, "change_proposed", p, f"{_name(db, user.id)} proposed {_what(p)}: {p.message}")
    db.flush()
    doc_lifecycle.on_proposed(db, doc, user.id, p, hold)
    return p


def answer(db, p, user, doc) -> Dict[str, Any]:
    """What a writer answers for a change it kept as a proposal (owners' own calls answer as they always did)."""
    what = "The statement does not change" if p.kind == "statement" else "The document does not change"
    return {"proposed": True, "proposal": view(db, p, user, doc),
            "message": f"Sent to {_decider_names(db, doc)} to accept. {what} until then."}


# ── deciding ─────────────────────────────────────────────────────────────────
def _pending_or_409(p) -> None:
    if p.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This change was already {p.status}.")


def _decider_or_403(db, user, doc) -> None:
    if not may_decide(db, user, doc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DECIDE_REFUSED)


def _apply(db, doc, p, proposer) -> None:
    """Run the writer's own apply path, as the proposer (the version is theirs). Does not commit."""
    payload = p.payload or {}
    src = p.source
    if src == "edit":
        from .routers.documents import apply_content_edit

        apply_content_edit(db, doc, proposer, p.proposed_content, payload.get("change_reason") or p.message)
    elif src == "file":
        from .routers.documents import attach_file

        attach_file(db, doc, proposer, p.proposed_file_path, p.proposed_file_name, p.proposed_file_size, p.proposed_file_type,
                    payload.get("change_summary"), payload.get("change_reason") or p.message, payload.get("create_new_version", True))
    elif src == "version":
        from .routers.versions import VersionCreate, apply_version

        apply_version(db, doc, proposer, VersionCreate(**{k: v for k, v in payload.items() if k in VersionCreate.model_fields}))
    elif src == "restore":
        from .routers.versions import restore_version

        target = db.get(_models().GovernanceDocumentVersion, payload.get("version_id"))
        if target is None or target.document_id != doc.id:
            raise Stale("The version this change restores is no longer there. Reject it.")
        restore_version(db, doc, proposer, target, payload.get("rollback_reason") or p.message)
    elif src == "studio":
        from .studio import service as studio

        studio.apply_proposal(db, doc, proposer, p)
    elif src == "take_back":
        from .routers.change_chain import take_back

        take_back(db, doc, proposer, payload.get("since_version") or p.base_number, int(payload.get("changes") or 1),
                  payload.get("reason") or p.message, p.proposed_content, file_data(p))
    elif src in ("gap_fix", "gap_undo"):
        from .routers import gap_analysis

        finding = db.get(_models().PolicyGapFinding, p.finding_id)
        if src == "gap_fix":
            gap_analysis.apply_fix(db, doc, finding, proposer, payload, p.proposed_content, file_data(p))
        else:
            gap_analysis.undo_fix(db, doc, finding, proposer, payload.get("override_status"), payload.get("override_justification"),
                                  data=file_data(p))
    elif src == "write_back":
        from . import doc_sync

        doc_sync.write_prepared(db, doc, proposer, payload.get("prepared") or {}, payload.get("change_reason") or p.message)
    elif src.startswith("statement_"):
        from .routers import policy_parser

        policy_parser.apply_statement_proposal(db, doc, proposer, p)
    else:
        raise ValueError(f"Unknown proposed change: {src}")


def accept(db, doc, p, user, note: Optional[str] = None):
    """Apply a pending proposal through its writer's own path, as the proposer: the next version is theirs, its summary says who
    accepted it. A change that held the route ends the hold as a resubmission does (the size of the change: minor, the stage starts
    again; major, the route). Raises ``Stale``. Returns the version it made (None for a statement). Does not commit."""
    from sqlalchemy import func

    m = _models()
    _pending_or_409(p)
    _decider_or_403(db, user, doc)
    permissions.ensure_not_archived(doc)
    if stale(db, doc, p):
        raise Stale(stale_text(db, doc, p))
    proposer = db.get(m.GRCUser, p.proposed_by)
    hold = routes.open_hold(db, doc)
    holds_it = hold is not None and routes.is_proposal(hold) and hold.proposal_id == p.id
    V = m.GovernanceDocumentVersion
    top = db.query(func.max(V.id)).filter(V.document_id == doc.id).scalar() or 0
    _apply(db, doc, p, proposer)
    db.flush()
    newest = db.query(V).filter(V.document_id == doc.id, V.id > top).order_by(V.id.desc()).first()
    who, by = _name(db, user.id), _name(db, p.proposed_by)
    if newest is not None:
        newest.created_by = p.proposed_by
        newest.change_summary = f"{(newest.change_summary or '').rstrip()} · Proposed by {by}, accepted by {who}".lstrip(" ·")
    note = (note or "").strip() or None
    p.status, p.decided_by, p.decided_at, p.decision_note = "accepted", user.id, datetime.utcnow(), note
    p.applied_version_id = newest.id if newest is not None else None
    then = ""
    if holds_it:
        from .routers.document_signoff import change_since, resume

        size = "major" if newest is not None and newest.change_type == "major" else change_since(db, doc, hold)
        then = resume(db, doc, hold, user.id, size, note, done=f"{by}'s proposed change was accepted", log=False)
    number = f" (v{newest.version_number})" if newest is not None else ""
    _audit(db, doc, user.id, "proposal_accepted", p, f"{who} accepted {_what(p)} proposed by {by}{number}" + (f": {note}" if note else "")
           + (f". {then}" if then else ""))
    db.flush()
    doc_lifecycle.on_proposal_decided(db, doc, user.id, p, number=newest.version_number if newest is not None else None)
    return newest


def after_accept(db, doc, p) -> None:
    """What the writer does once its change is committed: statements found in a new file again (organisations that tie them to the
    file), and a new file's statements read when it has none yet. Never fails the accept."""
    try:
        if p.source in _REANCHOR and _is_file(doc):
            from .studio import service as studio

            studio.reanchor(db, doc, p.proposed_by)
        if p.source == "file":
            from .routers.documents import _resolve_tenant_slug_for_autoparse
            from .routers.policy_parser import maybe_autoparse_document

            maybe_autoparse_document(db, _resolve_tenant_slug_for_autoparse(doc.tenant_id), doc.id, p.proposed_by)
    except Exception:       # noqa: BLE001 - the change is in; statements catch up with the next version
        logger.warning("document %s: what follows an accepted change did not run", doc.id, exc_info=True)


def reject(db, doc, p, user, note: Optional[str]) -> None:
    """Not accepted (a note is required): nothing changes. Its proposer is told and asked to revise it; a change that held the route
    still holds it, and its proposer may sign the document as it is (``routes.may_sign_as_is``) or propose again. Does not commit."""
    note = (note or "").strip()
    if not note:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=NOTE_REQUIRED)
    _pending_or_409(p)
    _decider_or_403(db, user, doc)
    p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", user.id, datetime.utcnow(), note
    hold = routes.open_hold(db, doc)
    held = hold is not None and routes.is_proposal(hold) and hold.proposal_id == p.id
    _audit(db, doc, user.id, "proposal_rejected", p, f"{_name(db, user.id)} did not accept {_what(p)} proposed by {_name(db, p.proposed_by)}: {note}")
    db.flush()
    may_sign = False
    if held:
        from .routers.document_signoff import _step

        may_sign = _step(db, doc, p.proposed_by) is not None
    doc_lifecycle.on_proposal_decided(db, doc, user.id, p, held=held, may_sign=may_sign)


def withdraw(db, doc, p, user) -> None:
    """The proposer takes their change back (pending, or not accepted): what was asked about it ends; a change that held the route
    releases it (``release``). Does not commit."""
    if p.proposed_by != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WITHDRAW_REFUSED)
    if p.status not in ("pending", "rejected"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This change was already {p.status}.")
    was, p.status = p.status, "withdrawn"
    hold = routes.open_hold(db, doc)
    then = release(db, doc, hold, user.id, p) if hold is not None and routes.is_proposal(hold) and hold.proposal_id == p.id else ""
    _audit(db, doc, user.id, "proposal_withdrawn", p, f"{_name(db, user.id)} withdrew {_what(p)}" + (f". {then}" if then else ""))
    db.flush()
    doc_lifecycle.on_proposal_closed(db, doc, user.id, p, withdrawn=was == "pending")


def release(db, doc, hold, by: int, p) -> str:
    """The change that held the route ended without being accepted (withdrawn): another proposed change that waits takes the hold over;
    else the review goes on - where it was when nothing changed meanwhile (the requests that waited are asked again), else as after a
    resubmission of what changed. Returns what happens, as the history says it."""
    m = _models()
    P = m.DocumentChangeProposal
    waiting = (db.query(P).filter(P.document_id == doc.id, P.kind == "document", P.status == "pending", P.id != p.id)
               .order_by(P.id).all())
    nxt = next((x for x in waiting if not stale(db, doc, x)), None)
    if nxt is not None:
        hold.proposal_id, hold.comment, hold.requested_by, nxt.hold_id = nxt.id, nxt.message, nxt.proposed_by, hold.id
        return f"The change {_name(db, nxt.proposed_by)} proposed holds it now"
    if routes.changed_since(db, doc, hold):
        from .routers.document_signoff import change_since, resume

        return resume(db, doc, hold, by, change_since(db, doc, hold), done="The proposed change was withdrawn and the document changed meanwhile",
                      log=False)
    hold.resolved_at, hold.resolved_by, hold.change, hold.outcome = datetime.utcnow(), by, "none", "as_is"
    db.flush()
    doc_lifecycle.on_released(db, doc, by)
    return "The review goes on where it was"


def signed_as_is(db, doc, user_id: int) -> None:
    """Its proposer signed the document as it is after the owner did not accept their change (``routes.may_sign_as_is``): the hold ends
    and nothing restarts (the others' signatures stand); their request to revise it is done. The requests that waited are asked again
    once the signature is in (``doc_lifecycle.on_released``, from the sign-off)."""
    hold = routes.open_hold(db, doc)
    if hold is None or not routes.is_proposal(hold):
        return
    hold.resolved_at, hold.resolved_by, hold.change, hold.outcome = datetime.utcnow(), user_id, "none", "as_is"
    db.flush()
    p = db.get(_models().DocumentChangeProposal, hold.proposal_id) if hold.proposal_id else None
    if p is not None:
        doc_lifecycle.on_proposal_closed(db, doc, user_id, p)


# ── reading ──────────────────────────────────────────────────────────────────
def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def view(db, p, user, doc, *, deciding: Optional[bool] = None, names: Optional[Dict[int, str]] = None) -> Dict[str, Any]:
    """A proposal as the screens show it (the shared design's ``Proposal``)."""
    names = names if names is not None else doc_lifecycle._names(db, [p.proposed_by, p.decided_by])
    payload = p.payload or {}
    pending = p.status == "pending"
    deciding = may_decide(db, user, doc) if deciding is None else deciding
    is_stale = stale(db, doc, p) if pending else False
    applied = None
    if p.applied_version_id:
        number = db.query(_models().GovernanceDocumentVersion.version_number).filter(
            _models().GovernanceDocumentVersion.id == p.applied_version_id).scalar()
        applied = {"id": p.applied_version_id, "number": number}
    hold = routes.open_hold(db, doc) if p.status in ("pending", "rejected") and p.hold_id else None
    return {
        "id": p.id, "document_id": p.document_id, "kind": p.kind, "source": p.source, "status": p.status, "stale": is_stale,
        "proposed_by": {"id": p.proposed_by, "name": names.get(p.proposed_by)}, "proposed_at": _iso(p.proposed_at),
        "message": p.message, "change_type": p.change_type, "base": {"version_id": p.base_version_id, "number": p.base_number},
        "statement": None if p.kind != "statement" else {"id": p.statement_id, "code": payload.get("code"), "before": payload.get("before"),
                                                          "after": payload.get("after")},
        "finding": payload.get("finding"), "has_file": bool(p.proposed_file_path),
        "studio_session_id": p.studio_session_id,                           # an AI Studio save: the draft it was sent from
        "decided_by": {"id": p.decided_by, "name": names.get(p.decided_by)} if p.decided_by else None, "decided_at": _iso(p.decided_at),
        "decision_note": p.decision_note, "applied_version": applied,
        "may_accept": pending and deciding and not is_stale and doc.status != "archived", "may_reject": pending and deciding,
        "may_withdraw": p.proposed_by == user.id and p.status in ("pending", "rejected"),
        # in review it holds the route: nobody signs until it is decided (not accepted: until its proposer signs it as it is or withdraws it)
        "holds_review": hold is not None and routes.is_proposal(hold) and hold.proposal_id == p.id,
    }


def listing(db, doc, user) -> Dict[str, Any]:
    P = _models().DocumentChangeProposal
    rows = db.query(P).filter(P.document_id == doc.id).order_by(P.proposed_at.desc(), P.id.desc()).all()
    names = doc_lifecycle._names(db, {p.proposed_by for p in rows} | {p.decided_by for p in rows if p.decided_by})
    deciding = may_decide(db, user, doc)
    return {"items": [view(db, p, user, doc, deciding=deciding, names=names) for p in rows], "can_decide": deciding,
            "pending": sum(1 for p in rows if p.status == "pending")}


def compare(db, doc, p) -> Dict[str, Any]:
    """The document as it was when the change was proposed, and as the change would make it, for the redline (change_chain.compare's
    rows and changes); a statement's fields before and after."""
    payload = p.payload or {}
    if p.kind == "statement":
        return {"before": payload.get("before"), "after": payload.get("after")}
    from . import change_chain as C

    base_row = db.get(_models().GovernanceDocumentVersion, p.base_version_id) if p.base_version_id else None
    base_text = C.version_text(base_row) if base_row is not None else C.document_text(doc)
    new_text = proposed_text(p)
    at = p.proposed_at
    out = {"base": {"label": f"v{p.base_number} · in the library", "version_id": p.base_version_id},
           "proposed": {"label": f"Proposed by {_name(db, p.proposed_by)}" + (f" · {at.day} {at:%b %Y}" if at else "")}}
    if base_text is None or new_text is None:
        return {**out, "rows": [], "changes": [], "hunks": [], "stats": None,
                "why": "The text of one of them cannot be read here: open the files to compare them."}
    res = C.compare(base_text, new_text)
    return {**out, "rows": res["rows"], "changes": res["hunks"], "hunks": res["hunks"], "stats": res["stats"]}


def decide_summary(db, user, doc) -> Optional[Dict[str, Any]]:
    """For the owner (or author): how many proposed changes wait for them and the first one; None for anyone else."""
    P = _models().DocumentChangeProposal
    ids = [i for (i,) in db.query(P.id).filter(P.document_id == doc.id, P.status == "pending").order_by(P.id)]
    if not ids or not may_decide(db, user, doc):
        return None
    return {"count": len(ids), "first_id": ids[0]}


def waiting_before_send(db, doc) -> Optional[str]:
    """Why the document is not sent for review yet: a proposed change to it waits for the owner (it would hold the review)."""
    P = _models().DocumentChangeProposal
    p = db.query(P).filter(P.document_id == doc.id, P.kind == "document", P.status == "pending").order_by(P.id).first()
    if p is None:
        return None
    return f"A change {_name(db, p.proposed_by)} proposed waits for {_decider_names(db, doc)}: accept or reject it before it is sent for review."


def for_session(db, s) -> Optional[Dict[str, Any]]:
    """An AI Studio draft's newest change saved to the library as a proposal, while it waits or after it was not accepted."""
    P = _models().DocumentChangeProposal
    p = (db.query(P).filter(P.studio_session_id == s.id, P.status.in_(("pending", "rejected"))).order_by(P.id.desc()).first()
         if s.document_id else None)
    if p is None:
        return None
    return {"id": p.id, "status": p.status, "decision_note": p.decision_note, "proposed_at": _iso(p.proposed_at)}


def gap_justification(finding) -> str:
    """A gap fix's why, from the gap analysis: "<clause> <title>: <gap description> <missing requirement>" (else its reasoning)."""
    head = " ".join(x for x in (finding.clause_reference, finding.clause_title) if x)
    why = " ".join(x.strip() for x in (finding.gap_description, finding.missing_requirement) if (x or "").strip()) \
        or (finding.ai_reasoning or "").strip()
    return f"{head}: {why}" if head and why else (head or why)
