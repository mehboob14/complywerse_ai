from ..config import get_openai_api_key, get_openai_model

from typing import List, Optional
from datetime import datetime, timedelta
import json
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import PolicyException, PolicyExceptionComment, GovernanceDocument, GRCUser, get_db
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/policy-exceptions", tags=["Policy Exceptions"])
logger = logging.getLogger(__name__)


def _check_ai_available() -> bool:
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if base_url and "modelfarm" in base_url:
        return True

    api_key = get_openai_api_key()
    if not api_key:
        return False
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        return False
    return True


def _fallback_exception_suggestion(title: str, document: GovernanceDocument) -> dict:
    policy_name = (document.title or "selected policy").strip()
    policy_scope = (document.description or "the documented policy controls and governance expectations").strip()

    return {
        "justification": (
            f"The exception request '{title}' is being raised against '{policy_name}' due to a temporary operational constraint. "
            f"Business continuity and service delivery requirements require short-term deviation while remediation activities are executed. "
            f"Scope impacted: {policy_scope}."
        ),
        "risk_assessment": (
            "Key risks include control non-conformance, elevated compliance exposure, and potential audit observations if unmanaged. "
            "Residual risk is expected to remain moderate provided the exception remains time-bound, monitored, and approved through governance workflow."
        ),
        "compensating_controls": (
            "Apply enhanced management oversight, implement interim manual review checks, maintain exception activity logs, "
            "perform periodic compliance monitoring, and enforce a defined remediation target date with accountable owner tracking."
        ),
        "source": "template"
    }


def _parse_json_response(raw_text: str) -> Optional[dict]:
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    try:
        return json.loads(cleaned.strip())
    except Exception:
        return None


