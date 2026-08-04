from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, DocumentRiskLink,
    DocumentRegulatoryLink, DocumentAssetLink, InternalControl,
    Risk, ITAsset, Framework, FrameworkControl, GRCUser, get_db,
    PolicyStatement, StatementControlMapping,
    ParsedFrameworkControl, NormalizedControl, NormalizedControlLink, UploadedFramework,
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/mappings", tags=["Governance - Mappings"])


class ControlLinkCreate(BaseModel):
    document_id: int
    internal_control_id: int
    link_type: str = "implements"
    notes: Optional[str] = None
    force_relink: bool = False


def serialize_internal_control_link(control: InternalControl) -> dict:
    return {
        "id": control.id,
        "internal_control_id": control.id,
        "normalized_control_id": control.id,
        "control_code": control.control_id,
        "control_name": control.name,
        "link_type": "linked",
        "notes": None,
        "created_at": control.updated_at.isoformat() if control.updated_at else control.created_at.isoformat() if control.created_at else None
    }


class RiskLinkCreate(BaseModel):
    document_id: int
    risk_id: int
    link_type: str = "mitigates"
    notes: Optional[str] = None


class RegulatoryLinkCreate(BaseModel):
    document_id: int
    framework_id: Optional[int] = None
    framework_control_id: Optional[int] = None
    requirement_reference: Optional[str] = None
    link_type: str = "complies"
    notes: Optional[str] = None


class AssetLinkCreate(BaseModel):
    document_id: int
    asset_id: int
    link_type: str = "governs"
    notes: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_document_or_404(document_id: int, user_tenants: List[int], db: Session) -> GovernanceDocument:
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    return document


def _recommended_controls_for_document(
    db: Session, document_id: int, user_tenants: List[int], fw_ids: Optional[List[int]] = None,
) -> List[dict]:
    """Roll up the AI control recommendations (StatementControlMapping) across a
    document's active statements into a deduped, document-level list. Covers both
    internal (ERM) controls and framework controls. Each entry is enriched with the
    underlying control's description and exact clause reference, the statements that
    drove it, and whether the user has confirmed (locked) it. Populated automatically
    by the post-parse auto-map; this just aggregates + enriches what's already stored.

    Framework scoping (fw_ids = the document's in-scope ∪ referenced UploadedFramework
    ids): when provided, only recommendations that resolve to one of those frameworks
    are returned (plus any the user has already confirmed/locked, which are never
    hidden). Pass fw_ids=None to disable scoping (full list); pass an empty list to
    scope to nothing (only confirmed links survive). Framework linkage is resolved via
    ParsedFrameworkControl.uploaded_framework_id (parsed kind) or the
    NormalizedControlLink→ParsedFrameworkControl join (normalized kind); framework /
    internal kinds carry no UploadedFramework id and are dropped when scoping is on."""
    scope: Optional[set] = None
    if fw_ids is not None:
        scope = {int(x) for x in fw_ids}

    stmts = db.query(
        PolicyStatement.id, PolicyStatement.statement_code, PolicyStatement.statement_text
    ).filter(
        PolicyStatement.document_id == document_id,
        PolicyStatement.tenant_id.in_(user_tenants),
        PolicyStatement.status == "active",
    ).all()
    if not stmts:
        return []
    stmt_ids = [s.id for s in stmts]
    stmt_info = {
        s.id: {"id": s.id, "statement_code": s.statement_code, "snippet": (s.statement_text or "")[:240]}
        for s in stmts
    }

    rows = db.query(StatementControlMapping).filter(
        StatementControlMapping.statement_id.in_(stmt_ids),
        StatementControlMapping.tenant_id.in_(user_tenants),
    ).all()

    agg: dict = {}
    for m in rows:
        key = (m.control_kind, m.control_code)
        a = agg.get(key)
        if a is None:
            a = {
                "control_kind": m.control_kind,            # normalized | framework | parsed | internal
                "control_code": m.control_code,
                "control_title": m.control_title,
                "framework_name": m.framework_name,
                "domain": m.domain,
                "coverage_type": m.coverage_type,
                "link_source": m.link_source,              # ai | derived
                "max_confidence": m.confidence,
                "control_ref_id": getattr(m, f"{m.control_kind}_control_id", None),
                "rationale": m.rationale,
                "_rat_conf": m.confidence or 0.0,
                "_stmt_ids": set(),
                "_ref_ids": set(),
                "_locked": 0,
            }
            agg[key] = a
        a["_stmt_ids"].add(m.statement_id)
        # Track EVERY contributing control id (not just the first): parsed controls
        # carry auto-generated codes ("FW-001", ...) that collide across frameworks,
        # so one (kind, code) agg row can span several parsed controls in different
        # frameworks. Scope must be decided from the union of all of them.
        _rid = getattr(m, f"{m.control_kind}_control_id", None)
        if _rid is not None:
            a["_ref_ids"].add(_rid)
        if m.is_locked:
            a["_locked"] += 1
        if m.confidence is not None:
            a["max_confidence"] = max(a["max_confidence"] or 0.0, m.confidence)
        # Keep the rationale of the highest-confidence contributing mapping.
        if m.rationale and (m.confidence or 0.0) >= a.get("_rat_conf", -1):
            a["_rat_conf"] = m.confidence or 0.0
            a["rationale"] = m.rationale
        if m.link_source == "ai":
            a["link_source"] = "ai"
        if not a["control_title"] and m.control_title:
            a["control_title"] = m.control_title
        if not a["framework_name"] and m.framework_name:
            a["framework_name"] = m.framework_name
        if a["control_ref_id"] is None:
            a["control_ref_id"] = getattr(m, f"{m.control_kind}_control_id", None)

    # Batch-load the underlying control's description + exact clause reference, and
    # (for scoping + framework-name backfill) each control's owning UploadedFramework.
    ids_by_kind = {"parsed": set(), "framework": set(), "normalized": set(), "internal": set()}
    for a in agg.values():
        if a["control_kind"] in ids_by_kind:
            ids_by_kind[a["control_kind"]].update(a["_ref_ids"])

    detail: dict = {}          # (kind, id) -> {description, clause_reference}
    parsed_fw: dict = {}       # parsed_control_id -> uploaded_framework_id
    normalized_fw: dict = {}   # normalized_control_id -> set(uploaded_framework_id)
    if ids_by_kind["parsed"]:
        for c in db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id.in_(ids_by_kind["parsed"])).all():
            detail[("parsed", c.id)] = {"description": c.description or c.full_text, "clause_reference": c.original_reference or c.control_id}
            if c.uploaded_framework_id:
                parsed_fw[c.id] = c.uploaded_framework_id
    if ids_by_kind["framework"]:
        for c in db.query(FrameworkControl).filter(FrameworkControl.id.in_(ids_by_kind["framework"])).all():
            detail[("framework", c.id)] = {"description": getattr(c, "statement", None) or getattr(c, "description", None), "clause_reference": getattr(c, "code", None)}
    if ids_by_kind["normalized"]:
        for c in db.query(NormalizedControl).filter(NormalizedControl.id.in_(ids_by_kind["normalized"])).all():
            detail[("normalized", c.id)] = {"description": getattr(c, "statement", None) or getattr(c, "description", None), "clause_reference": getattr(c, "code", None)}
        # Resolve each normalized control's owning UploadedFramework(s) via the link table.
        for ncid, ufid in db.query(
            NormalizedControlLink.normalized_control_id, ParsedFrameworkControl.uploaded_framework_id
        ).join(
            ParsedFrameworkControl, NormalizedControlLink.parsed_control_id == ParsedFrameworkControl.id
        ).filter(NormalizedControlLink.normalized_control_id.in_(ids_by_kind["normalized"])).all():
            if ufid:
                normalized_fw.setdefault(ncid, set()).add(ufid)
    if ids_by_kind["internal"]:
        for c in db.query(InternalControl).filter(InternalControl.id.in_(ids_by_kind["internal"])).all():
            detail[("internal", c.id)] = {"description": getattr(c, "description", None), "clause_reference": getattr(c, "control_id", None)}

    # UploadedFramework id -> name (for backfilling framework_name on rows whose
    # StatementControlMapping.framework_name was null, e.g. normalized-kind rows).
    all_fw = set(parsed_fw.values()) | {x for s in normalized_fw.values() for x in s}
    uf_names: dict = {}
    if all_fw:
        for uf in db.query(UploadedFramework.id, UploadedFramework.name).filter(UploadedFramework.id.in_(all_fw)).all():
            uf_names[uf.id] = uf.name

    out = []
    for a in agg.values():
        sids = sorted(a.pop("_stmt_ids"))
        locked = a.pop("_locked")
        a.pop("_rat_conf", None)
        ref_ids = a.pop("_ref_ids", set())
        a["statement_count"] = len(sids)
        a["is_linked"] = len(sids) > 0 and locked >= len(sids)
        a["statements"] = [stmt_info[sid] for sid in sids if sid in stmt_info]
        d = detail.get((a["control_kind"], a["control_ref_id"]), {})
        desc = d.get("description")
        a["description"] = desc[:600] if desc else None
        a["clause_reference"] = d.get("clause_reference") or a["control_code"]

        # Resolve this row's owning UploadedFramework(s) for scoping + name backfill,
        # from the UNION over ALL contributing control ids (see the _ref_ids note
        # above) — so a code collision across frameworks can't drop an in-scope clause.
        row_fw = set()
        if a["control_kind"] == "parsed":
            for rid in ref_ids:
                ufid = parsed_fw.get(rid)
                if ufid:
                    row_fw.add(ufid)
        elif a["control_kind"] == "normalized":
            for rid in ref_ids:
                row_fw |= normalized_fw.get(rid, set())
        # Prefer an in-scope framework for the displayed name/id when scoping is on.
        preferred = (row_fw & scope) if scope else row_fw
        pick = next(iter(sorted(preferred or row_fw)), None)
        a["uploaded_framework_id"] = pick
        if not a.get("framework_name") and pick in uf_names:
            a["framework_name"] = uf_names[pick]

        # Framework scoping: keep only rows in the document's frameworks, plus any
        # the user already confirmed (locked) — a confirmed link is never hidden.
        if scope is not None and not (row_fw & scope) and not a["is_linked"]:
            continue
        out.append(a)
    out.sort(key=lambda x: (x["statement_count"], x["max_confidence"] or 0.0), reverse=True)
    return out


