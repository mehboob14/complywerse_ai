"""A questionnaire as a fillable PDF, out and back.

The PDF has a box per question (a list where it has set answers), a comment box
and the attestation; it says which questionnaire and version it is for, and an
upload made for another is refused. Answers are read by the labels shown, and
one that is not among a question's answers is refused by its question number.
"""
import io
from types import SimpleNamespace

import pytest
from PyPDF2 import PdfReader, PdfWriter
from PyPDF2.generic import NameObject

from grc.modules.vendor_risk.tpra import questionnaire_pdf

QUESTIONS = [
    {"id": "q1", "text": "Do you encrypt customer data at rest?", "type": "yes_no",
     "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
    {"id": "q.2", "text": "Describe your incident response process.", "type": "text"},
]


def _qr(**kw):
    base = dict(id=41, template_version_id=7, responses={"q1": "no"}, vendor_comments={}, attested_name=None,
                attested_title=None, attested_email=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _fill(pdf: bytes, values: dict, tick: bool = True) -> bytes:
    reader = PdfReader(io.BytesIO(pdf))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)      # the whole document, form included, as a PDF reader saves it
    writer.add_metadata(dict(reader.metadata or {}))
    for page in writer.pages:
        writer.update_page_form_field_values(page, values)
        if tick:
            for annot in page.get("/Annots") or []:
                field = annot.get_object()
                if field.get("/T") == "attest_confirm":
                    field[NameObject("/V")] = NameObject("/Yes")
                    field[NameObject("/AS")] = NameObject("/Yes")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_a_filled_pdf_comes_back_as_answers_comments_and_attestation():
    blank = questionnaire_pdf.build(_qr(responses={}), QUESTIONS, "Payroll Co")    # nothing answered yet
    assert questionnaire_pdf.read(blank, _qr(), QUESTIONS)["responses"] == {}
    pdf = questionnaire_pdf.build(_qr(), QUESTIONS, "Payroll Co")
    names = set(PdfReader(io.BytesIO(pdf)).get_fields())
    assert {"ref", "q0_q1", "q1_q_2", "c0_q1", "attest_name", "attest_confirm"} <= names
    filled = _fill(pdf, {"q0_q1": "Yes", "q1_q_2": "We follow a written plan, tested yearly.", "c0_q1": "AES-256",
                         "attest_name": "Sam Supplier", "attest_title": "CISO", "attest_email": "sam@payroll.test"})
    got = questionnaire_pdf.read(filled, _qr(), QUESTIONS)
    assert got["responses"] == {"q1": "yes", "q.2": "We follow a written plan, tested yearly."}
    assert got["comments"] == {"q1": "AES-256"}
    assert got["attestation"] == {"name": "Sam Supplier", "title": "CISO", "email": "sam@payroll.test", "confirm": True}


def test_a_pdf_for_another_questionnaire_or_an_unknown_answer_is_refused():
    pdf = questionnaire_pdf.build(_qr(), QUESTIONS, "Payroll Co")
    with pytest.raises(ValueError, match="different questionnaire"):
        questionnaire_pdf.read(pdf, _qr(id=42), QUESTIONS)
    with pytest.raises(ValueError, match="different version"):
        questionnaire_pdf.read(pdf, _qr(template_version_id=8), QUESTIONS)
    with pytest.raises(ValueError, match="not a PDF made from"):
        questionnaire_pdf.read(b"%PDF-1.4 nothing here", _qr(), QUESTIONS)
    wrong = _fill(pdf, {"q0_q1": "Perhaps"}, tick=False)
    with pytest.raises(ValueError, match="Question 1: 'Perhaps' is not one of its answers"):
        questionnaire_pdf.read(wrong, _qr(), QUESTIONS)
