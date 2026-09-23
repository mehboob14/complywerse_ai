"""Risk analysis & scoring engine (stage 05).

Pure functions. Maps questionnaire answers to a per-domain control posture and
computes residual risk from the inherent score:

    residual = inherent × (1 − reduction_cap × control_effectiveness)

where control_effectiveness is the control posture (0..1) and reduction is capped
(default 70%). A failed CRITICAL control (answer "No") forces a blocking critical
finding regardless of the headline score.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

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


_LABEL = {"yes": "Yes", "partial": "Partial", "no": "No", "n-a": "N-A"}


def _unwrap(ans):
    """An answer stored as {"value": "yes", ...} or {"answer": ...} is unwrapped."""
    if isinstance(ans, dict):
        return ans.get("value") or ans.get("answer") or ans.get("response")
    return ans


def _option(question: dict, ans) -> Optional[dict]:
    text = str(ans).strip().lower()
    for option in question.get("options") or []:
        if isinstance(option, dict) and str(option.get("value", "")).strip().lower() == text:
            return option
    return None


def answer_score(question: dict, ans) -> Tuple[Optional[str], Optional[float]]:
    """(label, score) for one answer. The score is 0..1, or None when the answer
    does not count: unanswered, not applicable, or free text.

    A question frozen into a template version carries its options with their
    scores; anything else falls back to the Yes / Partial / No scale."""
    ans = _unwrap(ans)
    if ans is None or str(ans).strip() == "":
        return None, None
    option = _option(question, ans)
    if option is not None:
        label = str(option.get("label") or option.get("value"))
        if option.get("na") or option.get("score") is None:
            return label, None
        return label, max(0.0, min(1.0, float(option["score"])))
    norm = normalize_answer(ans)
    if norm is None:
        return None, None
    return _LABEL[norm], (None if norm == "n-a" else _ANSWER_VALUE[norm])


def default_severity(question: dict, score: Optional[float]) -> Optional[str]:
    """The finding a weak answer raises when its question sets none: a failing
    answer by importance, a half-way one lower, anything better none at all."""
    if score is None or score > 0.5:
        return None
    critical = bool(question.get("critical_control"))
    if score <= 0:
        return "critical" if critical else ("high" if float(question.get("weight") or 1.0) >= 1.5 else "medium")
    return "medium" if critical else "low"


def finding_severity(question: dict, ans) -> Optional[str]:
    """Severity of the finding this answer raises, or None. A version freezes the
    rule on each option; an older question gets the defaults."""
    ans = _unwrap(ans)
    if ans is None or str(ans).strip() == "":
        return None
    option = _option(question, ans)
    if option is not None and ("finding" in option or option.get("na")):
        return option.get("finding")
    return default_severity(question, answer_score(question, ans)[1])


def build_responses_from_answers(question_defs: List[dict], answers: Optional[dict],
                                 template_version_id: Optional[int] = None) -> List[dict]:
    """Map a questionnaire template's question defs + a ``{question_id: answer}``
    answer blob into the response dicts :func:`score_assessment` consumes.

    Pure (no DB). This is the bridge that lets the governed scoring engine run on
    the answers the vendor portal actually submits (stored as a JSON blob keyed by
    question id) rather than on the normalized response table. Answer values may be
    plain strings ("yes"/"no"/"partial") — ``normalize_answer`` coerces them, so a
    string answer is scored correctly instead of silently counting as zero.
    """
    answers = answers or {}
    out: List[dict] = []
    for i, q in enumerate(question_defs or []):
        qid = q.get("id", i)
        # Answer keys are the question id; tolerate both str and native-typed keys.
        ans = answers.get(str(qid))
        if ans is None:
            ans = answers.get(qid)
        ans = _unwrap(ans)
        label, score = answer_score(q, ans)
        out.append({
            "domain": q.get("domain") or "cybersecurity",
            "answer": ans,
            "label": label,
            "score": score,
            "finding": finding_severity(q, ans),
            "weight": float(q.get("weight", 1.0) or 1.0),
            "critical_control": bool(q.get("critical_control")),
            "question_key": qid,
            "question_id": qid,
            "title": q.get("text"),
            "template_version_id": template_version_id,
        })
    return out


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
        if "score" in r:
            value = r["score"]
        else:
            norm = normalize_answer(r.get("answer"))
            value = None if norm in (None, "n-a") else _ANSWER_VALUE[norm]
        weight = float(r.get("weight", 1.0) or 1.0)
        is_critical = bool(r.get("critical_control"))

        d = domains.setdefault(domain, {"weighted_sum": 0.0, "weight_total": 0.0, "answered": 0, "total": 0})
        d["total"] += 1

        # A failed critical control is a blocking finding regardless of score.
        if is_critical and value is not None and value <= 0:
            critical_failures.append({
                "domain": domain,
                "question_key": r.get("question_key"),
                "question_id": r.get("question_id"),
                "title": r.get("title") or "Critical control failed",
                "weight": weight,
            })

        if value is None:
            continue  # unanswered, not applicable or free text: excluded from scoring
        d["answered"] += 1
        d["weighted_sum"] += value * weight
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
