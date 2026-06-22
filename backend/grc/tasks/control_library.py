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
from ..job_status import set_status, get_status
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


# ─── AI Auto-grouping task ──────────────────────────────────────────────────


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.control_library.ai_auto_group",
    max_retries=1,
)
def ai_auto_group(
    self,
    tenant_slug: str,
    job_id: str,
    framework_ids: List[int] = None,
    user_id: int = None,
    db: Session = None,
) -> dict:
    """Background AI auto-grouping for the control library.

    Pulls all controls (filtered by framework_ids when provided), batches them
    through OpenAI, and persists the resulting `CommonControlGroup` rows.
    Status is published to job_status under namespace ``control_auto_group``
    so the UI can poll without blocking on the AI call.
    """
    namespace = "control_auto_group"
    logger.info(
        "ai_auto_group START tenant=%s job=%s framework_ids=%s",
        tenant_slug, job_id, framework_ids,
    )

    set_status(tenant_slug, namespace, job_id, {
        "status": "running",
        "phase": "loading_controls",
        "message": "Loading controls from selected frameworks…",
    })

    try:
        with tenant_lock(
            tenant_slug, f"control_auto_group:{job_id}",
            ttl_seconds=1800, owner=self.request.id,
        ):
            from ..modules.control_library.routers.groups import (
                _fetch_controls_for_grouping,
                ai_auto_group_controls,
                persist_ai_groups,
                AutoGroupCancelled,
            )

            # Resolve tenant id from slug
            from ..models import Tenant
            tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
            if not tenant:
                raise RuntimeError(f"Tenant slug '{tenant_slug}' not found")

            # Honour a cancel requested while the job sat in the queue.
            if (get_status(tenant_slug, namespace, job_id) or {}).get("cancel_requested"):
                set_status(tenant_slug, namespace, job_id, {
                    "status": "cancelled", "phase": "cancelled",
                    "message": "Cancelled before it started.", "progress_percent": 100,
                })
                return {"status": "cancelled"}

            # ── Preferred path: a one-time master baseline already exists.
            # Build a framework-scoped session by FILTERING the baseline — no
            # full AI re-run (AI touches only a brand-new framework's controls,
            # classified onto the existing master list). The legacy clustering
            # flow below runs ONLY when no baseline exists yet (fresh tenant).
            from ..modules.control_library.services.scoped_session import (
                get_baseline_run, build_scoped_session,
            )
            if get_baseline_run(db, tenant.id) is not None:
                def _scoped_progress(done, total, msg):
                    cur = get_status(tenant_slug, namespace, job_id) or {}
                    if cur.get("cancel_requested"):
                        raise AutoGroupCancelled()
                    cur.update({"status": "running", "phase": "scoping", "message": msg,
                                "progress_percent": int(done * 100 / max(1, total))})
                    set_status(tenant_slug, namespace, job_id, cur)
                try:
                    res = build_scoped_session(
                        db, tenant.id, framework_ids or [], user_id=user_id,
                        progress_cb=_scoped_progress,
                        should_cancel=lambda: bool((get_status(tenant_slug, namespace, job_id) or {}).get("cancel_requested")),
                    )
                except AutoGroupCancelled:
                    set_status(tenant_slug, namespace, job_id, {
                        "status": "cancelled", "phase": "cancelled",
                        "message": "Cancelled.", "progress_percent": 100})
                    return {"status": "cancelled"}
                except ValueError as ve:
                    set_status(tenant_slug, namespace, job_id, {"status": "failed", "error": str(ve)})
                    return {"status": "failed", "reason": str(ve)}
                set_status(tenant_slug, namespace, job_id, {
                    "status": "completed", "phase": "done",
                    "message": (
                        f"Built a view of {res['unified_controls']} unified + "
                        f"{res.get('standalone', 0)} standalone controls "
                        + ("(new framework classified onto the master list)."
                           if res["ai_used"] else "— reused the master baseline, no AI re-run.")),
                    "summary": res, "run_id": res["run_id"], "progress_percent": 100,
                })
                logger.info("ai_auto_group SCOPED tenant=%s job=%s run=%s ai_used=%s",
                            tenant_slug, job_id, res["run_id"], res["ai_used"])
                return {"status": "completed", "job_id": job_id, "summary": res, "run_id": res["run_id"]}

            controls = _fetch_controls_for_grouping(db, tenant.id, framework_ids)
            if len(controls) < 2:
                set_status(tenant_slug, namespace, job_id, {
                    "status": "failed",
                    "error": "Not enough controls to perform auto-grouping",
                })
                return {"status": "failed", "reason": "no_controls"}

            set_status(tenant_slug, namespace, job_id, {
                "status": "running",
                "phase": "ai_grouping",
                "message": f"Asking AI to group {len(controls)} controls…",
                "control_count": len(controls),
            })

            def _progress(done, total_batches):
                cur = get_status(tenant_slug, namespace, job_id) or {}
                if cur.get("cancel_requested"):
                    raise AutoGroupCancelled()
                pct = 25 + int((done / max(1, total_batches)) * 50)
                cur.update({
                    "status": "running", "phase": "ai_grouping",
                    "message": f"Grouping… batch {done} of {total_batches}",
                    "progress_percent": pct,
                })
                set_status(tenant_slug, namespace, job_id, cur)

            try:
                ai_groups = ai_auto_group_controls(controls, progress_cb=_progress)
            except AutoGroupCancelled:
                logger.info("ai_auto_group CANCELLED tenant=%s job=%s", tenant_slug, job_id)
                set_status(tenant_slug, namespace, job_id, {
                    "status": "cancelled", "phase": "cancelled",
                    "message": "Auto-grouping cancelled by user.", "progress_percent": 100,
                })
                return {"status": "cancelled"}

            set_status(tenant_slug, namespace, job_id, {
                "status": "running",
                "phase": "persisting",
                "message": f"Saving {len(ai_groups)} groups to database…",
                "control_count": len(controls),
                "group_count": len(ai_groups),
            })

            summary = persist_ai_groups(db, tenant.id, user_id, ai_groups)

            # ── Second phase of the SAME flow: normalize each new domain ──
            # Auto-grouping builds the domains; normalization then consolidates
            # each domain's controls into normalized controls linked across
            # frameworks. One button, two phases.
            norm = {"normalized_controls_created": 0, "links_created": 0}
            new_group_ids = summary.get("created_group_ids") or []
            if new_group_ids:
                from ..modules.control_library.services.normalization import run_normalization
                set_status(tenant_slug, namespace, job_id, {
                    "status": "running", "phase": "normalizing",
                    "message": f"Normalizing {len(new_group_ids)} domain(s)…",
                    "progress_percent": 80,
                })

                def _norm_progress(done, total, msg):
                    cur = get_status(tenant_slug, namespace, job_id) or {}
                    if cur.get("cancel_requested"):
                        raise AutoGroupCancelled()
                    pct = 80 + int((done / max(1, total)) * 18)
                    cur.update({"status": "running", "phase": "normalizing",
                                "message": msg, "progress_percent": pct})
                    set_status(tenant_slug, namespace, job_id, cur)

                try:
                    norm = run_normalization(
                        db, tenant.id, new_group_ids,
                        progress_cb=_norm_progress,
                        should_cancel=lambda: bool((get_status(tenant_slug, namespace, job_id) or {}).get("cancel_requested")),
                    )
                except AutoGroupCancelled:
                    set_status(tenant_slug, namespace, job_id, {
                        "status": "cancelled", "phase": "cancelled",
                        "message": "Cancelled during normalization.", "progress_percent": 100})
                    return {"status": "cancelled"}

            set_status(tenant_slug, namespace, job_id, {
                "status": "completed",
                "phase": "done",
                "message": (
                    f"Created {summary['created_count']} domain(s) and "
                    f"{norm['normalized_controls_created']} normalized control(s)."
                ),
                "control_count": len(controls),
                "group_count": len(ai_groups),
                "summary": {**summary, **norm},
                "progress_percent": 100,
            })
            logger.info("ai_auto_group DONE tenant=%s job=%s summary=%s", tenant_slug, job_id, summary)
            return {"status": "completed", "job_id": job_id, "summary": summary}
    except LockNotAcquired:
        set_status(tenant_slug, namespace, job_id, {
            "status": "skipped",
            "message": "Another grouping job is already running for this tenant.",
        })
        return {"status": "skipped", "job_id": job_id}
    except Exception as exc:
        logger.exception("ai_auto_group failed: %s", exc)
        set_status(tenant_slug, namespace, job_id, {
            "status": "failed",
            "error": str(exc)[:500],
        })
        raise


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.control_library.ai_normalize_controls",
    max_retries=1,
)
def ai_normalize_controls(
    self,
    tenant_slug: str,
    job_id: str,
    group_ids: List[int] = None,
    user_id: int = None,
    db: Session = None,
) -> dict:
    """Background AI normalization. For each AI domain (CommonControlGroup),
    cluster its controls into normalized controls and link each cross-framework.
    Status under namespace ``control_normalization``."""
    namespace = "control_normalization"
    logger.info("ai_normalize_controls START tenant=%s job=%s group_ids=%s", tenant_slug, job_id, group_ids)
    set_status(tenant_slug, namespace, job_id, {
        "status": "running", "phase": "starting",
        "message": "Starting normalization…", "progress_percent": 2,
    })
    try:
        with tenant_lock(
            tenant_slug, f"control_normalize:{job_id}",
            ttl_seconds=1800, owner=self.request.id,
        ):
            from ..models import Tenant
            tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
            if not tenant:
                raise RuntimeError(f"Tenant slug '{tenant_slug}' not found")
            from ..modules.control_library.services.normalization import run_normalization
            from ..modules.control_library.routers.groups import AutoGroupCancelled

            def _progress(done, total, msg):
                cur = get_status(tenant_slug, namespace, job_id) or {}
                if cur.get("cancel_requested"):
                    raise AutoGroupCancelled()
                pct = 5 + int((done / max(1, total)) * 90)
                cur.update({"status": "running", "phase": "normalizing",
                            "message": msg, "progress_percent": pct})
                set_status(tenant_slug, namespace, job_id, cur)

            def _should_cancel():
                return bool((get_status(tenant_slug, namespace, job_id) or {}).get("cancel_requested"))

            try:
                summary = run_normalization(
                    db, tenant.id, group_ids,
                    progress_cb=_progress, should_cancel=_should_cancel,
                )
            except AutoGroupCancelled:
                logger.info("ai_normalize_controls CANCELLED tenant=%s job=%s", tenant_slug, job_id)
                set_status(tenant_slug, namespace, job_id, {
                    "status": "cancelled", "phase": "cancelled",
                    "message": "Normalization cancelled by user.", "progress_percent": 100,
                })
                return {"status": "cancelled"}

            set_status(tenant_slug, namespace, job_id, {
                "status": "completed", "phase": "done",
                "message": (
                    f"Created {summary['normalized_controls_created']} normalized control(s) "
                    f"across {summary['domains_processed']} domain(s)."
                ),
                "summary": summary, "progress_percent": 100,
            })
            logger.info("ai_normalize_controls DONE tenant=%s job=%s summary=%s", tenant_slug, job_id, summary)
            return {"status": "completed", "job_id": job_id, "summary": summary}
    except LockNotAcquired:
        set_status(tenant_slug, namespace, job_id, {
            "status": "skipped",
            "message": "Another normalization job is already running for this tenant.",
        })
        return {"status": "skipped", "job_id": job_id}
    except Exception as exc:
        logger.exception("ai_normalize_controls failed: %s", exc)
        set_status(tenant_slug, namespace, job_id, {
            "status": "failed", "error": str(exc)[:500], "progress_percent": 100,
        })
        raise


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.control_library.build_master_baseline",
    max_retries=0,
)
def build_master_baseline(self, tenant_slug, job_id, user_id=None, label=None, db=None):
    """Heavy one-time / rebuild MASTER BASELINE build (sees ALL frameworks + ALL
    controls). This is the ONLY control-library job that runs on the Celery worker
    and NEVER in the API process — so it can't block requests and is stoppable by
    stopping the worker. Builds a NEW candidate run (is_baseline=False); the caller
    reviews it and Promotes it. The live baseline is never touched here."""
    namespace = "control_baseline_build"
    logger.info("build_master_baseline START tenant=%s job=%s", tenant_slug, job_id)
    try:
        with tenant_lock(tenant_slug, f"baseline_build:{job_id}",
                         ttl_seconds=3600, owner=self.request.id):
            from ..models import Tenant
            tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
            if not tenant:
                raise RuntimeError(f"Tenant slug '{tenant_slug}' not found")
            from ..modules.control_library.services.baseline_builder import build_baseline_run
            from ..modules.control_library.routers.groups import AutoGroupCancelled

            def _progress(done, total, msg):
                cur = get_status(tenant_slug, namespace, job_id) or {}
                if cur.get("cancel_requested"):
                    raise AutoGroupCancelled()
                cur.update({"status": "running", "phase": "building", "message": msg,
                            "progress_percent": int(done * 100 / max(1, total))})
                set_status(tenant_slug, namespace, job_id, cur)

            try:
                res = build_baseline_run(
                    db, tenant.id, label=label, user_id=user_id, progress_cb=_progress,
                    should_cancel=lambda: bool((get_status(tenant_slug, namespace, job_id) or {}).get("cancel_requested")))
            except AutoGroupCancelled:
                set_status(tenant_slug, namespace, job_id, {
                    "status": "cancelled", "phase": "cancelled",
                    "message": "Cancelled.", "progress_percent": 100})
                return {"status": "cancelled"}
            set_status(tenant_slug, namespace, job_id, {
                "status": "completed", "phase": "done",
                "message": (f"Built {res['unified_controls']} unified + {res['standalone']} "
                            "standalone controls. Review it from the dropdown, then Promote to make it live."),
                "summary": res, "run_id": res["run_id"], "progress_percent": 100})
            logger.info("build_master_baseline DONE tenant=%s job=%s run=%s",
                        tenant_slug, job_id, res["run_id"])
            return {"status": "completed", "run_id": res["run_id"], "summary": res}
    except LockNotAcquired:
        set_status(tenant_slug, namespace, job_id, {
            "status": "skipped", "message": "Another baseline build is already running."})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("build_master_baseline FAILED: %s", exc)
        set_status(tenant_slug, namespace, job_id, {
            "status": "failed", "phase": "error", "error": str(exc)[:500], "progress_percent": 100})
        raise


__all__ = ["ai_compare_frameworks", "ai_auto_group", "ai_normalize_controls",
           "build_master_baseline"]
