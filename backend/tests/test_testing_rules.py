"""Control-testing judgement calls: sample size, selection, conclusion, designation.

Each rule here decides something an auditor will re-perform or challenge, so
the tests pin the cases where a plausible implementation quietly overstates
assurance: a sample larger than its population, a random draw that cannot be
reproduced, untested items treated as passes, a self-reviewed test claiming the
control is satisfactory.

DB-free.
"""
import pytest

from grc.modules.automation.testing_rules import (
    AUTOMATED, SAMPLE_SIZES, control_designation, count_exceptions, population_items,
    nist_53a, nist_procedures_for_control, recommended_sample_size, scaffold_procedures, select_sample,
    suggested_result,
)


# ── sample size ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("freq,key,expected", [
    ("annual", False, 1), ("annual", True, 1),
    ("quarterly", False, 2), ("monthly", False, 2), ("monthly", True, 5),
    ("weekly", False, 5), ("weekly", True, 15),
    ("daily", False, 20), ("daily", True, 40),
    ("multiple_daily", True, 60), (AUTOMATED, True, 1),
])
def test_sample_size_follows_frequency_and_key_control(freq, key, expected):
    n, why = recommended_sample_size(freq, key)
    assert n == expected
    assert why


def test_a_small_population_is_tested_in_full():
    """Sampling 40 from a population of 12 is not a sample."""
    n, why = recommended_sample_size("daily", True, population_size=12)
    assert n == 12 and "every item" in why


def test_unknown_frequency_gives_no_number():
    n, why = recommended_sample_size(None, False)
    assert n is None and "how often" in why


def test_every_frequency_band_is_ordered():
    for freq, (lo, hi) in SAMPLE_SIZES.items():
        assert 1 <= lo <= hi, freq


# ── selection ───────────────────────────────────────────────────────────────
POP = [f"CHG-{i}" for i in range(1, 101)]


def test_random_selection_is_reproducible_from_its_seed():
    assert select_sample(POP, 25, "random", seed=7) == select_sample(POP, 25, "random", seed=7)
    assert select_sample(POP, 25, "random", seed=7) != select_sample(POP, 25, "random", seed=8)


def test_selection_never_repeats_or_exceeds_the_population():
    picks = select_sample(POP[:10], 25, "random", seed=1)
    assert len(picks) == 10 and len(set(picks)) == 10


def test_systematic_selection_spreads_across_the_population():
    picks = select_sample(POP, 10, "systematic", seed=3)
    idx = [POP.index(p) for p in picks]
    assert len(picks) == 10 and idx == sorted(idx)
    assert idx[-1] - idx[0] >= 80  # not bunched at the front


def test_all_and_judgmental():
    assert select_sample(POP[:5], 2, "all") == POP[:5]
    assert select_sample(POP, 3, "judgmental") == [None, None, None]


def test_population_falls_back_to_numbered_slots():
    assert population_items(None, 3) == ["Item 1", "Item 2", "Item 3"]
    assert population_items([" a ", "", "b"], 99) == ["a", "b"]


# ── conclusion ──────────────────────────────────────────────────────────────
def test_untested_items_block_a_conclusion():
    assert suggested_result(["pass", None, "pass"]) is None


def test_zero_tolerance_means_one_exception_is_ineffective():
    assert suggested_result(["pass", "pass"]) == "effective"
    assert suggested_result(["pass", "exception"]) == "ineffective"


def test_exceptions_within_tolerance_are_partially_effective():
    assert suggested_result(["pass", "exception", "pass"], tolerable_exceptions=1) == "partially_effective"
    assert suggested_result(["exception", "exception"], tolerable_exceptions=1) == "ineffective"


def test_not_applicable_items_are_out_of_the_count():
    assert suggested_result(["not_applicable", "pass"]) == "effective"
    assert suggested_result(["not_applicable"]) is None
    assert count_exceptions(["pass", "exception", "not_applicable", None]) == (2, 1)


# ── designation ─────────────────────────────────────────────────────────────
def test_satisfactory_needs_both_tests_effective_and_independent_review():
    assert control_designation("effective", "effective", independent=True) == "satisfactory"
    assert control_designation("effective", "effective", independent=False) == "not_assessed"


def test_a_failure_is_recorded_whoever_reviewed_it():
    assert control_designation("effective", "ineffective", independent=False) == "deficient"
    assert control_designation("ineffective", None, independent=True) == "deficient"


def test_design_alone_is_not_satisfactory():
    assert control_designation("effective", None, independent=True) == "partial"
    assert control_designation("partially_effective", "effective", independent=True) == "partial"
    assert control_designation(None, None, independent=True) == "not_assessed"


