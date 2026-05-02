"""
Control library Celery tasks.

`ai_compare_frameworks` is the heavy AI cross-framework mapping job. For each
control in the source framework, it asks an LLM to identify similar controls
in the destination framework, persists every (source → dest) pair as a
`ControlComparisonMapping` row, and updates the parent `ControlComparisonRun`
with progress so the UI can poll.

Cached at the (tenant, source_framework, dest_framework) level: re-running
the same pair returns the existing run unless the caller explicitly forces
a refresh (which deletes the old run before dispatching).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from ..job_status import set_status
from .base import TenantTask, tenant_lock, LockNotAcquired

logger = logging.getLogger(__name__)


# How many destination controls to put in a single LLM call. The combined
# context is bounded by `MAX_DEST_CHARS` below; chunking is purely a token
# safety net so a 1000-control destination doesn't blow up the prompt.
DEST_CHUNK_SIZE = 80
MAX_DEST_CHARS = 30000


def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "…"


def _short_control(c) -> Dict[str, Any]:
    return {
        "id": c.id,
        "reference": (c.original_reference or c.control_id or "")[:120],
        "title": _truncate(c.title or "", 200),
        "description": _truncate(c.description or "", 800),
        "domain": (c.domain or "")[:120],
        "category": (c.category or "")[:120],
    }


def _build_prompt(source_ctrl, dest_ctrls: List[Dict[str, Any]], source_fw_name: str, dest_fw_name: str) -> str:
    return f"""You are a GRC compliance expert mapping controls across regulatory frameworks.

Compare ONE source control against a list of destination controls. Identify
which destination controls address the same or substantially overlapping
compliance requirements.

SOURCE FRAMEWORK: {source_fw_name}
SOURCE CONTROL:
  Reference: {source_ctrl["reference"]}
  Title: {source_ctrl["title"]}
  Description: {source_ctrl["description"]}
  Domain: {source_ctrl["domain"]}
  Category: {source_ctrl["category"]}

DESTINATION FRAMEWORK: {dest_fw_name}
DESTINATION CONTROLS (id | reference | title | description excerpt):
{json.dumps(dest_ctrls, indent=2, ensure_ascii=False)}

For each destination control that genuinely overlaps with the source, return
an object with:
  - dest_id: the integer id of the destination control (must match the list above)
  - confidence: 0.0–1.0 (1.0 = identical requirement; ≥0.7 = strong overlap;
                0.5–0.7 = partial; <0.5 = weak — DO NOT include weak matches)
  - rationale: 1–2 sentence justification specific to this control pair
  - evidence_recommendations: list of 1–3 short evidence types that would
    satisfy BOTH controls together (e.g. "Access control policy",
    "Quarterly access review evidence")

Rules:
  - Only include matches with confidence >= 0.5.
  - Maximum 8 destination matches per source control.
  - Order results by confidence descending.
  - If NO destination control overlaps, return {{"matches": []}}.

