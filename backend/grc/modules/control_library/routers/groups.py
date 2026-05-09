import os
import json
import uuid
import logging
import threading
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, distinct
from pydantic import BaseModel
from openai import OpenAI

from ....job_status import set_status as set_job_status, get_status as get_job_status

_jobs_logger = logging.getLogger(__name__)

from ....models import (
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    GRCUser, get_db, ParsedFrameworkControl, UploadedFramework
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/groups", tags=["Control Library - Groups"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class CommonControlGroupCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    keywords: Optional[List[str]] = None
    evidence_types: Optional[List[str]] = None


class CommonControlGroupUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    keywords: Optional[List[str]] = None
    evidence_types: Optional[List[str]] = None
    ai_summary: Optional[str] = None


class GroupMappingCreate(BaseModel):
    normalized_control_ids: Optional[List[int]] = []
    framework_control_ids: Optional[List[int]] = []
    parsed_control_ids: Optional[List[int]] = []


class AutoGroupRequest(BaseModel):
    framework_ids: Optional[List[int]] = None


class GenerateSummaryRequest(BaseModel):
    regenerate_keywords: bool = True


def check_ai_available() -> bool:
    """Check if OpenAI API is configured (Replit AI Integrations or direct API key)."""
    ai_integration_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    if ai_integration_key:
        return True
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key and not api_key.startswith("your-") and len(api_key) >= 20:
        return True
    return False


def raise_ai_unavailable(fallback_available: bool = False):
    """Raise HTTP 503 error when AI features are unavailable."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "AI features unavailable",
            "message": "AI integration is not configured. The platform uses Replit AI Integrations or you can add OPENAI_API_KEY to enable AI features.",
            "fallback_available": fallback_available
        }
    )


def get_openai_client() -> OpenAI:
    if not check_ai_available():
        raise_ai_unavailable(fallback_available=False)
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


def generate_keywords_for_group(name: str, description: str) -> List[str]:
    try:
        client = get_openai_client()
        prompt = f"""Extract 5-10 key compliance/security terms from this control group:

Name: {name}
Description: {description or 'No description provided'}

Return JSON: {{"keywords": ["term1", "term2", ...]}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Extract compliance keywords. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=500,
            temperature=0.3
        )
        result = json.loads(response.choices[0].message.content or '{"keywords": []}')
        return result.get("keywords", [])
    except Exception:
        return []


def generate_group_summary(controls_text: str) -> dict:
    try:
        client = get_openai_client()
        prompt = f"""Analyze these related compliance controls and generate:
1. A summary describing their common purpose
2. Key terms/keywords that characterize these controls

Controls:
{controls_text[:4000]}

Return JSON:
{{
    "summary": "<2-3 sentence summary of the control group's purpose>",
    "keywords": ["keyword1", "keyword2", ...],
    "evidence_types": ["<suggested evidence types>"]
}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert summarizing control groups. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1000,
            temperature=0.3
        )
        return json.loads(response.choices[0].message.content or '{}')
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI summary generation failed: {error_msg}"
        )


# Tunables for AI grouping. Single-shot calls work well up to ~80 controls; for
# anything larger we batch + merge so the model never runs out of output tokens
# and silently drops controls (the original bug — `[:100]` slice + max_tokens=4000
# meant ~70% of selected frameworks' controls never made it into a group).
_AI_GROUP_BATCH_SIZE = 60
_AI_GROUP_MAX_TOKENS = 8000


import re as _re_mod  # local alias to avoid clashing with module-level re uses


def _canonicalize_group_name(name: str) -> str:
    """Strict canonical form for cross-batch group merging.
    'Access Control', 'access-control', 'Access  Control!' → 'accesscontrol'.
    Without this, 'Identity & Access Management' and 'Identity and Access Management'
    stay separate after merging — which is why each framework's controls were
    landing in their own siloed group.
    """
    if not name:
        return ""
    s = name.lower().replace("&", "and")
    return _re_mod.sub(r"[^a-z0-9]+", "", s)


def _interleave_by_framework(controls_list: List[dict]) -> List[dict]:
    """Round-robin interleave controls so each batch sees representation from
    every selected framework. Without this, batches were sequential by
    framework (60 from framework A → 60 from framework B → …) and the AI
    produced framework-siloed groups since each batch only saw one source.
    """
    by_fw: Dict[str, List[dict]] = {}
    fw_order: List[str] = []
    for c in controls_list:
        fw = c.get("framework") or "Unknown"
        if fw not in by_fw:
            by_fw[fw] = []
            fw_order.append(fw)
        by_fw[fw].append(c)
    interleaved: List[dict] = []
    cursors = {fw: 0 for fw in fw_order}
    while True:
        progressed = False
        for fw in fw_order:
            idx = cursors[fw]
            if idx < len(by_fw[fw]):
                interleaved.append(by_fw[fw][idx])
                cursors[fw] = idx + 1
                progressed = True
        if not progressed:
            break
    return interleaved


def _build_grouping_prompt(
    controls_text: str,
    target_groups_hint: str,
    framework_summary: str,
    existing_themes: Optional[List[str]] = None,
) -> str:
    existing_block = ""
    if existing_themes:
        bullets = "\n".join(f"  - {t}" for t in existing_themes[:25])
        existing_block = (
            "\nEXISTING GROUP THEMES from earlier batches (REUSE these names verbatim "
            "when they fit — do not invent a near-duplicate):\n"
            f"{bullets}\n"
        )
    return (
        "Analyze these compliance controls and group them by common cybersecurity "
        "purpose/theme. Create CROSS-FRAMEWORK groups: a single group should pull "
        "in semantically equivalent controls from every framework that has them.\n\n"
        f"Frameworks present in this set: {framework_summary}\n"
        "STRICT RULES:\n"
        "1. EVERY control listed below MUST appear in exactly one group. Do not skip any.\n"
        "2. Use the integer ID and exact type tag (normalized | parsed) when emitting control_ids.\n"
        "3. PREFER cross-framework groups. If two frameworks both cover 'access control', "
        "their controls go in the SAME group — never split into two groups by framework.\n"
        "4. Pick stable, generic group names (e.g. 'Access Control', 'Logging & Monitoring', "
        "'Vulnerability Management') so the same name is used across batches.\n"
        f"5. {target_groups_hint}\n"
        f"{existing_block}\n"
        f"Controls:\n{controls_text}\n\n"
        "Return JSON with groups:\n"
        "{\n"
        '  "groups": [\n'
        "    {\n"
        '      "code": "<short code like CCG-001>",\n'
        '      "name": "<stable, generic group name>",\n'
        '      "description": "<group description>",\n'
        '      "category": "<category like Access Control, Data Protection, etc>",\n'
        '      "domain": "<domain like Security, Privacy, etc>",\n'
        '      "keywords": ["keyword1", "keyword2"],\n'
        '      "control_ids": [ {"id": <control_id>, "type": "normalized|parsed"} ]\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )


def _format_controls_block(controls_list: List[dict]) -> str:
    return "\n\n".join([
        f"Control {i+1} (ID: {c['id']}, Type: {c['type']}, Framework: {c.get('framework', 'N/A')}):\n"
        f"Code: {c['code']}\nName: {c['name']}\nStatement: {(c.get('statement') or '')[:400]}"
        for i, c in enumerate(controls_list)
    ])


def _summarize_frameworks(controls_list: List[dict]) -> str:
    counts: Dict[str, int] = {}
    for c in controls_list:
        fw = c.get("framework") or "Unknown"
        counts[fw] = counts.get(fw, 0) + 1
    return ", ".join(f"{fw} ({n})" for fw, n in sorted(counts.items()))


def _ai_group_single_batch(
    client,
    controls_list: List[dict],
    target_groups_hint: str,
    existing_themes: Optional[List[str]] = None,
) -> List[dict]:
    controls_text = _format_controls_block(controls_list)
    framework_summary = _summarize_frameworks(controls_list)
    prompt = _build_grouping_prompt(controls_text, target_groups_hint, framework_summary, existing_themes)
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": (
                "You are a compliance expert grouping related controls across multiple "
                "regulatory frameworks. Every control provided MUST appear in exactly one "
                "group. PREFER cross-framework groups — semantically equivalent controls "
                "from different frameworks belong in the SAME group. Respond only with "
                "valid JSON."
            )},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        max_tokens=_AI_GROUP_MAX_TOKENS,
        temperature=0.2,
    )
    result = json.loads(response.choices[0].message.content or '{"groups": []}')
    return result.get("groups", [])


def _merge_ai_groups(group_batches: List[List[dict]]) -> List[dict]:
    """Merge groups produced from separate batches by canonicalized name.
    Uses a strict alphanumeric-only canonical key so 'Access Control',
    'access-control', and 'Access & Control' all collapse to one group.
    """
    merged: Dict[str, dict] = {}
    for batch in group_batches:
        for g in batch:
            name = (g.get("name") or "").strip()
            if not name:
                continue
            key = _canonicalize_group_name(name)
            if not key:
                continue
            if key not in merged:
                merged[key] = {
                    "code": g.get("code"),
                    "name": name,
                    "description": g.get("description"),
                    "category": g.get("category"),
                    "domain": g.get("domain"),
                    "keywords": list(g.get("keywords") or []),
                    "control_ids": [],
                }
            existing = merged[key]
            seen = {(c.get("id"), c.get("type")) for c in existing["control_ids"]}
            for c in g.get("control_ids") or []:
                tup = (c.get("id"), c.get("type"))
                if tup not in seen and c.get("id") is not None:
                    existing["control_ids"].append(c)
                    seen.add(tup)
            for kw in g.get("keywords") or []:
                if kw not in existing["keywords"]:
                    existing["keywords"].append(kw)
            for fld in ("description", "category", "domain"):
                if not existing.get(fld) and g.get(fld):
                    existing[fld] = g[fld]
    return list(merged.values())


def ai_auto_group_controls(controls_list: List[dict]) -> List[dict]:
    """Group an arbitrarily large list of controls via OpenAI.

    Honors every control passed in (no silent truncation). Interleaves
    controls round-robin by framework BEFORE batching so each batch sees
    cross-framework variety; passes existing themes from earlier batches
    into later ones so the model reuses names verbatim; merges by canonical
    name so identical themes consolidate.
    """
    if not controls_list:
        return []
    try:
        client = get_openai_client()

        total = len(controls_list)
        if total <= _AI_GROUP_BATCH_SIZE:
            target_hint = (
                f"Produce as many groups as the {total} controls naturally cluster into "
                "(typically 4-15 groups; aim for ~8-15 controls per group). "
                "Each group should mix controls from every framework that has matching content."
            )
            return _ai_group_single_batch(client, controls_list, target_hint)

        # Round-robin interleave by framework so each batch contains controls
        # from every selected framework (the original bug was sequential
        # batching → each batch only saw 1-2 frameworks → siloed groups).
        controls_list = _interleave_by_framework(controls_list)

        # Batch the (now interleaved) controls and merge results.
        batches: List[List[dict]] = [
            controls_list[i:i + _AI_GROUP_BATCH_SIZE]
            for i in range(0, total, _AI_GROUP_BATCH_SIZE)
        ]
        target_hint = (
            "Produce groups that match common compliance themes (NCA / ISO / NIST domains). "
            "Aim for 4-10 groups per batch with ~6-15 controls each, but cover ALL controls. "
            "Within a single group, mix controls from EVERY framework whose controls match the theme."
        )
        batch_results: List[List[dict]] = []
        existing_theme_names: List[str] = []
        seen_theme_keys: set = set()
        for batch in batches:
            # Pass canonical theme names from earlier batches so the model
            # reuses them verbatim instead of inventing near-duplicates that
            # the merger then has to chase down.
            groups = _ai_group_single_batch(
                client, batch, target_hint, existing_themes=existing_theme_names or None,
            )
            batch_results.append(groups)
            for g in groups:
                nm = (g.get("name") or "").strip()
                key = _canonicalize_group_name(nm)
                if nm and key and key not in seen_theme_keys:
                    existing_theme_names.append(nm)
                    seen_theme_keys.add(key)
        return _merge_ai_groups(batch_results)
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI auto-grouping failed: {error_msg}"
        )


# ─── Reusable helpers for auto-grouping (used by both the sync route and the
#     Celery worker task) ────────────────────────────────────────────────────

def _fetch_controls_for_grouping(
    db: Session, tenant_id: int, framework_ids: Optional[List[int]] = None
) -> List[dict]:
    """Return the canonical control payload list that feeds AI auto-grouping.
    Honours `framework_ids` filter — when set, only that subset is included
    (and normalized controls are excluded so they don't pollute the run).
    """
    controls_list: List[dict] = []
    framework_ids = list(framework_ids or [])
    framework_filter_active = bool(framework_ids)

    if not framework_filter_active:
        for nc in db.query(NormalizedControl).all():
            controls_list.append({
                "id": nc.id,
                "type": "normalized",
                "code": nc.code,
                "name": nc.name,
                "statement": nc.statement or nc.objective or "",
                "framework": "Normalized",
            })

    parsed_query = db.query(ParsedFrameworkControl).join(
        UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
    ).filter(
        or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.tenant_id.is_(None))
    )
    if framework_filter_active:
        parsed_query = parsed_query.filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(framework_ids)
        )
    parsed_controls = parsed_query.all()

    fw_id_to_name: Dict[int, str] = {}
    if parsed_controls:
        framework_ids_seen = list({pc.uploaded_framework_id for pc in parsed_controls})
        for fw in db.query(UploadedFramework).filter(UploadedFramework.id.in_(framework_ids_seen)).all():
            fw_id_to_name[fw.id] = fw.name

    for pc in parsed_controls:
        controls_list.append({
            "id": pc.id,
            "type": "parsed",
            "code": pc.original_reference or pc.control_id,
            "name": pc.title,
            "statement": pc.description or (pc.full_text[:400] if pc.full_text else ""),
            "framework": fw_id_to_name.get(pc.uploaded_framework_id, "Unknown"),
        })
    return controls_list


def _coerce_int(val: Any) -> Optional[int]:
    """Some LLM responses return numeric ids as strings. Normalise so the
    DB filter doesn't silently miss the row."""
    if val is None:
        return None
    if isinstance(val, int):
        return val
    try:
        return int(str(val).strip())
    except (TypeError, ValueError):
        return None


def persist_ai_groups(
    db: Session, tenant_id: int, user_id: Optional[int], ai_groups: List[dict]
) -> Dict[str, Any]:
    """Take the raw AI-suggested groups and persist them as `CommonControlGroup`
    + `CommonControlGroupMapping` rows. Idempotent on (tenant, group name) and
    (group, control) — re-running an identical grouping won't duplicate rows.
    Returns a summary dict with counts + the affected group ids.
    """
    created_groups: List[CommonControlGroup] = []
    merged_groups: List[CommonControlGroup] = []
    mapping_count = 0

    for group_data in ai_groups:
        group_name = (group_data.get("name") or "").strip() or "Auto-generated Group"

        existing_by_name = db.query(CommonControlGroup).filter(
            CommonControlGroup.tenant_id == tenant_id,
            func.lower(CommonControlGroup.name) == group_name.lower()
        ).first()

        if existing_by_name:
            group = existing_by_name
            merged_groups.append(group)
        else:
            code = (group_data.get("code") or f"CCG-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}").strip()
            existing_code = db.query(CommonControlGroup).filter(
                CommonControlGroup.tenant_id == tenant_id,
                CommonControlGroup.code == code
            ).first()
            if existing_code:
                code = f"{code}-{datetime.utcnow().strftime('%f')}"

            group = CommonControlGroup(
                tenant_id=tenant_id,
                code=code,
                name=group_name,
                description=group_data.get("description"),
                category=group_data.get("category"),
                domain=group_data.get("domain"),
                keywords=group_data.get("keywords") or [],
                created_by=user_id,
            )
            db.add(group)
            db.flush()
            created_groups.append(group)

        for ctrl in group_data.get("control_ids") or []:
            ctrl_id = _coerce_int(ctrl.get("id"))
            ctrl_type = (ctrl.get("type") or "").strip().lower()
            if ctrl_id is None:
                continue

            if ctrl_type == "normalized":
                exists_q = db.query(CommonControlGroupMapping).filter(
                    CommonControlGroupMapping.group_id == group.id,
                    CommonControlGroupMapping.normalized_control_id == ctrl_id,
                ).first()
                if not exists_q:
                    db.add(CommonControlGroupMapping(
                        group_id=group.id,
                        normalized_control_id=ctrl_id,
                        mapping_source="ai",
                        mapping_confidence=0.8,
                    ))
                    mapping_count += 1
            elif ctrl_type in ("parsed", "framework"):
                # The old prompt allowed "framework"; we still accept it for
                # backwards-compat but always store it as a parsed mapping.
                exists_q = db.query(CommonControlGroupMapping).filter(
                    CommonControlGroupMapping.group_id == group.id,
                    CommonControlGroupMapping.parsed_control_id == ctrl_id,
                ).first()
                if not exists_q:
                    db.add(CommonControlGroupMapping(
                        group_id=group.id,
                        parsed_control_id=ctrl_id,
                        mapping_source="ai",
                        mapping_confidence=0.8,
                    ))
                    mapping_count += 1

    db.commit()
    return {
        "created_count": len(created_groups),
        "merged_count": len(merged_groups),
        "mapping_count": mapping_count,
        "created_group_ids": [g.id for g in created_groups],
        "merged_group_ids": [g.id for g in merged_groups],
    }


def serialize_group(group: CommonControlGroup, db: Session, include_controls: bool = False) -> dict:
    normalized_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group.id,
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).count()
    
    framework_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group.id,
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).count()
    
    parsed_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group.id,
        CommonControlGroupMapping.parsed_control_id.isnot(None)
    ).count()
    
    result = {
        "id": group.id,
        "tenant_id": group.tenant_id,
        "code": group.code,
        "name": group.name,
        "description": group.description,
        "category": group.category,
        "domain": group.domain,
        "keywords": group.keywords or [],
        "ai_summary": group.ai_summary,
        "evidence_types": group.evidence_types or [],
        "normalized_control_count": normalized_count,
        "framework_control_count": framework_count,
        "parsed_control_count": parsed_count,
        "total_control_count": normalized_count + framework_count + parsed_count,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "updated_at": group.updated_at.isoformat() if group.updated_at else None,
        "created_by": group.created_by
    }
    
    if include_controls:
        mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group.id
        ).all()
        
        normalized_controls = []
        framework_controls = []
        parsed_controls = []
        
        for mapping in mappings:
            if mapping.normalized_control_id:
                nc = db.query(NormalizedControl).filter(
                    NormalizedControl.id == mapping.normalized_control_id
                ).first()
                if nc:
                    normalized_controls.append({
                        "mapping_id": mapping.id,
                        "control_id": nc.id,
                        "code": nc.code,
                        "name": nc.name,
                        "statement": nc.statement,
                        "mapping_confidence": mapping.mapping_confidence,
                        "mapping_source": mapping.mapping_source
                    })
            
            if mapping.framework_control_id:
                fc = db.query(FrameworkControl).options(
                    joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
                ).filter(
                    FrameworkControl.id == mapping.framework_control_id
                ).first()
                if fc:
                    framework = fc.objective.domain.framework if fc.objective and fc.objective.domain else None
                    framework_controls.append({
                        "mapping_id": mapping.id,
                        "control_id": fc.id,
                        "code": fc.code,
                        "name": fc.name,
                        "statement": fc.statement,
                        "framework_id": framework.id if framework else None,
                        "framework_name": framework.name if framework else None,
                        "framework_code": framework.short_code if framework else None,
                        "mapping_confidence": mapping.mapping_confidence,
                        "mapping_source": mapping.mapping_source
                    })
            
            if mapping.parsed_control_id:
                pc = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.id == mapping.parsed_control_id
                ).first()
                if pc:
                    fw = db.query(UploadedFramework).filter(
                        UploadedFramework.id == pc.uploaded_framework_id
                    ).first()
                    parsed_controls.append({
                        "mapping_id": mapping.id,
                        "control_id": pc.id,
                        "code": pc.original_reference,
                        "name": pc.title,
                        "statement": pc.description or (pc.full_text[:500] if pc.full_text else None),
                        "framework_id": fw.id if fw else None,
                        "framework_name": fw.name if fw else None,
                        "mapping_confidence": mapping.mapping_confidence,
                        "mapping_source": mapping.mapping_source
                    })
        
        result["normalized_controls"] = normalized_controls
        result["framework_controls"] = framework_controls
        result["parsed_controls"] = parsed_controls
    
    return result


