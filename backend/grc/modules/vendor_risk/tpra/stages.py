"""Pure, data-driven helpers over the canonical 11-stage TPRA lifecycle.

No DB or framework imports — safe to use anywhere (engines, API, seed, tests).
The stage list itself lives on the model module so the schema and the logic
never drift; this module only adds lookups and tier-based right-sizing rules.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from ....models._41_tpra_lifecycle_models import TPRA_STAGES, TPRA_RISK_DOMAINS

# ── Stage lookups ────────────────────────────────────────────────────────────
STAGE_KEYS: List[str] = [s["key"] for s in TPRA_STAGES]
STAGE_BY_KEY: Dict[str, dict] = {s["key"]: s for s in TPRA_STAGES}
STAGE_ORDER: Dict[str, int] = {s["key"]: s["order"] for s in TPRA_STAGES}
GATE_KEYS: List[str] = [s["key"] for s in TPRA_STAGES if s.get("gate")]

# ── Risk domains ─────────────────────────────────────────────────────────────
DOMAIN_KEYS: List[str] = [d["key"] for d in TPRA_RISK_DOMAINS]
DOMAIN_LABEL: Dict[str, str] = {d["key"]: d["label"] for d in TPRA_RISK_DOMAINS}

# ── Tier ordering (depth/severity ranking) ───────────────────────────────────
TIERS = ["low", "medium", "high", "critical"]
TIER_RANK: Dict[str, int] = {t: i for i, t in enumerate(TIERS)}

# Right-sizing: which stages a tier is permitted to SKIP. Heavier diligence may
# be skipped for low-risk vendors; gate stages can never be skipped.
TIER_SKIPPABLE_STAGES: Dict[str, List[str]] = {
    "low": ["dd_planning", "questionnaire", "scoring", "findings"],
    "medium": ["dd_planning"],
    "high": [],
    "critical": [],
}

# Default reassessment cadence (days) by tier — overridable via TPRATieringConfig.
DEFAULT_CADENCE_DAYS: Dict[str, int] = {
    "critical": 180,
    "high": 365,
    "medium": 730,
    "low": 1095,
}

# Minimum reviewer disciplines required by tier (informs stage 03 planning).
TIER_REQUIRED_REVIEWERS: Dict[str, List[str]] = {
    "critical": ["security", "privacy", "legal"],
    "high": ["security", "privacy"],
    "medium": ["security"],
    "low": [],
}


def is_valid_stage(key: str) -> bool:
    return key in STAGE_BY_KEY


def is_gate(key: str) -> bool:
    return bool(STAGE_BY_KEY.get(key, {}).get("gate"))


def stage_label(key: str) -> str:
    return STAGE_BY_KEY.get(key, {}).get("label", key)


def next_stage(key: str) -> Optional[str]:
    order = STAGE_ORDER.get(key)
    if order is None or order >= len(STAGE_KEYS):
        return None
    return STAGE_KEYS[order]  # order is 1-based, list is 0-based → next == index `order`


def prev_stage(key: str) -> Optional[str]:
    order = STAGE_ORDER.get(key)
    if not order or order <= 1:
        return None
    return STAGE_KEYS[order - 2]


def stages_at_or_after(key: str) -> List[str]:
    """Stage keys from `key` onward — used to invalidate downstream state on send-back."""
    order = STAGE_ORDER.get(key)
    if order is None:
        return []
    return [s for s in STAGE_KEYS if STAGE_ORDER[s] >= order]


def can_skip(tier: str, stage_key: str) -> bool:
    """A stage may be skipped only when the tier rules allow AND it is not a gate."""
    if is_gate(stage_key):
        return False
    return stage_key in TIER_SKIPPABLE_STAGES.get((tier or "medium").lower(), [])


def cadence_days_for(tier: str, override: Optional[dict] = None) -> int:
    table = {**DEFAULT_CADENCE_DAYS, **(override or {})}
    return int(table.get((tier or "medium").lower(), DEFAULT_CADENCE_DAYS["medium"]))


# Per-severity remediation SLA (days) — how long a finding of each severity may
# stay open before its remediation is overdue. Config-overridable, like cadence.
DEFAULT_REMEDIATION_SLA_DAYS: Dict[str, int] = {
    "critical": 7, "high": 30, "medium": 90, "low": 180,
}


def remediation_sla_days_for(severity: str, override: Optional[dict] = None) -> int:
    table = {**DEFAULT_REMEDIATION_SLA_DAYS, **(override or {})}
    return int(table.get((severity or "medium").lower(), DEFAULT_REMEDIATION_SLA_DAYS["medium"]))


def required_reviewers_for(tier: str) -> List[str]:
    return TIER_REQUIRED_REVIEWERS.get((tier or "medium").lower(), [])


# ── Rich stage content catalog ───────────────────────────────────────────────
# The human-facing definition of each stage — objective, inputs, key activities,
# the RACI split, the artifacts produced, the exit criteria, and the risk domains
# most in play. This is the single source of truth the API serves to the UI so the
# lifecycle screens never drift from the engine. Domain keys match TPRA_RISK_DOMAINS;
# exit-criteria text mirrors the live blockers in engine_gates.evaluate_stage_exit.
STAGE_CONTENT: Dict[str, dict] = {
    "intake": {
        "objective": "Capture the business need and the basic facts about the proposed third party and the service before any work is committed.",
        "inputs": ["Business sponsor request", "Service description & spend estimate", "Data types and systems the vendor will touch"],
        "activities": ["Register the vendor and assign a business owner", "Define exactly what data and systems are in scope", "Check for an existing or duplicate relationship", "Draft an initial data classification"],
        "raci": {"R": ["Business owner"], "A": ["TPRM lead"], "C": ["Procurement"], "I": ["Security"]},
        "artifacts": ["Intake form", "Vendor record (VND-ID)"],
        "exit_criteria": "A vendor record exists with a named owner, a defined service scope, and a draft data classification.",
        "domains": ["cybersecurity", "data_privacy", "compliance", "legal"],
    },
    "tiering": {
        "objective": "Score risk before any controls are considered, to set how deep the assessment goes and how often it repeats.",
        "inputs": ["Data sensitivity", "Business criticality", "Access level", "Regulatory & geographic scope", "Fourth-party reliance"],
        "activities": ["Run the inherent-risk questionnaire", "Compute the tier — Critical, High, Medium or Low", "Set assessment depth and monitoring cadence to match"],
        "raci": {"R": ["TPRM analyst"], "A": ["TPRM lead"], "C": ["Business owner"], "I": ["Security", "Privacy"]},
        "artifacts": ["Inherent risk score", "Tier rating"],
        "exit_criteria": "An approved inherent tier that drives a right-sized assessment path — a Low vendor exits to a light review; Critical triggers full diligence.",
        "domains": ["cybersecurity", "data_privacy", "operational", "financial", "compliance", "geographic", "fourth_party"],
    },
    "dd_planning": {
        "objective": "Choose the right questionnaires, evidence requests, and reviewers for the assigned tier.",
        "inputs": ["Inherent tier", "Service type — cloud, on-prem, processor", "Data scope"],
        "activities": ["Select the questionnaire template(s)", "Request evidence — SOC 2, ISO 27001, pen test, DPA", "Assign domain reviewers and set a timeline"],
        "raci": {"R": ["TPRM analyst"], "A": ["TPRM lead"], "C": ["Security", "Privacy", "Legal"], "I": ["Business owner"]},
        "artifacts": ["Assessment plan", "Evidence request list"],
        "exit_criteria": "An assessment plan with reviewer assignments and an evidence request issued to the vendor.",
        "domains": ["cybersecurity", "data_privacy", "compliance"],
    },
    "questionnaire": {
        "objective": "Gather the vendor's attestations and the supporting proof behind them.",
        "inputs": ["Issued questionnaires", "Evidence requests"],
        "activities": ["Vendor completes the questionnaire and uploads evidence", "Analyst validates completeness and chases gaps", "Review certifications and audit reports against claims"],
        "raci": {"R": ["Vendor", "TPRM analyst"], "A": ["TPRM lead"], "C": ["Security"], "I": ["Business owner"]},
        "artifacts": ["Completed questionnaire", "Evidence pack"],
        "exit_criteria": "Complete responses with validated evidence on file — claims are backed by SOC 2 / ISO / pen-test / DPA artifacts.",
        "domains": ["cybersecurity", "data_privacy", "compliance", "operational"],
    },
    "scoring": {
        "objective": "Convert responses and evidence into scored findings and a residual risk rating across every domain.",
        "inputs": ["Responses", "Evidence", "Control framework mapping"],
        "activities": ["Map answers to controls and validate against evidence", "Score control posture per domain", "Compute overall residual risk after controls"],
        "raci": {"R": ["Domain reviewers"], "A": ["TPRM lead"], "C": ["Business owner"], "I": ["Risk committee"]},
        "artifacts": ["Risk scorecard", "Findings register"],
        "exit_criteria": "A residual risk rating and a scored findings register spanning all ten domains.",
        "domains": list(DOMAIN_KEYS),
    },
    "findings": {
        "objective": "Drive every gap to closure, into an agreed plan, or to a formally signed-off risk acceptance.",
        "inputs": ["Findings register", "Residual rating"],
        "activities": ["Rate each finding by severity", "Agree remediation plans and target dates", "Track to closure — or document a risk acceptance with sign-off"],
        "raci": {"R": ["Vendor", "TPRM analyst"], "A": ["Risk owner"], "C": ["Security", "Legal"], "I": ["Business owner"]},
        "artifacts": ["Remediation plan", "Risk acceptance record"],
        "exit_criteria": "All findings are closed, in an active remediation plan, or formally accepted by an accountable owner.",
        "domains": ["cybersecurity", "data_privacy", "operational", "compliance"],
    },
    "contracting": {
        "objective": "Lock the controls the assessment requires into the binding agreement.",
        "inputs": ["Findings", "Residual risk", "Regulatory obligations"],
        "activities": ["Negotiate the security addendum and DPA", "Set SLAs, breach-notification windows and right-to-audit", "Define subprocessor terms and exit / data-return clauses"],
        "raci": {"R": ["Legal", "Procurement"], "A": ["Legal"], "C": ["Security", "Privacy", "TPRM"], "I": ["Business owner"]},
        "artifacts": ["Contract", "DPA", "Security addendum", "SLA"],
        "exit_criteria": "A signed contract whose clauses reflect the risk-based controls identified during diligence.",
        "domains": ["legal", "data_privacy", "operational", "compliance"],
    },
    "approval": {
        "objective": "Make an accountable, recorded go / no-go on the residual risk.",
        "inputs": ["Risk scorecard", "Findings status", "Contract terms"],
        "activities": ["Present the case to the approver or risk committee per tier", "Approve, approve with conditions, defer, or reject", "Record the decision, its conditions, and the owner"],
        "raci": {"R": ["TPRM lead"], "A": ["Risk committee / exec owner"], "C": ["Security", "Legal"], "I": ["Business owner"]},
        "artifacts": ["Approval record", "Conditions list"],
        "exit_criteria": "A recorded decision with any conditions and a named owner accountable for them.",
        "domains": list(DOMAIN_KEYS),
    },
    "onboarding": {
        "objective": "Provision access safely and stand up the monitoring that will run for the life of the relationship.",
        "inputs": ["Approval decision and conditions"],
        "activities": ["Grant least-privilege access and configure integrations", "Register the vendor in asset and SLA inventories", "Turn on monitoring feeds"],
        "raci": {"R": ["IT", "Security"], "A": ["TPRM lead"], "C": ["Business owner"], "I": ["Procurement"]},
        "artifacts": ["Access grants", "Monitoring config"],
        "exit_criteria": "The vendor is live with monitored, least-privilege access and tracked contractual obligations.",
        "domains": ["cybersecurity", "operational"],
    },
    "monitoring": {
        "objective": "Detect changes in risk between formal reviews so the rating never goes stale.",
        "inputs": ["Security ratings feeds", "Breach & adverse-media monitoring", "SLA / financial signals", "Certification expiry"],
        "activities": ["Track security ratings, breaches, news and financial health", "Watch SLA performance and certification renewals", "Raise an ad-hoc review on any material change"],
        "raci": {"R": ["TPRM analyst"], "A": ["TPRM lead"], "C": ["Security"], "I": ["Business owner"]},
        "artifacts": ["Monitoring dashboard", "Alert log"],
        "exit_criteria": "Continuous signal coverage where trigger events automatically raise a reassessment.",
        "domains": list(DOMAIN_KEYS),
    },
    "reassessment": {
        "objective": "Re-validate on cadence or on trigger, and exit cleanly at the end of the relationship.",
        "inputs": ["Review cadence", "Trigger events", "Termination notice"],
        "activities": ["Re-run a tier-appropriate assessment on schedule or trigger", "At exit, revoke all access", "Confirm data return or destruction and close obligations"],
        "raci": {"R": ["TPRM analyst"], "A": ["TPRM lead"], "C": ["Security", "Legal"], "I": ["Business owner"]},
        "artifacts": ["Reassessment record", "Offboarding certificate", "Data-destruction attestation"],
        "exit_criteria": "Either an updated rating, or a fully offboarded vendor with evidence of access revocation and data destruction.",
        "domains": list(DOMAIN_KEYS),
    },
}


def stages_payload() -> List[dict]:
    """Canonical stage metadata for the API/UI (stable order).

    Includes the rich content catalog (objective, inputs, activities, RACI,
    artifacts, exit criteria, domains) plus the tier right-sizing hints, so the
    lifecycle UI can render a full stage definition without hard-coding it.
    """
    out: List[dict] = []
    for s in TPRA_STAGES:
        content = STAGE_CONTENT.get(s["key"], {})
        out.append(
            {
                "key": s["key"],
                "order": s["order"],
                "label": s["label"],
                "phase": s["phase"],
                "gate": bool(s.get("gate")),
                "objective": content.get("objective", ""),
                "inputs": content.get("inputs", []),
                "activities": content.get("activities", []),
                "raci": content.get("raci", {"R": [], "A": [], "C": [], "I": []}),
                "artifacts": content.get("artifacts", []),
                "exit_criteria": content.get("exit_criteria", ""),
                "domains": content.get("domains", []),
                "skippable_by_tier": [t for t, skips in TIER_SKIPPABLE_STAGES.items() if s["key"] in skips],
            }
        )
    return out
