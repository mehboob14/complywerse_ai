"""A questionnaire as a fillable PDF, for suppliers who answer offline in a PDF reader.

The same route as the workbook (tpra/workbook.py), for those who would rather
fill in a form than a spreadsheet: every question has a box to answer in (a
list where the question has set answers), a comment box, and the attestation at
the end. The PDF carries which questionnaire and template version it was made
from, in a read-only field and in its keywords, so an upload is matched to the
right questionnaire and refused if it was made for another one or an older
version. Answers are read by the labels the supplier saw; one that is not among
a question's answers is refused with its question number, never guessed at.
"""
from __future__ import annotations

import io
import re
from typing import Dict, List, Optional

from .workbook import FORMAT, _CONFIRM, _label, _options

MAX_BYTES = 10 * 1024 * 1024
_SAFE = re.compile(r"[^A-Za-z0-9_]")
# A list field must hold a value, so an unanswered one holds this, read back as no answer.
UNANSWERED = "Choose an answer"


def field_name(index: int, question: dict) -> str:
    """A PDF field name for a question: its position and key (dots would nest fields)."""
    return f"q{index}_{_SAFE.sub('_', str(question.get('id')))[:40]}"


def _ref(qr) -> str:
    return f"{FORMAT}:{qr.id}:{qr.template_version_id}"


def build(qr, questions: List[dict], vendor_name: str, locked: Optional[Dict[str, str]] = None) -> bytes:
    """The fillable PDF for one questionnaire, prefilled with the answers so far."""
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas

    locked = locked or {}
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=A4)
    c.setTitle(f"Questionnaire for {vendor_name}")
    c.setKeywords(_ref(qr))
    width, height = A4
    left, right, bottom = 50, width - 50, 60
    y = height - 60
    answers, comments = qr.responses or {}, qr.vendor_comments or {}

    def room(needed: float) -> None:
        nonlocal y
        if y - needed < bottom:
            c.showPage()
            y = height - 60

    def text(line: str, size: float = 10, bold: bool = False, colour: str = "#1e293b", gap: float = 4) -> None:
        nonlocal y
        font = "Helvetica-Bold" if bold else "Helvetica"
        for part in simpleSplit(line, font, size, right - left):
            room(size + gap)
            c.setFont(font, size)
            c.setFillColor(HexColor(colour))
            c.drawString(left, y, part)
            y -= size + gap

    text(f"Questionnaire for {vendor_name}", 16, bold=True, gap=8)
    text("Answer in the boxes, choosing from the list where there is one, and add a comment where it helps. "
         "Fill in the attestation at the end, save the file and upload it at the link you were sent.", 9,
         colour="#475569")
    y -= 6
    c.acroForm.textfield(name="ref", value=_ref(qr), x=left, y=y - 12, width=right - left, height=12,
                         fontSize=6, borderWidth=0, textColor=HexColor("#94a3b8"), fillColor=HexColor("#ffffff"),
                         fieldFlags="readOnly", tooltip="Which questionnaire this is; leave it as it is")
    y -= 26
    for i, q in enumerate(questions):
        key = str(q.get("id"))
        name = field_name(i, q)
        label = f"{i + 1}. {q.get('text') or key}" + ("  [answered by your certificate]" if key in locked else "")
        room(90)
        text(label, 10, bold=True)
        labels = [str(o.get("label") or o.get("value")) for o in _options(q)]
        current = _label(q, answers.get(key))
        if labels and (q.get("type") or "yes_no") != "text":
            room(24)
            c.acroForm.choice(name=name, value=current if current in labels else UNANSWERED, options=[UNANSWERED] + labels,
                              x=left, y=y - 18, width=220, height=18, fontSize=9, fieldFlags="combo",
                              tooltip=f"Answer to question {i + 1}")
            y -= 26
        else:
            room(52)
            c.acroForm.textfield(name=name, value=current or "", x=left, y=y - 44, width=right - left, height=44,
                                 fontSize=9, fieldFlags="multiline", maxlen=10000, tooltip=f"Answer to question {i + 1}")
            y -= 52
        room(24)
        c.setFont("Helvetica", 8)
        c.setFillColor(HexColor("#64748b"))
        c.drawString(left, y - 2, "Comment")
        c.acroForm.textfield(name=f"c{i}_{name.split('_', 1)[1]}", value=str(comments.get(key) or ""), x=left + 50,
                             y=y - 14, width=right - left - 50, height=16, fontSize=8, maxlen=4000,
                             tooltip=f"Comment on question {i + 1}")
        y -= 28

    room(150)
    text("Attestation", 12, bold=True, gap=8)
    for label, fname, value in (("Name", "attest_name", qr.attested_name), ("Job title", "attest_title", qr.attested_title),
                                ("Email", "attest_email", qr.attested_email)):
        room(24)
        c.setFont("Helvetica", 9)
        c.setFillColor(HexColor("#1e293b"))
        c.drawString(left, y - 2, label)
        c.acroForm.textfield(name=fname, value=str(value or ""), x=left + 70, y=y - 14, width=280, height=16,
                             fontSize=9, maxlen=255, tooltip=label)
        y -= 24
    room(24)
    c.acroForm.checkbox(name="attest_confirm", x=left, y=y - 12, size=12, checked=False, buttonStyle="check",
                        tooltip="Confirm the attestation")
    for part in simpleSplit(_CONFIRM, "Helvetica", 9, right - left - 20):
        c.setFont("Helvetica", 9)
        c.drawString(left + 20, y - 10, part)
        y -= 13
    c.save()
    return out.getvalue()


