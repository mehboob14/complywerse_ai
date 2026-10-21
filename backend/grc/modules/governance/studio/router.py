"""AI Studio API (``/governance/studio``). Tenants without it get ``{"enabled": false}`` from ``/status`` and 404 elsewhere."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import (GRCUser, GovernanceDocument, StudioAsset, StudioMessage, StudioReference, StudioSession, StudioTemplate, Tenant,
                        UploadedFramework, get_db)
from ....routers.auth_router import require_auth
from ....services.ai_gateway import claude_client
from ..permissions import can_edit, edit_filter, is_admin as _is_admin, visible_filter
from . import blocks as B
from . import assets, checks, exporters, gate, jobs, service, templates
from . import references as refs

router = APIRouter(prefix="/studio", tags=["Governance - AI Studio"])


# ── guards ───────────────────────────────────────────────────────────────────
def require_studio(db: Session = Depends(get_db)) -> None:
    if not gate.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The Comply AI Studio is not enabled for this organisation")


def _session(db: Session, session_id: int, user: GRCUser) -> StudioSession:
    s = db.get(StudioSession, session_id)
    if s is None or s.created_by != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return s


def _message(db: Session, s: StudioSession, message_id: int) -> StudioMessage:
    m = db.get(StudioMessage, message_id)
    if m is None or m.session_id != s.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return m


def _problem(exc: Exception) -> HTTPException:
    code = (status.HTTP_409_CONFLICT if isinstance(exc, service.Conflict)
            else status.HTTP_403_FORBIDDEN if isinstance(exc, (service.Forbidden, refs.Refused)) else status.HTTP_400_BAD_REQUEST)
    return HTTPException(status_code=code, detail=str(exc))


def _slug(db: Session) -> str:
    tenant = db.query(Tenant).first()
    return tenant.slug if tenant else ""


# ── bodies ───────────────────────────────────────────────────────────────────
class SessionIn(BaseModel):
    kind: str = "new"                              # new | library
    title: str = ""
    doc_type: str = "policy"
    template_id: Optional[str] = None
    document_id: Optional[int] = None
    instructions: Optional[Dict[str, Any]] = None
    content: Optional[str] = None                  # a new document's start: a template of the platform's catalogue, as Markdown
    template_name: Optional[str] = None            # that template's name ("NCA template: ..."), kept as where the document started


class SessionPatch(BaseModel):
    title: Optional[str] = None
    doc_type: Optional[str] = None
    instructions: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None


class ContentIn(BaseModel):
    content: str
    base_revision: Optional[int] = None
    summary: Optional[str] = None


class ReferenceIn(BaseModel):
    kind: str                                      # parent_document | document | framework | template
    source_id: Optional[int] = None
    scope: Optional[Dict[str, Any]] = None
    template_id: Optional[str] = None


class MessageIn(BaseModel):
    text: str = ""
    reply_to: Optional[int] = None                 # the message whose questions this answers
    answers: Optional[List[Dict[str, Any]]] = None  # [{id: "q1", chosen: [option labels], other: "words"}]
    decide: bool = False                           # leave the questions not answered to Comply Agent
    attachments: Optional[List[int]] = None        # the files attached in the chat with this request (references uploaded with it)


class DraftIn(BaseModel):
    brief: Optional[str] = None                    # what the person wants, in their words (optional)
    rewrite: bool = False                          # write it again even though the document has been started


class OpsIn(BaseModel):
    op_ids: Optional[List[str]] = None             # default: every pending change
    overrides: Optional[Dict[str, str]] = None     # the person's own wording for a change, by id


class FixIn(BaseModel):
    fix: Dict[str, Any]
    message: Optional[str] = None


class FixAllIn(BaseModel):
    kinds: Optional[List[str]] = None
    all: bool = False                               # every fix offered, Comply Agent's suggestions and added sections too


class CompareIn(BaseModel):
    document_id: Optional[int] = None
    revision: Optional[int] = None
    reference_id: Optional[int] = None             # an attached reference, e.g. a file the person uploaded to compare with
    ai: bool = False


class MoveIn(BaseModel):
    title: Optional[str] = None
    doc_type: Optional[str] = None
    classification: Optional[str] = None           # the session's setup, else internal, when not given
    parent_document_id: Optional[int] = None
    framework_ids: Optional[List[int]] = None
    description: Optional[str] = None
    owner_id: Optional[int] = None                 # the person moving it, when not given
    department_id: Optional[int] = None
    review_cycle_months: Optional[int] = None      # the session's setup, else 12, when not given
    effective_date: Optional[datetime] = None
    next_review_date: Optional[datetime] = None    # the effective date (or today) + the review cycle, when not given
    # an uploaded file changed here moves as two versions: the person's minor or major for the second (else Comply Agent decides)
    change_type: Optional[Literal["major", "minor"]] = None

    def details(self) -> Dict[str, Any]:
        return self.model_dump(include={"description", "owner_id", "department_id", "review_cycle_months", "effective_date", "next_review_date"})


class SaveIn(BaseModel):
    change_reason: Optional[str] = None
    force: bool = False
    change_type: Optional[Literal["major", "minor"]] = None     # the person's choice; without it Comply Agent decides (older callers)


class TemplateIn(BaseModel):
    session_id: Optional[int] = None
    name: str
    doc_type: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    make_default: bool = False


class AssetIn(BaseModel):
    name: Optional[str] = None
    is_default: Optional[bool] = None


class ExportIn(BaseModel):
    format: str = "docx"                           # docx | pdf | md | html
    logo_asset_id: Optional[int] = None            # for this export only; the session's own logo is used otherwise
    no_logo: bool = False
    entity_name: Optional[str] = None
    logo_position: Optional[str] = None            # header-left | header-center | header-right | footer-left | footer-center | footer-right
    highlight_placeholders: bool = True

    def overrides(self) -> Dict[str, Any]:
        return {"logo_asset_id": self.logo_asset_id, "no_logo": True if self.no_logo else None, "entity_name": self.entity_name,
                "logo_position": self.logo_position if self.logo_position in exporters.LOGO_POSITIONS else None}


# ── status and pickers ───────────────────────────────────────────────────────
@router.get("/status")
def get_status(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    if not gate.enabled(db):
        return {"enabled": False}
    return {"enabled": True, "ai_configured": claude_client.configured(), "doc_types": list(templates.DOC_TYPES) + ["other"],
            "max_upload_mb": service.MAX_UPLOAD_BYTES // (1024 * 1024), "is_admin": _is_admin(db, user)}


@router.get("/documents", dependencies=[Depends(require_studio)])
def pick_documents(q: str = "", limit: int = Query(30, le=100), editable: bool = False, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """Library documents to use as a reference or to open (those the person may read; ``editable``: only those they may change, for
    Edit from the library); ``may_edit``: the person may change it, so it can be opened to edit."""
    query = db.query(GovernanceDocument).filter(GovernanceDocument.status != "archived")
    visible = visible_filter(db, user)
    if visible is not None:
        query = query.filter(visible)
    editors_only = edit_filter(db, user)          # None: the person may change every document (one rights lookup, not one per row)
    if editable and editors_only is not None:
        query = query.filter(editors_only)
    if q.strip():
        query = query.filter(GovernanceDocument.title.ilike(f"%{q.strip()}%"))
    rows = query.order_by(GovernanceDocument.updated_at.desc()).limit(limit).all()
    return {"items": [{"id": d.id, "title": d.title, "code": d.document_code, "doc_type": d.doc_type, "status": d.status,
                       "version": d.current_version, "has_file": bool(d.file_path), "has_text": bool((d.content or "").strip()),
                       "may_edit": editors_only is None or can_edit(db, user, d)} for d in rows]}


@router.get("/frameworks", dependencies=[Depends(require_studio)])
def pick_frameworks(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Platform frameworks that can be used as a reference (parsed, active, this organisation's or shared)."""
    from ....models import ParsedFrameworkControl

    items = []
    for f, count in refs.available_frameworks(db):
        domains = [d for (d,) in db.query(ParsedFrameworkControl.domain).filter(ParsedFrameworkControl.uploaded_framework_id == f.id)
                   .distinct().order_by(ParsedFrameworkControl.domain).limit(60) if d]
        items.append({"id": f.id, "name": f.name, "version": f.version, "organisation": f.source_organization or f.regulatory_authority,
                      "controls": count, "domains": domains})
    return {"items": items}


