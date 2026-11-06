"""Does this file prove the thing it was attached to?

Wherever evidence is uploaded — an assessment item, a framework requirement, a
control — this reads the file's extracted text and answers one question about one
target: is it covered, what is missing, and what would make it hold up in an
audit. The Evidence library's own AI assessment answers a different question
(which framework clauses does this file appear to map to), so it cannot say
whether a file is good enough for the item it was just attached to.

The requirement's own wording is what makes the answer worth reading, so a target
carries it. SCF wording is licence-restricted and never leaves the process: such
a target is marked restricted, the check is made against the control's code and
name, and the verdict records ``basis="identifier_only"`` so nobody mistakes it
for a judgement of the requirement's substance.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ..config import get_openai_model
from ..models import Evidence, EvidenceQualityCheck
from .assessment_evidence_ai import AIUnavailable, _parse, _text, openai_complete

logger = logging.getLogger(__name__)

PROMPT_VERSION = "1.0"
_MAX_TEXT = 12000          # the Evidence assessment's own cap, for the same reason
_COVERS = ("full", "partial", "none")

SYSTEM = (
    "You are a GRC auditor reviewing one piece of evidence against one requirement. "
    "Judge only what the text actually shows. A document saying a control should exist is not "
    "proof that it operates. If the text does not address the requirement, say so plainly — "
    "a clear 'this does not prove it' is more useful than a generous score."
)


@dataclass(frozen=True)
class QualityTarget:
    """What the evidence is supposed to prove."""

    kind: str                      # assessment_item | framework_requirement | control | issue | observation
    ref: str                       # the code a person would recognise
    label: str = ""                # its title
    requirement: str = ""          # the ask, in the tenant's own words
    guidance: str = ""             # expected evidence, remarks, test procedure
    restricted: bool = False       # requirement wording is licence-restricted

    @property
    def basis(self) -> str:
        return "identifier_only" if self.restricted or not self.requirement.strip() else "requirement_text"


def _prompt(target: QualityTarget, evidence: Evidence, text: str) -> str:
    if target.basis == "requirement_text":
        lines = [
            f"REQUIREMENT {target.ref}: {_text(target.label, 300) or '-'}",
            f"WHAT IT ASKS FOR: {_text(target.requirement, 2000)}",
        ]
        if target.guidance:
            lines.append(f"NOTES: {_text(target.guidance, 600)}")
    else:
        # Licensed catalogues: the code identifies the control without quoting it.
        # Its title is withheld too, because the licence covers the wording.
        lines = [
            f"REQUIREMENT: {target.ref}",
            "WHAT IT ASKS FOR: not available here — the requirement's wording is licensed and "
            "cannot be quoted. Judge against the code above using your own knowledge of what that "
            "control requires, and say in your verdict that this is an indicative check made "
            "without the requirement's own wording.",
        ]
    lines += [
        f"\nEVIDENCE FILE: {_text(evidence.name, 200) or '-'}"
        f" ({evidence.file_name or 'no file name'}, type {evidence.evidence_type or 'unspecified'})",
        f"EVIDENCE TEXT:\n{text[:_MAX_TEXT]}",
        "\nReturn JSON: {\"covers\": \"full|partial|none\", \"score\": 0-100, \"confidence\": 0-100, "
        "\"verdict\": \"one sentence a reviewer can act on\", "
        "\"strengths\": [\"what this file does prove, quoting what you saw\"], "
        "\"gaps\": [\"what the requirement asks for that this file does not show\"], "
        "\"improvements\": [\"the smallest change that would close each gap\"], "
        "\"as_of\": \"the date the evidence describes, YYYY-MM-DD, or null if it carries none\"}. "
        "score is how well this file alone proves the requirement. Keep each list to at most four "
        "short entries.",
    ]
    return "\n".join(lines)


def _clamp(value: Any, default: int = 0) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def check(evidence: Evidence, target: QualityTarget,
         complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> Dict[str, Any]:
    """The verdict for one (evidence, target) pair. Never raises: a check that
    could not run says why, because an upload must not fail over its review."""
    text = " ".join((evidence.ocr_content or "").split())
    base = {
        "basis": target.basis,
        "model": get_openai_model(),
        "prompt_version": PROMPT_VERSION,
        "content_hash": hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest() if text else None,
    }
    if not text:
        return {**base, "status": "no_text",
                "note": "No text could be extracted from this file yet, so it cannot be reviewed."}

    try:
        answer = _parse((complete or openai_complete)([
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": _prompt(target, evidence, text)},
        ]))
    except AIUnavailable as exc:
        return {**base, "status": "failed", "note": str(exc)}
    except Exception as exc:  # noqa: BLE001 — provider, network, or the licence guard
        if type(exc).__name__ == "LicenceRestrictedContent":
            return {**base, "status": "licence_restricted",
                    "note": "Licensed control wording cannot be sent to the model, so this file "
                            "was not reviewed against it."}
        logger.exception("evidence quality check failed for evidence %s", evidence.id)
        return {**base, "status": "failed", "note": "The review could not be completed."}

    covers = str(answer.get("covers") or "").strip().lower()
    score = _clamp(answer.get("score"))
    if covers not in _COVERS:
        covers = "full" if score >= 80 else "partial" if score >= 40 else "none"

    def listed(key: str, limit: int = 4) -> List[str]:
        raw = answer.get(key)
        items = raw if isinstance(raw, list) else []
        return [_text(i, 300) for i in items if _text(i, 300)][:limit]

    return {
        **base,
        "status": "ok",
        "covers": covers,
        "score": score,
        "confidence": _clamp(answer.get("confidence"), 50),
        "verdict": _text(answer.get("verdict"), 500),
        "detail": {
            "strengths": listed("strengths"),
            "gaps": listed("gaps"),
            "improvements": listed("improvements"),
            "as_of": _text(answer.get("as_of"), 40) or None,
        },
    }


def save(db: Session, tenant_id: int, evidence_id: int, target: QualityTarget,
         result: Dict[str, Any], user_id: Optional[int] = None) -> EvidenceQualityCheck:
    """One row per (evidence, target): a re-check replaces the verdict."""
    row = db.query(EvidenceQualityCheck).filter(
        EvidenceQualityCheck.tenant_id == tenant_id,
        EvidenceQualityCheck.evidence_id == evidence_id,
        EvidenceQualityCheck.target_kind == target.kind,
        EvidenceQualityCheck.target_ref == target.ref,
    ).first()
    if row is None:
        row = EvidenceQualityCheck(tenant_id=tenant_id, evidence_id=evidence_id,
                                   target_kind=target.kind, target_ref=target.ref,
                                   created_by=user_id)
        db.add(row)
    row.target_label = _text(target.label, 255) or None
    row.covers = result.get("covers")
    row.score = result.get("score")
    row.confidence = result.get("confidence")
    row.verdict = result.get("verdict")
    row.detail = result.get("detail")
    row.basis = result.get("basis")
    row.status = result.get("status") or "ok"
    row.note = result.get("note")
    row.model_version = result.get("model")
    row.prompt_version = result.get("prompt_version")
    row.content_hash = result.get("content_hash")
    row.checked_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def check_and_save(db: Session, tenant_id: int, evidence: Evidence, target: QualityTarget,
                   user_id: Optional[int] = None, force: bool = False) -> Optional[EvidenceQualityCheck]:
    """Review the file against the target unless the same text was already
    reviewed against it — nothing here is worth a second call to the model."""
    if not force:
        existing = db.query(EvidenceQualityCheck).filter(
            EvidenceQualityCheck.tenant_id == tenant_id,
            EvidenceQualityCheck.evidence_id == evidence.id,
            EvidenceQualityCheck.target_kind == target.kind,
            EvidenceQualityCheck.target_ref == target.ref,
            EvidenceQualityCheck.status == "ok",
        ).first()
        if existing is not None:
            text = " ".join((evidence.ocr_content or "").split())
            same = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest() if text else None
            if same and existing.content_hash == same:
                return existing
    return save(db, tenant_id, evidence.id, target, check(evidence, target), user_id)


def out(row: Optional[EvidenceQualityCheck]) -> Optional[Dict[str, Any]]:
    """The verdict as the UI reads it."""
    if row is None:
        return None
    return {
        "status": row.status,
        "covers": row.covers,
        "score": row.score,
        "confidence": row.confidence,
        "verdict": row.verdict,
        "detail": row.detail or {},
        "basis": row.basis,
        "note": row.note,
        "target": {"kind": row.target_kind, "ref": row.target_ref, "label": row.target_label},
        "checked_at": row.checked_at.isoformat() if row.checked_at else None,
    }


def for_evidence(db: Session, tenant_id: int, evidence_ids: List[int],
                 target: Optional[QualityTarget] = None) -> Dict[int, Dict[str, Any]]:
    """Verdicts by evidence id, for a list of evidence on one page."""
    if not evidence_ids:
        return {}
    q = db.query(EvidenceQualityCheck).filter(
        EvidenceQualityCheck.tenant_id == tenant_id,
        EvidenceQualityCheck.evidence_id.in_(list(evidence_ids)[:500]),
    )
    if target is not None:
        q = q.filter(EvidenceQualityCheck.target_kind == target.kind,
                     EvidenceQualityCheck.target_ref == target.ref)
    return {row.evidence_id: out(row) for row in q.order_by(EvidenceQualityCheck.checked_at.desc())}
