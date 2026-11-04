"""The logo gateway: what an uploaded picture goes through before it is kept as the organisation's logo.

A logo reaches the platform in every state: a tight PNG from a designer, a JPEG with a wide white border, a screenshot of a letterhead (the
logo at the top, the address lines under it), a mark on a grey page, a white logo on a transparent background, a tiny web icon, an SVG.
Placed as it comes, most of these print badly (a tiny mark inside a big empty box, address lines in the page header, a grey rectangle, a
logo that is invisible on white paper). The gateway opens the picture safely (Pillow, or PyMuPDF for an SVG, which never runs scripts), finds
the logo in it, trims the empty margin, takes a plain background off when the logo is darker than it, leaves a white background or a logo's own
coloured block alone, warns about what it cannot fix (a white logo, a low resolution), and saves a clean PNG. What it did is returned as
``notes`` for the screen, and ``process=False`` ("use the original") skips the tidying and keeps only the safe re-encode.

Pure functions on bytes: no database, no files, nothing sent anywhere.
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageOps


MAX_PIXELS = 40_000_000            # refuse a decompression bomb before decoding it
MAX_SVG_BYTES = 1024 * 1024
LOGO_BOX = (1600, 800)             # a logo is never printed larger than a few centimetres
SVG_LONG_SIDE = 1600               # an SVG is drawn this many pixels along its long side: sharp at any print size
MIN_DPI = 200                      # below this many pixels per inch at its printed size a logo looks soft
ANALYSIS_SIDE = 1200               # the logo is looked for on a copy this size: a huge picture costs no more memory than a small one
BG_TOLERANCE = 40.0                # how far (RGB distance) a pixel may be from the background colour and still be background (JPEG noise)
WHITE_FROM = 240                   # a background whose darkest channel is at least this is "white paper": left alone
DARKER_BY = 0.22                   # the logo must be this much darker than a plain background for the background to be taken off
TOO_LIGHT = 0.88                   # a transparent logo lighter than this on average cannot be seen on white paper
RASTER_FORMATS = ("PNG", "JPEG", "GIF", "BMP", "TIFF", "WEBP")


class LogoError(ValueError):
    """The picture cannot be used as a logo; the message is safe to show (the upload turns it into a 400)."""


@dataclass
class Prepared:
    data: bytes
    mime: str
    ext: str
    width: int
    height: int
    notes: List[Dict[str, str]] = field(default_factory=list)


def _note(level: str, code: str, text: str) -> Dict[str, str]:
    return {"level": level, "code": code, "text": text}


# ── opening ──────────────────────────────────────────────────────────────────
def _is_svg(raw: bytes, filename: str) -> bool:
    head = raw.lstrip(b"\xef\xbb\xbf \t\r\n")[:2048].lower()
    looks_like_svg = head.startswith((b"<svg", b"<?xml", b"<!doctype svg")) and b"<svg" in raw[:8192].lower()
    return looks_like_svg or (filename.lower().endswith(".svg") and head.startswith(b"<"))


_BAD_TAGS = {"script", "foreignobject", "iframe", "object", "embed", "audio", "video", "animate", "animatetransform", "set"}
_DATA_IMAGE = re.compile(r"^data:image/(png|jpeg|gif|webp);base64,", re.I)


def _sanitize_svg(raw: bytes) -> bytes:
    """The SVG with everything that is not a drawing taken out: scripts, embedded pages, animation, event handlers and any link to something
    outside the file. (The renderer runs none of it anyway; what is stored is a PNG. This keeps what is drawn predictable.)"""
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, remove_comments=True, remove_pis=True)
    try:
        root = etree.fromstring(raw, parser=parser)
    except Exception:       # noqa: BLE001 - anything lxml cannot read is not an SVG
        raise LogoError("That SVG could not be read. Export it again as a plain SVG, or upload a PNG.")
    if etree.QName(root).localname.lower() != "svg":
        raise LogoError("That file is not an SVG logo. Upload an SVG, PNG or JPEG.")
    for el in list(root.iter()):
        if not isinstance(el.tag, str):
            continue
        if etree.QName(el).localname.lower() in _BAD_TAGS:
            el.getparent().remove(el) if el.getparent() is not None else None
            continue
        for attr in list(el.attrib):
            name = etree.QName(attr).localname.lower()
            value = str(el.attrib[attr])
            if name.startswith("on"):
                del el.attrib[attr]
            elif name == "href" and not (value.startswith("#") or _DATA_IMAGE.match(value)):
                del el.attrib[attr]
            elif name == "style" and re.search(r"url\(\s*['\"]?(?!#)|@import", value, re.I):
                del el.attrib[attr]
    return etree.tostring(root)


def _draw_svg(raw: bytes) -> Image.Image:
    if len(raw) > MAX_SVG_BYTES:
        raise LogoError("That SVG is larger than 1 MB. Export a simpler one, or use a PNG.")
    safe = _sanitize_svg(raw)
    try:
        import fitz          # PyMuPDF draws SVG without running anything in it

        doc = fitz.open(stream=safe, filetype="svg")
        page = doc[0]
        w, h = float(page.rect.width), float(page.rect.height)
        if w < 1 or h < 1:
            raise ValueError("no size")
        scale = max(1.0, min(8.0, SVG_LONG_SIDE / max(w, h)))
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
        if pix.width * pix.height > MAX_PIXELS:
            raise ValueError("too large")
        return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    except LogoError:
        raise
    except Exception:       # noqa: BLE001
        raise LogoError("That SVG could not be drawn. Give it a width and height (or a viewBox), turn its text into outlines, or upload a PNG.")


def _open_raster(raw: bytes) -> Tuple[Image.Image, str]:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
        img = Image.open(io.BytesIO(raw))
        if img.width * img.height > MAX_PIXELS:
            raise LogoError("That picture is too large. Use one under about 6000 × 6000 pixels.")
        if (probe.format or "").upper() == "JPEG":
            img.draft("RGB", (4000, 4000))                  # decoded at a reduced size when it is larger: it is shrunk to the logo box anyway
        img = ImageOps.exif_transpose(img)
        img.load()
    except LogoError:
        raise
    except Exception:       # noqa: BLE001 - anything Pillow cannot read is not a usable picture
        raise LogoError("That file is not a picture Word and PDF can use. Upload an SVG, PNG or JPEG logo.")
    fmt = (probe.format or "").upper()
    if fmt not in RASTER_FORMATS:
        raise LogoError("Upload an SVG, PNG or JPEG logo.")
    return img, fmt


# ── finding the logo ─────────────────────────────────────────────────────────
def _lum(rgb) -> float:
    r, g, b = (float(x) for x in rgb[:3])
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def _distance(rgb: np.ndarray, colour: np.ndarray) -> np.ndarray:
    return np.sqrt(((rgb.astype(np.float32) - colour.astype(np.float32)) ** 2).sum(axis=-1))


def _border_colour(rgb: np.ndarray) -> Optional[np.ndarray]:
    """The plain colour the picture's edge is, or None when the edge is not one colour (a photo, a gradient, a logo that fills the frame)."""
    h, w = rgb.shape[:2]
    r = max(1, round(0.015 * min(h, w)))
    ring = np.concatenate([rgb[:r].reshape(-1, 3), rgb[-r:].reshape(-1, 3), rgb[:, :r].reshape(-1, 3), rgb[:, -r:].reshape(-1, 3)])
    colour = np.median(ring, axis=0)
    return colour if (_distance(ring, colour) <= BG_TOLERANCE).mean() >= 0.92 else None


