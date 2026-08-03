"""Unified Control Library WORKBENCH API.

One working surface over the three control SOURCES (internal / framework /
normalized). A ControlWorkItem is lazily created the first time a source control
is worked; all work — assignment, status, effectiveness, tests, evidence, AI
test-procedure checklists, approval workflow, escalations, risk links — hangs off
it. Framework scope is admin-set and stored tenant-wide in Tenant.settings so the
selection survives refresh/logout and is shared by every user.
"""
import json
import logging
import os
import re
import threading
import uuid
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, UploadFile, File, Form
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.exc import SQLAlchemyError
from pydantic import BaseModel

from ....config import get_openai_model
from ....models import (
    get_db, GRCUser, Tenant,
    ControlWorkItem, ControlWorkTest, ControlWorkTestProcedure, ControlWorkEvidence,
    ControlWorkEscalation, ControlWorkWorkflowAction, ControlWorkRiskLink,
    ControlAssuranceSnapshot, CONTROL_WORKBENCH_MODELS,
    NormalizedControl, NormalizedControlLink, NormalizationRun,
    InternalControl, InternalControlTest, InternalControlEscalation,
    InternalControlRiskLink, InternalControlEvidence,
    ParsedFrameworkControl, UploadedFramework, Evidence, EvidenceControlMapping, Risk,
)
from ....routers.auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workbench", tags=["Control Library - Workbench"])

_ENSURED: set = set()

# Shared evidence-library file store (same location the /evidence module uses:
# backend/grc/uploads/evidence/{tenant_id}/{uuid}{ext}) so a control-workbench
# upload becomes a first-class Evidence record — reviewable, OCR-able, and
# visible in the Evidence library, not a metadata-only stub.
_EVIDENCE_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "uploads", "evidence")
_ALLOWED_EVIDENCE_EXT = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv",
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif",
    "zip", "json", "xml", "html", "log", "msg", "eml",
}


# ───────────────────────── infra / helpers ──────────────────────────────────
def ensure_tables(db: Session) -> None:
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _ENSURED:
        return
    try:
        for model in CONTROL_WORKBENCH_MODELS:
            model.__table__.create(bind=db.get_bind(), checkfirst=True)
        _ENSURED.add(key)
    except Exception:  # noqa: BLE001
        logger.warning("workbench ensure_tables failed", exc_info=True)


def _tenant(current_user, db) -> Optional[int]:
    tids = get_user_tenants(current_user, db)
    return tids[0] if tids else None


def _user_map(db: Session, ids) -> dict:
    ids = [i for i in {*ids} if i]
    if not ids:
        return {}
    rows = db.query(GRCUser).filter(GRCUser.id.in_(ids)).all()
    out = {}
    for u in rows:
        name = (getattr(u, "full_name", None) or getattr(u, "display_name", None)
                or getattr(u, "username", None) or getattr(u, "email", None) or f"User {u.id}")
        out[u.id] = {"id": u.id, "display_name": name, "email": getattr(u, "email", None)}
    return out


# ── framework scope (admin-set, tenant-wide via Tenant.settings) ─────────────
_SETTINGS_KEY = "control_workbench"


def _get_scope(db: Session, tenant_id: int) -> dict:
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    settings = (t.settings or {}) if t else {}
    return dict(settings.get(_SETTINGS_KEY, {}) or {})


def _set_scope(db: Session, tenant_id: int, framework_ids, updated_by=None) -> dict:
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        return {}
    settings = dict(t.settings or {})
    cfg = dict(settings.get(_SETTINGS_KEY, {}) or {})
    prev = set(cfg.get("framework_ids", []) or [])
    new = [int(x) for x in (framework_ids or [])]
    newset = set(new)
    # append an audit-log entry whenever the selection actually changes
    log = list(cfg.get("log", []) or [])
    if prev != newset:
        log.append({"by": updated_by, "at": datetime.utcnow().isoformat(),
                    "added": sorted(newset - prev), "removed": sorted(prev - newset),
                    "total": len(new)})
        log = log[-50:]
    cfg["framework_ids"] = new
    cfg["updated_by"] = updated_by
    cfg["log"] = log
    settings[_SETTINGS_KEY] = cfg
    t.settings = settings
    flag_modified(t, "settings")
    db.commit()
    return cfg


def _is_admin(db, user) -> bool:
    """Mirror auth_router's /me logic: admin = has the 'Administrator' role, or is
    the tenant's primary contact."""
    try:
        from ....models import UserRole, Role
        role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
        if role_ids:
            names = [r.name for r in db.query(Role).filter(Role.id.in_(role_ids)).all()]
            if any(n == "Administrator" for n in names):
                return True
        t = db.query(Tenant).first()
        pce = getattr(t, "primary_contact_email", None) if t else None
        if pce and getattr(user, "email", None) and pce.lower() == user.email.lower():
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _scope_framework_ids(db: Session, tids):
    """Uploaded frameworks visible to this tenant — its own + global seed
    frameworks (tenant_id NULL) not shadowed by a same-name tenant copy. Mirrors
    controls_router's framework-controls scoping so the Catalog shows ALL
    frameworks/controls, not just the two UI-uploaded ones. Returns [(id, name)]."""
    tids = tids or []
    own_names = db.query(UploadedFramework.name).filter(
        UploadedFramework.tenant_id.in_(tids), UploadedFramework.is_active == True)  # noqa: E712
    rows = db.query(UploadedFramework.id, UploadedFramework.name).filter(
        UploadedFramework.is_active == True,  # noqa: E712
        UploadedFramework.upload_status.in_(['published', 'completed', 'parsed', 'classified']),
        or_(
            UploadedFramework.tenant_id.in_(tids),
            and_(UploadedFramework.tenant_id.is_(None), ~UploadedFramework.name.in_(own_names)),
        ),
    ).order_by(UploadedFramework.name).all()
    return [(r.id, r.name) for r in rows]


# ── source resolution ────────────────────────────────────────────────────────
def _baseline_run_id(db: Session, tenant_id: int) -> Optional[int]:
    try:
        run = (db.query(NormalizationRun)
               .filter(NormalizationRun.tenant_id == tenant_id,
                       NormalizationRun.is_baseline == True,  # noqa: E712
                       NormalizationRun.status == "completed")
               .order_by(NormalizationRun.id.desc()).first())
        if not run:
            run = (db.query(NormalizationRun)
                   .filter(NormalizationRun.tenant_id == tenant_id,
                           NormalizationRun.scope == "full",
                           NormalizationRun.status == "completed")
                   .order_by(NormalizationRun.id.desc()).first())
        return run.id if run else None
    except SQLAlchemyError:
        db.rollback()
        return None


# ── canonical domains (the Library's 20-domain taxonomy, via the baseline) ──
# Every parsed framework control was classified into one of the 20 canonical
# domains by the normalization pipeline; the mapping lives in the baseline run's
# NormalizedControlLink → NormalizedControl.domain. Cached per baseline run id.
_DOM_CACHE: dict = {"run_id": None, "pmap": {}, "domains": []}
UNCLASSIFIED = "Unclassified"

# generic words shared across domain names — excluded so distinctive words drive
# the internal-category → canonical-domain match (same lesson as extend_baseline)
_DOMAIN_STOPWORDS = {"security", "management", "and", "the", "of", "it"}


def _canonical_maps(db: Session, tenant_id: int):
    """Return ({parsed_control_id: canonical_domain}, [domains largest-first])."""
    run_id = _baseline_run_id(db, tenant_id)
    if run_id and _DOM_CACHE["run_id"] == run_id:
        return _DOM_CACHE["pmap"], _DOM_CACHE["domains"]
    pmap: dict = {}
    domains: list = []
    if run_id:
        try:
            rows = (db.query(NormalizedControlLink.parsed_control_id, NormalizedControl.domain)
                    .join(NormalizedControl,
                          NormalizedControl.id == NormalizedControlLink.normalized_control_id)
                    .filter(NormalizedControl.run_id == run_id).all())
            for pid, dom in rows:
                if pid and dom:
                    pmap[pid] = dom
            from collections import Counter
            domains = [d for d, _ in Counter(pmap.values()).most_common()]
            _DOM_CACHE.update(run_id=run_id, pmap=pmap, domains=domains)
        except SQLAlchemyError:
            db.rollback()
    return pmap, domains


def _canonical_for_text(text_val: Optional[str], domains: list) -> Optional[str]:
    """Best canonical domain for a free-text category (internal controls)."""
    if not text_val:
        return None
    t = text_val.strip().lower()
    for d in domains:
        if t == d.lower():
            return d
    ttok = {w for w in re.split(r"[^a-z]+", t) if w and w not in _DOMAIN_STOPWORDS}
    best, score = None, 0
    for d in domains:
        dtok = {w for w in re.split(r"[^a-z]+", d.lower()) if w and w not in _DOMAIN_STOPWORDS}
        s = len(ttok & dtok)
        if s > score:
            best, score = d, s
    return best


def _work_item_domain(wi: ControlWorkItem, pmap: dict, domains: list) -> str:
    if wi.source_type == "framework":
        return pmap.get(wi.source_id) or UNCLASSIFIED
    if wi.source_type == "normalized":
        return wi.domain or UNCLASSIFIED  # cached from NormalizedControl.domain (canonical)
    return _canonical_for_text(wi.domain or wi.category, domains) or UNCLASSIFIED


_EFF_RANK = {"ineffective": 3, "partially_effective": 2, "effective": 1}


def _eff_bucket(wi: ControlWorkItem) -> str:
    """Worst-of design/operating effectiveness (auditor-conservative)."""
    vals = [v for v in (wi.design_effectiveness, wi.operating_effectiveness) if v in _EFF_RANK]
    return max(vals, key=lambda v: _EFF_RANK[v]) if vals else "not_tested"


