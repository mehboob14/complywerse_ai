"""Effective Risk formula — phase 4 of the Risk Posture upgrade.

Pure math, deterministic, no DB access. Takes typed inputs, returns a
score plus an English explanation. Lets us unit-test the math in
isolation before wiring it into the DB-bound _vuln_score() path.

The formula and weights live in docs/RISK_POSTURE_PLAN.md §2:

    effective_risk
      = w1 × CVSS_severity   (0..1 normalised)
      + w2 × EPSS_probability (0..1 from FIRST.org)
      + w3 × KEV_active_flag  (0 or 1, from CISA)
      + w4 × asset_CIA_value  (0..1 normalised from /5)
      + w5 × (business_impact_factor − 1.0)   (factor is 1..1.5)

    Default weights: w1=0.35, w2=0.25, w3=0.15, w4=0.10, w5=0.15
    (sum to 1.0; configurable per tenant later)

    Escalation rule:
       IF (EPSS ≥ 0.7  OR  KEV = true)
          AND (asset.CIA ≥ high  OR  business_impact ≥ high)
       THEN floor at 0.85 — force critical band

The output is in [0..1]. Multiply by 10 for display as X.Y / 10 (matches
the CVSS scale the operator already understands).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ─── Multiplier tables (per the plan §3) ────────────────────────────────

_REGULATED_DATA_MULTIPLIER = {
    "none": 1.0,
    # All four regulated-data categories get the same 1.4× per the Risk
    # Posture v2 spec (plan §3 — "regulated_data ∈ {PII, PCI, PHI,
    # Financial} ? 1.4 : 1.0"). PII was previously 1.3 — a transcription
    # error from an earlier draft that under-weighted PII exposure
    # relative to PCI/PHI/Financial. Now aligned with the canonical spec.
    "pii": 1.4,
    "pci": 1.4,
    "phi": 1.4,
    "financial": 1.4,
    "multiple": 1.4,  # multiple categories → take the worst-case multiplier
}

_OPERATIONAL_DEPENDENCY_MULTIPLIER = {
    "low": 0.8,
    "medium": 1.0,
    "high": 1.3,
    "critical": 1.5,
}

# Default weight vector. Each tenant could override later via a Tenant
# Risk Weights table — same pattern used by the existing CIS/CIA/Risk
# weights. For now we ship one-size-fits-all defaults.
DEFAULT_WEIGHTS = {"w1": 0.30, "w2": 0.25, "w3": 0.20, "w4": 0.10, "w5": 0.15}


@dataclass
class RiskInputs:
    """Single vuln-on-asset evaluation. All inputs are typed; the caller
    is responsible for marshaling DB rows into this shape."""

    # Vulnerability signals
    cvss_score: Optional[float] = None         # 0..10 from scanner / NVD
    epss_score: Optional[float] = None         # 0..1 from FIRST.org
    kev_flag: bool = False                     # CISA KEV listed?

    # Asset signals
    asset_cia_max: Optional[int] = None        # MAX(C, I, A) ratings, 1..5
    is_customer_facing: bool = False
    is_internet_facing: bool = False
    regulated_data_type: str = "none"
    op_dep_business_impact: str = "medium"


@dataclass
class RiskOutput:
    """Computed effective risk + the English explanation."""

    score: float                               # 0..1
    band: str                                  # 'critical' | 'high' | 'moderate' | 'low' | 'minimal'
    reason: str                                # operator-readable breakdown
    contributions: dict = field(default_factory=dict)
    escalated: bool = False
    business_impact_factor: float = 1.0


def _classify_band(score: float) -> str:
    """4-band classification per spec §1:
       low < 0.40 · medium 0.40–0.69 · high 0.70–0.84 · critical ≥ 0.85"""
    if score >= 0.85:
        return "critical"
    if score >= 0.70:
        return "high"
    if score >= 0.40:
        return "medium"
    return "low"


def business_impact_factor(inputs: RiskInputs) -> float:
    """The MAX( ... ) per the plan §2 — return the worst-case multiplier
    in [0.8 .. 1.5]. Exposed standalone so the UI Live Preview can show
    just the multiplier without computing a full score."""
    candidates = [1.0]
    if inputs.is_customer_facing:
        candidates.append(1.2)
    if inputs.is_internet_facing:
        candidates.append(1.3)
    candidates.append(_REGULATED_DATA_MULTIPLIER.get(
        (inputs.regulated_data_type or "none").lower(), 1.0))
    candidates.append(_OPERATIONAL_DEPENDENCY_MULTIPLIER.get(
        (inputs.op_dep_business_impact or "medium").lower(), 1.0))
    return max(candidates)


def compute_effective_risk(
    inputs: RiskInputs,
    weights: Optional[dict] = None,
) -> RiskOutput:
    """Apply the formula. Returns the score + a structured breakdown
    suitable for both DB persistence and UI display.

    The function never raises on malformed inputs — it treats None /
    missing values as zero contribution and notes that in the reason.
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}

    # ── Normalise inputs to [0..1] for each dimension ────────────────
    cvss_norm = max(0.0, min(1.0, (inputs.cvss_score or 0.0) / 10.0))
    epss_norm = max(0.0, min(1.0, inputs.epss_score or 0.0))
    kev_val = 1.0 if inputs.kev_flag else 0.0
    cia_norm = max(0.0, min(1.0, (inputs.asset_cia_max or 0) / 5.0))

    biz_factor = business_impact_factor(inputs)
    biz_contribution_raw = biz_factor - 1.0   # neutral at 1.0 → 0

    contributions = {
        "cvss":  round(w["w1"] * cvss_norm, 4),
        "epss":  round(w["w2"] * epss_norm, 4),
        "kev":   round(w["w3"] * kev_val, 4),
        "cia":   round(w["w4"] * cia_norm, 4),
        "biz":   round(w["w5"] * biz_contribution_raw, 4),
    }
    base_score = sum(contributions.values())
    # Sum can theoretically go slightly above 1.0 because biz adds
    # multiplier deltas. Clamp to [0..1].
    base_score = max(0.0, min(1.0, base_score))

    # ── Escalation rule ───────────────────────────────────────────────
    escalated = False
    asset_is_high = (inputs.asset_cia_max or 0) >= 4   # 4/5 = high
    biz_is_high = biz_factor >= 1.3                     # internet-facing or PCI etc.
    likelihood_high = (epss_norm >= 0.7) or inputs.kev_flag
    if likelihood_high and (asset_is_high or biz_is_high):
        if base_score < 0.85:
            base_score = 0.85
            escalated = True

    band = _classify_band(base_score)

    # ── English breakdown for audit trail ─────────────────────────────
    lines = []
    if inputs.cvss_score is not None:
        lines.append(f"CVSS {inputs.cvss_score:.1f}/10 × w1({w['w1']}) = {contributions['cvss']:.3f}")
    if inputs.epss_score is not None:
        lines.append(f"EPSS {inputs.epss_score*100:.1f}% × w2({w['w2']}) = {contributions['epss']:.3f}")
    lines.append(f"KEV {'yes' if inputs.kev_flag else 'no'} × w3({w['w3']}) = {contributions['kev']:.3f}")
    if inputs.asset_cia_max is not None:
        lines.append(f"Asset CIA {inputs.asset_cia_max}/5 × w4({w['w4']}) = {contributions['cia']:.3f}")
    lines.append(
        f"Business impact {biz_factor:.2f}× "
        f"(customer_facing={inputs.is_customer_facing}, "
        f"internet_facing={inputs.is_internet_facing}, "
        f"data={inputs.regulated_data_type}, "
        f"op_dep={inputs.op_dep_business_impact}) "
        f"→ (factor−1) × w5({w['w5']}) = {contributions['biz']:.3f}"
    )
    if escalated:
        lines.append("ESCALATED to 0.85 floor (likelihood high AND asset/biz high)")
    reason = " | ".join(lines)

    return RiskOutput(
        score=round(base_score, 4),
        band=band,
        reason=reason,
        contributions=contributions,
        escalated=escalated,
        business_impact_factor=round(biz_factor, 3),
    )
