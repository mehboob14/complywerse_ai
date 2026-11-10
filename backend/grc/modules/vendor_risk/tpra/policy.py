"""The vendor policy: tier bands and cadence, remediation windows, stages each tier skips, reviewers each tier needs.

One page of settings (GET and PUT /vendor-risk/policy) on the tenant's tiering-config row, beside the bands and cadence
it already held; /vendor-risk/tpra/config keeps working as it did. Every setting has a default (what the module always
did) and a tenant's values go over it, tier by tier. The reopen threshold stays in the tier policy (PUT
/vendor-risk/tpra/config); approver roles are readable and writable here too, for a page with one Save.

An assessment is held to the policy it was tiered under (service.policy_snapshot, POLICY_KEYS): the provider functions
below read a config or such a snapshot, so work under way keeps the windows, skips and reviewers it started with.
This module imports nothing of service (service imports it), so the audit write imports it late.
"""
from __future__ import annotations

import copy
import json
import math
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import GRCUser, Role, TPRATieringConfig, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, tier_policy
from .bootstrap import DEFAULT_TIERING_CONFIG, get_tiering_config
from .stages import (
    ROSTER_ROLES, ROSTER_ROLE_KEYS, TPRA_STAGES, cadence_days_for, remediation_sla_days_for, required_reviewers_for,
    reviewers_by_tier_for, skip_matrix_for, skippable, stage_label,
)

router = APIRouter(tags=["Vendor policy"])

# The settings an assessment is held to, as they stood when its tier was set. The last three came later: a
# snapshot without them was taken under their defaults.
POLICY_KEYS = ("weights", "thresholds", "cadence_days", "tier_policy", "remediation_days", "skip_matrix",
               "required_reviewers")
_LATER_KEYS = ("remediation_days", "skip_matrix", "required_reviewers")
TIERS_DOWN = ["critical", "high", "medium", "low"]       # tiers and severities share their words


# ── what the rest of the module reads ────────────────────────────────────────

def remediation_days(cfg: Optional[dict], severity: str) -> int:
    """Days to fix a finding of this severity, by a config or a policy snapshot."""
    return remediation_sla_days_for(severity, (cfg or {}).get("remediation_days"))


def skip_matrix(cfg: Optional[dict]) -> Dict[str, List[str]]:
    """The stages each tier skips."""
    return skip_matrix_for((cfg or {}).get("skip_matrix"))


def required_reviewers(cfg: Optional[dict], tier: str) -> List[str]:
    """The roster roles a tier needs as reviewers."""
    return required_reviewers_for(tier, (cfg or {}).get("required_reviewers"))


def reviewer_seats(cfg: Optional[dict]) -> set:
    """Every roster role some tier needs as a reviewer: the seats whose holders review an assessment."""
    return {role for roles in reviewers_by_tier_for((cfg or {}).get("required_reviewers")).values() for role in roles}


def held_to(cfg: dict, snapshot: Optional[dict]) -> dict:
    """The config work is held to: the tenant's, with the snapshot an assessment took over it."""
    out = {**cfg, **{k: snapshot[k] for k in POLICY_KEYS if snapshot and snapshot.get(k)}}
    if snapshot:
        for key in _LATER_KEYS:
            if not snapshot.get(key):
                out[key] = copy.deepcopy(DEFAULT_TIERING_CONFIG[key])
    return out


# ── checking a change: each returns the whole new setting, or raises ValueError with a sentence to show ──────────

def _whole_number(value, low: int, high: int, message: str) -> int:
    ok = (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
          and value == int(value) and low <= value <= high)
    if not ok:
        raise ValueError(message)
    return int(value)


def _by_tier(raw, current: dict, what: str) -> dict:
    """A copy of the current setting to change tier by tier; `raw` may name only some tiers."""
    if not isinstance(raw, dict):
        raise ValueError(f"{what} have to be given tier by tier")
    for tier in raw:
        if tier not in TIERS_DOWN:
            raise ValueError(f"There is no tier '{tier}'")
    return {t: current[t] for t in TIERS_DOWN}


