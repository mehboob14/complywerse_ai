"""How often suppliers are checked, and how an outside-in scan is scored, per tenant.

The feeds shipped with fixed numbers: news and certificates checked daily for a
critical supplier and quarterly for a low one, outside-in scans weekly to twice
a year, a finding taking 30, 15, 6 or 2 points off 100 by severity, no category
taking more than 40, and grades at 90, 80, 70 and 55. Those stay the defaults; a
tenant can set its own. Points must fall with severity and grades with score,
so a change cannot make a worse finding count for less.
"""
from __future__ import annotations

import copy
from typing import Dict, Optional

from sqlalchemy.orm import Session

from .bootstrap import get_tiering_config

TIERS = ("critical", "high", "medium", "low")
SEVERITIES = ("critical", "high", "medium", "low")
POLL_EVERY_DAYS = {"critical": 1, "high": 7, "medium": 30, "low": 90}
SCAN_EVERY_DAYS = {"critical": 7, "high": 30, "medium": 90, "low": 180}
POINTS = {"critical": 30, "high": 15, "medium": 6, "low": 2}
CATEGORY_CAP = 40
GRADES = {"A": 90, "B": 80, "C": 70, "D": 55}          # at or above; below D is F
DEFAULTS: Dict = {
    "adverse_media": False, "outside_in": False,
    "check_every_days": POLL_EVERY_DAYS, "scan_every_days": SCAN_EVERY_DAYS,
    "scan_points": POINTS, "scan_category_cap": CATEGORY_CAP, "grades": GRADES,
    # Shadow SaaS read from Grip Security once a day (tpra/shadow_saas.py).
    "grip_daily": False,
    # Public code searched for suppliers' and our own domains beside credential words (tpra/leaks.py).
    "leak_search": False,
    "own_domains": [],
}
_DAYS_LIMIT = {"check_every_days": 365, "scan_every_days": 730}


def merged(stored: Optional[dict]) -> dict:
    out = copy.deepcopy(DEFAULTS)
    for key, value in (stored or {}).items():
        if isinstance(out.get(key), dict) and isinstance(value, dict):
            out[key].update({k: v for k, v in value.items() if k in out[key]})
        elif key in out:
            out[key] = value
    return out


def for_tenant(db: Session, tenant_id: int) -> dict:
    return merged(get_tiering_config(db, tenant_id).get("monitoring_policy"))


def grade(score: int, grades: Optional[Dict[str, int]] = None) -> str:
    bands = grades or GRADES
    return next((g for g in ("A", "B", "C", "D") if score >= bands[g]), "F")


def _whole(value, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise ValueError(f"{name} must be a whole number")
    if not low <= int(value) <= high:
        raise ValueError(f"{name} must be from {low} to {high}")
    return int(value)


def clean(raw: dict, current: Optional[dict]) -> dict:
    """The tenant's monitoring settings after a change; unknown keys are refused."""
    if not isinstance(raw, dict):
        raise ValueError("Monitoring settings must be an object")
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"Unknown monitoring setting: {', '.join(sorted(unknown))}")
    out = merged(current)
    for key, value in raw.items():
        if key in ("adverse_media", "outside_in", "grip_daily", "leak_search"):
            out[key] = bool(value)
        elif key == "own_domains":
            from .leaks import clean_domains  # here: leaks reads this module's settings
            out[key] = clean_domains(value)
        elif key in _DAYS_LIMIT:
            if not isinstance(value, dict) or set(value) - set(TIERS):
                raise ValueError("Days must be given per tier: critical, high, medium, low")
            for tier, days in value.items():
                out[key][tier] = _whole(days, f"Days for a {tier} supplier", 1, _DAYS_LIMIT[key])
        elif key == "scan_points":
            if not isinstance(value, dict) or set(value) - set(SEVERITIES):
                raise ValueError("Points must be given per severity: critical, high, medium, low")
            for sev, pts in value.items():
                out[key][sev] = _whole(pts, f"Points for a {sev} finding", 0, 100)
            p = out[key]
            if not p["critical"] >= p["high"] >= p["medium"] >= p["low"]:
                raise ValueError("A more severe finding must take off at least as many points as a less severe one")
        elif key == "scan_category_cap":
            out[key] = _whole(value, "The most one category can take off", 1, 100)
        elif key == "grades":
            if not isinstance(value, dict) or set(value) - set(GRADES):
                raise ValueError("Grades are given for A, B, C and D (below D is F)")
            for g, at in value.items():
                out[key][g] = _whole(at, f"The score for grade {g}", 1, 100)
            b = out[key]
            if not b["A"] > b["B"] > b["C"] > b["D"]:
                raise ValueError("Each grade must start at a higher score than the next: A above B above C above D")
    return out


if __name__ == "__main__":
    assert grade(90) == "A" and grade(89) == "B" and grade(54) == "F"
    assert grade(60, {"A": 95, "B": 85, "C": 75, "D": 60}) == "D"
    assert merged({"grades": {"A": 95}, "junk": 1})["grades"] == {"A": 95, "B": 80, "C": 70, "D": 55}
    for bad in ({"scan_points": {"low": 50}}, {"grades": {"B": 95}}, {"check_every_days": {"low": 0}}, {"x": 1}):
        try:
            clean(bad, None)
            raise AssertionError(bad)
        except ValueError:
            pass
    assert clean({"scan_every_days": {"low": 365}}, None)["scan_every_days"]["low"] == 365
    print("monitoring_policy ok")
