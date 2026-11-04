"""Scoping and initiating a Cyber Security assessment: the rules, apart from the database.

An assessment of a technical asset (OWASP ASVS, OWASP Testing, Mobile App Security) and an assessment of a security function (CSIR, CTI, Incident
Management, IT Security Operations) are different engagements. The first is "which application, in which environment, at which level, by whom, under
which rules"; the second is "which function or process, over which period, with whom taking part". Both start with a scope that is written down before
the questions open and that is kept as it was when the assessment began (``features/cyber-assessment-scoping.md``: ISO/IEC 33002, C2M2, NIST SP 800-115,
CBEST/TIBER, PCI penetration-testing guidance).

This module holds what has no need of a database: which formats are which kind, the shape and limits of a scope, what must be filled before the
questionnaire may start, and the plain-text summary of a scope that the AI advice reads. ``scope_router`` does the reading and writing.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ...feature_map import CYBER_SECURITY_FORMATS, HUB_ASSESSMENTS

# ── which assessment is which ────────────────────────────────────────────────────────────────────────────────────
LABELS: Dict[str, str] = dict(HUB_ASSESSMENTS["Cyber Security"])          # format -> "OWASP ASVS", in the hub's order
ORDER: List[str] = [fmt for fmt, _ in HUB_ASSESSMENTS["Cyber Security"]]
SCOPE_MODEL: Dict[str, str] = {
    "asvs_checklist": "asset", "owasp_v4_testing_checklist": "asset", "mobile_app_security": "asset",
    "csir_maturity": "process", "cti_maturity": "process", "incident_maturity": "process", "itsecops_maturity": "process",
}
FAMILY: Dict[str, str] = {"asset": "technical", "process": "process"}
PHASES = ("scoping", "in_progress")
assert set(SCOPE_MODEL) == set(CYBER_SECURITY_FORMATS) == set(LABELS), "the scoping rules and the Cyber Security hub name different assessments"

# ── the shape of a scope ─────────────────────────────────────────────────────────────────────────────────────────
Environment = Literal["production", "staging", "test", "development", "other"]
Trigger = Literal["periodic", "regulatory", "change", "incident", "audit", "third_party", "other"]
AssetRole = Literal["primary", "component", "supporting", "sample", "excluded"]
ParticipantRole = Literal["owner", "contributor", "assessor", "reviewer", "approver", "sponsor", "observer"]
Platform = Literal["android", "ios", "web", "api"]


class _Strict(BaseModel):
    """No key the form does not know, no stray whitespace: a scope is stored as it is read back."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _blank_to_none(value: Any) -> Any:
    return None if isinstance(value, str) and not value.strip() else value


class Exclusion(_Strict):
    what: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=300)


class AssetRef(_Strict):
    asset_id: int
    role: AssetRole = "supporting"
    reason: str = Field(default="", max_length=300)


class Participant(_Strict):
    """Someone who takes part: a person, a team, or an outside party with their organisation (a provider's staff are named as theirs, not as ours)."""
    kind: Literal["user", "team", "external"]
    user_id: Optional[int] = None
    team_id: Optional[int] = None
    name: str = Field(default="", max_length=200)
    organisation: str = Field(default="", max_length=200)
    role: ParticipantRole = "contributor"
    domains: List[str] = Field(default_factory=list, max_length=60)        # the questionnaire's domains they answer (assigned to them on Start); empty = takes part, nothing assigned
    independent: bool = False                                              # outside the team or application being assessed
    note: str = Field(default="", max_length=300)

    @field_validator("user_id", "team_id", mode="before")
    @classmethod
    def _ids(cls, v: Any) -> Any:
        return _blank_to_none(v)

    @field_validator("domains")
    @classmethod
    def _domains(cls, v: List[str]) -> List[str]:
        out = []
        for d in v:
            d = str(d).strip()[:500]
            if d and d not in out:
                out.append(d)
        return out

    @model_validator(mode="after")
    def _who(self) -> "Participant":
        if self.kind == "user" and not self.user_id:
            raise ValueError("choose the person")
        if self.kind == "team" and not self.team_id:
            raise ValueError("choose the team")
        if self.kind == "external" and not (self.name and self.organisation):
            raise ValueError("an outside participant needs a name and their organisation")
        return self


class RulesOfEngagement(_Strict):
    approved_by: str = Field(default="", max_length=200)
    approved_on: Optional[date] = None
    notes: str = Field(default="", max_length=500)

    @field_validator("approved_on", mode="before")
    @classmethod
    def _day(cls, v: Any) -> Any:
        return _blank_to_none(v)


class EvidencePlan(_Strict):
    deadline: Optional[date] = None
    interviews: str = Field(default="", max_length=500)
    records: str = Field(default="", max_length=500)
    sampling: str = Field(default="", max_length=500)

    @field_validator("deadline", mode="before")
    @classmethod
    def _day(cls, v: Any) -> Any:
        return _blank_to_none(v)