def _generate_exception_suggestion(title: str, document: GovernanceDocument) -> dict:
    if not _check_ai_available():
        return _fallback_exception_suggestion(title, document)

    try:
        from openai import OpenAI

        api_key = get_openai_api_key()
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
        model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or get_openai_model()

        client = OpenAI(api_key=api_key, base_url=base_url)

        policy_context = "\n\n".join([
            f"Policy title: {document.title or ''}",
            f"Policy type: {document.doc_type or ''}",
            f"Policy description: {document.description or ''}",
            f"Policy content excerpt: {(document.content or '')[:3500]}",
        ]).strip()

        prompt = (
            "You are a GRC governance specialist. Generate concise policy exception draft content as strict JSON only with keys: "
            "justification, risk_assessment, compensating_controls. "
            "Use professional audit/compliance language, be practical and specific to the provided exception title and policy context.\n\n"
            f"Exception title: {title}\n\n"
            f"Policy context:\n{policy_context}"
        )

        completion = client.chat.completions.create(
            model=model,
            temperature=0.3,
            messages=[
                {"role": "system", "content": "Respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
        )

        content = completion.choices[0].message.content if completion.choices else ""
        parsed = _parse_json_response(content or "") or {}

        justification = str(parsed.get("justification") or "").strip()
        risk_assessment = str(parsed.get("risk_assessment") or "").strip()
        compensating_controls = str(parsed.get("compensating_controls") or "").strip()

        if not justification or not risk_assessment or not compensating_controls:
            return _fallback_exception_suggestion(title, document)

        return {
            "justification": justification,
            "risk_assessment": risk_assessment,
            "compensating_controls": compensating_controls,
            "source": "ai"
        }
    except Exception as exc:
        logger.warning(f"Policy exception suggestion fallback used: {exc}")
        return _fallback_exception_suggestion(title, document)


def _make_snippet(text: str, term: str, width: int = 180) -> str:
    """Return a short context window around the first occurrence of `term`."""
    if not text:
        return ""
    low = text.lower()
    idx = low.find((term or "").lower())
    if idx < 0:
        return text[:width].strip()
    start = max(0, idx - width // 2)
    end = min(len(text), idx + len(term) + width // 2)
    snippet = text[start:end].strip()
    return ("… " if start > 0 else "") + snippet + (" …" if end < len(text) else "")


def _fallback_candidate_exceptions(documents) -> list:
    """Deterministic candidate suggestions when the LLM is unavailable — keeps the
    feature working (no hard failure) without an API key."""
    out = []
    for d in documents:
        if d is None:
            continue
        name = (d.title or "this policy").strip()
        out.append({
            "document_id": d.id,
            "document_title": d.title,
            "suggested_title": f"Temporary exception to {name}",
            "rationale": (
                f"Operational or technical constraints may require a time-bound deviation from '{name}'. "
                "Review the policy's mandatory controls and confirm whether an exception with compensating "
                "controls is warranted."
            ),
            "suggested_priority": "medium",
            "source": "template",
        })
    return out


def _generate_candidate_exceptions(documents, focus: Optional[GovernanceDocument], limit: int) -> dict:
    """AI-driven suggestion of candidate policy exceptions across (or within) policies.
    Mirrors `_generate_exception_suggestion`: same client/env pattern, strict-JSON
    parsing, and graceful template fallback so it never raises to the caller."""
    pool = [focus] if focus is not None else list(documents or [])
    if not _check_ai_available() or not pool:
        return {"source": "template", "candidates": _fallback_candidate_exceptions(pool)[:limit]}

    try:
        from openai import OpenAI

        api_key = get_openai_api_key()
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
        model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or get_openai_model()
        client = OpenAI(api_key=api_key, base_url=base_url)

        if focus is not None:
            corpus = "\n".join([
                f"Policy id: {focus.id}",
                f"Policy title: {focus.title or ''}",
                f"Policy type: {focus.doc_type or ''}",
                f"Policy content excerpt: {(focus.content or '')[:4000]}",
            ])
            instruction = (
                f"Analyze the SINGLE policy below and propose up to {limit} realistic policy EXCEPTION candidates "
                "an organization might legitimately need to request against it."
            )
        else:
            parts = []
            for d in (documents or [])[:15]:
                excerpt = ((d.description or d.content or "")[:300]).strip().replace("\n", " ")
                parts.append(f"- id={d.id} | {d.title or ''} ({d.doc_type or 'policy'}): {excerpt}")
            corpus = "\n".join(parts)
            instruction = (
                f"Analyze the policies below and propose up to {limit} realistic policy EXCEPTION candidates across them "
                "(the deviations organizations most commonly need to request)."
            )

        prompt = (
            f"{instruction} You are a GRC governance specialist. Respond as STRICT JSON only with this shape: "
            '{"candidates": [{"document_id": <int>, "suggested_title": <string>, "rationale": <string>, '
            '"suggested_priority": "low|medium|high|critical"}]}. '
            "Only use document_id values that appear in the input. Keep each rationale to 1-2 sentences.\n\n"
            f"Policies:\n{corpus}"
        )

        completion = client.chat.completions.create(
            model=model,
            temperature=0.4,
            messages=[
                {"role": "system", "content": "Respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
        )
        content = completion.choices[0].message.content if completion.choices else ""
        parsed = _parse_json_response(content or "") or {}
        raw = parsed.get("candidates") if isinstance(parsed, dict) else None

        valid_ids = {d.id for d in pool} | {d.id for d in (documents or [])}
        title_by_id = {d.id: d.title for d in pool}
        for d in (documents or []):
            title_by_id.setdefault(d.id, d.title)

        candidates = []
        if isinstance(raw, list):
            for c in raw:
                if not isinstance(c, dict):
                    continue
                try:
                    did = int(c.get("document_id"))
                except (TypeError, ValueError):
                    continue
                if did not in valid_ids:
                    continue
                st = str(c.get("suggested_title") or "").strip()
                if not st:
                    continue
                pr = str(c.get("suggested_priority") or "medium").strip().lower()
                if pr not in ("low", "medium", "high", "critical"):
                    pr = "medium"
                candidates.append({
                    "document_id": did,
                    "document_title": title_by_id.get(did),
                    "suggested_title": st,
                    "rationale": str(c.get("rationale") or "").strip(),
                    "suggested_priority": pr,
                    "source": "ai",
                })

        if not candidates:
            return {"source": "template", "candidates": _fallback_candidate_exceptions(pool)[:limit]}
        return {"source": "ai", "candidates": candidates[:limit]}
    except Exception as exc:
        logger.warning(f"Candidate exception suggestion fallback used: {exc}")
        return {"source": "template", "candidates": _fallback_candidate_exceptions(pool)[:limit]}


@router.get("/expiring-soon")
def get_expiring_soon(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    now = datetime.utcnow()
    threshold = now + timedelta(days=30)

    exceptions = db.query(PolicyException).filter(
        PolicyException.tenant_id.in_(user_tenants),
        PolicyException.status == "approved",
        PolicyException.expiry_date != None,
        PolicyException.expiry_date <= threshold,
        PolicyException.expiry_date >= now
    ).order_by(PolicyException.expiry_date.asc()).all()
    return [_exception_to_dict(e, db) for e in exceptions]


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"total": 0, "by_status": {}, "by_priority": {}}

    exceptions = db.query(PolicyException).filter(
        PolicyException.tenant_id.in_(user_tenants)
    ).all()

    by_status = {}
    by_priority = {}
    for e in exceptions:
        by_status[e.status] = by_status.get(e.status, 0) + 1
        by_priority[e.priority] = by_priority.get(e.priority, 0) + 1

    now = datetime.utcnow()
    expiring_soon = sum(1 for e in exceptions if e.status == "approved" and e.expiry_date and e.expiry_date <= now + timedelta(days=30) and e.expiry_date >= now)

    return {
        "total": len(exceptions),
        "pending_approval": by_status.get("pending_approval", 0),
        "approved": by_status.get("approved", 0),
        "expiring_soon": expiring_soon,
        "by_status": by_status,
        "by_priority": by_priority
    }


@router.get("")
def list_exceptions(
    status_filter: Optional[str] = Query(None, alias="status"),
    document_id: Optional[int] = Query(None),
    priority: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(PolicyException).filter(
        PolicyException.tenant_id.in_(user_tenants)
    )

    if status_filter:
        query = query.filter(PolicyException.status == status_filter)
    if document_id:
        query = query.filter(PolicyException.document_id == document_id)
    if priority:
        query = query.filter(PolicyException.priority == priority)

    exceptions = query.order_by(PolicyException.created_at.desc()).offset(skip).limit(limit).all()
    return [_exception_to_dict(e, db) for e in exceptions]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_exception(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant")

    user_tenants = get_user_tenants(current_user, db)
    
    if data.get("document_id"):
        doc = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == data["document_id"],
            GovernanceDocument.tenant_id.in_(user_tenants)
        ).first()
        if not doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    exception = PolicyException(
        tenant_id=tenant_id,
        document_id=data.get("document_id"),
        title=data.get("title"),
        description=data.get("description"),
        justification=data.get("justification"),
        risk_assessment=data.get("risk_assessment"),
        compensating_controls=data.get("compensating_controls"),
        requested_by=current_user.id,
        status="draft",
        priority=data.get("priority", "medium"),
        effective_date=datetime.fromisoformat(data["effective_date"]) if data.get("effective_date") else None,
        expiry_date=datetime.fromisoformat(data["expiry_date"]) if data.get("expiry_date") else None,
        review_date=datetime.fromisoformat(data["review_date"]) if data.get("review_date") else None,
        metadata_=data.get("metadata", {})
    )
    db.add(exception)
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


@router.post("/suggest-content")
def suggest_exception_content(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant access")

    title = str((data or {}).get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")

    document_id = (data or {}).get("document_id")
    if not document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document_id is required")

    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == int(document_id),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    suggestion = _generate_exception_suggestion(title, doc)
    return {
        "title": title,
        "document_id": doc.id,
        "document_title": doc.title,
        "justification": suggestion.get("justification", ""),
        "risk_assessment": suggestion.get("risk_assessment", ""),
        "compensating_controls": suggestion.get("compensating_controls", ""),
        "source": suggestion.get("source", "template"),
    }


# NOTE: the two routes below are intentionally declared BEFORE `/{exception_id}`.
# FastAPI matches in declaration order, so a literal path like `/search-policies`
# must come first or it would be captured by the `{exception_id}` path param.
@router.get("/search-policies")
def search_policies(
    q: str = Query(..., min_length=1, description="Sentence or keyword to search across policy content"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Search any sentence/keyword across governance policy/document CONTENT and
    parsed policy statements (clauses), for the exceptions workflow. Read-only,
    tenant-scoped, ILIKE-based; returns matched policies with a context snippet."""
    user_tenants = get_user_tenants(current_user, db)
    term = (q or "").strip()
    if not user_tenants or not term:
        return {"query": term, "count": 0, "results": []}

    like = f"%{term}%"
    results = []
    seen_docs = set()

    # 1) Document-level matches (title / description / full content)
    docs = (
        db.query(GovernanceDocument)
        .filter(
            GovernanceDocument.tenant_id.in_(user_tenants),
            GovernanceDocument.doc_type.ilike("policy"),
            or_(
                GovernanceDocument.title.ilike(like),
                GovernanceDocument.description.ilike(like),
                GovernanceDocument.content.ilike(like),
            ),
        )
        .order_by(GovernanceDocument.updated_at.desc())
        .limit(limit)
        .all()
    )
    tl = term.lower()
    for d in docs:
        if tl in (d.title or "").lower():
            field, src = "title", d.title or ""
        elif tl in (d.description or "").lower():
            field, src = "description", d.description or ""
        else:
            field, src = "content", d.content or ""
        results.append({
            "document_id": d.id,
            "document_title": d.title,
            "doc_type": d.doc_type,
            "document_code": getattr(d, "document_code", None),
            "match_field": field,
            "snippet": _make_snippet(src, term),
            "statement_id": None,
            "statement_code": None,
        })
        seen_docs.add(d.id)

    # 2) Clause-level matches via parsed PolicyStatement rows (best-effort).
    if len(results) < limit:
        try:
            from ..models import PolicyStatement
            rows = (
                db.query(PolicyStatement, GovernanceDocument)
                .join(GovernanceDocument, GovernanceDocument.id == PolicyStatement.document_id)
                .filter(
                    GovernanceDocument.tenant_id.in_(user_tenants),
                    GovernanceDocument.doc_type.ilike("policy"),
                    PolicyStatement.statement_text.ilike(like),
                )
                .limit((limit - len(results)) * 2)
                .all()
            )
            for s, d in rows:
                results.append({
                    "document_id": d.id,
                    "document_title": d.title,
                    "doc_type": d.doc_type,
                    "document_code": getattr(d, "document_code", None),
                    "match_field": "policy_statement",
                    "snippet": _make_snippet(s.statement_text or "", term),
                    "statement_id": s.id,
                    "statement_code": getattr(s, "statement_code", None),
                })
                if len(results) >= limit:
                    break
        except Exception as exc:  # noqa: BLE001 — clause search is a best-effort enrichment
            logger.info(f"policy statement search skipped: {exc}")

    return {"query": term, "count": len(results), "results": results[:limit]}


@router.get("/suggest-candidates")
def suggest_candidate_exceptions(
    document_id: Optional[int] = Query(None, description="Focus on one policy; omit to scan across policies"),
    limit: int = Query(8, ge=1, le=15),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """AI-driven, automatic suggestion of policy EXCEPTION candidates — either
    across the tenant's policies (no document_id) or focused on one policy.
    Falls back to deterministic template suggestions when AI is unavailable."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"source": "template", "candidates": []}

    focus = None
    if document_id:
        focus = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == int(document_id),
            GovernanceDocument.tenant_id.in_(user_tenants),
            GovernanceDocument.doc_type.ilike("policy"),
        ).first()
        if not focus:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Policy not found — exceptions can only be raised against policy documents",
            )
        documents = [focus]
    else:
        # Exceptions can ONLY be raised against policies — never scan procedures,
        # standards, guidelines, charters or other document types.
        documents = (
            db.query(GovernanceDocument)
            .filter(
                GovernanceDocument.tenant_id.in_(user_tenants),
                GovernanceDocument.doc_type.ilike("policy"),
            )
            .order_by(GovernanceDocument.updated_at.desc())
            .limit(25)
            .all()
        )

    return _generate_candidate_exceptions(documents, focus, limit)


@router.get("/{exception_id}")
def get_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    return _exception_to_dict(exception, db)


@router.put("/{exception_id}")
def update_exception(
    exception_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")

    # Validate document_id if provided
    if "document_id" in data and data["document_id"]:
        doc = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == data["document_id"],
            GovernanceDocument.tenant_id.in_(user_tenants)
        ).first()
        if not doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    updatable = ["title", "description", "justification", "risk_assessment",
                 "compensating_controls", "priority", "document_id"]
    for field in updatable:
        if field in data:
            setattr(exception, field, data[field])

    for date_field in ["effective_date", "expiry_date", "review_date"]:
        if date_field in data:
            setattr(exception, date_field, datetime.fromisoformat(data[date_field]) if data[date_field] else None)

    if "metadata" in data:
        exception.metadata_ = data["metadata"]

    exception.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


@router.delete("/{exception_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    if exception.status != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft exceptions can be deleted")
    db.delete(exception)
    db.commit()
    return None


@router.post("/{exception_id}/submit")
def submit_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    if exception.status != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft exceptions can be submitted")

    exception.status = "pending_approval"
    exception.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


def _is_tenant_administrator(user: GRCUser, db: Session) -> bool:
    """True when the user has the Administrator system role OR is the
    tenant's primary contact. Used to bypass separation-of-duties
    checks on tenants where the same person both raised and approves
    a request (typical single-admin SaaS deployments).

    `db` is already bound to the user's tenant DB (we're inside a
    request that resolved tenant context), so:
      * Role lookup goes through UserRole rows in the tenant DB.
      * Primary-contact lookup uses the tenant's self-row (every
        tenant DB carries one Tenant row describing itself).
    """
    from ..models import Role, UserRole, Tenant
    # Administrator role bypass
    try:
        admin_role_rows = (
            db.query(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .filter(UserRole.user_id == user.id, Role.name == "Administrator")
            .all()
        )
        if admin_role_rows:
            return True
    except Exception:
        pass
    # Primary-contact bypass. Per-tenant DB normally has exactly one
    # Tenant row (its own self-row). The match is case-insensitive.
    try:
        tenant_row = db.query(Tenant).first()
        if (
            tenant_row
            and tenant_row.primary_contact_email
            and user.email
            and tenant_row.primary_contact_email.lower() == user.email.lower()
        ):
            return True
    except Exception:
        pass
    return False


@router.post("/{exception_id}/approve")
def approve_exception(
    exception_id: int,
    data: dict = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    if exception.status != "pending_approval":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending exceptions can be approved")
    # Separation-of-duties guard: a regular user can't approve the
    # exception they raised themselves. Administrators bypass — a
    # single-admin tenant would otherwise have no path to clear its
    # own queue, which is the common SaaS reality. The audit log
    # still records *which* admin approved + that they were the
    # original requester, so any policy review can trace it.
    if exception.requested_by == current_user.id and not _is_tenant_administrator(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Cannot approve your own exception request. "
                    "Ask a tenant Administrator (or the primary contact) to approve.")
        )

    exception.status = "approved"
    exception.approved_by = current_user.id
    exception.approved_at = datetime.utcnow()
    exception.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


@router.post("/{exception_id}/reject")
def reject_exception(
    exception_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    if exception.status != "pending_approval":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending exceptions can be rejected")

    exception.status = "rejected"
    exception.rejected_by = current_user.id
    exception.rejected_at = datetime.utcnow()
    exception.rejection_reason = data.get("rejection_reason") or data.get("reason", "")
    exception.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


@router.post("/{exception_id}/revoke")
def revoke_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    if exception.status != "approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only approved exceptions can be revoked")

    exception.status = "revoked"
    exception.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(exception)
    return _exception_to_dict(exception, db)


@router.get("/{exception_id}/comments")
def list_comments(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")

    comments = db.query(PolicyExceptionComment).filter(
        PolicyExceptionComment.exception_id == exception_id
    ).order_by(PolicyExceptionComment.created_at.asc()).all()

    result = []
    for c in comments:
        user = db.query(GRCUser).filter(GRCUser.id == c.user_id).first()
        result.append({
            "id": c.id,
            "exception_id": c.exception_id,
            "user_id": c.user_id,
            "user_name": (user.display_name or user.username) if user else None,
            "comment": c.comment,
            "created_at": c.created_at.isoformat() if c.created_at else None
        })
    return result


@router.post("/{exception_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    exception_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    exception = db.query(PolicyException).filter(
        PolicyException.id == exception_id,
        PolicyException.tenant_id.in_(user_tenants)
    ).first()
    if not exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")

    comment = PolicyExceptionComment(
        exception_id=exception_id,
        user_id=current_user.id,
        comment=data.get("comment", "")
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return {
        "id": comment.id,
        "exception_id": comment.exception_id,
        "user_id": comment.user_id,
        "user_name": current_user.display_name or current_user.username,
        "comment": comment.comment,
        "created_at": comment.created_at.isoformat() if comment.created_at else None
    }


def _exception_to_dict(exc: PolicyException, db: Session) -> dict:
    requester = db.query(GRCUser).filter(GRCUser.id == exc.requested_by).first() if exc.requested_by else None
    approver = db.query(GRCUser).filter(GRCUser.id == exc.approved_by).first() if exc.approved_by else None
    doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == exc.document_id).first() if exc.document_id else None

    return {
        "id": exc.id,
        "tenant_id": exc.tenant_id,
        "document_id": exc.document_id,
        "document_title": doc.title if doc else None,
        "title": exc.title,
        "description": exc.description,
        "justification": exc.justification,
        "risk_assessment": exc.risk_assessment,
        "compensating_controls": exc.compensating_controls,
        "requested_by": exc.requested_by,
        "requester_name": (requester.display_name or requester.username) if requester else None,
        "status": exc.status,
        "priority": exc.priority,
        "requested_at": exc.requested_at.isoformat() if exc.requested_at else None,
        "approved_by": exc.approved_by,
        "approver_name": (approver.display_name or approver.username) if approver else None,
        "approved_at": exc.approved_at.isoformat() if exc.approved_at else None,
        "rejected_by": exc.rejected_by,
        "rejected_at": exc.rejected_at.isoformat() if exc.rejected_at else None,
        "rejection_reason": exc.rejection_reason,
        "effective_date": exc.effective_date.isoformat() if exc.effective_date else None,
        "expiry_date": exc.expiry_date.isoformat() if exc.expiry_date else None,
        "review_date": exc.review_date.isoformat() if exc.review_date else None,
        "is_expired": exc.is_expired,
        "created_at": exc.created_at.isoformat() if exc.created_at else None,
        "updated_at": exc.updated_at.isoformat() if exc.updated_at else None,
        "metadata": exc.metadata_,
        "comments_count": len(exc.comments) if exc.comments else 0
    }