def _clusters(mask: np.ndarray):
    """The separate things in a picture: ``[(ink, (y0, x0, y1, x1)), ...]`` in full-picture pixels, biggest ink first. Parts that lie close together
    (an icon and its name, a name and its tagline) are one thing."""
    from scipy import ndimage

    h, w = mask.shape
    step = max(1, -(-max(h, w) // 480))
    hs, ws = -(-h // step), -(-w // step)
    padded = np.zeros((hs * step, ws * step), dtype=bool)
    padded[:h, :w] = mask
    small = padded.reshape(hs, step, ws, step).any(axis=(1, 3))
    grow = max(1, round(0.035 * max(hs, ws)))
    labels, n = ndimage.label(ndimage.binary_dilation(small, structure=np.ones((3, 3), bool), iterations=grow))
    found = []
    for i, box in enumerate(ndimage.find_objects(labels), start=1):
        ink = int((small[box] & (labels[box] == i)).sum())
        if ink:
            ys, xs = np.nonzero(small[box] & (labels[box] == i))
            y0, y1 = ys.min() + box[0].start, ys.max() + 1 + box[0].start
            x0, x1 = xs.min() + box[1].start, xs.max() + 1 + box[1].start
            found.append((ink, (y0 * step, x0 * step, min(h, y1 * step), min(w, x1 * step))))
    return sorted(found, reverse=True)


def _drop_background(rgba: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """The plain background taken off (made transparent) where it touches the picture's edge, with soft edges and no halo of the old colour;
    whatever the logo encloses (the counter of an O, a white letter on a coloured shape) stays."""
    from scipy import ndimage

    rgb = rgba[..., :3].astype(np.float32)
    dist = _distance(rgb, bg)
    like_bg = dist <= BG_TOLERANCE
    labels, _ = ndimage.label(like_bg)
    edge_labels = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    outside = np.isin(labels, list(edge_labels)) if edge_labels else np.zeros_like(like_bg)
    rim = ndimage.binary_dilation(outside, iterations=2) & ~outside
    alpha = np.where(outside, 0.0, 1.0).astype(np.float32)
    soft = np.clip((dist - 8.0) / (BG_TOLERANCE + 24.0 - 8.0), 0.0, 1.0)
    alpha = np.where(rim, soft, alpha)
    a = np.maximum(alpha, 1e-3)[..., None]
    colour = np.where(rim[..., None], (rgb - (1.0 - a) * bg.astype(np.float32)) / a, rgb)
    out = np.dstack([np.clip(colour, 0, 255), alpha * 255.0]).astype(np.uint8)
    return out


def _tidy(img: Image.Image, notes: List[Dict[str, str]]) -> Image.Image:
    full = img.convert("RGBA")
    small = full.copy()
    small.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE))              # the logo is found on this copy; the crop is taken from the full picture
    rgba = np.asarray(small, dtype=np.uint8)
    h, w = rgba.shape[:2]
    alpha = rgba[..., 3]
    has_alpha = bool((alpha < 250).mean() > 0.01)
    bg: Optional[np.ndarray] = None
    if has_alpha:
        mask = alpha > 24
    else:
        bg = _border_colour(rgba[..., :3])
        mask = _distance(rgba[..., :3], bg) > BG_TOLERANCE if bg is not None else np.ones((h, w), dtype=bool)
    if not mask.any() or mask.all():
        return img                                           # one flat colour, or a picture with no plain edge: used as it is
    if bg is not None and bg.min() < WHITE_FROM:
        sample = rgba[..., :3][mask][::max(1, int(mask.sum()) // 4000)]
        if _lum(bg) - float(np.median([_lum(p) for p in sample])) < DARKER_BY:
            notes.append(_note("info", "block", "The logo sits on a coloured block, so it is kept and placed as a block."))
            return img                                       # light on a colour: the block is part of the logo, so nothing is cut or removed
    found = _clusters(mask)
    top = found[0][0]
    parts = [c for c in found if c[0] >= 0.04 * top]                       # not specks
    area = lambda b: max(1, (b[2] - b[0]) * (b[3] - b[1]))                 # noqa: E731
    union = (min(c[1][0] for c in parts), min(c[1][1] for c in parts), max(c[1][2] for c in parts), max(c[1][3] for c in parts))
    if len(parts) == 1 or area(union) <= 2.5 * area(parts[0][1]):
        keep = (0, union)                                                  # an icon, its name and its tagline: one logo
    else:
        big = [c for c in parts if c[0] >= 0.15 * top]                     # several things in one picture (a letterhead): the top one is the logo
        keep = min(big, key=lambda c: (c[1][0], -c[0]))
        if len(big) > 1:
            notes.append(_note("info", "extracted", f"The picture holds {len(big)} separate things; the top one was taken as the logo. "
                                                    "If that is not your logo, crop it yourself and upload it again."))
    y0, x0, y1, x1 = keep[1]
    pad = max(2, round(0.03 * max(x1 - x0, y1 - y0)))
    box = (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad))
    if (box[2] - box[0]) * (box[3] - box[1]) < 0.9 * w * h:
        notes.append(_note("info", "trimmed", "Trimmed the empty space around the logo, so it prints at the size it should."))
    fx, fy = full.width / w, full.height / h
    cropped = full.crop((int(box[0] * fx), int(box[1] * fy), min(full.width, math.ceil(box[2] * fx)), min(full.height, math.ceil(box[3] * fy))))
    if bg is not None and not has_alpha and bg.min() < WHITE_FROM:       # darker than its plain background (checked above): the background comes off
        cropped.thumbnail(LOGO_BOX)                                      # at most the stored size before any per-pixel work
        cropped = Image.fromarray(_drop_background(np.asarray(cropped, dtype=np.uint8), bg), "RGBA")
        notes.append(_note("info", "background_removed", "Took the plain background off, so the logo sits cleanly on the page."))
    return cropped


# ── the gateway ──────────────────────────────────────────────────────────────
def prepare(raw: bytes, filename: str = "", *, process: bool = True) -> Prepared:
    """The picture as it will be kept (a clean PNG, or the original format's clean re-encode with ``process=False``) and what was done to it."""
    notes: List[Dict[str, str]] = []
    svg = _is_svg(raw, filename)
    if svg:
        img, fmt = _draw_svg(raw), "SVG"
        notes.append(_note("info", "svg", "Drawn from the SVG at print quality."))
    else:
        img, fmt = _open_raster(raw)
    if process:
        img = _tidy(img, notes)
    img.thumbnail(LOGO_BOX)
    rgba = img.convert("RGBA")
    arr = np.asarray(rgba)
    transparent = bool((arr[..., 3] < 250).any())
    if transparent and not (arr[..., 3] > 24).any():
        raise LogoError("Nothing can be seen in that picture. Upload a logo that has something drawn in it.")
    if process and transparent:
        weight = arr[..., 3].astype(np.float32) / 255.0
        if weight.sum() > 0:
            lum = float(((0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]) / 255.0 * weight).sum() / weight.sum())
            if lum > TOO_LIGHT:
                notes.append(_note("warn", "too_light", "This logo is white or very light, so it will not show on a white page. "
                                                        "Upload the dark or coloured version."))
    printed_cm = fit_cm(img.width, img.height, "header")[0]
    if not svg and img.width / (printed_cm / 2.54) < MIN_DPI:
        notes.append(_note("warn", "low_resolution", f"This logo has only {img.width} pixels across, so it may look soft in print. "
                                                     "Use a PNG at least 600 pixels wide, or an SVG."))
    out = io.BytesIO()
    if not process and fmt == "JPEG" and not transparent:
        rgba.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
        mime, ext = "image/jpeg", "jpg"
    else:
        (rgba if transparent else rgba.convert("RGB")).save(out, "PNG", optimize=True)
        mime, ext = "image/png", "png"
    return Prepared(out.getvalue(), mime, ext, img.width, img.height, notes)


# ── placing it ───────────────────────────────────────────────────────────────
HEADER_BOX_CM = (6.0, 1.3)         # the widest and tallest a logo is printed in the page header (the rule under it is at 2.55 cm)
FOOTER_BOX_CM = (4.5, 0.9)         # ... and at the foot of the page


def fit_cm(width_px: int, height_px: int, where: str) -> Tuple[float, float]:
    """The size, in centimetres, a logo is printed at: as large as the box allows without changing its shape, so a long wordmark does not run
    across the page and a tall mark does not push the text down."""
    max_w, max_h = FOOTER_BOX_CM if where == "footer" else HEADER_BOX_CM
    scale = min(max_w / max(1, width_px), max_h / max(1, height_px))
    return width_px * scale, height_px * scale