def _hidden_parsed_ids(db: Session, tid: int) -> set:
    """Framework members of promoted normalized controls — hidden from lists."""
    promoted = db.query(ControlWorkItem.source_id).filter(
        ControlWorkItem.tenant_id == tid, ControlWorkItem.source_type == "normalized").all()
    if not promoted:
        return set()
    return {l.parsed_control_id for l in db.query(NormalizedControlLink.parsed_control_id).filter(
        NormalizedControlLink.normalized_control_id.in_([p.source_id for p in promoted])).all()
        if l.parsed_control_id}


def _scoped_normalized_ids(db: Session, tenant_id: int, run_id, framework_ids) -> Optional[set]:
    """Normalized-control ids whose members belong to one of the selected
    uploaded frameworks. None → no scope (show all)."""
    if not framework_ids:
        return None
    try:
        parsed_ids = [r.id for r in db.query(ParsedFrameworkControl.id)
                      .filter(ParsedFrameworkControl.uploaded_framework_id.in_(framework_ids)).all()]
        if not parsed_ids:
            return set()
        q = db.query(NormalizedControlLink.normalized_control_id).filter(
            NormalizedControlLink.parsed_control_id.in_(parsed_ids))
        return {r.normalized_control_id for r in q.all() if r.normalized_control_id}
    except SQLAlchemyError:
        db.rollback()
        return None


def _normalized_frameworks(db: Session, nc_ids) -> dict:
    """Map normalized_control_id → sorted list of framework names it covers."""
    if not nc_ids:
        return {}
    try:
        links = (db.query(NormalizedControlLink.normalized_control_id,
                          ParsedFrameworkControl.uploaded_framework_id)
                 .join(ParsedFrameworkControl,
                       NormalizedControlLink.parsed_control_id == ParsedFrameworkControl.id)
                 .filter(NormalizedControlLink.normalized_control_id.in_(list(nc_ids))).all())
        fw_ids = {l.uploaded_framework_id for l in links if l.uploaded_framework_id}
        fw_names = {f.id: f.name for f in db.query(UploadedFramework.id, UploadedFramework.name)
                    .filter(UploadedFramework.id.in_(fw_ids)).all()} if fw_ids else {}
        out: dict = {}
        for l in links:
            out.setdefault(l.normalized_control_id, set()).add(fw_names.get(l.uploaded_framework_id))
        return {k: sorted(n for n in v if n) for k, v in out.items()}
    except SQLAlchemyError:
        db.rollback()
        return {}


def _source_row(db: Session, tenant_id: int, source_type: str, source_id: int):
    """Return the source definition row + display fields for a given source."""
    if source_type == "internal":
        c = db.query(InternalControl).filter(
            InternalControl.id == source_id, InternalControl.tenant_id == tenant_id).first()
        if not c:
            return None
        return {"row": c, "code": c.control_id, "name": c.name, "description": c.description,
                "domain": c.category, "category": c.sub_category, "framework_name": "Internal / Risk",
                "member_count": 0}
    if source_type == "normalized":
        c = db.query(NormalizedControl).filter(NormalizedControl.id == source_id).first()
        if not c:
            return None
        fw = _normalized_frameworks(db, [source_id]).get(source_id, [])
        return {"row": c, "code": c.code, "name": c.name, "description": c.statement or c.objective,
                "domain": c.domain, "category": getattr(c, "category", None),
                "framework_name": ", ".join(fw) if fw else "Normalized", "member_count": len(fw)}
    if source_type == "framework":
        c = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == source_id).first()
        if not c:
            return None
        fwn = None
        uf = db.query(UploadedFramework).filter(UploadedFramework.id == c.uploaded_framework_id).first()
        if uf:
            fwn = uf.name
        return {"row": c, "code": c.control_id, "name": c.title, "description": c.description,
                "domain": c.domain, "category": c.category, "framework_name": fwn or "Framework",
                "member_count": 0}
    return None


def _get_or_create_work_item(db: Session, tenant_id: int, source_type: str, source_id: int,
                             created_by=None) -> Optional[ControlWorkItem]:
    ensure_tables(db)
    wi = (db.query(ControlWorkItem)
          .filter(ControlWorkItem.tenant_id == tenant_id,
                  ControlWorkItem.source_type == source_type,
                  ControlWorkItem.source_id == source_id).first())
    src = _source_row(db, tenant_id, source_type, source_id)
    if not src:
        return wi  # source gone; return whatever exists
    # cap cached display fields to their column widths (a normalized control can
    # span many frameworks → a long framework_name)
    for _k, _n in (("code", 100), ("name", 500), ("framework_name", 255), ("domain", 255), ("category", 255)):
        if isinstance(src.get(_k), str) and len(src[_k]) > _n:
            src[_k] = src[_k][: _n - 1] + "…"
    if wi:
        # refresh cached display fields
        wi.code, wi.name, wi.description = src["code"], src["name"], src["description"]
        wi.domain, wi.category = src["domain"], src["category"]
        wi.framework_name, wi.member_count = src["framework_name"], src["member_count"]
        return wi
    wi = ControlWorkItem(
        tenant_id=tenant_id, source_type=source_type, source_id=source_id,
        code=src["code"], name=src["name"], description=src["description"],
        domain=src["domain"], category=src["category"],
        framework_name=src["framework_name"], member_count=src["member_count"],
        assigned_user_ids=[], created_by=created_by,
    )
    # seed work fields + migrate existing data from an internal-control source
    if source_type == "internal":
        _seed_from_internal_control(db, wi, src["row"], tenant_id)
    db.add(wi)
    db.flush()
    if source_type == "internal":
        _migrate_internal_children(db, wi, src["row"], tenant_id)
    return wi


def sync_internal_control_work_items(
    db: Session, tenant_id: int, created_by=None,
) -> int:
    """Materialize CT&A work items from the internal-control register (idempotent).

    The assurance scorecard reads ControlWorkItem rows; without this sync the
    board stays empty until someone opens a control in the workbench."""
    ensure_tables(db)
    synced = 0
    ic_ids = [
        row[0] for row in db.query(InternalControl.id)
        .filter(InternalControl.tenant_id == tenant_id).all()
    ]
    for ic_id in ic_ids:
        if _get_or_create_work_item(db, tenant_id, "internal", ic_id, created_by=created_by):
            synced += 1
    if synced:
        db.flush()
    return synced


def _seed_from_internal_control(db, wi: ControlWorkItem, ic: InternalControl, tenant_id: int):
    wi.status = ic.status or "draft"
    wi.workflow_status = ic.workflow_status
    wi.design_effectiveness = ic.design_effectiveness
    wi.operating_effectiveness = ic.operating_effectiveness
    wi.last_tested_at = ic.last_tested_at
    wi.next_test_date = ic.next_test_date
    wi.frequency = ic.frequency
    wi.priority = ic.priority or "medium"
    wi.is_key_control = bool(ic.is_key_control)
    wi.owner_id = ic.owner_id
    if ic.owner_id:
        wi.assigned_user_ids = [ic.owner_id]
        wi.assigned_to_user_id = ic.owner_id


def _migrate_internal_children(db, wi: ControlWorkItem, ic: InternalControl, tenant_id: int):
    """Copy an internal control's existing tests / escalations / risk links / evidence
    onto the new work item (one-time, on first materialization)."""
    try:
        for t in db.query(InternalControlTest).filter(InternalControlTest.control_id == ic.id).all():
            db.add(ControlWorkTest(
                work_item_id=wi.id, tenant_id=tenant_id, test_type=t.test_type,
                test_date=t.test_date, test_period_start=t.test_period_start,
                test_period_end=t.test_period_end, tester_id=t.tester_id, reviewer_id=t.reviewer_id,
                sample_size=t.sample_size, exceptions_found=t.exceptions_found or 0,
                result=t.result, findings=t.findings, recommendations=t.recommendations,
                management_response=t.management_response,
                evidence_references=t.evidence_references or [], status=t.status,
                reviewed_at=t.reviewed_at, created_at=t.created_at))
        for e in db.query(InternalControlEscalation).filter(
                InternalControlEscalation.control_id == ic.id).all():
            db.add(ControlWorkEscalation(
                work_item_id=wi.id, tenant_id=tenant_id, escalation_level=e.escalation_level,
                escalation_name=e.escalation_name, trigger_condition=e.trigger_condition,
                trigger_threshold=e.trigger_threshold, escalate_to_user_id=e.escalate_to_user_id,
                escalate_to_role=e.escalate_to_role,
                escalate_to_department_id=e.escalate_to_department_id,
                escalation_timeframe_hours=e.escalation_timeframe_hours,
                notification_required=e.notification_required, is_active=e.is_active,
                created_at=e.created_at))
        for rl in db.query(InternalControlRiskLink).filter(
                InternalControlRiskLink.control_id == ic.id).all():
            db.add(ControlWorkRiskLink(
                work_item_id=wi.id, tenant_id=tenant_id, risk_id=rl.risk_id,
                link_type=rl.link_type, effectiveness_rating=rl.effectiveness_rating,
                notes=rl.notes, created_at=rl.created_at, created_by=rl.created_by))
        for ev in db.query(InternalControlEvidence).filter(
                InternalControlEvidence.internal_control_id == ic.id).all():
            db.add(ControlWorkEvidence(
                work_item_id=wi.id, tenant_id=tenant_id, evidence_id=ev.evidence_id,
                uploaded_by=ev.linked_by, uploaded_at=ev.linked_at, review_status="approved"))
    except SQLAlchemyError:
        db.rollback()
        logger.warning("internal-control child migration failed for ic %s", ic.id, exc_info=True)


