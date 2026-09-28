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
guard refuses SCF text should any slip in. The NIST publications and the
artifacts-catalog documents it may cite are listed the same way, by id.

A recommendation that is a document the organisation writes (a policy, standard,
procedure, plan or report) can be drafted here too, structured on the NIST
guidance the recommendation named, in the background, and kept on the item.
"""
from __future__ import annotations

import json
import logging
import math
import re
import threading
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ..config import get_openai_api_key, get_openai_base_url, get_openai_model
from ..models import AssessmentItemEvidence, ComplianceAssessmentDocumentItem, Evidence, Tenant

logger = logging.getLogger(__name__)


class AIUnavailable(RuntimeError):
    """No AI key is configured on this server."""


class AIEmptyAnswer(RuntimeError):
    """The AI answered, but nothing in the answer could be used (cut off, empty, or not the JSON asked for)."""


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

# NIST publications an answer may cite, by id, with their official templates: seed_data/nist_publications.json.
# NIST text is in the public domain in the US and NIST grants a royalty-free right to reuse it worldwide,
# derivative works included (nist.gov/open/license), so unlike SCF it may shape what the model writes; the
# model still only picks ids, and the titles and links come from the library.
_LIBRARY = Path(__file__).resolve().parent.parent / "seed_data" / "nist_publications.json"


@lru_cache(maxsize=1)
def nist_library() -> Dict[str, Any]:
    return json.loads(_LIBRARY.read_text(encoding="utf-8"))


NIST_SOURCES: Dict[str, tuple] = {p["id"]: (p["title"], p["url"]) for p in nist_library()["publications"]}
_NIST_NORM = {nid: re.sub(r"[^A-Z0-9]", "", nid) for nid in NIST_SOURCES}

# Kinds of document a recommendation can be; each can be drafted (see _STRUCTURE).
DOC_KINDS = ("policy", "standard", "procedure", "plan", "report")

# "Choosing none is fine" once sat beside the recommendations, and gpt-4o-mini read it as leave-them-out:
# 5 answers in 6 came back with an empty list. Always-3-to-5 is said separately from the library matches.
SYSTEM = (
    "You are a cyber security and compliance assessor. For one assessment item you recommend the evidence "
    "that would prove it and say how to collect it. Always give 3 to 5 recommendations, specific to the item "
    "and never generic; they never depend on what the organisation already holds. Separately, you may pick "
    "records from the existing-evidence list you are given, by id, only when one genuinely supports the "
    "item; picking none of them is fine. Return JSON only."
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


def openai_complete(messages: List[Dict[str, str]], *, max_tokens: int = 4000, json_mode: bool = True,
                    timeout: float = 60) -> str:
    key = _configured_key()
    if not key:
        raise AIUnavailable("AI isn't set up on this server: no AI key is configured.")
    from openai import OpenAI

    client = OpenAI(api_key=key, base_url=get_openai_base_url(), timeout=timeout)
    # A ceiling, not a target: reasoning models spend part of it thinking before they answer, and
    # at 1800 an answer listing library matches could be cut off mid-JSON and read as nothing.
    reply = client.chat.completions.create(
        model=get_openai_model(), temperature=0.3, max_tokens=max_tokens, messages=messages,
        **({"response_format": {"type": "json_object"}} if json_mode else {}),
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


@lru_cache(maxsize=1)
def nist_catalog() -> tuple:
    """NIST documents in the artifacts catalog that have written content, so each downloads as Word or PDF."""
    try:
        from ..routers.artifacts_router import _CATALOG_PATH, _load_artifact_content
        catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
        written = _load_artifact_content()
    except Exception:  # noqa: BLE001 — recommendations work without the catalog
        logger.warning("artifacts catalog unavailable for evidence references", exc_info=True)
        return ()
    found = []
    for fw_key, fw in catalog.items():
        if not str(fw_key).startswith("nist_") or not isinstance(fw, dict):
            continue
        for art in fw.get("artifacts") or []:
            aid = art.get("artifact_id")
            if aid and ((written.get(fw_key) or {}).get(aid) or {}).get("content"):
                found.append({"artifact_id": aid, "framework_key": fw_key, "framework": fw.get("name") or fw_key,
                              "title": art.get("name") or aid, "type": art.get("type"),
                              "control_ref": art.get("control_ref")})
    return tuple(found)


def _nist_id(said: Any) -> Optional[str]:
    """The NIST_SOURCES id an answer names, forgiving "NIST SP 800-53 Rev. 5" for SP800-53."""
    norm = re.sub(r"[^A-Z0-9]", "", str(said or "").upper().replace("NIST", ""))
    hits = [nid for nid, key in _NIST_NORM.items() if norm.startswith(key)]
    return max(hits, key=lambda nid: len(_NIST_NORM[nid])) if hits else None


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
    lines.append("\nNIST PUBLICATIONS (id | title):")
    lines += [f"- {nid} | {title}" for nid, (title, _url) in NIST_SOURCES.items()]
    lines.append("\nREFERENCE DOCUMENTS IN THE ARTIFACTS CATALOG (id | title | type | framework reference):")
    lines += [f"- {a['artifact_id']} | {a['title']} | {a['type'] or '-'} | {a['control_ref'] or '-'}"
              for a in nist_catalog()] or ["- none"]
    lines.append(
        "\nReturn JSON: {\"summary\": \"one or two sentences on what proves this item\", "
        "\"recommendations\": [{\"evidence_type\": \"short name, e.g. MFA configuration export\", "
        "\"description\": \"what it must show for THIS item\", \"how_to_collect\": \"where and how to get "
        "it: the system, report, export or screen\", \"priority\": \"high|medium|low\", "
        "\"example_files\": [\"file names\"], \"document\": \"policy|standard|procedure|plan|report, or null\"}], "
        "\"matches\": [{\"evidence_id\": 0, \"reason\": \"why it supports this item\", \"confidence\": 0.0}], "
        "\"nist\": [{\"id\": \"an id from the NIST list\", \"refs\": \"the controls, practices or sections of that "
        "publication that apply, e.g. CM-6, CM-7\", \"why\": \"how it applies to this item\"}], "
        "\"references\": [{\"artifact_id\": \"an id from the catalog list\", \"reason\": \"how it helps with "
        "this item\"}]}. Give 3-5 recommendations, most important first. Where a document the organisation "
        "writes and approves would prove the item (a policy, standard, procedure, plan or report template), "
        "include it and set \"document\" to its kind; tool output, scan results, configuration exports, "
        "screenshots, tickets and logs are records, not documents, so their \"document\" is null. \"recommendations\" must never be empty, "
        "even when no existing record fits; \"matches\" may be empty, at most 5, best first; \"nist\": the 1-3 "
        "publications that best apply; \"references\": 0-3 catalog documents that would help, may be empty."
    )
    return "\n".join(lines)


def recommend_evidence(db: Session, item: ComplianceAssessmentDocumentItem,
                       complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> Dict[str, Any]:
    """The recommendation for one item; the caller stores it on the item."""
    candidates = shortlist_existing(db, item)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": build_prompt(item, candidates)}]
    raw = (complete or openai_complete)(messages)
    answer = _parse(raw)
    if not answer.get("recommendations") and not answer.get("matches"):
        raw = (complete or openai_complete)(messages)   # a small model now and then leaves both out; ask once more
        answer = _parse(raw)

    recommendations = []
    for rec in (answer.get("recommendations") or [])[:6]:
        if not isinstance(rec, dict) or not _text(rec.get("evidence_type") or rec.get("description"), 10):
            continue
        priority = str(rec.get("priority") or "").lower()
        files = rec.get("example_files") if isinstance(rec.get("example_files"), list) else []
        kind = str(rec.get("document") or "").strip().lower()
        recommendations.append({
            "evidence_type": _text(rec.get("evidence_type"), 120) or "Evidence",
            "description": _text(rec.get("description"), 800),
            "how_to_collect": _text(rec.get("how_to_collect"), 600),
            "priority": priority if priority in {"high", "medium", "low"} else "medium",
            "example_files": [_text(f, 80) for f in files if _text(f, 80)][:4],
            "document": kind if kind in DOC_KINDS else None,
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

    if not recommendations and not matches:
        # Say so rather than keep an empty result over the item's last good one.
        logger.warning("AI evidence answer for item %s had nothing usable: %r", item.id, (raw or "")[:300])
        raise AIEmptyAnswer("The AI's answer came back empty or cut off, so nothing was saved. Try again.")

    nist, named = [], set()
    for ref in answer.get("nist") or []:
        ref = ref if isinstance(ref, dict) else {"id": ref}
        nid = _nist_id(ref.get("id"))
        if nid and nid not in named:                     # an id not on our list is dropped
            named.add(nid)
            title, url = NIST_SOURCES[nid]
            nist.append({"id": nid, "title": title, "url": url, "refs": _text(ref.get("refs"), 120),
                         "why": _text(ref.get("why"), 240)})

    catalog = {a["artifact_id"]: a for a in nist_catalog()}
    references, picked = [], set()
    for ref in answer.get("references") or []:
        ref = ref if isinstance(ref, dict) else {"artifact_id": ref}
        aid = str(ref.get("artifact_id") or "").strip()
        if aid in catalog and aid not in picked:
            picked.add(aid)
            references.append({**catalog[aid], "reason": _text(ref.get("reason"), 240)})

    return {
        "summary": _text(answer.get("summary"), 600),
        "recommendations": recommendations,
        "matches": matches[:5],
        "library_checked": len(candidates),
        "nist": nist[:3],
        "references": references[:3],
    }


# ── Drafting a recommended document ──────────────────────────────────────────

DRAFT_STALE = timedelta(minutes=10)

DRAFT_SYSTEM = (
    "You are a cyber security governance writer. You draft one document an organisation will adopt to meet an "
    "assessment requirement, following the structure and terms of the NIST guidance you are given. Write specific, "
    "implementable text for this requirement, not generic filler. Use Markdown: headings, numbered statements and "
    "tables where they help. Put facts you do not know (names, systems, dates, owners) in [square brackets] for the "
    "organisation to fill in, and never claim that something is already in place."
)

# The shape of each kind of document, after the NIST publication that sets it.
_STRUCTURE = {
    "policy": ("a policy in the shape NIST SP 800-53's policy-and-procedure controls (the -1 controls) expect: a "
               "document control table; Purpose; Scope; Roles and responsibilities; Management commitment; Policy "
               "statements as numbered 'shall' statements; Compliance and exceptions; Review and update; References"),
    "standard": ("a technical standard: a document control table; Purpose; Scope (systems and technologies); "
                 "Requirements as numbered, testable statements, grouped by technology where it helps; Verification: "
                 "how each requirement is checked; Exceptions; Review and update; References"),
    "procedure": ("a procedure: a document control table; Purpose; Scope; Roles; Prerequisites; Steps as a numbered "
                  "list saying who does what and when; Records kept as evidence; Review and update; References"),
    "plan": ("a plan in the shape of the NIST template for its kind (SP 800-34 for contingency plans, SP 800-61 Rev. 3 "
             "for incident response, SP 800-18 for security plans): a document control table; Introduction and "
             "purpose; Scope; Roles and responsibilities; Concept of operations; the plan's phases or activities; "
             "Testing, training and exercises; Plan maintenance; References"),
    "report": ("a report template in the shape of NIST SP 800-115's reporting guidance: a document control table; "
               "Executive summary; Scope and rules of engagement; Methodology; Findings as a table (ID, finding, "
               "severity, evidence, recommendation) with [placeholders]; Conclusion; References"),
}


def loads(text: Optional[str]) -> Dict[str, Any]:
    """The item's stored AI result as a dict ({} when empty or unreadable)."""
    try:
        data = json.loads(text or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def draft_key(title: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(title or "").lower()).strip("-")[:60] or "document"


def draft_view(draft: Any) -> Any:
    """A draft as the page should see it: one left 'drafting' by a restart reads as stopped."""
    if not isinstance(draft, dict) or draft.get("status") != "drafting":
        return draft
    try:
        started = datetime.fromisoformat(str(draft.get("started_at") or ""))
    except ValueError:
        started = None
    if started is None or datetime.utcnow() - started > DRAFT_STALE:
        return {**draft, "status": "failed", "error": "Drafting stopped before it finished. Try again."}
    return draft


def template_for(title: Any, kind: Any) -> Optional[Dict[str, Any]]:
    """The official NIST template outline a draft follows: one whose keywords name the document (a "business
    impact analysis" follows the BIA template) and whose kinds include it. A cited publication alone isn't
    enough: an incident response plan citing SP 800-34 must not take the BIA's shape."""
    named = str(title or "").lower()
    for pub in nist_library()["publications"]:
        for tpl in pub.get("templates") or []:
            if (tpl.get("outline") and kind in (tpl.get("kinds") or [])
                    and any(re.search(r"\b" + re.escape(k) + r"\b", named) for k in tpl.get("keywords") or [])):
                return {**tpl, "publication": pub["title"]}
    return None


def build_draft_prompt(item: ComplianceAssessmentDocumentItem, rec: Dict[str, Any], nist: List[Dict[str, Any]],
                       organisation: Optional[str], template: Optional[Dict[str, Any]] = None) -> str:
    assessment = getattr(item, "assessment", None)
    fmt = getattr(assessment, "assessment_format", None) or ""
    kind = rec.get("document") if rec.get("document") in _STRUCTURE else "standard"
    lines = [
        f"ORGANISATION: {organisation or '[Organisation name]'}",
        f"ASSESSMENT: {getattr(assessment, 'name', None) or 'Assessment'}"
        + (f" — each item is {FORMAT_GUIDE[fmt]}." if fmt in FORMAT_GUIDE else ""),
        f"REQUIREMENT {item.item_number or ''}: {_text(item.control_description, 2000)}",
        f"DOCUMENT TO WRITE: {rec.get('evidence_type')} (a {kind})",
        f"IT MUST SHOW: {rec.get('description') or '-'}",
        f"HOW IT WILL BE USED AS EVIDENCE: {rec.get('how_to_collect') or '-'}",
        "NIST BASIS:",
    ]
    lines += [f"- {n.get('title')}" + (f": {n['refs']}" if n.get("refs") else "")
              + (f" — {n['why']}" if n.get("why") else "") for n in nist] or [f"- {NIST_SOURCES['SP800-53'][0]}"]
    if template:
        shape = (f"the document on the outline of NIST's {template['name']} ({template['publication']}), keeping its "
                 "section numbers and headings, after a document control table:\n"
                 + "\n".join(f"- {line}" for line in template["outline"]) + "\nThen a References section")
    else:
        shape = _STRUCTURE[kind]
    lines.append(f"\nWrite {shape}. 900 to 1500 words. Start with a level-1 heading carrying the document's title. "
                 "The References section lists the NIST publications above. Return only the document, in Markdown.")
    return "\n".join(lines)


def _draft_complete(messages: List[Dict[str, str]]) -> str:
    return openai_complete(messages, max_tokens=6000, json_mode=False, timeout=180)


def draft_document(item: ComplianceAssessmentDocumentItem, rec: Dict[str, Any], nist: List[Dict[str, Any]],
                   organisation: Optional[str],
                   complete: Optional[Callable[[List[Dict[str, str]]], str]] = None,
                   template: Optional[Dict[str, Any]] = None) -> str:
    """One document drafted for the item, in Markdown, ending with the NIST credit line."""
    text = (complete or _draft_complete)([
        {"role": "system", "content": DRAFT_SYSTEM},
        {"role": "user", "content": build_draft_prompt(item, rec, nist, organisation, template)},
    ])
    text = re.sub(r"^```(?:markdown|md)?\s*|\s*```$", "", (text or "").strip())
    if len(text) < 400:
        raise AIEmptyAnswer("The AI's draft came back empty or cut off. Try again.")
    sources = ", ".join(n.get("title") or "" for n in nist) or NIST_SOURCES["SP800-53"][0]
    shaped = f"Structured on NIST's {template['name']} ({template['publication']}). " if template else ""
    return (text + "\n\n---\n\n*" + shaped + "Prepared with reference to " + sources + ". NIST publications are reprinted "
            "courtesy of the National Institute of Standards and Technology, U.S. Department of Commerce. Drafted "
            "with AI: review it, fill in the [bracketed] details and approve it before use.*")


def draft_into(db: Session, item_id: int, key: str,
               complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> None:
    """Write one document draft onto the item. A failure is kept on the draft for the page to show."""
    item = db.get(ComplianceAssessmentDocumentItem, item_id)
    if item is None:
        return
    data = loads(item.ai_evidence_recommendation)
    rec = next((r for r in data.get("recommendations") or []
                if isinstance(r, dict) and draft_key(r.get("evidence_type")) == key), None)
    try:
        if rec is None:
            raise AIEmptyAnswer("That document is no longer among this item's recommendations.")
        tenant = db.get(Tenant, item.tenant_id)
        nist = data.get("nist") or []
        template = template_for(rec.get("evidence_type"), rec.get("document"))
        content = draft_document(item, rec, nist, getattr(tenant, "name", None), complete, template)
        outcome = {"status": "ready", "content": content, "error": None, "generated_at": datetime.utcnow().isoformat(),
                   "template": f"{template['name']} ({template['publication']})" if template else None}
    except (AIUnavailable, AIEmptyAnswer) as exc:
        outcome = {"status": "failed", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — provider down, timeout, auth, rate limit
        logger.warning("AI evidence draft failed for item %s", item_id, exc_info=True)
        outcome = {"status": "failed", "error": f"The AI service did not answer ({type(exc).__name__}). Try again."}
    db.refresh(item)                                    # a regenerate may have landed meanwhile
    data = loads(item.ai_evidence_recommendation)
    drafts = dict(data.get("drafts") or {})
    drafts[key] = {**(drafts.get(key) or {}), **outcome}
    data["drafts"] = drafts
    item.ai_evidence_recommendation = json.dumps(data)
    db.commit()


def run_draft_job(tenant_slug: str, item_id: int, key: str, user_id: int) -> None:
    """The background draft: its own tenant session, never raises."""
    from ..db import open_tenant_session
    from .ai_usage import usage_scope

    db = open_tenant_session(tenant_slug)
    try:
        with usage_scope(tenant_slug=tenant_slug, actor_user_id=user_id, background_job_id=f"evidence-draft-{item_id}",
                         module_key="compliance", feature_key="assessment_evidence_draft"):
            draft_into(db, item_id, key)
    except Exception:  # noqa: BLE001 — the draft then reads as stopped after DRAFT_STALE
        logger.exception("Evidence draft job failed for item %s", item_id)
        db.rollback()
    finally:
        db.close()


def start_draft(tenant_slug: str, item_id: int, key: str, user_id: int) -> None:
    """ponytail: a thread in the web process, as the regulatory analysis runs; a restart mid-draft leaves it
    'drafting', which reads as stopped after DRAFT_STALE. Move to Celery if drafts must survive restarts."""
    threading.Thread(target=run_draft_job, args=(tenant_slug, item_id, key, user_id), daemon=True,
                     name=f"evidence-draft-{item_id}").start()