@router.get("/categories")
def get_categories(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    categories = db.query(distinct(CommonControlGroup.category)).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        ),
        CommonControlGroup.category.isnot(None)
    ).all()
    
    return {"categories": [c[0] for c in categories if c[0]]}


@router.get("/domains")
def get_domains(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    domains = db.query(distinct(CommonControlGroup.domain)).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        ),
        CommonControlGroup.domain.isnot(None)
    ).all()
    
    return {"domains": [d[0] for d in domains if d[0]]}


@router.get("")
def list_groups(
    category: Optional[str] = None,
    domain: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    )
    
    if category:
        query = query.filter(CommonControlGroup.category == category)
    if domain:
        query = query.filter(CommonControlGroup.domain == domain)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                CommonControlGroup.name.ilike(search_term),
                CommonControlGroup.code.ilike(search_term),
                CommonControlGroup.description.ilike(search_term)
            )
        )
    
    total = query.count()
    groups = query.order_by(CommonControlGroup.code).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_group(g, db) for g in groups],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_group(
    group_data: CommonControlGroupCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    
    existing = db.query(CommonControlGroup).filter(
        CommonControlGroup.tenant_id == tenant_id,
        CommonControlGroup.code == group_data.code
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A group with this code already exists"
        )
    
    keywords = group_data.keywords
    if not keywords and group_data.description:
        keywords = generate_keywords_for_group(group_data.name, group_data.description)
    
    group = CommonControlGroup(
        tenant_id=tenant_id,
        code=group_data.code,
        name=group_data.name,
        description=group_data.description,
        category=group_data.category,
        domain=group_data.domain,
        keywords=keywords or [],
        evidence_types=group_data.evidence_types or [],
        created_by=current_user.id
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db)


@router.get("/{group_id}")
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    return serialize_group(group, db, include_controls=True)


@router.put("/{group_id}")
def update_group(
    group_id: int,
    group_data: CommonControlGroupUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    if group_data.code and group_data.code != group.code:
        existing = db.query(CommonControlGroup).filter(
            CommonControlGroup.tenant_id == group.tenant_id,
            CommonControlGroup.code == group_data.code,
            CommonControlGroup.id != group_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A group with this code already exists"
            )
    
    update_data = group_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(group, field, value)
    
    group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db, include_controls=True)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    db.delete(group)
    db.commit()
    return None


@router.post("/{group_id}/controls")
def add_controls_to_group(
    group_id: int,
    mapping_data: GroupMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    created_mappings = []
    
    for nc_id in (mapping_data.normalized_control_ids or []):
        nc = db.query(NormalizedControl).filter(NormalizedControl.id == nc_id).first()
        if not nc:
            continue
        
        existing = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.normalized_control_id == nc_id
        ).first()
        if existing:
            continue
        
        mapping = CommonControlGroupMapping(
            group_id=group_id,
            normalized_control_id=nc_id,
            mapping_source="manual"
        )
        db.add(mapping)
        created_mappings.append({"type": "normalized", "control_id": nc_id})
    
    for fc_id in (mapping_data.framework_control_ids or []):
        fc = db.query(FrameworkControl).filter(FrameworkControl.id == fc_id).first()
        if not fc:
            continue
        
        existing = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.framework_control_id == fc_id
        ).first()
        if existing:
            continue
        
        mapping = CommonControlGroupMapping(
            group_id=group_id,
            framework_control_id=fc_id,
            mapping_source="manual"
        )
        db.add(mapping)
        created_mappings.append({"type": "framework", "control_id": fc_id})
    
    for pc_id in (mapping_data.parsed_control_ids or []):
        pc = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == pc_id).first()
        if not pc:
            continue
        existing = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.parsed_control_id == pc_id
        ).first()
        if existing:
            continue
        mapping = CommonControlGroupMapping(
            group_id=group_id,
            parsed_control_id=pc_id,
            mapping_source="manual"
        )
        db.add(mapping)
        created_mappings.append({"type": "parsed", "control_id": pc_id})
    
    db.commit()
    
    return {
        "message": f"Added {len(created_mappings)} controls to group",
        "mappings_created": created_mappings,
        "group": serialize_group(group, db, include_controls=True)
    }


