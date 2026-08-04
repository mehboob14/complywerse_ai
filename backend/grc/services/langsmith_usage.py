"""
LangSmith-backed AI usage monitoring for the current tenant.

Reads run traces from LangSmith, filters to this tenant (via metadata /
tags / per-tenant project), and returns both board-friendly summaries and
detailed input/output traces for drill-down.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..config import (
    get_langsmith_api_key,
    get_langsmith_api_url,
    get_langsmith_project,
    is_langsmith_configured,
)

logger = logging.getLogger(__name__)

# Rough USD cost per 1M tokens — used only for board-friendly estimates.
# Override via LANGSMITH_COST_* env if needed; defaults track gpt-4o-mini ballpark.
_DEFAULT_INPUT_COST_PER_1M = 0.15
_DEFAULT_OUTPUT_COST_PER_1M = 0.60

# Friendly labels for common run names / run types.
_FEATURE_LABELS: dict[str, str] = {
    "complychat": "ComplyChat",
    "ask": "ComplyChat",
    "answer_grc_knowledge_question": "ComplyChat",
    "generate_sql_query": "ComplyChat (SQL)",
    "embeddings": "Document search / embeddings",
    "embedding": "Document search / embeddings",
    "ai_drafting": "Policy drafting",
    "policy": "Policy drafting",
    "gap_analysis": "Gap analysis",
    "ocr": "Evidence OCR",
    "risk_assessment": "Risk assessment AI",
    "audit": "Audit log AI summary",
    "control": "Control library AI",
    "vendor": "Vendor risk AI",
    "vuln": "Vulnerability AI",
    "ChatOpenAI": "AI assistant",
    "ChatCompletion": "AI assistant",
}


def _cost_rates() -> tuple[float, float]:
    import os
    try:
        inp = float(os.environ.get("LANGSMITH_COST_INPUT_PER_1M", _DEFAULT_INPUT_COST_PER_1M))
    except ValueError:
        inp = _DEFAULT_INPUT_COST_PER_1M
    try:
        out = float(os.environ.get("LANGSMITH_COST_OUTPUT_PER_1M", _DEFAULT_OUTPUT_COST_PER_1M))
    except ValueError:
        out = _DEFAULT_OUTPUT_COST_PER_1M
    return inp, out


def _estimate_cost_usd(prompt_tokens: int, completion_tokens: int) -> float:
    inp, out = _cost_rates()
    return (prompt_tokens / 1_000_000.0) * inp + (completion_tokens / 1_000_000.0) * out


def _parse_dt(value: Optional[str], *, default: datetime) -> datetime:
    if not value:
        return default
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return default
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _friendly_feature(name: Optional[str], run_type: Optional[str], metadata: dict) -> str:
    feature = (metadata or {}).get("feature") or (metadata or {}).get("module")
    if isinstance(feature, str) and feature.strip():
        key = feature.strip().lower()
        return _FEATURE_LABELS.get(key, feature.replace("_", " ").title())

    blob = " ".join(filter(None, [name or "", run_type or ""])).lower()
    for needle, label in _FEATURE_LABELS.items():
        if needle.lower() in blob:
            return label
    if name:
        return name.replace("_", " ").replace("-", " ").title()
    return "AI activity"


def _tokens_from_run(run: Any) -> tuple[int, int, int]:
    prompt = int(getattr(run, "prompt_tokens", None) or 0)
    completion = int(getattr(run, "completion_tokens", None) or 0)
    total = int(getattr(run, "total_tokens", None) or 0)
    if total and not (prompt or completion):
        # Some runs only populate total_tokens.
        return 0, 0, total
    if not total:
        total = prompt + completion
    return prompt, completion, total


def _serialize_io(value: Any, *, limit: int = 8000) -> Any:
    """Return a JSON-safe, truncated view of inputs/outputs for the detail pane."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > limit:
            return value[:limit] + f"… [truncated, {len(value)} chars]"
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= 40:
                out["…"] = f"{len(value) - 40} more keys omitted"
                break
            out[str(k)] = _serialize_io(v, limit=max(500, limit // 2))
        return out
    if isinstance(value, (list, tuple)):
        items = list(value)
        serialized = [_serialize_io(v, limit=max(500, limit // 2)) for v in items[:20]]
        if len(items) > 20:
            serialized.append(f"… {len(items) - 20} more items omitted")
        return serialized
    text = str(value)
    if len(text) > limit:
        return text[:limit] + f"… [truncated, {len(text)} chars]"
    return text


def _run_matches_tenant(run: Any, tenant_slug: str) -> bool:
    slug = (tenant_slug or "").strip().lower()
    if not slug:
        return True

    meta = getattr(run, "extra", None) or {}
    if isinstance(meta, dict):
        nested = meta.get("metadata") if isinstance(meta.get("metadata"), dict) else meta
        for key in ("tenant_slug", "tenant", "organization_slug"):
            val = nested.get(key) if isinstance(nested, dict) else None
            if isinstance(val, str) and val.strip().lower() == slug:
                return True

    tags = getattr(run, "tags", None) or []
    for tag in tags:
        if not isinstance(tag, str):
            continue
        t = tag.strip().lower()
        if t == slug or t == f"tenant:{slug}" or t == f"tenant_slug:{slug}":
            return True

    # Per-tenant LangSmith project — when the resolved project already
    # embeds the slug, every run in that project belongs to the tenant.
    project = get_langsmith_project(tenant_slug)
    if slug and slug in project.lower():
        return True

    # If the run carries no tenant signal at all, exclude it so one
    # tenant never sees another tenant's unscoped traces from a shared project.
    has_tenant_signal = False
    if isinstance(meta, dict):
        nested = meta.get("metadata") if isinstance(meta.get("metadata"), dict) else meta
        if isinstance(nested, dict) and any(
            k in nested for k in ("tenant_slug", "tenant", "organization_slug")
        ):
            has_tenant_signal = True
    if any(isinstance(t, str) and "tenant" in t.lower() for t in tags):
        has_tenant_signal = True
    if has_tenant_signal:
        return False

    # Shared project with no tags → only include when LANGSMITH_TENANT_FILTER=off
    # (ops escape hatch for single-tenant installs).
    import os
    return (os.environ.get("LANGSMITH_TENANT_FILTER") or "on").strip().lower() in (
        "0", "false", "off", "no",
    )


def _get_client():
    from langsmith import Client

    kwargs: dict[str, Any] = {}
    api_key = get_langsmith_api_key()
    api_url = get_langsmith_api_url()
    if api_key:
        kwargs["api_key"] = api_key
    if api_url:
        kwargs["api_url"] = api_url
    return Client(**kwargs)


def _list_runs(
    *,
    tenant_slug: str,
    start: datetime,
    end: datetime,
    limit: int = 200,
    include_io: bool = False,
) -> list[Any]:
    client = _get_client()
    project = get_langsmith_project(tenant_slug)

    # Prefer a metadata filter when LangSmith supports it; fall back to
    # client-side tenant matching so older projects still work.
    filter_expr = (
        f'and(eq(is_root, true), '
        f'or(eq(metadata_key, "tenant_slug"), eq(metadata_key, "tenant")), '
        f'eq(metadata_value, "{tenant_slug}"))'
    )

    runs: list[Any] = []
    try:
        iterator = client.list_runs(
            project_name=project,
            start_time=start,
            end_time=end,
            is_root=True,
            filter=filter_expr,
            select=(
                None
                if include_io
                else [
                    "id",
                    "name",
                    "run_type",
                    "start_time",
                    "end_time",
                    "status",
                    "prompt_tokens",
                    "completion_tokens",
                    "total_tokens",
                    "total_cost",
                    "tags",
                    "extra",
                    "error",
                    "session_id",
                    "parent_run_id",
                ]
            ),
        )
        for run in iterator:
            runs.append(run)
            if len(runs) >= limit:
                break
    except Exception as exc:
        logger.info("LangSmith filtered list_runs failed (%s); falling back", exc)
        runs = []
        try:
            iterator = client.list_runs(
                project_name=project,
                start_time=start,
                end_time=end,
                is_root=True,
            )
            for run in iterator:
                if _run_matches_tenant(run, tenant_slug):
                    runs.append(run)
                if len(runs) >= limit:
                    break
        except Exception as exc2:
            logger.exception("LangSmith list_runs failed: %s", exc2)
            raise

    # Belt-and-suspenders tenant filter even when the server-side filter worked.
    return [r for r in runs if _run_matches_tenant(r, tenant_slug)][:limit]


def _run_to_summary_row(run: Any) -> dict[str, Any]:
    meta_extra = getattr(run, "extra", None) or {}
    metadata = {}
    if isinstance(meta_extra, dict):
        metadata = meta_extra.get("metadata") if isinstance(meta_extra.get("metadata"), dict) else meta_extra

    prompt, completion, total = _tokens_from_run(run)
    total_cost = getattr(run, "total_cost", None)
    try:
        cost = float(total_cost) if total_cost is not None else _estimate_cost_usd(prompt, completion)
    except (TypeError, ValueError):
        cost = _estimate_cost_usd(prompt, completion)

    start_time = getattr(run, "start_time", None)
    end_time = getattr(run, "end_time", None)
    latency_ms = None
    if start_time and end_time:
        try:
            latency_ms = int((end_time - start_time).total_seconds() * 1000)
        except Exception:
            latency_ms = None

    feature = _friendly_feature(
        getattr(run, "name", None),
        getattr(run, "run_type", None),
        metadata if isinstance(metadata, dict) else {},
    )

    return {
        "id": str(getattr(run, "id", "")),
        "name": getattr(run, "name", None) or "AI run",
        "feature": feature,
        "run_type": getattr(run, "run_type", None),
        "status": getattr(run, "status", None) or "unknown",
        "started_at": start_time.isoformat() if start_time else None,
        "ended_at": end_time.isoformat() if end_time else None,
        "latency_ms": latency_ms,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "estimated_cost_usd": round(cost, 6),
        "error": getattr(run, "error", None),
        "tags": list(getattr(run, "tags", None) or []),
        "metadata": {
            k: v
            for k, v in (metadata.items() if isinstance(metadata, dict) else [])
            if k in ("tenant_slug", "tenant", "feature", "module", "user_id", "session_id", "model")
        },
    }


def _run_to_detail(run: Any) -> dict[str, Any]:
    row = _run_to_summary_row(run)
    row["inputs"] = _serialize_io(getattr(run, "inputs", None))
    row["outputs"] = _serialize_io(getattr(run, "outputs", None))
    return row


def status_payload(tenant_slug: str) -> dict[str, Any]:
    configured = is_langsmith_configured()
    return {
        "configured": configured,
        "project": get_langsmith_project(tenant_slug) if configured else None,
        "tenant_slug": tenant_slug,
        "message": (
            None
            if configured
            else (
                "LangSmith is not configured for this environment. "
                "Set LANGSMITH_API_KEY (and optionally LANGSMITH_PROJECT) "
                "on the backend to enable AI usage monitoring."
            )
        ),
    }


def build_overview(
    *,
    tenant_slug: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 300,
) -> dict[str, Any]:
    status = status_payload(tenant_slug)
    now = datetime.now(timezone.utc)
    end_dt = _parse_dt(end, default=now)
    start_dt = _parse_dt(start, default=end_dt - timedelta(days=30))

    if not status["configured"]:
        return {
            **status,
            "period": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
            "summary": {
                "total_runs": 0,
                "successful_runs": 0,
                "failed_runs": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0.0,
                "avg_latency_ms": None,
            },
            "by_feature": [],
            "by_day": [],
            "recent": [],
        }

    runs = _list_runs(
        tenant_slug=tenant_slug,
        start=start_dt,
        end=end_dt,
        limit=limit,
        include_io=False,
    )
    rows = [_run_to_summary_row(r) for r in runs]

    prompt_tokens = sum(r["prompt_tokens"] for r in rows)
    completion_tokens = sum(r["completion_tokens"] for r in rows)
    total_tokens = sum(r["total_tokens"] for r in rows)
    cost = sum(r["estimated_cost_usd"] for r in rows)
    successful = sum(1 for r in rows if (r["status"] or "").lower() in ("success", "completed"))
    failed = sum(1 for r in rows if (r["status"] or "").lower() in ("error", "failed"))
    latencies = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else None

    by_feature: dict[str, dict[str, Any]] = {}
    for r in rows:
        bucket = by_feature.setdefault(
            r["feature"],
            {"feature": r["feature"], "runs": 0, "total_tokens": 0, "estimated_cost_usd": 0.0},
        )
        bucket["runs"] += 1
        bucket["total_tokens"] += r["total_tokens"]
        bucket["estimated_cost_usd"] = round(bucket["estimated_cost_usd"] + r["estimated_cost_usd"], 6)

    by_day_map: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"date": "", "runs": 0, "total_tokens": 0, "estimated_cost_usd": 0.0}
    )
    for r in rows:
        if not r["started_at"]:
            continue
        day = r["started_at"][:10]
        bucket = by_day_map[day]
        bucket["date"] = day
        bucket["runs"] += 1
        bucket["total_tokens"] += r["total_tokens"]
        bucket["estimated_cost_usd"] = round(bucket["estimated_cost_usd"] + r["estimated_cost_usd"], 6)

    by_day = sorted(by_day_map.values(), key=lambda d: d["date"])

    plain_english = (
        f"Over this period your organization used AI about {len(rows)} time"
        f"{'' if len(rows) == 1 else 's'}, using roughly {total_tokens:,} tokens "
        f"(about ${cost:.2f} estimated). "
        + (
            f"Most activity was in {max(by_feature.values(), key=lambda b: b['runs'])['feature']}."
            if by_feature
            else "No AI activity was recorded for this tenant yet."
        )
    )

    return {
        **status,
        "period": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
        "summary": {
            "total_runs": len(rows),
            "successful_runs": successful,
            "failed_runs": failed,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(cost, 4),
            "avg_latency_ms": avg_latency,
        },
        "plain_english": plain_english,
        "by_feature": sorted(by_feature.values(), key=lambda b: b["runs"], reverse=True),
        "by_day": by_day,
        "recent": rows[:15],
    }


def list_run_details(
    *,
    tenant_slug: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    feature: Optional[str] = None,
) -> dict[str, Any]:
    status = status_payload(tenant_slug)
    now = datetime.now(timezone.utc)
    end_dt = _parse_dt(end, default=now)
    start_dt = _parse_dt(start, default=end_dt - timedelta(days=30))

    if not status["configured"]:
        return {**status, "total": 0, "runs": []}

    # Fetch a larger window then page/filter in-process — LangSmith list APIs
    # don't always support stable offsets across filtered queries.
    runs = _list_runs(
        tenant_slug=tenant_slug,
        start=start_dt,
        end=end_dt,
        limit=max(limit + offset, 100),
        include_io=True,
    )
    rows = [_run_to_detail(r) for r in runs]
    if feature:
        needle = feature.strip().lower()
        rows = [r for r in rows if needle in (r.get("feature") or "").lower()]

    total = len(rows)
    page = rows[offset : offset + limit]
    return {
        **status,
        "period": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
        "total": total,
        "limit": limit,
        "offset": offset,
        "runs": page,
    }


def get_run_detail(*, tenant_slug: str, run_id: str) -> Optional[dict[str, Any]]:
    if not is_langsmith_configured():
        return None
    client = _get_client()
    try:
        run = client.read_run(run_id)
    except Exception as exc:
        logger.warning("LangSmith read_run(%s) failed: %s", run_id, exc)
        return None
    if not _run_matches_tenant(run, tenant_slug):
        return None
    return _run_to_detail(run)
