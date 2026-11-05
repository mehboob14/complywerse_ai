"""AI assist for an exception at every step of its life (DECISIONS D62): drafts the person edits or throws away, never saved by the call.

* the **owner** (raising it): ``draft`` the justification and the business impact from the document, ``schedule`` a period and a priority,
  ``suggest_assets`` among the organisation's assets;
* a **reviewer or approver** (at their open step): ``suggest_risks``: potential risks from the document's wording, the justification and the
  assets' criticality, and a short summary to decide on;
* the **implementer** (after the approval): ``suggest_controls``: compensating controls, each for the potential risks and assets it covers.

Every call goes through the shared client (``services/openai_client.get_openai_client``: 90 s timeout, 2 retries) and the data-protection guard
in the OpenAI shim; each use case is in ``services/ai_gateway/registry.py`` and the asset columns a prompt may carry are declared in
``services/ai_gateway/field_policies.py`` (``ai_view``). What the model answers is checked before it is returned: ids must be ones the prompt held,
levels 1 to 5, texts capped, and an answer that is empty or was cut off is an error, never a draft. When AI is not configured the answer is a
503 with a plain sentence: these helpers make up nothing without a model. ``AIBlocked`` is the guard's refusal and is never swallowed here (the
application turns it into a 403 with its sentence).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ...config import get_openai_model
from ...models import GovernanceDocument, GRCUser, ITAsset, PolicyException
from ...services.ai_gateway.errors import AIBlocked
from ...services.ai_gateway.field_policies import ai_view
from . import exception_controls as C
from . import exception_risks as K

logger = logging.getLogger(__name__)

UNAVAILABLE = "AI is not available right now. You can write it yourself."
UNUSABLE = "AI gave an answer that could not be used. Try again."
FAILED = "AI could not answer just now. Try again in a moment."
PRIORITIES = ("low", "medium", "high", "critical")
DOC_EXCERPT = 3500
ASSET_CANDIDATES = 60
SYSTEM = ("You are a governance, risk and compliance specialist helping to complete a policy exception workflow. Use only the context you are given, "
          "do not invent facts, names, systems or figures, write plainly and concisely, and answer with valid JSON only, in exactly the shape asked.")


# ── the call ─────────────────────────────────────────────────────────────────
def _parse(raw: str) -> Optional[Dict[str, Any]]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text[:-3] if text.endswith("```") else text
    try:
        out = json.loads(text.strip())
    except (TypeError, ValueError):
        return None
    return out if isinstance(out, dict) else None


def _ask_json(prompt: str) -> Dict[str, Any]:
    """One chat call whose answer must be a JSON object. 503 when AI is not configured, 502 when the call failed or the answer is empty,
    cut off or not JSON; the guard's refusal (``AIBlocked``) passes through."""
    from ...services.openai_client import check_ai_available, get_openai_client

    if not check_ai_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE)
    try:
        completion = get_openai_client().chat.completions.create(
            model=get_openai_model(), temperature=0.3,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
    except AIBlocked:
        raise
    except HTTPException:
        raise
    except Exception:       # noqa: BLE001 - a provider failure is said in words, never as its own text
        logger.exception("exception AI: the call failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=FAILED) from None
    choice = completion.choices[0] if getattr(completion, "choices", None) else None
    if choice is None or getattr(choice, "finish_reason", None) == "length":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNUSABLE)
    data = _parse(getattr(choice.message, "content", "") or "")
    if not data:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNUSABLE)
    return data


def _unusable() -> HTTPException:
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNUSABLE)


def _text(value: Any, cap: int) -> str:
    """A model's text with its spacing tidied (line breaks kept) and capped."""
    lines = [" ".join(line.split()) for line in str(value or "").strip().splitlines()]
    return "\n".join(line for line in lines if line)[:cap].strip()


# ── what a prompt carries ────────────────────────────────────────────────────
def document_context(db: Session, user: GRCUser, document_id: Optional[int], tenant_ids: Iterable[int], strict: bool = True) -> str:
    """The document as this person reads it (the version in force while a newer one is on its way): title, type, description and an excerpt.
    Refused for a document they may not open when they chose it (``strict``); for a reviewer, an approver or an implementer, who did not,
    a document they may not open simply adds no text: the draft is made from the exception alone."""
    if not document_id:
        return ""
    from .permissions import can_read, ensure_reader, version_for

    doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == int(document_id), GovernanceDocument.tenant_id.in_(list(tenant_ids))).first()
    if doc is None:
        if not strict:
            return ""
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if strict:
        ensure_reader(db, user, doc)
    elif not can_read(db, user, doc):
        return ""
    row = version_for(db, user, doc)
    body = (row.content if row is not None else doc.content) or ""
    return "\n".join([f"Document title: {doc.title or ''}", f"Document type: {doc.doc_type or ''}", f"Document description: {doc.description or ''}",
                      f"Document excerpt: {body[:DOC_EXCERPT]}"]).strip()


def _asset_lines(assets: Iterable[ITAsset], use_case: str) -> List[Dict[str, Any]]:
    return [ai_view(a, use_case) for a in assets]


