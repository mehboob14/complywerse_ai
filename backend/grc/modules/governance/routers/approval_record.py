"""A document's approval record (approval_record.py) over HTTP, and the file that carries it: the record as JSON, on its own as a PDF
or Word document, and added after a document's own file when it is exported (``documents.export_document`` with ``with_record``).
Any organisation: it needs nothing switched on, as the sign-off itself does not. Reading only; whoever may read the document may read
its record, and someone who reads the version in force instead of the newest gets that version's (never a newer round).
"""
import logging
import os
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ....models import ElectronicSignature, GovernanceDocument, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import approval_record, approval_record_export as X
from ..permissions import require_doc_reader
from .document_signoff import _doc_or_404

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Governance - Approval record"])
SEPARATE = {"X-Approval-Record": "separate"}          # the file is served as it is: its record is a file of its own


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


@router.get("/{document_id}/approval-record/export", dependencies=[Depends(require_doc_reader)])
def export_approval_record(document_id: int, format: str = "pdf", version: Optional[str] = None, db: Session = Depends(get_db),
                           current_user: GRCUser = Depends(require_auth)):
    """The record on its own as a document: ``pdf`` (default) or ``docx``, A4, with the drawn signatures as pictures."""
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


def file_with_record(db: Session, user: GRCUser, document: GovernanceDocument, src, media_types: Dict[str, str]):
    """The uploaded file of ``src`` (the document, or the version row in force for ``user``) with the approval record added after its
    own pages: a Word file or a PDF. Any other kind of file, or one that cannot be read, is served unchanged with the header
    ``X-Approval-Record: separate`` (the record is then a file of its own). The stored file is never modified."""
    name = src.file_name or f"document_{document.id}"
    kind = (src.file_type or os.path.splitext(src.file_path)[1].lstrip(".")).lower()
    if kind in ("docx", "pdf"):
        try:
            record = approval_record.build(db, document, viewer=user)
            with open(src.file_path, "rb") as fh:
                original = fh.read()
            merge = X.append_to_docx if kind == "docx" else X.append_to_pdf
            data = merge(original, record, signature_images(db, record))
            return Response(content=data, media_type=media_types[kind], headers={"Content-Disposition": X.content_disposition(_with_suffix(name))})
        except Exception:       # noqa: BLE001 - a file that cannot be extended is still served, with its record apart
            logger.warning("approval record: could not add it to the file of document %s", document.id, exc_info=True)
    return FileResponse(path=src.file_path, filename=name, media_type=media_types.get(src.file_type, "application/octet-stream"), headers=SEPARATE)


def pdf_with_record(db: Session, user: GRCUser, document: GovernanceDocument, pdf: bytes) -> Optional[bytes]:
    """A content-only document's PDF with the approval record on new pages after it; None when the record could not be added (the
    caller then serves the PDF as it is, with its record apart)."""
    try:
        record = approval_record.build(db, document, viewer=user)
        return X.append_to_pdf(pdf, record, signature_images(db, record))
    except Exception:       # noqa: BLE001
        logger.warning("approval record: could not add it to the PDF of document %s", document.id, exc_info=True)
        return None
