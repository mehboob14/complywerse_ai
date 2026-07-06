"""AI assist for the ISO 27001 template tabs.

Synchronous endpoints that take a register's rows (or a document's sections) and
return structured suggestions the user can apply. Follows the platform AI recipe:
get_openai_model() + the gpt-5.x compat shim in config.py, JSON output, graceful
degradation when no key is configured.
"""
import os
import re
import json
import logging
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ....config import get_openai_api_key, get_openai_model
from ..seed_data import REGISTER_TYPES, REGISTER_LABELS, DOC_TYPES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["Framework Template AI"])


def _client():
    try:
        from openai import OpenAI
    except Exception:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI library unavailable.")
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = bool(base_url and "modelfarm" in base_url)
    if not api_key and not is_modelfarm:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="AI is not configured on this environment.")
    if api_key and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20) and not is_modelfarm:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="AI is not configured on this environment.")
    return OpenAI(api_key=api_key, base_url=base_url)


def _parse(txt: str) -> dict:
    t = (txt or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    try:
        return json.loads(t.strip())
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {}


def _chat(system: str, user: str, max_tokens: int = 3500) -> dict:
    client = _client()
    model = get_openai_model()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.3,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return _parse(resp.choices[0].message.content or "{}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("framework-templates AI call failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI request failed: {e}")


# Per-register: which assessment fields the AI should propose (+ allowed values).
_REGISTER_FIELDS = {
    "gap_analysis": 'status (one of: not_started, in_progress, covered, not_applicable), '
                    'action (a concise, specific gap or remediation action)',
    "internal_audit": 'result (one of: conform, nonconform, ofi, not_applicable), '
                      'finding_type (one of: nonconformity, ofi, observation, or empty string), '
                      'notes (a concise finding or corrective action)',
    "risk_treatment": 'treatment_option (one of: mitigate, accept, avoid, transfer), '
                      'action (a concise action plan), '
                      'residual_risk (one of: low, medium, high, critical)',
}


class RegisterAIRequest(BaseModel):
    register_type: str
    framework_name: Optional[str] = "ISO 27001"
    rows: List[Dict[str, Any]]


@router.post("/register")
def register_ai(body: RegisterAIRequest, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    if body.register_type not in REGISTER_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown register_type")
    if not get_user_tenants(user, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant context")

    label = REGISTER_LABELS.get(body.register_type, body.register_type)
    fields = _REGISTER_FIELDS[body.register_type]
    rows = [{
        "id": r.get("id"),
        "reference": r.get("reference"),
        "title": r.get("title"),
        "status": r.get("status"),
        "result": r.get("result"),
        "action": r.get("action"),
        "notes": r.get("notes"),
    } for r in body.rows][:60]

    system = "You are a senior ISO 27001:2022 lead auditor and ISMS consultant. Respond with valid JSON only."
    user_prompt = (
        f"Framework: {body.framework_name}. Register: {label}.\n"
        f"For EACH row below, propose values for these fields: {fields}.\n"
        "Base each assessment on typical ISO 27001:2022 expectations for that clause/control. "
        "Keep any action/notes text specific and concise (max ~220 chars). Do not change the reference or title.\n\n"
        f"Rows (JSON): {json.dumps(rows, ensure_ascii=False)}\n\n"
        'Return JSON of the form: {"suggestions":[{"id":<the row id>, <the fields above>, '
        '"rationale":"<one short sentence>"}], "summary":"<2-3 sentence overall summary>"}'
    )
    out = _chat(system, user_prompt, max_tokens=3800)
    return {"suggestions": out.get("suggestions", []) or [], "summary": out.get("summary", "") or ""}


class DocumentAIRequest(BaseModel):
    doc_type: str
    framework_name: Optional[str] = "ISO 27001"
    title: Optional[str] = None
    organization: Optional[str] = None
    sections: List[Dict[str, Any]]


@router.post("/document")
def document_ai(body: DocumentAIRequest, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    if body.doc_type not in DOC_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown doc_type")
    if not get_user_tenants(user, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant context")

    # Only draft plain-text sections; leave table sections untouched.
    secs = [{"heading": s.get("heading"), "body": s.get("body", "")}
            for s in body.sections if not s.get("table")][:20]

    system = ("You are a senior ISO 27001:2022 ISMS consultant drafting formal management-system "
              "documents. Respond with valid JSON only.")
    user_prompt = (
        f"Framework: {body.framework_name}. Document: {body.title or body.doc_type}. "
        f"Organization: {body.organization or '[the organization]'}.\n"
        "Rewrite each section body into clear, audit-ready prose suitable for this ISMS document. "
        "Replace bracketed placeholders with sensible draft content the user can refine. "
        "Do not invent specific facts you cannot know — where a real value is required, keep a clearly "
        "marked placeholder like [e.g. ...]. Keep each section focused and do not change the heading.\n\n"
        f"Sections (JSON): {json.dumps(secs, ensure_ascii=False)}\n\n"
        'Return JSON of the form: {"sections":[{"heading":"<unchanged heading>", '
        '"body":"<drafted body>"}], "summary":"<one short sentence>"}'
    )
    out = _chat(system, user_prompt, max_tokens=3800)
    return {"sections": out.get("sections", []) or [], "summary": out.get("summary", "") or ""}
