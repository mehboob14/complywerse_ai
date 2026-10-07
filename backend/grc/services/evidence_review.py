"""What happens to a file after it is uploaded, and what the person sees while it does.

Wherever evidence is uploaded the same follow-up should run: the file is read (OCR), it is rated for how mature it
is as audit evidence (a score out of 100, what is missing, how to close it), and, slowest of the three, the
framework clauses it appears to answer are suggested. Each upload path used to start a thread of its own for this,
nothing recorded how far it had got, and the page waited on one browser request. A run that failed, or that died
with the server, looked like "AI assessing..." for ever.

The run's progress is written on the evidence row (`ai_review`), so any page can show it and any server can see that
a run was lost: one that has been silent for STALE_AFTER is reported as stopped, and the next visit starts it again.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..models import Evidence, EvidenceAIAssessment, EvidenceQualityCheck

logger = logging.getLogger(__name__)

# One model call is capped at four minutes and every step (and every attempt) writes a heartbeat, so silence
# for longer than this means the run is gone, not slow.
STALE_AFTER = timedelta(minutes=6)
OCR_STALE_AFTER = timedelta(minutes=10)
QUEUED, RUNNING, DONE, FAILED, UNAVAILABLE = "queued", "running", "done", "failed", "unavailable"
ACTIVE = (QUEUED, RUNNING)

_active: set = set()               # (tenant, evidence id) with a run in this process
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.utcnow()


def _iso() -> str:
    return _now().isoformat()


def _when(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


# ── What the row says ────────────────────────────────────────────────────────

def state(evidence: Any) -> Dict[str, Any]:
    """The review as recorded; a run that has gone silent is reported as stopped, not as running for ever."""
    raw = dict(getattr(evidence, "ai_review", None) or {})
    if raw.get("status") in ACTIVE:
        beat = _when(raw.get("updated_at") or raw.get("started_at"))
        if beat is None or _now() - beat > STALE_AFTER:
            raw.update(status=FAILED, stopped=True, error="The review stopped before it finished. Try again.")
    return raw


def public(evidence: Any) -> Dict[str, Any]:
    """The part of the state a list row needs."""
    raw = state(evidence)
    return {"status": raw.get("status"), "step": raw.get("step") if raw.get("status") in ACTIVE else None,
            "error": raw.get("error") if raw.get("status") in (FAILED, UNAVAILABLE) else None,
            "mapping_error": raw.get("mapping_error"), "mapping_skipped": bool(raw.get("mapping_skipped")),
            "stopped": bool(raw.get("stopped"))}


def _save(db: Session, evidence: Evidence, **fields: Any) -> None:
    """Record progress. Every write is a heartbeat, so a run still working is never mistaken for a lost one."""
    evidence.ai_review = {**(evidence.ai_review or {}), **fields, "updated_at": _iso()}
    db.commit()


def latest_assessment(db: Session, evidence_id: int) -> Optional[EvidenceAIAssessment]:
    return (db.query(EvidenceAIAssessment).filter(EvidenceAIAssessment.evidence_id == evidence_id)
            .order_by(desc(EvidenceAIAssessment.assessed_at), desc(EvidenceAIAssessment.id)).first())


def ocr_stalled(evidence: Evidence) -> bool:
    """Reading the file started and nothing has come of it: the server that was reading it is gone."""
    if (evidence.ocr_status or "") not in ("pending", "processing") or evidence.ocr_content:
        return False
    since = _when((evidence.ai_review or {}).get("updated_at")) or evidence.uploaded_at
    return bool(since) and _now() - since > OCR_STALE_AFTER


def payload(db: Session, evidence: Evidence) -> Dict[str, Any]:
    """Everything a page needs to say where the review stands: the run, the rating, and what it was rated against."""
    from .evidence_quality import out

    raw = state(evidence)
    assessment = latest_assessment(db, evidence.id)
    status = raw.get("status") or (DONE if assessment else None)
    rows = (db.query(EvidenceQualityCheck).filter(EvidenceQualityCheck.evidence_id == evidence.id)
            .order_by(desc(EvidenceQualityCheck.checked_at)).all())
    return {
        "evidence_id": evidence.id,
        "status": status,
        "step": raw.get("step") if status in ACTIVE else None,
        "error": raw.get("error") if status in (FAILED, UNAVAILABLE) else None,
        "mapping_error": raw.get("mapping_error") if status == DONE else None,
        "mapping_skipped": bool(raw.get("mapping_skipped")) if status == DONE else False,
        "stopped": bool(raw.get("stopped")),
        "started_at": raw.get("started_at"), "updated_at": raw.get("updated_at"), "finished_at": raw.get("finished_at"),
        "ocr_status": evidence.ocr_status, "ocr_stalled": ocr_stalled(evidence),
        "has_assessment": assessment is not None,
        "mappings": len(assessment.clause_mappings or []) if assessment else 0,
        "quality_score": evidence.quality_score,
        "checks": [out(r) for r in rows],
    }


def plain(exc: BaseException) -> str:
    """What went wrong, for the person: never the provider's own words (they name the model)."""
    from fastapi import HTTPException

    if isinstance(exc, HTTPException):
        code, detail = exc.status_code, str(exc.detail or "")
        if code == 402:
            return "The AI budget for this workspace has been used up."
        if code == 503:
            return "AI isn't set up on this server: no AI key is configured."
        if code == 502 and "couldn't be read" in detail:
            return "The AI answered in a form that could not be read, so nothing was saved. Try again."
        if code in (400, 404, 422) and detail:
            return detail
    if type(exc).__name__ in ("AIUnavailable",):
        return str(exc)
    if "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower():
        return "The AI service took too long to answer. Try again."
    return "The AI service returned an error. Try again; if it keeps failing, ask an administrator to check the AI settings."