@router.delete("/{group_id}/controls/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_control_from_group(
    group_id: int,
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mapping = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.id == mapping_id,
        CommonControlGroupMapping.group_id == group_id
    ).first()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    return None


# ─── Async dispatch + status polling for AI auto-grouping ──────────────────
# Long-running grouping was blocking the request thread for minutes. We now
# run the work in a Python background thread (no separate Celery worker
# process required) and write progress to Redis-backed job_status so the UI
# can poll. The Celery task in `tasks/control_library.py` is still available
# for environments that prefer to scale work onto a worker pool.


def _run_auto_grouping_threaded(
    tenant_slug: str,
    job_id: str,
    framework_ids: List[int],
    user_id: Optional[int],
) -> None:
    """Background worker — opens a dedicated tenant session, runs the full
    auto-grouping pipeline, and reports progress via job_status. Designed to
    be launched from a daemon thread so a long AI call doesn't block the
    request thread or require a separate Celery worker.
    """
    namespace = "control_auto_group"
    db_session = None
    try:
        # Acquire a tenant-scoped DB session that lives independently of the
        # request that started the job.
        from ....db import get_tenant_session_factory
        from ....models import Tenant

        SessionLocal = get_tenant_session_factory(tenant_slug)
        db_session = SessionLocal()

        tenant = db_session.query(Tenant).filter(Tenant.slug == tenant_slug).first()
        if not tenant:
            raise RuntimeError(f"Tenant slug '{tenant_slug}' not found")

        _jobs_logger.info("[auto_group] tenant=%s job=%s — loading controls", tenant_slug, job_id)
        set_job_status(tenant_slug, namespace, job_id, {
            "status": "running",
            "phase": "loading_controls",
            "message": "Loading controls from selected frameworks…",
            "progress_percent": 5,
        })

        controls = _fetch_controls_for_grouping(db_session, tenant.id, framework_ids)
        if len(controls) < 2:
            set_job_status(tenant_slug, namespace, job_id, {
                "status": "failed",
                "phase": "loading_controls",
                "error": "Not enough controls to perform auto-grouping (need at least 2).",
                "progress_percent": 100,
            })
            return

        _jobs_logger.info(
            "[auto_group] tenant=%s job=%s — calling AI on %d controls",
            tenant_slug, job_id, len(controls),
        )
        set_job_status(tenant_slug, namespace, job_id, {
            "status": "running",
            "phase": "ai_grouping",
            "message": f"Asking AI to cluster {len(controls)} controls…",
            "control_count": len(controls),
            "progress_percent": 25,
        })

        ai_groups = ai_auto_group_controls(controls)

        _jobs_logger.info(
            "[auto_group] tenant=%s job=%s — persisting %d groups",
            tenant_slug, job_id, len(ai_groups),
        )
        set_job_status(tenant_slug, namespace, job_id, {
            "status": "running",
            "phase": "persisting",
            "message": f"Saving {len(ai_groups)} group(s) to the database…",
            "control_count": len(controls),
            "group_count": len(ai_groups),
            "progress_percent": 80,
        })

        summary = persist_ai_groups(db_session, tenant.id, user_id, ai_groups)

        _jobs_logger.info(
            "[auto_group] tenant=%s job=%s — DONE created=%d merged=%d mappings=%d",
            tenant_slug, job_id,
            summary["created_count"], summary["merged_count"], summary["mapping_count"],
        )
        set_job_status(tenant_slug, namespace, job_id, {
            "status": "completed",
            "phase": "done",
            "message": (
                f"Created {summary['created_count']} group(s), "
                f"merged {summary['merged_count']}, "
                f"linked {summary['mapping_count']} control(s)."
            ),
            "control_count": len(controls),
            "group_count": len(ai_groups),
            "summary": summary,
            "progress_percent": 100,
        })
    except Exception as exc:
        _jobs_logger.exception("[auto_group] tenant=%s job=%s FAILED", tenant_slug, job_id)
        set_job_status(tenant_slug, namespace, job_id, {
            "status": "failed",
            "phase": "error",
            "error": str(exc)[:500],
            "progress_percent": 100,
        })
    finally:
        if db_session is not None:
            try:
                db_session.close()
            except Exception:
                pass


