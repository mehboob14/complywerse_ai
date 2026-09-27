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


def catalogue() -> dict:
    return {"sections": SECTIONS, "levels": list(LEVELS), "statuses": list(STATUSES), "min_reason": _MIN_REASON}


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
        allowed = [o["value"] for o in question["options"]]
        if value not in allowed:
            raise ValueError(f"must be one of {', '.join(allowed)}")
        return value
    return " ".join(str(value).split())[:2000] or None


def clean(answers, justifications) -> dict:
    """Validate a (possibly partial) intake. Unknown keys are refused, so a typo
    cannot look like a saved answer. Completeness is `problems`' job."""
    out = {"answers": {}, "justifications": {}}
    for key, value in (answers or {}).items():
        question = QUESTIONS.get(key)
        if question is None:
            raise ValueError(f"'{key}' is not an intake question")
        try:
            out["answers"][key] = _clean_value(question, value)
        except ValueError as exc:
            raise ValueError(f"{question['label']} {exc}")
    for key, value in (justifications or {}).items():
        question = QUESTIONS.get(key)
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


def problems(intake: Optional[dict], vendor: Optional[Vendor] = None) -> List[dict]:
    """What stops the request being submitted, one line per question."""
    answers = (intake or {}).get("answers") or {}
    reasons = (intake or {}).get("justifications") or {}
    out = []
    if vendor is not None:
        if not (vendor.name or "").strip():
            out.append({"key": "name", "message": "Give the supplier's name"})
        if vendor.owner_id is None:
            out.append({"key": "owner_id", "message": "Name the business owner"})
    for question in QUESTIONS.values():
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

def factors(intake: Optional[dict]) -> Tuple[Dict[str, float], Dict[str, List[str]]]:
    """The five tiering factors (0..4) the answers imply, and why each is what it is."""
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
    return scores, why


# ── onto the vendor record ───────────────────────────────────────────────────

_ACCESS_RANK = {"none": 0, "public": 1, "internal": 2, "confidential": 3, "restricted": 4, "regulated": 4}
_DATA_TYPES = [("personal_data", "personal data"), ("special_category", "sensitive personal data"),
               ("confidential_data", "confidential business information"),
               ("financial_reporting", "financial reporting data")]


def apply_to_vendor(vendor: Vendor, intake: dict) -> None:
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
        vendor.vendor_type = dict(ENGAGEMENTS).get(a["engagement_type"])
    if not vendor.description and a.get("purpose"):
        vendor.description = a["purpose"]


def fingerprint(vendor: Vendor) -> dict:
    """The answers a tier rests on, recorded with it to notice when they change."""
    a = ((vendor.intake or {}).get("answers") or {})
    return {k: a.get(k) for k, q in QUESTIONS.items() if q["type"] in ("yes_no", "level")}


def changes_since(recorded: dict, vendor: Vendor) -> List[str]:
    """Answers that have moved towards more risk since the tier was computed."""
    now = fingerprint(vendor)
    out = []
    for key, value in now.items():
        before = recorded.get(key)
        label = QUESTIONS[key]["label"].rstrip("?")
        if QUESTIONS[key]["type"] == "yes_no" and value == "yes" and before != "yes":
            out.append(f"now yes: {label.lower()}")
        elif QUESTIONS[key]["type"] == "level" and _LEVEL.get(value or "none", 0) > _LEVEL.get(before or "none", 0):
            out.append(f"{label.lower()} went from {before or 'none'} to {value}")
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
