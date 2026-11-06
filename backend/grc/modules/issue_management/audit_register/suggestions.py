"""What else in the platform a finding belongs to — proposed, never assumed.

Deterministic linkage (linkage.py) handles what the register states outright:
hosts, vendors, the vulnerability by name. This is the judgement half — which
controls the finding bears on, and which risks it feeds — and it is deliberately
advisory. Each suggestion carries its reason, and a person accepts it through
the ordinary link endpoints, so nothing appears against a bank's finding that
somebody did not agree to.

Controls are scored here, in arithmetic, rather than by a model. The control
library is the Secure Controls Framework, whose licence forbids using AI over
its content (services/licence_guard), so its wording never leaves the server.
Risks are the tenant's own writing, so a model reads the finding and the risk
titles and says which fit; without an API key the same local scoring stands in.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ....config import get_openai_api_key, get_openai_model
from ....models import AuditIssueProfile, Issue, NormalizedControl, Risk

logger = logging.getLogger(__name__)

# Words that say nothing about what a finding is about.
_STOP = {
    "the", "and", "for", "that", "with", "this", "from", "have", "has", "not", "are", "was", "were",
    "its", "their", "there", "which", "should", "must", "will", "shall", "may", "can", "all", "any",
    "management", "bank", "process", "procedures", "procedure", "policy", "policies", "control",
    "controls", "ensure", "ensures", "review", "reviewed", "issue", "issues", "risk", "risks",
    "recommendation", "recommendations", "audit", "report", "identified", "appropriate", "within",
    "been", "also", "over", "into", "when", "where", "such", "they", "does", "were", "your",
}


def _terms(*texts: Any) -> set:
    words = re.findall(r"[a-z][a-z0-9\-]{3,}", " ".join(str(t or "") for t in texts).lower())
    return {w for w in words if w not in _STOP}


def _score(finding: set, candidate: set) -> float:
    """Shared distinctive words, damped so long candidates do not win by size."""
    if not finding or not candidate:
        return 0.0
    shared = finding & candidate
    return len(shared) / (len(candidate) ** 0.5) if shared else 0.0


def _finding_terms(issue: Issue, profile: AuditIssueProfile) -> set:
    return _terms(issue.title, profile.issue_text, profile.condition, profile.risk_text,
                  profile.impact_text, profile.causes, profile.recommendation,
                  profile.corrective_actions)


def suggest_controls(db: Session, tenant_id: int, issue: Issue, profile: AuditIssueProfile,
                     limit: int = 5) -> List[Dict[str, Any]]:
    """Controls whose wording overlaps the finding. Scored locally, never by a model."""
    finding = _finding_terms(issue, profile)
    if not finding:
        return []
    out = []
    for control in (db.query(NormalizedControl)
                    .filter(NormalizedControl.tenant_id == tenant_id).all()):
        terms = _terms(control.name, control.statement, control.domain)
        score = _score(finding, terms)
        if score <= 0:
            continue
        out.append({
            "normalized_control_id": control.id,
            "code": control.code,
            "name": control.name,
            "domain": control.domain,
            "score": round(score, 3),
            "why": sorted(finding & terms)[:6],
        })
    out.sort(key=lambda item: item["score"], reverse=True)
    return out[:limit]


def suggest_risks(db: Session, tenant_id: int, issue: Issue, profile: AuditIssueProfile,
                  limit: int = 5) -> List[Dict[str, Any]]:
    """Risks in the tenant's register that this finding feeds."""
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    if not risks:
        return []
    finding = _finding_terms(issue, profile)
    scored = []
    for risk in risks:
        terms = _terms(risk.title, risk.description, risk.risk_category)
        score = _score(finding, terms)
        if score > 0:
            scored.append({"risk_id": risk.id, "title": risk.title, "score": round(score, 3),
                           "why": sorted(finding & terms)[:6], "by": "wording"})
    scored.sort(key=lambda item: item["score"], reverse=True)
    shortlist = scored[:12] or [{"risk_id": r.id, "title": r.title, "score": 0.0, "why": [],
                                 "by": "wording"} for r in risks[:12]]
    judged = _judge_risks(issue, profile, shortlist)
    return (judged or shortlist)[:limit]


def _judge_risks(issue: Issue, profile: AuditIssueProfile,
                 shortlist: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Ask a model which shortlisted risks the finding really belongs to.

    Only the client's own words go into the prompt — the finding and their risk
    titles. Returns None when no key is configured or the answer is unusable, and
    the caller falls back to the local ranking.
    """
    if not get_openai_api_key():
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=get_openai_api_key(),
                        base_url=os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL"))
        candidates = "\n".join(f"{r['risk_id']}: {r['title']}" for r in shortlist)
        prompt = (
            "An internal audit finding at a bank, and a list of risks from the bank's own risk "
            "register. Say which risks this finding is evidence of or increases. Choose only "
            "risks that genuinely relate; choosing none is a valid answer.\n\n"
            f"FINDING: {issue.title}\n{profile.issue_text or profile.condition or ''}\n\n"
            f"RISKS:\n{candidates}\n\n"
            'Answer as JSON: {"matches": [{"risk_id": 1, "confidence": 0.0-1.0, '
            '"reason": "one short sentence"}]}'
        )
        reply = client.chat.completions.create(
            model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or get_openai_model(),
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You map audit findings onto a risk register. "
                                              "You never invent risks that are not listed."},
                {"role": "user", "content": prompt},
            ],
        )
        matches = json.loads(reply.choices[0].message.content or "{}").get("matches") or []
    except Exception:                       # no key, refused prompt, bad JSON, provider down
        logger.info("audit register: risk suggestions fell back to local scoring", exc_info=True)
        return None

    by_id = {r["risk_id"]: r for r in shortlist}
    out = []
    for match in matches:
        risk = by_id.get(match.get("risk_id"))
        if not risk:
            continue                       # a risk id the register does not have
        out.append({**risk, "score": round(float(match.get("confidence") or 0), 3),
                    "reason": str(match.get("reason") or "")[:200], "by": "ai"})
    out.sort(key=lambda item: item["score"], reverse=True)
    return out


def suggestions_for(db: Session, tenant_id: int, issue: Issue,
                    profile: AuditIssueProfile) -> Dict[str, Any]:
    return {
        "controls": suggest_controls(db, tenant_id, issue, profile),
        "risks": suggest_risks(db, tenant_id, issue, profile),
    }
