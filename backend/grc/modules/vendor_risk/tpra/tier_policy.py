"""What a vendor's tier asks of the programme.

Tiering already set a reassessment cadence. Here the tier also chooses the
questionnaires the vendor answers, the evidence it must supply, whose approval
it needs, and how serious a monitoring signal must be to reopen its assessment.
Change a vendor's tier and every one of those changes with it.

Each tenant sets its own policy per tier; `DEFAULT_TIER_POLICY` applies until it
does. The tiering engine and its thresholds are untouched: this is about the
consequences of a tier, not how it is computed.

A tier also has to stay true. The facts it was computed from are recorded when
it is computed, and when the vendor's profile moves past them (more sensitive
data access, new kinds of data, new locations, a change of service) or a breach
is reported, the vendor is due a re-tier. Setting a tier by hand instead of
computing it needs a justification, which goes on the audit trail.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    Evidence, Role, TPRAEvidenceLink, TPRAMonitoringSignal, UserRole, Vendor, VendorAssessment,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate,
)
from .builtin_templates import TIER_SUGGESTED_TEMPLATES
from .portal import ANSWERED
from .stages import TIERS, cadence_days_for, required_reviewers_for

EVIDENCE_KINDS: Dict[str, str] = {
    "assurance_report": "Independent assurance: a SOC 2 report or ISO 27001 certificate",
    "pen_test": "Penetration test summary from the last 12 months",
    "bcp_test": "Business continuity or disaster recovery test results",
    "insurance": "Cyber insurance certificate",
    "security_policy": "Information security policy",
    "dpa": "Signed data processing agreement",
    "financials": "Audited financial statements",
}
SEVERITIES = ["low", "medium", "high", "critical"]

DEFAULT_TIER_POLICY: Dict[str, dict] = {
    "critical": {"template_ids": [], "evidence": ["assurance_report", "pen_test", "bcp_test", "insurance", "dpa"],
                 "approver_role": None, "reassess_on": "medium"},
    "high": {"template_ids": [], "evidence": ["assurance_report", "pen_test", "dpa"],
             "approver_role": None, "reassess_on": "high"},
    "medium": {"template_ids": [], "evidence": ["assurance_report"], "approver_role": None, "reassess_on": "high"},
    "low": {"template_ids": [], "evidence": [], "approver_role": None, "reassess_on": "critical"},
}
_RETIRED = ("archived", "superseded", "rejected", "deleted")
_ACCESS_RANK = {"none": 0, "public": 1, "internal": 2, "confidential": 3, "restricted": 4, "regulated": 4}


def _tier(value) -> str:
    t = (value or "medium").lower()
    return t if t in TIERS else "medium"


# ── the policy ───────────────────────────────────────────────────────────────

def merged(stored: Optional[dict]) -> Dict[str, dict]:
    stored = stored or {}
    return {t: {**DEFAULT_TIER_POLICY[t], **(stored.get(t) or {})} for t in TIERS}


def clean(raw: dict, current: Dict[str, dict]) -> Dict[str, dict]:
    """Validate a tier-policy patch: {tier: {template_ids?, evidence?, approver_role?, reassess_on?}}."""
    if not isinstance(raw, dict):
        raise ValueError("The tier policy must be an object keyed by tier")
    policy = {t: dict(v) for t, v in current.items()}
    for tier, rules in raw.items():
        if tier not in TIERS or not isinstance(rules, dict):
            raise ValueError(f"Unknown tier '{tier}'")
        for key, value in rules.items():
            if key == "template_ids":
                if not isinstance(value, list) or not all(isinstance(i, int) for i in value) or len(value) > 10:
                    raise ValueError("Questionnaires must be a list of at most 10 template ids")
                policy[tier][key] = list(dict.fromkeys(value))
            elif key == "evidence":
                if not isinstance(value, list) or any(k not in EVIDENCE_KINDS for k in value):
                    raise ValueError(f"Evidence must be chosen from: {', '.join(EVIDENCE_KINDS)}")
                policy[tier][key] = list(dict.fromkeys(value))
            elif key == "approver_role":
                name = " ".join(str(value or "").split())[:100]
                policy[tier][key] = name or None
            elif key == "reassess_on":
                if value not in SEVERITIES:
                    raise ValueError(f"Reassess on must be one of: {', '.join(SEVERITIES)}")
                policy[tier][key] = value
            else:
                raise ValueError(f"Unknown tier setting '{key}'")
    return policy


def templates_for(db: Session, tenant_id: int, tier: str, policy: Dict[str, dict]) -> List[VendorQuestionnaireTemplate]:
    """The questionnaires a tier calls for: the tenant's choice, or else the
    built-in templates suggested for the tier, where the tenant has them."""
    ids = policy[_tier(tier)].get("template_ids") or []
    q = db.query(VendorQuestionnaireTemplate).filter(VendorQuestionnaireTemplate.tenant_id == tenant_id)
    if ids:
        found = {t.id: t for t in q.filter(VendorQuestionnaireTemplate.id.in_(ids))}
        return [found[i] for i in ids if i in found]
    names = TIER_SUGGESTED_TEMPLATES.get(_tier(tier), [])
    found = {t.name: t for t in q.filter(VendorQuestionnaireTemplate.name.in_(names or ["-"]))}
    return [found[n] for n in names if n in found]


# ── how the vendor measures up ───────────────────────────────────────────────

def questionnaire_status(db: Session, assessment: VendorAssessment,
                         templates: List[VendorQuestionnaireTemplate]) -> List[dict]:
    sent = {}
    for qr in db.query(VendorQuestionnaireResponse).filter(
            VendorQuestionnaireResponse.assessment_id == assessment.id).order_by(VendorQuestionnaireResponse.id):
        sent[qr.template_id] = qr                      # the latest per template
    out = []
    for t in templates:
        qr = sent.get(t.id)
        out.append({"template_id": t.id, "name": t.name, "response_id": qr.id if qr else None,
                    "status": "unsent" if qr is None else "answered" if qr.status in ANSWERED else "sent"})
    return out


def evidence_status(db: Session, vendor: Vendor, kinds: List[str], today: Optional[date] = None) -> List[dict]:
    """Each piece of evidence the tier asks for, and whether the vendor has it in date."""
    today = today or datetime.utcnow().date()
    tagged: Dict[str, List[dict]] = {}
    for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.vendor_id == vendor.id, TPRAEvidenceLink.deleted_at.is_(None),
                             TPRAEvidenceLink.requirement.isnot(None))):
        expired = ev.expiry_date is not None and ev.expiry_date.date() < today
        if (ev.status or "").lower() in _RETIRED:
            continue
        tagged.setdefault(link.requirement, []).append({
            "link_id": link.id, "evidence_id": ev.id, "name": ev.name, "expired": expired,
            "expiry_date": ev.expiry_date.isoformat() if ev.expiry_date else None,
        })
    return [{"kind": k, "label": EVIDENCE_KINDS[k], "items": tagged.get(k, []),
             "satisfied": any(not i["expired"] for i in tagged.get(k, []))} for k in kinds if k in EVIDENCE_KINDS]


def approver_problem(db: Session, user, tier: str, policy: Dict[str, dict], is_admin: bool = False) -> Optional[str]:
    """Why this person may not approve a vendor of this tier, or None."""
    role = policy[_tier(tier)].get("approver_role")
    if not role or is_admin:
        return None
    holds = (db.query(UserRole.id).join(Role, Role.id == UserRole.role_id)
             .filter(UserRole.user_id == user.id, Role.name == role).first())
    return None if holds else f"A {_tier(tier)}-tier vendor must be approved by someone with the {role} role"


def reassess_threshold(tier: str, policy: Dict[str, dict]) -> str:
    return policy[_tier(tier)].get("reassess_on") or "high"


# ── keeping the tier true ────────────────────────────────────────────────────

def _words(values) -> List[str]:
    return sorted({" ".join(str(v).lower().split()) for v in values or [] if str(v).strip()})


def basis(vendor: Vendor) -> dict:
    """The facts a tier was computed from, kept to notice when they change."""
    return {
        "data_access_level": (vendor.data_access_level or "none").lower(),
        "data_types": _words(vendor.data_types_accessed),
        "locations": _words(vendor.geographic_locations),
        "services": "; ".join(_words(vendor.services_provided if isinstance(vendor.services_provided, list)
                                     else [vendor.services_provided])),
        "at": datetime.utcnow().isoformat(),
    }


def retier_reasons(db: Session, vendor: Vendor, assessment: Optional[VendorAssessment]) -> List[str]:
    """What has changed since the tier was computed. Nothing is reported for a
    tier computed before its basis was recorded: there is nothing to compare."""
    recorded = (assessment.tiering_basis if assessment is not None else None) or {}
    if not recorded:
        return []
    now = basis(vendor)
    reasons = []
    if _ACCESS_RANK.get(now["data_access_level"], 0) > _ACCESS_RANK.get(recorded.get("data_access_level", "none"), 0):
        reasons.append(f"data access went from {recorded.get('data_access_level')} to {now['data_access_level']}")
    new_types = sorted(set(now["data_types"]) - set(recorded.get("data_types") or []))
    if new_types:
        reasons.append(f"now handles {', '.join(new_types)}")
    new_places = sorted(set(now["locations"]) - set(recorded.get("locations") or []))
    if new_places:
        reasons.append(f"now operates in {', '.join(new_places)}")
    if now["services"] and now["services"] != recorded.get("services"):
        reasons.append("the services it provides have changed")
    since = datetime.fromisoformat(recorded["at"]) if recorded.get("at") else None
    if since is not None:
        breach = (db.query(TPRAMonitoringSignal).filter(
            TPRAMonitoringSignal.vendor_id == vendor.id, TPRAMonitoringSignal.deleted_at.is_(None),
            TPRAMonitoringSignal.signal_type == "breach", TPRAMonitoringSignal.occurred_at > since)
            .order_by(TPRAMonitoringSignal.occurred_at.desc()).first())
        if breach is not None:
            reasons.append(f"a breach was reported on {breach.occurred_at:%d %b %Y}")
    return reasons


def requirements(db: Session, vendor: Vendor, assessment: VendorAssessment, config: dict) -> dict:
    """Everything the vendor's tier asks for, and where the vendor stands."""
    policy = merged(config.get("tier_policy"))
    tier = _tier(assessment.inherent_tier or vendor.tier)
    rules = policy[tier]
    return {
        "tier": tier,
        "override": assessment.tier_override or None,
        "retier_reasons": retier_reasons(db, vendor, assessment),
        "cadence_days": cadence_days_for(tier, config.get("cadence_days")),
        "approver_role": rules.get("approver_role"),
        "reassess_on": rules.get("reassess_on"),
        "reviewers": required_reviewers_for(tier),
        "questionnaires": questionnaire_status(db, assessment, templates_for(db, vendor.tenant_id, tier, policy)),
        "evidence": evidence_status(db, vendor, rules.get("evidence") or []),
    }
