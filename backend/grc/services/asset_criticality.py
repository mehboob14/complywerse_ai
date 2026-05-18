"""ISO 27005-style derived asset criticality.

Computes a 0.0–10.0 numeric `criticality_score` AND a four-tier text
bucket (`low | medium | high | critical`) from objective asset
attributes the user fills in:

  * confidentiality, integrity, availability ratings (1–5 each)
  * data_classification
  * internet_facing
  * business_function

The textual bucket is what the user sees and what downstream paths (UI
chips, reports, applicability gating) read. The numeric score is the
audit-traceable basis for the bucket and feeds the composite-priority
formula in `enrichment/priority.py`.

Approach (ISO 27005 §A.4 + practitioner heuristics):

  1. **Base** — start from the **maximum** of the three CIA ratings,
     scaled to 0–10 (so a max rating of 5 → 10, 4 → 8, 3 → 6, 2 → 4,
     1 → 2). The "highest harm wins" rule matches ISO 27005 and is the
     reason an asset with one Confidentiality-5 rating ends up at the
     top of the register regardless of its other ratings.

  2. **Exposure adjustment** — add up to +2.5 for internet-facing.
     Internet-reachable assets demonstrably get exploited at a higher
     rate; the bump prevents an isolated dev box and a public API from
     ever sharing a criticality bucket purely on CIA.

  3. **Sensitivity adjustment** — add up to +1.5 when
     data_classification is `confidential` or `restricted`.

  4. **Function adjustment** — add up to +1.5 when business_function
     is on the high-impact list (payment, IAM, compliance, KMS, etc.).

  5. Clamp to [0, 10]. Map the score to a bucket via fixed thresholds:
        score >= 8.5 → critical
        score >= 6.5 → high
        score >= 4.0 → medium
        else         → low

  When the user provides no CIA ratings (e.g. minimal manual entry or
  legacy bulk import), the score falls back to a defensible "medium"
  (5.0) so nothing slips through the cracks at "low" by default. The
  exposure / sensitivity / function adjustments still apply.

Manual override: callers can pass `manual_override_bucket` to override
the derived TEXT bucket without changing the numeric score (audit lets
you see "system said high, user chose critical"). The override never
touches `criticality_score`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# ─── Tunable constants (pure data) ───────────────────────────────────

# Each CIA rating 1–5 maps to a 0–10 base.
_CIA_RATING_TO_BASE = {1: 2.0, 2: 4.0, 3: 6.0, 4: 8.0, 5: 10.0}

# Adjustments.
_INTERNET_FACING_BOOST = 2.5
_RESTRICTED_BOOST = 1.5      # data_classification = "restricted"
_CONFIDENTIAL_BOOST = 1.0    # data_classification = "confidential"

# Curated high-impact business function categories (see BUSINESS_FUNCTION_CATEGORIES
# below for the structured catalogue surfaced to the UI). Each entry's
# `category_id` here is matched exactly (case-insensitive) against the
# `business_function` column. Free-text values still match the legacy
# keyword path below for backwards compat with pre-catalogue rows.
_HIGH_IMPACT_CATEGORY_IDS = {
    "authentication_iam",
    "payment_processing",
    "core_banking",
    "trading_settlement",
    "regulated_data_pii",
    "regulated_data_phi",
    "regulated_data_pci",
    "key_management",
    "audit_compliance",
    "security_operations",
    "financial_reporting",
}
_HIGH_IMPACT_KEYWORDS = (
    # Legacy free-text fallback. Matches substrings.
    "payment", "billing", "treasury", "trading", "clearing", "settlement",
    "auth", "identity", "iam", "kms", "secret", "vault", "phi", "pii",
    "compliance", "audit", "ledger", "pci",
)
_FUNCTION_BOOST = 1.5

# Bucket thresholds — score >= threshold → bucket.
_BUCKET_THRESHOLDS = [
    (8.5, "critical"),
    (6.5, "high"),
    (4.0, "medium"),
]
_DEFAULT_BUCKET = "low"
_VALID_BUCKETS = {"low", "medium", "high", "critical"}


# ─── Structured business-function catalogue (surfaced to UI) ────────
# Each entry is `(category_id, display_label, group)`. The frontend
# renders the catalogue grouped; the backend stores `category_id` in
# `ITAsset.business_function`. Legacy free-text values keep working via
# the keyword fallback above.

@dataclass(frozen=True)
class BusinessFunctionCategory:
    id: str
    label: str
    group: str
    high_impact: bool = False


BUSINESS_FUNCTION_CATEGORIES = (
    # ── Identity & access ───────────────────────────────────────────
    BusinessFunctionCategory("authentication_iam", "Authentication / IAM", "Identity & Access", high_impact=True),
    BusinessFunctionCategory("key_management",     "Key Management / Crypto", "Identity & Access", high_impact=True),
    BusinessFunctionCategory("privileged_access",  "Privileged Access Management", "Identity & Access", high_impact=True),
    # ── Financial / business-critical ───────────────────────────────
    BusinessFunctionCategory("payment_processing", "Payment Processing", "Financial Operations", high_impact=True),
    BusinessFunctionCategory("core_banking",       "Core Banking", "Financial Operations", high_impact=True),
    BusinessFunctionCategory("trading_settlement", "Trading / Settlement / Clearing", "Financial Operations", high_impact=True),
    BusinessFunctionCategory("financial_reporting","Financial Reporting / Ledger", "Financial Operations", high_impact=True),
    # ── Regulated data stores ───────────────────────────────────────
    BusinessFunctionCategory("regulated_data_pii", "Stores Personal Data (PII)", "Regulated Data", high_impact=True),
    BusinessFunctionCategory("regulated_data_phi", "Stores Health Data (PHI)", "Regulated Data", high_impact=True),
    BusinessFunctionCategory("regulated_data_pci", "Stores Cardholder Data (PCI)", "Regulated Data", high_impact=True),
    BusinessFunctionCategory("customer_data",      "Customer / Account Data", "Regulated Data", high_impact=True),
    # ── Security operations ─────────────────────────────────────────
    BusinessFunctionCategory("security_operations","SIEM / SOC / EDR", "Security Operations", high_impact=True),
    BusinessFunctionCategory("audit_compliance",   "Audit / Compliance Tooling", "Security Operations", high_impact=True),
    BusinessFunctionCategory("vulnerability_mgmt", "Vulnerability Management", "Security Operations"),
    # ── Customer-facing ─────────────────────────────────────────────
    BusinessFunctionCategory("customer_facing_app","Customer-Facing Application", "Customer-Facing"),
    BusinessFunctionCategory("public_website",     "Public Website / Marketing", "Customer-Facing"),
    BusinessFunctionCategory("partner_api",        "Partner / B2B API", "Customer-Facing"),
    # ── Internal / supporting ───────────────────────────────────────
    BusinessFunctionCategory("internal_tools",     "Internal Tooling / Productivity", "Internal Operations"),
    BusinessFunctionCategory("hr_payroll",         "HR / Payroll", "Internal Operations"),
    BusinessFunctionCategory("communications",     "Email / Messaging / Collaboration", "Internal Operations"),
    # ── Infrastructure ──────────────────────────────────────────────
    BusinessFunctionCategory("infrastructure",     "Core Infrastructure (DNS / Network)", "Infrastructure"),
    BusinessFunctionCategory("backup_recovery",    "Backup / Disaster Recovery", "Infrastructure"),
    BusinessFunctionCategory("monitoring_logging", "Monitoring / Logging", "Infrastructure"),
    BusinessFunctionCategory("dev_cicd",           "Development / CI-CD", "Infrastructure"),
    # ── Other ───────────────────────────────────────────────────────
    BusinessFunctionCategory("third_party",        "Third-Party Integration", "Other"),
    BusinessFunctionCategory("other",              "Other", "Other"),
)


def list_business_function_categories():
    """Return the catalogue serialised for the API. Frontend renders the
    `group` field as a section header in the dropdown."""
    return [
        {
            "id": c.id,
            "label": c.label,
            "group": c.group,
            "high_impact": c.high_impact,
        }
        for c in BUSINESS_FUNCTION_CATEGORIES
    ]


# ─── Score → bucket ─────────────────────────────────────────────────

def score_to_bucket(score: float) -> str:
    for threshold, bucket in _BUCKET_THRESHOLDS:
        if score >= threshold:
            return bucket
    return _DEFAULT_BUCKET


# ─── Pure compute ───────────────────────────────────────────────────

def _coerce_rating(value) -> Optional[int]:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    if v < 1 or v > 5:
        return None
    return v


def _is_high_impact_function(value: Optional[str]) -> bool:
    if not value:
        return False
    v = value.strip().lower()
    if not v:
        return False
    if v in _HIGH_IMPACT_CATEGORY_IDS:
        return True
    # Legacy free-text fallback.
    return any(keyword in v for keyword in _HIGH_IMPACT_KEYWORDS)


def compute_criticality_score(
    *,
    confidentiality_rating: Optional[int] = None,
    integrity_rating: Optional[int] = None,
    availability_rating: Optional[int] = None,
    data_classification: Optional[str] = None,
    internet_facing: Optional[bool] = None,
    business_function: Optional[str] = None,
) -> float:
    """Compute the 0–10 criticality score from objective inputs.

    Always returns a finite float in [0, 10]. Used as the audit-traceable
    basis for the textual bucket via `score_to_bucket()`.
    """
    c = _coerce_rating(confidentiality_rating)
    i = _coerce_rating(integrity_rating)
    a = _coerce_rating(availability_rating)
    cia_ratings = [r for r in (c, i, a) if r is not None]
    if cia_ratings:
        base = _CIA_RATING_TO_BASE[max(cia_ratings)]
    else:
        # No CIA inputs — fall back to medium so missing data never
        # silently classifies an asset as `low`.
        base = 5.0

    boost = 0.0
    if internet_facing:
        boost += _INTERNET_FACING_BOOST
    dc = (data_classification or "").strip().lower()
    if dc == "restricted":
        boost += _RESTRICTED_BOOST
    elif dc == "confidential":
        boost += _CONFIDENTIAL_BOOST
    if _is_high_impact_function(business_function):
        boost += _FUNCTION_BOOST

    score = base + boost
    return round(max(0.0, min(10.0, score)), 2)


def derive_bucket(
    *,
    confidentiality_rating: Optional[int] = None,
    integrity_rating: Optional[int] = None,
    availability_rating: Optional[int] = None,
    data_classification: Optional[str] = None,
    internet_facing: Optional[bool] = None,
    business_function: Optional[str] = None,
) -> str:
    """Convenience: compute the score then map to a bucket. Used by
    callers that only care about the text classification."""
    score = compute_criticality_score(
        confidentiality_rating=confidentiality_rating,
        integrity_rating=integrity_rating,
        availability_rating=availability_rating,
        data_classification=data_classification,
        internet_facing=internet_facing,
        business_function=business_function,
    )
    return score_to_bucket(score)


# ─── Apply to an ITAsset row ────────────────────────────────────────

def recompute_for_asset(asset) -> float:
    """Read inputs off an ITAsset row, recompute score AND bucket, store.

    Always sets `asset.criticality_score`. Sets `asset.criticality` to
    the derived bucket UNLESS the row carries
    `criticality_manual_override=True` (in which case the user-supplied
    bucket is preserved; the override reason should already be stored
    in `criticality_override_reason`).
    """
    score = compute_criticality_score(
        confidentiality_rating=getattr(asset, "confidentiality_rating", None),
        integrity_rating=getattr(asset, "integrity_rating", None),
        availability_rating=getattr(asset, "availability_rating", None),
        data_classification=getattr(asset, "data_classification", None),
        internet_facing=getattr(asset, "internet_facing", None),
        business_function=getattr(asset, "business_function", None),
    )
    asset.criticality_score = score
    if not getattr(asset, "criticality_manual_override", False):
        asset.criticality = score_to_bucket(score)
    return score


def is_valid_bucket(value: Optional[str]) -> bool:
    """Used by the override-validation path in the create/update endpoint."""
    return (value or "").lower().strip() in _VALID_BUCKETS
