"""The organisation's logos for studio documents: opened and tidied by the logo gateway (``logo_gateway``), re-encoded and kept on disk under
the studio's upload folder.

An uploaded picture is opened with Pillow (an SVG is drawn with PyMuPDF, which never runs anything in it), so a file that is not really a picture
is refused, and is saved again as a clean PNG (or JPEG, when the person chose to keep the original): that drops anything hidden in the file
(metadata, scripts in an SVG, a second file appended to the first) and gives Word and PDF a format they both place. The gateway also finds the
logo in the picture, trims its empty margin and takes a plain background off; what it did comes back as ``notes``.
"""
from __future__ import annotations

import hashlib
import os
import uuid
from typing import Any, Dict, List, Optional

from . import logo_gateway, service

MAX_LOGO_BYTES = 3 * 1024 * 1024
MAX_PIXELS = logo_gateway.MAX_PIXELS
LOGO_BOX = logo_gateway.LOGO_BOX
KINDS = ("logo",)


def _clean(data: bytes) -> tuple:
    """``(bytes, mime, extension, width, height)`` of the picture saved again as it is (no tidying), or ``StudioError``."""
    try:
        done = logo_gateway.prepare(data, process=False)
    except logo_gateway.LogoError as exc:
        raise service.StudioError(str(exc))
    return done.data, done.mime, done.ext, done.width, done.height


def view(a) -> Dict[str, Any]:
    out = {"id": a.id, "kind": a.kind, "name": a.name, "mime": a.mime, "size": a.size, "width": a.width, "height": a.height,
           "is_default": bool(a.is_default), "created_at": a.created_at.isoformat() if a.created_at else None}
    notes = getattr(a, "gateway_notes", None)
    if notes:                       # only the answer to an upload: what the gateway did, and what it could not fix
        out["notes"] = notes
    return out


def listing(db) -> List[Dict[str, Any]]:
    from ....models import StudioAsset

    return [view(a) for a in db.query(StudioAsset).order_by(StudioAsset.is_default.desc(), StudioAsset.id.desc()).all()]


def add(db, user, filename: str, data: bytes, *, name: Optional[str] = None, make_default: bool = False, process: bool = True):
    from ....models import StudioAsset

    if not data:
        raise service.StudioError("The file is empty.")
    if len(data) > MAX_LOGO_BYTES:
        raise service.StudioError(f"The picture is larger than {MAX_LOGO_BYTES // (1024 * 1024)} MB.")
    try:
        done = logo_gateway.prepare(data, filename, process=process)
    except logo_gateway.LogoError as exc:
        raise service.StudioError(str(exc))
    clean, mime, ext, width, height = done.data, done.mime, done.ext, done.width, done.height
    tenant = service._tenant(db)
    path = os.path.join(service.upload_dir(db, "assets"), f"{uuid.uuid4().hex}.{ext}")
    with open(path, "wb") as f:
        f.write(clean)
    label = (name or os.path.splitext(os.path.basename(filename or ""))[0] or "Logo").strip()[:200] or "Logo"
    if make_default:
        db.query(StudioAsset).filter(StudioAsset.kind == "logo").update({"is_default": False})
    first = db.query(StudioAsset).filter(StudioAsset.kind == "logo").count() == 0
    asset = StudioAsset(tenant_id=tenant.id, kind="logo", name=label, file_path=path, mime=mime, size=len(clean), width=width, height=height,
                        sha256=hashlib.sha256(clean).hexdigest(), is_default=bool(make_default or first), created_by=user.id)
    db.add(asset)
    db.commit()
    asset.gateway_notes = done.notes
    return asset


def path_of(asset) -> Optional[str]:
    """The picture's file, only if it is inside the studio's upload folder and still there."""
    root = os.path.abspath(service.UPLOAD_DIR)
    path = os.path.abspath(asset.file_path or "")
    return path if path.startswith(root + os.sep) and os.path.isfile(path) else None


def update(db, asset, *, name: Optional[str] = None, is_default: Optional[bool] = None):
    from ....models import StudioAsset

    if name is not None and name.strip():
        asset.name = name.strip()[:200]
    if is_default is True:
        db.query(StudioAsset).filter(StudioAsset.kind == asset.kind, StudioAsset.id != asset.id).update({"is_default": False})
        asset.is_default = True
    elif is_default is False:
        asset.is_default = False
    db.commit()
    return asset


def remove(db, asset) -> None:
    path = path_of(asset)
    db.delete(asset)
    db.commit()
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass
