"""Risk analysis & scoring engine (stage 05).

Pure functions. Maps questionnaire answers to a per-domain control posture and
computes residual risk from the inherent score:

    residual = inherent × (1 − reduction_cap × control_effectiveness)

where control_effectiveness is the control posture (0..1) and reduction is capped
(default 70%). A failed CRITICAL control (answer "No") forces a blocking critical
finding regardless of the headline score.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .bootstrap import DEFAULT_TIERING_CONFIG
from .engine_tiering import score_to_tier

REDUCTION_CAP = 0.70

# Normalized answer → control value (N-A excluded from scoring entirely).
_ANSWER_VALUE = {"yes": 1.0, "partial": 0.5, "no": 0.0}

# A–F letter grade from residual (0..100, lower = better). Each tuple is
# (exclusive upper bound, grade); configurable via TPRATieringConfig.grade_bands.
# Bands match the Sentinel-TPRM reference scale (6 grades incl. E).
DEFAULT_GRADE_BANDS = [(14.0, "A"), (28.0, "B"), (44.0, "C"), (60.0, "D"), (76.0, "E"), (101.0, "F")]


def residual_to_grade(residual: float, bands: Optional[list] = None) -> str:
    """Map a 0..100 residual score to an A–F grade for at-a-glance reporting."""
    table = bands or DEFAULT_GRADE_BANDS
    try:
        val = float(residual)
    except (TypeError, ValueError):
        return "F"
    for ceiling, grade in table:
        if val < float(ceiling):
            return str(grade)
    return "F"


def normalize_answer(ans) -> Optional[str]:
    """Coerce assorted answer encodings to Yes/Partial/No/N-A (or None if blank)."""
    if ans is None:
        return None
    s = str(ans).strip().lower()
    if s in ("", "null", "none"):
        return None
    if s in ("yes", "y", "true", "1", "compliant", "fully"):
        return "yes"
    if s in ("partial", "partially", "in_progress", "0.5", "somewhat"):
        return "partial"
    if s in ("no", "n", "false", "0", "non-compliant", "noncompliant"):
        return "no"
    if s in ("n-a", "n/a", "na", "not_applicable", "not applicable"):
        return "n-a"
    return None


def score_assessment(
    responses: List[dict],
    inherent_score: float,
    config: Optional[dict] = None,
    reduction_cap: float = REDUCTION_CAP,
) -> dict:
    """Compute per-domain posture/residual and an overall residual rating.

    `responses`: list of dicts with keys: domain, answer, weight (float),
    critical_control (bool), and optionally question_key / question_id / title.
    `inherent_score`: 0..100 (from the tiering engine).
    Returns: {overall_inherent, overall_residual, residual_rating, domain_scores,
    critical_failures, blocking}.
    """
    cfg = config or DEFAULT_TIERING_CONFIG
    thresholds = cfg.get("thresholds") or DEFAULT_TIERING_CONFIG["thresholds"]
    inherent = float(inherent_score or 0.0)

    domains: Dict[str, dict] = {}
    critical_failures: List[dict] = []

    for r in responses:
        domain = str(r.get("domain") or "cybersecurity")
        norm = normalize_answer(r.get("answer"))
        weight = float(r.get("weight", 1.0) or 1.0)
        is_critical = bool(r.get("critical_control"))

        d = domains.setdefault(domain, {"weighted_sum": 0.0, "weight_total": 0.0, "answered": 0, "total": 0})
        d["total"] += 1

        # A failed critical control is a blocking finding regardless of score.
        if is_critical and norm == "no":
            critical_failures.append({
                "domain": domain,
                "question_key": r.get("question_key"),
                "question_id": r.get("question_id"),
                "title": r.get("title") or "Critical control failed",
                "weight": weight,
            })

        if norm is None or norm == "n-a":
            continue  # excluded from scoring
        d["answered"] += 1
        d["weighted_sum"] += _ANSWER_VALUE[norm] * weight
        d["weight_total"] += weight

    domain_scores: Dict[str, dict] = {}
    overall_residual_num = 0.0
    overall_weight = 0.0
    for domain, d in domains.items():
        posture = (d["weighted_sum"] / d["weight_total"]) if d["weight_total"] > 0 else 0.0
        residual = inherent * (1 - reduction_cap * posture)
        domain_scores[domain] = {
            "posture": round(posture, 4),
            "inherent": round(inherent, 2),
            "residual": round(residual, 2),
            "rating": score_to_tier(residual, thresholds),
            "answered": d["answered"],
            "total": d["total"],
        }
        # Weight the overall residual by each domain's total question weight.
        overall_residual_num += residual * max(d["weight_total"], 0.0001)
        overall_weight += max(d["weight_total"], 0.0001)

    if overall_weight > 0:
        overall_residual = round(overall_residual_num / overall_weight, 2)
    else:
        overall_residual = round(inherent, 2)
    # Invariant (TPRM-004): controls can only REDUCE risk — residual must never
    # exceed inherent. The formula is already capped, but clamp defensively so no
    # rounding / config / upstream path can ever produce residual > inherent.
    overall_residual = min(overall_residual, round(inherent, 2))

    # TPRM-015 — the overall residual_rating is RESIDUAL-DRIVEN: it is the tier of
    # the weighted-average residual score (score_to_tier), NOT the inherent tier.
    # The only exception is that a failed CRITICAL control floors the rating at
    # "high" (and is always blocking) regardless of the numeric score. `rating_basis`
    # makes that derivation explicit so the UI can show WHY a rating is what it is.
    residual_rating = score_to_tier(overall_residual, thresholds)
    rating_basis = "residual_score"
    if critical_failures and residual_rating in ("low", "medium"):
        residual_rating = "high"
        rating_basis = "critical_control_floor"

    return {
        "overall_inherent": round(inherent, 2),
        "overall_residual": overall_residual,
        "residual_rating": residual_rating,
        "rating_basis": rating_basis,
        "rating_grade": residual_to_grade(overall_residual, cfg.get("grade_bands")),
        "domain_scores": domain_scores,
        "critical_failures": critical_failures,
        "blocking": bool(critical_failures),
    }
