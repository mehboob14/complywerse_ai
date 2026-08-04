"""TPRA 8-stage lifecycle definitions + helpers (additive — no DB schema here).

The canonical lifecycle every third party moves through:

    intake → tiering → due_diligence → rating → remediation
           → contracting → monitoring → offboarding

Stages 1–6 answer "should we let this vendor in, and on what terms?"; stages
7–8 answer "is it still safe, and have we shut it down properly?" — with
monitoring continuously feeding back into the assessment work.
"""
from datetime import datetime
from typing import Optional


LIFECYCLE_STAGES = [
    {"key": "intake", "order": 1, "label": "Intake & request",
     "description": "Log the vendor request: who they are, what service they provide, what data/systems they touch, and the owning business unit. Nothing is assessed yet.",
     "actions": ["Capture vendor basics", "Assign owner & business unit"]},
    {"key": "tiering", "order": 2, "label": "Inherent risk tiering",
     "description": "Triage criticality and data access before any controls are considered — assign a tier (critical / high / medium / low). The single most important step: it decides how much scrutiny everything downstream gets.",
     "actions": ["Set data access level", "Assign inherent tier (AI can recommend)"]},
    {"key": "due_diligence", "order": 3, "label": "Due diligence",
     "description": "Send a security/risk questionnaire (SIG, CAIQ, or your own) and collect evidence (SOC 2 Type II, ISO 27001, pen-test summaries, BCP/DR), scaled to the tier.",
     "actions": ["Send questionnaire", "Collect & review evidence"]},
    {"key": "rating", "order": 4, "label": "Risk analysis & rating",
     "description": "Gap analysis against control expectations; document findings; weigh them into a residual risk rating — the number decision-makers act on.",
     "actions": ["Score assessment", "Run AI gap analysis", "Approve assessment"]},
    {"key": "remediation", "order": 5, "label": "Remediation & treatment",
     "description": "For each gap: remediate (vendor fixes), mitigate (compensating control), transfer (contract/insurance), or accept (documented, time-bound, signed off).",
     "actions": ["Track remediation actions", "Record risk acceptances"]},
    {"key": "contracting", "order": 6, "label": "Contracting & onboarding",
     "description": "Required controls become binding — security/privacy addenda, DPA, breach-notification windows, audit rights, SLAs, subcontractor restrictions. Approve and go live.",
     "actions": ["Link contract document", "Approve & onboard"]},
    {"key": "monitoring", "order": 7, "label": "Continuous monitoring",
     "description": "After go-live, risk keeps changing. Reassess on schedule (cadence by tier) or on trigger (incident, expired cert, scope change). Material change loops back to due diligence.",
     "actions": ["Set reassessment cadence", "Record SLA / incidents", "Trigger reassessment"],
     "recurring": True},
    {"key": "offboarding", "order": 8, "label": "Offboarding & termination",
     "description": "Close the loop cleanly: revoke access, return or certifiably destroy data, decommission integrations, confirm final obligations, and formally close the case.",
     "actions": ["Work offboarding checklist", "Confirm data return / destruction"]},
]

STAGE_KEYS = [s["key"] for s in LIFECYCLE_STAGES]
STAGE_ORDER = {s["key"]: s["order"] for s in LIFECYCLE_STAGES}
STAGE_LABEL = {s["key"]: s["label"] for s in LIFECYCLE_STAGES}

# Suggested reassessment cadence (days) by tier — used to seed scheduling.
TIER_CADENCE_DAYS = {"critical": 365, "high": 365, "medium": 730, "low": 1095}

DEFAULT_OFFBOARDING_CHECKLIST = [
    "Revoke all vendor access and credentials",
    "Return or certifiably destroy our data",
    "Decommission integrations / shared keys",
    "Confirm final compliance & contractual obligations",
    "Export audit trail and formally close the case",
]


def is_valid_stage(stage: str) -> bool:
    return stage in STAGE_KEYS


def next_stage(stage: str) -> Optional[str]:
    """The stage after `stage`, or None at the end. Unknown → first stage."""
    if stage not in STAGE_ORDER:
        return STAGE_KEYS[0]
    idx = STAGE_KEYS.index(stage)
    return STAGE_KEYS[idx + 1] if idx + 1 < len(STAGE_KEYS) else None


def record_transition(vendor, new_stage: str, user_id: Optional[int], note: str = "") -> None:
    """Append a stage transition to the vendor's history and set the new stage.
    Mutates the vendor in place (caller commits)."""
    history = list(vendor.lifecycle_history or [])
    history.append({
        "stage": new_stage,
        "from": getattr(vendor, "lifecycle_stage", None),
        "at": datetime.utcnow().isoformat(),
        "by": user_id,
        "note": note or "",
    })
    vendor.lifecycle_history = history
    vendor.lifecycle_stage = new_stage