@router.get("/document/{document_id}")
def get_document_mappings(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(document_id, user_tenants, db)

    # Scope the AI recommendations to the document's OWN frameworks — the union of
    # its in-scope (applicable_framework_ids) and referenced (framework_ids) sets —
    # so the Mappings tab never surfaces the whole tenant catalog. Empty union → the
    # helper returns nothing (the UI shows the "set applicable frameworks" prompt).
    doc_fw_ids = sorted(
        {int(x) for x in (getattr(document, "applicable_framework_ids", None) or [])}
        | {int(x) for x in (getattr(document, "framework_ids", None) or [])}
    )

    control_links = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.source_document_id == document_id
    ).order_by(InternalControl.control_id.asc()).all()
    
    risk_links = db.query(DocumentRiskLink).options(
        joinedload(DocumentRiskLink.risk)
    ).filter(DocumentRiskLink.document_id == document_id).all()
    
    regulatory_links = db.query(DocumentRegulatoryLink).options(
        joinedload(DocumentRegulatoryLink.framework),
        joinedload(DocumentRegulatoryLink.framework_control)
    ).filter(DocumentRegulatoryLink.document_id == document_id).all()
    
    asset_links = db.query(DocumentAssetLink).options(
        joinedload(DocumentAssetLink.asset)
    ).filter(DocumentAssetLink.document_id == document_id).all()
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "control_links": [
            serialize_internal_control_link(link)
            for link in control_links
        ],
        "risk_links": [
            {
                "id": link.id,
                "risk_id": link.risk_id,
                "risk_title": link.risk.title if link.risk else None,
                "risk_category": link.risk.risk_category if link.risk else None,
                "risk_status": link.risk.status if link.risk else None,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in risk_links
        ],
        "regulatory_links": [
            {
                "id": link.id,
                "framework_id": link.framework_id,
                "framework_name": link.framework.name if link.framework else None,
                "framework_short_code": link.framework.short_code if link.framework else None,
                "framework_control_id": link.framework_control_id,
                "framework_control_code": link.framework_control.code if link.framework_control else None,
                "framework_control_name": link.framework_control.name if link.framework_control else None,
                "requirement_reference": link.requirement_reference,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in regulatory_links
        ],
        "asset_links": [
            {
                "id": link.id,
                "asset_id": link.asset_id,
                "asset_name": link.asset.name if link.asset else None,
                "asset_type": link.asset.asset_type if link.asset else None,
                "asset_criticality": link.asset.criticality if link.asset else None,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in asset_links
        ],
        # AI control recommendations rolled up from the document's statements,
        # SCOPED to the document's own frameworks (in-scope ∪ referenced). Populated
        # by the post-parse auto-map.
        "recommended_controls": _recommended_controls_for_document(db, document_id, user_tenants, fw_ids=doc_fw_ids),
        # The framework scope actually applied (for the UI's "in-scope frameworks" header + empty state).
        "framework_scope_ids": doc_fw_ids,
    }


@router.get("/document/{document_id}/coverage")
def get_document_control_coverage(
    document_id: int,
    framework_ids: Optional[str] = Query(
        None, description="Comma-separated UploadedFramework ids; defaults to the document's applicable_framework_ids"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Control-coverage of a document against its applicable frameworks (feature #6).

    For each applicable framework returns how many of its controls are covered by
    this document's statements and, crucially, WHICH controls are NOT covered (the
    gap). Plus the document-level rolled-up mapped (confirmed) and recommended
    (AI-suggested, unconfirmed) controls. Reads persisted statement→control
    mappings — no AI call — so it's cheap and safe to poll."""
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(document_id, user_tenants, db)

    # Frameworks to audit against: explicit override, else the document's declared set.
    if framework_ids:
        fw_ids = [int(x) for x in framework_ids.split(",") if x.strip().lstrip("-").isdigit()]
    else:
        # Default to the UNION of the document's in-scope (applicable) and
        # referenced (citation) frameworks — the same scope the Mappings tab uses.
        fw_ids = sorted(
            {int(x) for x in (getattr(document, "applicable_framework_ids", None) or [])}
            | {int(x) for x in (getattr(document, "framework_ids", None) or [])}
        )

    recommended = _recommended_controls_for_document(db, document_id, user_tenants)
    mapped_all = [r for r in recommended if r.get("is_linked")]
    suggested_all = [r for r in recommended if not r.get("is_linked")]

    # Identifiers that count as "covered" when diffing a framework's catalog:
    # direct parsed-control ids, plus denormalized control codes (auto-map's
    # candidate pool is NormalizedControl, so a framework control may be covered
    # via a normalized/framework-kind mapping that shares the same code).
    mapped_parsed_ids = {
        r["control_ref_id"] for r in recommended
        if r.get("control_kind") == "parsed" and r.get("control_ref_id")
    }
    mapped_codes = {
        (r.get("control_code") or "").strip().lower()
        for r in recommended if r.get("control_code")
    }
    mapped_codes.discard("")

    frameworks_out: List[dict] = []
    if fw_ids:
        ufs = db.query(UploadedFramework).filter(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.id.in_(fw_ids),
        ).all()
        for uf in ufs:
            catalog = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.uploaded_framework_id == uf.id
            ).order_by(ParsedFrameworkControl.control_id.asc()).all()
            missing: List[dict] = []
            mapped_count = 0
            for c in catalog:
                code = (c.original_reference or c.control_id or "").strip().lower()
                covered = (c.id in mapped_parsed_ids) or (code and code in mapped_codes)
                if covered:
                    mapped_count += 1
                else:
                    missing.append({
                        "id": c.id,
                        "control_id": c.control_id,
                        "reference": c.original_reference or c.control_id,
                        "title": c.title,
                        "domain": c.domain,
                    })
            total = len(catalog)
            frameworks_out.append({
                "framework_id": uf.id,
                "framework_name": uf.name,
                "total_controls": total,
                "mapped_count": mapped_count,
                "missing_count": len(missing),
                "coverage_pct": round(100 * mapped_count / total, 1) if total else 0.0,
                "missing_controls": missing,
            })

    return {
        "document_id": document_id,
        "document_title": document.title,
        "applicable_framework_ids": fw_ids,
        "frameworks": frameworks_out,
        "mapped_controls": mapped_all,
        "recommended_controls": suggested_all,
        "totals": {
            "mapped": len(mapped_all),
            "recommended": len(suggested_all),
            "missing": sum(f["missing_count"] for f in frameworks_out),
            "frameworks": len(frameworks_out),
        },
    }


class RecommendedControlLink(BaseModel):
    control_kind: str
    control_code: Optional[str] = None
    link: bool = True  # True = confirm/lock the mapping; False = unlink/unlock


@router.post("/document/{document_id}/recommended-controls/link")
def link_recommended_control(
    document_id: int,
    body: RecommendedControlLink,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Confirm (link) or unlink an AI-recommended control for a document. Locks /
    unlocks the underlying StatementControlMapping rows across the document's
    statements — a locked mapping is a user-confirmed link that survives re-mapping."""
    user_tenants = get_user_tenants(current_user, db)
    get_document_or_404(document_id, user_tenants, db)

    stmt_ids = [
        s_id for (s_id,) in db.query(PolicyStatement.id).filter(
            PolicyStatement.document_id == document_id,
            PolicyStatement.tenant_id.in_(user_tenants),
            PolicyStatement.status == "active",
        ).all()
    ]
    if not stmt_ids:
        return {"document_id": document_id, "linked": bool(body.link), "updated": 0}

    q = db.query(StatementControlMapping).filter(
        StatementControlMapping.statement_id.in_(stmt_ids),
        StatementControlMapping.tenant_id.in_(user_tenants),
        StatementControlMapping.control_kind == body.control_kind,
    )
    if body.control_code is not None:
        q = q.filter(StatementControlMapping.control_code == body.control_code)
    else:
        q = q.filter(StatementControlMapping.control_code.is_(None))

    updated = 0
    for m in q.all():
        m.is_locked = bool(body.link)
        updated += 1
    db.commit()

    return {
        "document_id": document_id,
        "control_kind": body.control_kind,
        "control_code": body.control_code,
        "linked": bool(body.link),
        "updated": updated,
    }


@router.post("/control", status_code=status.HTTP_201_CREATED)
def link_document_to_control(
    link_data: ControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(link_data.document_id, user_tenants, db)
    
    control = db.query(InternalControl).filter(
        InternalControl.id == link_data.internal_control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal control not found"
        )
    
    if control.source_document_id == link_data.document_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists between this document and control"
        )

    if control.source_document_id and control.source_document_id != link_data.document_id:
        existing_document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == control.source_document_id,
            GovernanceDocument.tenant_id.in_(user_tenants)
        ).first()
        existing_title = existing_document.title if existing_document else "another document"
        if not link_data.force_relink:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Control is already linked to '{existing_title}'"
            )

    relinked_from_document_id = None
    if control.source_document_id and control.source_document_id != link_data.document_id:
        relinked_from_document_id = control.source_document_id
        if control.source_statement_id:
            control.source_statement_id = None

    control.source_document_id = link_data.document_id
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    
    result = serialize_internal_control_link(control)
    result["document_id"] = document.id
    if relinked_from_document_id:
        result["relinked_from_document_id"] = relinked_from_document_id
    return result


@router.delete("/control/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_document_from_control(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    control = db.query(InternalControl).filter(
        InternalControl.id == link_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()

    if not control or not control.source_document_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control link not found"
        )

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == control.source_document_id
    ).first()
    if not document or document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this document"
        )

    control.source_document_id = None
    control.updated_at = datetime.utcnow()
    db.commit()
    return None


@router.post("/risk", status_code=status.HTTP_201_CREATED)
def link_document_to_risk(
    link_data: RiskLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(link_data.document_id, user_tenants, db)
    
    risk = db.query(Risk).filter(
        Risk.id == link_data.risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    existing_link = db.query(DocumentRiskLink).filter(
        DocumentRiskLink.document_id == link_data.document_id,
        DocumentRiskLink.risk_id == link_data.risk_id
    ).first()
    if existing_link:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists between this document and risk"
        )
    
    link = DocumentRiskLink(
        document_id=link_data.document_id,
        risk_id=link_data.risk_id,
        link_type=link_data.link_type,
        notes=link_data.notes,
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    
    return {
        "id": link.id,
        "document_id": link.document_id,
        "risk_id": link.risk_id,
        "risk_title": risk.title,
        "risk_category": risk.risk_category,
        "link_type": link.link_type,
        "notes": link.notes,
        "created_at": link.created_at.isoformat() if link.created_at else None
    }


@router.delete("/risk/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_document_from_risk(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    link = db.query(DocumentRiskLink).options(
        joinedload(DocumentRiskLink.document)
    ).filter(DocumentRiskLink.id == link_id).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk link not found"
        )
    
    if link.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this document"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.post("/regulatory", status_code=status.HTTP_201_CREATED)
def link_document_to_regulatory(
    link_data: RegulatoryLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(link_data.document_id, user_tenants, db)
    
    framework = None
    framework_control = None
    
    if link_data.framework_id:
        framework = db.query(Framework).filter(
            Framework.id == link_data.framework_id
        ).first()
        if not framework:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework not found"
            )
    
    if link_data.framework_control_id:
        framework_control = db.query(FrameworkControl).filter(
            FrameworkControl.id == link_data.framework_control_id
        ).first()
        if not framework_control:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework control not found"
            )
    
    if not link_data.framework_id and not link_data.framework_control_id and not link_data.requirement_reference:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of framework_id, framework_control_id, or requirement_reference must be provided"
        )
    
    link = DocumentRegulatoryLink(
        document_id=link_data.document_id,
        framework_id=link_data.framework_id,
        framework_control_id=link_data.framework_control_id,
        requirement_reference=link_data.requirement_reference,
        link_type=link_data.link_type,
        notes=link_data.notes,
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    
    return {
        "id": link.id,
        "document_id": link.document_id,
        "framework_id": link.framework_id,
        "framework_name": framework.name if framework else None,
        "framework_short_code": framework.short_code if framework else None,
        "framework_control_id": link.framework_control_id,
        "framework_control_code": framework_control.code if framework_control else None,
        "framework_control_name": framework_control.name if framework_control else None,
        "requirement_reference": link.requirement_reference,
        "link_type": link.link_type,
        "notes": link.notes,
        "created_at": link.created_at.isoformat() if link.created_at else None
    }


@router.delete("/regulatory/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_document_from_regulatory(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    link = db.query(DocumentRegulatoryLink).options(
        joinedload(DocumentRegulatoryLink.document)
    ).filter(DocumentRegulatoryLink.id == link_id).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Regulatory link not found"
        )
    
    if link.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this document"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.post("/asset", status_code=status.HTTP_201_CREATED)
def link_document_to_asset(
    link_data: AssetLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    document = get_document_or_404(link_data.document_id, user_tenants, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == link_data.asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    existing_link = db.query(DocumentAssetLink).filter(
        DocumentAssetLink.document_id == link_data.document_id,
        DocumentAssetLink.asset_id == link_data.asset_id
    ).first()
    if existing_link:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists between this document and asset"
        )
    
    link = DocumentAssetLink(
        document_id=link_data.document_id,
        asset_id=link_data.asset_id,
        link_type=link_data.link_type,
        notes=link_data.notes,
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    
    return {
        "id": link.id,
        "document_id": link.document_id,
        "asset_id": link.asset_id,
        "asset_name": asset.name,
        "asset_type": asset.asset_type,
        "asset_criticality": asset.criticality,
        "link_type": link.link_type,
        "notes": link.notes,
        "created_at": link.created_at.isoformat() if link.created_at else None
    }


@router.delete("/asset/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_document_from_asset(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    link = db.query(DocumentAssetLink).options(
        joinedload(DocumentAssetLink.document)
    ).filter(DocumentAssetLink.id == link_id).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset link not found"
        )
    
    if link.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this document"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.get("/by-control/{control_id}")
def get_documents_by_control(
    control_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    control = db.query(InternalControl).filter(
        InternalControl.id == control_id,
        InternalControl.tenant_id.in_(user_tenants)
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )

    documents_query = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == control.source_document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    )
    total = 1 if control.source_document_id else 0
    documents = documents_query.offset(skip).limit(limit).all() if control.source_document_id else []
    
    return {
        "control_id": control_id,
        "control_code": control.control_id,
        "control_name": control.name,
        "total": total,
        "documents": [
            {
                "link_id": control.id,
                "document_id": document.id,
                "document_title": document.title,
                "doc_type": document.doc_type,
                "status": document.status,
                "link_type": "linked",
                "notes": None,
                "created_at": control.updated_at.isoformat() if control.updated_at else control.created_at.isoformat() if control.created_at else None
            }
            for document in documents
        ]
    }


@router.get("/by-risk/{risk_id}")
def get_documents_by_risk(
    risk_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    links = db.query(DocumentRiskLink).options(
        joinedload(DocumentRiskLink.document)
    ).join(GovernanceDocument).filter(
        DocumentRiskLink.risk_id == risk_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).offset(skip).limit(limit).all()
    
    total = db.query(func.count(DocumentRiskLink.id)).join(GovernanceDocument).filter(
        DocumentRiskLink.risk_id == risk_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).scalar()
    
    return {
        "risk_id": risk_id,
        "risk_title": risk.title,
        "risk_category": risk.risk_category,
        "total": total,
        "documents": [
            {
                "link_id": link.id,
                "document_id": link.document.id,
                "document_title": link.document.title,
                "doc_type": link.document.doc_type,
                "status": link.document.status,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in links
        ]
    }


@router.get("/by-asset/{asset_id}")
def get_documents_by_asset(
    asset_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    links = db.query(DocumentAssetLink).options(
        joinedload(DocumentAssetLink.document)
    ).join(GovernanceDocument).filter(
        DocumentAssetLink.asset_id == asset_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).offset(skip).limit(limit).all()
    
    total = db.query(func.count(DocumentAssetLink.id)).join(GovernanceDocument).filter(
        DocumentAssetLink.asset_id == asset_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).scalar()
    
    return {
        "asset_id": asset_id,
        "asset_name": asset.name,
        "asset_type": asset.asset_type,
        "total": total,
        "documents": [
            {
                "link_id": link.id,
                "document_id": link.document.id,
                "document_title": link.document.title,
                "doc_type": link.document.doc_type,
                "status": link.document.status,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in links
        ]
    }


@router.get("/by-framework/{framework_id}")
def get_documents_by_framework(
    framework_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    framework = db.query(Framework).filter(
        Framework.id == framework_id
    ).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    links = db.query(DocumentRegulatoryLink).options(
        joinedload(DocumentRegulatoryLink.document),
        joinedload(DocumentRegulatoryLink.framework_control)
    ).join(GovernanceDocument).filter(
        DocumentRegulatoryLink.framework_id == framework_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).offset(skip).limit(limit).all()
    
    total = db.query(func.count(DocumentRegulatoryLink.id)).join(GovernanceDocument).filter(
        DocumentRegulatoryLink.framework_id == framework_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).scalar()
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "framework_short_code": framework.short_code,
        "total": total,
        "documents": [
            {
                "link_id": link.id,
                "document_id": link.document.id,
                "document_title": link.document.title,
                "doc_type": link.document.doc_type,
                "status": link.document.status,
                "framework_control_id": link.framework_control_id,
                "framework_control_code": link.framework_control.code if link.framework_control else None,
                "requirement_reference": link.requirement_reference,
                "link_type": link.link_type,
                "notes": link.notes,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
            for link in links
        ]
    }


@router.get("/statistics")
def get_mapping_statistics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_documents": 0,
            "documents_with_control_links": 0,
            "documents_with_risk_links": 0,
            "documents_with_regulatory_links": 0,
            "documents_with_asset_links": 0,
            "total_control_links": 0,
            "total_risk_links": 0,
            "total_regulatory_links": 0,
            "total_asset_links": 0,
            "link_type_distribution": {},
            "coverage_by_doc_type": {}
        }
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        tenant_filter = [tenant_id]
    else:
        tenant_filter = user_tenants
    
    total_documents = db.query(func.count(GovernanceDocument.id)).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter)
    ).scalar()
    
    docs_with_control_links = db.query(func.count(func.distinct(InternalControl.source_document_id))).filter(
        InternalControl.tenant_id.in_(tenant_filter),
        InternalControl.source_document_id.isnot(None)
    ).scalar()
    
    docs_with_risk_links = db.query(func.count(func.distinct(DocumentRiskLink.document_id))).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    docs_with_regulatory_links = db.query(func.count(func.distinct(DocumentRegulatoryLink.document_id))).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    docs_with_asset_links = db.query(func.count(func.distinct(DocumentAssetLink.document_id))).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    total_control_links = db.query(func.count(InternalControl.id)).filter(
        InternalControl.tenant_id.in_(tenant_filter),
        InternalControl.source_document_id.isnot(None)
    ).scalar()
    
    total_risk_links = db.query(func.count(DocumentRiskLink.id)).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    total_regulatory_links = db.query(func.count(DocumentRegulatoryLink.id)).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    total_asset_links = db.query(func.count(DocumentAssetLink.id)).join(
        GovernanceDocument
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).scalar()
    
    control_link_types = [("linked", total_control_links or 0)] if total_control_links else []
    
    risk_link_types = db.query(
        DocumentRiskLink.link_type,
        func.count(DocumentRiskLink.id)
    ).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter)
    ).group_by(DocumentRiskLink.link_type).all()
    
    regulatory_link_types = db.query(
        DocumentRegulatoryLink.link_type,
        func.count(DocumentRegulatoryLink.id)
    ).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter)
    ).group_by(DocumentRegulatoryLink.link_type).all()
    
    asset_link_types = db.query(
        DocumentAssetLink.link_type,
        func.count(DocumentAssetLink.id)
    ).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter)
    ).group_by(DocumentAssetLink.link_type).all()
    
    link_type_distribution = {
        "control": {lt: count for lt, count in control_link_types},
        "risk": {lt: count for lt, count in risk_link_types},
        "regulatory": {lt: count for lt, count in regulatory_link_types},
        "asset": {lt: count for lt, count in asset_link_types}
    }
    
    doc_types = db.query(
        GovernanceDocument.doc_type,
        func.count(GovernanceDocument.id)
    ).filter(GovernanceDocument.tenant_id.in_(tenant_filter)).group_by(
        GovernanceDocument.doc_type
    ).all()
    
    coverage_by_doc_type = {}
    for doc_type, count in doc_types:
        docs_linked = db.query(func.count(func.distinct(GovernanceDocument.id))).filter(
            GovernanceDocument.tenant_id.in_(tenant_filter),
            GovernanceDocument.doc_type == doc_type
        ).outerjoin(
            InternalControl,
            InternalControl.source_document_id == GovernanceDocument.id
        ).outerjoin(DocumentRiskLink).outerjoin(
            DocumentRegulatoryLink
        ).outerjoin(DocumentAssetLink).filter(
            (InternalControl.id.isnot(None)) |
            (DocumentRiskLink.id.isnot(None)) |
            (DocumentRegulatoryLink.id.isnot(None)) |
            (DocumentAssetLink.id.isnot(None))
        ).scalar()
        
        coverage_by_doc_type[doc_type] = {
            "total": count,
            "linked": docs_linked or 0,
            "coverage_percentage": round((docs_linked or 0) / count * 100, 1) if count > 0 else 0
        }
    
    return {
        "total_documents": total_documents,
        "documents_with_control_links": docs_with_control_links,
        "documents_with_risk_links": docs_with_risk_links,
        "documents_with_regulatory_links": docs_with_regulatory_links,
        "documents_with_asset_links": docs_with_asset_links,
        "total_control_links": total_control_links,
        "total_risk_links": total_risk_links,
        "total_regulatory_links": total_regulatory_links,
        "total_asset_links": total_asset_links,
        "link_type_distribution": link_type_distribution,
        "coverage_by_doc_type": coverage_by_doc_type
    }