@router.post("/auto-group/dispatch")
def auto_group_dispatch(
    request: AutoGroupRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User has no tenant assigned")
    if not check_ai_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured.",
                "fallback_available": True,
            },
        )

    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        from ....models import Tenant
        t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        tenant_slug = t.slug if t else None
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Could not resolve tenant slug")

    job_id = uuid.uuid4().hex
    framework_ids = list(request.framework_ids or [])

    set_job_status(tenant_slug, "control_auto_group", job_id, {
        "status": "queued",
        "phase": "queued",
        "message": "Starting…",
        "progress_percent": 1,
        "framework_ids": framework_ids,
    })

    # Run the work in a daemon thread so the dispatch endpoint returns
    # immediately and we don't depend on a separate Celery worker process.
    # Status updates flow through Redis-backed job_status so the polling
    # endpoint always returns a fresh snapshot.
    user_id = current_user.id
    thread = threading.Thread(
        target=_run_auto_grouping_threaded,
        args=(tenant_slug, job_id, framework_ids, user_id),
        name=f"auto_group:{job_id}",
        daemon=True,
    )
    thread.start()
    _jobs_logger.info(
        "[auto_group] DISPATCH tenant=%s job=%s framework_ids=%s — thread started",
        tenant_slug, job_id, framework_ids,
    )

    return {"job_id": job_id, "status": "queued"}


