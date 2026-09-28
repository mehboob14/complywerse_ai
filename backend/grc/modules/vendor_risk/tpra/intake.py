"""A vendor asked for, not just a vendor added: the onboarding request.

Anyone who needs a new supplier raises a request and answers the questions
below. The TPRM team reviews it, which starts the lifecycle with the answers
already in, and the approval gate decides it. The answers are the facts tiering
needs, so they set the five tiering factors directly instead of someone scoring
"data sensitivity" by feel.

A yes to an exposure question needs a sentence saying why: a bare yes is the
answer reviewers most often send back.

Status: draft → submitted → in_review → approved | rejected. The vendor record
stays "requested" until the review starts, so monitoring, reminders and the
attention queue leave it alone until then.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from ....models import Vendor

STATUSES = ("draft", "submitted", "in_review", "approved", "rejected")
VENDOR_STATUS = {"draft": "requested", "submitted": "requested", "in_review": "onboarding",
                 "approved": "active", "rejected": "rejected"}
LEVELS = ("none", "low", "moderate", "high", "severe")
_LEVEL = {k: i for i, k in enumerate(LEVELS)}
ENGAGEMENTS = [
    ("saas", "Software as a service"), ("software", "Software we install"),
    ("services", "Professional services"), ("infrastructure", "Hosting or infrastructure"),
    ("outsourcing", "Outsourced business process"), ("hardware", "Hardware"), ("other", "Other"),
]
_MIN_REASON = 10

# One list, three sections. `justify`: a yes needs a reason. `show_if`: asked
# only when another answer is yes.
SECTIONS: List[dict] = [
    {"key": "relationship", "title": "The relationship", "questions": [
        {"key": "engagement_type", "type": "choice", "required": True, "label": "What are we buying?",
         "options": [{"value": v, "label": lbl} for v, lbl in ENGAGEMENTS]},
        {"key": "purpose", "type": "text", "required": True,
         "label": "What will they do for us, and which team needs it?"},
        {"key": "expected_start", "type": "date", "label": "When do we need them from?"},
        {"key": "users_count", "type": "number", "label": "About how many of our people will use it?"},
        {"key": "nda_signed", "type": "yes_no", "label": "Is a non-disclosure agreement already signed?"},
        {"key": "alternatives", "type": "text", "label": "Other suppliers considered"},
    ]},
    {"key": "data", "title": "Data and access", "questions": [
        {"key": "personal_data", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they handle personal information about customers or staff?"},
        {"key": "personal_records", "type": "number", "show_if": "personal_data",
         "label": "Roughly how many people's records?"},
        {"key": "special_category", "type": "yes_no", "justify": True, "show_if": "personal_data",
         "label": "Is any of it health, biometric, account or other sensitive personal data?"},
        {"key": "confidential_data", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they see our confidential business information?"},
        {"key": "financial_reporting", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they touch data behind our financial statements?"},
        {"key": "cross_border", "type": "yes_no", "required": True, "justify": True,
         "label": "Will our data leave the country or region where we keep it?"},
        {"key": "hosts_data", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they store or host our data on their systems?"},
        {"key": "network_access", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they connect to our network or internal systems?"},
        {"key": "source_code", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they see or change our source code?"},
        {"key": "uses_ai", "type": "yes_no", "required": True, "justify": True,
         "label": "Will they put our data through AI or machine-learning services?"},
        {"key": "sso", "type": "yes_no", "label": "Does their service support single sign-on (SAML or OIDC)?"},
    ]},
    {"key": "impact", "title": "If something went wrong", "questions": [
        {"key": "critical_function", "type": "yes_no", "required": True, "justify": True,
         "label": "Does a critical business service depend on them?"},
        {"key": "impact_disclosure", "type": "level", "required": True,
         "label": "Harm if our data held by them were exposed"},
        {"key": "impact_alteration", "type": "level", "required": True,
         "label": "Harm if data or transactions they handle were changed"},
        {"key": "impact_outage", "type": "level", "required": True,
         "label": "Harm if their service stopped for a day"},
        {"key": "impact_notes", "type": "text", "label": "Anything else the reviewers should know"},
    ]},
]
QUESTIONS: Dict[str, dict] = {q["key"]: q for s in SECTIONS for q in s["questions"]}
TYPES = ("yes_no", "choice", "multi_choice", "level", "number", "date", "text")


def spec(custom: Optional[dict] = None) -> dict:
    """The questions as this tenant asks them (tpra/customisation.py).

    `sections` are in order with the questions to ask, hidden and removed ones
    left out. `questions` holds every question by key, hidden and removed ones
    too, because answers already given still need a name and a type."""
    c = custom if isinstance(custom, dict) else {}
    over = c.get("builtin") if isinstance(c.get("builtin"), dict) else {}
    titles = c.get("builtin_sections") if isinstance(c.get("builtin_sections"), dict) else {}
    sections, every = [], {}
    for s in SECTIONS:
        asked = []
        for q in s["questions"]:
            change = over.get(q["key"]) or {}
            merged = {**q, **{k: change[k] for k in ("label", "help", "required", "options", "evidence") if k in change},
                      "section": s["key"], "builtin": True, "hidden": bool(change.get("hidden"))}
            every[q["key"]] = merged
            if not merged["hidden"]:
                asked.append(merged)
        sections.append({"key": s["key"], "title": (titles.get(s["key"]) or {}).get("title") or s["title"],
                         "builtin": True, "questions": asked})
    for s in c.get("sections") or []:
        if not s.get("archived"):
            sections.append({"key": s["key"], "title": s["title"], "builtin": False, "questions": []})
    where = {s["key"]: s for s in sections}
    for q in sorted(c.get("questions") or [], key=lambda q: (q.get("order") or 0, q["key"])):
        merged = {**q, "builtin": False}
        every[q["key"]] = merged
        if not q.get("archived") and q.get("section") in where:
            where[q["section"]]["questions"].append(merged)
    return {"sections": sections, "questions": every}


def catalogue(custom: Optional[dict] = None) -> dict:
    return {"sections": spec(custom)["sections"], "levels": list(LEVELS), "statuses": list(STATUSES),
            "min_reason": _MIN_REASON}


# ── cleaning ─────────────────────────────────────────────────────────────────

def _yes_no(value) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return "yes" if value else "no"
    text = str(value).strip().lower()
    if text in ("yes", "y", "true", "1"):
        return "yes"
    if text in ("no", "n", "false", "0"):
        return "no"
    raise ValueError("must be yes or no")


def _clean_value(question: dict, value):
    kind = question["type"]
    if kind == "yes_no":
        return _yes_no(value)
    if value in (None, ""):
        return None
    if kind == "level":
        text = str(value).strip().lower()
        if text not in _LEVEL:
            raise ValueError(f"must be one of {', '.join(LEVELS)}")
        return text
    if kind == "number":
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            raise ValueError("must be a whole number")
        if not 0 <= number <= 10_000_000_000:
            raise ValueError("is out of range")
        return number
    if kind == "date":
        text = str(value).strip()[:10]
        datetime.strptime(text, "%Y-%m-%d")
        return text
    if kind == "choice":
        allowed = [o["value"] for o in question["options"] if not o.get("archived")]
        if value not in allowed:
            raise ValueError(f"must be one of {', '.join(allowed)}")
        return value
    if kind == "multi_choice":
        allowed = [o["value"] for o in question["options"] if not o.get("archived")]
        picked = []
        for item in value if isinstance(value, list) else [value]:
            if item not in allowed:
                raise ValueError(f"must be chosen from {', '.join(allowed)}")
            if item not in picked:
                picked.append(item)
        return picked or None
    return " ".join(str(value).split())[:2000] or None


def clean(answers, justifications, custom: Optional[dict] = None) -> dict:
    """Validate a (possibly partial) intake. Unknown keys are refused, so a typo
    cannot look like a saved answer. Completeness is `problems`' job."""
    every = spec(custom)["questions"]
    out = {"answers": {}, "justifications": {}}
    for key, value in (answers or {}).items():
        question = every.get(key)
        if question is None:
            raise ValueError(f"'{key}' is not an intake question")
        if question.get("archived"):
            raise ValueError(f"'{question['label']}' has been taken off the form")
        try:
            out["answers"][key] = _clean_value(question, value)
        except ValueError as exc:
            raise ValueError(f"{question['label']} {exc}")
    for key, value in (justifications or {}).items():
        question = every.get(key)
        if question is None or not question.get("justify"):
            raise ValueError(f"'{key}' does not take a reason")
        out["justifications"][key] = " ".join(str(value or "").split())[:1000]
    return out