def clean_thresholds(raw, current: dict) -> Dict[str, float]:
    """Score bands, 0 to 100, falling from critical to medium (low is anything below medium)."""
    if not isinstance(raw, dict):
        raise ValueError("Bands have to be given tier by tier")
    out = {t: float(current[t]) for t in ("critical", "high", "medium")}
    for tier, value in raw.items():
        if tier not in out:
            raise ValueError("Low has no band: it is anything below medium" if tier == "low" else f"There is no tier '{tier}'")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError("A band is a score from 0 to 100")
        out[tier] = round(float(value), 2)
    if not out["critical"] > out["high"] > out["medium"]:
        raise ValueError("The bands have to fall: critical above high, high above medium")
    return out


def clean_cadence(raw, current: dict) -> Dict[str, int]:
    out = _by_tier(raw, current, "Review cadences")
    for tier, value in raw.items():
        out[tier] = _whole_number(value, 30, 1825, "A review cadence has to be between 30 days and 5 years (1825 days)")
    return out


def clean_remediation(raw, current: dict) -> Dict[str, int]:
    out = _by_tier(raw, current, "Fix windows")
    for severity, value in raw.items():
        out[severity] = _whole_number(value, 1, 365, "A fix window has to be between 1 and 365 days")
    return out


def clean_skip_matrix(raw, current: dict) -> Dict[str, List[str]]:
    out = _by_tier(raw, current, "Skipped stages")
    for tier, stages in raw.items():
        if not isinstance(stages, list):
            raise ValueError("A tier's skipped stages are a list of stage keys")
        for stage in stages:
            if not isinstance(stage, str) or stage not in {s["key"] for s in TPRA_STAGES}:
                raise ValueError(f"There is no stage '{stage}'")
            if not skippable(stage):
                raise ValueError(f"{stage_label(stage)} cannot be skipped: it runs for every vendor")
        out[tier] = [s["key"] for s in TPRA_STAGES if s["key"] in stages]       # lifecycle order, once each
    return out


def clean_reviewers(raw, current: dict) -> Dict[str, List[str]]:
    out = _by_tier(raw, current, "Reviewers")
    for tier, roles in raw.items():
        if not isinstance(roles, list):
            raise ValueError("A tier's reviewers are a list of roster roles")
        for role in roles:
            if not isinstance(role, str) or role not in ROSTER_ROLE_KEYS:
                raise ValueError(f"'{role}' is not a roster role")
        out[tier] = list(dict.fromkeys(roles))
    return out


# ── the page ─────────────────────────────────────────────────────────────────

def _view(cfg: dict) -> dict:
    """The settings the page edits, whole: the tenant's over the defaults."""
    matrix, tiers = skip_matrix(cfg), tier_policy.merged(cfg.get("tier_policy"))
    return {
        "thresholds": {**DEFAULT_TIERING_CONFIG["thresholds"], **(cfg.get("thresholds") or {})},
        "cadence_days": {t: cadence_days_for(t, cfg.get("cadence_days")) for t in TIERS_DOWN},
        "remediation_days": {t: remediation_days(cfg, t) for t in TIERS_DOWN},
        "skip_matrix": {t: matrix[t] for t in TIERS_DOWN},
        "required_reviewers": {t: required_reviewers(cfg, t) for t in TIERS_DOWN},
        "approver_roles": {t: tiers[t].get("approver_role") for t in TIERS_DOWN},
    }


def tenant_of(db: Session, user: GRCUser) -> int:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(403, "No tenant context")
    return tids[0]


def can_edit(db: Session, user: GRCUser) -> bool:
    """Whether the user may change the vendor policy and the roster (vendor_risk:config:edit)."""
    try:
        rbac.require_write(db, user, "config", "edit")
        return True
    except HTTPException:
        return False


def _payload(db: Session, user: GRCUser, tenant_id: int) -> dict:
    now, defaults = _view(get_tiering_config(db, tenant_id)), _view(DEFAULT_TIERING_CONFIG)
    return {
        **now,
        "customised": now != defaults,
        "can_edit": can_edit(db, user),
        "defaults": defaults,
        "meta": {
            "tiers": TIERS_DOWN, "severities": TIERS_DOWN,
            "stages": [{"key": s["key"], "label": s["label"], "skippable": skippable(s["key"])} for s in TPRA_STAGES],
            "roles": [{"key": r["key"], "label": r["label"]} for r in ROSTER_ROLES],
        },
    }


