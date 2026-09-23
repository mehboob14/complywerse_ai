"""Continuous-monitoring trigger engine (stages 10–11).

Pure logic deciding when a monitoring signal should spawn a reassessment, and
how many days until the next scheduled review for a tier. The API layer applies
the actual dates and creates the reassessment assessment version.
"""
from __future__ import annotations

from typing import Optional

from .stages import cadence_days_for

# Signal types that always warrant a reassessment regardless of severity.
ALWAYS_TRIGGER_TYPES = {"breach"}
_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def should_trigger_reassessment(signal_type: str, severity: str, threshold: str = "high") -> bool:
    """A breach always triggers; otherwise a signal at or above the threshold
    does. The threshold follows the vendor's tier (tier_policy.reassess_on):
    a critical vendor is reopened by less than a low one."""
    st = (signal_type or "").lower()
    if st in ALWAYS_TRIGGER_TYPES:
        return True
    rank = _SEVERITY_RANK.get((severity or "").lower())
    return rank is not None and rank >= _SEVERITY_RANK.get((threshold or "high").lower(), 2)


def next_review_in_days(tier: str, cadence_override: Optional[dict] = None) -> int:
    """Days until the next scheduled reassessment for a tier (config-aware)."""
    return cadence_days_for(tier, cadence_override)