def _value(field) -> str:
    raw = field.get("/V") if isinstance(field, dict) else None
    if raw is None:
        return ""
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    return str(raw).strip()


def _widgets(reader) -> Dict[str, dict]:
    """The form's fields read from each page's widgets, for a PDF saved by an editor
    that dropped the document's list of fields but kept the boxes and their values."""
    out: Dict[str, dict] = {}
    for page in reader.pages:
        for annot in page.get("/Annots") or []:
            widget = annot.get_object()
            parent = widget.get("/Parent").get_object() if widget.get("/Parent") else {}
            name = widget.get("/T") or parent.get("/T")
            if name is not None:
                out[str(name)] = {"/V": widget.get("/V", parent.get("/V"))}
    return out


def read(content: bytes, qr, questions: List[dict]) -> dict:
    """Answers, comments and attestation from a completed PDF. Raises ValueError
    saying what is wrong, question by question where it can."""
    from PyPDF2 import PdfReader

    if len(content) > MAX_BYTES:
        raise ValueError("The PDF is larger than 10 MB")
    try:
        reader = PdfReader(io.BytesIO(content))
        fields = reader.get_fields() or _widgets(reader)
        keywords = str((reader.metadata or {}).get("/Keywords") or "")
    except Exception:  # noqa: BLE001 — anything the reader cannot open
        raise ValueError("This is not a PDF made from the questionnaire")
    ref = _value(fields.get("ref")) or keywords
    parts = ref.split(":")
    if len(parts) != 3 or parts[0] != FORMAT:
        raise ValueError("This is not a PDF made from the questionnaire")
    if parts[1] != str(qr.id):
        raise ValueError("This PDF was made for a different questionnaire")
    if parts[2] != str(qr.template_version_id):
        raise ValueError("This PDF was made from a different version of the questionnaire. "
                         "Download it again and copy your answers across.")

    answers: Dict[str, str] = {}
    comments: Dict[str, str] = {}
    problems: List[str] = []
    for i, q in enumerate(questions):
        key, name = str(q.get("id")), field_name(i, q)
        raw = _value(fields.get(name))
        comment = _value(fields.get(f"c{i}_{name.split('_', 1)[1]}"))
        if comment:
            comments[key] = comment[:4000]
        if not raw or raw == UNANSWERED:
            continue
        if (q.get("type") or "yes_no") == "text":
            answers[key] = raw[:10000]
            continue
        match = next((o for o in _options(q)
                      if raw.lower() in (str(o.get("label") or "").lower(), str(o.get("value")).lower())), None)
        if match is None:
            problems.append(f"Question {i + 1}: '{raw[:60]}' is not one of its answers")
        else:
            answers[key] = str(match.get("value"))
    if problems:
        raise ValueError("; ".join(problems[:10]))
    confirm = _value(fields.get("attest_confirm")).lstrip("/").lower()
    attestation = {"name": _value(fields.get("attest_name")), "title": _value(fields.get("attest_title")),
                   "email": _value(fields.get("attest_email")), "confirm": confirm in ("yes", "on", "true", "1")}
    return {"responses": answers, "comments": comments, "attestation": attestation}
