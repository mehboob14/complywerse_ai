"""What a vendor could cost us in a year, always as a range.

Two ways a vendor hurts us: data of ours is exposed at the vendor, or the vendor
stops and the processes that depend on it stop too. Each has a frequency (events
a year) and a cost per event. Every input is a range (least, most likely, most),
drawn as a PERT distribution, and a few thousand simulated years give the
spread: the chance of any loss this year, the average year, and the bad year
that comes one year in ten and one in twenty.

The inputs are what the programme already holds. The tier sets how often events
happen and the residual rating scales that for the controls the assessment
found. The data the vendor can reach sets how many records an event exposes.
The most critical continuity process behind the vendor sets what an hour of
outage costs. The constants are the tenant's to calibrate; the defaults are
starting values, not benchmarks, and every change to them is audited.

Results are keyed by vendor id and reproducible: the random seed comes from the
vendor and its inputs, so the same inputs give the same numbers, and the
"if the controls improved" comparison reuses the same draws.
"""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import date
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAAuditLog, Vendor, get_db
from ....routers.auth_router import require_auth

LEVELS = ("critical", "high", "medium", "low")
ACCESS = ("none", "public", "internal", "confidential", "restricted", "regulated")
RATINGS = LEVELS + ("unrated",)

DEFAULT_QUANT: Dict = {
    "currency": "USD",
    "iterations": 5000,
    # Loss events a year, [least, most likely, most], by tier.
    "breach_per_year": {"critical": [0.05, 0.15, 0.5], "high": [0.03, 0.1, 0.3],
                        "medium": [0.01, 0.05, 0.15], "low": [0.005, 0.02, 0.08]},
    "outage_per_year": {"critical": [0.2, 1.0, 3.0], "high": [0.1, 0.5, 2.0],
                        "medium": [0.05, 0.25, 1.0], "low": [0.02, 0.1, 0.5]},
    # Records of ours an event exposes, by the data the vendor can reach.
    "records": {"none": [0, 0, 0], "public": [0, 0, 0], "internal": [100, 1000, 10000],
                "confidential": [1000, 10000, 100000], "restricted": [10000, 50000, 500000],
                "regulated": [10000, 50000, 500000]},
    "cost_per_record": [20, 150, 400],
    "response_cost": [10000, 50000, 250000],
    "outage_hours": [1, 6, 48],
    # What an hour of outage costs, by the criticality of the process that stops.
    "outage_cost_per_hour": {"critical": [10000, 50000, 200000], "high": [2000, 10000, 50000],
                             "medium": [500, 2000, 10000], "low": [50, 300, 2000]},
    # How the residual rating scales frequency: weaker controls, more events.
    "control_effect": {"critical": 2.0, "high": 1.4, "medium": 1.0, "low": 0.6, "unrated": 1.0},
}
_TRIPLE_GROUPS = {"breach_per_year": LEVELS, "outage_per_year": LEVELS, "records": ACCESS,
                  "outage_cost_per_hour": LEVELS}
_TRIPLES = ("cost_per_record", "response_cost", "outage_hours")
_CAP = {"breach_per_year": 52, "outage_per_year": 52}


# ── Constants ────────────────────────────────────────────────────────────────

