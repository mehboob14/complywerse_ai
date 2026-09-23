"""Evidence for questionnaire answers lives in the evidence library, once.

A file a vendor uploads against a question becomes a library record linked to
the vendor, the assessment and that question. Its expiry is then tracked in one
place (the attention queue reads it), and it is reviewed against the question it
was meant to support. An analyst can answer a question from evidence the library
already holds instead of asking the vendor for it again.

A certificate can answer the questions a template marks `certificate_covers`, in
one of three modes: off; prefill (answered Yes, and the vendor can change it);
or skip (answered Yes and not asked). It is allowed only when the certificate is
in date and names the vendor, and when the AI review of it, if it could run,
does not find that it fails to support the vendor's assurance.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import date, datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import Evidence, EvidenceQualityCheck, Tenant, TPRAEvidenceLink, Vendor
from ....services.evidence_quality import QualityTarget, check_and_save, out as quality_out

logger = logging.getLogger(__name__)

CERTIFICATE_MODES = ("off", "prefill", "skip")
_RETIRED = ("archived", "superseded", "rejected", "deleted")
_LEGAL_SUFFIXES = {"inc", "ltd", "llc", "limited", "corp", "corporation", "plc", "gmbh", "co", "company", "sa", "ag", "bv"}


def _day(value) -> Optional[date]:
    return value.date() if isinstance(value, datetime) else value


def question_target(qr, question: dict) -> QualityTarget:
    return QualityTarget(
        kind="tpra_question", ref=f"v{qr.template_version_id or 0}:{question.get('id')}"[:120],
        label=str(question.get("text") or "")[:255], requirement=str(question.get("text") or ""),
        guidance="Evidence a third party supplied to support its answer to this due-diligence question.",
    )


def certificate_target(vendor: Vendor) -> QualityTarget:
    return QualityTarget(
        kind="tpra_certificate", ref=f"vendor:{vendor.id}", label=f"Independent assurance for {vendor.name}"[:255],
        requirement=(f"A current independent assurance report or certification, such as a SOC 2 report or an "
                     f"ISO 27001 certificate, issued to {vendor.name} and covering the services it provides."),
    )


def _review_later(evidence_id: int, tenant_id: int, db: Session, target: QualityTarget) -> None:
    """Read the file if it has not been read, then review it against the target,
    off the request thread. The vendor's upload never waits on either."""
    slug = db.query(Tenant.slug).filter(Tenant.id == tenant_id).scalar()
    if not slug:
        return

    def work():
        from ...evidence.routers.evidence import process_evidence_background
        from ....db import open_tenant_session

        session = open_tenant_session(slug)
        try:
            evidence = session.get(Evidence, evidence_id)
            if evidence is not None and (evidence.ocr_content or "").strip():
                check_and_save(session, tenant_id, evidence, target)       # already read: review only
                session.commit()
                return
        except Exception:  # noqa: BLE001
            logger.exception("questionnaire evidence review failed for evidence %s", evidence_id)
        finally:
            session.close()
        process_evidence_background(evidence_id, slug, target)             # read, then review

    threading.Thread(target=work, name=f"tpra-evidence-{evidence_id}", daemon=True).start()


def attach_upload(db: Session, qr, question: dict, vendor: Optional[Vendor], *, file_path: str, file_name: str,
                  file_type: Optional[str], expires_on: Optional[date]) -> Evidence:
    """A vendor's upload as a library record, linked to the question it answers."""
    now = datetime.utcnow()
    evidence = Evidence(
        tenant_id=qr.tenant_id, name=f"{vendor.name if vendor else 'Vendor'}: {file_name}"[:255],
        description=f"Uploaded by the vendor for: {question.get('text') or question.get('id')}"[:2000],
        file_path=file_path, file_name=file_name, file_type=file_type, uploaded_at=now,
        status="pending_review", ocr_status="pending", evidence_type="vendor_questionnaire",
        source_system="vendor_portal", collection_date=now,
        expiry_date=datetime(expires_on.year, expires_on.month, expires_on.day) if expires_on else None,
    )
    db.add(evidence)
    db.flush()
    db.add(TPRAEvidenceLink(
        tenant_id=qr.tenant_id, vendor_id=qr.vendor_id, assessment_id=qr.assessment_id,
        evidence_id=evidence.id, questionnaire_id=qr.id, question_key=str(question.get("id"))[:100],
        note="Uploaded by the vendor in the questionnaire portal",
    ))
    return evidence


def attach_library(db: Session, qr, question: dict, evidence: Evidence, actor_id: Optional[int],
                   note: str = "Attached from the evidence library") -> TPRAEvidenceLink:
    """Existing library evidence as the answer's evidence; attaching it twice does nothing."""
    key = str(question.get("id"))[:100]
    link = db.query(TPRAEvidenceLink).filter(
        TPRAEvidenceLink.questionnaire_id == qr.id, TPRAEvidenceLink.question_key == key,
        TPRAEvidenceLink.evidence_id == evidence.id, TPRAEvidenceLink.deleted_at.is_(None)).first()
    if link is None:
        link = TPRAEvidenceLink(
            tenant_id=qr.tenant_id, vendor_id=qr.vendor_id, assessment_id=qr.assessment_id,
            evidence_id=evidence.id, questionnaire_id=qr.id, question_key=key, note=note, created_by=actor_id,
        )
        db.add(link)
        db.flush()
    return link


