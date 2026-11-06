"""The organisation's logos for studio documents: validated, re-encoded and kept on disk under the studio's upload folder.

An uploaded picture is opened with Pillow, so a file that is not really a picture is refused, and is saved again as a clean
PNG or JPEG: that drops anything hidden in the file (metadata, scripts in an SVG, a second file appended to the first) and
gives Word and PDF a format they both place. SVG is not accepted for that reason.
"""
from __future__ import annotations

import hashlib
import io
import os
import uuid
from typing import Any, Dict, List, Optional

from . import service

MAX_LOGO_BYTES = 3 * 1024 * 1024
MAX_PIXELS = 40_000_000            # refuse a decompression bomb before decoding it
LOGO_BOX = (1600, 800)             # a logo is never printed larger than a few centimetres
KINDS = ("logo",)


def _clean(data: bytes) -> tuple:
    """``(bytes, mime, extension, width, height)`` of the picture saved again, or ``StudioError``."""
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > MAX_PIXELS:
            raise service.StudioError("That picture is too large. Use one under about 6000 × 6000 pixels.")
        img = ImageOps.exif_transpose(img)
        img.load()
    except service.StudioError:
        raise
    except Exception:       # noqa: BLE001 - anything Pillow cannot read is not a usable picture
        raise service.StudioError("That file is not a picture Word and PDF can use. Upload a PNG or JPEG logo.")
    fmt = (probe.format or "").upper()
    if fmt not in ("PNG", "JPEG", "GIF", "BMP", "TIFF", "WEBP"):
        raise service.StudioError("Upload a PNG or JPEG logo.")
    img.thumbnail(LOGO_BOX)
    out = io.BytesIO()
    if fmt == "JPEG":
        img.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
        mime, ext = "image/jpeg", "jpg"
    else:
        img.convert("RGBA" if "A" in img.getbands() or img.mode in ("P", "LA", "PA") else "RGB").save(out, "PNG", optimize=True)
        mime, ext = "image/png", "png"
    return out.getvalue(), mime, ext, img.width, img.height


def view(a) -> Dict[str, Any]:
    return {"id": a.id, "kind": a.kind, "name": a.name, "mime": a.mime, "size": a.size, "width": a.width, "height": a.height,
            "is_default": bool(a.is_default), "created_at": a.created_at.isoformat() if a.created_at else None}


def listing(db) -> List[Dict[str, Any]]:
    from ....models import StudioAsset

    return [view(a) for a in db.query(StudioAsset).order_by(StudioAsset.is_default.desc(), StudioAsset.id.desc()).all()]


def add(db, user, filename: str, data: bytes, *, name: Optional[str] = None, make_default: bool = False):
    from ....models import StudioAsset

    if not data:
        raise service.StudioError("The file is empty.")
    if len(data) > MAX_LOGO_BYTES:
        raise service.StudioError(f"The picture is larger than {MAX_LOGO_BYTES // (1024 * 1024)} MB.")
    clean, mime, ext, width, height = _clean(data)
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
