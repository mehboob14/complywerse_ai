"""Ready-made KPI/KRI definitions — the "create from a dropdown" library for the
manual metric-management module. Each entry is a DEFINITION only (name, formula,
unit, target, RAG thresholds, direction, cadence, kind); a user picks one, it
prefills the create form, and they own + measure it themselves.

Grouped by domain so the picker can present them as an optgroup dropdown.
"""
from __future__ import annotations

from typing import Dict, List


def _t(key, name, kind, category, unit, direction, target, green, amber, frequency, formula):
    return {
        "key": key, "name": name, "kind": kind, "category": category, "unit": unit,
        "threshold_direction": direction, "target": target,
        "green_threshold": green, "amber_threshold": amber,
        "frequency": frequency, "formula": formula, "description": formula,
    }


# kind: 'kpi' = performance (are we doing well); 'kri' = risk exposure (early warning)
TEMPLATES: List[Dict] = [
    # ── Cyber Security ──
    _t("patch_sla", "% Patches applied within SLA", "kpi", "Cyber Security", "%", "higher_is_better", 95, 95, 85, "monthly", "Patches applied within SLA ÷ total patches due"),
    _t("vuln_remediation_sla", "% Critical/High vulns remediated within SLA", "kpi", "Cyber Security", "%", "higher_is_better", 90, 90, 75, "monthly", "Vulns remediated within SLA ÷ total critical/high vulns"),
    _t("phishing_fail_rate", "Phishing simulation failure rate", "kri", "Cyber Security", "%", "lower_is_better", 5, 5, 15, "quarterly", "Users who clicked ÷ users tested"),
    _t("mttr_incidents", "Mean time to resolve security incidents", "kpi", "Cyber Security", "days", "lower_is_better", 5, 5, 10, "monthly", "Average of (resolved_at − reported_at)"),
    # ── Identity & Access ──
    _t("mfa_coverage", "% Privileged accounts with MFA", "kpi", "Identity & Access", "%", "higher_is_better", 100, 100, 95, "quarterly", "MFA-enabled privileged accounts ÷ all privileged accounts"),
    _t("access_review_completion", "% Access reviews completed on time", "kpi", "Identity & Access", "%", "higher_is_better", 100, 100, 90, "quarterly", "Reviews completed by due date ÷ reviews due"),
    _t("dormant_accounts", "Dormant privileged accounts", "kri", "Identity & Access", "count", "lower_is_better", 0, 0, 5, "monthly", "Privileged accounts inactive > 90 days"),
    # ── Compliance ──
    _t("policy_review_currency", "% Policies reviewed within cycle", "kpi", "Compliance", "%", "higher_is_better", 95, 95, 85, "quarterly", "Policies with in-date review ÷ total policies"),
    _t("control_effectiveness", "% Controls operating effectively", "kpi", "Compliance", "%", "higher_is_better", 90, 90, 75, "quarterly", "Effective controls ÷ tested controls"),
    _t("audit_findings_open", "Open audit findings past due", "kri", "Compliance", "count", "lower_is_better", 0, 0, 3, "monthly", "Audit findings past their remediation date"),
    _t("regulatory_obs_open", "Open regulatory observations", "kri", "Compliance", "count", "lower_is_better", 0, 0, 2, "monthly", "Open observations raised by regulators"),
    _t("evidence_freshness", "% Evidence current (not stale)", "kpi", "Compliance", "%", "higher_is_better", 90, 90, 75, "monthly", "Non-stale evidence ÷ total evidence"),
    # ── Risk ──
    _t("high_residual_risks", "High/critical residual risks", "kri", "Risk", "count", "lower_is_better", 0, 2, 5, "monthly", "Open risks with residual rating high or critical"),
    _t("overdue_treatments", "Overdue risk treatment actions", "kri", "Risk", "count", "lower_is_better", 0, 0, 5, "monthly", "Mitigation actions past their due date"),
    _t("risk_appetite_breaches", "Risks breaching appetite", "kri", "Risk", "count", "lower_is_better", 0, 0, 3, "monthly", "Risks with residual score above the appetite threshold"),
    _t("risk_acceptance_expiry", "Risk acceptances expiring ≤30d", "kri", "Risk", "count", "lower_is_better", 0, 2, 5, "monthly", "Accepted risks with a review date within 30 days"),
    # ── Third-Party Risk ──
    _t("vendor_assessments_overdue", "Vendor reassessments overdue", "kri", "Third-Party Risk", "count", "lower_is_better", 0, 0, 3, "monthly", "Active vendors past their reassessment date"),
    _t("critical_vendor_coverage", "% Critical vendors assessed", "kpi", "Third-Party Risk", "%", "higher_is_better", 100, 100, 90, "quarterly", "Critical vendors assessed ÷ total critical vendors"),
    # ── Operations / Resilience ──
    _t("system_availability", "Core system availability", "kpi", "Operations", "%", "higher_is_better", 99.9, 99.9, 99.5, "monthly", "Uptime ÷ total time"),
    _t("backup_success", "% Successful backups", "kpi", "Operations", "%", "higher_is_better", 99, 99, 95, "weekly", "Successful backups ÷ scheduled backups"),
    _t("dr_test_currency", "Days since last DR test", "kri", "Business Continuity", "days", "lower_is_better", 180, 180, 270, "quarterly", "Today − date of last DR test"),
    # ── Governance ──
    _t("committee_actions_overdue", "Overdue committee actions", "kri", "Governance", "count", "lower_is_better", 0, 0, 3, "monthly", "Committee oversight actions past their due date"),
    _t("training_completion", "% Staff completed security training", "kpi", "Governance", "%", "higher_is_better", 95, 95, 85, "quarterly", "Staff completed ÷ staff assigned"),
]

BY_KEY: Dict[str, Dict] = {t["key"]: t for t in TEMPLATES}


def templates() -> List[Dict]:
    return TEMPLATES


def get(key: str):
    return BY_KEY.get(key)
