"""Policy-exception risk-posture scoring (asset-weighted).

A 0-100 posture per exception combining exactly the inputs requested:
  • ASSET exposure — linked IT assets' CIA (confidentiality/integrity/availability)
    + criticality (worst-case linked asset drives it)
  • PRIORITY — low → critical
  • open DURATION — how long it has been open (longer = higher risk)
  • closure TIMELINESS — overdue (open past expiry) or closed-late

Portfolio `analytics()` (avg posture, aging buckets, overdue count, closed-on-time %)
feeds the exceptions-page graphs; the same metrics are snapshotted into the history
layer so the trend renders on the exceptions page AND the main dashboard.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

_PRIORITY_NORM = {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}
_CRIT_NORM = {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}
_OPEN_STATES = ("draft", "pending_approval", "approved")
_RESOLVED_STATES = ("revoked", "expired", "rejected")


def _asset_exposure(assets: list) -> Optional[float]:
    """Worst-case exposure (0-1) across the linked assets, from CIA + criticality."""
    best = None
    for a in assets:
        if getattr(a, "criticality_score", None) is not None:
            crit = max(0.0, min(1.0, float(a.criticality_score) / 10.0))
        else:
            crit = _CRIT_NORM.get((getattr(a, "criticality", "") or "").lower(), 0.5)
        cia_parts = [getattr(a, "confidentiality_rating", None),
                     getattr(a, "integrity_rating", None),
                     getattr(a, "availability_rating", None)]
        cia_parts = [float(x) for x in cia_parts if x is not None]
        cia = (sum(cia_parts) / len(cia_parts) / 5.0) if cia_parts else crit
        expo = 0.5 * crit + 0.5 * cia
        best = expo if best is None else max(best, expo)
    return best


def _duration_factor(exc, now: datetime) -> float:
    start = getattr(exc, "effective_date", None) or getattr(exc, "requested_at", None) or getattr(exc, "created_at", None)
    if not start:
        return 0.0
    return max(0.0, min(1.0, (now - start).days / 365.0))


def _overdue_factor(exc, now: datetime) -> float:
    exp = getattr(exc, "expiry_date", None)
    status = (getattr(exc, "status", "") or "").lower()
    if not exp:
        return 0.0
    if status in _OPEN_STATES and now > exp:
        return 1.0                       # still open past its required close date
    closed = getattr(exc, "closed_at", None)
    if status in _RESOLVED_STATES and closed and closed > exp:
        return 0.5                       # closed, but late
    return 0.0


def _band(score: float) -> str:
    return "critical" if score >= 75 else "high" if score >= 50 else "medium" if score >= 25 else "low"


def posture_for(exc, assets: list, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    asset = _asset_exposure(assets)
    prio = _PRIORITY_NORM.get((getattr(exc, "priority", "") or "").lower(), 0.5)
    dur = _duration_factor(exc, now)
    over = _overdue_factor(exc, now)
    if asset is None:
        score = 100 * (0.5 * prio + 0.25 * dur + 0.25 * over)
    else:
        score = 100 * (0.35 * asset + 0.25 * prio + 0.20 * dur + 0.20 * over)
    score = round(score, 1)
    return {
        "score": score, "band": _band(score),
        "factors": {
            "asset_exposure": round(asset, 3) if asset is not None else None,
            "priority": prio, "duration": round(dur, 3), "overdue": over,
        },
        "overdue": over >= 1.0,
        "linked_assets": len(assets),
    }


def closed_on_time(exc) -> Optional[bool]:
    """Was a resolved exception closed by its required date? None = still open / N/A."""
    status = (getattr(exc, "status", "") or "").lower()
    if status not in _RESOLVED_STATES:
        return None
    exp = getattr(exc, "expiry_date", None)
    if not exp:
        return None
    if status == "expired":
        return False   # lapsed to expiry instead of being actively closed on time
    closed = getattr(exc, "closed_at", None) or getattr(exc, "rejected_at", None) or getattr(exc, "updated_at", None)
    return bool(closed and closed <= exp)


def analytics(db: Session, tenant_ids: List[int]) -> dict:
    from ..models import PolicyException, ITAsset
    now = datetime.utcnow()
    excs = db.query(PolicyException).filter(PolicyException.tenant_id.in_(tenant_ids)).all()

    all_ids = {aid for e in excs for aid in (e.linked_asset_ids or [])}
    amap = {}
    if all_ids:
        for a in db.query(ITAsset).filter(ITAsset.id.in_(all_ids)).all():
            amap[a.id] = a

    postures: List[float] = []
    aging = {"0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0, "overdue": 0}
    open_n = overdue_n = on_time = resolved = 0
    by_status: dict = {}
    by_priority: dict = {}

    for e in excs:
        assets = [amap[aid] for aid in (e.linked_asset_ids or []) if aid in amap]
        p = posture_for(e, assets, now)
        status = (e.status or "").lower()
        by_status[status] = by_status.get(status, 0) + 1
        by_priority[(e.priority or "medium").lower()] = by_priority.get((e.priority or "medium").lower(), 0) + 1
        if status in _OPEN_STATES:
            open_n += 1
            postures.append(p["score"])
            if p["overdue"]:
                overdue_n += 1
                aging["overdue"] += 1
            else:
                start = e.effective_date or e.requested_at or e.created_at
                days = (now - start).days if start else 0
                key = "0_30" if days <= 30 else "31_60" if days <= 60 else "61_90" if days <= 90 else "90_plus"
                aging[key] += 1
        cot = closed_on_time(e)
        if cot is not None:
            resolved += 1
            if cot:
                on_time += 1

    avg = round(sum(postures) / len(postures), 1) if postures else None
    return {
        "avg_posture": avg,
        "posture_band": _band(avg) if avg is not None else None,
        "open": open_n,
        "overdue": overdue_n,
        "resolved": resolved,
        "closed_on_time_pct": round(100 * on_time / resolved, 1) if resolved else None,
        "aging_buckets": aging,
        "by_status": by_status,
        "by_priority": by_priority,
        "total": len(excs),
        "definition": ("Exception risk posture (0-100) weights the linked assets' CIA + criticality (35%), "
                       "priority (25%), open duration (20%) and overdue/late-closure (20%); averaged over open exceptions."),
    }