def merge(current: Optional[dict], patch: dict) -> dict:
    now = current or {}
    return {"answers": {**(now.get("answers") or {}), **patch["answers"]},
            "justifications": {**(now.get("justifications") or {}), **patch["justifications"]}}


def _asked(question: dict, answers: dict) -> bool:
    gate = question.get("show_if")
    return not gate or answers.get(gate) == "yes"


def problems(intake: Optional[dict], vendor: Optional[Vendor] = None, custom: Optional[dict] = None) -> List[dict]:
    """What stops the request being submitted, one line per question asked."""
    answers = (intake or {}).get("answers") or {}
    reasons = (intake or {}).get("justifications") or {}
    out = []
    if vendor is not None:
        if not (vendor.name or "").strip():
            out.append({"key": "name", "message": "Give the supplier's name"})
        if vendor.owner_id is None:
            out.append({"key": "owner_id", "message": "Name the business owner"})
    for question in (q for s in spec(custom)["sections"] for q in s["questions"]):
        if not _asked(question, answers):
            continue
        value = answers.get(question["key"])
        if question.get("required") and value in (None, ""):
            out.append({"key": question["key"], "message": f"Answer: {question['label']}"})
        elif question.get("justify") and value == "yes" and len(reasons.get(question["key"]) or "") < _MIN_REASON:
            out.append({"key": question["key"], "message": f"Say why: {question['label']}"})
    return out