def review(db: Session, qr, question: dict, evidence: Evidence) -> None:
    _review_later(evidence.id, qr.tenant_id, db, question_target(qr, question))


def by_question(db: Session, qr) -> Dict[str, List[dict]]:
    """The library evidence behind each answer, with its review against that question."""
    rows = (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
            .filter(TPRAEvidenceLink.questionnaire_id == qr.id, TPRAEvidenceLink.deleted_at.is_(None))
            .order_by(TPRAEvidenceLink.id).all())
    checks: Dict[tuple, dict] = {}
    if rows:
        for row in db.query(EvidenceQualityCheck).filter(
                EvidenceQualityCheck.tenant_id == qr.tenant_id,
                EvidenceQualityCheck.evidence_id.in_([e.id for _, e in rows]),
                EvidenceQualityCheck.target_kind == "tpra_question"):
            checks[(row.evidence_id, row.target_ref)] = quality_out(row)
    out: Dict[str, List[dict]] = {}
    for link, ev in rows:
        ref = f"v{qr.template_version_id or 0}:{link.question_key}"[:120]
        out.setdefault(link.question_key or "", []).append({
            "link_id": link.id, "evidence_id": ev.id, "name": ev.name, "file_name": ev.file_name,
            "file_path": ev.file_path, "file_type": ev.file_type,
            "expiry_date": ev.expiry_date.isoformat() if ev.expiry_date else None,
            "source": "vendor" if ev.source_system == "vendor_portal" else "library",
            "note": link.note, "quality": checks.get((ev.id, ref)),
        })
    return out


# ── the certificate short-circuit ────────────────────────────────────────────

def _words(text: str) -> str:
    text = re.sub(r"\(.*?\)", " ", (text or "").lower())
    words = [w for w in re.split(r"[^a-z0-9]+", text) if w and w not in _LEGAL_SUFFIXES]
    return " ".join(words)


def names_vendor(text: str, vendor_name: str) -> bool:
    """Does the certificate name the vendor? Case, punctuation, a bracketed aside
    and legal suffixes are ignored.

    ponytail: a plain phrase match; trading names that differ from the legal
    entity will need an alias list on the vendor."""
    wanted = _words(vendor_name)
    return bool(wanted) and f" {wanted} " in f" {_words(text)} "


def covered(questions: List[dict]) -> List[str]:
    """The yes/no questions a template lets a certificate answer."""
    return [str(q.get("id")) for q in questions
            if q.get("certificate_covers") and (q.get("type") or "yes_no") == "yes_no"]


def certificate_problem(db: Session, evidence: Optional[Evidence], vendor: Vendor,
                        today: Optional[date] = None) -> Optional[str]:
    """Why this certificate may not answer questions for this vendor, or None."""
    today = today or datetime.utcnow().date()
    if evidence is None or (evidence.status or "").lower() in _RETIRED:
        return "That certificate is not in the evidence library"
    expiry = _day(evidence.expiry_date)
    if expiry is None:
        return "Record when the certificate expires before using it to answer questions"
    if expiry < today:
        return f"The certificate expired on {expiry:%d %b %Y}"
    text = " ".join((evidence.ocr_content or "").split())
    if not text:
        return "The certificate's text has not been read yet. Try again in a minute."
    if not names_vendor(text, vendor.name):
        return f"The certificate does not name {vendor.name}"
    verdict = check_and_save(db, evidence.tenant_id, evidence, certificate_target(vendor))
    if verdict is not None and verdict.status == "ok" and verdict.covers == "none":
        return f"The AI review found the certificate does not support {vendor.name}'s assurance: {verdict.verdict}"
    return None


def apply_certificate(db: Session, qr, questions: List[dict], evidence: Evidence, mode: str,
                      actor_id: Optional[int]) -> List[str]:
    """Answer the covered questions from the certificate. Returns their keys."""
    keys = covered(questions)
    if not keys:
        raise ValueError("None of this template's questions can be answered by a certificate. "
                         "Mark them in the template first.")
    note = f"Answered by {evidence.name}, valid until {_day(evidence.expiry_date):%d %b %Y}."
    answers, comments = dict(qr.responses or {}), dict(qr.vendor_comments or {})
    by_key = {str(q.get("id")): q for q in questions}
    for key in keys:
        answers[key] = "yes"
        comments[key] = note
        attach_library(db, qr, by_key[key], evidence, actor_id, note="Certificate")
    qr.responses, qr.vendor_comments = answers, comments
    qr.certificate_evidence_id, qr.certificate_mode = evidence.id, mode
    return keys


def locked(qr, questions: List[dict]) -> Dict[str, str]:
    """Answers the vendor cannot change: those a certificate gave in skip mode."""
    if qr.certificate_mode != "skip" or not qr.certificate_evidence_id:
        return {}
    return {key: "yes" for key in covered(questions)}
