"""Unit tests for the TPRA engines: tiering, scoring, and gate evaluation.

Covers boundary tiers (the threshold cut-offs) and the rule that a failed
critical control forces a blocking finding regardless of the headline score.
These engines are pure, so no DB fixtures are required.
"""
import pytest

from grc.modules.vendor_risk.tpra.engine_tiering import (
    compute_inherent_tier, score_to_tier, derive_factors_from_profile, FACTOR_KEYS,
)
from grc.modules.vendor_risk.tpra.engine_scoring import (
    score_assessment, normalize_answer, REDUCTION_CAP,
    residual_to_grade, build_responses_from_answers,
)
from grc.modules.vendor_risk.tpra.engine_gates import (
    evaluate_stage_exit, recommend_decision,
    REC_APPROVE, REC_APPROVE_CONDITIONS, REC_REMEDIATE, REC_ESCALATE,
)
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG


# ── Tiering ──────────────────────────────────────────────────────────────────

def test_tiering_weights_sum_to_one():
    assert round(sum(DEFAULT_TIERING_CONFIG["weights"].values()), 6) == 1.0


def test_tiering_all_max_is_critical():
    factors = {k: 4 for k in FACTOR_KEYS}
    res = compute_inherent_tier(factors)
    assert res["score"] == 100.0
    assert res["tier"] == "critical"


def test_tiering_all_zero_is_low():
    res = compute_inherent_tier({k: 0 for k in FACTOR_KEYS})
    assert res["score"] == 0.0
    assert res["tier"] == "low"


@pytest.mark.parametrize("score,expected", [
    (75.0, "critical"),   # exactly at the critical cut-off
    (74.99, "high"),
    (50.0, "high"),       # exactly at the high cut-off
    (49.99, "medium"),
    (25.0, "medium"),     # exactly at the medium cut-off
    (24.99, "low"),
    (0.0, "low"),
    (100.0, "critical"),
])
def test_score_to_tier_boundaries(score, expected):
    assert score_to_tier(score, DEFAULT_TIERING_CONFIG["thresholds"]) == expected


def test_tiering_clamps_out_of_range_factors():
    # Factors above 4 are clamped, so the score never exceeds 100.
    res = compute_inherent_tier({k: 99 for k in FACTOR_KEYS})
    assert res["score"] <= 100.0
    assert res["tier"] == "critical"


def test_tiering_config_override_changes_bucket():
    # With a stricter critical threshold, a mid score stays "high".
    cfg = {
        "weights": DEFAULT_TIERING_CONFIG["weights"],
        "thresholds": {"critical": 90, "high": 60, "medium": 30},
    }
    res = compute_inherent_tier({k: 3 for k in FACTOR_KEYS}, config=cfg)  # 75.0
    assert res["score"] == 75.0
    assert res["tier"] == "high"  # below the raised critical=90 cut-off


def test_derive_factors_from_profile_regulated_data():
    factors = derive_factors_from_profile({
        "data_access_level": "restricted",
        "data_types_accessed": ["PII", "financial"],
        "business_criticality": "high",
        "system_access": True,
        "regulatory_scope": ["GDPR", "PCI"],
        "geographic_locations": ["US", "EU"],
        "fourth_party": True,
    })
    assert set(factors.keys()) == set(FACTOR_KEYS)
    assert factors["data_sensitivity"] == 4.0
    # A high-sensitivity, system-accessing, regulated vendor should tier high/critical.
    tier = compute_inherent_tier(factors)["tier"]
    assert tier in ("high", "critical")


# ── Scoring ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("Yes", "yes"), ("y", "yes"), ("Partial", "partial"), ("No", "no"),
    ("N/A", "n-a"), ("not applicable", "n-a"), ("", None), (None, None),
])
def test_normalize_answer(raw, expected):
    assert normalize_answer(raw) == expected


def test_scoring_full_compliance_reduces_residual_by_cap():
    # All "Yes" → posture 1.0 → residual = inherent × (1 − cap).
    responses = [
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0, "critical_control": False},
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0, "critical_control": False},
    ]
    res = score_assessment(responses, inherent_score=80.0)
    expected_residual = round(80.0 * (1 - REDUCTION_CAP * 1.0), 2)
    assert res["overall_residual"] == expected_residual
    assert res["blocking"] is False
    assert res["critical_failures"] == []


