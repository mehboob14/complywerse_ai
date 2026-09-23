"""AI evidence recommendations for one assessment item.

What evidence would prove the item, how to collect each piece, and which
records already in the tenant's Evidence library fit it — so the assessor can
link those in one click instead of uploading again. Serves every compliance
assessment; the Cyber Security hub's OWASP ASVS, OWASP testing, mobile (MASVS)
and CREST-style maturity items get guidance written for their kind of item.

Library matches are honest the same way the rest of the platform's AI is: the
records are shortlisted here by the words they share with the item, the model
may only pick from that shortlist, and any id it invents is dropped. Records
already linked to the item are left out. Only the item's own text and the
records' names and summaries go into the prompt; the model client's licence
guard refuses SCF text should any slip in.
"""
from __future__ import annotations

import json
import logging
import math
import re
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ..config import get_openai_api_key, get_openai_base_url, get_openai_model
from ..models import AssessmentItemEvidence, ComplianceAssessmentDocumentItem, Evidence

logger = logging.getLogger(__name__)


class AIUnavailable(RuntimeError):
    """No AI key is configured on this server."""


# What each kind of item is, so the evidence asked for fits it.
FORMAT_GUIDE: Dict[str, str] = {
    "asvs_checklist": (
        "an OWASP ASVS verification requirement for a web application. Evidence proves the "
        "requirement is verified: configuration, code or test results, scanner output, design docs"),
    "owasp_v4_testing_checklist": (
        "an OWASP Web Security Testing Guide test case. Evidence is the test itself: the tool "
        "output, requests and responses, screenshots and the tester's result for this test"),
    "mobile_app_security": (
        "an OWASP MASVS mobile application security requirement. Evidence covers the app build, "
        "its configuration, static/dynamic test results and the platform settings it relies on"),
    "csir_maturity": (
        "a cyber security incident response maturity question on a CMMI 1-5 scale. Evidence shows "
        "the capability is operating at the stated level: procedures, records, metrics, reviews"),
    "cti_maturity": (
        "a cyber threat intelligence maturity question on a CMMI 1-5 scale. Evidence shows the "
        "intelligence capability operating: requirements, sources, products, feedback records"),
    "incident_maturity": (
        "an incident management maturity question on a CMMI 1-5 scale. Evidence shows the "
        "process operating: playbooks, tickets, post-incident reviews, metrics"),
    "itsecops_maturity": (
        "an IT security operations maturity question on a CMMI 1-5 scale. Evidence shows the "
        "operation running: runbooks, monitoring, tickets, reports, KPIs"),
    "digital_ops_maturity": (
        "a digital operations maturity question on a CMMI 1-5 scale. Evidence shows the "
        "practice operating: procedures, records, metrics, reviews"),
}

SYSTEM = (
    "You are a cyber security and compliance assessor. You recommend the evidence that proves one "
    "assessment item and say how to collect it. Be specific to the item, never generic. Pick existing "
    "evidence only from the list you are given, by its id, and only when it genuinely supports the "
    "item; choosing none is fine. Return JSON only."
)

_WORD = re.compile(r"[a-z][a-z0-9]{2,}")
_STOP = {
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "all", "any", "not", "use", "used",
    "shall", "should", "must", "will", "can", "may", "has", "have", "its", "their", "which", "when", "where",
    "evidence", "document", "documents", "file", "files", "pdf", "docx", "xlsx", "png", "jpg", "copy",
    "verify", "ensure", "ensures", "application", "level", "asvs", "cwe", "nist", "owasp", "target",
    "weighting", "dimension", "security", "control", "controls", "requirement", "requirements",
}
_SHORTLIST = 12
_SKIP_STATUSES = {"rejected", "archived", "deleted"}


def _terms(*texts: Any) -> set:
    return {w for w in _WORD.findall(" ".join(str(t or "") for t in texts).lower()) if w not in _STOP}


def shortlist_existing(db: Session, item: ComplianceAssessmentDocumentItem,
                       limit: int = _SHORTLIST) -> List[Evidence]:
    """Library records sharing the most distinctive words with the item, not yet linked to it."""
    wanted = _terms(item.control_description, item.area_domain, item.subdomain_name, item.gaps_identified)
    if not wanted:
        return []
    linked = {eid for (eid,) in db.query(AssessmentItemEvidence.evidence_id)
              .filter(AssessmentItemEvidence.assessment_item_id == item.id)}
    scored = []
    for ev in (db.query(Evidence).filter(Evidence.tenant_id == item.tenant_id)
               .order_by(Evidence.id.desc()).limit(3000)):
        if ev.id in linked or str(ev.status or "").lower() in _SKIP_STATUSES:
            continue
        have = _terms(ev.name, ev.description, ev.evidence_type, ev.file_name, ev.content_summary)
        shared = wanted & have
        if shared:
            scored.append((len(shared) / math.sqrt(len(have)), ev.id, ev))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [ev for _score, _id, ev in scored[:limit]]