class AssetScope(_Strict):
    environment: Optional[Environment] = None
    version: str = Field(default="", max_length=100)                       # application version or build
    level: Optional[int] = Field(default=None, ge=1, le=3)                  # ASVS level; the organisation chooses it by its own risk analysis
    level_reason: str = Field(default="", max_length=500)
    platforms: List[Platform] = Field(default_factory=list, max_length=4)
    test_roles: List[str] = Field(default_factory=list, max_length=20)      # the roles tested with supplied credentials
    window_start: Optional[date] = None
    window_end: Optional[date] = None
    exclusions: List[Exclusion] = Field(default_factory=list, max_length=30)
    intrusive: bool = False
    rules_of_engagement: RulesOfEngagement = Field(default_factory=RulesOfEngagement)
    trigger: Optional[Trigger] = None
    assets: List[AssetRef] = Field(default_factory=list, max_length=50)
    participants: List[Participant] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=2000)

    @field_validator("environment", "level", "trigger", "window_start", "window_end", mode="before")
    @classmethod
    def _blank(cls, v: Any) -> Any:
        return _blank_to_none(v)

    @field_validator("test_roles")
    @classmethod
    def _roles(cls, v: List[str]) -> List[str]:
        return [r.strip()[:100] for r in v if str(r).strip()]

    @model_validator(mode="after")
    def _order(self) -> "AssetScope":
        if self.window_start and self.window_end and self.window_end < self.window_start:
            raise ValueError("the test window ends before it starts")
        return self


class ProcessScope(_Strict):
    organisation: str = Field(default="", max_length=200)
    legal_entity: str = Field(default="", max_length=200)
    business_unit: str = Field(default="", max_length=200)
    function: str = Field(default="", max_length=200)                      # the function or process assessed: "Security Operations Centre"
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    geography: List[str] = Field(default_factory=list, max_length=20)
    services: List[str] = Field(default_factory=list, max_length=30)
    exclusions: List[Exclusion] = Field(default_factory=list, max_length=30)
    trigger: Optional[Trigger] = None
    assets: List[AssetRef] = Field(default_factory=list, max_length=50)     # supporting: the tools and services the function relies on; never scored
    participants: List[Participant] = Field(default_factory=list, max_length=50)
    evidence_plan: EvidencePlan = Field(default_factory=EvidencePlan)
    notes: str = Field(default="", max_length=2000)

    @field_validator("period_start", "period_end", "trigger", mode="before")
    @classmethod
    def _blank(cls, v: Any) -> Any:
        return _blank_to_none(v)

    @field_validator("geography", "services")
    @classmethod
    def _lists(cls, v: List[str]) -> List[str]:
        return [x.strip()[:200] for x in v if str(x).strip()]

    @model_validator(mode="after")
    def _order(self) -> "ProcessScope":
        if self.period_start and self.period_end and self.period_end < self.period_start:
            raise ValueError("the assessment period ends before it starts")
        return self


MODELS = {"asset": AssetScope, "process": ProcessScope}
# what may still change once the questionnaire is open: who takes part and the notes. The subject, environment, level, period and exclusions are what
# the assessment was done on; changing them afterwards is an approved amendment (the next release), never an overwrite.
OPEN_AFTER_START = {"asset": {"participants", "notes"}, "process": {"participants", "notes", "evidence_plan"}}


class ScopeError(ValueError):
    """A scope that cannot be stored: ``errors`` is [{field, message}] for the form to show beside the field."""

    def __init__(self, errors: List[Dict[str, str]]):
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in errors))
        self.errors = errors


