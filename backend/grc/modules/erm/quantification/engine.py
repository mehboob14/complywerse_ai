"""CRQM Monte Carlo engine — pure functions, no DB, no I/O.

FAIR decomposition: annual loss = Σ over successful events of Σ component
losses, where events ~ Poisson(TEF), success ~ Bernoulli(PoS), and every
estimate is a min / most-likely / max range sampled as Beta-PERT.

Properties the rest of the platform relies on:
  * DETERMINISTIC — same (model, iterations, seed) → bit-identical results.
    Every persisted run stores its seed + ENGINE_VERSION, so any historical
    figure can be regenerated for an auditor. Bump ENGINE_VERSION on ANY
    change to the sampling math.
  * Secondary-loss gating — each loss component carries a per-incident
    `probability` (default 1.0) applied as a Bernoulli gate per event. A
    regulatory fine that materializes in 15% of incidents must not be charged
    on 100% of them; without the gate, ALEs are systematically inflated.
  * Control effects are ranges too — sampled per iteration, multiplying event
    frequency and/or loss magnitude down. Adding a control can never increase
    simulated loss (multipliers are clamped to [0, 1]).
  * Portfolio runs sample every model INDEPENDENTLY (spawned child RNG
    streams) and sum per-iteration losses. Correct only under an independence
    assumption — callers must surface that assumption with the results.
"""

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

ENGINE_VERSION = "crqm-1.0.0"

DEFAULT_ITERATIONS = 10_000
MAX_ITERATIONS = 100_000
_LEC_POINTS = 50


def _pert(rng: np.random.Generator, lo: float, ml: float, hi: float, size: int) -> np.ndarray:
    """Beta-PERT sample of a min/most-likely/max estimate (lambda=4).

    Degenerate ranges (min == max) return the constant — exact arithmetic for
    point estimates, which the unit tests pin down.
    """
    lo, ml, hi = float(lo), float(ml), float(hi)
    if not (lo <= ml <= hi):
        raise ValueError(f"PERT range must satisfy min <= ml <= max, got ({lo}, {ml}, {hi})")
    if hi <= lo:
        return np.full(size, lo, dtype=np.float64)
    a = 1.0 + 4.0 * (ml - lo) / (hi - lo)
    b = 1.0 + 4.0 * (hi - ml) / (hi - lo)
    return lo + rng.beta(a, b, size) * (hi - lo)


def _reduction_multiplier(rng: np.random.Generator, effect: Optional[Tuple[float, float, float]],
                          size: int) -> np.ndarray:
    """Sampled (1 - reduction%) multiplier, clamped so a control can only
    reduce, never amplify."""
    if not effect:
        return np.ones(size, dtype=np.float64)
    pct = np.clip(_pert(rng, effect[0], effect[1], effect[2], size), 0.0, 100.0)
    return 1.0 - pct / 100.0


def _stats(annual: np.ndarray) -> Dict[str, Any]:
    n = annual.size
    percentiles = np.percentile(annual, [5, 50, 90, 95, 99])
    # Loss exceedance curve: for each threshold L, prob = P(annual > L),
    # computed on deduplicated thresholds — with many identical years (e.g.
    # zero-loss years) naive rank-based probs produce non-monotone points.
    asc = np.sort(annual)
    idx = np.unique(np.linspace(0, n - 1, _LEC_POINTS).astype(int))
    thresholds = np.unique(asc[idx])
    exceed = (n - np.searchsorted(asc, thresholds, side="right")) / n
    lec = [
        {"loss": round(float(loss), 2), "prob": round(float(prob), 5)}
        for loss, prob in zip(thresholds, exceed)
    ]
    return {
        "ale_mean": round(float(annual.mean()), 2),
        "ale_median": round(float(np.median(annual)), 2),
        "p5": round(float(percentiles[0]), 2),
        "p50": round(float(percentiles[1]), 2),
        "p90": round(float(percentiles[2]), 2),
        "p95": round(float(percentiles[3]), 2),
        "p99": round(float(percentiles[4]), 2),
        "lec_points": lec,
    }


