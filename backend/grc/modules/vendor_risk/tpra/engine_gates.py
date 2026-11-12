"""Gate evaluation + decision recommendation engine.

`evaluate_stage_exit(stage_key, ctx)` returns whether a stage's exit criteria are
met and, when not, *why*: `blockers` (sentences) and `checks` (the same facts as
rows the UI draws, each with a `fix` code naming where to clear it). The two gate
stages (02 tiering, 08 approval) are hard stops. The engine is pure — the API
layer builds `ctx` from the DB and passes plain facts in.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .stages import is_gate

# Advisory decision recommendations (stage 08). The recorded human decision wins.
REC_APPROVE = "approve"
REC_APPROVE_CONDITIONS = "approve_with_conditions"
REC_REMEDIATE = "remediate_first"
REC_ESCALATE = "escalate_or_reject"

# Where a check is cleared; the UI turns each into a button (vendors/[id]/_lib/lifecycleLogic.ts).
FIXES = ("edit_vendor", "tier", "questionnaire", "roster", "findings", "paperwork", "decision", "lifecycle", "outsourcing")


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


def _check(key: str, text: str, met: Optional[bool], fix: Optional[str] = None, problem: Optional[str] = None) -> dict:
    """One condition on leaving a stage. `met` is True, False, or None when it cannot be answered yet; `text` says what must
    hold; `detail` (only when it does not) says what is wrong."""
    assert fix is None or fix in FIXES, fix
    out = {"key": key, "text": text, "met": met, "fix": fix}
    if met is False and problem:
        out["detail"] = problem
    return out


def _reviewers(ctx: dict) -> List[dict]:
    """The tier's reviewers are named: at planning, and again at the gate (Medium skips planning, so only the gate sees it)."""
    required = int(ctx.get("required_reviewers", 0))
    if required <= 0:
        return []
    named = int(ctx.get("reviewers_assigned", 0))
    who = "a reviewer" if required == 1 else f"{required} different reviewers"
    seats = ", ".join(r.title() for r in ctx.get("reviewer_roles") or [])
    return [_check("reviewers", "The tier's reviewers are named", named >= required, "roster",
                   f"Name {who} in Assign duties{f' ({seats})' if seats else ''}; {named} named so far.")]


def _standing(ctx: dict, legacy: str, current: str) -> str:
    """The sentence for findings that block: the old wording when every one is a critical on this very scope, else the count
    with where they are (`open_gate_detail`, worded by service.gate_summary)."""
    n = int(ctx.get("open_critical_unmitigated", 0))
    detail = ctx.get("open_gate_detail")
    return current.format(n=n, detail=f" ({detail})" if detail else "") if detail else legacy.format(n=n)


def _critical(ctx: dict) -> bool:
    """A scope that supports a critical or important function (outsourcing.gate_facts): held to the outsourcing steps."""
    return ctx.get("critical_important") is True


def _clauses(ctx: dict) -> List[dict]:
    missing = ctx.get("clauses_missing") or []
    return [_check("clauses", "The contract gives audit and access rights, exit and data return, and says where data is held",
                   not missing, "paperwork", f"Record on the contract or the vendor: {', '.join(missing)}.")]


def _outsourcing_approval(ctx: dict) -> List[dict]:
    if not _critical(ctx):
        return []
    waiting = ctx.get("sub_outsourcers_waiting") or []
    return [
        _check("exit_plan", "An exit plan is in place", bool(ctx.get("exit_plan_ready")), "outsourcing",
               "Record an exit plan, approved or tested, with its summary or a link to it."),
        *_clauses(ctx),
        _check("sub_outsourcing", "Every sub-outsourcer is approved", not waiting, "outsourcing",
               f"Sub-outsourcers waiting for a decision or rejected: {', '.join(waiting)}."),
        _check("committee", "A committee decided it, at a meeting", bool(ctx.get("committee_decided")), "decision",
               "A critical or important outsourcing is decided by a committee: record the decision with its meeting."),
    ]


def _regulator(ctx: dict) -> List[dict]:
    if not _critical(ctx):
        return []
    required = ctx.get("regulator_required")
    problem = ("Say whether the regulator must be notified of this outsourcing." if required is None
               else "Record when the regulator was notified, and its reference.")
    return [_check("regulator", "The regulator is notified, where required",
                   required is False or (required is True and bool(ctx.get("regulator_notified"))), "outsourcing", problem)]