def _exception_context(exc: PolicyException) -> str:
    parts = [f"Exception title: {exc.title or ''}", f"Priority: {exc.priority or ''}", f"Justification: {exc.justification or ''}",
             f"Business impact: {exc.business_impact or ''}"]
    if exc.effective_date or exc.expiry_date:
        parts.append(f"Period: {exc.effective_date.date().isoformat() if exc.effective_date else 'not set'} to "
                     f"{exc.expiry_date.date().isoformat() if exc.expiry_date else 'not set'}")
    return "\n".join(p for p in parts if p.split(": ", 1)[1].strip())


def _linked_assets(db: Session, exc: PolicyException) -> List[ITAsset]:
    ids = [int(i) for i in exc.linked_asset_ids or []]
    return db.query(ITAsset).filter(ITAsset.id.in_(ids), ITAsset.tenant_id == exc.tenant_id).all() if ids else []


def _ids(raw: Any, allowed: Iterable[int]) -> List[int]:
    allowed = set(allowed)
    out: List[int] = []
    for x in raw if isinstance(raw, list) else []:
        try:
            i = int(x)
        except (TypeError, ValueError):
            continue
        if i in allowed and i not in out:
            out.append(i)
    return out


# ── the owner ────────────────────────────────────────────────────────────────
def draft(db: Session, user: GRCUser, tenant_ids: Iterable[int], title: str, document_id: Optional[int]) -> Dict[str, Any]:
    """A justification and a business impact for an exception being raised: ``{justification, business_impact, source}``."""
    context = document_context(db, user, document_id, tenant_ids)
    prompt = ("Draft the text of a policy exception request.\nAnswer as JSON with exactly these keys:\n"
              "- justification: 2 to 4 sentences on why the exception is needed.\n"
              "- business_impact: 2 to 3 sentences on what refusing it would mean for the business.\n"
              f"Exception title: {title}\n" + (f"\nContext:\n{context}" if context else ""))
    data = _ask_json(prompt)
    justification, impact = _text(data.get("justification"), 2000), _text(data.get("business_impact"), 1500)
    if not justification or not impact:
        raise _unusable()
    return {"justification": justification, "business_impact": impact, "source": "ai"}


def schedule(db: Session, user: GRCUser, tenant_ids: Iterable[int], title: str, justification: str, document_id: Optional[int],
             priority: Optional[str], today: Optional[date] = None) -> Dict[str, Any]:
    """A priority and a period (today to a date) for an exception being raised: ``{priority, effective_date, expiry_date, rationale}``."""
    context = document_context(db, user, document_id, tenant_ids)
    prompt = ("Suggest how long a policy exception should run and how high its priority should be. Exceptions are time-bound: prefer the shortest "
              "period that lets the work finish.\nAnswer as JSON with exactly these keys:\n"
              "- priority: one of low, medium, high, critical.\n- duration_days: a whole number of days from 7 to 365.\n"
              "- rationale: one or two sentences saying why.\n"
              f"Exception title: {title}\n" + (f"Requested priority: {priority}\n" if priority else "")
              + (f"Justification: {justification}\n" if justification else "") + (f"\nContext:\n{context}" if context else ""))
    data = _ask_json(prompt)
    level = str(data.get("priority") or "").strip().lower()
    try:
        days = int(data.get("duration_days"))
    except (TypeError, ValueError):
        days = 0
    rationale = _text(data.get("rationale"), 600)
    if level not in PRIORITIES or not 7 <= days <= 365 or not rationale:
        raise _unusable()
    start = today or datetime.utcnow().date()
    return {"priority": level, "effective_date": start.isoformat(), "expiry_date": (start + timedelta(days=days)).isoformat(), "rationale": rationale}


def suggest_assets(db: Session, user: GRCUser, tenant_id: int, tenant_ids: Iterable[int], title: str, justification: str,
                   document_id: Optional[int]) -> Dict[str, Any]:
    """The organisation's assets an exception like this probably touches: ``{assets: [{id, name, asset_type, criticality, reason}]}``."""
    context = document_context(db, user, document_id, tenant_ids)
    pool = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, ITAsset.status != "decommissioned").order_by(ITAsset.id.desc()).limit(400).all()
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    pool = sorted(pool, key=lambda a: (rank.get((a.criticality or "").lower(), 4), a.id))[:ASSET_CANDIDATES]
    if not pool:
        return {"assets": []}
    lines = _asset_lines(pool, "governance.exception_assets")
    prompt = ("Choose which of these assets a policy exception like the one below most likely touches. Choose at most 6, only from the list, and only "
              "when there is a reason.\nAnswer as JSON with exactly this key:\n- assets: a list of {\"id\": <id from the list>, \"reason\": <one short sentence>}.\n"
              f"Exception title: {title}\n" + (f"Justification: {justification}\n" if justification else "")
              + (f"\nContext:\n{context}\n" if context else "") + f"\nAssets:\n{json.dumps(lines, default=str)}")
    data = _ask_json(prompt)
    by_id = {a.id: a for a in pool}
    out, seen = [], set()
    for item in data.get("assets") if isinstance(data.get("assets"), list) else []:
        try:
            i = int((item or {}).get("id"))
        except (TypeError, ValueError):
            continue
        if i in by_id and i not in seen:
            seen.add(i)
            out.append({"id": i, "name": by_id[i].name, "asset_type": by_id[i].asset_type, "criticality": by_id[i].criticality,
                        "reason": _text((item or {}).get("reason"), 300)})
    return {"assets": out[:6]}


