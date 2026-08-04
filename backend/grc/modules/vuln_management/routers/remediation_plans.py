"""Remediation plans — generate, approve, apply, verify.

The four stages exist so that "we fixed it" becomes evidence rather than a
claim. Each stage records WHO and WHEN, and verification records what proved
the fix worked.

    recommended --approve--> approved --apply--> applied --verify--> verified
                                          \--> failed (rolled back)

Two deliberate safety rules, both learned from how this goes wrong in practice:

  * Auto-apply is REFUSED on a critical asset. Approving a plan for a
    business-critical machine always requires a second, human click on Apply.
  * Applying never touches a real host. Execution runs through a simulated
    executor that walks the artifact's steps and records a log. Wiring a real
    executor is a deliberate, separate decision — it must not be something you
    get by accident.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ....models import (
    GRCUser, ITAsset, Vulnerability, VulnRemediationPlan,
    VulnerabilityAssetLink, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..remediation.plan_generator import generate_plan, heuristic_plan, rollback_for

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Remediation Plans"])

STAGES = ["recommended", "approved", "applied", "verified"]


# ─── schemas ────────────────────────────────────────────────────────────────

class PlanResponse(BaseModel):
    id: int
    vulnerability_id: int
    fix_type: str
    title: str
    summary: str
    fix_artifact: str
    rationale: str
    rollback_plan: Optional[str] = None
    source: str
    status: str
    risk_score_before: Optional[float] = None
    risk_score_after: Optional[float] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    change_window_start: Optional[datetime] = None
    change_window_end: Optional[datetime] = None
    applied_at: Optional[datetime] = None
    applied_by_name: Optional[str] = None
    auto_applied: bool = False
    executor: Optional[str] = None
    execution_log: Optional[str] = None
    execution_exit_code: Optional[int] = None
    rolled_back: bool = False
    failure_reason: Optional[str] = None
    verified_at: Optional[datetime] = None
    verified_by_name: Optional[str] = None
    verification_evidence: Optional[str] = None
    # Why acting was warranted, and — if someone walked away — why they did.
    triggers: Optional[List[Dict[str, str]]] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by_name: Optional[str] = None
    cancel_reason: Optional[str] = None

    class Config:
        from_attributes = True


class ApproveIn(BaseModel):
    auto_apply: bool = Field(default=False, description="Apply immediately after approval. Refused on critical assets.")


class VerifyIn(BaseModel):
    """Evidence is mandatory. A confirmation with nothing behind it is worse
    than no confirmation, because it looks like proof in an audit export."""
    evidence: str = Field(
        min_length=10, max_length=4000,
        description="What you checked and how — re-scan output, ticket reference, console output.",
    )


class CancelIn(BaseModel):
    reason: str = Field(
        min_length=5, max_length=2000,
        description="Why this plan is being stopped.",
    )


# ─── helpers ────────────────────────────────────────────────────────────────

def _vuln_or_404(vuln_id: int, tenants: List[int], db: Session) -> Vulnerability:
    v = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id, Vulnerability.tenant_id.in_(tenants)
    ).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vulnerability not found")
    return v


# Worst-first. A finding's risk has to be scored against the most exposed asset
# it touches, not an arbitrary one, and the choice has to be stable across reads.
_CRIT_RANK = case(
    (func.lower(ITAsset.criticality) == "critical", 4),
    (func.lower(ITAsset.criticality) == "high", 3),
    (func.lower(ITAsset.criticality) == "medium", 2),
    (func.lower(ITAsset.criticality) == "low", 1),
    else_=0,
)


def _primary_asset(vuln: Vulnerability, db: Session) -> Optional[ITAsset]:
    """The asset this finding is scored against.

    Previously this was `.first()` on an unordered query, so Postgres returned
    whichever row it liked — and that order changes when a row is UPDATEd,
    because the tuple moves in the heap. Editing a linked asset could therefore
    silently swap which asset the scoring used, with no user action and no
    indication on screen: raising an asset to Critical and internet-facing could
    make the finding read "medium / not exposed" because the primary had quietly
    become a different, tamer asset.

    Now it is deterministic AND defensible: the most critical asset wins, then
    the internet-facing one, then lowest id as a stable tiebreak. Scoring a
    finding against its worst affected asset is the conservative reading, which
    is the one a security product should take.
    """
    return (
        db.query(ITAsset)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
        .filter(VulnerabilityAssetLink.vulnerability_id == vuln.id)
        .order_by(
            _CRIT_RANK.desc(),
            ITAsset.internet_facing.desc().nullslast(),
            ITAsset.id.asc(),
        )
        .first()
    )


def _journal(db: Session, vuln: Vulnerability, user: GRCUser, action: str, detail: str) -> None:
    """Write a lifecycle event to the audit trail.

    None of the plan transitions wrote one, so a finding could be adopted,
    approved, applied and verified — four accountable decisions, one of which
    closes the finding — and its History tab still said "No changes recorded
    yet. Edits made from here on are journalled", directly under the edits it
    had just failed to journal. Verification in particular sets the finding to
    `verified`, and that status change left no trace at all.

    Deliberately non-fatal: an audit write that fails must not roll back the
    transition the user actually asked for, but it must be visible in the log.
    """
    try:
        from ....models import AuditLog
        db.add(AuditLog(
            tenant_id=vuln.tenant_id,
            user_id=user.id,
            action=action,
            resource_type="vulnerability",
            resource_id=vuln.id,
            changes={"detail": detail},
        ))
    except Exception:  # noqa: BLE001
        logger.exception("audit write failed action=%s vuln_id=%s", action, vuln.id)


def _context(vuln: Vulnerability, asset: Optional[ITAsset]) -> Dict[str, Any]:
    """Everything the generator needs, in one flat dict."""
    return {
        "vuln_id": vuln.id,
        "cve_id": vuln.cve_id,
        "title": vuln.title,
        "description": (vuln.description or "")[:1500],
        "severity": vuln.severity,
        "cvss": vuln.cvss_score,
        "epss": vuln.epss_score,
        "kev": bool(vuln.kev_flag),
        "public_exploit_count": vuln.public_exploit_count or 0,
        "risk_score": (vuln.composite_priority or 0) * 10,
        "asset_name": asset.name if asset else None,
        "asset_type": asset.asset_type if asset else None,
        "asset_criticality": asset.criticality if asset else None,
        "os_family": asset.os_family if asset else None,
        "internet_facing": bool(asset.internet_facing) if asset else False,
    }


def _red_flags(vuln: Vulnerability, asset: Optional[ITAsset]) -> List[Dict[str, str]]:
    """The conditions that make remediation warranted right now.

    Remediation is not something you start because a button exists — it starts
    because something is wrong. This returns the specific things that are
    wrong, each as {code, label, detail}, so the plan can show its own
    justification instead of asserting urgency in prose.

    An empty list is a meaningful answer: nothing here is raising a flag, so
    the finding can wait for the normal patch cycle. The UI says exactly that
    rather than pushing a plan nobody needs.
    """
    flags: List[Dict[str, str]] = []
    now = datetime.utcnow()

    if getattr(vuln, "kev_flag", False):
        flags.append({
            "code": "kev", "label": "Actively exploited (CISA KEV)",
            "detail": "Listed in CISA's Known Exploited Vulnerabilities catalogue — "
                      "attacks using this are happening, not hypothetical.",
        })

    count = getattr(vuln, "public_exploit_count", 0) or 0
    if count > 0:
        flags.append({
            "code": "public_exploit", "label": f"{count} public exploit{'s' if count != 1 else ''}",
            "detail": "Working exploit code is published, so the skill needed to "
                      "use this is low.",
        })

    epss = getattr(vuln, "epss_score", None)
    if epss is not None and epss >= 0.10:
        flags.append({
            "code": "epss", "label": f"High exploitation probability ({epss * 100:.1f}%)",
            "detail": "EPSS puts this well above the level where most findings sit.",
        })

    due = getattr(vuln, "due_date", None)
    if due and due < now:
        days = (now - due).days
        flags.append({
            "code": "sla_breach", "label": f"{days} day{'s' if days != 1 else ''} past its due date",
            "detail": "The remediation SLA for this finding has already been missed.",
        })

    if asset is not None:
        if getattr(asset, "internet_facing", False):
            flags.append({
                "code": "exposed", "label": "Asset is internet-facing",
                "detail": "Reachable from outside the network, so exposure is not "
                          "limited to someone already inside.",
            })
        if (getattr(asset, "criticality", "") or "").lower() == "critical":
            flags.append({
                "code": "critical_asset", "label": "Business-critical asset",
                "detail": "Impact of compromise here is rated critical to the business.",
            })

    return flags


def _simulated_apply(plan: VulnRemediationPlan) -> Dict[str, Any]:
    """Walk the artifact's real steps and record what would have run.

    Comment lines and blanks are dropped, so the log reflects the actual
    commands rather than the explanation around them.
    """
    started = datetime.utcnow()
    steps = [
        ln.strip() for ln in (plan.fix_artifact or "").splitlines()
        if ln.strip() and not ln.strip().startswith(("#", "//"))
    ]
    lines = [
        f"[simulated-executor] target={plan.title} fix_type={plan.fix_type}",
        f"[simulated-executor] started={started.isoformat()}",
        "",
        "NOTE: no command was executed on any host. This run records the steps",
        "      the plan contains so the change can be reviewed before a real",
        "      executor is ever connected.",
        "",
    ]
    for s in steps:
        lines.append(f"$ {s}")
        lines.append("  ok")
    lines.append("")
    lines.append(f"[simulated-executor] finished exit=0 steps={len(steps)}")
    return {"log": "\n".join(lines), "exit_code": 0, "step_count": len(steps)}


# ─── endpoints ──────────────────────────────────────────────────────────────

@router.get("/vulnerabilities/{vuln_id}/remediation-plan", response_model=PlanResponse)
def get_plan(vuln_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    _vuln_or_404(vuln_id, tenants, db)
    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.vulnerability_id == vuln_id
    ).first()
    if plan:
        return plan

    # No saved plan yet. Rather than 404 into an empty "Generate" button, return
    # the heuristic plan computed on the fly, marked `status="preview"` and with
    # `id=0` so nothing can mistake it for a stored row.
    #
    # Deliberately NOT persisted. Reading a page must not write to the database,
    # and a plan row carries an approval lifecycle — creating one as a side
    # effect of someone glancing at the tab would mean approvals attach to text
    # nobody chose to commit to. The heuristic is deterministic and derived
    # entirely from fields we already hold, so the preview shown here is exactly
    # what POST will save; the POST is the moment of intent.
    vuln = _vuln_or_404(vuln_id, tenants, db)
    asset = _primary_asset(vuln, db)
    ctx = _context(vuln, asset)
    draft = heuristic_plan(ctx)
    return PlanResponse(
        id=0,
        vulnerability_id=vuln_id,
        status="preview",
        risk_score_before=ctx["risk_score"],
        auto_applied=False,
        triggers=_red_flags(vuln, asset),
        **{k: v for k, v in draft.items() if k in PlanResponse.model_fields and k != "status"},
    )


@router.post("/vulnerabilities/{vuln_id}/remediation-plan", response_model=PlanResponse, status_code=201)
def generate(vuln_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Generate — or regenerate — the plan.

    Regenerating REPLACES the content and resets the lifecycle to
    'recommended', clearing any prior approval. That is intentional: an
    approval belongs to the text that was approved, not to the finding.
    """
    tenants = get_user_tenants(current_user, db) or []
    vuln = _vuln_or_404(vuln_id, tenants, db)
    asset = _primary_asset(vuln, db)
    ctx = _context(vuln, asset)
    generated = generate_plan(ctx)

    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.vulnerability_id == vuln_id
    ).first()
    if plan is None:
        plan = VulnRemediationPlan(tenant_id=vuln.tenant_id, vulnerability_id=vuln.id)
        db.add(plan)

    for k, v in generated.items():
        setattr(plan, k, v)
    plan.status = "recommended"
    plan.risk_score_before = ctx["risk_score"]
    # Freeze why this was warranted at the moment of adoption.
    plan.triggers = _red_flags(vuln, asset)
    # Clear the whole lifecycle — a new plan has not been approved or applied.
    for f in ("risk_score_after", "approved_by_id", "approved_by_name", "approved_at",
              "change_window_start", "change_window_end", "applied_at", "applied_by_name",
              "executor", "execution_log", "execution_exit_code", "failure_reason",
              "verified_at", "verified_by_name", "verification_evidence",
              "cancelled_at", "cancelled_by_name", "cancel_reason"):
        setattr(plan, f, None)
    plan.auto_applied = False
    plan.rolled_back = False

    _journal(db, vuln, current_user, "vulnerability.plan_adopted",
             f"Remediation plan adopted ({plan.fix_type}, source: {plan.source})")
    db.commit()
    db.refresh(plan)
    logger.info("remediation plan generated vuln_id=%s source=%s fix_type=%s",
                vuln_id, plan.source, plan.fix_type)
    return plan


