"""A document's approval record (approval_record.py) over HTTP, and the document control pages it makes (approval_record_export.py,
controlled_copy.py): the record as JSON, the pages on their own as a PDF or Word document, the document's text with the places for them
(``controlled-content``), and the document's own file - or the PDF of its text - with the pages inside it, after its cover or where
its sections are (``documents.export_document`` and ``download_document_file`` with ``with_record``).
Any organisation: it needs nothing switched on, as the sign-off itself does not. Reading only; whoever may read the document may read
its record, and someone who reads the version in force instead of the newest gets that version's (never a newer round).
"""
import logging
import os
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import ElectronicSignature, GovernanceDocument, GovernanceDocumentVersion, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import approval_record, approval_record_export as X, controlled_copy, permissions
from ..permissions import require_doc_reader
from .document_signoff import _doc_or_404

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Governance - Approval record"])
SEPARATE = {"X-Approval-Record": "separate"}          # the file is served as it is: its record is a file of its own
COMPOSED = "X-Controlled-Copy"                        # "true": the file has the control pages in it; "false": it is the file as it is


def signature_images(db: Session, record: dict) -> Dict[int, bytes]:
    """The drawn signatures a record names, by e-signature id (a signature with no ink is left out)."""
    ids = [p["signature"]["id"] for stage in record["stages"] for p in stage["people"] if p.get("signature")]
    if not ids:
        return {}
    return {i: bytes(png) for i, png in db.query(ElectronicSignature.id, ElectronicSignature.image_png).filter(ElectronicSignature.id.in_(ids)) if png}


