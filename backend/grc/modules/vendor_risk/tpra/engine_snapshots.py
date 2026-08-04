"""Risk snapshot engine — time-series of inherent/residual risk.

Writes append-only `TPRARiskSnapshot` rows at vendor and portfolio scope so the
dashboard trend chart and per-vendor trajectory are backed by REAL history.
Called on every score/re-score, when a finding closes, and by a daily scheduled
job (see grc.tasks). Pure persistence — no scoring logic lives here.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ....models import (
    Vendor, VendorAssessment, TPRAFinding, TPRARiskSnapshot,
)

# Finding statuses that count as still-open for portfolio metrics.
_OPEN_STATUSES = ("open", "in_progress", "in_remediation")


def _finding_counts(db: Session, tenant_id: int, vendor_id: Optional[int] = None) -> tuple:
    """(open_findings, critical_open_findings) for a vendor or the whole tenant."""
    q = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id == tenant_id,
        TPRAFinding.deleted_at.is_(None),
        TPRAFinding.status.in_(_OPEN_STATUSES),
    )
    if vendor_id is not None:
        q = q.filter(TPRAFinding.vendor_id == vendor_id)
    rows = q.all()
    return len(rows), sum(1 for f in rows if (f.severity or "").lower() == "critical")


def write_vendor_snapshot(
    db: Session,
    vendor: Vendor,
    assessment: Optional[VendorAssessment] = None,
    source: str = "score",
    commit: bool = False,
) -> TPRARiskSnapshot:
    """Capture the vendor's current inherent/residual posture as a snapshot."""
    inherent = (assessment.inherent_score if assessment else None) or vendor.inherent_risk_score
    residual = (assessment.residual_score if assessment else None) or vendor.residual_risk_score
    grade = getattr(assessment, "rating_grade", None) if assessment else None
    rating = (assessment.residual_rating if assessment else None) or vendor.risk_rating
    domain_scores = getattr(assessment, "domain_scores", None) if assessment else None
    open_f, crit_f = _finding_counts(db, vendor.tenant_id, vendor.id)

    snap = TPRARiskSnapshot(
        tenant_id=vendor.tenant_id, scope="vendor", vendor_id=vendor.id,
        assessment_id=(assessment.id if assessment else None),
        inherent_score=inherent, residual_score=residual,
        rating_grade=grade, residual_rating=rating,
        open_findings=open_f, critical_findings=crit_f,
        domain_scores=domain_scores or {}, source=source,
    )
    db.add(snap)
    if commit:
        db.commit()
        db.refresh(snap)
    return snap


def write_portfolio_snapshot(
    db: Session, tenant_id: int, source: str = "schedule", commit: bool = False,
) -> TPRARiskSnapshot:
    """Aggregate the tenant's active vendors into a portfolio-level snapshot."""
    vendors = db.query(Vendor).filter(
        Vendor.tenant_id == tenant_id,
        Vendor.status != "retired",
    ).all()
    inherents = [v.inherent_risk_score for v in vendors if v.inherent_risk_score is not None]
    residuals = [v.residual_risk_score for v in vendors if v.residual_risk_score is not None]
    avg_inh = round(sum(inherents) / len(inherents), 2) if inherents else None
    avg_res = round(sum(residuals) / len(residuals), 2) if residuals else None
    open_f, crit_f = _finding_counts(db, tenant_id, None)

    snap = TPRARiskSnapshot(
        tenant_id=tenant_id, scope="portfolio", vendor_id=None,
        inherent_score=avg_inh, residual_score=avg_res,
        open_findings=open_f, critical_findings=crit_f,
        vendor_count=len(vendors), source=source,
    )
    db.add(snap)
    if commit:
        db.commit()
        db.refresh(snap)
    return snap
