"""Scoping and initiating a Cyber Security assessment (API).

A Cyber Security assessment type used to be one workbook per organisation: its questions and its answers in the same document. A new assessment is made
from that workbook as a *questionnaire* (its items copied without their answers) for one subject: an application chosen from the asset library, or a
security function scoped by organisation, period and participants. It starts as a draft in the scoping phase; Start checks what must be filled, keeps the
scope and the facts of its assets as they were, copies the questions and opens the questionnaire, which is the one every assessment already has.
Rules and shapes: ``scoping.py``. Plan and reasons: ``.agent-context/features/cyber-assessment-scoping.md``.
The NIST assessments (``nist.py``, ``features/nist-assessments.md``) are made the same way from the NIST library instead of a workbook: Start builds their questions
from the baseline or the functions the scope chose, and ``PUT /items/{id}/determination`` records what the assessor decides.

Registered before the older ``/compliance/assessments`` router: the literal paths here (``templates``, ``initiate``) must win over ``/{assessment_id}``.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import AssetRelationship, ComplianceAssessmentDocument as Doc, ComplianceAssessmentDocumentItem as Item, GRCUser, ITAsset, Team, get_db
from ...routers.auth_router import get_user_primary_tenant, get_user_tenants, require_auth
from ...services.assessment_assignees import missing as missing_assignees
from . import nist, scoping

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/compliance/assessments", tags=["Compliance Assessments"])

# the answers a questionnaire carries: they are not copied into a new assessment (everything else of an item is the question)
RESET = {"compliance_status": "in_progress", "gaps_identified": None, "proposed_solution": None, "maturity_score": None, "risk_rating": None,
         "remediation_status": None, "asset_status": {}, "target_date": None, "closed_at": None, "assignees": [],
         "ai_evidence_recommendation": None, "ai_recommendation_generated_at": None}
NOT_COPIED = {"id", "assessment_id", "tenant_id", "created_at", "updated_at"}


def _problem(code: int, message: str, **more: Any) -> HTTPException:
    return HTTPException(status_code=code, detail={"message": message, **more} if more else message)


def _tenant(db: Session, user: GRCUser) -> int:
    tid = get_user_primary_tenant(user, db)
    if not tid:
        raise _problem(status.HTTP_400_BAD_REQUEST, "You are not assigned to an organisation.")
    return tid


def _doc(db: Session, user: GRCUser, assessment_id: int) -> Doc:
    doc = db.query(Doc).filter(Doc.id == assessment_id, Doc.tenant_id.in_(get_user_tenants(user, db) or [0])).first()
    if doc is None:
        raise _problem(status.HTTP_404_NOT_FOUND, "Assessment not found.")
    return doc


def find_template(db: Session, tenant_id: int, fmt: str) -> Optional[Doc]:
    """The questionnaire of a format: its newest assessment that is not itself made from another (the one the tab has always shown) and has questions."""
    return (db.query(Doc).filter(Doc.tenant_id == tenant_id, Doc.assessment_format == fmt, Doc.scope_model.is_(None), Doc.total_items > 0)
            .order_by(Doc.created_at.desc(), Doc.id.desc()).first())


def _names(db: Session, ids: List[int]) -> Dict[int, str]:
    ids = [i for i in {int(i) for i in ids if i}]
    return {uid: display or username for uid, display, username in db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids))} if ids else {}


def _facts(db: Session, tenant_id: int, asset_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """What the asset library says about these assets now (frozen into the snapshot when the assessment starts)."""
    ids = sorted({int(i) for i in asset_ids if i})
    if not ids:
        return {}
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(ids)).all()
    owners = _names(db, [a.primary_owner_id or a.owner_id for a in assets])
    teams = {t.id: t.name for t in db.query(Team).filter(Team.id.in_([a.owning_team_id for a in assets if a.owning_team_id] or [0]))}
    return {a.id: {
        "asset_id": a.id, "name": a.name, "asset_type": a.asset_type, "owner": owners.get(a.primary_owner_id or a.owner_id) or a.owner_name,
        "owner_id": a.primary_owner_id or a.owner_id, "department": teams.get(a.owning_team_id) or a.department, "environment": a.environment,
        "criticality": a.criticality, "data_classification": a.data_classification, "internet_facing": bool(a.internet_facing), "status": a.status,
        "lifecycle_state": a.lifecycle_state, "business_function": a.business_function, "host_name": a.host_name,
    } for a in assets}


def _related(db: Session, tenant_id: int, asset_id: int) -> List[Dict[str, Any]]:
    """The assets the library connects to this one, either way, so the person can say which of them are in scope (none is, by default)."""
    out: List[Dict[str, Any]] = []
    edges = db.query(AssetRelationship).filter(AssetRelationship.tenant_id == tenant_id,
                                               (AssetRelationship.source_asset_id == asset_id) | (AssetRelationship.target_asset_id == asset_id)).limit(60).all()
    others = {e.target_asset_id if e.source_asset_id == asset_id else e.source_asset_id for e in edges}
    facts = {a.id: a for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(others or {0}))}
    seen = set()
    for e in edges:
        other = e.target_asset_id if e.source_asset_id == asset_id else e.source_asset_id
        if other in seen or other not in facts:
            continue
        seen.add(other)
        out.append({"asset_id": other, "name": facts[other].name, "asset_type": facts[other].asset_type, "relationship": e.relationship_type,
                    "direction": "outgoing" if e.source_asset_id == asset_id else "incoming"})
    return sorted(out, key=lambda r: r["name"] or "")


def _domains(db: Session, assessment_id: Optional[int]) -> List[Dict[str, Any]]:
    if not assessment_id:
        return []
    rows = (db.query(Item.area_domain, func.count(Item.id)).filter(Item.assessment_id == assessment_id).group_by(Item.area_domain).all())
    return sorted(({"name": name or "Uncategorized", "count": n} for name, n in rows), key=lambda d: d["name"])


def _stored_scope(doc: Doc) -> Dict[str, Any]:
    """The stored scope, with every key present (an assessment saved before a key existed reads back with its default)."""
    try:
        return scoping.validate_scope(doc.scope_model, doc.scope or {})
    except scoping.ScopeError:
        return dict(doc.scope or {})


def _view_domains(db: Session, doc: Doc, scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The domains the people who take part can be given: those of the questionnaire, or (a NIST assessment not started yet) of the questions its scope would make."""
    if doc.phase != "scoping":
        return _domains(db, doc.id)
    if nist.is_nist(doc.assessment_format):
        return nist.domains_of_scope(doc.assessment_format, scope)
    return _domains(db, doc.template_id)