def _serialize_item(db, wi: ControlWorkItem, users: dict = None) -> dict:
    users = users if users is not None else _user_map(db, (wi.assigned_user_ids or []) + [wi.owner_id])
    assignees = [users[i] for i in (wi.assigned_user_ids or []) if i in users]
    return {
        "work_item_id": wi.id, "source_type": wi.source_type, "source_id": wi.source_id,
        "code": wi.code, "name": wi.name, "description": wi.description,
        "domain": wi.domain, "category": wi.category, "framework_name": wi.framework_name,
        "member_count": wi.member_count,
        "status": wi.status, "workflow_status": wi.workflow_status,
        "implementation_status": wi.implementation_status,
        "design_effectiveness": wi.design_effectiveness,
        "operating_effectiveness": wi.operating_effectiveness,
        "last_tested_at": wi.last_tested_at.isoformat() if wi.last_tested_at else None,
        "next_test_date": wi.next_test_date.isoformat() if wi.next_test_date else None,
        "frequency": wi.frequency, "priority": wi.priority, "is_key_control": wi.is_key_control,
        "assigned_user_ids": wi.assigned_user_ids or [], "assignees": assignees,
        "notes": wi.notes,
    }


def _light_row(source_type, source_id, disp, wi):
    """A list row = source display + work-item state (may be None)."""
    base = {"source_type": source_type, "source_id": source_id,
            "code": disp["code"], "name": disp["name"], "domain": disp["domain"],
            "canonical_domain": disp.get("canonical_domain"),
            "framework_name": disp["framework_name"], "member_count": disp["member_count"],
            "work_item_id": None, "status": None, "implementation_status": "not_started",
            "design_effectiveness": None, "operating_effectiveness": None,
            "assigned_user_ids": [], "is_key_control": False}
    if wi:
        overdue = bool(wi.next_test_date and wi.next_test_date < datetime.utcnow())
        base.update({"work_item_id": wi.id, "status": wi.status,
                     "implementation_status": wi.implementation_status,
                     "design_effectiveness": wi.design_effectiveness,
                     "operating_effectiveness": wi.operating_effectiveness,
                     "assigned_user_ids": wi.assigned_user_ids or [],
                     "is_key_control": wi.is_key_control,
                     "next_test_date": wi.next_test_date.isoformat() if wi.next_test_date else None,
                     "overdue": overdue})
    return base


# ─────────────────────────── scope endpoints ────────────────────────────────
@router.get("/scope")
def get_scope(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Selected frameworks (tenant-wide) + all available uploaded frameworks
    (with control counts) + the change log — powers the Configure Frameworks page."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"framework_ids": [], "available": [], "can_edit": False, "history": []}
    cfg = _get_scope(db, tid)
    avail = _scope_framework_ids(db, get_user_tenants(current_user, db))
    fw_names = {fid: name for (fid, name) in avail}
    # control count per framework
    counts = {}
    if fw_names:
        for fwid, c in db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id)) \
                .filter(ParsedFrameworkControl.uploaded_framework_id.in_(list(fw_names.keys()))) \
                .group_by(ParsedFrameworkControl.uploaded_framework_id).all():
            counts[fwid] = c
    available = [{"id": fid, "name": name, "controls": counts.get(fid, 0)} for (fid, name) in avail]
    # resolve the change log (newest first) into readable framework names + user
    log = cfg.get("log", []) or []
    umap = _user_map(db, [e.get("by") for e in log if e.get("by")])
    history = [{
        "by": umap.get(e.get("by"), {}).get("display_name", "System") if e.get("by") else "System",
        "at": e.get("at"),
        "added": [fw_names.get(i, f"#{i}") for i in e.get("added", [])],
        "removed": [fw_names.get(i, f"#{i}") for i in e.get("removed", [])],
        "total": e.get("total"),
    } for e in reversed(log)]
    return {"framework_ids": cfg.get("framework_ids", []), "available": available,
            "can_edit": _is_admin(db, current_user), "history": history}


@router.put("/scope")
def put_scope(body: dict = Body(...), db: Session = Depends(get_db),
              current_user: GRCUser = Depends(require_auth)):
    """Admin-set tenant-wide framework selection (scopes the whole workbench)."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"ok": False}
    if not _is_admin(db, current_user):
        raise HTTPException(status_code=403, detail="Only an admin can change the tenant framework scope")
    cfg = _set_scope(db, tid, body.get("framework_ids", []), updated_by=getattr(current_user, "id", None))
    return {"ok": True, "framework_ids": cfg.get("framework_ids", [])}


@router.get("/tenant-users")
def tenant_users(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    if not tid:
        return []
    rows = db.query(GRCUser).filter(GRCUser.is_active == True).all()  # noqa: E712
    out = []
    seen = set()
    for u in rows:
        name = (getattr(u, "full_name", None) or getattr(u, "display_name", None)
                or getattr(u, "username", None) or getattr(u, "email", None) or f"User {u.id}")
        out.append({"id": u.id, "display_name": name, "email": getattr(u, "email", None)})
        seen.add(u.id)
    if current_user.id not in seen:
        out.append({"id": current_user.id, "display_name": getattr(current_user, "username", "Me"),
                    "email": getattr(current_user, "email", None)})
    return out


# ───────────────────────── domain overview (the hub) ────────────────────────
@router.get("/overview")
def overview(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Per-canonical-domain rollup powering the Catalog's domain-card hub.
    Control counts come from the sources (framework in admin scope + internal +
    promoted normalized, with promoted members hidden); work KPIs come from the
    work items. Domains are the Library's 20-domain taxonomy."""
    ensure_tables(db)
    tids = get_user_tenants(current_user, db)
    tid = tids[0] if tids else None
    if not tid:
        return {"domains": [], "totals": {}, "frameworks": []}
    pmap, domains = _canonical_maps(db, tid)
    scope_fw = set(_get_scope(db, tid).get("framework_ids", []))
    visible = dict(_scope_framework_ids(db, tids))
    if scope_fw:
        visible = {k: v for k, v in visible.items() if k in scope_fw}
    hidden = _hidden_parsed_ids(db, tid)

    per: dict = {}

    def bucket(dom: str) -> dict:
        return per.setdefault(dom, {
            "domain": dom, "controls": 0, "framework_ids": set(),
            "by_source": {"framework": 0, "internal": 0, "normalized": 0},
            "assigned": 0, "tested": 0, "effective": 0, "partially_effective": 0,
            "ineffective": 0, "evidence_pending": 0, "overdue": 0})

    # framework controls (in scope, promoted members hidden) + per-framework totals
    fw_totals: dict = {}
    if visible:
        rows = db.query(ParsedFrameworkControl.id, ParsedFrameworkControl.uploaded_framework_id) \
            .filter(ParsedFrameworkControl.uploaded_framework_id.in_(list(visible.keys()))).all()
        for pid, fwid in rows:
            if pid in hidden:
                continue
            dom = pmap.get(pid) or UNCLASSIFIED
            b = bucket(dom)
            b["controls"] += 1
            b["by_source"]["framework"] += 1
            b["framework_ids"].add(fwid)
            fw_totals[fwid] = fw_totals.get(fwid, 0) + 1

    # promoted normalized stay in their canonical domain. INTERNAL controls are
    # NOT part of the domain taxonomy (user decision) — they come from the risk
    # register, so they are reported as their own separate block, never inside a
    # domain card.
    for w in db.query(ControlWorkItem).filter(
            ControlWorkItem.tenant_id == tid, ControlWorkItem.source_type == "normalized").all():
        b = bucket(w.domain or UNCLASSIFIED)
        b["controls"] += 1
        b["by_source"]["normalized"] += 1
    internal_stats = {
        "controls": db.query(InternalControl).filter(InternalControl.tenant_id == tid).count(),
        "assigned": 0, "tested": 0, "effective": 0, "partially_effective": 0,
        "ineffective": 0, "evidence_pending": 0, "overdue": 0}

    now = datetime.utcnow()
    # work KPIs from the work layer (internal work items feed the internal block)
    wis = db.query(ControlWorkItem).filter(ControlWorkItem.tenant_id == tid).all()
    wi_dom = {}
    for wi in wis:
        if wi.source_type == "internal":
            wi_dom[wi.id] = "__internal__"
            b = internal_stats
        else:
            dom = _work_item_domain(wi, pmap, domains)
            wi_dom[wi.id] = dom
            if dom not in per:  # work item whose framework got de-scoped — skip stats
                continue
            b = per[dom]
        if wi.assigned_user_ids:
            b["assigned"] += 1
        eb = _eff_bucket(wi)
        if eb != "not_tested" or wi.last_tested_at:
            b["tested"] += 1
        if eb != "not_tested":
            b[eb] += 1
        if wi.next_test_date and wi.next_test_date < now:
            b["overdue"] += 1
    for (wid, cnt) in db.query(ControlWorkEvidence.work_item_id, func.count(ControlWorkEvidence.id)) \
            .filter(ControlWorkEvidence.tenant_id == tid,
                    ControlWorkEvidence.review_status == "pending") \
            .group_by(ControlWorkEvidence.work_item_id).all():
        dom = wi_dom.get(wid)
        if dom == "__internal__":
            internal_stats["evidence_pending"] += cnt
        elif dom in per:
            per[dom]["evidence_pending"] += cnt

    # order: canonical taxonomy order (largest-first), Unclassified last
    ordered = [d for d in domains if d in per] + \
              [d for d in per if d not in domains and d != UNCLASSIFIED] + \
              ([UNCLASSIFIED] if UNCLASSIFIED in per else [])
    out = []
    totals = {"controls": 0, "assigned": 0, "tested": 0, "effective": 0,
              "partially_effective": 0, "ineffective": 0, "evidence_pending": 0, "overdue": 0}
    totals_src = {"framework": 0, "internal": 0, "normalized": 0}
    for d in ordered:
        b = per[d]
        b["frameworks"] = len(b.pop("framework_ids"))
        for k in totals:
            totals[k] += b[k]
        for k in totals_src:
            totals_src[k] += b["by_source"][k]
        out.append(b)
    totals["by_source"] = totals_src
    fw_list = sorted(
        [{"id": fid, "name": visible.get(fid, "Framework"), "controls": n}
         for fid, n in fw_totals.items()], key=lambda x: -x["controls"])

    trend = _snapshot_and_trend(db, tid, totals, now)
    return {"domains": out, "totals": totals, "internal": internal_stats,
            "frameworks": fw_list, "trend": trend,
            "scope": {"framework_ids": sorted(scope_fw), "scoped": bool(scope_fw)}}


