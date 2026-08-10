"""CRQM Monte Carlo engine — statistical + contract tests.

These pin down the properties the audit story depends on: reproducibility,
exact arithmetic on degenerate ranges, the secondary-loss Bernoulli gate,
control-effect monotonicity, and portfolio-vs-sum consistency.
"""

import numpy as np
import pytest

from grc.modules.erm.quantification.engine import (
    ENGINE_VERSION,
    simulate,
    simulate_portfolio,
)


def _model(tef=(0.5, 1.0, 2.0), pos=(0.3, 0.5, 0.8), components=None):
    if components is None:
        components = [
            {"key": "response", "label": "Incident response", "min": 50_000, "ml": 150_000, "max": 400_000, "probability": 1.0},
            {"key": "fine", "label": "Regulatory fine", "min": 1_000_000, "ml": 5_000_000, "max": 20_000_000, "probability": 0.15},
        ]
    return {"tef": tef, "pos": pos, "components": components}


def test_reproducible_same_seed():
    a = simulate(_model(), iterations=5_000, seed=42)
    b = simulate(_model(), iterations=5_000, seed=42)
    assert a == b


def test_different_seed_differs():
    a = simulate(_model(), iterations=5_000, seed=42)
    b = simulate(_model(), iterations=5_000, seed=43)
    assert a["ale_mean"] != b["ale_mean"]


def test_engine_version_stamped():
    r = simulate(_model(), iterations=100, seed=1)
    assert r["engine_version"] == ENGINE_VERSION
    assert r["seed"] == 1
    assert r["iterations"] == 100


def test_degenerate_ranges_exact_arithmetic():
    # Point estimates everywhere: 2 events/yr, 100% success, one component of
    # exactly 1000 charged always -> every simulated year loses events*1000,
    # and the mean number of Poisson(2) events over many years is ~2.
    m = {
        "tef": (2.0, 2.0, 2.0),
        "pos": (1.0, 1.0, 1.0),
        "components": [{"key": "c", "label": "c", "min": 1000, "ml": 1000, "max": 1000, "probability": 1.0}],
    }
    r = simulate(m, iterations=50_000, seed=7)
    assert r["ale_mean"] == pytest.approx(2_000, rel=0.05)


def test_zero_frequency_means_zero_loss():
    m = _model(tef=(0.0, 0.0, 0.0))
    r = simulate(m, iterations=2_000, seed=5)
    assert r["ale_mean"] == 0.0
    assert r["p99"] == 0.0


def test_secondary_probability_gates_loss():
    """A component with probability 0.1 must contribute ~10% of what the same
    component contributes at probability 1.0 — the anti-inflation property."""
    base = {"key": "fine", "label": "fine", "min": 1000, "ml": 1000, "max": 1000}
    m_always = _model(pos=(1.0, 1.0, 1.0), components=[dict(base, probability=1.0)])
    m_rare = _model(pos=(1.0, 1.0, 1.0), components=[dict(base, probability=0.1)])
    r_always = simulate(m_always, iterations=50_000, seed=11)
    r_rare = simulate(m_rare, iterations=50_000, seed=11)
    assert r_rare["ale_mean"] == pytest.approx(r_always["ale_mean"] * 0.1, rel=0.08)


def test_control_effect_monotone():
    """Adding a control never increases expected loss; a stronger control
    reduces it further."""
    m = _model()
    baseline = simulate(m, iterations=20_000, seed=21)
    weak = simulate(m, iterations=20_000, seed=21,
                    control_effects=[{"freq": (10, 20, 30), "mag": None}])
    strong = simulate(m, iterations=20_000, seed=21,
                      control_effects=[{"freq": (60, 75, 90), "mag": (30, 50, 70)}])
    assert weak["ale_mean"] <= baseline["ale_mean"]
    assert strong["ale_mean"] < weak["ale_mean"]


def test_full_reduction_zeroes_loss():
    m = _model()
    r = simulate(m, iterations=5_000, seed=3,
                 control_effects=[{"freq": (100, 100, 100), "mag": None}])
    assert r["ale_mean"] == 0.0


def test_lec_curve_shape():
    r = simulate(_model(), iterations=10_000, seed=9)
    losses = [p["loss"] for p in r["lec_points"]]
    probs = [p["prob"] for p in r["lec_points"]]
    assert losses == sorted(losses)
    assert probs == sorted(probs, reverse=True)
    assert all(0.0 <= p <= 1.0 for p in probs)


def test_component_contributions_sum_to_ale():
    r = simulate(_model(), iterations=20_000, seed=13)
    total = sum(c["mean_contribution"] for c in r["component_contributions"])
    assert total == pytest.approx(r["ale_mean"], rel=0.01)


def test_invalid_range_raises():
    m = _model(tef=(5.0, 2.0, 1.0))
    with pytest.raises(ValueError):
        simulate(m, iterations=100, seed=1)


def test_portfolio_sums_means_and_stamps_assumption():
    m1 = dict(_model(), risk_id=1, label="Ransomware")
    m2 = dict(_model(tef=(0.1, 0.3, 0.6)), risk_id=2, label="Insider")
    p = simulate_portfolio([m1, m2], iterations=20_000, seed=99)
    r1 = simulate(m1, iterations=20_000, seed=99)
    r2 = simulate(m2, iterations=20_000, seed=99)
    # Means are additive regardless of correlation; percentiles are not —
    # the joint mean must line up with the sum of individual means.
    assert p["ale_mean"] == pytest.approx(r1["ale_mean"] + r2["ale_mean"], rel=0.1)
    assert "independence" in p["assumptions"]
    assert len(p["component_contributions"]) == 2


def test_portfolio_reproducible():
    ms = [dict(_model(), risk_id=1), dict(_model(), risk_id=2)]
    a = simulate_portfolio(ms, iterations=5_000, seed=77)
    b = simulate_portfolio(ms, iterations=5_000, seed=77)
    assert a == b