def _checks(stage_key: str, ctx: Dict) -> List[dict]:
    if stage_key == "intake":
        return [
            _check("named", "The vendor has a name", _b(ctx, "has_name"), "edit_vendor", "Vendor name is required."),
            _check("owner", "A business owner is named", _b(ctx, "has_owner"), "edit_vendor",
                   "A business owner must be assigned."),
            _check("classified", "The data we share is classified", _b(ctx, "has_data_classification"), "edit_vendor",
                   "A draft data classification is required."),
        ]

    if stage_key == "tiering":
        tiered = [_check("tiered", "A tier has been set", bool(ctx.get("inherent_tier")), "tier",
                         "Inherent risk tier has not been computed.")]
        if "critical_important" not in ctx:
            return tiered
        return [*tiered, _check("materiality", "Materiality is decided: does it support a critical or important function?",
                                ctx["critical_important"] is not None, "outsourcing",
                                "The second line has not said whether it supports a critical or important function.")]

    if stage_key == "dd_planning":
        unsent = ctx.get("tier_templates_unsent") or []
        return [
            _check("template", "A questionnaire is chosen for the plan", int(ctx.get("templates_selected", 0)) >= 1, None,
                   "Select at least one questionnaire template."),
            _check("tier_questionnaires_sent", "The questionnaires this tier asks for are sent", not unsent, "questionnaire",
                   f"Send the questionnaires this tier requires: {', '.join(unsent)}."),
            *_reviewers(ctx),
        ]

    if stage_key == "questionnaire":
        total = int(ctx.get("responses_total", 0))
        answered = int(ctx.get("responses_answered", 0))
        missing = int(ctx.get("required_evidence_missing", 0))
        unanswered = ctx.get("tier_questionnaires_unanswered") or []
        lacking = ctx.get("tier_evidence_missing") or []
        issued = total > 0
        return [
            _check("issued", "A questionnaire has been sent", issued, "questionnaire", "No questionnaire has been issued."),
            _check("answered", "Every question is answered", answered >= total if issued else None, "questionnaire",
                   f"{total - answered} of {total} questions remain unanswered."),
            _check("evidenced", "Every answer that needs proof has it", missing == 0 if issued else None, "questionnaire",
                   f"{missing} required evidence item(s) missing."),
            _check("tier_questionnaires", "The questionnaires this tier asks for are answered", not unanswered,
                   "questionnaire",
                   f"Questionnaires this tier requires are not answered yet: {', '.join(unanswered)}."),
            _check("tier_evidence", "The evidence this tier asks for is in date", not lacking, "paperwork",
                   f"Evidence this tier requires is missing or expired: {'; '.join(lacking)}."),
        ]

    if stage_key == "scoring":
        return [_check("residual", "A residual score has been computed", _b(ctx, "residual_computed"), "questionnaire",
                       "Residual risk has not been scored.")]

    if stage_key == "findings":
        return [_check("no_blocking", "No critical or blocking finding is open",
                       int(ctx.get("open_critical_unmitigated", 0)) == 0, "findings",
                       _standing(ctx, "{n} critical finding(s) lack remediation or a signed risk acceptance.",
                                 "{n} critical or blocking finding(s) lack remediation or a signed risk acceptance{detail}."))]

    if stage_key == "contracting":
        tier = (ctx.get("tier") or "medium").lower()
        if tier not in ("high", "critical") and not _critical(ctx):
            return [_check("contract", f"No contract is required at {tier} tier", True)]
        return [_check("contract", "A contract is linked", _b(ctx, "contract_linked"), "paperwork",
                       "A contract with the required control obligations must be linked."),
                *(_clauses(ctx) if _critical(ctx) else [])]

    if stage_key == "approval":
        decision = (ctx.get("approval_decision") or "").lower()
        return [
            _check("decision", "An approver has approved, for this attempt",
                   decision in ("approve", "approve_with_conditions"), "decision",
                   "A recorded approval decision (approve / approve-with-conditions) is required."),
            _check("no_blocking", "No critical or blocking finding is open",
                   int(ctx.get("open_critical_unmitigated", 0)) == 0, "findings",
                   _standing(ctx, "{n} unmitigated critical finding(s) block approval.",
                             "{n} critical or blocking finding(s) block approval{detail}.")),
            *_reviewers(ctx),
            *_outsourcing_approval(ctx),
        ]

    if stage_key == "onboarding":
        total, done = int(ctx.get("checklist_total", 0)), int(ctx.get("checklist_done", 0))
        return [_check("checklist", "The onboarding checklist is done", total > 0 and done >= total, None,
                       f"Work through the onboarding checklist: {done} of {total} done."), *_regulator(ctx)]

    if stage_key == "monitoring":
        return [_check("steady_state", "Under monitoring, the resting state", True)]

    if stage_key == "reassessment":
        return [_check("cycle_opened", "A new review cycle is opened, or the exit is complete", _b(ctx, "cycle_settled"), None,
                       "Open the next review from the Assessments tab, or finish the exit.")]

    return []


def evaluate_stage_exit(stage_key: str, ctx: Dict) -> dict:
    """Evaluate a stage's exit criteria. Returns {passed, blockers, is_gate, checks}.

    `ctx` carries plain facts the API gathered, e.g.:
      intake:        has_name, has_owner, has_data_classification
      tiering:       inherent_tier (str|None)
      dd_planning:   templates_selected (int), reviewers_assigned (int), required_reviewers (int),
                     reviewer_roles (the seats the tier asks for), tier_templates_unsent
      questionnaire: responses_total, responses_answered, required_evidence_missing (int)
      scoring:       residual_computed (bool)
      findings:      open_critical_unmitigated (int: critical or blocking findings still standing on the vendor),
                     open_gate_detail (where they are, when that is not just "critical, here")
      contracting:   contract_linked (bool), tier (str)
      approval:      approval_decision (str|None), open_critical_unmitigated, open_gate_detail, and the reviewer facts
      outsourcing:   critical_important (tiering: None until decided), and for a critical or important scope
                     clauses_missing (contracting, approval), exit_plan_ready, sub_outsourcers_waiting, committee_decided
                     (approval), regulator_required, regulator_notified (onboarding): outsourcing.gate_facts
      onboarding:    checklist_total, checklist_done (the stage's checklist)
      monitoring:    (always passable: the resting state)
      reassessment:  cycle_settled (a new cycle has opened, or the exit is complete)

    A check is `{key, text, met, fix, detail?}`: met is True, False, or None when it cannot be answered yet (never blocks).
    """
    checks = _checks(stage_key, ctx)
    blockers = [c.get("detail") or c["text"] for c in checks if c["met"] is False]
    return {"passed": not blockers, "blockers": blockers, "is_gate": is_gate(stage_key), "checks": checks}


def can_advance(stage_key: str, ctx: Dict) -> dict:
    """Convenience wrapper used by the transition API."""
    result = evaluate_stage_exit(stage_key, ctx)
    result["stage"] = stage_key
    return result