def _snapshot_and_trend(db: Session, tid: int, totals: dict, now: datetime) -> Optional[dict]:
    """Write at most one posture snapshot per tenant per day and return the delta
    vs the most recent earlier snapshot (None until a prior day exists)."""
    today = now.strftime("%Y-%m-%d")
    try:
        existing = db.query(ControlAssuranceSnapshot).filter(
            ControlAssuranceSnapshot.tenant_id == tid,
            ControlAssuranceSnapshot.snapshot_date == today).first()
        if not existing:
            db.add(ControlAssuranceSnapshot(
                tenant_id=tid, snapshot_date=today, controls=totals["controls"],
                tested=totals["tested"], effective=totals["effective"],
                partially_effective=totals["partially_effective"], ineffective=totals["ineffective"],
                assigned=totals["assigned"], evidence_pending=totals["evidence_pending"],
                overdue=totals["overdue"], per_domain={}))
            db.commit()
        prior = db.query(ControlAssuranceSnapshot).filter(
            ControlAssuranceSnapshot.tenant_id == tid,
            ControlAssuranceSnapshot.snapshot_date < today).order_by(
            ControlAssuranceSnapshot.snapshot_date.desc()).first()
        if not prior:
            return None
        return {"since": prior.snapshot_date,
                "tested": totals["tested"] - (prior.tested or 0),
                "effective": totals["effective"] - (prior.effective or 0),
                "assigned": totals["assigned"] - (prior.assigned or 0),
                "overdue": totals["overdue"] - (prior.overdue or 0)}
    except SQLAlchemyError:
        db.rollback()
        return None


@router.get("/overview/{domain}/groups")
def domain_groups(domain: str, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth)):
    """Framework/internal/normalized groups inside one canonical domain — the
    collapsible sections of the domain-detail view. Rows are fetched lazily per
    group via GET /controls?canonical_domain=&framework_id= (or source=)."""
    ensure_tables(db)
    tids = get_user_tenants(current_user, db)
    tid = tids[0] if tids else None
    if not tid:
        return {"groups": []}
    pmap, domains = _canonical_maps(db, tid)
    scope_fw = set(_get_scope(db, tid).get("framework_ids", []))
    visible = dict(_scope_framework_ids(db, tids))
    if scope_fw:
        visible = {k: v for k, v in visible.items() if k in scope_fw}
    hidden = _hidden_parsed_ids(db, tid)

    # per-framework control counts within the domain
    fw_counts: dict = {}
    if visible:
        for pid, fwid in db.query(ParsedFrameworkControl.id,
                                  ParsedFrameworkControl.uploaded_framework_id) \
                .filter(ParsedFrameworkControl.uploaded_framework_id.in_(list(visible.keys()))).all():
            if pid in hidden or (pmap.get(pid) or UNCLASSIFIED) != domain:
                continue
            fw_counts[fwid] = fw_counts.get(fwid, 0) + 1

    # internal controls are deliberately NOT part of the domain taxonomy — they
    # have their own block on the hub, so no internal group here.
    normalized_n = db.query(ControlWorkItem).filter(
        ControlWorkItem.tenant_id == tid, ControlWorkItem.source_type == "normalized",
        ControlWorkItem.domain == domain).count()

    # per-group work stats (tested / effectiveness) for the section header bars
    stats: dict = {}
    for wi in db.query(ControlWorkItem).filter(ControlWorkItem.tenant_id == tid).all():
        if _work_item_domain(wi, pmap, domains) != domain:
            continue
        if wi.source_type == "framework":
            src = db.query(ParsedFrameworkControl.uploaded_framework_id).filter(
                ParsedFrameworkControl.id == wi.source_id).scalar()
            key = ("framework", src)
        else:
            key = (wi.source_type, None)
        s = stats.setdefault(key, {"tested": 0, "effective": 0, "partially_effective": 0, "ineffective": 0})
        eb = _eff_bucket(wi)
        if eb != "not_tested" or wi.last_tested_at:
            s["tested"] += 1
        if eb != "not_tested":
            s[eb] += 1

    groups = [{"type": "framework", "framework_id": fid, "name": visible.get(fid, "Framework"),
               "controls": n, **stats.get(("framework", fid),
               {"tested": 0, "effective": 0, "partially_effective": 0, "ineffective": 0})}
              for fid, n in sorted(fw_counts.items(), key=lambda x: -x[1])]
    if normalized_n:
        groups.append({"type": "normalized", "framework_id": None, "name": "Normalized (promoted)",
                       "controls": normalized_n, **stats.get(("normalized", None),
                       {"tested": 0, "effective": 0, "partially_effective": 0, "ineffective": 0})})
    return {"domain": domain, "groups": groups,
            "total_controls": sum(g["controls"] for g in groups)}


# ───────────────────────────── list + my work ───────────────────────────────
@router.get("/controls")
def list_controls(
    source: Optional[str] = Query(None, description="framework|internal|normalized|all"),
    q: Optional[str] = None,
    domain: Optional[str] = None,
    canonical_domain: Optional[str] = Query(None, description="one of the 20 unified library domains"),
    framework_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    effectiveness: Optional[str] = None,
    due: Optional[str] = Query(None, description="overdue|scheduled"),
    assignee_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Control CATALOG list. Base = framework controls from the tenant's chosen
    frameworks (or all uploaded if none chosen), plus authored internal controls,
    plus normalized controls PROMOTED here from the Library. A framework control
    that is a member of a promoted normalized control is hidden — you work the
    normalized one (comply once)."""
    ensure_tables(db)
    tids = get_user_tenants(current_user, db)
    tid = tids[0] if tids else None
    if not tid:
        return {"total": 0, "items": []}
    cfg = _get_scope(db, tid)
    scope_fw = cfg.get("framework_ids", [])
    want = source or "all"
    pmap, cdomains = _canonical_maps(db, tid)

    # promoted-normalized = existing normalized work items; hide their framework members
    promoted_items = db.query(ControlWorkItem).filter(
        ControlWorkItem.tenant_id == tid, ControlWorkItem.source_type == "normalized").all()
    hidden_parsed = set()
    if promoted_items:
        for l in db.query(NormalizedControlLink.parsed_control_id).filter(
                NormalizedControlLink.normalized_control_id.in_([w.source_id for w in promoted_items])).all():
            if l.parsed_control_id:
                hidden_parsed.add(l.parsed_control_id)

    # build each source set independently (respecting framework/domain/search) so
    # we can show per-source counts; the `source` selector only picks which to show.
    def _framework_rows():
        rr = []
        visible = dict(_scope_framework_ids(db, tids))  # {uploaded_framework_id: name}
        fw_universe = [framework_id] if framework_id else (scope_fw or None)
        if fw_universe:
            fu = {int(x) for x in fw_universe}
            visible = {k: v for k, v in visible.items() if k in fu}
        if not visible:
            return rr
        fcq = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(list(visible.keys())))
        if domain:
            fcq = fcq.filter(ParsedFrameworkControl.domain == domain)
        if q:
            like = f"%{q}%"
            fcq = fcq.filter((ParsedFrameworkControl.title.ilike(like)) |
                             (ParsedFrameworkControl.control_id.ilike(like)))
        for c in fcq.order_by(ParsedFrameworkControl.control_id).limit(6000).all():
            if c.id in hidden_parsed:
                continue
            cdom = pmap.get(c.id) or UNCLASSIFIED
            if canonical_domain and cdom != canonical_domain:
                continue
            rr.append(("framework", c.id, {
                "code": c.control_id, "name": c.title, "domain": c.domain,
                "canonical_domain": cdom,
                "framework_name": visible.get(c.uploaded_framework_id, "Framework"), "member_count": 0}))
        return rr

    def _internal_rows():
        rr = []
        if canonical_domain:
            return rr  # internal controls are not part of the domain taxonomy
        icq = db.query(InternalControl).filter(InternalControl.tenant_id == tid)
        if domain:
            icq = icq.filter(InternalControl.category == domain)
        if q:
            like = f"%{q}%"
            icq = icq.filter((InternalControl.name.ilike(like)) | (InternalControl.control_id.ilike(like)))
        for c in icq.order_by(InternalControl.control_id).all():
            rr.append(("internal", c.id, {
                "code": c.control_id, "name": c.name, "domain": c.category,
                "canonical_domain": None,
                "framework_name": "Internal / Risk", "member_count": 0}))
        return rr

    def _promoted_rows():
        rr = []
        ql = (q or "").lower()
        for w in promoted_items:
            if domain and w.domain != domain:
                continue
            if canonical_domain and (w.domain or UNCLASSIFIED) != canonical_domain:
                continue
            if ql and ql not in (w.name or "").lower() and ql not in (w.code or "").lower():
                continue
            rr.append(("normalized", w.source_id, {
                "code": w.code, "name": w.name, "domain": w.domain,
                "canonical_domain": w.domain or UNCLASSIFIED,
                "framework_name": w.framework_name or "Normalized", "member_count": w.member_count or 0}))
        return rr

    fw_rows, int_rows, prom_rows = _framework_rows(), _internal_rows(), _promoted_rows()
    source_counts = {"framework": len(fw_rows), "internal": len(int_rows), "normalized": len(prom_rows),
                     "all": len(fw_rows) + len(int_rows) + len(prom_rows)}
    if want == "framework":
        rows = fw_rows
    elif want == "internal":
        rows = int_rows
    elif want == "normalized":
        rows = prom_rows
    else:
        rows = fw_rows + int_rows + prom_rows

    # attach work-item state
    wis = {}
    if rows:
        keys = {(st, sid) for st, sid, _ in rows}
        wq = db.query(ControlWorkItem).filter(ControlWorkItem.tenant_id == tid).all()
        wis = {(w.source_type, w.source_id): w for w in wq if (w.source_type, w.source_id) in keys}

    items = [_light_row(st, sid, disp, wis.get((st, sid))) for st, sid, disp in rows]
    if status_filter:
        items = [i for i in items if i["implementation_status"] == status_filter]
    if effectiveness:
        items = [i for i in items if effectiveness in ((i["design_effectiveness"], i["operating_effectiveness"]))]
    if due == "overdue":
        items = [i for i in items if i.get("overdue")]
    elif due == "scheduled":
        items = [i for i in items if i.get("next_test_date")]
    if assignee_id:
        items = [i for i in items if assignee_id in (i["assigned_user_ids"] or [])]

    total = len(items)
    page = items[skip: skip + limit]
    umap = _user_map(db, [uid for i in page for uid in (i["assigned_user_ids"] or [])])
    for i in page:
        i["assignees"] = [umap[u] for u in (i["assigned_user_ids"] or []) if u in umap]
    return {"total": total, "items": page, "source_counts": source_counts,
            "scope": {"framework_ids": scope_fw, "scoped": bool(scope_fw)}}


@router.get("/domains")
def list_domains(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The canonical unified-library domains (the same 20 the Library uses) —
    replaces the old ~200 raw framework section names. Alphabetical."""
    tids = get_user_tenants(current_user, db)
    tid = tids[0] if tids else None
    if not tid:
        return {"domains": []}
    _pmap, cdomains = _canonical_maps(db, tid)
    return {"domains": sorted(cdomains)}


@router.get("/normalized")
def list_normalized_for_promote(
    q: Optional[str] = None, only_unpromoted: bool = True, skip: int = 0, limit: int = 50,
    db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth),
):
    """Normalized controls available to promote into the Catalog (the picker)."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"total": 0, "items": []}
    run_id = _baseline_run_id(db, tid)
    ncq = db.query(NormalizedControl)
    if run_id is not None:
        ncq = ncq.filter(NormalizedControl.run_id == run_id)
    if q:
        like = f"%{q}%"
        ncq = ncq.filter((NormalizedControl.name.ilike(like)) | (NormalizedControl.code.ilike(like)))
    promoted = {w.source_id for w in db.query(ControlWorkItem.source_id).filter(
        ControlWorkItem.tenant_id == tid, ControlWorkItem.source_type == "normalized").all()}
    all_nc = ncq.order_by(NormalizedControl.code).all()
    filtered = [c for c in all_nc if not (only_unpromoted and c.id in promoted)]
    total = len(filtered)
    page = filtered[skip: skip + limit]
    fw_map = _normalized_frameworks(db, [c.id for c in page])
    items = [{"id": c.id, "code": c.code, "name": c.name, "domain": c.domain,
              "review_status": c.review_status, "frameworks": fw_map.get(c.id, []),
              "promoted": c.id in promoted} for c in page]
    return {"total": total, "items": items}


@router.post("/promote")
def promote_normalized(body: dict = Body(...), db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    """Move selected verified normalized controls from the Library into the
    Catalog (materializes a work item for each; their framework members are then
    hidden from the framework list)."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"ok": False}
    ids = body.get("normalized_control_ids") or []
    promoted = 0
    for nid in ids:
        try:
            wi = _get_or_create_work_item(db, tid, "normalized", int(nid),
                                          created_by=getattr(current_user, "id", None))
            if wi:
                promoted += 1
        except (TypeError, ValueError):
            continue
    db.commit()
    return {"ok": True, "promoted": promoted}