def _simulate_annual_losses(
    model: Dict[str, Any],
    iterations: int,
    rng: np.random.Generator,
    control_effects: Optional[Sequence[Dict[str, Any]]] = None,
) -> Tuple[np.ndarray, Dict[str, np.ndarray]]:
    """Core loop, vectorized. Returns (annual_losses[n], per-component annual
    totals for tornado data)."""
    n = iterations
    tef = model["tef"]
    pos = model["pos"]
    components = model.get("components") or []

    lam = np.clip(_pert(rng, tef[0], tef[1], tef[2], n), 0.0, None)
    for eff in (control_effects or []):
        lam *= _reduction_multiplier(rng, eff.get("freq"), n)

    p_success = np.clip(_pert(rng, pos[0], pos[1], pos[2], n), 0.0, 1.0)
    events = rng.poisson(lam)
    successes = rng.binomial(events, p_success)

    comp_annual: Dict[str, np.ndarray] = {
        str(c.get("key") or c.get("label") or f"component_{i}"): np.zeros(n, dtype=np.float64)
        for i, c in enumerate(components)
    }
    total_events = int(successes.sum())
    if total_events == 0 or not components:
        return np.zeros(n, dtype=np.float64), comp_annual

    iter_idx = np.repeat(np.arange(n), successes)

    mag_mult_iter = np.ones(n, dtype=np.float64)
    for eff in (control_effects or []):
        mag_mult_iter *= _reduction_multiplier(rng, eff.get("mag"), n)
    mag_mult_event = mag_mult_iter[iter_idx]

    annual = np.zeros(n, dtype=np.float64)
    for i, comp in enumerate(components):
        key = str(comp.get("key") or comp.get("label") or f"component_{i}")
        prob = float(comp.get("probability", 1.0) if comp.get("probability") is not None else 1.0)
        prob = min(max(prob, 0.0), 1.0)
        gate = (rng.random(total_events) < prob) if prob < 1.0 else np.ones(total_events, dtype=bool)
        values = _pert(rng, comp["min"], comp["ml"], comp["max"], total_events)
        values = np.where(gate, values, 0.0) * mag_mult_event
        per_iter = np.bincount(iter_idx, weights=values, minlength=n)
        comp_annual[key] += per_iter
        annual += per_iter

    return annual, comp_annual


def simulate(
    model: Dict[str, Any],
    iterations: int = DEFAULT_ITERATIONS,
    seed: Optional[int] = None,
    control_effects: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Simulate one loss model.

    model: {"tef": (min, ml, max), "pos": (min, ml, max),
            "components": [{key, label, min, ml, max, probability}]}
    control_effects: [{"control_link_id", "label",
                       "freq": (min, ml, max)|None, "mag": (min, ml, max)|None}]
    """
    iterations = int(min(max(iterations, 1), MAX_ITERATIONS))
    if seed is None:
        seed = int(np.random.SeedSequence().entropy % (2**31))
    rng = np.random.default_rng(seed)

    annual, comp_annual = _simulate_annual_losses(model, iterations, rng, control_effects)

    components = model.get("components") or []
    labels = {
        str(c.get("key") or c.get("label") or f"component_{i}"): (c.get("label") or c.get("key") or f"component_{i}")
        for i, c in enumerate(components)
    }
    contributions = [
        {"key": k, "label": labels.get(k, k), "mean_contribution": round(float(v.mean()), 2)}
        for k, v in comp_annual.items()
    ]
    contributions.sort(key=lambda c: c["mean_contribution"], reverse=True)

    result = _stats(annual)
    result.update({
        "iterations": iterations,
        "seed": int(seed),
        "engine_version": ENGINE_VERSION,
        "component_contributions": contributions,
    })
    return result


def simulate_portfolio(
    models: List[Dict[str, Any]],
    iterations: int = DEFAULT_ITERATIONS,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """Joint run over many loss models: per-iteration losses are summed, so
    portfolio percentiles are computed on the summed distribution rather than
    (incorrectly) summing per-risk percentiles.

    INDEPENDENCE ASSUMPTION: each model draws from its own spawned RNG stream
    — no correlation between scenarios is modelled. This understates tail
    risk when risks are correlated; callers must persist and display that
    assumption next to the results.

    models entries additionally carry "risk_id" / "label" for attribution.
    """
    iterations = int(min(max(iterations, 1), MAX_ITERATIONS))
    if seed is None:
        seed = int(np.random.SeedSequence().entropy % (2**31))
    streams = np.random.SeedSequence(seed).spawn(len(models))

    total = np.zeros(iterations, dtype=np.float64)
    per_risk = []
    for model, ss in zip(models, streams):
        rng = np.random.default_rng(ss)
        annual, _ = _simulate_annual_losses(
            model, iterations, rng, model.get("control_effects"),
        )
        total += annual
        per_risk.append({
            "key": str(model.get("risk_id", model.get("label", "?"))),
            "label": model.get("label") or f"risk {model.get('risk_id', '?')}",
            "mean_contribution": round(float(annual.mean()), 2),
        })
    per_risk.sort(key=lambda c: c["mean_contribution"], reverse=True)

    result = _stats(total)
    result.update({
        "iterations": iterations,
        "seed": int(seed),
        "engine_version": ENGINE_VERSION,
        "component_contributions": per_risk,
        "assumptions": {
            "independence": (
                "Portfolio percentiles are computed under an independence "
                "assumption between scenarios (each sampled from its own RNG "
                "stream). Correlated risks — e.g. one campaign hitting several "
                "business units — make real tail risk HIGHER than shown."
            ),
        },
    })
    return result