# ── a reviewer or an approver ────────────────────────────────────────────────
def suggest_risks(db: Session, user: GRCUser, tenant_ids: Iterable[int], exc: PolicyException) -> Dict[str, Any]:
    """Potential risks for the exception and a short summary to decide on: ``{summary, risks: [{title, description, likelihood, impact}]}``."""
    context = document_context(db, user, exc.document_id, tenant_ids, strict=False)
    assets = _asset_lines(_linked_assets(db, exc), "governance.exception_risks")
    earlier = [r.title for r in K.rows_of(db, exc.id) if r.title and not r.none_identified][:12]
    prompt = ("Review this policy exception as a risk reviewer. List what could go wrong if it is granted, and summarise it for the person who has to decide.\n"
              "Answer as JSON with exactly these keys:\n- summary: 2 to 4 sentences: what is asked, why, and the main exposure.\n"
              "- risks: 3 to 6 items of {\"title\": <what could go wrong, one sentence>, \"description\": <one or two sentences of detail>, "
              "\"likelihood\": <1 to 5>, \"impact\": <1 to 5>}. Likelihood 1 is rare, 5 is almost certain; impact 1 is negligible, 5 is severe. "
              "Weigh the assets' criticality and ratings.\n"
              f"\n{_exception_context(exc)}\n" + (f"\nContext:\n{context}\n" if context else "")
              + (f"\nAssets:\n{json.dumps(assets, default=str)}\n" if assets else "") + (f"\nRisks already recorded: {json.dumps(earlier)}\n" if earlier else ""))
    data = _ask_json(prompt)
    risks = []
    for item in data.get("risks") if isinstance(data.get("risks"), list) else []:
        title = _text((item or {}).get("title"), K.TITLE_MAX)
        try:
            likelihood, impact = int((item or {}).get("likelihood")), int((item or {}).get("impact"))
        except (TypeError, ValueError):
            likelihood = impact = 0
        if title and likelihood in K.LEVELS and impact in K.LEVELS:
            risks.append({"title": title, "description": _text((item or {}).get("description"), K.NOTE_MAX), "likelihood": likelihood, "impact": impact})
    summary = _text(data.get("summary"), 1200)
    if not risks or not summary:
        raise _unusable()
    return {"summary": summary, "risks": risks[:6]}


# ── the implementer ──────────────────────────────────────────────────────────
def suggest_controls(db: Session, user: GRCUser, tenant_ids: Iterable[int], exc: PolicyException, run) -> Dict[str, Any]:
    """Compensating controls for the potential risks and assets of the exception: ``{controls: [{title, description, risk_ids, asset_ids}]}``."""
    context = document_context(db, user, exc.document_id, tenant_ids, strict=False)
    risks = C.risks_of(db, exc, run)
    assets = _linked_assets(db, exc)
    if not risks:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No potential risks were recorded, so there is nothing to cover yet.")
    risk_lines = [{"id": r.id, "risk": r.title, "note": r.description, "rating": r.rating} for r in risks]
    prompt = ("Suggest compensating controls for an approved policy exception: measures that cover the gap while the exception lasts. Each control "
              "should be specific and verifiable, and say which of the potential risks and which assets it is for.\nAnswer as JSON with exactly this key:\n"
              "- controls: 2 to 8 items of {\"title\": <the control, one sentence>, \"description\": <how it works and how it is checked, one or two sentences>, "
              "\"risk_ids\": <ids from the risk list it covers>, \"asset_ids\": <ids from the asset list it protects, may be empty>}.\n"
              f"\n{_exception_context(exc)}\n" + (f"\nContext:\n{context}\n" if context else "")
              + f"\nPotential risks:\n{json.dumps(risk_lines, default=str)}\n"
              + (f"\nAssets:\n{json.dumps(_asset_lines(assets, 'governance.exception_controls'), default=str)}\n" if assets else ""))
    data = _ask_json(prompt)
    out = []
    for item in data.get("controls") if isinstance(data.get("controls"), list) else []:
        title = _text((item or {}).get("title"), C.TITLE_MAX)
        if not title:
            continue
        out.append({"title": title, "description": _text((item or {}).get("description"), C.NOTE_MAX),
                    "risk_ids": _ids((item or {}).get("risk_ids"), (r.id for r in risks)), "asset_ids": _ids((item or {}).get("asset_ids"), (a.id for a in assets))})
    if not out:
        raise _unusable()
    return {"controls": out[:8]}