def test_scoring_no_controls_keeps_residual_at_inherent():
    responses = [
        {"domain": "cybersecurity", "answer": "No", "weight": 1.0, "critical_control": False},
    ]
    res = score_assessment(responses, inherent_score=60.0)
    assert res["overall_residual"] == 60.0  # posture 0 → no reduction


def test_scoring_na_is_excluded():
    responses = [
        {"domain": "operational", "answer": "N/A", "weight": 5.0, "critical_control": False},
        {"domain": "operational", "answer": "Yes", "weight": 1.0, "critical_control": False},
    ]
    res = score_assessment(responses, inherent_score=50.0)
    # Only the answered "Yes" counts → posture 1.0 in that domain.
    assert res["domain_scores"]["operational"]["posture"] == 1.0
    assert res["domain_scores"]["operational"]["answered"] == 1
    assert res["domain_scores"]["operational"]["total"] == 2


def test_failed_critical_control_forces_blocking_finding():
    # Even with otherwise strong posture, a failed critical control blocks.
    responses = [
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0, "critical_control": False},
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0, "critical_control": False},
        {"domain": "cybersecurity", "answer": "No", "weight": 2.0, "critical_control": True,
         "question_key": "mfa", "title": "MFA not enforced"},
    ]
    res = score_assessment(responses, inherent_score=40.0)
    assert res["blocking"] is True
    assert len(res["critical_failures"]) == 1
    assert res["critical_failures"][0]["question_key"] == "mfa"
    # A low/medium residual is floored to at least "high" when a critical fails.
    assert res["residual_rating"] in ("high", "critical")


def test_critical_control_partial_is_not_a_failure():
    responses = [
        {"domain": "cybersecurity", "answer": "Partial", "weight": 1.0, "critical_control": True},
    ]
    res = score_assessment(responses, inherent_score=40.0)
    assert res["blocking"] is False
    assert res["critical_failures"] == []


def test_scoring_per_domain_breakdown():
    responses = [
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0},
        {"domain": "data_privacy", "answer": "No", "weight": 1.0},
    ]
    res = score_assessment(responses, inherent_score=100.0)
    assert res["domain_scores"]["cybersecurity"]["residual"] == round(100 * (1 - REDUCTION_CAP), 2)
    assert res["domain_scores"]["data_privacy"]["residual"] == 100.0


# ── Gate evaluation ──────────────────────────────────────────────────────────

def test_tiering_gate_blocks_without_tier():
    r = evaluate_stage_exit("tiering", {})
    assert r["is_gate"] is True
    assert r["passed"] is False
    assert any("tier" in b.lower() for b in r["blockers"])


def test_tiering_gate_passes_with_tier():
    r = evaluate_stage_exit("tiering", {"inherent_tier": "high"})
    assert r["passed"] is True
    assert r["blockers"] == []


def test_approval_gate_blocks_on_open_critical():
    r = evaluate_stage_exit("approval", {
        "approval_decision": "approve",
        "open_critical_unmitigated": 2,
    })
    assert r["is_gate"] is True
    assert r["passed"] is False
    assert any("critical" in b.lower() for b in r["blockers"])


def test_approval_gate_blocks_without_decision():
    r = evaluate_stage_exit("approval", {"open_critical_unmitigated": 0})
    assert r["passed"] is False


def test_approval_gate_passes_when_clean():
    r = evaluate_stage_exit("approval", {
        "approval_decision": "approve_with_conditions",
        "open_critical_unmitigated": 0,
    })
    assert r["passed"] is True


def test_questionnaire_exit_reports_unanswered():
    r = evaluate_stage_exit("questionnaire", {"responses_total": 10, "responses_answered": 7})
    assert r["passed"] is False
    assert any("unanswered" in b.lower() for b in r["blockers"])


def test_findings_exit_blocks_unmitigated_critical():
    r = evaluate_stage_exit("findings", {"open_critical_unmitigated": 1})
    assert r["passed"] is False


def test_contracting_exit_requires_contract_for_high_tier():
    assert evaluate_stage_exit("contracting", {"tier": "high", "contract_linked": False})["passed"] is False
    assert evaluate_stage_exit("contracting", {"tier": "high", "contract_linked": True})["passed"] is True
    # Low tier doesn't require a linked contract.
    assert evaluate_stage_exit("contracting", {"tier": "low", "contract_linked": False})["passed"] is True


def test_monitoring_and_reassessment_have_no_hard_exit():
    assert evaluate_stage_exit("monitoring", {})["passed"] is True
    assert evaluate_stage_exit("reassessment", {})["passed"] is True