@router.get("/my-work")
def my_work(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Work items assigned to the current user."""
    ensure_tables(db)
    tid = _tenant(current_user, db)
    if not tid:
        return {"total": 0, "items": []}
    uid = current_user.id
    all_wi = db.query(ControlWorkItem).filter(ControlWorkItem.tenant_id == tid).all()
    mine = [w for w in all_wi if uid in (w.assigned_user_ids or []) or w.owner_id == uid]
    umap = _user_map(db, [u for w in mine for u in (w.assigned_user_ids or [])] + [uid])
    return {"total": len(mine), "items": [_serialize_item(db, w, umap) for w in mine]}


# ─────────────────────── work item detail + create ──────────────────────────
@router.get("/controls/{source_type}/{source_id}")
def get_control(source_type: str, source_id: int, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Full workbench detail for a control (lazily materializes the work item)."""
    ensure_tables(db)
    tid = _tenant(current_user, db)
    if not tid:
        raise HTTPException(404, "No tenant")
    wi = _get_or_create_work_item(db, tid, source_type, source_id, created_by=getattr(current_user, "id", None))
    if not wi:
        raise HTTPException(404, "Control not found")
    db.commit()
    return _full_detail(db, wi)


def _full_detail(db, wi: ControlWorkItem) -> dict:
    base = _serialize_item(db, wi)
    procs = db.query(ControlWorkTestProcedure).filter(
        ControlWorkTestProcedure.work_item_id == wi.id).order_by(ControlWorkTestProcedure.seq).all()
    tests = db.query(ControlWorkTest).filter(
        ControlWorkTest.work_item_id == wi.id).order_by(ControlWorkTest.test_date.desc()).all()
    evid = db.query(ControlWorkEvidence).filter(ControlWorkEvidence.work_item_id == wi.id).all()
    escs = db.query(ControlWorkEscalation).filter(ControlWorkEscalation.work_item_id == wi.id).all()
    risks = db.query(ControlWorkRiskLink).filter(ControlWorkRiskLink.work_item_id == wi.id).all()
    umap = _user_map(db, [t.tester_id for t in tests] + [t.reviewer_id for t in tests] + [e.uploaded_by for e in evid])
    base["test_procedures"] = [{
        "id": p.id, "seq": p.seq, "procedure_type": p.procedure_type, "description": p.description,
        "frequency": p.frequency, "sample_size": p.sample_size, "source": p.source,
        "is_checked": p.is_checked} for p in procs]
    base["tests"] = [{
        "id": t.id, "test_type": t.test_type,
        "test_date": t.test_date.isoformat() if t.test_date else None,
        "tester": umap.get(t.tester_id, {}).get("display_name") if t.tester_id else None,
        "reviewer": umap.get(t.reviewer_id, {}).get("display_name") if t.reviewer_id else None,
        "reviewed_at": t.reviewed_at.isoformat() if t.reviewed_at else None,
        "sample_size": t.sample_size, "exceptions_found": t.exceptions_found,
        "result": t.result, "findings": t.findings, "recommendations": t.recommendations,
        "status": t.status} for t in tests]
    base["evidence"] = [{
        "id": e.id, "test_procedure_id": e.test_procedure_id, "evidence_id": e.evidence_id,
        "file_name": e.file_name, "review_status": e.review_status,
        "uploaded_by": umap.get(e.uploaded_by, {}).get("display_name") if e.uploaded_by else None,
        "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None} for e in evid]
    base["escalations"] = [{
        "id": e.id, "escalation_level": e.escalation_level, "escalation_name": e.escalation_name,
        "trigger_condition": e.trigger_condition, "trigger_threshold": e.trigger_threshold,
        "is_active": e.is_active} for e in escs]
    risk_meta = {}
    if risks:
        for rk in db.query(Risk).filter(Risk.id.in_([r.risk_id for r in risks])).all():
            risk_meta[rk.id] = {"title": rk.title, "category": rk.category,
                                "residual_score": rk.residual_score, "status": rk.status}
    base["risk_links"] = [{
        "id": r.id, "risk_id": r.risk_id, "link_type": r.link_type,
        "effectiveness_rating": r.effectiveness_rating, "notes": r.notes,
        "risk_title": risk_meta.get(r.risk_id, {}).get("title"),
        "risk_category": risk_meta.get(r.risk_id, {}).get("category"),
        "risk_residual_score": risk_meta.get(r.risk_id, {}).get("residual_score")} for r in risks]
    return base


@router.get("/risks")
def list_risks(q: Optional[str] = None, limit: int = 50, db: Session = Depends(get_db),
               current_user: GRCUser = Depends(require_auth)):
    """Tenant risk register (for the Risks-tab picker)."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"items": []}
    rq = db.query(Risk).filter(Risk.tenant_id == tid)
    if q:
        like = f"%{q}%"
        rq = rq.filter((Risk.title.ilike(like)) | (Risk.description.ilike(like)))
    rows = rq.order_by(Risk.residual_score.desc().nullslast()).limit(limit).all()
    return {"items": [{"id": r.id, "title": r.title, "category": r.category,
                       "residual_score": r.residual_score, "status": r.status} for r in rows]}


class WorkItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    implementation_status: Optional[str] = None
    design_effectiveness: Optional[str] = None
    operating_effectiveness: Optional[str] = None
    frequency: Optional[str] = None
    priority: Optional[str] = None
    is_key_control: Optional[bool] = None
    next_test_date: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/items/{work_item_id}")
def update_item(work_item_id: int, body: WorkItemUpdate, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    data = body.dict(exclude_unset=True)
    if "next_test_date" in data and data["next_test_date"]:
        try:
            data["next_test_date"] = datetime.fromisoformat(data["next_test_date"])
        except ValueError:
            data.pop("next_test_date")
    for k, v in data.items():
        setattr(wi, k, v)
    # write display fields back to the source (authoring)
    if wi.source_type == "internal" and (body.name or body.description):
        ic = db.query(InternalControl).filter(InternalControl.id == wi.source_id).first()
        if ic:
            if body.name:
                ic.name = body.name
            if body.description is not None:
                ic.description = body.description
            if body.design_effectiveness is not None:
                ic.design_effectiveness = body.design_effectiveness
            if body.operating_effectiveness is not None:
                ic.operating_effectiveness = body.operating_effectiveness
    db.commit()
    return _serialize_item(db, wi)


class ControlCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    control_type: Optional[str] = "preventive"
    control_nature: Optional[str] = "manual"
    frequency: Optional[str] = None
    priority: Optional[str] = "medium"
    is_key_control: Optional[bool] = False


@router.post("/controls")
def create_internal_control(body: ControlCreate, db: Session = Depends(get_db),
                            current_user: GRCUser = Depends(require_auth)):
    """Author a new (internal / risk-sourced) control — the create form moved
    here from the retired Internal Control page. Writes the InternalControl
    definition + its work item."""
    tid = _tenant(current_user, db)
    if not tid:
        raise HTTPException(404, "No tenant")
    # next IC-NNNN
    existing = db.query(InternalControl).filter(InternalControl.tenant_id == tid).count()
    ic = InternalControl(
        tenant_id=tid, control_id=f"IC-{existing + 1:04d}", name=body.name,
        description=body.description, category=body.category, sub_category=body.sub_category,
        control_type=body.control_type or "preventive", control_nature=body.control_nature or "manual",
        frequency=body.frequency, priority=body.priority or "medium",
        is_key_control=bool(body.is_key_control), status="draft",
        created_by=getattr(current_user, "id", None))
    db.add(ic)
    db.flush()
    wi = _get_or_create_work_item(db, tid, "internal", ic.id, created_by=getattr(current_user, "id", None))
    db.commit()
    return _serialize_item(db, wi)


# ─────────────────────────────── assignment ─────────────────────────────────
@router.delete("/items/{work_item_id}")
def delete_item(work_item_id: int, delete_source: bool = Query(False), db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Retire a control from the workbench: delete the work item + its work data.
    delete_source=true also deletes the underlying internal-control definition
    (only meaningful for source_type=internal)."""
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    for M in (ControlWorkEvidence, ControlWorkTest, ControlWorkTestProcedure, ControlWorkEscalation,
              ControlWorkWorkflowAction, ControlWorkRiskLink):
        db.query(M).filter(M.work_item_id == wi.id).delete(synchronize_session=False)
    src_type, src_id = wi.source_type, wi.source_id
    db.delete(wi)
    if delete_source and src_type == "internal":
        db.query(InternalControl).filter(InternalControl.id == src_id,
                                         InternalControl.tenant_id == tid).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.patch("/items/{work_item_id}/assign")
def assign(work_item_id: int, body: dict = Body(...), db: Session = Depends(get_db),
           current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    ids = body.get("assigned_user_ids")
    if ids is None and body.get("assigned_to_user_id") is not None:
        ids = [body["assigned_to_user_id"]]
    ids = ids or []
    # dedupe preserve order + validate active tenant users
    seen, clean = set(), []
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            clean.append(int(i))
    if clean:
        valid = {u.id for u in db.query(GRCUser.id).filter(
            GRCUser.id.in_(clean), GRCUser.is_active == True).all()}  # noqa: E712
        clean = [i for i in clean if i in valid]
    wi.assigned_user_ids = clean
    wi.assigned_to_user_id = clean[0] if clean else None
    flag_modified(wi, "assigned_user_ids")
    db.commit()
    return _serialize_item(db, wi)


# ─────────────────────────── effectiveness / tests ──────────────────────────
class TestCreate(BaseModel):
    test_type: str  # design | operating
    result: str     # effective | partially_effective | ineffective
    test_period_start: Optional[str] = None
    test_period_end: Optional[str] = None
    sample_size: Optional[int] = None
    exceptions_found: Optional[int] = 0
    findings: Optional[str] = None
    recommendations: Optional[str] = None
    frequency: Optional[str] = None        # sets the control's test cadence
    next_test_date: Optional[str] = None   # explicit override; else derived from frequency


# how many days each cadence adds when scheduling the next test
_FREQ_DAYS = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 91,
              "semi_annually": 182, "semiannually": 182, "annually": 365, "annual": 365}


@router.post("/items/{work_item_id}/tests")
def add_test(work_item_id: int, body: TestCreate, db: Session = Depends(get_db),
             current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")

    def _d(s):
        try:
            return datetime.fromisoformat(s) if s else None
        except ValueError:
            return None
    t = ControlWorkTest(
        work_item_id=wi.id, tenant_id=tid, test_type=body.test_type, test_date=datetime.utcnow(),
        test_period_start=_d(body.test_period_start), test_period_end=_d(body.test_period_end),
        tester_id=getattr(current_user, "id", None), sample_size=body.sample_size,
        exceptions_found=body.exceptions_found or 0, result=body.result,
        findings=body.findings, recommendations=body.recommendations, status="completed")
    db.add(t)
    # roll the test result up onto the work item's effectiveness
    if body.test_type == "design":
        wi.design_effectiveness = body.result
    elif body.test_type == "operating":
        wi.operating_effectiveness = body.result
    now = datetime.utcnow()
    wi.last_tested_at = now
    # scheduling: set cadence + next test date (explicit wins, else derive from frequency)
    if body.frequency:
        wi.frequency = body.frequency
    nxt = None
    if body.next_test_date:
        try:
            nxt = datetime.fromisoformat(body.next_test_date)
        except ValueError:
            nxt = None
    if nxt is None and (body.frequency or wi.frequency):
        from datetime import timedelta
        days = _FREQ_DAYS.get((body.frequency or wi.frequency or "").lower())
        if days:
            nxt = now + timedelta(days=days)
    if nxt is not None:
        wi.next_test_date = nxt
    # keep the internal-control source in sync (ERM scorecard reads it)
    if wi.source_type == "internal":
        ic = db.query(InternalControl).filter(InternalControl.id == wi.source_id).first()
        if ic:
            if body.test_type == "design":
                ic.design_effectiveness = body.result
            elif body.test_type == "operating":
                ic.operating_effectiveness = body.result
            ic.last_tested_at = now
    db.commit()
    return {"ok": True, "test_id": t.id, "design_effectiveness": wi.design_effectiveness,
            "operating_effectiveness": wi.operating_effectiveness,
            "next_test_date": wi.next_test_date.isoformat() if wi.next_test_date else None}


@router.post("/tests/{test_id}/review")
def review_test(test_id: int, body: dict = Body(default={}), db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Reviewer sign-off on a completed test (maker-checker). action = reviewed |
    reopen. A reviewed test is locked as independently checked."""
    tid = _tenant(current_user, db)
    t = db.query(ControlWorkTest).filter(ControlWorkTest.id == test_id,
                                         ControlWorkTest.tenant_id == tid).first()
    if not t:
        raise HTTPException(404, "Test not found")
    action = (body.get("action") or "reviewed").lower()
    if action == "reopen":
        t.status = "completed"
        t.reviewer_id = None
        t.reviewed_at = None
    else:
        t.status = "reviewed"
        t.reviewer_id = getattr(current_user, "id", None)
        t.reviewed_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": t.id, "status": t.status}


def _resync_effectiveness(db, wi: ControlWorkItem) -> None:
    """Recompute a work item's design/operating effectiveness from its LATEST
    test of each type (after a test is edited or deleted) + sync the internal
    control source."""
    for ttype, field in (("design", "design_effectiveness"), ("operating", "operating_effectiveness")):
        latest = (db.query(ControlWorkTest)
                  .filter(ControlWorkTest.work_item_id == wi.id, ControlWorkTest.test_type == ttype)
                  .order_by(ControlWorkTest.test_date.desc()).first())
        setattr(wi, field, latest.result if latest else None)
    last = (db.query(ControlWorkTest).filter(ControlWorkTest.work_item_id == wi.id)
            .order_by(ControlWorkTest.test_date.desc()).first())
    wi.last_tested_at = last.test_date if last else None
    if wi.source_type == "internal":
        ic = db.query(InternalControl).filter(InternalControl.id == wi.source_id).first()
        if ic:
            ic.design_effectiveness = wi.design_effectiveness
            ic.operating_effectiveness = wi.operating_effectiveness
            ic.last_tested_at = wi.last_tested_at


class TestUpdate(BaseModel):
    test_type: Optional[str] = None
    result: Optional[str] = None
    sample_size: Optional[int] = None
    exceptions_found: Optional[int] = None
    findings: Optional[str] = None
    recommendations: Optional[str] = None


@router.patch("/tests/{test_id}")
def update_test(test_id: int, body: TestUpdate, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Edit a recorded test (result, sample size, exceptions, findings, type).
    Re-syncs the control's effectiveness from the latest test of each type."""
    tid = _tenant(current_user, db)
    t = db.query(ControlWorkTest).filter(ControlWorkTest.id == test_id,
                                         ControlWorkTest.tenant_id == tid).first()
    if not t:
        raise HTTPException(404, "Test not found")
    for k, v in body.dict(exclude_unset=True).items():
        setattr(t, k, v)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == t.work_item_id).first()
    if wi:
        _resync_effectiveness(db, wi)
    db.commit()
    return {"ok": True, "id": t.id, "result": t.result, "test_type": t.test_type,
            "design_effectiveness": wi.design_effectiveness if wi else None,
            "operating_effectiveness": wi.operating_effectiveness if wi else None}


@router.delete("/tests/{test_id}")
def delete_test(test_id: int, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Delete a recorded test and re-sync effectiveness from what remains."""
    tid = _tenant(current_user, db)
    t = db.query(ControlWorkTest).filter(ControlWorkTest.id == test_id,
                                         ControlWorkTest.tenant_id == tid).first()
    if not t:
        raise HTTPException(404, "Test not found")
    wid = t.work_item_id
    db.delete(t)
    db.flush()
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == wid).first()
    if wi:
        _resync_effectiveness(db, wi)
    db.commit()
    return {"ok": True}


# ─────────────────────── AI test procedures (persisted) ─────────────────────
_AI_PROMPT = """You are a Senior GRC Auditor (CISA, CISSP, CRISC) planning fieldwork to TEST this control's DESIGN and OPERATING effectiveness.

CONTROL
- Code: {code}
- Title: {title}
- Requirement / how it is implemented: {description}
- Framework(s): {framework}

EVIDENCE THE ORGANISATION HAS PROVIDED — your procedures must test AGAINST these actual artefacts:
{evidence}

Write audit-ready TEST PROCEDURES to conclude on this control. Rules:
1. GROUND each procedure in the specific evidence above when relevant — name the artefact and state exactly what to examine in it. For a policy/standard/procedure document: confirm it defines scope, ownership, approval, review cadence AND the specific requirement of THIS control, and drill into the deep implementation details it should specify. If no evidence is uploaded yet, the first procedure must state which artefact to obtain.
2. Cover BOTH design effectiveness (is the control, as documented in that evidence, actually designed to meet the requirement?) AND operating effectiveness (did it truly operate across the period?).
3. SAMPLING IS MANDATORY for operating effectiveness — include at least one procedure that selects a representative SAMPLE from the relevant population: state the population, a defensible sample size, and the selection basis, then re-perform or inspect each sampled item to confirm the control operated as designed.
4. Include deep, control-SPECIFIC implementation checks — never generic boilerplate.
5. Vary the methodology across inquiry/walkthrough, inspection, observation and reperformance.

Return ONLY valid JSON:
{{"test_procedures": [{{"procedure_type": "<walkthrough|inquiry|observation|inspection|reperformance>", "description": "<executable step; reference the specific evidence/population where relevant>", "frequency": "<e.g. quarterly>", "sample_size": "<e.g. 25, or 'population + selection basis', or N/A>"}}]}}

Generate 5-8 concrete, numbered-in-order procedures. Respond ONLY with JSON."""


def _fallback_procedures(disp) -> list:
    return [
        {"procedure_type": "inquiry", "description": f"Interview the control owner to understand how '{disp['name']}' is performed.", "frequency": "annually", "sample_size": "N/A"},
        {"procedure_type": "inspection", "description": f"Obtain and inspect documentation evidencing '{disp['name']}'.", "frequency": "annually", "sample_size": "All available"},
        {"procedure_type": "observation", "description": "Observe the control being performed in the live environment.", "frequency": "annually", "sample_size": "1-3 occurrences"},
        {"procedure_type": "reperformance", "description": "Independently re-perform the control for a sample of the population.", "frequency": "annually", "sample_size": "25"},
    ]


@router.post("/items/{work_item_id}/ai-procedures")
def generate_procedures(work_item_id: int, replace: bool = Query(True), db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    """Get AI Recommendation → persist a numbered Test Procedures checklist."""
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    disp = {"name": wi.name, "code": wi.code}

    # gather the ACTUAL uploaded evidence so procedures test against real artefacts
    ev_rows = db.query(ControlWorkEvidence).filter(ControlWorkEvidence.work_item_id == wi.id).all()
    ev_meta = {}
    ev_ids = [e.evidence_id for e in ev_rows if e.evidence_id]
    if ev_ids:
        for ev in db.query(Evidence).filter(Evidence.id.in_(ev_ids)).all():
            ev_meta[ev.id] = (ev.name or ev.file_name, ev.evidence_type)
    ev_lines = []
    for e in ev_rows:
        nm, etype = ev_meta.get(e.evidence_id, (e.file_name, None))
        if nm:
            ev_lines.append(f"- {nm}" + (f" (type: {etype})" if etype else ""))
    # supplement with the normalized control's recommended evidence, if any
    if wi.source_type == "normalized":
        nc = db.query(NormalizedControl).filter(NormalizedControl.id == wi.source_id).first()
        rec = getattr(nc, "recommended_evidence", None) if nc else None
        if isinstance(rec, list):
            for r in rec[:6]:
                if r:
                    ev_lines.append(f"- (recommended, not yet uploaded) {r}")
    evidence_block = ("\n".join(ev_lines) if ev_lines
                      else "None uploaded yet — the first procedure must obtain the primary artefact for this control.")

    procedures = None
    try:
        from ....config import get_openai_api_key
        from openai import OpenAI
        client = OpenAI(api_key=get_openai_api_key())
        prompt = _AI_PROMPT.format(code=wi.code or "", title=wi.name or "",
                                   description=(wi.description or "Not provided")[:2000],
                                   framework=wi.framework_name or "General",
                                   evidence=evidence_block)
        resp = client.chat.completions.create(
            model=get_openai_model(),
            messages=[{"role": "system", "content": "You are a Senior GRC Auditor. Respond only with valid JSON."},
                      {"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=2600)
        txt = resp.choices[0].message.content.strip()
        for f in ("```json", "```"):
            if txt.startswith(f):
                txt = txt[len(f):]
        if txt.endswith("```"):
            txt = txt[:-3]
        procedures = json.loads(txt.strip()).get("test_procedures")
    except Exception:  # noqa: BLE001 — resilient: fall back to a sensible default set
        logger.warning("AI procedure generation failed for work item %s", work_item_id, exc_info=True)
    if not procedures:
        procedures = _fallback_procedures(disp)

    if replace:
        db.query(ControlWorkTestProcedure).filter(
            ControlWorkTestProcedure.work_item_id == wi.id,
            ControlWorkTestProcedure.source == "ai").delete(synchronize_session=False)
    start = db.query(ControlWorkTestProcedure).filter(
        ControlWorkTestProcedure.work_item_id == wi.id).count()
    for idx, p in enumerate(procedures):
        db.add(ControlWorkTestProcedure(
            work_item_id=wi.id, tenant_id=tid, seq=start + idx + 1,
            procedure_type=p.get("procedure_type"), description=p.get("description") or "",
            frequency=p.get("frequency"), sample_size=str(p.get("sample_size") or ""), source="ai"))
    db.commit()
    rows = db.query(ControlWorkTestProcedure).filter(
        ControlWorkTestProcedure.work_item_id == wi.id).order_by(ControlWorkTestProcedure.seq).all()
    return {"ok": True, "procedures": [{
        "id": p.id, "seq": p.seq, "procedure_type": p.procedure_type, "description": p.description,
        "frequency": p.frequency, "sample_size": p.sample_size, "is_checked": p.is_checked,
        "source": p.source} for p in rows]}


@router.patch("/procedures/{proc_id}")
def update_procedure(proc_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                     current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    p = db.query(ControlWorkTestProcedure).filter(
        ControlWorkTestProcedure.id == proc_id, ControlWorkTestProcedure.tenant_id == tid).first()
    if not p:
        raise HTTPException(404, "Procedure not found")
    if "is_checked" in body:
        p.is_checked = bool(body["is_checked"])
        p.checked_by = getattr(current_user, "id", None) if p.is_checked else None
        p.checked_at = datetime.utcnow() if p.is_checked else None
    if "description" in body:
        p.description = body["description"]
    db.commit()
    return {"ok": True, "id": p.id, "is_checked": p.is_checked}


# ────────────────────────────── evidence ────────────────────────────────────
def _map_sample_to_control(db, evidence_id, wi: ControlWorkItem, proc, uid):
    """Preserve the hierarchy in Evidence Management: link the uploaded sample to
    its control (framework / normalized) via EvidenceControlMapping, noting the
    test procedure when it is a step-level sample. Internal controls have no
    mapping target — their hierarchy lives on the ControlWorkEvidence link."""
    if not evidence_id or wi.source_type not in ("framework", "normalized"):
        return
    parsed_id = wi.source_id if wi.source_type == "framework" else None
    norm_id = wi.source_id if wi.source_type == "normalized" else None
    q = db.query(EvidenceControlMapping).filter(EvidenceControlMapping.evidence_id == evidence_id)
    q = q.filter(EvidenceControlMapping.parsed_control_id == parsed_id) if parsed_id \
        else q.filter(EvidenceControlMapping.normalized_control_id == norm_id)
    if q.first():
        return  # already linked
    ufw_id = None
    if parsed_id:
        pc = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == parsed_id).first()
        ufw_id = pc.uploaded_framework_id if pc else None
    db.add(EvidenceControlMapping(
        evidence_id=evidence_id, parsed_control_id=parsed_id, normalized_control_id=norm_id,
        uploaded_framework_id=ufw_id, framework_name=(wi.framework_name or "")[:255],
        control_code=(wi.code or "")[:100], control_title=(wi.name or "")[:500],
        clause_reference=(f"Test procedure {proc.seq}" if proc else "Control-level sample"),
        coverage_type="supporting", created_by_ai=False, is_locked=True,
        locked_at=datetime.utcnow(), locked_by=uid,
        matching_rationale=(f"Uploaded as the sample for test procedure {proc.seq}: {(proc.description or '')[:200]}"
                            if proc else "Uploaded as a control sample from Control Testing & Assurance")))


@router.post("/items/{work_item_id}/evidence")
async def add_evidence(work_item_id: int, evidence_id: Optional[int] = Form(None),
                       test_procedure_id: Optional[int] = Form(None),
                       file: Optional[UploadFile] = File(None),
                       db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Attach a SAMPLE to a work item (optionally to a specific test-procedure
    point via test_procedure_id). Either links an existing Evidence-library item
    (evidence_id) OR uploads a file — which is saved into the shared evidence
    store and registered as a real Evidence record. Both paths link the sample to
    its control (and procedure) in Evidence Management so the hierarchy is kept."""
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    proc = None
    if test_procedure_id:
        proc = db.query(ControlWorkTestProcedure).filter(
            ControlWorkTestProcedure.id == test_procedure_id,
            ControlWorkTestProcedure.tenant_id == tid).first()

    fname = None
    file_path = None
    if evidence_id:
        ev = db.query(Evidence).filter(Evidence.id == evidence_id, Evidence.tenant_id == tid).first()
        if not ev:
            raise HTTPException(404, "Evidence not found")
        fname = ev.file_name or ev.name
    elif file is not None:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext and ext[1:] not in _ALLOWED_EVIDENCE_EXT:
            raise HTTPException(400, f"File type '{ext}' not allowed")
        tenant_dir = os.path.join(_EVIDENCE_UPLOAD_DIR, str(tid))
        os.makedirs(tenant_dir, exist_ok=True)
        file_path = os.path.join(tenant_dir, f"{uuid.uuid4()}{ext}")
        contents = await file.read()
        with open(file_path, "wb") as fh:
            fh.write(contents)
        fname = file.filename
        # readable, hierarchy-preserving name/description for Evidence Management
        _desc = f"Sample for control {wi.code or ''} — {wi.name or ''}".strip(" —")
        if wi.framework_name:
            _desc += f" · {wi.framework_name}"
        if proc:
            _desc += f" · Test procedure {proc.seq}: {(proc.description or '')[:180]}"
        # register as a real Evidence-library record (draft → review here or in the library)
        ev = Evidence(
            tenant_id=tid, name=(f"{wi.code} — {fname}" if wi.code else (fname or "Control sample")),
            description=_desc, file_path=file_path,
            file_name=fname, file_type=file.content_type, evidence_type="sample",
            uploaded_by=getattr(current_user, "id", None), status="draft",
            ocr_status="pending" if ext[1:] in {"pdf", "png", "jpg", "jpeg", "tiff", "tif", "bmp", "gif"} else "not_applicable",
            source_system="Control Testing & Assurance")
        db.add(ev)
        db.flush()
        evidence_id = ev.id
        # kick off OCR the same way the evidence module does (best-effort)
        if ev.ocr_status == "pending":
            try:
                from ...evidence.routers.evidence import process_evidence_background
                threading.Thread(target=process_evidence_background, args=(ev.id,), daemon=True).start()
            except Exception:  # noqa: BLE001
                logger.debug("OCR kickoff skipped for evidence %s", ev.id, exc_info=True)

    cwe = ControlWorkEvidence(
        work_item_id=wi.id, tenant_id=tid, test_procedure_id=test_procedure_id,
        evidence_id=evidence_id, file_name=fname, file_path=file_path,
        uploaded_by=getattr(current_user, "id", None), review_status="pending")
    db.add(cwe)
    if wi.implementation_status == "not_started":
        wi.implementation_status = "in_progress"
    db.commit()  # the sample + its work-item link are safely persisted first
    # then maintain the control → (procedure) → sample hierarchy in Evidence
    # Management (best-effort, separate txn so it can never lose the upload)
    try:
        _map_sample_to_control(db, evidence_id, wi, proc, getattr(current_user, "id", None))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("evidence→control mapping failed for wi %s", wi.id, exc_info=True)
    return {"ok": True, "id": cwe.id, "evidence_id": evidence_id, "file_name": fname,
            "review_status": "pending"}


@router.post("/evidence/{ev_id}/review")
def review_evidence(ev_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    e = db.query(ControlWorkEvidence).filter(ControlWorkEvidence.id == ev_id,
                                             ControlWorkEvidence.tenant_id == tid).first()
    if not e:
        raise HTTPException(404, "Evidence not found")
    action = (body.get("action") or "").lower()
    if action not in ("approved", "rejected"):
        raise HTTPException(400, "action must be approved or rejected")
    e.review_status = action
    e.reviewed_by = getattr(current_user, "id", None)
    e.reviewed_at = datetime.utcnow()
    e.review_notes = body.get("notes")
    # keep the shared Evidence-library record's status in sync
    if e.evidence_id:
        ev = db.query(Evidence).filter(Evidence.id == e.evidence_id).first()
        if ev:
            ev.status = "approved" if action == "approved" else "rejected"
            ev.reviewed_by = getattr(current_user, "id", None)
            ev.reviewed_at = datetime.utcnow()
            ev.review_comments = body.get("notes")
    db.commit()
    return {"ok": True, "id": e.id, "review_status": e.review_status}


@router.get("/evidence-library")
def evidence_library(q: Optional[str] = None, limit: int = 30, db: Session = Depends(get_db),
                     current_user: GRCUser = Depends(require_auth)):
    """Existing Evidence-library items to link (the 'link existing' picker)."""
    tid = _tenant(current_user, db)
    if not tid:
        return {"items": []}
    evq = db.query(Evidence).filter(Evidence.tenant_id == tid)
    if q:
        like = f"%{q}%"
        evq = evq.filter((Evidence.name.ilike(like)) | (Evidence.file_name.ilike(like)))
    rows = evq.order_by(Evidence.uploaded_at.desc()).limit(limit).all()
    return {"items": [{"id": e.id, "name": e.name, "file_name": e.file_name,
                       "evidence_type": e.evidence_type, "status": e.status,
                       "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None} for e in rows]}


# ──────────────────────── workflow (approval) + escalations ─────────────────
def _wf(db, wi, action, frm, to, comments, uid):
    db.add(ControlWorkWorkflowAction(work_item_id=wi.id, tenant_id=wi.tenant_id, action=action,
                                     action_by=uid, from_status=frm, to_status=to, comments=comments))


@router.post("/items/{work_item_id}/submit")
def submit_item(work_item_id: int, body: dict = Body(default={}), db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    return _transition(db, current_user, work_item_id, "submit",
                       {"pending_approval"}, "pending_approval", "pending_review", body)


@router.post("/items/{work_item_id}/approve")
def approve_item(work_item_id: int, body: dict = Body(default={}), db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth)):
    return _transition(db, current_user, work_item_id, "approve", {"active"}, "active", "approved", body)


@router.post("/items/{work_item_id}/reject")
def reject_item(work_item_id: int, body: dict = Body(default={}), db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    return _transition(db, current_user, work_item_id, "reject", {"draft"}, "draft", "rejected", body)


def _transition(db, current_user, work_item_id, action, _to_set, new_status, wf_status, body):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    frm = wi.status
    wi.status = new_status
    wi.workflow_status = wf_status
    if action == "approve":
        wi.approved_by = getattr(current_user, "id", None)
        wi.approved_at = datetime.utcnow()
    _wf(db, wi, action, frm, new_status, (body or {}).get("comments"), getattr(current_user, "id", None))
    if wi.source_type == "internal":
        ic = db.query(InternalControl).filter(InternalControl.id == wi.source_id).first()
        if ic:
            ic.status = new_status
            ic.workflow_status = wf_status
    db.commit()
    return {"ok": True, "status": wi.status, "workflow_status": wi.workflow_status}


@router.post("/items/{work_item_id}/escalations")
def add_escalation(work_item_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    e = ControlWorkEscalation(
        work_item_id=wi.id, tenant_id=tid, escalation_level=body.get("escalation_level", 1),
        escalation_name=body.get("escalation_name", "Escalation"),
        trigger_condition=body.get("trigger_condition", "test_failure"),
        trigger_threshold=body.get("trigger_threshold"),
        escalate_to_user_id=body.get("escalate_to_user_id"),
        escalate_to_role=body.get("escalate_to_role"),
        escalation_timeframe_hours=body.get("escalation_timeframe_hours", 24),
        notification_required=body.get("notification_required", True),
        is_active=body.get("is_active", True))
    db.add(e)
    db.commit()
    return {"ok": True, "id": e.id}


@router.delete("/escalations/{esc_id}")
def del_escalation(esc_id: int, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    db.query(ControlWorkEscalation).filter(ControlWorkEscalation.id == esc_id,
                                           ControlWorkEscalation.tenant_id == tid).delete()
    db.commit()
    return {"ok": True}


# ─────────────────────────────── risk links ─────────────────────────────────
@router.post("/items/{work_item_id}/risks")
def add_risk(work_item_id: int, body: dict = Body(...), db: Session = Depends(get_db),
             current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    wi = db.query(ControlWorkItem).filter(ControlWorkItem.id == work_item_id,
                                          ControlWorkItem.tenant_id == tid).first()
    if not wi:
        raise HTTPException(404, "Work item not found")
    rid = body.get("risk_id")
    if not rid:
        raise HTTPException(400, "risk_id required")
    exists = db.query(ControlWorkRiskLink).filter(
        ControlWorkRiskLink.work_item_id == wi.id, ControlWorkRiskLink.risk_id == rid).first()
    if exists:
        return {"ok": True, "id": exists.id}
    r = ControlWorkRiskLink(
        work_item_id=wi.id, tenant_id=tid, risk_id=rid,
        link_type=body.get("link_type", "mitigates"),
        effectiveness_rating=body.get("effectiveness_rating"), notes=body.get("notes"),
        created_by=getattr(current_user, "id", None))
    db.add(r)
    db.commit()
    return {"ok": True, "id": r.id}


@router.delete("/risks/{link_id}")
def del_risk(link_id: int, db: Session = Depends(get_db),
             current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    db.query(ControlWorkRiskLink).filter(ControlWorkRiskLink.id == link_id,
                                         ControlWorkRiskLink.tenant_id == tid).delete()
    db.commit()
    return {"ok": True}
