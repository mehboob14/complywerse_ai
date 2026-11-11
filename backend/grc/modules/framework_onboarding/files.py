"""The documents an onboarding answer can carry: the existing Statement of Applicability, the last audit report, a scope letter.

They are kept in the central Evidence library (``uploads/evidence/{tenant}/``, one ``grc_evidence`` row each, marked with ``SOURCE``), so the same file can
back a control later, and an answer holds only ``{id, name}`` of each. Uploading is optional everywhere: a ``files`` field is never required. Taking a file
off an answer leaves it in Evidence (it may be in use there); it is deleted from the Evidence page.
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...models import Evidence, GRCUser

SOURCE = "Framework onboarding"
MAX_BYTES = 25 * 1024 * 1024
MAX_PER_FIELD = 3


def known(db: Session, tenant_id: int) -> Dict[int, str]:
    """Every document uploaded here by this tenant: id -> file name (what an answer may point at)."""
    rows = db.query(Evidence.id, Evidence.file_name, Evidence.name).filter(Evidence.tenant_id == tenant_id, Evidence.source_system == SOURCE).all()
    return {i: (file_name or name or "File") for i, file_name, name in rows}


async def save(db: Session, tenant_id: int, user: GRCUser, file: UploadFile) -> Dict[str, Any]:
    """Store one uploaded file and return ``{id, name}``. The caller puts it on an answer."""
    from ..evidence.routers.evidence import ALLOWED_FILE_TYPES, EVIDENCE_UPLOAD_DIR     # late: the evidence router is heavy

    name = os.path.basename((file.filename or "").replace("\\", "/")).strip() or "File"
    ext = os.path.splitext(name)[1].lower()
    if ext[1:] not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=400, detail={"message": "That file type is not accepted. Use a PDF, Word, Excel, image or text file."})
    data = await file.read(MAX_BYTES + 1)           # bounded: never an unbounded file in memory
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail={"message": f"The file is over {MAX_BYTES // (1024 * 1024)} MB."})
    if not data:
        raise HTTPException(status_code=400, detail={"message": "The file is empty."})
    folder = os.path.join(EVIDENCE_UPLOAD_DIR, str(tenant_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4()}{ext}")
    with open(path, "wb") as fh:
        fh.write(data)
    ev = Evidence(tenant_id=tenant_id, name=name[:255], file_path=path, file_name=name[:255], file_type=(file.content_type or None),
                  evidence_type="document", source_system=SOURCE, uploaded_by=user.id, status="draft", ocr_status="not_applicable")
    db.add(ev)
    db.commit()
    return {"id": ev.id, "name": ev.file_name}


def find(db: Session, tenant_id: int, evidence_id: int) -> Evidence:
    """The file to send back: only a document uploaded here, of this tenant, still on disk."""
    ev = db.query(Evidence).filter(Evidence.id == evidence_id, Evidence.tenant_id == tenant_id, Evidence.source_system == SOURCE).first()
    if ev is None or not ev.file_path or not os.path.isfile(ev.file_path):
        raise HTTPException(status_code=404, detail={"message": "The file is not available."})
    return ev