def _view(db: Session, doc: Doc) -> Dict[str, Any]:
    scope = _stored_scope(doc) if doc.scope_model else {}
    tid = doc.tenant_id
    template = db.get(Doc, doc.template_id) if doc.template_id else None
    asset_ids = [r["asset_id"] for r in scope.get("assets") or []]
    facts = _facts(db, tid, asset_ids)
    primary = next((r for r in scope.get("assets") or [] if r.get("role") == "primary"), None)
    names = _names(db, [doc.owner_id] + [p.get("user_id") for p in scope.get("participants") or []])
    out: Dict[str, Any] = {
        "id": doc.id, "name": doc.name, "assessment_format": doc.assessment_format, "format_label": scoping.label_of(doc.assessment_format),
        "scope_model": doc.scope_model, "family": scoping.FAMILY.get(doc.scope_model or ""), "phase": doc.phase, "status": doc.status,
        "locked": doc.phase != "scoping", "owner": {"id": doc.owner_id, "name": names.get(doc.owner_id)} if doc.owner_id else None,
        "due_date": doc.due_date.isoformat() if doc.due_date else None, "started_at": doc.started_at.isoformat() if doc.started_at else None,
        "total_items": doc.total_items or 0, "template": {"id": template.id, "name": template.name, "items": template.total_items or 0} if template else None,
        "scope": scope, "facts": {str(k): v for k, v in facts.items()}, "participant_names": {str(k): v for k, v in names.items()},
        "primary_asset": facts.get(primary["asset_id"]) if primary else None,
        "related_assets": _related(db, tid, primary["asset_id"]) if primary else [],
        "domains": _view_domains(db, doc, scope),
        "library": ({**{k: v for k, v in nist.NIST_FORMATS[doc.assessment_format].items() if k in ("title", "publication", "version", "url")}, "source": nist.source(doc.assessment_format)}
                    if nist.is_nist(doc.assessment_format) else None),
        "snapshot": doc.scope_snapshot, "subject_summary": doc.subject_summary,
    }
    out["readiness"] = scoping.readiness(doc.scope_model, doc.assessment_format or "", scope, doc.owner_id) if doc.scope_model else None
    return out