@router.get("/policy")
def get_policy(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return _payload(db, user, tenant_of(db, user))


class PolicyIn(BaseModel):
    """Partial: only the settings sent change, and a tier named in one replaces that tier's value."""
    model_config = ConfigDict(extra="forbid")

    thresholds: Optional[dict] = None          # {critical, high, medium} scores, falling
    cadence_days: Optional[dict] = None        # {tier: days between reviews}
    remediation_days: Optional[dict] = None    # {severity: days to fix a finding}
    skip_matrix: Optional[dict] = None         # {tier: [stage keys that tier skips]}
    required_reviewers: Optional[dict] = None  # {tier: [roster roles that must review]}
    approver_roles: Optional[dict] = None      # {tier: role that must approve, or null: anyone with the right}
    reassess_on: Optional[dict] = None         # {tier: the alert severity that reopens an assessment}: the tier policy's, saved with the rest in ONE request


@router.put("/policy")
def put_policy(body: PolicyIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = tenant_of(db, user)
    rbac.require_write(db, user, "config", "edit")
    sent = {k: v for k, v in body.model_dump().items() if v is not None}
    cfg = get_tiering_config(db, tenant_id)
    before = _view(cfg)
    cleaners = {"thresholds": clean_thresholds, "cadence_days": clean_cadence, "remediation_days": clean_remediation,
                "skip_matrix": clean_skip_matrix, "required_reviewers": clean_reviewers}
    try:
        new = {k: clean(sent[k], before[k]) for k, clean in cleaners.items() if k in sent}
        if "approver_roles" in sent:
            asked = sent["approver_roles"]
            if not isinstance(asked, dict):
                raise ValueError("Approver roles have to be given tier by tier")
            names = {r.name for r in db.query(Role).filter(or_(Role.tenant_id == tenant_id, Role.tenant_id.is_(None)))}
            for role in asked.values():
                if role and (not isinstance(role, str) or role not in names):
                    raise ValueError(f"There is no role named '{role}'")
            patch = {t: {"approver_role": role} for t, role in asked.items()}
            merged = tier_policy.clean(patch, tier_policy.merged(cfg.get("tier_policy")))
            new["approver_roles"] = {t: merged[t].get("approver_role") for t in TIERS_DOWN}
        if "reassess_on" in sent:
            asked = sent["reassess_on"]
            if not isinstance(asked, dict):
                raise ValueError("Reopen thresholds have to be given tier by tier")
            patch = {t: {"reassess_on": sev} for t, sev in asked.items()}
            merged = tier_policy.clean(patch, tier_policy.merged(cfg.get("tier_policy")))
            new["reassess_on"] = {t: merged[t].get("reassess_on") for t in TIERS_DOWN}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    now_reopen = {t: tier_policy.merged(cfg.get("tier_policy"))[t].get("reassess_on") for t in TIERS_DOWN}
    changed = sorted(k for k, v in new.items() if v != (now_reopen if k == "reassess_on" else before[k]))
    if changed:
        row = db.query(TPRATieringConfig).filter(
            TPRATieringConfig.tenant_id == tenant_id, TPRATieringConfig.config_key == "default").first()
        if row is None:
            row = TPRATieringConfig(
                tenant_id=tenant_id, config_key="default", is_active=True,
                weights=dict(DEFAULT_TIERING_CONFIG["weights"]), thresholds=dict(DEFAULT_TIERING_CONFIG["thresholds"]),
                cadence_days=dict(DEFAULT_TIERING_CONFIG["cadence_days"]))
            db.add(row)
        for key in changed:
            if key == "approver_roles":
                row.tier_policy = tier_policy.clean({t: {"approver_role": r} for t, r in new[key].items()},
                                                    tier_policy.merged(row.tier_policy))
            elif key == "reassess_on":
                row.tier_policy = tier_policy.clean({t: {"reassess_on": sev} for t, sev in new[key].items()},
                                                    tier_policy.merged(row.tier_policy))
            else:
                setattr(row, key, new[key])
        row.row_version = (row.row_version or 1) + 1
        from .service import write_audit           # late: service reads this module

        write_audit(db, tenant_id, entity="policy", action="update", actor_id=user.id,
                    from_value=json.dumps({k: (now_reopen if k == "reassess_on" else before[k]) for k in changed}),
                    to_value=json.dumps({k: new[k] for k in changed}), reason="Vendor policy updated")
        db.commit()
    return _payload(db, user, tenant_id)