# ── templates ────────────────────────────────────────────────────────────────
@router.get("/templates", dependencies=[Depends(require_studio)])
def list_templates(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return {"items": templates.listing(db)}



_DEFAULT_ADMIN_ONLY = "Only an administrator can make a template the organisation's default."


@router.post("/templates", dependencies=[Depends(require_studio)])
def save_template(body: TemplateIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Save a session's document (or the given text) as the organisation's own template. Making it the default for its type
    (every new document of that type starts from it) is for administrators."""
    if body.make_default and not _is_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_DEFAULT_ADMIN_ONLY)
    content, doc_type = body.content, body.doc_type
    if body.session_id:
        s = _session(db, body.session_id, user)
        content, doc_type = content or s.content, doc_type or s.doc_type
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="There is nothing to save as a template.")
    tenant = db.query(Tenant).first()
    if body.make_default:
        for other in db.query(StudioTemplate).filter(StudioTemplate.doc_type == (doc_type or "policy"), StudioTemplate.is_default.is_(True)):
            other.is_default = False
    row = StudioTemplate(tenant_id=tenant.id, name=body.name.strip()[:200], doc_type=doc_type or "policy", description=body.description,
                         content=content, structure=templates.derive_structure(content), is_default=body.make_default, created_by=user.id)
    db.add(row)
    db.commit()
    return templates.serialize(row)


@router.put("/templates/{template_id}", dependencies=[Depends(require_studio)])
def update_template(template_id: int, body: TemplateIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    row = db.get(StudioTemplate, template_id)
    if row is None or row.archived:
        raise HTTPException(status_code=404, detail="Template not found")
    if row.created_by != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the person who made this template or an administrator can change it.")
    if (body.make_default or row.is_default) and not _is_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_DEFAULT_ADMIN_ONLY)
    row.name = body.name.strip()[:200] or row.name
    if body.description is not None:
        row.description = body.description
    if body.content is not None and body.content.strip():
        row.content, row.structure = body.content, templates.derive_structure(body.content)
    if body.doc_type:
        row.doc_type = body.doc_type
    if body.make_default:
        for other in db.query(StudioTemplate).filter(StudioTemplate.doc_type == row.doc_type, StudioTemplate.id != row.id):
            other.is_default = False
    row.is_default = body.make_default
    db.commit()
    return templates.serialize(row)


@router.delete("/templates/{template_id}", dependencies=[Depends(require_studio)])
def delete_template(template_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    row = db.get(StudioTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if row.created_by != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the person who made this template or an administrator can remove it.")
    if row.is_default and not _is_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can remove the organisation's default template.")
    row.archived, row.is_default = True, False
    db.commit()
    return {"deleted": True}


# ── sessions ─────────────────────────────────────────────────────────────────
@router.get("/sessions", dependencies=[Depends(require_studio)])
def list_sessions(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    # work on a document archived in the library leaves the list with it (it cannot be removed here); it comes back if the document is restored
    rows = (db.query(StudioSession).outerjoin(GovernanceDocument, GovernanceDocument.id == StudioSession.document_id)
            .filter(StudioSession.created_by == user.id, StudioSession.status != "archived",
                    or_(StudioSession.document_id.is_(None), func.coalesce(GovernanceDocument.status, "") != "archived"))
            .order_by(StudioSession.updated_at.desc()).limit(100).all())
    return {"items": [service.session_view(db, s, content=False, user=user) for s in rows]}


@router.post("/sessions", dependencies=[Depends(require_studio)])
def create_session(body: SessionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    if body.kind not in ("new", "library"):
        raise HTTPException(status_code=400, detail="Use the upload route to open a file.")
    try:
        s = service.create_session(db, user, kind=body.kind, title=body.title, doc_type=body.doc_type, template_id=body.template_id,
                                   document_id=body.document_id, instructions=body.instructions,
                                   markdown=body.content if body.kind == "new" else None, template_name=body.template_name)
    except service.StudioError as exc:
        raise _problem(exc)
    return service.session_view(db, s, user=user)          # a new document waits for the person's request: nothing is written on its own


@router.post("/sessions/upload", dependencies=[Depends(require_studio)])
async def create_session_from_file(file: UploadFile = File(...), title: str = Form(""), doc_type: str = Form("policy"),
                                   classification: str = Form("internal"), description: Optional[str] = Form(None),
                                   owner_id: Optional[int] = Form(None), department_id: Optional[int] = Form(None),
                                   review_cycle_months: int = Form(12), effective_date: Optional[datetime] = Form(None),
                                   next_review_date: Optional[datetime] = Form(None), parent_document_id: Optional[int] = Form(None),
                                   db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """A file opened in the studio goes into the library at once, with the details the person confirmed (read from the file first:
    POST /governance/documents/read-details)."""
    from ..doc_details import check_details

    try:
        check_details(db, owner_id=owner_id, department_id=department_id, review_cycle_months=review_cycle_months,
                      parent_document_id=parent_document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    data = await file.read()
    details = {"classification": classification, "description": description, "owner_id": owner_id, "department_id": department_id,
               "review_cycle_months": review_cycle_months, "effective_date": effective_date, "next_review_date": next_review_date,
               "parent_document_id": parent_document_id}
    try:
        s = service.create_session(db, user, kind="upload", title=title, doc_type=doc_type, upload=(file.filename or "document", data), details=details)
    except service.StudioError as exc:
        raise _problem(exc)
    return service.session_view(db, s, user=user)


@router.get("/sessions/{session_id}", dependencies=[Depends(require_studio)])
def get_session(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return service.session_view(db, _session(db, session_id, user), user=user)     # reads only: the page says it was opened (POST …/opened)


@router.post("/sessions/{session_id}/opened", dependencies=[Depends(require_studio)])
def session_opened(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    _session(db, session_id, user).last_opened_at = service._now()
    db.commit()
    return {"ok": True}


@router.patch("/sessions/{session_id}", dependencies=[Depends(require_studio)])
def patch_session(session_id: int, body: SessionPatch, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    service.update_session(db, s, body.model_dump(exclude_none=True))
    return service.session_view(db, s, content=False, user=user)


@router.get("/sessions/{session_id}/setup", dependencies=[Depends(require_studio)])
def setup_options(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """What a new document can be set up with (the organisation's own departments, regulators, regulatory register and frameworks
    first, then the usual choices). The answers are saved as instructions (PATCH the session)."""
    from . import setup

    return setup.options(db, _session(db, session_id, user))


@router.delete("/sessions/{session_id}", dependencies=[Depends(require_studio)])
def delete_session(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    try:
        service.delete_session(db, _session(db, session_id, user), user)
    except service.StudioError as exc:
        raise _problem(exc)
    return {"deleted": True}


@router.put("/sessions/{session_id}/content", dependencies=[Depends(require_studio)])
def put_content(session_id: int, body: ContentIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    try:
        rev = service.save_content(db, s, body.content, user, base_revision=body.base_revision, summary=body.summary)
    except service.StudioError as exc:
        raise _problem(exc)
    return {"revision": s.revision_no, "saved": rev is not None, "words": sum(b.words for b in B.parse(s.content))}


# ── references ───────────────────────────────────────────────────────────────
@router.post("/sessions/{session_id}/references", dependencies=[Depends(require_studio)])
def add_reference(session_id: int, body: ReferenceIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    # a framework is attached once: the same choice again is refused while it is in use, another part of it (say controls about a
    # topic after setup attached all of it) becomes that reference's choice
    olds = (db.query(StudioReference).filter(StudioReference.session_id == s.id, StudioReference.kind == "framework",
                                             StudioReference.source_id == body.source_id).order_by(StudioReference.id).all()
            if body.kind == "framework" and body.source_id else [])
    included = {r.id: r.include for r in olds}
    try:
        ref = refs.attach(db, s, body.kind, source_id=body.source_id, scope=body.scope, template_id=body.template_id)
        if included.get(ref.id):
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This framework is already attached.")
        if olds and ref.id not in included:
            old = olds[0]
            for field in ("title", "source_label", "scope", "text", "char_count", "truncated"):
                setattr(old, field, getattr(ref, field))
            old.include = True
            db.delete(ref)
            ref = old
        db.commit()
    except refs.ReferenceProblem as exc:
        db.rollback()
        raise _problem(exc)
    return service.ref_view(ref)


@router.post("/sessions/{session_id}/references/upload", dependencies=[Depends(require_studio)])
async def add_reference_file(session_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    data = await file.read()
    if len(data) > service.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That file is too large.")
    try:
        ref = refs.attach(db, s, "upload", upload=(file.filename or "reference", data))
        db.commit()
    except refs.ReferenceProblem as exc:
        db.rollback()
        raise _problem(exc)
    return service.ref_view(ref)


@router.patch("/sessions/{session_id}/references/{ref_id}", dependencies=[Depends(require_studio)])
def toggle_reference(session_id: int, ref_id: int, include: bool = True, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    ref = db.get(StudioReference, ref_id)
    if ref is None or ref.session_id != s.id:
        raise HTTPException(status_code=404, detail="Reference not found")
    ref.include = include
    db.commit()
    return service.ref_view(ref)


@router.delete("/sessions/{session_id}/references/{ref_id}", dependencies=[Depends(require_studio)])
def remove_reference(session_id: int, ref_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    ref = db.get(StudioReference, ref_id)
    if ref is None or ref.session_id != s.id:
        raise HTTPException(status_code=404, detail="Reference not found")
    db.delete(ref)
    db.commit()
    return {"deleted": True}


@router.get("/sessions/{session_id}/references/{ref_id}", dependencies=[Depends(require_studio)])
def read_reference(session_id: int, ref_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The text the AI was given for a reference."""
    s = _session(db, session_id, user)
    ref = db.get(StudioReference, ref_id)
    if ref is None or ref.session_id != s.id:
        raise HTTPException(status_code=404, detail="Reference not found")
    return {**service.ref_view(ref), "text": ref.text}


# ── chat ─────────────────────────────────────────────────────────────────────
@router.get("/sessions/{session_id}/messages", dependencies=[Depends(require_studio)])
def list_messages(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    return {"items": service.messages(db, s)}


@router.get("/sessions/{session_id}/progress", dependencies=[Depends(require_studio)])
def turn_progress(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The state of the latest turns, small enough to ask for several times a second while the AI works (the live view of what it is doing)."""
    s = _session(db, session_id, user)
    return {"items": service.progress(db, s)}


@router.post("/sessions/{session_id}/messages", dependencies=[Depends(require_studio)])
def send_message(session_id: int, body: MessageIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    if not claude_client.configured():
        raise HTTPException(status_code=503, detail=str(claude_client.ClaudeNotConfigured()))
    try:
        msg = service.start_turn(db, s, user, body.text, reply_to=body.reply_to, answers=body.answers, decide=body.decide, attachments=body.attachments)
    except service.StudioError as exc:
        raise _problem(exc)
    jobs.launch(_slug(db), "chat", s.id, msg.id, user)
    return service.message_view(db.get(StudioMessage, msg.id))


@router.post("/sessions/{session_id}/draft", dependencies=[Depends(require_studio)])
def write_document(session_id: int, body: DraftIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Write the whole of a new policy, standard, procedure, guideline or charter: planned, then written section by section, then
    applied as the first draft. A message to poll, like a chat turn."""
    s = _session(db, session_id, user)
    if s.kind != "new" or s.doc_type not in templates.DOC_TYPES:
        raise HTTPException(status_code=400, detail="Only a new policy, standard, procedure, guideline or charter can be written from scratch.")
    if s.revision_no > 1 and not B.is_blank(B.parse(s.content)) and not body.rewrite:
        raise HTTPException(status_code=400, detail="This document has already been started. Ask in the chat for the changes you want, or choose to write it again.")
    if not claude_client.configured():
        raise HTTPException(status_code=503, detail=str(claude_client.ClaudeNotConfigured()))
    try:
        msg = service.start_turn(db, s, user, (body.brief or "").strip() or "Write the complete document.")
    except service.StudioError as exc:
        raise _problem(exc)
    jobs.launch(_slug(db), "draft", s.id, msg.id, user)
    return service.message_view(db.get(StudioMessage, msg.id))


@router.post("/sessions/{session_id}/messages/{message_id}/stop", dependencies=[Depends(require_studio)])
def stop_turn(session_id: int, message_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Stop Comply Agent where it is: nothing it was writing is applied. 409 when it has already finished."""
    s = _session(db, session_id, user)
    m = _message(db, s, message_id)
    if not service.stop_turn(db, m):
        raise HTTPException(status_code=409, detail="Comply Agent has already finished this.")
    return service.message_view(m)


@router.get("/sessions/{session_id}/messages/{message_id}/preview", dependencies=[Depends(require_studio)])
def draft_preview(session_id: int, message_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """A whole document as far as it is written, while Comply Agent writes it (empty once it is done: the document then has it)."""
    s = _session(db, session_id, user)
    m = _message(db, s, message_id)
    working = m.status == "working"
    return {"seq": (m.live or {}).get("preview_seq", 0) if working else 0, "markdown": (m.preview or "") if working else ""}


@router.get("/sessions/{session_id}/messages/{message_id}", dependencies=[Depends(require_studio)])
def get_message(session_id: int, message_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    service.reap(db, s)
    return service.message_view(_message(db, s, message_id))


def _pending_ids(m: StudioMessage) -> List[str]:
    return [o["id"] for o in (m.proposal or {}).get("ops", []) if o.get("status") == "pending"]


@router.post("/sessions/{session_id}/messages/{message_id}/accept", dependencies=[Depends(require_studio)])
def accept_changes(session_id: int, message_id: int, body: OpsIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    m = _message(db, s, message_id)
    result = service.accept_ops(db, s, m, body.op_ids or _pending_ids(m), user.id, overrides=body.overrides)
    # an accept stays in the studio: only Save to the library writes the library (the user, 2026-10-21); the key stays for older screens
    return {**result, "revision": s.revision_no, "content": s.content, "message": service.message_view(m), "library_version": None}


@router.post("/sessions/{session_id}/messages/{message_id}/reject", dependencies=[Depends(require_studio)])
def reject_changes(session_id: int, message_id: int, body: OpsIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    m = _message(db, s, message_id)
    service.reject_ops(db, m, body.op_ids or _pending_ids(m))
    return {"message": service.message_view(m)}


@router.get("/sessions/{session_id}/messages/{message_id}/redline", dependencies=[Depends(require_studio)])
def preview_changes(session_id: int, message_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    return service.pending_redline(db, s, _message(db, s, message_id))


@router.post("/sessions/{session_id}/messages/{message_id}/ops/{op_id}/revert", dependencies=[Depends(require_studio)])
def revert_accepted_change(session_id: int, message_id: int, op_id: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Take a change that was accepted back out of the document (a new revision; refused with 409 when its text was edited since)."""
    s = _session(db, session_id, user)
    m = _message(db, s, message_id)
    try:
        result = service.revert_op(db, s, m, op_id, user.id)
    except service.StudioError as exc:
        db.rollback()
        raise _problem(exc)
    return {**result, "message": service.message_view(m)}


# ── checks ───────────────────────────────────────────────────────────────────
def _check_context(db: Session, s: StudioSession) -> Dict[str, Any]:
    from ....models import StudioAsset

    ins = s.instructions or {}
    logo_ok = bool(ins.get("logo_asset_id") and db.get(StudioAsset, ins["logo_asset_id"]))
    # the required sections are those of the template the document was started from: an uploaded or library document has its own
    return {"structure": templates.structure_for(db, s.doc_type, s.template_id, s) if s.template_id else None,
            "instructions": ins, "title": s.title, "logo_ok": logo_ok}


@router.post("/sessions/{session_id}/checks", dependencies=[Depends(require_studio)])
def run_checks(session_id: int, ai: bool = False, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The checks that need no AI, now. With ``ai=true`` the language and requirement check is started too (a message to poll)."""
    s = _session(db, session_id, user)
    ctx = _check_context(db, s)
    issues = checks.run_deterministic(s.content, structure=ctx["structure"], instructions=ctx["instructions"], title=ctx["title"], logo_ok=ctx["logo_ok"])
    out: Dict[str, Any] = {"revision": s.revision_no, "issues": issues, "summary": checks.summary(issues)}
    if ai:
        if not claude_client.configured():
            raise HTTPException(status_code=503, detail=str(claude_client.ClaudeNotConfigured()))
        try:
            msg = service.start_task(db, s, user, "checks")
        except service.StudioError as exc:
            raise _problem(exc)
        jobs.launch(_slug(db), "checks", s.id, msg.id, user)
        out["ai_message"] = service.message_view(db.get(StudioMessage, msg.id))
    return out


@router.get("/sessions/{session_id}/checks/ai", dependencies=[Depends(require_studio)])
def last_ai_check(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The latest finished AI check, and whether the document has changed since."""
    s = _session(db, session_id, user)
    m = _last_ai_check(db, s)
    if m is None:
        return {"message": None}
    return {"message": service.message_view(m), "stale": (m.proposal or {}).get("revision") != s.revision_no}


def _last_ai_check(db: Session, s: StudioSession) -> Optional[StudioMessage]:
    return (db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.kind == "checks", StudioMessage.status == "done")
            .order_by(StudioMessage.id.desc()).first())


@router.post("/sessions/{session_id}/checks/fix", dependencies=[Depends(require_studio)])
def apply_one_fix(session_id: int, body: FixIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    new = checks.apply_fix(s.content, body.fix)
    if new is None:
        raise HTTPException(status_code=409, detail="The text has changed since the check ran. Run the check again.")
    service.add_revision(db, s, new, author_type="user", user_id=user.id, summary=f"Fixed: {body.message}" if body.message else "Applied a suggested fix")
    db.commit()
    return {"revision": s.revision_no, "content": s.content}


_SIMPLE_FIXES = ("replace", "set_level", "normalize_space", "strip_trailing_punct")


@router.post("/sessions/{session_id}/checks/fix-all", dependencies=[Depends(require_studio)])
def apply_all_fixes(session_id: int, body: FixAllIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Every simple fix (spacing, repeated words, heading levels ...) the checks offer, in one revision. Fixes that add or move
    sections are left for the person, unless ``all``: then every fix offered is applied in one revision ("Apply all"), the
    suggestions of Comply Agent's last check too when it read this very text, and ``skipped`` counts those that no longer fit."""
    s = _session(db, session_id, user)
    ctx = _check_context(db, s)
    issues = checks.run_deterministic(s.content, structure=ctx["structure"], instructions=ctx["instructions"], title=ctx["title"], logo_ok=ctx["logo_ok"])
    if body.all:
        wanted = lambda i: bool(i.get("fix")) and (not body.kinds or i.get("kind") in body.kinds)       # noqa: E731
        fixes: List[Dict[str, Any]] = []
        ai = _last_ai_check(db, s)
        if ai is not None and (ai.proposal or {}).get("revision") == s.revision_no:
            fixes += [i["fix"] for i in (ai.proposal or {}).get("issues") or [] if wanted(i)]
        fixes += [i["fix"] for i in issues if wanted(i)]
        content, done, skipped = checks.apply_fixes(s.content, fixes)
        if done:
            service.add_revision(db, s, content, author_type="user", user_id=user.id, summary=f"Applied {done} suggested fix{'' if done == 1 else 'es'}")
            db.commit()
        return {"fixed": done, "skipped": skipped, "revision": s.revision_no, "content": s.content}
    content, done = s.content, 0
    for issue in issues:
        fix = issue.get("fix")
        if not fix or fix.get("type") not in _SIMPLE_FIXES or (body.kinds and issue["kind"] not in body.kinds):
            continue
        new = checks.apply_fix(content, fix)
        if new is not None:
            content, done = new, done + 1
    if done:
        service.add_revision(db, s, content, author_type="user", user_id=user.id, summary=f"Applied {done} suggested fix(es)")
        db.commit()
    return {"fixed": done, "revision": s.revision_no, "content": s.content}


# ── history and compare ──────────────────────────────────────────────────────
@router.get("/sessions/{session_id}/revisions", dependencies=[Depends(require_studio)])
def list_revisions(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    return {"items": service.revisions(db, s), "base_label": s.base_label}


@router.get("/sessions/{session_id}/tracked", dependencies=[Depends(require_studio)])
def get_tracked(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Tracked changes: since the version in force, or the original when the document was never published (``service.tracked``)."""
    s = _session(db, session_id, user)
    try:
        return service.tracked(db, s, user)
    except service.StudioError as exc:
        raise _problem(exc)


@router.get("/sessions/{session_id}/diff", dependencies=[Depends(require_studio)])
def get_diff(session_id: int, frm: int = Query(0, alias="from"), to: Optional[int] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The redline between two revisions; ``from=0`` is the baseline the session started from, ``to`` defaults to the latest."""
    s = _session(db, session_id, user)
    try:
        return service.diff(db, s, frm, to if to is not None else s.revision_no)
    except service.StudioError as exc:
        raise _problem(exc)


class RevertChangesIn(BaseModel):
    frm: int = 0                                   # the revision the changes are counted from (0 = where the session started)
    hunks: List[int]                               # the changes to take back, by the ids the diff gave them
    hash: Optional[str] = None                     # the diff's fingerprint of the document: a change made meanwhile is refused
    version_id: Optional[int] = None               # counted from this library version instead (Tracked changes, GET …/tracked)


@router.post("/sessions/{session_id}/changes/revert", dependencies=[Depends(require_studio)])
def revert_changes(session_id: int, body: RevertChangesIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Take chosen changes since a revision back out of the document as it is now (a new revision)."""
    s = _session(db, session_id, user)
    try:
        return service.revert_changes(db, s, body.frm, body.hunks, user, content_hash=body.hash, version_id=body.version_id)
    except service.StudioError as exc:
        db.rollback()
        raise _problem(exc)


@router.post("/sessions/{session_id}/restore/{number}", dependencies=[Depends(require_studio)])
def restore_revision(session_id: int, number: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    try:
        service.restore(db, s, number, user)
    except service.StudioError as exc:
        raise _problem(exc)
    return {"revision": s.revision_no, "content": s.content}


@router.post("/sessions/{session_id}/compare", dependencies=[Depends(require_studio)])
def compare(session_id: int, body: CompareIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Compare the working document with a library document, an earlier revision or an attached reference (an uploaded file): the
    redline now, and with ``ai`` an explanation of what matters in the differences (a message to poll)."""
    s = _session(db, session_id, user)
    if body.reference_id:
        ref = db.get(StudioReference, body.reference_id)
        if ref is None or ref.session_id != s.id:
            raise HTTPException(status_code=404, detail="Reference not found")
        other, title = ref.text, ref.title
    elif body.document_id:
        doc = db.get(GovernanceDocument, body.document_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")
        try:
            other, _, _ = refs.library_text(db, doc, user)        # refused unless the person may read it; as they read it
        except refs.ReferenceProblem as exc:
            raise _problem(exc)
        title = doc.title
    elif body.revision is not None:
        try:
            other, title = service.revision_content(db, s, body.revision), f"Revision {body.revision}"
        except service.StudioError as exc:
            raise _problem(exc)
    else:
        raise HTTPException(status_code=400, detail="Choose a document, a file or a revision to compare with.")
    other_blocks, mine = B.parse(other), B.parse(s.content)
    out: Dict[str, Any] = {"other_title": title, "rows": B.redline(other_blocks, mine), "stats": B.stats(other_blocks, mine)}
    if body.ai:
        if not claude_client.configured():
            raise HTTPException(status_code=503, detail=str(claude_client.ClaudeNotConfigured()))
        try:
            msg = service.start_task(db, s, user, "compare")
        except service.StudioError as exc:
            raise _problem(exc)
        jobs.launch(_slug(db), "compare", s.id, msg.id, user, {"title": title, "markdown": other})
        out["ai_message"] = service.message_view(db.get(StudioMessage, msg.id))
    return out


# ── library ──────────────────────────────────────────────────────────────────
@router.post("/sessions/{session_id}/move-to-library", dependencies=[Depends(require_studio)])
def move_to_library(session_id: int, body: MoveIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from ..doc_details import check_details

    s = _session(db, session_id, user)
    try:
        check_details(db, owner_id=body.owner_id, department_id=body.department_id, review_cycle_months=body.review_cycle_months)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        doc = service.move_to_library(db, s, user, title=body.title, doc_type=body.doc_type, classification=body.classification,
                                      parent_document_id=body.parent_document_id, framework_ids=body.framework_ids,
                                      change_type=body.change_type, **body.details())
    except service.StudioError as exc:
        raise _problem(exc)
    return {"document_id": doc.id, "title": doc.title, "version": doc.current_version}


@router.post("/sessions/{session_id}/save-to-document", dependencies=[Depends(require_studio)])
def save_to_document(session_id: int, body: SaveIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    s = _session(db, session_id, user)
    try:
        doc = service.save_to_document(db, s, user, change_reason=body.change_reason, force=body.force, change_type=body.change_type)
    except service.StudioError as exc:
        raise _problem(exc)
    row = service._version_row(db, doc, doc.current_version)
    # in_place: always false now that every save makes its own version (kept for older screens)
    return {"document_id": doc.id, "version": doc.current_version, "status": doc.status, "change": row.change_type if row is not None else None,
            "in_place": False}


# ── logos ────────────────────────────────────────────────────────────────────
def _asset(db: Session, asset_id: int):
    a = db.get(StudioAsset, asset_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Logo not found")
    return a


def _may_manage(db: Session, a, user: GRCUser) -> bool:
    """The person who uploaded a logo, and the organisation's administrators, may change or remove it."""
    return a.created_by == user.id or _is_admin(db, user)


@router.get("/assets", dependencies=[Depends(require_studio)])
def list_assets(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return {"items": assets.listing(db)}


@router.post("/assets", dependencies=[Depends(require_studio)])
async def upload_asset(file: UploadFile = File(...), name: str = Form(""), make_default: bool = Form(False),
                       db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    data = await file.read(assets.MAX_LOGO_BYTES + 1)
    try:
        return assets.view(assets.add(db, user, file.filename or "", data, name=name or None, make_default=make_default))
    except service.StudioError as exc:
        raise _problem(exc)


@router.get("/assets/{asset_id}/file", dependencies=[Depends(require_studio)])
def asset_file(asset_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a = _asset(db, asset_id)
    path = assets.path_of(a)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The logo file is missing")
    return FileResponse(path, media_type=a.mime, headers={"Cache-Control": "private, max-age=300"})


@router.put("/assets/{asset_id}", dependencies=[Depends(require_studio)])
def update_asset(asset_id: int, body: AssetIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a = _asset(db, asset_id)
    if not _may_manage(db, a, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the person who uploaded this logo or an administrator can change it")
    return assets.view(assets.update(db, a, name=body.name, is_default=body.is_default))


@router.delete("/assets/{asset_id}", dependencies=[Depends(require_studio)])
def delete_asset(asset_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a = _asset(db, asset_id)
    if not _may_manage(db, a, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the person who uploaded this logo or an administrator can remove it")
    assets.remove(db, a)
    return {"ok": True}


# ── export ───────────────────────────────────────────────────────────────────
def _pending_count(db: Session, s: StudioSession) -> int:
    rows = db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.kind == "chat", StudioMessage.status == "done").all()
    return sum(len(_pending_ids(m)) for m in rows)


@router.post("/sessions/{session_id}/export/check", dependencies=[Depends(require_studio)])
def export_check(session_id: int, body: ExportIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """What to know before exporting: placeholders left, a missing entity name or logo, AI changes not yet accepted."""
    s = _session(db, session_id, user)
    fmt = _export_format(body.format)
    settings = service.export_settings(db, s, body.overrides())
    # a Word file that came from Word is tried now, so the person knows before downloading whether its formatting can be kept
    _, notes = service.export_file(db, s, fmt, settings, highlight=body.highlight_placeholders, pending=_pending_count(db, s),
                                   build=fmt == "docx" and service.is_word_in_place(s))
    return {"format": fmt, "notes": notes, "can_export": not any(n["level"] == "error" for n in notes)}


@router.post("/sessions/{session_id}/export", dependencies=[Depends(require_studio)])
def export_document(session_id: int, body: ExportIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The working document as a Word, PDF, Markdown or HTML file."""
    s = _session(db, session_id, user)
    fmt = _export_format(body.format)
    settings = service.export_settings(db, s, body.overrides())
    try:
        data, notes = service.export_file(db, s, fmt, settings, highlight=body.highlight_placeholders)
    except exporters.ExportProblem as exc:
        raise _problem(exc)
    errors = [n["text"] for n in notes if n["level"] == "error"]
    if errors:
        raise HTTPException(status_code=400, detail=errors[0])
    mime, _ext = exporters.FORMATS[fmt]
    name = service.export_name(s, fmt, settings["version"])
    ascii_name = name.encode("ascii", "ignore").decode() or f"document.{fmt}"
    return Response(content=data, media_type=mime, headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}", "Cache-Control": "no-store"})


@router.get("/sessions/{session_id}/layout", dependencies=[Depends(require_studio)])
def session_layout(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """How Word sets out each block of a Word file edited in place - the number in front of it, its indent, a heading that looks
    like body text, its font, size, colour and spacing - and the page (width, margins, normal text), so the editor shows the
    document as Word does. No blocks and no page for any other document."""
    s = _session(db, session_id, user)
    return {"revision": s.revision_no, "blocks": service.word_looks(s), "page": service.word_page(s)}


@router.get("/sessions/{session_id}/source-file", dependencies=[Depends(require_studio)])
def session_source_file(session_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The PDF the document was read from, as it is (a PDF cannot be edited, so it does not hold the changes)."""
    path = service.source_pdf(_session(db, session_id, user))
    if not path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This document was not read from a PDF.")
    return FileResponse(path, media_type="application/pdf", headers={"Cache-Control": "no-store"})


def _export_format(value: str) -> str:
    fmt = (value or "docx").lower().lstrip(".")
    if fmt not in exporters.FORMATS:
        raise HTTPException(status_code=400, detail="Choose Word, PDF, Markdown or HTML.")
    return fmt