# ── Running it ───────────────────────────────────────────────────────────────

def _spawn(job: Callable[[], None]) -> None:
    threading.Thread(target=job, daemon=True, name="evidence-review").start()


def start(db: Session, evidence: Evidence, tenant_slug: Optional[str], *, target: Any = None,
          user_id: Optional[int] = None, force: bool = False, only_mappings: bool = False, matching: bool = True) -> bool:
    """Queue the review and run it in the background. False when one is already running. With `matching=False`
    the file is read and rated but not matched to framework clauses: for an upload from somewhere with no use for
    suggestions (the page for the file offers them on request)."""
    if not tenant_slug:
        logger.error("evidence review: no tenant given for evidence %s", evidence.id)
        return False
    evidence_id = evidence.id
    key = (tenant_slug, evidence_id)
    row = db.query(Evidence).filter(Evidence.id == evidence_id).with_for_update().first() or evidence
    if state(row).get("status") in ACTIVE and not force:
        db.rollback()                                   # another server is on it
        return False
    with _lock:
        if key in _active:
            db.rollback()                               # this one is
            return False
        _active.add(key)
    try:
        _save(db, row, status=QUEUED, step="reading", error=None, mapping_error=None, mapping_skipped=None,
              stopped=None, started_at=_iso(), finished_at=None)
    except Exception:
        with _lock:
            _active.discard(key)
        raise

    def job() -> None:
        try:
            run(evidence_id, tenant_slug, target, user_id, only_mappings=only_mappings, matching=matching)
        finally:
            with _lock:
                _active.discard(key)

    try:
        _spawn(job)
    except Exception:
        with _lock:
            _active.discard(key)
        raise
    return True


def ensure(db: Session, evidence: Evidence, tenant_slug: Optional[str], user_id: Optional[int] = None) -> bool:
    """Start the review when a file should have one and nothing is on it: a file from before reviews were
    recorded, or one whose run was lost. A run that failed for a reason waits for a person to ask again."""
    raw = state(evidence)
    status = raw.get("status")
    if status in ACTIVE or status == UNAVAILABLE:
        return False
    if status == DONE or (status is None and latest_assessment(db, evidence.id)):
        return False
    if status == FAILED and not raw.get("stopped"):
        return False
    if (evidence.ocr_status or "") in ("pending", "processing") and not ocr_stalled(evidence):
        return False                                    # still being read by the upload that started it
    if (evidence.ocr_status or "") == "failed" and not evidence.ocr_content:
        return False                                    # reading failed: that has its own retry
    return start(db, evidence, tenant_slug, user_id=user_id)


def rate_upload(db: Session, evidence: Any, user_id: Optional[int] = None, *, target: Any = None, matching: bool = False) -> None:
    """Rate a file just uploaded from a module of its own (the file, or its id), once the upload has been committed:
    it is read and rated for maturity, and the Evidence library shows the result. The slow matching to framework
    clauses is left to the file's own page, which offers it. An upload never fails over its follow-up."""
    try:
        row = db.get(Evidence, evidence) if isinstance(evidence, int) else evidence
        if row is not None:
            start(db, row, db.info.get("tenant_slug"), target=target, user_id=user_id, matching=matching)
    except Exception:  # noqa: BLE001
        logger.exception("Could not start the review of evidence %s", getattr(evidence, "id", evidence))
        db.rollback()