def has_answers(intake: Optional[dict]) -> bool:
    return any(v not in (None, "") for v in ((intake or {}).get("answers") or {}).values())


# ── the factors ──────────────────────────────────────────────────────────────

def _answer_points(q: dict, value) -> Tuple[int, str]:
    """What one answer to a tenant's own question adds to its factor, and why."""
    name = q["label"].rstrip("?")
    if q["type"] == "yes_no":
        return (int(q.get("points") or 0), f"{name}: yes") if value == "yes" else (0, "")
    if q["type"] == "level":
        n = _LEVEL.get(value or "none", 0)
        return (n, f"{name}: {value}") if n else (0, "")
    options = {o["value"]: o for o in q.get("options") or []}
    picked = [options[v] for v in (value if isinstance(value, list) else [value]) if v in options]
    best = max(picked, key=lambda o: o.get("points") or 0, default=None)
    return (int(best.get("points") or 0), f"{name}: {best['label']}") if best else (0, "")


def factors(intake: Optional[dict], custom: Optional[dict] = None) -> Tuple[Dict[str, float], Dict[str, List[str]]]:
    """The tiering factors (0..4) the answers imply, and why each is what it is:
    the five built-in ones from the built-in questions, then whatever the
    tenant's own questions add, to built-in factors or to its own."""
    a = (intake or {}).get("answers") or {}
    yes = lambda key: a.get(key) == "yes"  # noqa: E731
    level = lambda key: _LEVEL.get(a.get(key) or "none", 0)  # noqa: E731
    scores = {k: 0.0 for k in ("data_sensitivity", "business_criticality", "system_access",
                                "regulatory_scope", "fourth_party")}
    why: Dict[str, List[str]] = {k: [] for k in scores}

    def raise_to(factor, value, reason):
        if value > 0:
            why[factor].append(reason)
        scores[factor] = max(scores[factor], float(min(4, value)))

    if yes("personal_data"):
        raise_to("data_sensitivity", 3, "handles personal information")
        if yes("special_category"):
            raise_to("data_sensitivity", 4, "includes sensitive personal data")
        if (a.get("personal_records") or 0) >= 100_000:
            raise_to("data_sensitivity", 4, f"about {a['personal_records']:,} people's records")
    if yes("confidential_data"):
        raise_to("data_sensitivity", 3, "sees our confidential information")
    if yes("financial_reporting"):
        raise_to("data_sensitivity", 3, "touches financial reporting data")
    if level("impact_disclosure"):
        raise_to("data_sensitivity", level("impact_disclosure"), f"{a['impact_disclosure']} harm if exposed")

    if yes("critical_function"):
        raise_to("business_criticality", 4, "a critical service depends on them")
    if level("impact_outage"):
        raise_to("business_criticality", level("impact_outage"), f"{a['impact_outage']} harm if they stop")
    if level("impact_alteration"):
        raise_to("business_criticality", level("impact_alteration"), f"{a['impact_alteration']} harm if data is changed")
    users = a.get("users_count") or 0
    if users >= 1000:
        raise_to("business_criticality", 3, f"{users:,} of our people use it")
    elif users >= 100:
        raise_to("business_criticality", 2, f"{users:,} of our people use it")

    if yes("network_access"):
        raise_to("system_access", 4, "connects to our network")
    if yes("source_code"):
        raise_to("system_access", 4, "sees or changes our source code")
    if yes("hosts_data"):
        raise_to("system_access", 3, "hosts our data")
    engagement = a.get("engagement_type")
    if engagement in ("saas", "infrastructure", "outsourcing"):
        raise_to("system_access", 2, "runs a service for us")
    elif engagement:
        raise_to("system_access", 1, "supplies us")

    regulatory = 0
    if yes("personal_data"):
        regulatory += 2
        why["regulatory_scope"].append("privacy law applies")
        if yes("special_category"):
            regulatory += 1
            why["regulatory_scope"].append("sensitive data rules apply")
    if yes("cross_border"):
        regulatory += 1
        why["regulatory_scope"].append("data crosses borders")
    if yes("financial_reporting"):
        regulatory += 1
        why["regulatory_scope"].append("financial reporting controls apply")
    scores["regulatory_scope"] = float(min(4, regulatory))

    if engagement == "outsourcing":
        raise_to("fourth_party", 3, "an outsourced process usually has its own suppliers")
    if yes("uses_ai"):
        raise_to("fourth_party", 2, "sends our data to AI providers")
    if yes("hosts_data") and engagement in ("saas", "infrastructure"):
        raise_to("fourth_party", 2, "runs on someone else's cloud")

    c = custom if isinstance(custom, dict) else {}
    for f in c.get("factors") or []:
        if not f.get("archived"):
            scores.setdefault(f["key"], 0.0)
            why.setdefault(f["key"], [])
    for q in spec(custom)["questions"].values():
        if q.get("builtin") or q.get("archived") or q.get("factor") not in scores or not _asked(q, a):
            continue
        points, reason = _answer_points(q, a.get(q["key"]))
        if points:
            raise_to(q["factor"], points, reason)
    return scores, why