# ── the questionnaires ──────────────────────────────────────────────────────────────────────────────────────────────
@router.get("/templates")
def list_templates(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """For each Cyber Security assessment type: what it is, its questionnaire (domains and size) and how many assessments of it are open."""
    tid = _tenant(db, current_user)
    counts: Dict[str, Dict[str, int]] = {}
    for fmt, phase, n in (db.query(Doc.assessment_format, Doc.phase, func.count(Doc.id)).filter(Doc.tenant_id == tid, Doc.scope_model.isnot(None))
                          .group_by(Doc.assessment_format, Doc.phase).all()):
        counts.setdefault(fmt, {})[phase or "in_progress"] = n
    out = []
    for fmt in scoping.ORDER:
        tpl = find_template(db, tid, fmt)
        model = scoping.SCOPE_MODEL[fmt]
        c = counts.get(fmt, {})
        out.append({
            "assessment_format": fmt, "label": scoping.LABELS[fmt], "scope_model": model, "family": scoping.FAMILY[model],
            "questionnaire": {"assessment_id": tpl.id, "name": tpl.name, "items": tpl.total_items or 0, "domains": _domains(db, tpl.id)} if tpl else None,
            "scoping": c.get("scoping", 0), "in_progress": c.get("in_progress", 0),
        })
    for fmt, info in nist.NIST_FORMATS.items():                       # made from the NIST library: no workbook to upload
        c = counts.get(fmt, {})
        catalog = nist.catalog_info(fmt)
        out.append({
            "assessment_format": fmt, "label": info["label"], "scope_model": nist.SCOPE_MODEL, "family": scoping.FAMILY[nist.SCOPE_MODEL],
            "questionnaire": {"assessment_id": None, "name": info["title"], "items": catalog["items"], "domains": catalog["domains"]},
            "library": {**{k: v for k, v in info.items() if k in ("title", "publication", "version", "url")}, "source": nist.source(fmt),
                        "baselines": catalog.get("baselines")},
            "scoping": c.get("scoping", 0), "in_progress": c.get("in_progress", 0),
        })
    return {"templates": out}


# ── a new assessment ────────────────────────────────────────────────────────────────────────────────────────────────
class InitiateIn(BaseModel):
    assessment_format: str
    asset_id: Optional[int] = None                       # an application, from the asset library (asset assessments)
    subject: Optional[str] = Field(default=None, max_length=200)   # the function or process (process assessments)
    name: Optional[str] = Field(default=None, max_length=300)


@router.post("/initiate", status_code=status.HTTP_201_CREATED)
def initiate_assessment(body: InitiateIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """A draft in the scoping phase: no questions yet (Start copies them once the scope is settled)."""
    fmt = body.assessment_format
    model = scoping.model_of(fmt)
    if model is None:
        raise _problem(status.HTTP_400_BAD_REQUEST, "That is not a Cyber Security or NIST assessment type.")
    tid = _tenant(db, current_user)
    template = None if nist.is_nist(fmt) else find_template(db, tid, fmt)
    if template is None and not nist.is_nist(fmt):
        raise _problem(status.HTTP_409_CONFLICT, f"{scoping.label_of(fmt)} has no questionnaire yet. Upload its workbook first.")
    scope: Dict[str, Any] = {}
    primary_asset_id = None
    if model == "asset":
        asset = db.query(ITAsset).filter(ITAsset.id == (body.asset_id or 0), ITAsset.tenant_id == tid).first()
        if asset is None:
            raise _problem(status.HTTP_404_NOT_FOUND, "Choose an application from the asset library.")
        subject, primary_asset_id = asset.name, asset.id
        env = (asset.environment or "").strip().lower()
        scope = {"assets": [{"asset_id": asset.id, "role": "primary"}], "environment": env if env in ("production", "staging", "test", "development") else None}
        owner = asset.primary_owner_id or asset.owner_id
        if owner and not missing_assignees(db, [{"type": "user", "id": owner}]):
            scope["participants"] = [{"kind": "user", "user_id": owner, "role": "owner"}]       # the application's owner, from the library
    elif model == "system":
        subject = (body.subject or "").strip()
        if not subject:
            raise _problem(status.HTTP_400_BAD_REQUEST, "Name the system or unit to assess.")
        scope = {"system": subject}
        if fmt == "nist_csf2":
            scope["functions"] = list(nist.CSF_FUNCTIONS)                    # all six to begin with; the person narrows them
    else:
        subject = (body.subject or "").strip()
        if not subject:
            raise _problem(status.HTTP_400_BAD_REQUEST, "Name the function or process to assess.")
        scope = {"function": subject}
    doc = Doc(tenant_id=tid, name=(body.name or f"{scoping.label_of(fmt)} - {subject}").strip()[:500], assessment_type=template.assessment_type if template else "nist_assessment",
              source=template.source if template else "NIST library",
              status="draft", assessment_format=fmt, scope_model=model, phase="scoping", template_id=template.id if template else None, owner_id=current_user.id,
              primary_asset_id=primary_asset_id, linked_asset_ids=[primary_asset_id] if primary_asset_id else [], asset_levels={},
              scope=scoping.validate_scope(model, scope), created_by=current_user.id, total_items=0, complied_count=0, partially_complied_count=0,
              not_complied_count=0, in_progress_count=0, na_count=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _view(db, doc)


@router.get("/{assessment_id}/scope")
def get_scope(assessment_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return _view(db, _doc(db, current_user, assessment_id))


class ScopeIn(BaseModel):
    """Only what is sent changes (``scope`` keys replace the stored ones whole); an explicit null clears the due date."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=300)
    owner_id: Optional[int] = None
    due_date: Optional[date] = None
    scope: Optional[Dict[str, Any]] = None


def _check_references(db: Session, tenant_id: int, model: str, scope: Dict[str, Any], owner_id: Optional[int]) -> None:
    """Every person, team and asset the scope names exists in this organisation; one primary application; a function has no primary or component."""
    problems: List[Dict[str, str]] = []
    wanted = [{"type": p["kind"], "id": p["user_id"] if p["kind"] == "user" else p["team_id"]} for p in scope.get("participants") or [] if p["kind"] in ("user", "team")]
    if owner_id:
        wanted.append({"type": "user", "id": owner_id})
    for gone in missing_assignees(db, wanted):
        problems.append({"field": "participants" if gone["id"] != owner_id else "owner_id", "message": f"A {gone['type']} chosen is not in this organisation or is no longer active."})
    refs = scope.get("assets") or []
    ids = {r["asset_id"] for r in refs}
    found = {r[0] for r in db.query(ITAsset.id).filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(ids or {0}))}
    if ids - found:
        problems.append({"field": "assets", "message": "An asset chosen is not in the asset library."})
    if len({r["asset_id"] for r in refs}) != len(refs):
        problems.append({"field": "assets", "message": "An asset is listed twice."})
    primaries = [r for r in refs if r["role"] == "primary"]
    if model == "asset" and len(primaries) > 1:
        problems.append({"field": "assets", "message": "An assessment has one primary application: add the others as components, or assess each in its own assessment."})
    if model in ("process", "system") and any(r["role"] in ("primary", "component") for r in refs):
        problems.append({"field": "assets", "message": "Assets of a function or a system are supporting context: they are listed, not assessed."})
    if problems:
        raise _problem(status.HTTP_422_UNPROCESSABLE_ENTITY, "The scope is not complete or valid.", errors=problems)


@router.put("/{assessment_id}/scope")
def put_scope(assessment_id: int, body: ScopeIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Save what was sent (the page saves as it goes). Once the questions are open the subject, environment, level, period and exclusions are locked:
    who takes part, the notes and the evidence plan can still change."""
    doc = _doc(db, current_user, assessment_id)
    if not doc.scope_model:
        raise _problem(status.HTTP_409_CONFLICT, "This is a questionnaire, not an assessment with a scope.")
    sent = body.model_fields_set
    before = _stored_scope(doc)
    scope = before
    if body.scope is not None:
        try:
            scope = scoping.validate_scope(doc.scope_model, scoping.merge_scope(before, body.scope))
        except scoping.ScopeError as exc:
            raise _problem(status.HTTP_422_UNPROCESSABLE_ENTITY, "The scope is not complete or valid.", errors=exc.errors) from exc
        refs = scope.get("assets") or []
        if doc.scope_model == "asset" and doc.primary_asset_id and not any(r["role"] == "primary" for r in refs):
            # the application is chosen when the draft is made: a list of assets that leaves it out (a client sending only the others) does not remove it
            scope = {**scope, "assets": [{"asset_id": doc.primary_asset_id, "role": "primary", "reason": ""}] + [r for r in refs if r["asset_id"] != doc.primary_asset_id]}
    if doc.phase != "scoping":
        locked = [k for k in scoping.changed_keys(before, scope) if k not in scoping.OPEN_AFTER_START[doc.scope_model]]
        if locked:
            raise _problem(status.HTTP_409_CONFLICT, "The questions are open, so this part of the scope is fixed: " + ", ".join(locked) + ".", fields=locked)
    owner_id = body.owner_id if "owner_id" in sent and body.owner_id else doc.owner_id
    _check_references(db, doc.tenant_id, doc.scope_model, scope, owner_id)
    if "name" in sent and body.name:
        doc.name = body.name.strip()[:500]
    if "owner_id" in sent and body.owner_id:
        doc.owner_id = body.owner_id
    if "due_date" in sent:
        doc.due_date = datetime.combine(body.due_date, datetime.min.time()) if body.due_date else None
    doc.scope = scope
    refs = scope.get("assets") or []
    doc.primary_asset_id = next((r["asset_id"] for r in refs if r["role"] == "primary"), None) if doc.scope_model == "asset" else None
    doc.linked_asset_ids = [r["asset_id"] for r in refs if r["role"] != "excluded"]      # what the assets views and the ASVS tab have always read
    if doc.phase != "scoping":                                                           # the paragraph the AI reads follows who takes part
        facts = {int(r["asset_id"]): r for r in (doc.scope_snapshot or {}).get("assets") or []}
        doc.subject_summary = scoping.summary_text(doc.scope_model, doc.assessment_format or "", scope, facts)
    db.commit()
    db.refresh(doc)
    return _view(db, doc)


# ── start ───────────────────────────────────────────────────────────────────────────────────────────────────────────
@router.post("/{assessment_id}/start")
def start_assessment(assessment_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Open the questionnaire: the scope must be ready; its facts are kept as they are today; the questions are copied without their answers and
    assigned to the people who listed their domain."""
    from ...routers.compliance_assessments_router import calculate_assessment_stats      # imported here: that module is loaded after this one

    doc = _doc(db, current_user, assessment_id)
    if not doc.scope_model:
        raise _problem(status.HTTP_409_CONFLICT, "This is a questionnaire, not an assessment with a scope.")
    if doc.phase != "scoping":
        raise _problem(status.HTTP_409_CONFLICT, "This assessment has already started.")
    scope = _stored_scope(doc)
    ready = scoping.readiness(doc.scope_model, doc.assessment_format or "", scope, doc.owner_id)
    if not ready["ready"]:
        raise _problem(status.HTTP_422_UNPROCESSABLE_ENTITY, "The scope is not ready to start.", checks=[c for c in ready["checks"] if c["required"] and not c["ok"]])
    _check_references(db, doc.tenant_id, doc.scope_model, scope, doc.owner_id)
    people = scope.get("participants") or []
    made = []
    template = None
    if nist.is_nist(doc.assessment_format):
        questions = nist.build_items(doc.assessment_format or "", scope)                    # from the baseline or the functions the scope chose
        if not questions:
            raise _problem(status.HTTP_409_CONFLICT, "The scope leaves no questions to assess.")
        template_info = {"id": None, "name": scoping.label_of(doc.assessment_format), "items": len(questions), "file_name": None, "uploaded_at": None,
                         "library": nist.source(doc.assessment_format or "")}
        for q in questions:
            made.append(Item(assessment_id=doc.id, tenant_id=doc.tenant_id, **{"compliance_status": "in_progress", **q,
                                                                                 "assignees": scoping.assignment_targets(people, q["area_domain"])}))
    else:
        template = db.get(Doc, doc.template_id) if doc.template_id else None
        if template is None or not template.total_items:
            template = find_template(db, doc.tenant_id, doc.assessment_format or "")
        if template is None:
            raise _problem(status.HTTP_409_CONFLICT, "The questionnaire of this assessment type is gone. Upload its workbook first.")
        source = db.query(Item).filter(Item.assessment_id == template.id).order_by(Item.id).all()
        if not source:
            raise _problem(status.HTTP_409_CONFLICT, "The questionnaire has no questions.")
        columns = [c.name for c in Item.__table__.columns if c.name not in NOT_COPIED]
        for q in source:
            values = {c: getattr(q, c) for c in columns}
            values.update({k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v) for k, v in RESET.items()})
            values["assignees"] = scoping.assignment_targets(people, q.area_domain)
            why = scoping.not_applicable(doc.assessment_format or "", scope, q.remarks)         # the scope says it does not apply: N/A, with the reason recorded
            if why:
                values["compliance_status"] = "na"
                values["remarks"] = (f"{q.remarks} | " if q.remarks else "") + f"Not applicable: {why}"
            made.append(Item(assessment_id=doc.id, tenant_id=doc.tenant_id, **values))
        template_info = {"id": template.id, "name": template.name, "items": len(source), "file_name": template.file_name,
                         "uploaded_at": template.upload_date.isoformat() if template.upload_date else None}
    db.add_all(made)
    db.flush()
    stats = calculate_assessment_stats(made)
    doc.total_items, doc.complied_count, doc.partially_complied_count = stats["total"], stats["complied"], stats["partially_complied"]
    doc.not_complied_count, doc.in_progress_count, doc.na_count, doc.overall_score = stats["not_complied"], stats["in_progress"], stats["na"], stats["overall_score"]
    facts = _facts(db, doc.tenant_id, [r["asset_id"] for r in scope.get("assets") or []])
    names = _names(db, [doc.owner_id, current_user.id] + [p.get("user_id") for p in people])
    doc.scope_snapshot = {
        "taken_at": datetime.utcnow().isoformat(), "taken_by": {"id": current_user.id, "name": names.get(current_user.id)},
        "format": doc.assessment_format, "label": scoping.label_of(doc.assessment_format), "scope_model": doc.scope_model,
        "template": template_info,
        "owner": {"id": doc.owner_id, "name": names.get(doc.owner_id)},
        "assets": [{**r, **(facts.get(r["asset_id"]) or {})} for r in scope.get("assets") or []],
        "participants": [{**p, "display": names.get(p.get("user_id")) or p.get("name") or None} for p in people],
        "scope": scope,
    }
    doc.subject_summary = scoping.summary_text(doc.scope_model, doc.assessment_format or "", scope, facts)
    if doc.assessment_format == "asvs_checklist" and scope.get("level") and doc.primary_asset_id:
        doc.asset_levels = {str(doc.primary_asset_id): int(scope["level"])}                # what the ASVS tab has always read to filter by level
    doc.template_id, doc.phase, doc.status, doc.started_at = (template.id if template else None), "in_progress", "in_progress", datetime.utcnow()
    db.commit()
    db.refresh(doc)
    return _view(db, doc)


# ── what the assessor decides (NIST assessments) ─────────────────────────────────────────────────────────────────────
class DecisionIn(BaseModel):
    """One decision on an item. SP 800-53A: ``objective`` + ``determination`` (satisfied, other_than_satisfied, not_applicable, null to clear) and/or ``note``, or
    ``all`` to give every objective the same determination. CSF 2.0: ``current`` and/or ``target`` (NI, PI, LI, FI, NA, null to clear). Only what is sent changes."""
    objective: Optional[str] = Field(default=None, max_length=100)
    determination: Optional[str] = Field(default=None, max_length=40)
    all: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=1000)
    current: Optional[str] = Field(default=None, max_length=4)
    target: Optional[str] = Field(default=None, max_length=4)


@router.put("/items/{item_id}/determination")
def decide_item(item_id: int, body: DecisionIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Record a decision on a NIST item and derive its status from what is decided (800-53A: Satisfied only when every objective is, Other than satisfied as soon
    as one is not; CSF: the implementation level). The assessment's counts and score follow."""
    from ...routers.compliance_assessments_router import calculate_assessment_stats

    item = db.query(Item).filter(Item.id == item_id, Item.tenant_id.in_(get_user_tenants(current_user, db) or [0])).first()
    if item is None:
        raise _problem(status.HTTP_404_NOT_FOUND, "Assessment item not found.")
    doc = db.get(Doc, item.assessment_id)
    if doc is None or not nist.is_nist(doc.assessment_format) or not item.assessment_data:
        raise _problem(status.HTTP_409_CONFLICT, "This item has nothing to determine.")
    if doc.phase == "scoping":
        raise _problem(status.HTTP_409_CONFLICT, "Start the assessment first.")
    sent = body.model_fields_set
    change = {("all" if k == "all" else k): getattr(body, k) for k in ("objective", "determination", "all", "note", "current", "target") if k in sent}
    if "all" in change and change["all"] is None:
        change.pop("all")
    try:
        data = nist.decide(item.assessment_data, change)
    except nist.DeterminationError as exc:
        raise _problem(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    item.assessment_data = data                                                      # reassigned: the JSON column must see the change
    item.compliance_status = nist.status_of(data)
    done = item.compliance_status == "complied"
    if done and not item.closed_at:
        item.closed_at = datetime.utcnow()
    elif not done and item.closed_at:
        item.closed_at = None
    item.updated_at = datetime.utcnow()
    db.flush()
    stats = calculate_assessment_stats(db.query(Item).filter(Item.assessment_id == doc.id).all())
    doc.complied_count, doc.partially_complied_count, doc.not_complied_count = stats["complied"], stats["partially_complied"], stats["not_complied"]
    doc.in_progress_count, doc.na_count, doc.overall_score, doc.updated_at = stats["in_progress"], stats["na"], stats["overall_score"], datetime.utcnow()
    db.commit()
    return {"id": item.id, "compliance_status": item.compliance_status, "assessment_data": item.assessment_data,
            "counts": {"complied": doc.complied_count, "partially_complied": doc.partially_complied_count, "not_complied": doc.not_complied_count,
                       "in_progress": doc.in_progress_count, "na": doc.na_count}, "overall_score": doc.overall_score}
