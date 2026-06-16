"""Async AI-drafting Celery task.

The synchronous `/governance/documents/ai-draft` endpoint times out on
larger documents because section expansion is 8-13 GPT-4o calls.
Moving the pipeline to a Celery task and tracking progress in Redis
gives the frontend something it can poll without holding an HTTP
connection open for 60-90 seconds.

Job state lives in Redis under `ai_draft_job:<job_id>` with a 1h TTL:

    {
      "status": "queued|running|completed|failed",
      "stage":  "outline|expand_sections|qa|done",
      "sections_total":      <int|null>,
      "sections_completed":  <int>,
      "elapsed_ms":          <int>,
      "started_at":          <iso>,
      "completed_at":        <iso|null>,
      "result":              <DraftResult-shaped dict|null>,
      "error":               <str|null>,
    }
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from celery import shared_task
from sqlalchemy.orm import Session

from .base import TenantTask, get_redis

logger = logging.getLogger(__name__)


JOB_KEY_PREFIX = "ai_draft_job:"
JOB_TTL_SECONDS = 60 * 60  # 1h — long enough for the frontend to fetch
                            # even when the user closes the tab and comes
                            # back to it later.


# ─── Job state I/O ──────────────────────────────────────────────────

def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


def _read_job(job_id: str) -> Optional[Dict[str, Any]]:
    try:
        raw = get_redis().get(_job_key(job_id))
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _write_job(job_id: str, payload: Dict[str, Any]) -> None:
    try:
        get_redis().set(_job_key(job_id), json.dumps(payload), ex=JOB_TTL_SECONDS)
    except Exception:
        logger.exception("Failed to persist ai_draft_job %s", job_id)


def create_job(*, tenant_id: int, request_summary: Dict[str, Any]) -> str:
    """Allocate a job id and write the initial 'queued' record."""
    job_id = uuid.uuid4().hex
    _write_job(job_id, {
        "job_id": job_id,
        "tenant_id": tenant_id,
        "status": "queued",
        "stage": "queued",
        "sections_total": None,
        "sections_completed": 0,
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "elapsed_ms": 0,
        "request": request_summary,
        "result": None,
        "error": None,
    })
    return job_id


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Public read for the polling endpoint."""
    return _read_job(job_id)


# ─── Threaded background runner (default path) ──────────────────────
# The drafting pipeline takes 30–90s. Rather than depend on a running
# Celery worker (the common dev failure mode is "broker accepts the task
# but no worker is consuming"), we run the job in a Python thread inside
# the FastAPI process. The thread opens its own DB session via
# `open_tenant_session(slug)` and writes progress to Redis the same way
# the Celery task does, so the polling endpoint is identical for both
# paths.

def dispatch_in_thread(tenant_slug: str, job_id: str, request_payload: Dict[str, Any]) -> None:
    """Run the drafting pipeline on a daemon thread. Returns immediately."""
    import threading
    t = threading.Thread(
        target=_run_drafting_with_own_session,
        args=(tenant_slug, job_id, request_payload),
        daemon=True,
        name=f"ai-draft-{job_id[:8]}",
    )
    t.start()


def _run_drafting_with_own_session(
    tenant_slug: str, job_id: str, request_payload: Dict[str, Any]
) -> None:
    """Thread entry-point. Opens a tenant-scoped session, then delegates
    to the shared `_execute_drafting()` worker.

    Any uncaught exception is recorded into the job state so the polling
    endpoint can surface it — the thread itself never raises.
    """
    from ..db import open_tenant_session
    try:
        db = open_tenant_session(tenant_slug)
    except Exception as exc:
        logger.exception("Failed to open tenant session for draft job %s", job_id)
        payload = _read_job(job_id) or {}
        payload.update({
            "status": "failed",
            "stage": "failed",
            "error": f"Could not open tenant DB session: {exc}",
            "completed_at": datetime.utcnow().isoformat(),
        })
        _write_job(job_id, payload)
        return

    try:
        _execute_drafting(job_id, request_payload, db)
        try:
            db.commit()
        except Exception:
            db.rollback()
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("Drafting thread crashed for job %s", job_id)
        payload = _read_job(job_id) or {}
        payload.update({
            "status": "failed",
            "stage": "failed",
            "error": str(exc),
            "completed_at": datetime.utcnow().isoformat(),
        })
        _write_job(job_id, payload)
    finally:
        try:
            db.close()
        except Exception:
            pass