def evidence_asked(intake: Optional[dict], custom: Optional[dict] = None) -> List[Tuple[str, str]]:
    """Evidence the answers ask the supplier for, beyond what the tier asks:
    (evidence type, the question whose yes asked for it)."""
    a = (intake or {}).get("answers") or {}
    return [(q["evidence"], q["label"]) for q in spec(custom)["questions"].values()
            if q.get("evidence") and q["type"] == "yes_no" and not q.get("archived") and not q.get("hidden")
            and _asked(q, a) and a.get(q["key"]) == "yes"]


# ── onto the vendor record ───────────────────────────────────────────────────

_ACCESS_RANK = {"none": 0, "public": 1, "internal": 2, "confidential": 3, "restricted": 4, "regulated": 4}
_DATA_TYPES = [("personal_data", "personal data"), ("special_category", "sensitive personal data"),
               ("confidential_data", "confidential business information"),
               ("financial_reporting", "financial reporting data")]


def apply_to_vendor(vendor: Vendor, intake: dict, custom: Optional[dict] = None) -> None:
    """Carry the answers onto the fields the rest of the programme reads (the
    intake gate, re-tier detection, reports). Data access only ever goes up here:
    a lower answer is for a reviewer to accept, not for a form to quietly apply."""
    a = intake.get("answers") or {}
    if a.get("special_category") == "yes" or (a.get("personal_records") or 0) >= 100_000:
        wanted = "restricted"
    elif any(a.get(k) == "yes" for k in ("personal_data", "confidential_data", "financial_reporting")):
        wanted = "confidential"
    elif any(a.get(k) == "yes" for k in ("hosts_data", "network_access", "source_code")):
        wanted = "internal"
    else:
        wanted = None
    current = (vendor.data_access_level or "none").lower()
    if wanted and _ACCESS_RANK[wanted] > _ACCESS_RANK.get(current, 0):
        vendor.data_access_level = wanted
    types = list(vendor.data_types_accessed or [])
    for key, label in _DATA_TYPES:
        if a.get(key) == "yes" and label not in types:
            types.append(label)
    vendor.data_types_accessed = types
    if not vendor.vendor_type and a.get("engagement_type"):
        named = {o["value"]: o["label"] for o in spec(custom)["questions"]["engagement_type"].get("options") or []}
        vendor.vendor_type = named.get(a["engagement_type"]) or dict(ENGAGEMENTS).get(a["engagement_type"])
    if not vendor.description and a.get("purpose"):
        vendor.description = a["purpose"]


