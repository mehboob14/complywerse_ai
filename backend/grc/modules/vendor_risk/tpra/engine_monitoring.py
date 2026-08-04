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
# Severities that warrant a reassessment for any signal type.
TRIGGER_SEVERITIES = {"high", "critical"}


def should_trigger_reassessment(signal_type: str, severity: str) -> bool:
    """A breach always triggers; otherwise a high/critical signal triggers."""
    st = (signal_type or "").lower()
    sev = (severity or "").lower()
    if st in ALWAYS_TRIGGER_TYPES:
        return True
    return sev in TRIGGER_SEVERITIES


def next_review_in_days(tier: str, cadence_override: Optional[dict] = None) -> int:
    """Days until the next scheduled reassessment for a tier (config-aware)."""
    return cadence_days_for(tier, cadence_override)