Respond with strict JSON only:
{{
  "matches": [
    {{"dest_id": 123, "confidence": 0.85, "rationale": "...", "evidence_recommendations": ["..."]}}
  ]
}}
"""


def _call_llm(prompt: str, model: str) -> Dict[str, Any]:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY") or os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY"))
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a precise GRC compliance expert. Return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=2000,
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("ai_compare: LLM returned non-JSON; raw=%s", raw[:500])
        return {"matches": []}


def _ai_compare_body(db: Session, run_id: int, tenant_slug: str) -> Dict[str, Any]:
    """Body of the comparison job. Iterates source controls, calls the LLM
    per source, persists mappings, updates progress."""
    from ..models import (
        ControlComparisonRun,
        ControlComparisonMapping,
        ParsedFrameworkControl,
        UploadedFramework,
    )

    run = db.query(ControlComparisonRun).filter(ControlComparisonRun.id == run_id).first()
    if not run:
        logger.error("ai_compare: run %s not found", run_id)
        return {"status": "failed", "error": "run not found"}

    # If a redelivered Celery message hits a run that's already completed,
    # don't re-execute — the lock-by-task-id path elsewhere mostly prevents
    # this, but a defensive check is cheap.
    if run.status == "completed":
        return {"status": "completed", "run_id": run_id, "message": "already completed"}

    source_fw = db.query(UploadedFramework).filter(UploadedFramework.id == run.source_framework_id).first()
    dest_fw = db.query(UploadedFramework).filter(UploadedFramework.id == run.dest_framework_id).first()
    if not source_fw or not dest_fw:
        run.status = "failed"
        run.error_message = "Source or destination framework not found"
        run.completed_at = datetime.utcnow()
        db.commit()
        return {"status": "failed", "error": run.error_message}

    source_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == source_fw.id
    ).order_by(ParsedFrameworkControl.id.asc()).all()

    dest_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == dest_fw.id
    ).order_by(ParsedFrameworkControl.id.asc()).all()

    if not source_controls or not dest_controls:
        run.status = "failed"
        run.error_message = "Source or destination framework has no parsed controls"
        run.completed_at = datetime.utcnow()
        db.commit()
        return {"status": "failed", "error": run.error_message}

    run.status = "running"
    run.started_at = datetime.utcnow()
    run.progress_total = len(source_controls)
    run.progress_done = 0
    if not run.model_used:
        run.model_used = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    db.commit()

    set_status(tenant_slug, "control_compare", run.id, {
        "status": "running",
        "progress_total": len(source_controls),
        "progress_done": 0,
        "source_framework": source_fw.name,
        "dest_framework": dest_fw.name,
    })

    short_dest = [_short_control(c) for c in dest_controls]
    dest_id_set = {c.id for c in dest_controls}

    # Chunk destination list if it's huge.
    def _chunks(items, n):
        for i in range(0, len(items), n):
            yield items[i:i + n]

    model = run.model_used
    completed_for_run = 0

    for src in source_controls:
        src_short = _short_control(src)
        # Per source, fold matches across dest chunks.
        merged_matches: Dict[int, Dict[str, Any]] = {}
        for chunk in _chunks(short_dest, DEST_CHUNK_SIZE):
            # Hard cap by char length too.
            chunk_text = json.dumps(chunk, ensure_ascii=False)
            if len(chunk_text) > MAX_DEST_CHARS:
                # Fall back to a smaller slice rather than blow the prompt.
                chunk = chunk[: max(10, len(chunk) // 2)]
            prompt = _build_prompt(src_short, chunk, source_fw.name, dest_fw.name)
            try:
                result = _call_llm(prompt, model)
            except Exception as exc:
                logger.exception("ai_compare: LLM call failed for source=%s", src.id)
                # Don't fail the whole run on a single API hiccup; record and move on.
                result = {"matches": [], "error": str(exc)[:200]}

            for m in (result.get("matches") or [])[:8]:
                try:
                    dest_id = int(m.get("dest_id"))
                except (TypeError, ValueError):
                    continue
                if dest_id not in dest_id_set:
                    continue
                conf = float(m.get("confidence") or 0.0)
                if conf < 0.5:
                    continue
                existing = merged_matches.get(dest_id)
                if existing and existing["confidence"] >= conf:
                    continue
                merged_matches[dest_id] = {
                    "confidence": conf,
                    "rationale": (m.get("rationale") or "")[:1000],
                    "evidence_recommendations": [str(e)[:200] for e in (m.get("evidence_recommendations") or [])][:3],
                }

        # Persist mappings ranked by confidence desc.
        ranked = sorted(merged_matches.items(), key=lambda kv: kv[1]["confidence"], reverse=True)[:8]
        for rank, (dest_id, payload) in enumerate(ranked):
            db.add(ControlComparisonMapping(
                run_id=run.id,
                source_control_id=src.id,
                dest_control_id=dest_id,
                confidence=payload["confidence"],
                rationale=payload["rationale"],
                evidence_recommendations=payload["evidence_recommendations"],
                rank=rank,
            ))

        completed_for_run += 1
        run.progress_done = completed_for_run
        # Commit per source so the UI sees progress in real time and a crash
        # doesn't lose all completed mappings.
        db.commit()

        # Status snapshot every 5 sources (or last one) — keeps Redis writes
        # bounded for huge frameworks.
        if completed_for_run % 5 == 0 or completed_for_run == len(source_controls):
            set_status(tenant_slug, "control_compare", run.id, {
                "status": "running",
                "progress_total": len(source_controls),
                "progress_done": completed_for_run,
                "source_framework": source_fw.name,
                "dest_framework": dest_fw.name,
            })

    run.status = "completed"
    run.completed_at = datetime.utcnow()
    db.commit()

    set_status(tenant_slug, "control_compare", run.id, {
        "status": "completed",
        "progress_total": len(source_controls),
        "progress_done": len(source_controls),
        "source_framework": source_fw.name,
        "dest_framework": dest_fw.name,
    })
    return {"status": "completed", "run_id": run.id, "source_count": len(source_controls)}


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.control_library.ai_compare_frameworks",
    max_retries=1,
)
def ai_compare_frameworks(self, tenant_slug: str, run_id: int, db: Session = None) -> dict:
    """Cross-framework AI mapping job. Idempotent: a redelivered task with the
    same task id reclaims its lock; a duplicate dispatch (different task id)
    skips immediately."""
    logger.info(
        "ai_compare_frameworks START tenant=%s run=%s task=%s",
        tenant_slug, run_id, self.request.id,
    )
    try:
        with tenant_lock(
            tenant_slug, f"control_compare:{run_id}",
            ttl_seconds=3600, owner=self.request.id,
        ):
            from ..models import ControlComparisonRun
            run = db.query(ControlComparisonRun).filter(
                ControlComparisonRun.id == run_id
            ).first()
            if run and run.task_id != self.request.id:
                run.task_id = self.request.id
                db.commit()
            result = _ai_compare_body(db, run_id, tenant_slug)
            logger.info("ai_compare_frameworks DONE tenant=%s run=%s", tenant_slug, run_id)
            return result
    except LockNotAcquired:
        set_status(tenant_slug, "control_compare", run_id, {
            "status": "skipped",
            "message": "Another worker is already running this comparison",
        })
        return {"status": "skipped", "run_id": run_id}
    except Exception as exc:
        logger.exception("ai_compare_frameworks failed: %s", exc)
        # Mark run failed so the UI can surface it.
        try:
            from ..models import ControlComparisonRun
            run = db.query(ControlComparisonRun).filter(
                ControlComparisonRun.id == run_id
            ).first()
            if run:
                run.status = "failed"
                run.error_message = str(exc)[:1000]
                run.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass
        set_status(tenant_slug, "control_compare", run_id, {
            "status": "failed",
            "error": str(exc)[:500],
        })
        raise


__all__ = ["ai_compare_frameworks"]
