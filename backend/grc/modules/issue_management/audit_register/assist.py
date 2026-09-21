"""AI Assist for a finding being added by hand.

The person picks the kind of finding and its report and enters what they have:
the issue name, or the finding as the report states it. The model proposes the
columns still empty. Nothing is saved until they apply what they want and add
the finding as usual.

It is kept honest the same way the rest of the register is:
- a list column only ever gets a value the platform already has: the
  template's codes, the Settings lists, the register's own values, business
  units, platform users. Anything else the model says is dropped;
- the model is told never to invent facts, and to leave [placeholders] for
  specifics it was not given;
- the target date is not the model's: it is the report date (today, when that
  would already be past) plus the remediation window Settings gives the rating;
- with no AI key configured it says so, instead of offering canned text.

Only the client's own words and the platform's lists go into the prompt, never
SCF text (the licence guard on the model client refuses any that slips in).
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ....config import get_openai_api_key, get_openai_base_url, get_openai_model
from ....models import AuditIssueProfile, AuditRegisterReport, GRCUser, Issue
from . import template as T

logger = logging.getLogger(__name__)


class AssistUnavailable(RuntimeError):
    """The model cannot answer: no key, or its answer was unusable."""


# The columns AI Assist proposes, and what each one is, for the model. Status,
# validation and progress columns stay with the workflow; dates other than the
# target date, amounts, hosts and locations are facts only the person has.
GUIDE: Dict[str, str] = {
    "title": "a short issue name, under 12 words",
    "issue_text": "the finding stated plainly, as the examiner or auditor would write it",
    "condition": "the condition found, as the auditor would write it",
    "risk_text": "the risk the finding creates for the bank",
    "impact_text": "the impact on the bank if it is not remediated",
    "causes": "likely root causes, 2-4 numbered lines",
    "consequences": "consequences if not remediated, 2-4 numbered lines",
    "counsel": "the auditor's counsel, 1-3 sentences",
    "recommendation_title": "a short recommendation title",
    "recommendation": "the auditor's recommendation, 1-3 sentences",
    "corrective_actions": "the corrective actions the regulator expects, 2-4 numbered lines",
    "management_action_plan": "management's remediation plan, 3-5 numbered steps",
    "management_response": "management's response, 2-3 sentences in management's voice",
    "actions_to_address": "actions taken or planned to address the event, numbered lines",
    "impact_to_client": "the impact on customers, 1-2 sentences",
    "risk_rating": "the risk rating",
    "self_id_category": "Fin (financial), Ops (operational), Reg (regulatory) or IT",
    "it_record_kind": "ISSUE, or VULNERABILITY for a technical weakness a scan or test found",
    "type_of_audit": "the type of audit",
    "remediation_type": "the type of remediation",
    "owner_title": "the owner's title",
    "lob": "the line of business accountable",
    "business_unit": "the business unit accountable",
    "owner": "the person accountable for the remediation",
}
_LIST_KINDS = ("choice", "pick")
_LINE_LIMIT = {"title": 150, "text": 300}
_LONG_LIMIT = 4000
_DIRECTORY_LIMIT = 150
_SIBLINGS = 8

SYSTEM = (
    "You help the audit team at a bank record a finding in their issue register. You propose "
    "values only for the columns you are asked about.\n"
    "Rules:\n"
    "1. A column with allowed values takes exactly one of them, spelled as listed. Leave the "
    "column out when none fits.\n"
    "2. The owner is a user id from the directory. Leave it out when the directory gives no "
    "good reason to pick someone.\n"
    "3. Write text columns in a professional audit register style: concise, specific to this "
    "finding, no preamble. Never invent facts you were not given (names, numbers, dates, "
    "amounts, systems, account counts). Where the text needs a specific you do not have, write "
    "a bracketed placeholder such as [system name] for the team to fill in.\n"
    "4. Write list-like columns (causes, consequences, corrective actions, plan steps) as "
    "numbered lines: \"1. ...\\n2. ...\".\n"
    "5. Give every value a reason of at most 20 words.\n"
    'Return JSON only: {"fields": {"<column>": {"value": "...", "reason": "..."}}}'
)


# ── the model call ───────────────────────────────────────────────────────────

def _configured_key() -> Optional[str]:
    key = get_openai_api_key()
    if not key or key.startswith("_DUMMY") or key == "your-api-key-here" or len(key) < 20:
        return None
    return key


def openai_complete(messages: List[Dict[str, str]]) -> str:
    """Ask the configured model; the platform's client wrapper screens the prompt
    (licence guard) and records usage."""
    key = _configured_key()
    if not key:
        raise AssistUnavailable("AI Assist is not set up on this server: no AI key is configured.")
    from openai import OpenAI

    client = OpenAI(api_key=key, base_url=get_openai_base_url(), timeout=60)
    reply = client.chat.completions.create(
        model=get_openai_model(), temperature=0.2, max_tokens=2000,
        response_format={"type": "json_object"}, messages=messages,
    )
    return reply.choices[0].message.content or ""


def _parse(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1]) if 0 <= start < end else None
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        raise AssistUnavailable("The AI's answer could not be read. Try again.")
    fields = data.get("fields", data)
    return fields if isinstance(fields, dict) else {}


# ── what the platform already knows ──────────────────────────────────────────

def _ownership(db: Session, tenant_id: int) -> Dict[int, Dict[str, Any]]:
    """Per owner: how many register findings they hold, their titles and LOBs."""
    out: Dict[int, Dict[str, Any]] = {}
    rows = (db.query(Issue.owner_id, AuditIssueProfile.owner_title, AuditIssueProfile.lob)
            .join(AuditIssueProfile, AuditIssueProfile.issue_id == Issue.id)
            .filter(AuditIssueProfile.tenant_id == tenant_id, AuditIssueProfile.deleted_at.is_(None),
                    Issue.owner_id.isnot(None)))
    for owner_id, title, lob in rows:
        entry = out.setdefault(owner_id, {"count": 0, "titles": Counter(), "lobs": Counter()})
        entry["count"] += 1
        if title:
            entry["titles"][title.strip()] += 1
        if lob:
            entry["lobs"][lob.strip()] += 1
    return out


def _name(user: GRCUser) -> str:
    return getattr(user, "display_name", None) or user.username


def _directory(users: List[GRCUser], owners: Dict[int, Dict[str, Any]]) -> List[str]:
    ranked = sorted(users, key=lambda u: (-owners.get(u.id, {}).get("count", 0), _name(u).lower()))
    lines = []
    for user in ranked[:_DIRECTORY_LIMIT]:
        held = owners.get(user.id)
        owns = "-"
        if held:
            owns = (f"{held['count']} findings; titles: {', '.join(t for t, _ in held['titles'].most_common(2)) or '-'}"
                    f"; LOBs: {', '.join(l for l, _ in held['lobs'].most_common(3)) or '-'}")
        lines.append(f"{user.id} | {_name(user)} | {user.designation or '-'} | "
                     f"{user.department or user.division or '-'} | {owns}")
    return lines


def _int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _match(value: Any, allowed: List[str]) -> Optional[str]:
    wanted = " ".join(str(value or "").split()).lower()
    return next((a for a in allowed if " ".join(a.split()).lower() == wanted), None) if wanted else None


def _user(value: Any, users: List[GRCUser]) -> Optional[int]:
    wanted = _int(value)
    if wanted is not None:
        return wanted if any(u.id == wanted for u in users) else None
    text = str(value or "").strip().lower()
    found = [u.id for u in users if text and text in (_name(u).lower(), (u.username or "").lower())]
    return found[0] if len(found) == 1 else None


def _long(value: Any) -> str:
    if isinstance(value, list):
        value = "\n".join(f"{i}. {str(v).strip()}" for i, v in enumerate(value, 1) if str(v).strip())
    return str(value or "").strip()[:_LONG_LIMIT]


def _line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


# ── the suggestion ───────────────────────────────────────────────────────────

def suggest(db: Session, tenant_id: int, template_key: str, values: Dict[str, Any], *,
            report_id: Optional[int] = None, today: Optional[date] = None,
            complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> Dict[str, Any]:
    """Values for the empty columns of a finding being added. Saves nothing.

    When the model cannot answer (no key, provider down, unreadable answer)
    the suggestions that need no model still come back, with a notice saying why.
    """
    from ....services.licence_guard import LicenceRestrictedContent
    from .editing import entry_templates, options
    from .settings import get_settings

    today = today or date.today()
    spec = next((t for t in entry_templates(db, tenant_id) if t["key"] == template_key), None)
    if spec is None:
        raise ValueError("unknown finding type")
    fields = {f["name"]: f for f in spec["fields"]}
    given = {k: v for k, v in (values or {}).items() if k in fields and v not in (None, "")}
    # What the person wrote, not what the form filled in for them (codes, Issue #).
    said = " ".join(str(v) for k, v in given.items() if fields[k]["kind"] in ("title", "long"))
    if len(said.strip()) < 3:
        raise ValueError("Type the issue name or paste the finding first. AI Assist works from what you enter.")
    report = None
    if report_id:
        report = (db.query(AuditRegisterReport)
                  .filter(AuditRegisterReport.id == report_id, AuditRegisterReport.tenant_id == tenant_id).first())
        if report is None or report.source != spec["source"]:
            raise ValueError(f"That report is not one of the {spec['label']} reports")

    picks = options(db, tenant_id)["picks"]
    allowed = {n: list(T.CHOICES.get(n, [])) if fields[n]["kind"] == "choice" else list(picks.get(n, []))
               for n in fields if fields[n]["kind"] in _LIST_KINDS}
    asked = [n for n in fields if n in GUIDE and n not in given
             and (fields[n]["kind"] not in _LIST_KINDS or allowed.get(n))]
    users = [u for u in db.query(GRCUser).order_by(GRCUser.id).all() if getattr(u, "is_active", True) is not False]
    owners = _ownership(db, tenant_id)
    names = {u.id: _name(u) for u in users}

    out: Dict[str, Dict[str, Any]] = {}
    dropped: List[str] = []
    notice: Optional[str] = None
    if asked:
        messages = [{"role": "system", "content": SYSTEM},
                    {"role": "user", "content": _prompt(db, tenant_id, spec, fields, given, report, asked,
                                                        allowed, users, owners, names)}]
        try:
            answer = _parse((complete or openai_complete)(messages))
        except AssistUnavailable as exc:
            answer, notice = {}, str(exc)
        except LicenceRestrictedContent:
            answer, notice = {}, ("This text carries licence-restricted control wording, so it was not "
                                  "sent to the AI.")
        except Exception as exc:                  # provider down, timeout, auth, rate limit
            logger.warning("audit register AI Assist failed", exc_info=True)
            answer, notice = {}, f"The AI service did not answer ({type(exc).__name__}). Try again."
        for name, item in answer.items():
            if name not in asked:
                continue                           # a column already filled, or not this sheet's
            value, reason = (item.get("value"), item.get("reason")) if isinstance(item, dict) else (item, None)
            kind = fields[name]["kind"]
            if kind in _LIST_KINDS:
                clean: Any = _match(value, allowed[name])
            elif kind == "user":
                clean = _user(value, users)
            elif kind == "long":
                clean = _long(value)
            else:
                clean = _line(value, _LINE_LIMIT.get(kind, 300))
            if clean in (None, ""):
                if value not in (None, ""):
                    dropped.append(name)           # not a value the platform has
                continue
            out[name] = {"value": clean, "reason": _line(reason, 200), "source": "ai"}

    # The owner's own record says more than the model can about their title and LOB.
    owner_id = _int(given.get("owner") or out.get("owner", {}).get("value"))
    held = owners.get(owner_id) if owner_id else None
    if held:
        for field, bucket, why in (("owner_title", "titles", "title"), ("lob", "lobs", "line of business")):
            usual = held[bucket].most_common(1)[0][0] if held[bucket] else None
            match = _match(usual, picks.get(field, [])) if usual else None
            if field in fields and field not in given and match and (field == "owner_title" or field not in out):
                out[field] = {"value": match, "source": "register",
                              "reason": f"The {why} on {names.get(owner_id, 'their')}'s other findings"}

    if "target_date" in fields and "target_date" not in given:
        rating = given.get("risk_rating") or out.get("risk_rating", {}).get("value")
        days = (get_settings(db, tenant_id).get("target_days") or {}).get(rating) if rating else None
        if days:
            start = report.report_date if report is not None else None
            if start and start + timedelta(days=days) >= today:
                basis = "the report date"
            else:
                start, basis = today, "today"
            out["target_date"] = {"value": (start + timedelta(days=days)).isoformat(), "source": "rule",
                                  "reason": f"{days} days from {basis} for a {rating} finding "
                                            "(Settings → remediation windows)"}

    suggestions = []
    for name in fields:
        if name in out:
            value = out[name]["value"]
            shown = names.get(value, f"User #{value}") if fields[name]["kind"] == "user" else str(value)
            suggestions.append({"field": name, "label": fields[name]["label"], "display": shown, **out[name]})
    return {"suggestions": suggestions, "dropped": sorted(set(dropped)), "notice": notice,
            "model": get_openai_model() if asked and notice is None else None}


def _prompt(db: Session, tenant_id: int, spec: Dict[str, Any], fields: Dict[str, Dict[str, Any]],
            given: Dict[str, Any], report: Optional[AuditRegisterReport], asked: List[str],
            allowed: Dict[str, List[str]], users: List[GRCUser], owners: Dict[int, Dict[str, Any]],
            names: Dict[int, str]) -> str:
    lines = [f"FINDING TYPE: {spec['title']} (the \"{spec['sheet'].strip()}\" sheet"
             f"{', a recommendation' if spec['record_type'] == 'recommendation' else ''})"]
    if report is not None:
        details = [report.source_label, report.report_name or report.project_name,
                   f"#{report.report_number}" if report.report_number else None,
                   report.report_date.isoformat() if report.report_date else None, report.engagement_year]
        lines.append("REPORT: " + " · ".join(str(d) for d in details if d))
    lines.append("\nWHAT THE TEAM HAS ENTERED:")
    for name, value in given.items():
        shown = (f"{names.get(_int(value), value)} (user id {value})" if fields[name]["kind"] == "user"
                 else value)
        lines.append(f"- {fields[name]['label']}: {shown}")
    if report is not None:
        siblings = (db.query(AuditIssueProfile, Issue).join(Issue, Issue.id == AuditIssueProfile.issue_id)
                    .filter(AuditIssueProfile.tenant_id == tenant_id, AuditIssueProfile.source == report.source,
                            AuditIssueProfile.report_key == report.report_key,
                            AuditIssueProfile.deleted_at.is_(None))
                    .order_by(AuditIssueProfile.id).limit(_SIBLINGS).all())
        if siblings:
            lines.append("\nOTHER FINDINGS ON THIS REPORT:")
            for profile, issue in siblings:
                owner = f"{names.get(issue.owner_id)} (user id {issue.owner_id})" if issue.owner_id else "-"
                lines.append(f"- {profile.issue_ref or '-'} · {issue.title} · {profile.risk_rating or '-'} · "
                             f"owner {owner} · LOB {profile.lob or '-'}")
    lines.append("\nCOLUMNS TO PROPOSE (column: what it is):")
    for name in asked:
        entry = f"- {name}: {fields[name]['label']}, {GUIDE[name]}"
        if name in allowed:
            entry += f". Allowed values: {'; '.join(allowed[name][:100])}"
        elif fields[name]["kind"] == "user":
            entry += ". A user id from the directory"
        lines.append(entry)
    if "owner" in asked or "owner_title" in asked:
        lines.append("\nUSER DIRECTORY (id | name | designation | department | what they own in the register):")
        lines.extend(_directory(users, owners))
    return "\n".join(lines)