def validate_scope(model: str, data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The scope as it is stored: every key present, dates as ISO text; raises ScopeError."""
    try:
        return MODELS[model].model_validate(data or {}).model_dump(mode="json")
    except ValidationError as exc:
        raise ScopeError([{"field": ".".join(str(p) for p in e["loc"]) or "scope", "message": str(e["msg"]).removeprefix("Value error, ")}
                          for e in exc.errors()]) from exc


def merge_scope(current: Optional[Dict[str, Any]], patch: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """A top-level key in the patch replaces the stored one whole (a list or an object is sent complete by the form)."""
    return {**(current or {}), **(patch or {})}


def changed_keys(before: Dict[str, Any], after: Dict[str, Any]) -> List[str]:
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))


def _day(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


# ── what must be filled before the questions open ───────────────────────────────────────────────────────────────
def readiness(model: str, fmt: str, scope: Dict[str, Any], owner_id: Optional[int]) -> Dict[str, Any]:
    """{"ready": bool, "checks": [{key, label, ok, required, hint}]}. Required checks block Start; the others are advice a reviewer would give."""
    s = scope or {}
    people = s.get("participants") or []
    role = lambda r: [p for p in people if p.get("role") == r]              # noqa: E731
    checks: List[Dict[str, Any]] = []

    def add(key: str, label: str, ok: bool, required: bool = True, hint: str = "") -> None:
        checks.append({"key": key, "label": label, "ok": bool(ok), "required": required, "hint": hint})

    if model == "asset":
        primary = [a for a in s.get("assets") or [] if a.get("role") == "primary"]
        production = s.get("environment") == "production" or bool(s.get("intrusive"))
        roe = s.get("rules_of_engagement") or {}
        add("subject", "Application chosen", primary, hint="Pick it from the asset library.")
        add("environment", "Environment set", s.get("environment"), hint="Production, staging, test or development.")
        add("version", "Version or build set", s.get("version"), hint="What exactly is tested: a report must not read as covering other builds.")
        if fmt == "asvs_checklist":
            add("level", "ASVS level chosen", s.get("level"), hint="Level 1 is the minimum; most applications use 2; 3 is for the highest assurance. The organisation decides by its own risk analysis.")
        if fmt == "mobile_app_security":
            add("platforms", "Platform chosen", s.get("platforms"), hint="Android, iOS or both. The mobile client is assessed here; its backend API is assessed separately.")
        add("owner", "Assessment owner named", owner_id, hint="Who runs the assessment.")
        add("application_owner", "Application owner named", role("owner"), hint="Who is accountable for the application and answers for it.")
        add("assessor", "Assessor named", role("assessor"), hint="Who performs the verification and testing.")
        add("rules_of_engagement", "Rules of engagement approved", roe.get("approved_by") and roe.get("approved_on"), required=bool(production),
            hint="Needed before testing in production or any intrusive test: window, contacts, data handling, what to do on finding a compromise.")
        add("window", "Test window set", s.get("window_start") and s.get("window_end"), required=False)
        add("reviewer", "Reviewer named", role("reviewer"), required=False, hint="Someone who reviews the conclusions before they are final.")
        add("independence", "Assessor independent of the application's team", any(p.get("independent") for p in role("assessor")), required=False,
            hint="The person who operates a control should not be the only one who verifies it.")
    else:
        start, end = _day(s.get("period_start")), _day(s.get("period_end"))
        add("function", "Function or process named", s.get("function"), hint="For example the Security Operations Centre or the CSIRT.")
        add("organisation", "Organisation or business unit named", s.get("organisation") or s.get("business_unit"))
        add("period", "Assessment period set", start and end and start <= end, hint="The period whose operation is evaluated.")
        add("owner", "Assessment owner named", owner_id, hint="Who runs the assessment.")
        add("process_owner", "Process owner named", role("owner"), hint="Who is accountable for the function and answers for it.")
        add("sponsor", "Sponsor named", role("sponsor"), required=False, hint="Who approves the scope and receives the result.")
        add("contributors", "At least two contributors", len(role("contributor")) >= 2, required=False,
            hint="A function is rarely answered by one person: add the teams and any outside provider that operate it.")
        add("reviewer", "Independent reviewer named", role("reviewer"), required=False, hint="Someone outside the assessed function who challenges the scores.")
        add("assets", "Supporting assets listed", [a for a in s.get("assets") or [] if a.get("role") != "excluded"], required=False,
            hint="The tools and services the function relies on. They give context to the evidence; they are not scored.")
        add("evidence_plan", "Evidence deadline set", (s.get("evidence_plan") or {}).get("deadline"), required=False)
    return {"ready": all(c["ok"] for c in checks if c["required"]), "checks": checks}


# ── the words the AI advice reads ────────────────────────────────────────────────────────────────────────────────
def _list(items: List[str], cap: int = 8) -> str:
    items = [i for i in items if i]
    return ", ".join(items[:cap]) + (f" and {len(items) - cap} more" if len(items) > cap else "")


def summary_text(model: str, fmt: str, scope: Dict[str, Any], facts: Optional[Dict[int, Dict[str, Any]]] = None) -> str:
    """One paragraph saying what the assessment is of. No person is named (people are counted by role): the AI sees what is assessed, not who answers."""
    s, facts = scope or {}, facts or {}
    name = lambda ref: (facts.get(ref.get("asset_id")) or {}).get("name") or f"asset {ref.get('asset_id')}"    # noqa: E731
    refs = s.get("assets") or []
    out: List[str] = []
    if model == "asset":
        primary = next((r for r in refs if r.get("role") == "primary"), None)
        if primary:
            f = facts.get(primary.get("asset_id")) or {}
            traits = [x for x in (f.get("asset_type"), f"criticality {f['criticality']}" if f.get("criticality") else "",
                                  "internet-facing" if f.get("internet_facing") else "", f"data classification {f['data_classification']}" if f.get("data_classification") else "") if x]
            out.append(f"Subject: {name(primary)}" + (f" ({'; '.join(traits)})" if traits else "") + ".")
        for label, key in (("Environment", "environment"), ("Version or build", "version")):
            if s.get(key):
                out.append(f"{label}: {s[key]}.")
        if s.get("level"):
            out.append(f"ASVS level: {s['level']}" + (f" ({s['level_reason']})" if s.get("level_reason") else "") + ".")
        if s.get("platforms"):
            out.append(f"Platforms: {_list(s['platforms'])}.")
        if s.get("test_roles"):
            out.append(f"Roles tested: {_list(s['test_roles'])}.")
        comps = [name(r) for r in refs if r.get("role") in ("component", "supporting", "sample")]
        if comps:
            out.append(f"Related assets in scope: {_list(comps)}.")
        excluded = [name(r) for r in refs if r.get("role") == "excluded"] + [e.get("what", "") for e in s.get("exclusions") or []]
        if any(excluded):
            out.append(f"Excluded: {_list(excluded)}.")
        if s.get("window_start") and s.get("window_end"):
            out.append(f"Test window: {s['window_start']} to {s['window_end']}.")
        assessors = [p for p in s.get("participants") or [] if p.get("role") == "assessor"]
        if assessors:
            # only what was recorded: an assessor not marked independent is not thereby known to be part of the team
            out.append("The assessor is independent of the application's team." if any(p.get("independent") for p in assessors)
                       else "The assessor's independence of the application's team is not recorded.")
    else:
        where = _list([s.get("business_unit"), s.get("organisation")], 2)
        out.append(f"Subject: the function or process \"{s.get('function') or 'unnamed'}\"" + (f" of {where}" if where else "") + ".")
        if s.get("period_start") and s.get("period_end"):
            out.append(f"Assessment period: {s['period_start']} to {s['period_end']}.")
        if s.get("services"):
            out.append(f"Services in scope: {_list(s['services'])}.")
        if s.get("geography"):
            out.append(f"Sites or jurisdictions: {_list(s['geography'])}.")
        support = [name(r) for r in refs if r.get("role") != "excluded"]
        if support:
            out.append(f"Supporting assets (context for the evidence, not scored): {_list(support)}.")
        excluded = [e.get("what", "") for e in s.get("exclusions") or []]
        if any(excluded):
            out.append(f"Excluded: {_list(excluded)}.")
        by_role: Dict[str, int] = {}
        external = 0
        for p in s.get("participants") or []:
            by_role[p.get("role", "contributor")] = by_role.get(p.get("role", "contributor"), 0) + 1
            external += 1 if p.get("kind") == "external" else 0
        if by_role:
            out.append("Taking part: " + ", ".join(f"{n} {r}" for r, n in sorted(by_role.items())) + (f" ({external} from outside providers, whose capability is not the organisation's own)" if external else "") + ".")
    return " ".join(out)[:1500]


_ASVS_LEVEL = re.compile(r"ASVS Level:\s*([0-9]+)", re.I)
_PLATFORM = re.compile(r"Platform:\s*([^|]+)", re.I)
_PLATFORM_KEY = {"android": "android", "ios": "ios"}


def not_applicable(fmt: str, scope: Dict[str, Any], remarks: Optional[str]) -> Optional[str]:
    """Why a requirement does not apply to this assessment, from the scope alone: the reason a report must record for an N/A requirement.
    An ASVS requirement belongs to its level and every level above it (level 2 includes level 1); a mobile requirement is written once per platform."""
    text = remarks or ""
    if fmt == "asvs_checklist" and scope.get("level"):
        found = _ASVS_LEVEL.search(text)
        if found and int(found.group(1)) > int(scope["level"]):
            return f"Outside the selected ASVS level {scope['level']}."
    if fmt == "mobile_app_security" and scope.get("platforms"):
        found = _PLATFORM.search(text)
        key = _PLATFORM_KEY.get(found.group(1).strip().lower()) if found else None
        if key and key not in scope["platforms"]:
            return f"{found.group(1).strip()} is not in scope."
    return None


ANSWERING_ROLES = ("owner", "contributor", "assessor")


def assignment_targets(participants: List[Dict[str, Any]], domain: Optional[str]) -> List[Dict[str, Any]]:
    """The people and teams (not outside parties) that answer questions of ``domain``: those who answer, and listed it. Written onto the items as the
    assessment starts, through the assignees every item already has. Someone who listed no domain takes part without being assigned anything."""
    out = []
    for p in participants or []:
        if p.get("kind") not in ("user", "team") or p.get("role") not in ANSWERING_ROLES or (domain or "") not in (p.get("domains") or []):
            continue
        ident = p.get("user_id") if p["kind"] == "user" else p.get("team_id")
        if ident:
            out.append({"type": p["kind"], "id": int(ident)})
    return out