def _execute_drafting(
    job_id: str, request_payload: Dict[str, Any], db: Session
) -> Dict[str, Any]:
    """Shared body for both the thread and the Celery task path.

    Reads `request_payload`, runs the pipeline with a progress callback
    that streams stage transitions into Redis, then writes the final
    `result` payload to the job record.
    """
    started = time.monotonic()
    started_iso = datetime.utcnow().isoformat()

    from ..models import CertificationJourney, GovernanceDocument, PolicyStatement
    from ..modules.governance.ai_drafting import (
        build_framework_index,
        build_tenant_context,
        run_drafting_pipeline,
    )

    def progress_cb(stage: str, detail: Dict[str, Any]) -> None:
        existing = _read_job(job_id) or {}
        sections_total = detail.get("sections_total") or existing.get("sections_total")
        sections_completed = detail.get("sections_completed", existing.get("sections_completed", 0))
        existing.update({
            "status": "running",
            "stage": stage,
            "stage_status": detail.get("status"),
            "sections_total": sections_total,
            "sections_completed": sections_completed,
            "last_section": detail.get("last_section") or existing.get("last_section"),
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        })
        _write_job(job_id, existing)

    try:
        tenant_id = request_payload["tenant_id"]
        doc_type = request_payload["doc_type"]
        title = request_payload["title"]
        description = request_payload.get("description")
        framework_ids = request_payload.get("framework_ids") or []
        parent_document_id = request_payload.get("parent_document_id")

        # Resolve journey ids the same way the sync endpoint did.
        journey_ids: Optional[list] = None
        if framework_ids:
            rows = db.query(CertificationJourney.id).filter(
                CertificationJourney.tenant_id == tenant_id,
                CertificationJourney.uploaded_framework_id.in_(framework_ids),
            ).all()
            journey_ids = [r[0] for r in rows] or None

        parent_document_context: Optional[str] = None
        # NCA path passes a raw blob; governance path passes an ID we resolve.
        if request_payload.get("parent_document_text"):
            parent_document_context = request_payload["parent_document_text"]
        elif parent_document_id:
            parent = db.query(GovernanceDocument).filter(
                GovernanceDocument.id == parent_document_id,
                GovernanceDocument.tenant_id == tenant_id,
            ).first()
            if parent:
                # Previously the parent was reduced to a 6 KB excerpt with no
                # structure. The pipeline could not see how many policy
                # statements lived on the parent, so a child Procedure would
                # be drafted in isolation and only loosely follow the parent.
                # We now:
                #   1. Load every PolicyStatement attached to the parent so
                #      the child draft has a hard list it must cover.
                #   2. Raise the parent-content cap to 20 KB (still bounded).
                #   3. Emit a single structured block that the Stage A / B
                #      prompts both treat as authoritative.
                excerpt = (parent.content or "").strip()
                if len(excerpt) > 20000:
                    excerpt = excerpt[:20000] + "\n...[truncated for prompt size]"

                # Pull every active statement on the parent. Cap at 60 so a
                # pathological parent (e.g. a regulator's 400-clause catalog)
                # can't blow the prompt; the cap is logged so we can spot it.
                statements = (
                    db.query(PolicyStatement)
                    .filter(
                        PolicyStatement.tenant_id == tenant_id,
                        PolicyStatement.document_id == parent.id,
                        PolicyStatement.status == "active",
                    )
                    .order_by(PolicyStatement.id.asc())
                    .limit(60)
                    .all()
                )
                statements_total = (
                    db.query(PolicyStatement)
                    .filter(
                        PolicyStatement.tenant_id == tenant_id,
                        PolicyStatement.document_id == parent.id,
                        PolicyStatement.status == "active",
                    )
                    .count()
                )

                statement_lines: list[str] = []
                if statements:
                    if statements_total > len(statements):
                        statement_lines.append(
                            f"PARENT POLICY STATEMENTS ({len(statements)} of {statements_total} shown — "
                            "the remaining statements are summarised by the excerpts that follow):"
                        )
                    else:
                        statement_lines.append(
                            f"PARENT POLICY STATEMENTS ({len(statements)} total) — every statement "
                            "below MUST be addressed end-to-end in the new document. For a Procedure, "
                            "produce ordered procedural steps that operationalise each statement; for "
                            "a Standard, produce mandatory requirements that satisfy each statement; "
                            "for a Guideline, produce implementation guidance for each statement."
                        )
                    for idx, s in enumerate(statements, start=1):
                        code = s.statement_code or f"PS-{idx:03d}"
                        prio = (s.priority or "medium").upper()
                        cat = s.category or "general"
                        # Bound each statement to 800 chars so 60 statements
                        # never alone push the prompt past the model window.
                        txt = (s.statement_text or "").strip()
                        if len(txt) > 800:
                            txt = txt[:800] + "…"
                        summary = (s.statement_summary or "").strip()
                        suffix = f"  Summary: {summary}" if summary else ""
                        statement_lines.append(
                            f"{idx}. [{code}] [priority={prio}] [category={cat}]\n"
                            f"   Statement: {txt}{suffix}"
                        )
                else:
                    statement_lines.append(
                        "PARENT POLICY STATEMENTS: none extracted yet. Treat the parent "
                        "document's content excerpt below as the authoritative source of "
                        "requirements the new document must cover."
                    )

                statements_block = "\n".join(statement_lines)

                parent_document_context = (
                    "PARENT DOCUMENT — the document being drafted is SUBORDINATE to this "
                    "and must cover every parent requirement end-to-end.\n"
                    f"Title: {parent.title}\n"
                    f"Type:  {parent.doc_type}\n"
                    f"Description: {parent.description or '(none)'}\n"
                    "\n"
                    f"{statements_block}\n"
                    "\n"
                    "PARENT DOCUMENT FULL CONTENT (use as the source of intent, terminology, "
                    "definitions, role names, and control objectives — do NOT contradict it):\n"
                    f"{excerpt or '(parent has no body content; rely on statements above)'}"
                )

        # Mark running before the slow part.
        _write_job(job_id, {
            **(_read_job(job_id) or {}),
            "status": "running",
            "stage": "context",
            "started_at": started_iso,
        })

        tenant_context = build_tenant_context(tenant_id, db)
        framework_index = build_framework_index(tenant_id, db, journey_ids=journey_ids)

        result = run_drafting_pipeline(
            doc_type=doc_type,
            title=title,
            description=description,
            tenant_context=tenant_context,
            framework_index=framework_index,
            parent_document_context=parent_document_context,
            document_owner_name=tenant_context.primary_contact_name,
            progress_callback=progress_cb,
        )

        elapsed = int((time.monotonic() - started) * 1000)
        suggested_sections = [
            {"heading": s["heading"], "content": s["content"]}
            for s in result.sections
        ]
        word_count = result.word_count
        estimated_review_time = f"{max(5, word_count // 100)} minutes"

        # NCA "save as document" path — auto-persist the generated draft
        # so the user doesn't have to click through a second time.
        new_document_id: Optional[int] = None
        if request_payload.get("save_as_document"):
            try:
                from ..routers.nca_templates_router import _next_document_code
                doc = GovernanceDocument(
                    tenant_id=tenant_id,
                    document_code=_next_document_code(tenant_id, doc_type, db),
                    title=result.title,
                    description=(
                        f"AI-drafted using NCA template: "
                        f"{request_payload.get('source_template_title', 'template')}"
                    ),
                    content=result.generated_content,
                    doc_type=doc_type,
                    classification=request_payload.get("classification") or "internal",
                    current_version="1.0",
                    status="draft",
                    author_id=request_payload.get("user_id"),
                    author_name=request_payload.get("user_name"),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(doc)
                db.commit()
                db.refresh(doc)
                new_document_id = doc.id
            except Exception:
                logger.exception("Failed to persist auto-saved drafted document")

        payload = _read_job(job_id) or {}
        payload.update({
            "status": "completed",
            "stage": "done",
            "completed_at": datetime.utcnow().isoformat(),
            "elapsed_ms": elapsed,
            "sections_total": payload.get("sections_total"),
            "sections_completed": payload.get("sections_total") or payload.get("sections_completed", 0),
            "result": {
                "generated_content": result.generated_content,
                "suggested_title": result.title,
                "suggested_sections": suggested_sections,
                "framework_alignment": result.framework_alignment,
                "word_count": word_count,
                "estimated_review_time": estimated_review_time,
                "qa_failures": result.qa_failures,
                "stage_telemetry": result.stage_telemetry,
                "document_id": new_document_id,
            },
        })
        _write_job(job_id, payload)
        return {"job_id": job_id, "status": "completed", "elapsed_ms": elapsed}

    except Exception as exc:
        logger.exception("ai_drafting._execute_drafting failed (job %s)", job_id)
        payload = _read_job(job_id) or {}
        payload.update({
            "status": "failed",
            "stage": "failed",
            "error": str(exc),
            "completed_at": datetime.utcnow().isoformat(),
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        })
        _write_job(job_id, payload)
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


# ─── Celery wrapper (optional production path) ──────────────────────
# Production deployments that want job isolation can run a Celery worker
# subscribed to `parsing`; this task simply delegates to the shared
# `_execute_drafting()` body. The default endpoint path uses
# `dispatch_in_thread()` so the feature works without any worker.

@shared_task(
    base=TenantTask,
    name="ai_drafting.generate_draft",
    bind=True,
    max_retries=0,
    autoretry_for=(),
)
def generate_draft(
    self,
    tenant_slug: str,
    job_id: str,
    request_payload: Dict[str, Any],
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """Celery wrapper around `_execute_drafting`. Same observable
    behaviour as `dispatch_in_thread()` — writes progress to Redis under
    the same key shape so the polling endpoint sees both paths."""
    assert db is not None
    return _execute_drafting(job_id, request_payload, db)