def merged(stored: Optional[dict]) -> dict:
    out = copy.deepcopy(DEFAULT_QUANT)
    for k, v in (stored or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        elif k in out:
            out[k] = v
    return out


def _triple(value, name: str, cap: float) -> List[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{name} needs three numbers: least, most likely, most")
    try:
        lo, mode, hi = (float(x) for x in value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} needs three numbers: least, most likely, most")
    if not 0 <= lo <= mode <= hi <= cap:
        raise ValueError(f"{name} must run least ≤ most likely ≤ most, from 0 to {cap:g}")
    return [lo, mode, hi]


def clean(raw: dict, current: dict) -> dict:
    """Validate an update against the current constants; unknown keys are refused."""
    unknown = set(raw) - set(DEFAULT_QUANT)
    if unknown:
        raise ValueError(f"Unknown quantification setting: {', '.join(sorted(unknown))}")
    out = merged(current)
    for key, value in raw.items():
        if key == "currency":
            if not (isinstance(value, str) and len(value) == 3 and value.isalpha()):
                raise ValueError("Currency must be a three-letter code")
            out[key] = value.upper()
        elif key == "iterations":
            if not isinstance(value, int) or isinstance(value, bool) or not 1000 <= value <= 20000:
                raise ValueError("Iterations must be a whole number from 1,000 to 20,000")
            out[key] = value
        elif key in _TRIPLES:
            out[key] = _triple(value, key.replace("_", " ").capitalize(), 1e12)
        elif key in _TRIPLE_GROUPS:
            if not isinstance(value, dict) or set(value) - set(_TRIPLE_GROUPS[key]):
                raise ValueError(f"{key.replace('_', ' ').capitalize()} is keyed by {', '.join(_TRIPLE_GROUPS[key])}")
            for band, triple in value.items():
                out[key][band] = _triple(triple, f"{key.replace('_', ' ').capitalize()} ({band})", _CAP.get(key, 1e12))
        elif key == "control_effect":
            if not isinstance(value, dict) or set(value) - set(RATINGS):
                raise ValueError(f"Control effect is keyed by {', '.join(RATINGS)}")
            for band, x in value.items():
                if not isinstance(x, (int, float)) or isinstance(x, bool) or not 0.05 <= x <= 10:
                    raise ValueError(f"Control effect ({band}) must be a number from 0.05 to 10")
                out[key][band] = float(x)
    return out


def changes(before: dict, after: dict) -> Dict[str, list]:
    """{setting: [was, now]} for every value that moved, for the audit trail."""
    out = {}
    for key in DEFAULT_QUANT:
        b, a = before.get(key), after.get(key)
        if isinstance(a, dict):
            for band in a:
                if (b or {}).get(band) != a[band]:
                    out[f"{key}.{band}"] = [(b or {}).get(band), a[band]]
        elif b != a:
            out[key] = [b, a]
    return out


# ── Simulation ───────────────────────────────────────────────────────────────

def _pert(rng: np.random.Generator, triple, n: int) -> np.ndarray:
    lo, mode, hi = (float(x) for x in triple)
    if hi <= lo:
        return np.full(n, lo)
    a = 1 + 4 * (mode - lo) / (hi - lo)
    b = 1 + 4 * (hi - mode) / (hi - lo)
    return lo + rng.beta(a, b, n) * (hi - lo)


def _poisson(u: np.ndarray, lam: np.ndarray) -> np.ndarray:
    """Poisson counts by inversion: the same draw gives no more events at a lower
    rate, so a comparison between two ratings moves in one direction only."""
    count, p = np.zeros(u.shape), np.exp(-lam)
    cdf, k = p.copy(), 0
    while k < 2000:
        more = u > cdf
        if not more.any():
            break
        k += 1
        count += more
        p = p * lam / k
        cdf = cdf + p
    return count


def _band(value: Optional[str], allowed, fallback: str) -> str:
    v = (value or "").lower()
    return v if v in allowed else fallback


def profile(vendor: Vendor, processes: List[dict]) -> dict:
    """The facts the model reads for one vendor."""
    tier = _band(vendor.tier, LEVELS, "medium")
    crit = [p["criticality"] for p in processes if p.get("criticality") in LEVELS]
    worst = min(crit, key=LEVELS.index) if crit else None
    stops = next((p for p in processes if p.get("criticality") == worst), None) if worst else None
    return {"vendor_id": vendor.id, "tier": tier, "access": _band(vendor.data_access_level, ACCESS, "none"),
            "rating": _band(vendor.risk_rating, RATINGS, "unrated"), "outage_band": worst or tier,
            "process": stops["function"] if stops else None, "rto_hours": stops.get("rto_hours") if stops else None}


def _simulate(p: dict, cfg: dict, rating: str) -> Dict[str, np.ndarray]:
    n = int(cfg["iterations"])
    basis = {k: p[k] for k in ("vendor_id", "tier", "access", "outage_band")}
    seed = int(hashlib.sha256(json.dumps([basis, cfg], sort_keys=True).encode()).hexdigest()[:12], 16)
    rng = np.random.default_rng(seed)       # every draw below is the same whatever the rating
    effect = float(cfg["control_effect"].get(rating, 1.0))
    u_breach, u_outage = rng.random(n), rng.random(n)
    breach_rate = _pert(rng, cfg["breach_per_year"][p["tier"]], n)
    outage_rate = _pert(rng, cfg["outage_per_year"][p["tier"]], n)
    per_breach = (_pert(rng, cfg["records"][p["access"]], n) * _pert(rng, cfg["cost_per_record"], n)
                  + _pert(rng, cfg["response_cost"], n))
    if max(cfg["records"][p["access"]]) <= 0:
        per_breach = np.zeros(n)            # it reaches none of our data
    per_outage = _pert(rng, cfg["outage_hours"], n) * _pert(rng, cfg["outage_cost_per_hour"][p["outage_band"]], n)
    breaches = _poisson(u_breach, breach_rate * effect)
    outages = _poisson(u_outage, outage_rate * effect)
    return {"data": breaches * per_breach, "outage": outages * per_outage, "per_breach": per_breach,
            "per_outage": per_outage}


def _year(x: np.ndarray) -> dict:
    return {"chance": round(float((x > 0).mean()), 3), "mean": round(float(x.mean())),
            "p90": round(float(np.percentile(x, 90))), "p95": round(float(np.percentile(x, 95)))}


def _event(x: np.ndarray) -> dict:
    return {"p10": round(float(np.percentile(x, 10))), "p50": round(float(np.percentile(x, 50))),
            "p90": round(float(np.percentile(x, 90)))}


def _better(rating: str) -> Optional[str]:
    if rating == "unrated":
        return None
    i = LEVELS.index(rating)
    return LEVELS[i + 1] if i + 1 < len(LEVELS) else None


def assumptions(cfg: dict) -> List[str]:
    effect = ", ".join(f"{k} ×{v:g}" for k, v in cfg["control_effect"].items())
    return [
        "Each input is a range: least, most likely and most, drawn as a PERT distribution.",
        f"{cfg['iterations']:,} simulated years; events arrive independently (Poisson) at the drawn yearly rate.",
        f"The tier sets how often events happen; the residual rating scales it ({effect}).",
        "An outage is costed by the most critical continuity process that depends on the vendor, "
        "or by the vendor's tier when none is recorded.",
        "The constants are this organisation's starting values to calibrate, not industry benchmarks.",
    ]


def quantify(vendor: Vendor, processes: List[dict], cfg: dict) -> dict:
    p = profile(vendor, processes)
    sims = _simulate(p, cfg, p["rating"])
    total = sims["data"] + sims["outage"]
    effect = cfg["control_effect"].get(p["rating"], 1.0)
    freq_basis = f"Tier {p['tier']}, residual rating {p['rating']} (×{effect:g})"
    no_data = max(cfg["records"][p["access"]]) <= 0
    scenarios = [
        {"key": "data", "label": "Our data exposed at the vendor", "active": not no_data,
         "per_year": _year(sims["data"]), "per_event": _event(sims["per_breach"]),
         "inputs": [
             {"factor": "Events a year", "range": cfg["breach_per_year"][p["tier"]], "basis": freq_basis},
             {"factor": "Records exposed", "range": cfg["records"][p["access"]], "basis": f"Data access: {p['access']}"},
             {"factor": "Cost per record", "range": cfg["cost_per_record"], "basis": "Constant"},
             {"factor": "Response cost per event", "range": cfg["response_cost"], "basis": "Constant"},
         ],
         "note": "It reaches none of our data, so an event there exposes none." if no_data else None},
        {"key": "outage", "label": "The vendor stops, and our processes with it", "active": True,
         "per_year": _year(sims["outage"]), "per_event": _event(sims["per_outage"]),
         "inputs": [
             {"factor": "Events a year", "range": cfg["outage_per_year"][p["tier"]], "basis": freq_basis},
             {"factor": "Hours down", "range": cfg["outage_hours"],
              "basis": f"Constant; {p['process']} has an RTO of {p['rto_hours']} h" if p["rto_hours"] else "Constant"},
             {"factor": "Cost per hour", "range": cfg["outage_cost_per_hour"][p["outage_band"]],
              "basis": (f"{p['process']} is {p['outage_band']}" if p["process"]
                        else f"No continuity process recorded; the vendor's tier ({p['tier']}) stands in")},
         ],
         "note": None},
    ]
    better = _better(p["rating"])
    improved = None
    if better:
        alt = _simulate(p, cfg, better)
        improved = {"rating_from": p["rating"], "rating_to": better, "annual": _year(alt["data"] + alt["outage"])}
    return {"vendor_id": vendor.id, "currency": cfg["currency"], "iterations": int(cfg["iterations"]),
            "annual": _year(total), "scenarios": scenarios, "if_improved": improved, "assumptions": assumptions(cfg)}


def portfolio(db: Session, tenant_id: int, cfg: dict, today: Optional[date] = None, top: int = 10) -> dict:
    """Every vendor in use, summed year by year. Vendors are treated as independent,
    so a shared platform failing under several at once is not in these figures."""
    from .reports import _vendors, functions

    vendors = _vendors(db, tenant_id)
    by_vendor: Dict[int, List[dict]] = {}
    for f in functions(db, tenant_id, today or date.today(), vendors):
        by_vendor.setdefault(f["vendor_id"], []).append(f)
    total = np.zeros(int(cfg["iterations"]))
    rows = []
    # ponytail: simulated on request, about 5 ms a vendor; snapshot daily once portfolios pass a few thousand
    for v in vendors:
        p = profile(v, by_vendor.get(v.id, []))
        sims = _simulate(p, cfg, p["rating"])
        year = sims["data"] + sims["outage"]
        total += year
        rows.append({"vendor_id": v.id, "name": v.name, "tier": p["tier"], "rating": p["rating"], "annual": _year(year)})
    rows.sort(key=lambda r: (-r["annual"]["p95"], -r["annual"]["mean"], r["name"]))
    return {"currency": cfg["currency"], "iterations": int(cfg["iterations"]), "vendor_count": len(vendors),
            "annual": _year(total) if vendors else None, "vendors": rows[:top],
            "assumptions": assumptions(cfg) + ["Vendors are summed as independent; a platform several of them share "
                                               "failing at once would make the bad year worse than shown."]}


# ── REST ─────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/tpra", tags=["TPRA Exposure"])


def _config(db: Session, tenant_id: int) -> dict:
    from .bootstrap import get_tiering_config
    return merged(get_tiering_config(db, tenant_id).get("quantification"))


@router.get("/vendors/{vendor_id}/exposure")
def vendor_exposure(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from .graph import _tenant, _vendor
    from .reports import functions

    tid = _tenant(db, user)
    vendor = _vendor(db, tid, vendor_id)
    return quantify(vendor, functions(db, tid, date.today(), [vendor]), _config(db, tid))


@router.get("/exposure")
def portfolio_exposure(top: int = Query(10, ge=1, le=100), db: Session = Depends(get_db),
                       user: GRCUser = Depends(require_auth)):
    from .graph import _tenant

    tid = _tenant(db, user)
    return portfolio(db, tid, _config(db, tid), top=top)


@router.get("/quantification/history")
def constants_history(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Every change to the exposure model's constants: who, when, and what moved."""
    from .attention import _names
    from .graph import _tenant

    tid = _tenant(db, user)
    rows = (db.query(TPRAAuditLog).filter(TPRAAuditLog.tenant_id == tid, TPRAAuditLog.entity == "quantification")
            .order_by(TPRAAuditLog.created_at.desc()).limit(100).all())
    people = _names(db, {r.actor_id for r in rows})
    return {"items": [{"at": r.created_at.isoformat() if r.created_at else None, "by": people.get(r.actor_id),
                       "was": json.loads(r.from_value or "{}"), "now": json.loads(r.to_value or "{}")} for r in rows]}
