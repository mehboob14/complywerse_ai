"""Composite priority calculation.

Single pure function so the formula lives in one place — the on-demand
enrich endpoint, the ingest hooks, and the daily refresh all call this.
Tuning the weights is a one-line change here; no other module knows about
the math.

Formula:
    priority =  0.40 * cvss_score
              + 0.30 * (epss_score * 10)        # scale 0-1 → 0-10
              + 0.20 * (10 if kev_flag else 0)
              + 0.10 * asset_criticality_score   # critical=10, high=7,
                                                 # medium=5, low=2

Range: 0.0 - 10.0. Higher = more urgent. Severity buckets we suggest on
the frontend chip:
    Critical   >= 9.0
    High       7.0 - 8.99
    Medium     4.0 - 6.99
    Low        < 4.0
"""
from __future__ import annotations

from typing import Optional

# Tunable. Sum must stay at 1.0 to keep the result in 0-10.
WEIGHT_CVSS = 0.40
WEIGHT_EPSS = 0.30
WEIGHT_KEV = 0.20
WEIGHT_ASSET = 0.10

_ASSET_CRITICALITY_SCORE = {
    "critical": 10.0,
    "high": 7.0,
    "medium": 5.0,
    "low": 2.0,
}
_DEFAULT_ASSET_SCORE = 5.0  # Medium — used when no asset is linked.


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def compute_composite_priority(
    *,
    cvss_score: Optional[float] = None,
    epss_score: Optional[float] = None,
    kev_flag: Optional[bool] = None,
    asset_criticality: Optional[str] = None,
) -> Optional[float]:
    """Compute the 0-10 priority score from enrichment fields.

    Returns None when every signal is missing — that lets the caller leave
    `composite_priority` as NULL on rows we have no data for, rather than
    storing a misleading 0.0.
    """
    # Skip rows where nothing is known — keeps the column honest.
    if cvss_score is None and epss_score is None and not kev_flag and not asset_criticality:
        return None

    cvss_component = WEIGHT_CVSS * _safe_float(cvss_score)
    epss_component = WEIGHT_EPSS * (_safe_float(epss_score) * 10.0)
    kev_component = WEIGHT_KEV * (10.0 if kev_flag else 0.0)

    asset_score = _ASSET_CRITICALITY_SCORE.get(
        (asset_criticality or "").lower().strip(),
        _DEFAULT_ASSET_SCORE,
    )
    asset_component = WEIGHT_ASSET * asset_score

    priority = cvss_component + epss_component + kev_component + asset_component
    # Clamp defensively in case a caller passes out-of-range inputs.
    return max(0.0, min(10.0, round(priority, 2)))


def priority_bucket(priority: Optional[float]) -> Optional[str]:
    """Human label for a priority score. Used by frontend payloads."""
    if priority is None:
        return None
    if priority >= 9.0:
        return "critical"
    if priority >= 7.0:
        return "high"
    if priority >= 4.0:
        return "medium"
    return "low"
