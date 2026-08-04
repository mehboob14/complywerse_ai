"""Gate evaluation + decision recommendation engine.

`evaluate_stage_exit(stage_key, ctx)` returns whether a stage's exit criteria are
met and, when not, *why* (the blockers, surfaced in the UI). The two gate stages
(02 tiering, 08 approval) are hard stops. The engine is pure — the API layer
builds `ctx` from the DB and passes plain facts in.
"""
from __future__ import annotations

from typing import Dict, List

from .stages import is_gate

# Advisory decision recommendations (stage 08). The recorded human decision wins.
REC_APPROVE = "approve"
REC_APPROVE_CONDITIONS = "approve_with_conditions"
REC_REMEDIATE = "remediate_first"
REC_ESCALATE = "escalate_or_reject"


def recommend_decision(residual_rating: str, open_critical_findings: int) -> str:
    """Derive an advisory recommendation from residual tier + open critical findings."""
    if (open_critical_findings or 0) > 0:
        return REC_REMEDIATE
    r = (residual_rating or "medium").lower()
    if r == "critical":
        return REC_ESCALATE
    if r == "high":
        return REC_APPROVE_CONDITIONS
    return REC_APPROVE


def _b(ctx: dict, key: str, default=False):
    return ctx.get(key, default)


def evaluate_stage_exit(stage_key: str, ctx: Dict) -> dict:
    """Evaluate a stage's exit criteria. Returns {passed, blockers, is_gate}.

    `ctx` carries plain facts the API gathered, e.g.:
      intake:        has_name, has_owner, has_data_classification
      tiering:       inherent_tier (str|None)
      dd_planning:   templates_selected (int), reviewers_assigned (int), required_reviewers (int)
      questionnaire: responses_total, responses_answered, required_evidence_missing (int)
      scoring:       residual_computed (bool)
      findings:      open_critical_unmitigated (int)
      contracting:   contract_linked (bool), tier (str)
      approval:      approval_decision (str|None), open_critical_unmitigated (int)
      onboarding:    access_provisioned (bool)
      monitoring:    (always passable)
      reassessment:  (terminal — always passable)
    """
    blockers: List[str] = []

    if stage_key == "intake":
        if not _b(ctx, "has_name"):
            blockers.append("Vendor name is required.")
        if not _b(ctx, "has_owner"):
            blockers.append("A business owner must be assigned.")
        if not _b(ctx, "has_data_classification"):
            blockers.append("A draft data classification is required.")

    elif stage_key == "tiering":
        if not ctx.get("inherent_tier"):
            blockers.append("Inherent risk tier has not been computed.")

    elif stage_key == "dd_planning":
        if int(ctx.get("templates_selected", 0)) < 1:
            blockers.append("Select at least one questionnaire template.")
        required = int(ctx.get("required_reviewers", 0))
        if int(ctx.get("reviewers_assigned", 0)) < required:
            blockers.append(f"Assign at least {required} reviewer(s) for this tier.")

    elif stage_key == "questionnaire":
        total = int(ctx.get("responses_total", 0))
        answered = int(ctx.get("responses_answered", 0))
        if total == 0:
            blockers.append("No questionnaire has been issued.")
        elif answered < total:
            blockers.append(f"{total - answered} of {total} questions remain unanswered.")
        missing = int(ctx.get("required_evidence_missing", 0))
        if missing > 0:
            blockers.append(f"{missing} required evidence item(s) missing.")

    elif stage_key == "scoring":
        if not _b(ctx, "residual_computed"):
            blockers.append("Residual risk has not been scored.")

    elif stage_key == "findings":
        open_crit = int(ctx.get("open_critical_unmitigated", 0))
        if open_crit > 0:
            blockers.append(f"{open_crit} critical finding(s) lack remediation or a signed risk acceptance.")

    elif stage_key == "contracting":
        tier = (ctx.get("tier") or "medium").lower()
        if tier in ("high", "critical") and not _b(ctx, "contract_linked"):
            blockers.append("A contract with the required control obligations must be linked.")

    elif stage_key == "approval":
        decision = (ctx.get("approval_decision") or "").lower()
        if decision not in ("approve", "approve_with_conditions"):
            blockers.append("A recorded approval decision (approve / approve-with-conditions) is required.")
        open_crit = int(ctx.get("open_critical_unmitigated", 0))
        if open_crit > 0:
            blockers.append(f"{open_crit} unmitigated critical finding(s) block approval.")

    elif stage_key == "onboarding":
        if not _b(ctx, "access_provisioned"):
            blockers.append("Access has not been provisioned / monitoring not stood up.")

    # monitoring & reassessment have no hard exit (continuous / terminal).

    return {"passed": len(blockers) == 0, "blockers": blockers, "is_gate": is_gate(stage_key)}


def can_advance(stage_key: str, ctx: Dict) -> dict:
    """Convenience wrapper used by the transition API."""
    result = evaluate_stage_exit(stage_key, ctx)
    result["stage"] = stage_key
    return result
