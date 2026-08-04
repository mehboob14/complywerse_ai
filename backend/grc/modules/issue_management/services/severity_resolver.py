"""Severity resolver.

Maps (impact, urgency) → (severity, sla_ack_hours, sla_resolve_hours) using
the per-tenant `IssueSeverityMatrix` table, with a hard-coded default 3×3
matrix as fallback so the feature works on a brand-new tenant before any
admin has configured the matrix.

The default matrix follows the standard ITIL/COBIT impact × urgency
priority model:

         |  H impact | M impact | L impact
  -------+-----------+----------+----------
  H urgY |  Critical |   High   |  Medium
  M urgY |    High   |  Medium  |   Low
  L urgY |   Medium  |   Low    |   Info
"""
from __future__ import annotations

from typing import Optional, Tuple, Dict
from sqlalchemy.orm import Session

from ....models import IssueSeverityMatrix


# (impact, urgency) → (severity, ack_hours, resolve_hours)
DEFAULT_SEVERITY_MATRIX: Dict[Tuple[str, str], Tuple[str, int, int]] = {
    ("high",   "high"):   ("critical",      1,   24),
    ("high",   "medium"): ("high",          4,   72),
    ("high",   "low"):    ("medium",       24,  168),
    ("medium", "high"):   ("high",          4,   72),
    ("medium", "medium"): ("medium",       24,  168),
    ("medium", "low"):    ("low",          72,  504),
    ("low",    "high"):   ("medium",       24,  168),
    ("low",    "medium"): ("low",          72,  504),
    ("low",    "low"):    ("informational",168, 1440),
}


def resolve_severity(
    *,
    impact: Optional[str],
    urgency: Optional[str],
    tenant_id: int,
    db: Session,
) -> Tuple[str, int, int]:
    """Return (severity, ack_hours, resolve_hours).

    Missing or unrecognised inputs default to medium so the feature never
    blocks on bad data.
    """
    i = (impact or "medium").strip().lower()
    u = (urgency or "medium").strip().lower()
    if i not in {"high", "medium", "low"}:
        i = "medium"
    if u not in {"high", "medium", "low"}:
        u = "medium"

    row = db.query(IssueSeverityMatrix).filter(
        IssueSeverityMatrix.tenant_id == tenant_id,
        IssueSeverityMatrix.impact == i,
        IssueSeverityMatrix.urgency == u,
    ).first()
    if row:
        return (row.computed_severity, row.sla_ack_hours, row.sla_resolve_hours)

    return DEFAULT_SEVERITY_MATRIX.get((i, u), ("medium", 24, 168))
