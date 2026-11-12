"""Inherent-risk tiering engine (stage 02 gate).

Pure functions: given five factor scores (each 0..4) and a config (weights +
thresholds), produce a 0..100 inherent score and a tier in
critical/high/medium/low. The tier drives assessment depth, suggested templates,
reviewer requirements and reassessment cadence elsewhere. Weights/thresholds are
configurable (DEFAULT_TIERING_CONFIG or a tenant's TPRATieringConfig row).

An onboarding answer can also hold the tier at a minimum whatever the score says
(customisation: `min_tier` on a yes or on an option); the tier is then the worse
of the score's band and the worst minimum among the answers picked.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from . import intake as intake_answers
from .bootstrap import DEFAULT_TIERING_CONFIG
from .stages import TIER_RANK

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


# The enterprise Risk Register scores 1–25 (likelihood × impact, each 1–5) and bands it critical ≥ 20, high ≥ 12,
# medium ≥ 6 (models.risk_priority_for_score). A TPRA score (0–100) lands in the register band named like its own
# TPRA band on the tenant's thresholds, and climbs that band's steps as it climbs its own band; each step is an
# L × I pair whose product is the register score, so the heat map cell and the band always agree.
_ERM_STEPS = {
    "low": ((1, 1), (1, 2), (2, 2)),          # 1, 2, 4
    "medium": ((2, 3), (2, 4), (3, 3)),       # 6, 8, 9
    "high": ((3, 4), (4, 4)),                 # 12, 16
    "critical": ((4, 5), (5, 5)),             # 20, 25
}


def to_erm_scale(score, thresholds: Optional[Dict[str, float]] = None,
                 rating: Optional[str] = None) -> Optional[Tuple[int, int, int]]:
    """(likelihood, impact, likelihood × impact) on the register's 1–25 scale for a 0–100 TPRA score; None when
    unscored. A `rating` the score alone may not reach (a failed critical control floors it at high, a tier set by
    hand) decides the band; the score then only places it within that band."""
    if score is None:
        return None
    t = thresholds or DEFAULT_TIERING_CONFIG["thresholds"]
    band = (rating or "").lower()
    band = band if band in _ERM_STEPS else score_to_tier(float(score), t)
    starts = {"low": 0.0, "medium": float(t.get("medium", 25)), "high": float(t.get("high", 50)),
              "critical": float(t.get("critical", 75))}
    ends = {"low": starts["medium"], "medium": starts["high"], "high": starts["critical"], "critical": 100.0}
    span = ends[band] - starts[band]
    at = (float(score) - starts[band]) / span if span > 0 else 0.0
    steps = _ERM_STEPS[band]
    likelihood, impact = steps[min(len(steps) - 1, max(0, int(at * len(steps))))]
    return likelihood, impact, likelihood * impact


def minimum_tier(answers: Optional[dict], custom: Optional[dict] = None) -> Tuple[Optional[str], Optional[str]]:
    """The worst minimum tier the answers hold the supplier at, and the wording of
    the (first) question that set it: (None, None) when no answer sets one. Only
    questions asked count: not a hidden or removed one, nor one a no kept off."""
    given = (answers or {}).get("answers") or {}
    if not given:
        return None, None
    changed = (custom or {}).get("builtin") if isinstance((custom or {}).get("builtin"), dict) else {}
    worst, source = None, None
    for key, q in intake_answers.spec(custom)["questions"].items():
        if key not in given or q.get("archived") or q.get("hidden") or not intake_answers._asked(q, given):
            continue
        value = given[key]
        if q["type"] == "yes_no":
            held = [(changed.get(key) or {}).get("min_tier") if q.get("builtin") else q.get("min_tier")] if value == "yes" else []
        elif q["type"] in ("choice", "multi_choice"):
            picked = value if isinstance(value, list) else [value]
            held = [o.get("min_tier") for o in q.get("options") or [] if o.get("value") in picked]
        else:
            held = []
        for tier in held:
            if tier in TIER_RANK and (worst is None or TIER_RANK[tier] > TIER_RANK[worst]):
                worst, source = tier, q["label"]
    return worst, source


def compute_inherent_tier(factors: Dict[str, float], config: Optional[dict] = None,
                          intake: Optional[dict] = None) -> dict:
    """Weighted inherent-risk score (0..100) + tier + per-factor contributions.

    Each factor is 0..4; normalized to 0..1, multiplied by its weight (weights
    sum to ~1.0), summed, then scaled to 0..100. The onboarding `intake` the
    factors came from, when given, can hold the tier at a minimum: the result
    then says which (`minimum_tier`, and the question it came from).
    """
    cfg = config or DEFAULT_TIERING_CONFIG
    weights = cfg.get("weights") or DEFAULT_TIERING_CONFIG["weights"]
    thresholds = cfg.get("thresholds") or DEFAULT_TIERING_CONFIG["thresholds"]

    # The five built-in factors, then any the tenant added (tpra/customisation.py),
    # which count once they carry a weight.
    keys = FACTOR_KEYS + [k for k in weights if k not in FACTOR_KEYS]
    contributions: Dict[str, float] = {}
    weighted = 0.0
    for k in keys:
        raw = _clamp_factor(factors.get(k, 0))
        w = float(weights.get(k, 0.0))
        norm = raw / 4.0
        contrib = norm * w
        contributions[k] = round(contrib * 100, 2)
        weighted += contrib

    score = round(weighted * 100, 2)
    tier = score_to_tier(score, thresholds)
    held, source = minimum_tier(intake, cfg.get("customisation"))
    if held and TIER_RANK[held] > TIER_RANK[tier]:
        tier = held
    return {
        "score": score,
        "tier": tier,
        "contributions": contributions,
        "factors": {k: _clamp_factor(factors.get(k, 0)) for k in keys},
        "minimum_tier": held,
        "minimum_from": source,
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
