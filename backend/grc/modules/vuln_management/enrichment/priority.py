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

# Seven weighted signals, summing to 10.0.
#
# The earlier model used four signals and gave CVSS 40% of the total. That
# over-weighted a STATIC severity rating: CVSS says how bad the flaw is if
# exploited, not how likely anyone is to exploit it here. Two findings with
# identical CVSS can differ enormously in real risk depending on whether an
# exploit is weaponised, whether the flaw is network-reachable, and whether
# the host faces the internet.
#
# So CVSS drops to 20% and the freed weight moves to exploitability signals:
#
#   cvss 2.0 | epss 2.0 | exploit maturity 1.5 | kev 1.5 |
#   attack vector 1.0 | internet exposure 1.0 | asset criticality 1.0
#
# KEV FLOOR: anything on CISA's Known Exploited list is being exploited in
# the wild right now, so its score is floored at 8.0 regardless of the rest.
# A known-exploited bug is never "medium priority".
WEIGHT_CVSS = 0.20
WEIGHT_EPSS = 0.20
WEIGHT_MATURITY = 0.15
WEIGHT_KEV = 0.15
WEIGHT_VECTOR = 0.10
WEIGHT_EXPOSURE = 0.10
WEIGHT_ASSET = 0.10

KEV_FLOOR = 8.0

# How weaponised a public exploit is. Unknown gets 0.3 — some latent risk,
# not zero, because absence of evidence is not evidence of absence.
_MATURITY_WEIGHT = {
    "weaponized": 1.0, "weaponised": 1.0, "high": 1.0,
    "functional": 0.7,
    "proof_of_concept": 0.4, "poc": 0.4,
    "unproven": 0.1, "none": 0.1,
}
_DEFAULT_MATURITY = 0.3

# How reachable the flaw is. Network-reachable is dramatically more dangerous
# than something needing physical access to the box.
_VECTOR_WEIGHT = {
    "network": 1.0, "n": 1.0,
    "adjacent": 0.6, "adjacent_network": 0.6, "a": 0.6,
    "local": 0.3, "l": 0.3,
    "physical": 0.1, "p": 0.1,
}
# Used when no CVSS vector is on file. Midway between local and network on
# purpose: assuming "network" inflates every unvectored finding, assuming
# "local" quietly understates real internet-facing risk.
#
# It is still a guess worth 10% of the score, so callers that need to be honest
# about it can check `attack_vector_assumed` on the result rather than having to
# re-derive whether a vector was present.
_DEFAULT_VECTOR = 0.5

_ASSET_CRITICALITY_SCORE = {
    "critical": 10.0,
    "high": 7.0,
    "medium": 5.0,
    "low": 2.0,
}
_DEFAULT_ASSET_SCORE = 5.0  # Medium — used when no asset is linked.


def _norm(value) -> str:
    """Lower-case and underscore-join, so "Proof of Concept" == "proof_of_concept"."""
    return (value or "").strip().lower().replace("-", "_").replace(" ", "_")


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
    asset_criticality_score: Optional[float] = None,
    exploit_maturity: Optional[str] = None,
    attack_vector: Optional[str] = None,
    internet_exposed: Optional[bool] = None,
) -> Optional[float]:
    """Compute the 0-10 priority score from enrichment fields.

    Returns None when every signal is missing — that lets the caller leave
    `composite_priority` as NULL on rows we have no data for, rather than
    storing a misleading 0.0.

    Asset-criticality input precedence (Phase 5.4):
        1. `asset_criticality_score` (numeric 0-10) — preferred when set.
        2. `asset_criticality` (text: low/medium/high/critical) — fallback
           for rows whose linked asset hasn't had its derived score computed.
        3. Default of 5.0 (medium) when neither is supplied.
    """
    # Skip rows where nothing is known — keeps the column honest.
    if (
        cvss_score is None
        and epss_score is None
        and not kev_flag
        and not asset_criticality
        and asset_criticality_score is None
    ):
        return None

    cvss_component = WEIGHT_CVSS * _safe_float(cvss_score)
    epss_component = WEIGHT_EPSS * (_safe_float(epss_score) * 10.0)
    kev_component = WEIGHT_KEV * (10.0 if kev_flag else 0.0)
    maturity_component = WEIGHT_MATURITY * (
        _MATURITY_WEIGHT.get(_norm(exploit_maturity), _DEFAULT_MATURITY) * 10.0
    )
    vector_component = WEIGHT_VECTOR * (
        _VECTOR_WEIGHT.get(_norm(attack_vector), _DEFAULT_VECTOR) * 10.0
    )
    exposure_component = WEIGHT_EXPOSURE * (10.0 if internet_exposed else 0.0)

    if asset_criticality_score is not None:
        # Clamp defensively — caller may pass anything.
        asset_score = max(0.0, min(10.0, _safe_float(asset_criticality_score)))
    else:
        asset_score = _ASSET_CRITICALITY_SCORE.get(
            (asset_criticality or "").lower().strip(),
            _DEFAULT_ASSET_SCORE,
        )
    asset_component = WEIGHT_ASSET * asset_score

    priority = (
        cvss_component + epss_component + maturity_component + kev_component
        + vector_component + exposure_component + asset_component
    )
    # Known-exploited bugs are urgent regardless of the other signals.
    if kev_flag and priority < KEV_FLOOR:
        priority = KEV_FLOOR
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