# ── procedure scaffold ──────────────────────────────────────────────────────
OBJ = [
    {"ao_id": "IAC-06_A01", "objective": "Multi-factor authentication is implemented for privileged accounts.", "pptdf": "Technology"},
    {"ao_id": "IAC-06_A02", "objective": "Personnel understand when MFA is required.", "pptdf": "People"},
    {"ao_id": "IAC-06_A03", "objective": "", "pptdf": "Process"},
]


def test_one_procedure_per_objective_quoting_it_verbatim():
    got = scaffold_procedures(OBJ)
    assert [p["ao_ids"] for p in got] == [["IAC-06_A01"], ["IAC-06_A02"]]
    assert OBJ[0]["objective"] in got[0]["description"]
    assert got[0]["procedure_type"] == "inspection" and got[1]["procedure_type"] == "inquiry"


def test_scaffold_skips_objectives_already_covered():
    assert [p["ao_ids"] for p in scaffold_procedures(OBJ, existing_ao_ids=["IAC-06_A01"])] == [["IAC-06_A02"]]


# ── NIST SP 800-53A procedures behind SCF objectives ────────────────────────
NIST = {
    "controls": {
        "IA-02(01)": {"title": "MFA to Privileged Accounts", "methods": {"EXAMINE": ["system security plan"], "TEST": ["MFA mechanisms"]}},
        "SA-08": {"title": "Security Engineering Principles", "methods": {"INTERVIEW": ["system developers"]}},
    },
    "objectives": {"IA-02(01)": {"control": "IA-02(01)", "text": "MFA is implemented for privileged accounts."}},
    "by_ao": {
        "IAC-06_A01": [{"ref": "IA-02(01)", "control": "IA-02(01)", "match": "objective"}],
        "IAC-06_A02": [{"ref": "SA-08_ODP[01]", "control": "SA-08", "match": "odp"},
                       {"ref": "XX-99", "control": "XX-99", "match": "control"}],
        "IAC-06.1_A01": [{"ref": "SA-08_ODP[02]", "control": "SA-08", "match": "odp"}],
    },
}


def test_nist_procedures_are_keyed_by_this_controls_objectives_only():
    got = nist_procedures_for_control("IAC-06", NIST)
    assert sorted(got) == ["IAC-06_A01", "IAC-06_A02"]  # not the IAC-06.1 enhancement
    assert got["IAC-06_A01"][0]["objective"] == "MFA is implemented for privileged accounts."
    assert got["IAC-06_A01"][0]["methods"]["TEST"] == ["MFA mechanisms"]
    # A parameter has no objective statement; a control missing from the seed is dropped.
    assert [(e["ref"], e["objective"]) for e in got["IAC-06_A02"]] == [("SA-08_ODP[01]", None)]
    assert nist_procedures_for_control("NOPE-01", NIST) == {}


def test_parameters_render_the_way_nist_writes_them():
    from grc.tools.build_nist_53a import _param_labels, _render
    catalog = {"groups": [{"controls": [{"params": [
        {"id": "p-select", "select": {"how-many": "one-or-more", "choice": ["organization-level", "lock for {{ insert: param, p-plain }}"]}},
        {"id": "p-org", "label": "organization-defined personnel or roles"},
        {"id": "p-plain", "label": "time period"},
    ]}]}]}
    params = _param_labels(catalog)
    text = _render("the {{ insert: param, p-select }} policy is reviewed by {{ insert: param, p-org }} "
                   "every {{ insert: param, p-plain }};", params)
    assert text == ("the [Selection (one or more): organization-level; lock for [organization-defined time period]] "
                    "policy is reviewed by [organization-defined personnel or roles] every [organization-defined time period];")


def test_shipped_nist_seed_matches_the_scf_release():
    import json
    from pathlib import Path
    data = nist_53a()
    assert data, "seed_data/nist/sp800_53a.json is missing: run grc.tools.build_nist_53a"
    assert data["stats"]["resolved"] == data["stats"]["scf_refs"]
    scf = json.loads((Path(__file__).resolve().parents[1] / "grc" / "seed_data" / "scf" / "objectives.json").read_text(encoding="utf-8"))
    ao_ids = {o["ao_id"] for o in (scf if isinstance(scf, list) else scf["objectives"])}
    assert set(data["by_ao"]) <= ao_ids, "the seed cites objectives this SCF release no longer has: rebuild it"
    for entries in data["by_ao"].values():
        for e in entries:
            assert data["controls"][e["control"]]["methods"]
    texts = [o["text"] for o in data["objectives"].values()]
    texts += [t for c in data["controls"].values() for objs in c["methods"].values() for t in objs]
    assert not [t for t in texts if "{{" in t or "[organization-defined value]" in t or "organization-defined organization-defined" in t]
