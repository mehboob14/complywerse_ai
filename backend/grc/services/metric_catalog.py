"""Catalog of trended metrics — the shared registry behind the /reports Trends view.

One entry per metric the platform snapshots into `grc_metric_snapshot`. The
catalog is the single place that names a metric, says which module owns it, how
to read it (unit + whether up or down is good), which permission gates it, and
its default RAG target — so the snapshot writer, the trends API and the UI all
agree. Default targets let a trend card show red/amber/green out of the box; a
`grc_metric_target` row overrides the default per tenant.

Reconciliation note: the *values* are computed in grc.services.metrics (risk) and
grc.services.metrics_cross (every other module) directly from each module's own
model with that module's documented formula, so a trended number equals the
number the module's own screen shows.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

# Permission strings mirror the /reports datasets exactly (datasets.ts), so Trends
# can never surface a metric for a module the user cannot already report on.
_P_RISK = ["erm:risks:*"]
_P_COMPLIANCE = ["compliance:frameworks:*"]
_P_CONTROLS = ["controls:control_library:*"]
_P_EVIDENCE = ["evidence:evidence_library:*", "evidence:evidence_upload:*"]
_P_VULN = ["vulnerabilities:vulnerability_register:*"]
_P_VENDORS = ["erm:risks:*"]          # vendors dataset is gated on erm:risks:* in datasets.ts
_P_ASSETS = ["assets:asset_inventory:*"]
_P_GOV = ["governance:policies:*"]

MODULE_ORDER = [
    "risk", "compliance", "controls", "evidence",
    "vulnerabilities", "vendors", "assets", "governance",
]
MODULE_LABELS = {
    "risk": "Risk", "compliance": "Compliance", "controls": "Controls",
    "evidence": "Evidence", "vulnerabilities": "Vulnerabilities",
    "vendors": "Vendor Risk", "assets": "IT Assets", "governance": "Governance",
}


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    module: str
    unit: str                # 'pct' | 'score' | 'count' | 'days'
    direction: str           # 'up_good' | 'down_good' | 'neutral'
    permissions: List[str]
    target: Optional[float] = None
    warn: Optional[float] = None
    critical: Optional[float] = None
    dimension: Optional[str] = None      # breakdown dimension (also snapshotted split out)
    definition: str = ""


# ── The catalog ───────────────────────────────────────────────────────────────
METRICS: List[MetricDef] = [
    # Risk (written by metric_snapshots.write_daily via services.metrics)
    MetricDef("portfolio_avg_residual", "Avg residual risk", "risk", "score", "down_good", _P_RISK,
              target=40, warn=60, definition="Mean residual risk across all open enterprise risks (ERM + third-party), 0–100."),
    MetricDef("portfolio_avg_inherent", "Avg inherent risk", "risk", "score", "neutral", _P_RISK,
              definition="Mean inherent (pre-control) risk across all open enterprise risks, 0–100."),
    MetricDef("risk_reduction_pct", "Risk reduction", "risk", "pct", "up_good", _P_RISK,
              target=40, warn=25, definition="How much controls reduce risk portfolio-wide: 1 − (avg residual / avg inherent)."),
    MetricDef("open_risks", "Open risks", "risk", "count", "neutral", _P_RISK,
              definition="Count of open enterprise risks (ERM + third-party), excluding closed."),
    MetricDef("open_critical_issues", "Open critical issues", "risk", "count", "down_good", _P_RISK,
              definition="Issues with critical severity that are not closed or cancelled."),
    MetricDef("open_exceptions", "Open exceptions", "risk", "count", "down_good", _P_RISK,
              definition="Risk/policy exceptions that are still open."),
    MetricDef("overdue_exceptions", "Overdue exceptions", "risk", "count", "down_good", _P_RISK,
              definition="Open exceptions past their expiry / review date."),

    # Compliance
    MetricDef("compliance_completion_pct", "Control completion", "compliance", "pct", "up_good", _P_COMPLIANCE,
              target=90, warn=75, dimension="framework",
              definition="Implemented/verified controls ÷ applicable controls, across certification journeys."),
    MetricDef("compliance_readiness_pct", "Audit readiness", "compliance", "pct", "up_good", _P_COMPLIANCE,
              target=85, warn=70, dimension="framework",
              definition="Controls with sufficient approved evidence ÷ applicable controls (audit-ready)."),

    # Controls
    MetricDef("control_implemented_pct", "Controls implemented", "controls", "pct", "up_good", _P_CONTROLS,
              target=90, warn=75, definition="Work items implemented or verified ÷ applicable work items."),
    MetricDef("control_effectiveness_pct", "Control effectiveness", "controls", "pct", "up_good", _P_CONTROLS,
              target=85, warn=70, definition="Controls with operating effectiveness = effective ÷ all controls."),
    MetricDef("control_test_coverage_pct", "Test coverage", "controls", "pct", "up_good", _P_CONTROLS,
              target=90, warn=75, definition="Controls with a recorded last-tested date ÷ all controls."),
    MetricDef("controls_total", "Controls tracked", "controls", "count", "neutral", _P_CONTROLS,
              definition="Total control work items in the unified library."),

    # Evidence
    MetricDef("evidence_total", "Evidence items", "evidence", "count", "neutral", _P_EVIDENCE,
              definition="Total evidence records held."),
    MetricDef("evidence_fresh_pct", "Evidence freshness", "evidence", "pct", "up_good", _P_EVIDENCE,
              target=90, warn=75, definition="Non-stale evidence ÷ all evidence (1 − stale rate)."),
    MetricDef("evidence_approved_pct", "Evidence approved", "evidence", "pct", "up_good", _P_EVIDENCE,
              target=85, warn=70, definition="Approved evidence ÷ all evidence."),
    MetricDef("evidence_expiring_soon", "Evidence expiring ≤30d", "evidence", "count", "down_good", _P_EVIDENCE,
              definition="Evidence with an expiry date within the next 30 days."),

    # Vulnerabilities
    MetricDef("vuln_open", "Open vulnerabilities", "vulnerabilities", "count", "down_good", _P_VULN,
              dimension="severity", definition="Vulnerabilities not in a resolved/closed/accepted state."),
    MetricDef("vuln_kev_open", "Open KEV vulnerabilities", "vulnerabilities", "count", "down_good", _P_VULN,
              definition="Open vulnerabilities flagged as known-exploited (CISA KEV)."),
    MetricDef("vuln_overdue", "Overdue vulnerabilities", "vulnerabilities", "count", "down_good", _P_VULN,
              definition="Open vulnerabilities past their remediation due date."),
    MetricDef("vuln_mttr_days", "Mean time to remediate", "vulnerabilities", "days", "down_good", _P_VULN,
              definition="Average days from discovery to resolution across resolved vulnerabilities."),

    # Vendors / third-party risk
    MetricDef("vendor_active", "Active vendors", "vendors", "count", "neutral", _P_VENDORS,
              definition="Vendors that are not retired or deleted."),
    MetricDef("vendor_portfolio_residual", "Vendor residual risk", "vendors", "score", "down_good", _P_VENDORS,
              target=40, warn=60, definition="Average residual risk score across active vendors, 0–100."),
    MetricDef("vendor_portfolio_inherent", "Vendor inherent risk", "vendors", "score", "neutral", _P_VENDORS,
              definition="Average inherent risk score across active vendors, 0–100."),
    MetricDef("vendor_high_risk", "High-risk vendors", "vendors", "count", "down_good", _P_VENDORS,
              definition="Active vendors with residual risk score ≥ 50."),
    MetricDef("vendor_reviews_overdue", "Vendor reviews overdue", "vendors", "count", "down_good", _P_VENDORS,
              definition="Active vendors past their next reassessment date."),

    # Assets
    MetricDef("assets_total", "IT assets", "assets", "count", "neutral", _P_ASSETS,
              definition="Total IT assets in the inventory."),
    MetricDef("assets_high_value", "High-value assets", "assets", "count", "neutral", _P_ASSETS,
              definition="Assets with high or critical business criticality."),

    # Governance
    MetricDef("gov_docs_total", "Governance documents", "governance", "count", "neutral", _P_GOV,
              definition="Total governance documents (policies, standards, procedures…)."),
    MetricDef("gov_docs_approved_pct", "Documents approved", "governance", "pct", "up_good", _P_GOV,
              target=90, warn=75, definition="Approved/published documents ÷ all documents."),
    MetricDef("gov_reviews_overdue", "Document reviews overdue", "governance", "count", "down_good", _P_GOV,
              definition="Approved/published documents past their next review date."),
]

BY_KEY: Dict[str, MetricDef] = {m.key: m for m in METRICS}


def get(key: str) -> Optional[MetricDef]:
    return BY_KEY.get(key)


def rag_status(value: Optional[float], direction: str,
               target: Optional[float], warn: Optional[float] = None) -> str:
    """RAG bucket for a value against its target. 'none' when not gradable
    (no target, a neutral metric, or a missing value)."""
    if value is None or target is None or direction not in ("up_good", "down_good"):
        return "none"
    v = float(value)
    t = float(target)
    w = float(warn) if warn is not None else t
    if direction == "up_good":
        if v >= t:
            return "ok"
        return "warn" if v >= w else "critical"
    # down_good
    if v <= t:
        return "ok"
    return "warn" if v <= w else "critical"