@router.get("/auto-group/status/{job_id}")
def auto_group_status(
    job_id: str,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        from ....models import Tenant
        tenant_id = get_user_primary_tenant(current_user, db)
        t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        tenant_slug = t.slug if t else None
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Could not resolve tenant slug")
    return get_job_status(tenant_slug, "control_auto_group", job_id)


@router.post("/auto-group")
def auto_group_controls(
    request: AutoGroupRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI features, or use manual grouping instead.",
                "fallback_available": True,
                "fallback_suggestion": "Use the manual 'Create Group' feature to organize controls"
            }
        )
    
    controls_list = _fetch_controls_for_grouping(db, tenant_id, request.framework_ids)
    if len(controls_list) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enough controls to perform auto-grouping"
        )
    
    ai_groups = ai_auto_group_controls(controls_list)
    summary = persist_ai_groups(db, tenant_id, current_user.id, ai_groups)

    all_group_ids = (summary.get("created_group_ids") or []) + (summary.get("merged_group_ids") or [])
    all_groups = db.query(CommonControlGroup).filter(CommonControlGroup.id.in_(all_group_ids)).all() if all_group_ids else []
    return {
        "message": (
            f"Created {summary['created_count']} control groups, "
            f"merged into {summary['merged_count']} existing groups"
        ),
        "groups": [serialize_group(g, db, include_controls=True) for g in all_groups],
    }