def run(evidence_id: int, tenant_slug: str, target: Any = None, user_id: Optional[int] = None, *,
        only_mappings: bool = False, matching: bool = True,
        open_session: Optional[Callable[[str], Session]] = None) -> None:
    """Read, rate and match one file, recording where it has got to. Never raises: what went wrong is on the row.

    `target` is a `services.evidence_quality.QualityTarget` when the upload knows what the file is meant to prove
    (an assessment item, a requirement, a control): the file is then also rated against that one thing, first,
    because it is what the person who just attached the file is waiting for."""
    from ..db import open_tenant_session
    from .ai_usage import usage_scope

    if not tenant_slug:
        logger.error("evidence review called without a tenant for evidence %s", evidence_id)
        return
    try:
        db = (open_session or open_tenant_session)(tenant_slug)
    except Exception:  # noqa: BLE001 — nothing can be recorded without the workspace's database
        logger.exception("Evidence review could not open the database of %s", tenant_slug)
        return
    try:
        with usage_scope(tenant_slug=tenant_slug, actor_user_id=user_id, background_job_id=f"evidence-review-{evidence_id}",
                         module_key="evidence", feature_key="evidence_review"):
            _run(db, evidence_id, target, user_id, only_mappings, matching)
    except Exception as exc:  # noqa: BLE001 — whatever it was, the page must not wait on it
        logger.exception("Evidence review crashed for evidence %s", evidence_id)
        try:
            db.rollback()
            row = db.query(Evidence).filter(Evidence.id == evidence_id).first()
            if row is not None:
                _save(db, row, status=FAILED, step=None, error=plain(exc), finished_at=_iso())
        except Exception:  # noqa: BLE001
            logger.exception("Could not record the failed review of evidence %s", evidence_id)
    finally:
        db.close()


def _run(db: Session, evidence_id: int, target: Any, user_id: Optional[int], only_mappings: bool,
         matching: bool = True) -> None:
    from ..modules.evidence.routers import ai_assessment
    from ..modules.evidence.routers import ocr
    from .evidence_quality import check_and_save

    ev = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    if ev is None:
        return
    user_id = user_id or ev.uploaded_by
    started = (ev.ai_review or {}).get("started_at") or _iso()
    _save(db, ev, status=RUNNING, step="reading", error=None, mapping_error=None, mapping_skipped=None,
          stopped=None, started_at=started, finished_at=None)

    def report(step: str, **fields: Any) -> None:
        _save(db, ev, status=RUNNING, step=step, **fields)

    def finish(**fields: Any) -> None:
        _save(db, ev, step=None, finished_at=_iso(), **fields)

    # 1. Read the file.
    if not only_mappings and not ev.ocr_content:
        if ocr.get_file_extension(ev) not in ocr.PROCESSABLE_FILE_TYPES:
            kind = (ocr.get_file_extension(ev) or "this").upper()
            return finish(status=UNAVAILABLE, error=f"AI can't read {kind} files yet, so this one can't be rated. "
                                                    "Upload a PDF, Word, Excel, text or image file to have it rated.")
        try:
            ocr_error = getattr(ocr.process_evidence_ocr(ev, db), "message", None) or ""
        except Exception as exc:  # noqa: BLE001
            logger.exception("OCR failed for evidence %s", evidence_id)
            db.rollback()
            db.refresh(ev)
            ev.ocr_status = "failed"
            db.commit()
            ocr_error = plain(exc)
        db.refresh(ev)
        if not ev.ocr_content:
            if target is not None:                       # records "no readable text" on the item's row
                check_and_save(db, ev.tenant_id, ev, target, user_id=user_id)
            return finish(status=FAILED, error=f"No text could be read from this file, so it could not be rated. {ocr_error}")

    if not ev.ocr_content:
        return finish(status=FAILED, error="No text could be read from this file, so it could not be rated.")

    # 2. Rate it against the one thing it was attached to.
    if not only_mappings and target is not None:
        report("rating")
        try:
            check_and_save(db, ev.tenant_id, ev, target, user_id=user_id)
        except Exception:  # noqa: BLE001 — its own failures are recorded on the row; this guards the unexpected
            logger.exception("Evidence quality check failed for evidence %s", evidence_id)
            db.rollback()
            db.refresh(ev)

    # 3. Rate it as audit evidence, then match it to framework clauses.
    try:
        if only_mappings:
            ai_assessment.run_mapping_stage(ev, db, report=report)
        else:
            ai_assessment.run_ai_assessment(ev, db, user_id=user_id, report=report, matching=matching)
    except Exception as exc:  # noqa: BLE001
        logger.exception("AI assessment failed for evidence %s", evidence_id)
        db.rollback()
        db.refresh(ev)
        rated = latest_assessment(db, ev.id)
        began = _when((ev.ai_review or {}).get("started_at"))
        if rated is not None and (only_mappings or (began and rated.assessed_at and rated.assessed_at >= began)):
            return finish(status=DONE, error=None, mapping_error=plain(exc))   # rated; the clause matching did not finish
        return finish(status=FAILED, error=plain(exc))
    finish(status=DONE, error=None, mapping_error=None, mapping_skipped=not matching and not only_mappings or None)
