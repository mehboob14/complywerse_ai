"""What the administrator sees of AI use in this tenant: totals, the catalogue of use cases and every call.

All of it comes from the tenant's own usage ledger (``ai_usage_events``) and the registry of use cases; nothing here
changes anything. A call's use case is the one the guard recorded with it, or, for older rows, the one its call site
belongs to in the registry.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from ...models import AIUsageEvent
from ...services.ai_gateway import registry

LEVEL_MEANING = {
    "L0": "Public or library text only",
    "L1": "Structured fields; names and ids are replaced",
    "L2": "Short free text; names, hosts and addresses are replaced",
    "L3": "Documents; everything detected is replaced",
    "L4": "Never sent to an outside model",
}
TRIGGER_LABEL = {"click": "On request", "view": "When a page opens", "auto": "Automatic", "background": "Background job",
                 "offline": "Developer script"}
SCAN_LIMIT = 5000        # events read to compute the per-use-case figures of a period


def since(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def is_blocked(event: AIUsageEvent) -> bool:
    return event.error_type == "AIBlocked"


def gateway_of(event: AIUsageEvent) -> Dict[str, Any]:
    meta = event.usage_metadata if isinstance(event.usage_metadata, dict) else {}
    report = meta.get("gateway")
    return report if isinstance(report, dict) else {}


def use_case_for(event: AIUsageEvent) -> Optional[registry.UseCase]:
    uid = getattr(event, "use_case_id", None) or gateway_of(event).get("use_case")
    found = registry.get(uid) if uid else None
    if found:
        return found
    meta = event.usage_metadata if isinstance(event.usage_metadata, dict) else {}
    hits = registry.match_event(meta.get("callsite") or "", event.feature_key)
    return hits[0] if len(hits) == 1 else None


def entities_in(report: Dict[str, Any]) -> int:
    entities = report.get("entities")
    return sum(int(n) for n in entities.values()) if isinstance(entities, dict) else 0


def _cost(rows) -> Dict[str, Any]:
    priced = [r.estimated_cost for r in rows if r.estimated_cost is not None]
    return {"cost_usd": float(sum(priced)) if priced else None, "cost_configured": bool(priced)}


def _repeats(rows: List[AIUsageEvent]) -> tuple:
    """(calls, tokens) that asked the model something it had already been asked in this period: same sanitised prompt
    hash, and not answered from the cache. These are the calls a result cache would have saved."""
    seen, calls, tokens = set(), 0, 0
    for r in sorted(rows, key=lambda r: (r.occurred_at, r.id)):
        report = gateway_of(r)
        digest = report.get("hash")
        if not digest or report.get("cache") == "hit" or is_blocked(r):
            continue
        if digest in seen:
            calls += 1
            tokens += int(r.total_tokens or 0)
        seen.add(digest)
    return calls, tokens


def _stats(rows: List[AIUsageEvent]) -> Dict[str, Any]:
    blocked = sum(1 for r in rows if is_blocked(r))
    hits = [r for r in rows if gateway_of(r).get("cache") == "hit"]
    repeat_calls, repeat_tokens = _repeats(rows)
    return {
        "calls": len(rows), "failed": sum(1 for r in rows if r.status != "success" and not is_blocked(r)), "blocked": blocked,
        "tokens": sum(int(r.total_tokens or 0) for r in rows),
        "input_tokens": sum(int(r.prompt_tokens or 0) for r in rows), "output_tokens": sum(int(r.completion_tokens or 0) for r in rows),
        "reasoning_tokens": sum(int(r.reasoning_tokens or 0) for r in rows), "cached_tokens": sum(int(r.cached_tokens or 0) for r in rows),
        "cache_hits": len(hits), "saved_tokens": sum(int(gateway_of(r).get("saved_tokens") or 0) for r in hits),
        "repeat_calls": repeat_calls, "repeat_tokens": repeat_tokens,
        "retries": sum(1 for r in rows if (r.attempt_number or 1) > 1),
        "with_hash": sum(1 for r in rows if gateway_of(r).get("hash")),
        "protected": sum(1 for r in rows if entities_in(gateway_of(r))),
        "entities": sum(entities_in(gateway_of(r)) for r in rows),
        **_cost(rows),
    }


def _events(db, days: int) -> List[AIUsageEvent]:
    return (db.query(AIUsageEvent).filter(AIUsageEvent.occurred_at >= since(days))
            .order_by(AIUsageEvent.occurred_at.desc()).limit(SCAN_LIMIT).all())


# ── overview ────────────────────────────────────────────────────────────────────────────────────────────────────
def overview(db, days: int = 30) -> Dict[str, Any]:
    rows = _events(db, days)
    by_module: Dict[str, List[AIUsageEvent]] = defaultdict(list)
    by_case: Dict[str, List[AIUsageEvent]] = defaultdict(list)
    for r in rows:
        by_module[r.module_key].append(r)
        uc = use_case_for(r)
        by_case[uc.id if uc else "unclassified"].append(r)
    cases = []
    for uid, items in sorted(by_case.items(), key=lambda kv: -len(kv[1]))[:10]:
        uc = registry.get(uid)
        cases.append({"id": uid, "label": uc.label if uc else "Not in the inventory", "module": uc.module if uc else None,
                      **_stats(items)})
    recent = [{"id": r.id, "at": r.occurred_at.isoformat() + "Z", "use_case": (use_case_for(r).label if use_case_for(r) else r.feature_key),
               "reason": gateway_of(r).get("blocked"), "rule": gateway_of(r).get("rule")}
              for r in rows if is_blocked(r)][:10]
    return {
        "days": days, "totals": _stats(rows), "truncated": len(rows) >= SCAN_LIMIT,
        "modules": [{"module": k, "label": registry.module_label(k) if k in registry.MODULES else k, **_stats(v)}
                    for k, v in sorted(by_module.items(), key=lambda kv: -len(kv[1]))],
        "use_cases": cases, "recent_blocked": recent,
        "protection": {"mode": "always on", "images": "refused", "raw_records": "refused"},
    }


# ── inventory ───────────────────────────────────────────────────────────────────────────────────────────────────
def inventory(db, days: int = 30) -> Dict[str, Any]:
    by_case: Dict[str, List[AIUsageEvent]] = defaultdict(list)
    for r in _events(db, days):
        uc = use_case_for(r)
        by_case[uc.id if uc else "unclassified"].append(r)
    from ...services.ai_gateway import field_policies
    governed = {use_case for _, use_case, _ in field_policies.declared()}
    groups = []
    for module, label in registry.MODULES.items():
        items = []
        for u in (x for x in registry.USE_CASES if x.module == module):
            rows = by_case.get(u.id, [])
            last = max((r.occurred_at for r in rows), default=None)
            items.append({
                "id": u.id, "label": u.label, "value": u.value, "surface": u.surface,
                "trigger": u.trigger, "trigger_label": TRIGGER_LABEL[u.trigger], "profile": u.profile, "level": u.level,
                "level_meaning": LEVEL_MEANING[u.level], "modality": u.modality, "records": list(u.records),
                "guarded": not u.outside_shim, "field_policy": u.id in governed, "cache_hours": u.cache_hours, "tier": u.tier,
                "last_used": last.isoformat() + "Z" if last else None, **_stats(rows),
            })
        if items:
            groups.append({"module": module, "label": label, "use_cases": items})
    return {"days": days, "modules": groups, "total": len(registry.USE_CASES),
            "unclassified": _stats(by_case.get("unclassified", []))["calls"]}


# ── activity ────────────────────────────────────────────────────────────────────────────────────────────────────
def serialize(event: AIUsageEvent, *, detail: bool = False) -> Dict[str, Any]:
    uc = use_case_for(event)
    report = gateway_of(event)
    out = {
        "id": event.id, "at": event.occurred_at.isoformat() + "Z" if event.occurred_at else None,
        "module": event.module_key, "module_label": registry.module_label(uc.module) if uc else event.module_key,
        "use_case": uc.id if uc else None, "use_case_label": uc.label if uc else event.feature_key,
        "trigger": TRIGGER_LABEL.get(uc.trigger) if uc else None,
        "user": event.actor_username or "System", "model": event.response_model or event.requested_model,
        "api": event.api_family, "prompt_tokens": event.prompt_tokens, "completion_tokens": event.completion_tokens,
        "total_tokens": event.total_tokens, "reasoning_tokens": event.reasoning_tokens, "cached_tokens": event.cached_tokens,
        "cost_usd": float(event.estimated_cost) if event.estimated_cost is not None else None,
        "status": "blocked" if is_blocked(event) else event.status, "error_type": event.error_type,
        "duration_ms": event.duration_ms, "attempt": event.attempt_number, "operation_id": event.operation_id,
        "entities": entities_in(report), "decision": report.get("decision"), "reason": report.get("blocked"),
    }
    if detail:
        out.update({
            "endpoint": event.endpoint, "http_method": event.http_method, "requested_model": event.requested_model,
            "response_model": event.response_model, "provider": event.provider, "pricing_version": event.pricing_version,
            "gateway": report, "use_case_detail": ({"value": uc.value, "surface": uc.surface, "level": uc.level,
                                                    "level_meaning": LEVEL_MEANING[uc.level], "profile": uc.profile,
                                                    "records": list(uc.records)} if uc else None),
        })
    return out


def activity(db, *, days: int = 30, module: Optional[str] = None, use_case: Optional[str] = None, status: Optional[str] = None,
             user: Optional[str] = None, q: Optional[str] = None, skip: int = 0, limit: int = 50) -> Dict[str, Any]:
    query = db.query(AIUsageEvent).filter(AIUsageEvent.occurred_at >= since(days))
    if module:
        query = query.filter(AIUsageEvent.module_key == module)
    if use_case:
        query = query.filter(AIUsageEvent.use_case_id == use_case)
    if status == "blocked":
        query = query.filter(AIUsageEvent.error_type == "AIBlocked")
    elif status == "failed":
        query = query.filter(AIUsageEvent.status != "success", func.coalesce(AIUsageEvent.error_type, "") != "AIBlocked")
    elif status == "success":
        query = query.filter(AIUsageEvent.status == "success")
    if user:
        query = query.filter(AIUsageEvent.actor_username == user)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((AIUsageEvent.feature_key.ilike(like)) | (AIUsageEvent.endpoint.ilike(like))
                             | (AIUsageEvent.actor_username.ilike(like)) | (AIUsageEvent.operation_id == q.strip()))
    total = query.count()
    rows = query.order_by(AIUsageEvent.occurred_at.desc(), AIUsageEvent.id.desc()).offset(max(skip, 0)).limit(min(max(limit, 1), 200)).all()
    return {"total": total, "items": [serialize(r) for r in rows]}


def trace(db, operation_id: str) -> List[Dict[str, Any]]:
    """Every call of one operation (an upload, a job, a click), in the order they happened."""
    rows = (db.query(AIUsageEvent).filter(AIUsageEvent.operation_id == operation_id)
            .order_by(AIUsageEvent.occurred_at.asc(), AIUsageEvent.id.asc()).limit(200).all())
    return [serialize(r) for r in rows]