@router.get("/{group_id}/frameworks")
def get_group_frameworks(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    fc_mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).all()
    
    framework_counts = {}
    for mapping in fc_mappings:
        fc = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
        ).filter(FrameworkControl.id == mapping.framework_control_id).first()
        
        if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework:
            fw = fc.objective.domain.framework
            fw_key = f"legacy_{fw.id}"
            if fw_key not in framework_counts:
                framework_counts[fw_key] = {
                    "framework_id": fw.id,
                    "framework_name": fw.name,
                    "framework_code": fw.short_code,
                    "control_count": 0,
                    "source": "legacy"
                }
            framework_counts[fw_key]["control_count"] += 1
    
    pc_mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.parsed_control_id.isnot(None)
    ).all()
    
    for mapping in pc_mappings:
        pc = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.id == mapping.parsed_control_id
        ).first()
        if pc:
            fw = db.query(UploadedFramework).filter(
                UploadedFramework.id == pc.uploaded_framework_id
            ).first()
            if fw:
                fw_key = f"uploaded_{fw.id}"
                if fw_key not in framework_counts:
                    framework_counts[fw_key] = {
                        "framework_id": fw.id,
                        "framework_name": fw.name,
                        "framework_code": fw.name[:10] if fw.name else None,
                        "control_count": 0,
                        "source": "uploaded"
                    }
                framework_counts[fw_key]["control_count"] += 1
    
    normalized_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).count()
    
    parsed_control_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.parsed_control_id.isnot(None)
    ).count()
    
    return {
        "group_id": group_id,
        "group_name": group.name,
        "normalized_control_count": normalized_count,
        "parsed_control_count": parsed_control_count,
        "frameworks": list(framework_counts.values())
    }