# ── Decision recommendation ──────────────────────────────────────────────────

@pytest.mark.parametrize("rating,open_crit,expected", [
    ("low", 0, REC_APPROVE),
    ("medium", 0, REC_APPROVE),
    ("high", 0, REC_APPROVE_CONDITIONS),
    ("critical", 0, REC_ESCALATE),
    ("low", 1, REC_REMEDIATE),       # open critical overrides the rating
    ("critical", 3, REC_REMEDIATE),
])
def test_recommend_decision(rating, open_crit, expected):
    assert recommend_decision(rating, open_crit) == expected


# ── A–F rating grade (TPRM revamp) ───────────────────────────────────────────

@pytest.mark.parametrize("residual,grade", [
    (0, "A"), (13.99, "A"),
    (14, "B"), (27.99, "B"),
    (28, "C"), (43.99, "C"),
    (44, "D"), (59.99, "D"),
    (60, "E"), (75.99, "E"),
    (76, "F"), (100, "F"),
])
def test_residual_to_grade_boundaries(residual, grade):
    assert residual_to_grade(residual) == grade


def test_score_assessment_emits_grade():
    responses = [
        {"domain": "cybersecurity", "answer": "Yes", "weight": 1.0, "critical_control": False},
        {"domain": "data_privacy", "answer": "Partial", "weight": 1.0, "critical_control": False},
    ]
    out = score_assessment(responses, inherent_score=80.0)
    assert out["rating_grade"] in ("A", "B", "C", "D", "F")
    # Lower residual than inherent (controls removed risk) → grade reflects residual band.
    assert out["rating_grade"] == residual_to_grade(out["overall_residual"])


# ── Portal-blob → engine bridge (TPRM-CRITICAL scoring fix) ──────────────────

# A minimal template shaped like VendorQuestionnaireTemplate.questions.
_SAMPLE_QS = [
    {"id": "cyber_mfa", "text": "MFA enforced?", "domain": "cybersecurity", "weight": 2.0, "critical_control": True},
    {"id": "cyber_patch", "text": "Patching SLA met?", "domain": "cybersecurity", "weight": 1.0, "critical_control": False},
    {"id": "priv_dpa", "text": "DPA in place?", "domain": "data_privacy", "weight": 1.0, "critical_control": False},
]


def test_build_responses_maps_blob_to_engine_rows():
    rows = build_responses_from_answers(
        _SAMPLE_QS, {"cyber_mfa": "no", "cyber_patch": "yes", "priv_dpa": "partial"})
    assert len(rows) == 3
    by_id = {r["question_id"]: r for r in rows}
    assert by_id["cyber_mfa"]["answer"] == "no"
    assert by_id["cyber_mfa"]["critical_control"] is True
    assert by_id["cyber_mfa"]["domain"] == "cybersecurity"
    assert by_id["cyber_mfa"]["weight"] == 2.0


def test_build_responses_tolerates_dict_and_missing_answers():
    rows = build_responses_from_answers(_SAMPLE_QS, {"cyber_mfa": {"value": "yes"}})
    by_id = {r["question_id"]: r for r in rows}
    assert by_id["cyber_mfa"]["answer"] == "yes"       # unwrapped from a dict-shaped answer
    assert by_id["cyber_patch"]["answer"] is None       # missing → None (engine excludes it)


def test_string_answers_are_scored_not_zeroed():
    # Regression for the legacy bug: string answers used to score 0 → false "low".
    # All-"yes" (good posture) must REDUCE residual below inherent, not sit at 0/inherent.
    rows = build_responses_from_answers(
        _SAMPLE_QS, {"cyber_mfa": "yes", "cyber_patch": "yes", "priv_dpa": "yes"})
    good = score_assessment(rows, inherent_score=80.0)
    assert good["overall_residual"] < 80.0             # controls reduced risk
    assert good["overall_residual"] > 0.0              # not the false-zero bug


def test_all_no_critical_questionnaire_is_not_scored_low():
    # THE headline bug: a vendor answering "no" to every critical control must not
    # come out "low". The critical-control floor forces at least "high".
    rows = build_responses_from_answers(
        _SAMPLE_QS, {"cyber_mfa": "no", "cyber_patch": "no", "priv_dpa": "no"})
    res = score_assessment(rows, inherent_score=50.0)
    assert res["blocking"] is True
    assert res["residual_rating"] in ("high", "critical")
    assert res["residual_rating"] != "low"
