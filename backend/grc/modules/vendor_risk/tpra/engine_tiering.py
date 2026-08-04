"""Inherent-risk tiering engine (stage 02 gate).

Pure functions: given five factor scores (each 0..4) and a config (weights +
thresholds), produce a 0..100 inherent score and a tier in
critical/high/medium/low. The tier drives assessment depth, suggested templates,
reviewer requirements and reassessment cadence elsewhere. Weights/thresholds are
configurable (DEFAULT_TIERING_CONFIG or a tenant's TPRATieringConfig row).
"""
from __future__ import annotations

from typing import Dict, Optional

from .bootstrap import DEFAULT_TIERING_CONFIG

FACTOR_KEYS = [
    "data_sensitivity",
    "business_criticality",
    "system_access",
    "regulatory_scope",
    "fourth_party",
]

# Heuristic fallback mapping when explicit factor scores aren't supplied — derived
# from the vendor profile so a tier can still be proposed without questionnaire input.
_DATA_ACCESS_SCORE = {"none": 0, "public": 1, "internal": 2, "confidential": 3, "restricted": 4, "regulated": 4}


def _clamp_factor(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(4.0, f))


def score_to_tier(score: float, thresholds: Dict[str, float]) -> str:
    """Bucket a 0..100 score into a tier, evaluated high→low."""
    t = thresholds or DEFAULT_TIERING_CONFIG["thresholds"]
    if score >= float(t.get("critical", 75)):
        return "critical"
    if score >= float(t.get("high", 50)):
        return "high"
    if score >= float(t.get("medium", 25)):
        return "medium"
    return "low"


def compute_inherent_tier(factors: Dict[str, float], config: Optional[dict] = None) -> dict:
    """Weighted inherent-risk score (0..100) + tier + per-factor contributions.

    Each factor is 0..4; normalized to 0..1, multiplied by its weight (weights
    sum to ~1.0), summed, then scaled to 0..100.
    """
    cfg = config or DEFAULT_TIERING_CONFIG
    weights = cfg.get("weights") or DEFAULT_TIERING_CONFIG["weights"]
    thresholds = cfg.get("thresholds") or DEFAULT_TIERING_CONFIG["thresholds"]

    contributions: Dict[str, float] = {}
    weighted = 0.0
    for k in FACTOR_KEYS:
        raw = _clamp_factor(factors.get(k, 0))
        w = float(weights.get(k, 0.0))
        norm = raw / 4.0
        contrib = norm * w
        contributions[k] = round(contrib * 100, 2)
        weighted += contrib

    score = round(weighted * 100, 2)
    tier = score_to_tier(score, thresholds)
    return {
        "score": score,
        "tier": tier,
        "contributions": contributions,
        "factors": {k: _clamp_factor(factors.get(k, 0)) for k in FACTOR_KEYS},
    }


def derive_factors_from_profile(profile: dict) -> Dict[str, float]:
    """Best-effort factor estimate from a vendor profile (no questionnaire needed).

    Used as a deterministic fallback when AI tiering is unavailable. `profile`
    keys (all optional): data_access_level, data_types_accessed (list),
    business_criticality (0..4 or low/medium/high/critical), system_access (bool),
    regulatory_scope (list/bool), geographic_locations (list), fourth_party (bool).
    """
    crit_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}

    data_sensitivity = _DATA_ACCESS_SCORE.get(str(profile.get("data_access_level", "none")).lower(), 0)
    dtypes = profile.get("data_types_accessed") or []
    if any(str(t).lower() in ("pii", "phi", "financial", "pci", "regulated") for t in dtypes):
        data_sensitivity = max(data_sensitivity, 3)

    bc_raw = profile.get("business_criticality")
    if isinstance(bc_raw, str):
        business_criticality = crit_map.get(bc_raw.lower(), 2)
    elif bc_raw is None:
        business_criticality = 2
    else:
        business_criticality = _clamp_factor(bc_raw)

    system_access = 3 if profile.get("system_access") else (2 if data_sensitivity >= 3 else 1)

    reg = profile.get("regulatory_scope")
    if isinstance(reg, (list, tuple)):
        regulatory_scope = min(4, len(reg) + 1) if reg else 1
    else:
        regulatory_scope = 3 if reg else 1

    geos = profile.get("geographic_locations") or []
    fourth_party = 3 if profile.get("fourth_party") else (2 if len(geos) > 1 else 1)

    return {
        "data_sensitivity": float(data_sensitivity),
        "business_criticality": float(business_criticality),
        "system_access": float(system_access),
        "regulatory_scope": float(regulatory_scope),
        "fourth_party": float(fourth_party),
    }
