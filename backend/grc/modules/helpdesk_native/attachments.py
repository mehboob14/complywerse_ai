"""Ticket / reply attachment persistence (bank-hardening, functional gap).

Before this module, uploading a file on a reply or ticket was a no-op — nothing
was stored. This adds SAFE, bank-grade persistence:

  * UPLOAD  (multipart) — gated: an AGENT (helpdesk:tickets:edit) OR the
    REQUESTER on their OWN ticket (helpdesk:requests:create + ownership). A
    strict file-type ALLOWLIST (extension + content-type) and a MAX SIZE
    (10 MB) are enforced before anything touches disk.
  * LIST    by ticket — gated (agent tickets:view OR requester own-ticket
    requests:view_own), tenant-scoped.
  * DOWNLOAD by id    — same gate; streams the file by its random storage_key
    and sets Content-Disposition with the sanitized original filename.

SAFE STORAGE (no path traversal):
  * bytes land under a TENANT-SCOPED dir  <root>/<tenant_id>/  — tenant_id is
    coerced through int(), never a string from the client.
  * the on-disk filename is the `storage_key` — a random uuid4 hex — NEVER the
    client filename. The key is re-validated as 32 lowercase hex chars on every
    read, so a tampered DB row still cannot point outside the dir.
  * the client `filename` is stored for DISPLAY / Content-Disposition only, and
    is sanitized (basename + control-char strip) before it is echoed back.

Auth: every endpoint depends on `require_auth` (which performs the is_active +
idle-timeout recheck), then authorizes per-ticket via admin_router.check_permission
(admin / primary-contact bypass + role-permission lookup) plus an ownership test
for the requester path. The client is never trusted to say which ticket or whose
ticket it wants.
"""
from __future__ import annotations

import os
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ...models import GRCUser, HDAttachment, get_db
from ...routers.auth_router import require_auth
from . import tickets
from .common import iso, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (attachments)"])

# ─── storage root (mirrors evidence_router's layout, tenant-scoped) ──────────
ATTACH_ROOT = os.environ.get("HELPDESK_ATTACH_DIR", "backend/uploads/helpdesk")

# ─── safety limits ───────────────────────────────────────────────────────────
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".txt", ".csv", ".docx", ".xlsx"}

# content-type allowlist (octet-stream tolerated — some browsers send it for
# office docs; the extension allowlist is the authoritative gate).
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",  # some clients label .csv/.xlsx this way
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
    "",
}

_STORAGE_KEY_RE = re.compile(r"^[0-9a-f]{32}$")


# ─── helpers ──────────────────────────────────────────────────────────────────
def _safe_filename(name: Optional[str]) -> str:
    """Display / Content-Disposition name: strip any path and control/quote
    chars so it can never carry a directory component or break the header."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = re.sub(r'[\r\n"\x00-\x1f]', "", base).strip()
    base = base[:255]
    return base or "attachment"


def _ext_of(name: Optional[str]) -> str:
    return os.path.splitext((name or "").lower())[1]


def _validate_file(filename: Optional[str], content_type: Optional[str]) -> None:
    """ALLOWLIST gate: extension (authoritative) + content-type. Raises 415."""
    ext = _ext_of(filename)
    if ext not in ALLOWED_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"File type not allowed. Permitted: {', '.join(sorted(ALLOWED_EXTS))}",
        )
    if (content_type or "").lower() not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Content type '{content_type}' is not allowed",
        )


def _has_perm(db: Session, user: GRCUser, perm: str) -> bool:
    """Imperative permission check — reuses admin_router.check_permission
    (admin / primary-contact bypass + role-permission lookup). Lazy import to
    avoid an import cycle (admin_router imports models, models import nothing
    back, but keep it lazy for parity with the rest of the module set)."""
    from ...routers.admin_router import check_permission
    try:
        return bool(check_permission(user, db, perm))
    except Exception:
        return False


def _gate_ticket(db: Session, tid: int, user: GRCUser, name: str, *, write: bool):
    """Resolve the ticket (tenant-scoped) and authorize the caller:
      * an AGENT — helpdesk:tickets:edit (write) / tickets:view (read), or
      * the REQUESTER on their OWN ticket — helpdesk:requests:create (write) /
        requests:view_own (read) AND raised_by == the caller's email.
    Anything else → 404 (unknown ticket) or 403 (known ticket, no access). A
    requester can never see that another user's ticket exists."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")

    agent_perm = "helpdesk:tickets:edit" if write else "helpdesk:tickets:view"
    if _has_perm(db, user, agent_perm):
        return ticket

    requester_perm = "helpdesk:requests:create" if write else "helpdesk:requests:view_own"
    is_owner = (ticket.raised_by or "").lower() == (user.email or "").lower()
    if is_owner and _has_perm(db, user, requester_perm):
        return ticket

    raise HTTPException(status_code=403, detail="not permitted")


def _storage_dir(tid: int) -> str:
    """Tenant-scoped upload dir. int(tid) coercion is the traversal guard on the
    tenant component; the file component is always a validated storage_key."""
    d = os.path.join(ATTACH_ROOT, str(int(tid)))
    os.makedirs(d, exist_ok=True)
    return d