def fingerprint(vendor: Vendor, custom: Optional[dict] = None) -> dict:
    """The answers a tier rests on, recorded with it to notice when they change:
    the built-in yes/no and level answers, and the tenant's own scored ones."""
    a = ((vendor.intake or {}).get("answers") or {})
    return {k: a.get(k) for k, q in spec(custom)["questions"].items()
            if (q.get("builtin") and q["type"] in ("yes_no", "level")) or (not q.get("builtin") and q.get("factor"))}


def changes_since(recorded: dict, vendor: Vendor, custom: Optional[dict] = None) -> List[str]:
    """Answers that have moved towards more risk since the tier was computed."""
    every = spec(custom)["questions"]
    out = []
    for key, value in fingerprint(vendor, custom).items():
        before = recorded.get(key)
        q = every[key]
        label = q["label"].rstrip("?")
        if q["type"] == "yes_no" and value == "yes" and before != "yes":
            out.append(f"now yes: {label.lower()}")
        elif q["type"] == "level" and _LEVEL.get(value or "none", 0) > _LEVEL.get(before or "none", 0):
            out.append(f"{label.lower()} went from {before or 'none'} to {value}")
        elif q["type"] in ("choice", "multi_choice") and _answer_points(q, value)[0] > _answer_points(q, before)[0]:
            out.append(f"{label.lower()} changed to {_answer_points(q, value)[1].split(': ', 1)[-1]}")
    return out


# ── status ───────────────────────────────────────────────────────────────────

def set_status(vendor: Vendor, status: str) -> None:
    vendor.intake_status = status
    wanted = VENDOR_STATUS[status]
    # A vendor already in use keeps its status; only a request's record moves.
    if (vendor.status or "requested") in ("requested", "onboarding", "rejected") or status == "draft":
        vendor.status = wanted


def next_statuses(status: Optional[str]) -> Tuple[str, ...]:
    return {"draft": ("submitted",), "submitted": ("in_review", "rejected", "draft"),
            "in_review": ("approved", "rejected"), "rejected": ("draft",), "approved": ()}.get(status or "", ())


def host(website: Optional[str]) -> str:
    text = (website or "").strip().lower()
    text = re.sub(r"^[a-z]+://", "", text)
    return text.split("/")[0].removeprefix("www.")


def mine(vendor: Vendor, user_id: int) -> bool:
    return user_id in {vendor.requested_by, vendor.owner_id, *(vendor.stakeholder_ids or [])}