@router.post("/{group_id}/generate-summary")
def generate_summary(
    group_id: int,
    request: GenerateSummaryRequest = GenerateSummaryRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-generated summaries.",
                "fallback_available": False
            }
        )
    
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    controls_text_parts = []
    for mapping in mappings:
        if mapping.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            if nc:
                controls_text_parts.append(f"- {nc.code}: {nc.name}\n  {nc.statement or ''}")
        
        if mapping.framework_control_id:
            fc = db.query(FrameworkControl).filter(
                FrameworkControl.id == mapping.framework_control_id
            ).first()
            if fc:
                controls_text_parts.append(f"- {fc.code}: {fc.name}\n  {fc.statement or ''}")
        
        if mapping.parsed_control_id:
            pc = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == mapping.parsed_control_id
            ).first()
            if pc:
                controls_text_parts.append(f"- {pc.original_reference}: {pc.title}\n  {pc.description or ''}")
    
    if not controls_text_parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group has no controls to summarize"
        )
    
    controls_text = f"Group: {group.name}\nDescription: {group.description or 'N/A'}\n\nControls:\n" + "\n".join(controls_text_parts)
    
    result = generate_group_summary(controls_text)
    
    group.ai_summary = result.get("summary")
    if request.regenerate_keywords:
        group.keywords = result.get("keywords", group.keywords or [])
    if result.get("evidence_types"):
        group.evidence_types = result.get("evidence_types")
    
    group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db, include_controls=True)


@router.post("/{group_id}/populate-from-frameworks")
def populate_group_from_frameworks(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    group_text = f"{group.name} {group.description or ''} {group.category or ''} {group.domain or ''} {' '.join(group.keywords or [])}"
    group_kw = _extract_keywords(group_text)
    if not group_kw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group has no keywords for matching")
    
    uploaded_fws = db.query(UploadedFramework).filter(
        or_(
            UploadedFramework.tenant_id == tenant_id,
            UploadedFramework.tenant_id.is_(None)
        )
    ).all()
    
    existing_parsed_ids = set(
        m.parsed_control_id for m in db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.parsed_control_id.isnot(None)
        ).all()
    )
    
    added = 0
    for fw in uploaded_fws:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        
        for pc in controls:
            if pc.id in existing_parsed_ids:
                continue
            ctrl_text = f"{pc.title or ''} {pc.description or ''} {pc.category or ''} {pc.domain or ''}"
            ctrl_kw = _extract_keywords(ctrl_text)
            score = _keyword_score(group_kw, ctrl_kw)
            if score >= 0.15:
                mapping = CommonControlGroupMapping(
                    group_id=group_id,
                    parsed_control_id=pc.id,
                    mapping_source="auto",
                    mapping_confidence=round(score, 3)
                )
                db.add(mapping)
                existing_parsed_ids.add(pc.id)
                added += 1
    
    db.commit()
    return {
        "message": f"Added {added} controls from {len(uploaded_fws)} frameworks",
        "added": added,
        "group": serialize_group(group, db, include_controls=False)
    }