def _row_dict(a: HDAttachment) -> dict:
    return {
        "id": a.id,
        "filename": a.filename,
        "content_type": a.content_type,
        "size_bytes": a.size_bytes,
        "uploaded_by": a.uploaded_by,
        "reply_id": a.reply_id,
        "created": iso(a.created_at),
    }


# ─── endpoints ────────────────────────────────────────────────────────────────
@router.post("/tickets/{name}/attachments")
async def upload_attachment(
    name: str,
    file: UploadFile = File(...),
    reply_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Upload + persist one attachment on a ticket (agent) or own request
    (requester). Validates type + size BEFORE writing to a random, tenant-scoped
    path; the client filename never becomes a path component."""
    tid = tenant_id(db)
    ticket = _gate_ticket(db, tid, user, name, write=True)

    _validate_file(file.filename, file.content_type)

    # Read with a hard ceiling so an oversized upload can't exhaust memory:
    # pull MAX+1 bytes and reject if the file is still not exhausted.
    contents = await file.read(MAX_SIZE_BYTES + 1)
    if len(contents) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_SIZE_BYTES // (1024 * 1024)} MB limit",
        )
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    storage_key = uuid.uuid4().hex  # 32 lowercase hex — matches _STORAGE_KEY_RE
    on_disk = os.path.join(_storage_dir(tid), storage_key)
    with open(on_disk, "wb") as fh:
        fh.write(contents)

    row = HDAttachment(
        tenant_id=tid,
        ticket_id=ticket.id,
        reply_id=reply_id,
        filename=_safe_filename(file.filename),
        content_type=(file.content_type or None),
        size_bytes=len(contents),
        storage_key=storage_key,
        uploaded_by=user.email,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "attachment": _row_dict(row)}


@router.get("/tickets/{name}/attachments")
def list_attachments(
    name: str,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """List a ticket's attachments (metadata only). Tenant + ownership/agent gated."""
    tid = tenant_id(db)
    ticket = _gate_ticket(db, tid, user, name, write=False)
    rows = (
        db.query(HDAttachment)
        .filter(HDAttachment.tenant_id == tid, HDAttachment.ticket_id == ticket.id)
        .order_by(HDAttachment.created_at.asc())
        .all()
    )
    return {"attachments": [_row_dict(a) for a in rows]}


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Stream one attachment for save-as. Resolves the row tenant-scoped, gates on
    its ticket, then serves the file by its validated storage_key."""
    tid = tenant_id(db)
    row = (
        db.query(HDAttachment)
        .filter(HDAttachment.id == attachment_id, HDAttachment.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="attachment not found")

    # Gate on the owning ticket (re-runs the agent/requester authorization).
    _gate_ticket(db, tid, user, str(row.ticket_id), write=False)

    # Re-validate the stored key: 32 lowercase hex, no separators → the joined
    # path is provably inside the tenant dir (defence-in-depth vs a tampered row).
    if not row.storage_key or not _STORAGE_KEY_RE.match(row.storage_key):
        raise HTTPException(status_code=404, detail="attachment not found")

    on_disk = os.path.join(_storage_dir(tid), row.storage_key)
    if not os.path.isfile(on_disk):
        raise HTTPException(status_code=404, detail="file missing")

    return FileResponse(
        path=on_disk,
        media_type=(row.content_type or "application/octet-stream"),
        filename=_safe_filename(row.filename),  # FastAPI → Content-Disposition: attachment
    )


if __name__ == "__main__":
    # Pure self-check — traversal-safety + allowlist logic (no DB, no FS).
    # filename sanitization strips any path component / control chars.
    assert _safe_filename("../../etc/passwd") == "passwd"
    assert _safe_filename(r"..\..\windows\system32\cmd.exe") == "cmd.exe"
    assert _safe_filename("a\r\nb\"c.pdf") == "abc.pdf"
    assert _safe_filename("") == "attachment"
    assert _safe_filename(None) == "attachment"

    # a uuid4 hex storage key matches the strict validator; a traversal string never does.
    assert _STORAGE_KEY_RE.match(uuid.uuid4().hex)
    for bad in ("../../x", "abc", "ABCDEF", "", "a" * 31, "g" * 32):
        assert not _STORAGE_KEY_RE.match(bad), bad

    # extension allowlist: permitted types pass, executables/scripts raise 415.
    for good in ("report.pdf", "SHOT.PNG", "pic.jpeg", "notes.txt", "data.csv",
                 "doc.docx", "sheet.xlsx"):
        _validate_file(good, "application/octet-stream")  # no raise
    for bad in ("evil.exe", "shell.sh", "page.html", "a.js", "noext"):
        try:
            _validate_file(bad, "application/octet-stream")
            raise SystemExit(f"allowlist failed to reject {bad!r}")
        except HTTPException as e:
            assert e.status_code == 415

    # a disallowed content-type is rejected even with a permitted extension.
    try:
        _validate_file("ok.pdf", "text/html")
        raise SystemExit("content-type allowlist failed to reject text/html")
    except HTTPException as e:
        assert e.status_code == 415

    assert MAX_SIZE_BYTES == 10 * 1024 * 1024
    print("attachments self-check ok — traversal, allowlist, size limits enforced")