def _configured_key() -> Optional[str]:
    key = get_openai_api_key()
    if not key or key.startswith("_DUMMY") or key == "your-api-key-here" or len(key) < 20:
        return None
    return key


def openai_complete(messages: List[Dict[str, str]]) -> str:
    key = _configured_key()
    if not key:
        raise AIUnavailable("AI isn't set up on this server: no AI key is configured.")
    from openai import OpenAI

    client = OpenAI(api_key=key, base_url=get_openai_base_url(), timeout=60)
    reply = client.chat.completions.create(
        model=get_openai_model(), temperature=0.3, max_tokens=1800,
        response_format={"type": "json_object"}, messages=messages,
    )
    return reply.choices[0].message.content or ""


def _parse(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1]) if 0 <= start < end else {}
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def build_prompt(item: ComplianceAssessmentDocumentItem, candidates: List[Evidence]) -> str:
    assessment = getattr(item, "assessment", None)
    fmt = getattr(assessment, "assessment_format", None) or ""
    lines = [
        f"ASSESSMENT: {getattr(assessment, 'name', None) or 'Assessment'}"
        + (f" — each item is {FORMAT_GUIDE[fmt]}." if fmt in FORMAT_GUIDE else ""),
        f"ITEM: {item.item_number or '-'}",
        f"DOMAIN: {' / '.join(x for x in (item.area_domain, item.subdomain_name) if x) or '-'}",
        f"REQUIREMENT: {_text(item.control_description, 2000) or '-'}",
    ]
    if item.remarks:
        lines.append(f"DETAILS: {_text(item.remarks, 500)}")
    status = item.compliance_status or "-"
    if item.maturity_score:
        status += f"; current maturity L{item.maturity_score}"
    lines.append(f"CURRENT STATUS: {status}")
    if item.gaps_identified:
        lines.append(f"GAPS NOTED: {_text(item.gaps_identified, 600)}")
    lines.append("\nEXISTING EVIDENCE IN THE LIBRARY (id | name | type | summary):")
    if candidates:
        for ev in candidates:
            summary = _text(ev.content_summary or ev.description, 180)
            lines.append(f"- {ev.id} | {_text(ev.name, 120)} | {ev.evidence_type or '-'} | {summary or '-'}")
    else:
        lines.append("- none")
    lines.append(
        "\nReturn JSON: {\"summary\": \"one or two sentences on what proves this item\", "
        "\"recommendations\": [{\"evidence_type\": \"short name, e.g. MFA configuration export\", "
        "\"description\": \"what it must show for THIS item\", \"how_to_collect\": \"where and how to get "
        "it: the system, report, export or screen\", \"priority\": \"high|medium|low\", "
        "\"example_files\": [\"file names\"]}], \"matches\": [{\"evidence_id\": 0, \"reason\": \"why it "
        "supports this item\", \"confidence\": 0.0}]}. Give 3-5 recommendations, most important first."
    )
    return "\n".join(lines)


def recommend_evidence(db: Session, item: ComplianceAssessmentDocumentItem,
                       complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> Dict[str, Any]:
    """The recommendation for one item; the caller stores it on the item."""
    candidates = shortlist_existing(db, item)
    answer = _parse((complete or openai_complete)([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": build_prompt(item, candidates)},
    ]))

    recommendations = []
    for rec in (answer.get("recommendations") or [])[:6]:
        if not isinstance(rec, dict) or not _text(rec.get("evidence_type") or rec.get("description"), 10):
            continue
        priority = str(rec.get("priority") or "").lower()
        files = rec.get("example_files") if isinstance(rec.get("example_files"), list) else []
        recommendations.append({
            "evidence_type": _text(rec.get("evidence_type"), 120) or "Evidence",
            "description": _text(rec.get("description"), 800),
            "how_to_collect": _text(rec.get("how_to_collect"), 600),
            "priority": priority if priority in {"high", "medium", "low"} else "medium",
            "example_files": [_text(f, 80) for f in files if _text(f, 80)][:4],
        })

    by_id = {ev.id: ev for ev in candidates}
    matches, seen = [], set()
    for match in answer.get("matches") or []:
        if not isinstance(match, dict):
            continue
        try:
            evidence_id = int(match.get("evidence_id"))
        except (TypeError, ValueError):
            continue
        ev = by_id.get(evidence_id)
        if ev is None or evidence_id in seen:
            continue                                   # not a record we showed the model
        seen.add(evidence_id)
        try:
            confidence = max(0.0, min(1.0, float(match.get("confidence") or 0)))
        except (TypeError, ValueError):
            confidence = 0.0
        matches.append({
            "evidence_id": ev.id, "name": ev.name, "file_name": ev.file_name, "evidence_type": ev.evidence_type,
            "status": ev.status, "reason": _text(match.get("reason"), 240), "confidence": round(confidence, 2),
        })
    matches.sort(key=lambda m: m["confidence"], reverse=True)

    return {
        "summary": _text(answer.get("summary"), 600),
        "recommendations": recommendations,
        "matches": matches[:5],
        "library_checked": len(candidates),
        "model": get_openai_model(),
    }