@router.post("/populate-all-groups")
def populate_all_groups_from_frameworks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    
    groups = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).all()
    
    uploaded_fws = db.query(UploadedFramework).filter(
        or_(
            UploadedFramework.tenant_id == tenant_id,
            UploadedFramework.tenant_id.is_(None)
        )
    ).all()
    
    all_parsed = []
    for fw in uploaded_fws:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        for pc in controls:
            ctrl_text = f"{pc.title or ''} {pc.description or ''} {pc.category or ''} {pc.domain or ''}"
            all_parsed.append({
                "id": pc.id,
                "keywords": _extract_keywords(ctrl_text),
                "fw_name": fw.name
            })
    
    total_added = 0
    for group in groups:
        group_text = f"{group.name} {group.description or ''} {group.category or ''} {group.domain or ''} {' '.join(group.keywords or [])}"
        group_kw = _extract_keywords(group_text)
        if not group_kw:
            continue
        
        existing_ids = set(
            m.parsed_control_id for m in db.query(CommonControlGroupMapping).filter(
                CommonControlGroupMapping.group_id == group.id,
                CommonControlGroupMapping.parsed_control_id.isnot(None)
            ).all()
        )
        
        for pc in all_parsed:
            if pc["id"] in existing_ids:
                continue
            score = _keyword_score(group_kw, pc["keywords"])
            if score >= 0.15:
                mapping = CommonControlGroupMapping(
                    group_id=group.id,
                    parsed_control_id=pc["id"],
                    mapping_source="auto",
                    mapping_confidence=round(score, 3)
                )
                db.add(mapping)
                existing_ids.add(pc["id"])
                total_added += 1
    
    db.commit()
    return {
        "message": f"Added {total_added} controls across {len(groups)} groups from {len(uploaded_fws)} frameworks",
        "total_added": total_added,
        "groups_processed": len(groups)
    }


def _extract_keywords(text):
    if not text:
        return set()
    stop_words = {'the', 'and', 'for', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'be', 'with', 'that', 'this', 'shall', 'must', 'should', 'or', 'its', 'by', 'on', 'as', 'from', 'all', 'has', 'have', 'not', 'at'}
    words = set(w.lower().strip('.,;:()[]') for w in text.split() if len(w) > 2)
    return words - stop_words


def _keyword_score(keywords1, keywords2):
    if not keywords1 or not keywords2:
        return 0.0
    intersection = keywords1 & keywords2
    union = keywords1 | keywords2
    if not union:
        return 0.0
    return len(intersection) / len(union)


@router.get("/{group_id}/similarities")
def get_group_similarities(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    all_mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    controls_by_framework = {}
    
    for mapping in all_mappings:
        if mapping.parsed_control_id:
            pc = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == mapping.parsed_control_id
            ).first()
            if not pc:
                continue
            fw = db.query(UploadedFramework).filter(
                UploadedFramework.id == pc.uploaded_framework_id
            ).first()
            fw_key = f"uploaded_{fw.id}" if fw else "uploaded_0"
            fw_name = fw.name if fw else "Unknown"
            if fw_key not in controls_by_framework:
                controls_by_framework[fw_key] = {"name": fw_name, "controls": []}
            text = (pc.title or "") + " " + (pc.description or "") + " " + (pc.full_text[:500] if pc.full_text else "")
            controls_by_framework[fw_key]["controls"].append({
                "id": pc.id,
                "code": pc.original_reference,
                "name": pc.title,
                "keywords": _extract_keywords(text),
                "framework_name": fw_name,
                "type": "parsed"
            })
        
        elif mapping.framework_control_id:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
            ).filter(FrameworkControl.id == mapping.framework_control_id).first()
            if not fc:
                continue
            fw = fc.objective.domain.framework if fc.objective and fc.objective.domain else None
            fw_key = f"legacy_{fw.id}" if fw else "legacy_0"
            fw_name = fw.name if fw else "Unknown"
            if fw_key not in controls_by_framework:
                controls_by_framework[fw_key] = {"name": fw_name, "controls": []}
            text = (fc.name or "") + " " + (fc.statement or "") + " " + (fc.control_objective or "")
            controls_by_framework[fw_key]["controls"].append({
                "id": fc.id,
                "code": fc.code,
                "name": fc.name,
                "keywords": _extract_keywords(text),
                "framework_name": fw_name,
                "type": "framework"
            })
    
    fw_ids = list(controls_by_framework.keys())
    pairs = []
    
    for i in range(len(fw_ids)):
        for j in range(i + 1, len(fw_ids)):
            fw1_controls = controls_by_framework[fw_ids[i]]["controls"]
            fw2_controls = controls_by_framework[fw_ids[j]]["controls"]
            
            for c1 in fw1_controls:
                for c2 in fw2_controls:
                    score = _keyword_score(c1["keywords"], c2["keywords"])
                    if score > 0.1:
                        common_kw = c1["keywords"] & c2["keywords"]
                        common_terms = ", ".join(sorted(list(common_kw))[:5])
                        reasoning = f"Both controls address [{common_terms}] - {c1['framework_name']} via '{c1['name']}' and {c2['framework_name']} via '{c2['name']}'"
                        pairs.append({
                            "control1": c1,
                            "control2": c2,
                            "score": score,
                            "reasoning": reasoning
                        })
    
    pairs.sort(key=lambda x: x["score"], reverse=True)
    top_pairs = pairs[:50]
    
    items = []
    for idx, p in enumerate(top_pairs):
        items.append({
            "id": idx + 1,
            "control1_type": p["control1"].get("type", "parsed"),
            "control1_id": p["control1"]["id"],
            "control1_code": p["control1"]["code"],
            "control1_name": p["control1"]["name"],
            "control1_framework": p["control1"]["framework_name"],
            "control2_type": p["control2"].get("type", "parsed"),
            "control2_id": p["control2"]["id"],
            "control2_code": p["control2"]["code"],
            "control2_name": p["control2"]["name"],
            "control2_framework": p["control2"]["framework_name"],
            "similarity_score": round(p["score"], 4),
            "ai_reasoning": p["reasoning"]
        })
    
    return {"items": items}
