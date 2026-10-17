"""Electronic signatures: a signature drawn on screen, kept with the record it was made for, and sealed.

What "sealed" means here, so a signature can be shown to an auditor:

* `image_sha256` is the SHA-256 of the drawn PNG, and `content_sha256` that of what was signed (a document's text
  and file, or the attestation statement). Both can be recomputed by anyone who has the bytes.
* `seal` is an HMAC-SHA256 over those two and everything else that gives the signature its meaning (who, which
  record, which version, what it says, when), keyed by the server's secret and never stored with it. Someone who
  edits a row in the database cannot make the seal match again without the key.
* Rows are append-only: signing twice adds a row, so the first signature is never overwritten.
* The audit trail is the sign-off or attestation row it belongs to, its audit-log entry (which names the
  fingerprints), and the IP address and browser recorded here.

This is an electronic signature (a person's explicit act, tied to the record and an audit trail), not a
certificate-based digital signature.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import ElectronicSignature

MAX_IMAGE_BYTES = 400_000
_PNG = b"\x89PNG\r\n\x1a\n"
_MIN_INK_PIXELS = 40
# Everything the seal covers (the image is covered through its hash).
_SEALED = ("tenant_id", "record_type", "record_id", "document_id", "document_version", "content_sha256",
           "signer_user_id", "signer_name", "signer_email", "signer_title", "meaning", "image_sha256")


def image_from_data_url(data_url: Optional[str]) -> bytes:
    """The PNG a signature pad produced, checked: a real PNG, not too big, with ink on it."""
    header, sep, b64 = (data_url or "").strip().partition(",")
    if not sep or not header.lower().startswith("data:image/png") or ";base64" not in header.lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Draw your signature in the signature box.")
    try:
        blob = base64.b64decode(b64, validate=True)
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The signature could not be read. Draw it again.")
    if not blob.startswith(_PNG) or len(blob) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The signature image is not valid or is too large.")
    if not _has_ink(blob):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The signature box is empty. Draw your signature.")
    return blob


def _has_ink(blob: bytes) -> bool:
    from PIL import Image

    try:
        with Image.open(BytesIO(blob)) as im:
            page = Image.new("RGBA", im.size, "white")          # a transparent PNG is judged on white
            page.alpha_composite(im.convert("RGBA"))
            dark = page.convert("L").point(lambda p: 255 if p < 128 else 0)
            return dark.histogram()[255] >= _MIN_INK_PIXELS
    except Exception:  # noqa: BLE001
        return False


def fingerprint(*, text: Optional[str] = None, file_path: Optional[str] = None) -> str:
    """SHA-256 of what is being signed: its text and, when it has one, its file."""
    h = hashlib.sha256((text or "").encode("utf-8"))
    if file_path and os.path.isfile(file_path):
        h.update(b"\0")
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


def document_fingerprint(document: Any) -> str:
    return fingerprint(text=getattr(document, "content", None), file_path=getattr(document, "file_path", None))


def _keys() -> List[bytes]:
    """The seal key now, then the one before it (SESSION_SECRET_OLD) so a rotation does not unseal old rows."""
    secrets_ = [os.environ.get(n) for n in ("SESSION_SECRET", "SESSION_SECRET_OLD")]
    if not secrets_[0]:
        raise RuntimeError("SESSION_SECRET is required to seal signatures.")
    return [hashlib.sha256(b"esign-seal-v1:" + s.encode("utf-8")).digest() for s in secrets_ if s]


def _seal(sig: ElectronicSignature, key: bytes) -> str:
    body: Dict[str, Any] = {k: getattr(sig, k) for k in _SEALED}
    body["signed_at"] = sig.signed_at.isoformat()
    return hmac.new(key, json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8"), hashlib.sha256).hexdigest()


def record(db: Session, *, tenant_id: int, record_type: str, record_id: int, signature_image: Optional[str],
           meaning: str, signer_name: str, content_sha256: str, signer_user_id: Optional[int] = None,
           signer_email: Optional[str] = None, signer_title: Optional[str] = None, document: Any = None,
           document_version: Optional[str] = None, request: Any = None) -> ElectronicSignature:
    """Keep and seal the signature drawn for one record. Validates first, then adds the row to the caller's
    transaction (flushed, not committed), so it commits or rolls back together with the sign-off it belongs to."""
    blob = image_from_data_url(signature_image)
    client = getattr(request, "client", None)
    sig = ElectronicSignature(
        tenant_id=tenant_id, record_type=record_type, record_id=record_id,
        document_id=getattr(document, "id", None),
        document_version=document_version or (str(getattr(document, "current_version", "") or "") or None),
        content_sha256=content_sha256, signer_user_id=signer_user_id, signer_name=(signer_name or "")[:255],
        signer_email=(signer_email or None), signer_title=((signer_title or "")[:255] or None),
        meaning=(meaning or "")[:500], image_png=blob, image_sha256=hashlib.sha256(blob).hexdigest(),
        signed_at=datetime.utcnow().replace(microsecond=0),
        ip_address=getattr(client, "host", None),
        user_agent=((getattr(request, "headers", None) or {}).get("user-agent") or "")[:500] or None,
    )
    sig.seal = _seal(sig, _keys()[0])
    db.add(sig)
    db.flush()
    return sig


def verify(sig: ElectronicSignature, document: Any = None) -> Dict[str, Any]:
    """Is the drawn image still what was captured, and does the seal still match the row? `document` (when the
    signature was made on a document that is not edited by signing itself) also says if it changed since."""
    image_ok = hashlib.sha256(sig.image_png or b"").hexdigest() == sig.image_sha256
    seal_ok = any(hmac.compare_digest(_seal(sig, k), sig.seal or "") for k in _keys())
    changed = None
    if document is not None and sig.record_type != "document_signoff":   # signing a sign-off stamps the document itself
        signed = document
        if sig.record_type == "document_acknowledgement":    # the version acknowledged, while it is still the one in force
            from sqlalchemy.orm import object_session

            from ..modules.governance import permissions

            db = object_session(document)
            if db is not None and sig.document_version and sig.document_version == permissions.in_force_number(document):
                signed = permissions.in_force_row(db, document) or document
        changed = document_fingerprint(signed) != sig.content_sha256
    return {"valid": image_ok and seal_ok, "image_ok": image_ok, "seal_ok": seal_ok, "document_changed_since": changed}


def summaries(db: Session, record_type: str, record_ids: Iterable[int]) -> Dict[int, Dict[str, Any]]:
    """The latest signature of each record, without the image: what a list needs to show that it is signed."""
    ids = [i for i in record_ids if i is not None]
    if not ids:
        return {}
    rows = (db.query(ElectronicSignature)
            .filter(ElectronicSignature.record_type == record_type, ElectronicSignature.record_id.in_(ids))
            .order_by(ElectronicSignature.id.asc()).all())
    return {r.record_id: {"id": r.id, "image_sha256": r.image_sha256, "seal": r.seal, "signed_at": r.signed_at.isoformat()}
            for r in rows}                                         # a later row for the same record wins