@router.get("/{document_id}/approval-record", dependencies=[Depends(require_doc_reader)])
def get_approval_record(document_id: int, version: Optional[str] = None, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    """Who reviewed and approved the document's newest version (or ``version``; the one in force for someone who reads that one), in
    which stages, when and with which drawn signature, and the workflow from draft to publication. Derived on every read."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    return approval_record.build(db, doc, version=version, viewer=current_user)


def _file_of(src) -> bool:
    return bool(src is not None and src.file_path and os.path.exists(src.file_path))


def _text_source(db: Session, user: GRCUser, doc: GovernanceDocument, number: str):
    """What the version being read is made of: the document itself while it is the newest version it is read as, else the row of
    that version (the earliest one that holds a text or a file, never one a take-back marked reverted); None when there is none."""
    forced = permissions.version_for(db, user, doc)
    if forced is not None and forced.version_number == number:
        return forced
    if forced is None and number == (doc.current_version or "1.0"):
        return doc
    V = GovernanceDocumentVersion
    rows = (db.query(V).filter(V.document_id == doc.id, V.version_number == number, func.coalesce(V.status, "") != "reverted")
            .order_by(V.id).all())
    return next((r for r in rows if r.content or r.file_path), rows[0] if rows else None)


@router.get("/{document_id}/controlled-content", dependencies=[Depends(require_doc_reader)])
def get_controlled_content(document_id: int, version: Optional[str] = None, db: Session = Depends(get_db),
                           current_user: GRCUser = Depends(require_auth)):
    """The document's text with the places of its control pages, and the record they are drawn from. ``kind``: "markdown" for a
    document the platform holds the text of (no file): ``segments`` are its text and the places (controlled_copy.segments); "file" for
    a document that is a file (a Word file, a PDF: the file with the pages in it is ``download-file?with_record=true``), then
    ``segments`` is null. The record is the newest version's, or ``version``'s - the one in force for someone who reads that one."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    record = approval_record.build(db, doc, version=version, viewer=current_user)
    src = _text_source(db, current_user, doc, record["document"]["version"])
    text = src.content if src is not None and not _file_of(src) and src.content else None
    return {"kind": "markdown" if text else "file", "segments": controlled_copy.segments(text) if text else None, "record": record}


@router.get("/{document_id}/approval-record/export", dependencies=[Depends(require_doc_reader)])
def export_approval_record(document_id: int, format: str = "pdf", version: Optional[str] = None, db: Session = Depends(get_db),
                           current_user: GRCUser = Depends(require_auth)):
    """The control pages on their own as a document: ``pdf`` (default) or ``docx``, A4, with the drawn signatures as pictures."""
    fmt = (format or "pdf").lower()
    if fmt not in ("pdf", "docx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose pdf or docx.")
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    record = approval_record.build(db, doc, version=version, viewer=current_user)
    images = signature_images(db, record)
    data = X.to_pdf(record, images) if fmt == "pdf" else X.to_docx(record, images)
    return Response(content=data, media_type=X.MIME[fmt],
                    headers={"Content-Disposition": X.content_disposition(f"{X.stem(record)}-approval-record.{fmt}")})


def _with_suffix(name: str) -> str:
    stem, ext = os.path.splitext(name)
    return f"{stem}-with-approval-record{ext}"


def compose_file(db: Session, user: GRCUser, document: GovernanceDocument, src, *, version: Optional[str] = None) -> Optional[bytes]:
    """The uploaded file of ``src`` (the document, or the version row in force for ``user``, or the one of ``version``) with the
    control pages inside it: after the cover of a Word file or a PDF, else after its content. None for any other kind of file, and for
    one that cannot be read or is protected (the caller serves it as it is). The stored file is never modified."""
    kind = (src.file_type or os.path.splitext(src.file_path)[1].lstrip(".")).lower()
    if kind not in ("docx", "pdf"):
        return None
    try:
        record = approval_record.build(db, document, version=version, viewer=user)
        with open(src.file_path, "rb") as fh:
            original = fh.read()
        return (X.place_in_docx if kind == "docx" else X.place_in_pdf)(original, record, signature_images(db, record))
    except HTTPException:
        raise
    except Exception:       # noqa: BLE001 - a file that cannot be extended is still served, as it is
        logger.warning("document control pages: could not put them in the file of document %s", document.id, exc_info=True)
        return None


def file_with_record(db: Session, user: GRCUser, document: GovernanceDocument, src, media_types: Dict[str, str]):
    """``export?with_record=true`` of an uploaded file: the file with the control pages in it. Any other kind of file, or one that
    cannot be read, is served as it is with the header ``X-Approval-Record: separate`` (the pages are then a file of their own)."""
    name = src.file_name or f"document_{document.id}"
    kind = (src.file_type or os.path.splitext(src.file_path)[1].lstrip(".")).lower()
    data = compose_file(db, user, document, src)
    if data is not None:
        return Response(content=data, media_type=media_types[kind], headers={"Content-Disposition": X.content_disposition(_with_suffix(name))})
    return FileResponse(path=src.file_path, filename=name, media_type=media_types.get(src.file_type, "application/octet-stream"), headers=SEPARATE)


def download_with_record(db: Session, user: GRCUser, document: GovernanceDocument, src, media_types: Dict[str, str], *,
                         version: Optional[str] = None, fallback: str):
    """``download-file?with_record=true``: the file of ``src`` with the control pages in it (a Word file, a PDF; ``X-Controlled-Copy:
    true``), else the file as it is (``false``). ``version``: the version whose pages they are (the file of an older version)."""
    name = src.file_name or fallback
    kind = (src.file_type or os.path.splitext(src.file_path)[1].lstrip(".")).lower()
    data = compose_file(db, user, document, src, version=version)
    if data is not None:
        return Response(content=data, media_type=media_types[kind],
                        headers={"Content-Disposition": X.content_disposition(name), COMPOSED: "true"})
    return FileResponse(path=src.file_path, filename=name, media_type=media_types.get(src.file_type, "application/octet-stream"),
                        headers={COMPOSED: "false"})


def pdf_with_record(db: Session, user: GRCUser, document: GovernanceDocument, markdown: str, title: str) -> Optional[bytes]:
    """A content-only document's PDF with its control pages in the places of its sections (controlled_copy.pdf); None when it could
    not be made (the caller then serves the PDF as it is, with its pages apart)."""
    try:
        record = approval_record.build(db, document, viewer=user)
        return controlled_copy.pdf(markdown, record, signature_images(db, record), title=title)
    except Exception:       # noqa: BLE001
        logger.warning("document control pages: could not put them in the PDF of document %s", document.id, exc_info=True)
        return None