@router.post("/remediation-plans/{plan_id}/approve", response_model=PlanResponse)
def approve(plan_id: int, body: ApproveIn, db: Session = Depends(get_db),
            current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.id == plan_id, VulnRemediationPlan.tenant_id.in_(tenants)
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation plan not found")
    if plan.status not in ("recommended", "approved"):
        raise HTTPException(409, f"A plan in state '{plan.status}' cannot be approved")

    # Approval without an owner is an instruction addressed to nobody.
    #
    # "Yes, do this" and "you are the one doing it" are separate facts, and the
    # lifecycle previously recorded only the first — a plan could reach
    # `approved`, sit there, breach its SLA, and no individual or team had ever
    # been named. Either an assignee or a department satisfies this: small teams
    # route to a person, larger ones route to a queue.
    vuln_for_owner = db.query(Vulnerability).filter(
        Vulnerability.id == plan.vulnerability_id
    ).first()
    has_owner = bool(getattr(vuln_for_owner, "assigned_to", None))
    if not has_owner:
        try:
            from ....models import GRCVulnerabilityDepartmentAssignment
            has_owner = db.query(GRCVulnerabilityDepartmentAssignment).filter(
                GRCVulnerabilityDepartmentAssignment.vulnerability_id == plan.vulnerability_id
            ).first() is not None
        except Exception:  # noqa: BLE001 — absence of the model must not block approval logic
            logger.exception("department-assignment lookup failed for vuln_id=%s",
                             plan.vulnerability_id)
    if not has_owner:
        raise HTTPException(
            409,
            "Assign this finding to a person or a department before approving. "
            "An approved plan with no owner is work nobody has been asked to do.",
        )

    now = datetime.utcnow()
    who = getattr(current_user, "display_name", None) or current_user.username

    if plan.approved_at is None:  # keep the first approver on re-approval
        plan.approved_by_id = current_user.id
        plan.approved_by_name = who
        plan.approved_at = now
    plan.status = "approved"
    # Immediate window for auto-apply; otherwise tomorrow, so a change that
    # touches production is announced before it happens.
    if plan.change_window_start is None:
        plan.change_window_start = now if body.auto_apply else now + timedelta(days=1)
        plan.change_window_end = plan.change_window_start + timedelta(hours=2 if body.auto_apply else 26)

    result: Optional[Dict[str, Any]] = None
    if body.auto_apply:
        vuln = db.query(Vulnerability).filter(Vulnerability.id == plan.vulnerability_id).first()
        asset = _primary_asset(vuln, db) if vuln else None
        if asset and (asset.criticality or "").lower() == "critical":
            # Refused, not queued. The caller is told plainly why.
            plan.failure_reason = (
                "Auto-apply refused: this fix targets a business-critical asset. "
                "Review the plan and apply it manually."
            )
            db.commit()
            db.refresh(plan)
            return plan
        result = _simulated_apply(plan)
        plan.status = "applied"
        plan.applied_at = now
        plan.applied_by_name = who
        plan.auto_applied = True
        plan.executor = "simulated"
        plan.execution_log = result["log"]
        plan.execution_exit_code = result["exit_code"]

    _journal(db, vuln_for_owner, current_user, "vulnerability.plan_approved",
             f"Remediation plan approved by {who}"
             + (" with auto-apply" if body.auto_apply else ""))
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/remediation-plans/{plan_id}/apply", response_model=PlanResponse)
def apply(plan_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.id == plan_id, VulnRemediationPlan.tenant_id.in_(tenants)
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation plan not found")
    # 'failed' IS allowed — a retry after a failure is the whole point of
    # showing the failure. The reference product's guard omits it, which makes
    # its own "Retry Apply" button dead on arrival.
    if plan.status not in ("approved", "applied", "failed"):
        raise HTTPException(409, "A plan must be approved before it can be applied")

    now = datetime.utcnow()
    result = _simulated_apply(plan)
    plan.status = "applied"
    plan.applied_at = now
    plan.applied_by_name = getattr(current_user, "display_name", None) or current_user.username
    plan.executor = "simulated"
    plan.execution_log = result["log"]
    plan.execution_exit_code = result["exit_code"]
    plan.rolled_back = False
    plan.failure_reason = None
    if not plan.rollback_plan:
        plan.rollback_plan = rollback_for(plan.fix_type)

    _applied_vuln = db.query(Vulnerability).filter(
        Vulnerability.id == plan.vulnerability_id
    ).first()
    if _applied_vuln:
        _journal(db, _applied_vuln, current_user, "vulnerability.plan_applied",
                 f"Remediation plan applied via the {plan.executor} executor "
                 f"(exit {plan.execution_exit_code}) — no command ran on any host")
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/remediation-plans/{plan_id}/cancel", response_model=PlanResponse)
def cancel(plan_id: int, body: CancelIn, db: Session = Depends(get_db),
           current_user: GRCUser = Depends(require_auth)):
    """Stop a plan, on the record.

    Walking away from a remediation is a decision with the same weight as
    approving one — often more, because the risk stays. Previously a plan could
    simply be abandoned at any stage: the row sat at `recommended` forever and
    nothing captured who stopped, when, or why. This makes stopping explicit
    and attributable.

    A cancelled plan does NOT close the finding. The vulnerability stays open
    and keeps its priority — deciding not to fix something is not the same as
    it no longer being a problem. To stop tracking it, accept the risk (which
    carries an expiry) or remediate it.
    """
    tenants = get_user_tenants(current_user, db) or []
    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.id == plan_id, VulnRemediationPlan.tenant_id.in_(tenants)
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation plan not found")
    if plan.status in ("verified", "cancelled"):
        raise HTTPException(409, f"A plan in state '{plan.status}' cannot be stopped")

    now = datetime.utcnow()
    who = getattr(current_user, "display_name", None) or current_user.username
    stopped_from = plan.status
    plan.status = "cancelled"
    plan.cancelled_at = now
    plan.cancelled_by_name = who
    plan.cancel_reason = body.reason.strip()

    try:
        from ....models import AuditLog
        vuln = db.query(Vulnerability).filter(Vulnerability.id == plan.vulnerability_id).first()
        db.add(AuditLog(
            tenant_id=plan.tenant_id,
            user_id=current_user.id,
            action="vulnerability.remediation_stopped",
            resource_type="vulnerability",
            resource_id=plan.vulnerability_id,
            changes={
                "detail": f"Remediation stopped by {who} at stage '{stopped_from}'",
                "from": stopped_from,
                "to": "cancelled",
                "reason": plan.cancel_reason,
                "finding_remains": (vuln.status if vuln else None),
            },
        ))
    except Exception:  # noqa: BLE001
        logger.exception("cancel audit write failed plan_id=%s", plan_id)

    db.commit()
    db.refresh(plan)
    logger.info("remediation plan cancelled plan_id=%s from=%s", plan_id, stopped_from)
    return plan


@router.post("/remediation-plans/{plan_id}/verify", response_model=PlanResponse)
def verify(plan_id: int, body: VerifyIn, db: Session = Depends(get_db),
           current_user: GRCUser = Depends(require_auth)):
    """Record a human attestation that the fix was carried out and checked.

    Deliberately NOT called "verification" in the automated sense: nothing here
    re-scans the host. It captures a named person stating what they checked and
    how, which is honest evidence. Wiring a real re-scan is a separate decision,
    and when it lands it should be able to FAIL — this step currently cannot.
    """
    tenants = get_user_tenants(current_user, db) or []
    plan = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.id == plan_id, VulnRemediationPlan.tenant_id.in_(tenants)
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation plan not found")
    if plan.status not in ("applied", "verified"):
        raise HTTPException(409, "A plan must be applied before it can be verified")

    now = datetime.utcnow()
    who = getattr(current_user, "display_name", None) or current_user.username
    vuln = db.query(Vulnerability).filter(Vulnerability.id == plan.vulnerability_id).first()
    previous_status = getattr(vuln, "status", None) or "open"

    before = plan.risk_score_before
    after = 0.0
    if vuln:
        vuln.status = "verified"
        vuln.resolved_at = now

    # This used to compose a sentence stating the finding "is recorded as no
    # longer present" — without checking anything. That is manufactured
    # evidence: it reads to an auditor like the output of a re-scan when no
    # re-scan happened. It is now an attestation, attributed to the person who
    # made it, and it says plainly what backs it.
    #
    # `evidence` is required by the schema, so the claim has to come from a
    # human who names their source (scan output, ticket reference, console
    # screenshot) rather than from string formatting.
    ran_via = ""
    if plan.executor == "simulated":
        ran_via = (" No automated execution took place — the apply step was "
                   "simulated, so this attestation is the only record that the "
                   "fix was actually carried out.")
    elif plan.executor:
        ran_via = f" The fix ran via the {plan.executor} executor (exit {plan.execution_exit_code or 0})."
    plan.verification_evidence = (
        f"Attested by {who} on {now.strftime('%d %b %Y at %H:%M UTC')}: "
        f"{body.evidence.strip()}{ran_via}"
    )
    plan.status = "verified"
    plan.verified_at = now
    plan.verified_by_name = who
    plan.risk_score_after = after

    if vuln:
        # Re-attesting an already-verified finding is legal (the endpoint accepts
        # `verified`), but "changed from verified to verified" is not a change and
        # should not read like one in the audit trail.
        if previous_status != "verified":
            _journal(db, vuln, current_user, "vulnerability.status_changed",
                     f"Status changed from {previous_status} to verified — attested fixed by {who}")
        else:
            _journal(db, vuln, current_user, "vulnerability.re_attested",
                     f"Fix re-attested by {who}; status was already verified")

    db.commit()
    db.refresh(plan)
    return plan
