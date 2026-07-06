"""Framework template register endpoints (Gap Analysis / Internal Audit / Risk Treatment).

Each register is a per-tenant, per-journey editable table. Rows follow the ISO
27001 template columns. Registers auto-seed with the template's default rows on
first open, and any entry can be promoted into the ERM Risk Register.
"""
from typing import List, Optional, Any, Dict
from datetime import datetime

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import asc, or_
from pydantic import BaseModel

from ....models import (
    FrameworkRegisterEntry, Risk, GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..schema import ensure_framework_template_tables
from ..seed_data import REGISTER_TYPES, REGISTER_LABELS, REGISTER_SEEDS
from .. import definitions as D


def _ensure_schema(db: Session = Depends(get_db)) -> None:
    ensure_framework_template_tables(db)


router = APIRouter(
    prefix="/registers",
    tags=["Framework Template Registers"],
    dependencies=[Depends(_ensure_schema)],
)


# ── Schemas ──────────────────────────────────────────────────────────────────
class RegisterEntryPayload(BaseModel):
    reference: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    result: Optional[str] = None
    finding_type: Optional[str] = None
    treatment_option: Optional[str] = None
    linked_control: Optional[str] = None
    action: Optional[str] = None
    evidence_reviewed: Optional[str] = None
    notes: Optional[str] = None
    justification: Optional[str] = None
    residual_risk: Optional[str] = None
    approved_by: Optional[str] = None
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    target_date: Optional[datetime] = None
    evidence_id: Optional[int] = None
    risk_register_id: Optional[int] = None
    data: Optional[Dict[str, Any]] = None


class MoveToRiskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = "compliance"
    framework_name: Optional[str] = "ISO 27001"


class ApplyAIItem(BaseModel):
    id: int
    fields: Dict[str, Any]


# Only assessment fields may be set by an AI apply — never reference/title/owner.
_AI_APPLIABLE = {
    "status", "result", "finding_type", "treatment_option", "linked_control",
    "action", "evidence_reviewed", "notes", "justification", "residual_risk", "approved_by",
}


# ── Helpers ──────────────────────────────────────────────────────────────────
def _tenant_id(user: GRCUser, db: Session) -> int:
    tenants = get_user_tenants(user, db)
    if not tenants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant context")
    return tenants[0]


def _validate_type(register_type: str) -> None:
    if register_type not in REGISTER_TYPES and register_type not in D.all_register_types():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unknown register_type '{register_type}'")


def _has_seed(register_type: str) -> bool:
    if register_type in REGISTER_SEEDS:
        return bool(REGISTER_SEEDS.get(register_type))
    rd = D.register_def(register_type)
    return bool(rd and rd.get("seed"))


def _serialize(e: FrameworkRegisterEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "register_type": e.register_type,
        "seq": e.seq,
        "is_seed": e.is_seed,
        "reference": e.reference,
        "title": e.title,
        "status": e.status,
        "result": e.result,
        "finding_type": e.finding_type,
        "treatment_option": e.treatment_option,
        "linked_control": e.linked_control,
        "action": e.action,
        "evidence_reviewed": e.evidence_reviewed,
        "notes": e.notes,
        "justification": e.justification,
        "residual_risk": e.residual_risk,
        "approved_by": e.approved_by,
        "owner_id": e.owner_id,
        "owner_name": e.owner_name,
        "target_date": e.target_date.isoformat() if e.target_date else None,
        "evidence_id": e.evidence_id,
        "risk_register_id": e.risk_register_id,
        "data": e.data or {},
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _query(db: Session, tid: int, journey_id: int, register_type: str):
    return (
        db.query(FrameworkRegisterEntry)
        .filter(
            FrameworkRegisterEntry.tenant_id == tid,
            FrameworkRegisterEntry.journey_id == journey_id,
            FrameworkRegisterEntry.register_type == register_type,
        )
        .order_by(asc(FrameworkRegisterEntry.seq), asc(FrameworkRegisterEntry.id))
    )


def _seed(db: Session, tid: int, journey_id: int, framework_id: Optional[int],
          register_type: str, user_id: Optional[int]) -> None:
    """Populate the register with the template's default rows (idempotent —
    only runs when the register has no rows for this journey)."""
    if register_type in REGISTER_SEEDS:
        # ISO 27001 hand-tuned registers: (reference, title) tuples.
        seed = REGISTER_SEEDS.get(register_type) or []
        for i, (reference, title) in enumerate(seed):
            db.add(FrameworkRegisterEntry(
                tenant_id=tid, journey_id=journey_id, uploaded_framework_id=framework_id,
                register_type=register_type, seq=i, is_seed=True,
                reference=reference, title=title,
                status="not_started" if register_type == "gap_analysis" else None,
                created_by=user_id,
            ))
        if seed:
            db.commit()
    else:
        # Generated framework registers: each seed row is a {data: {...}} dict.
        rd = D.register_def(register_type)
        rows = (rd or {}).get("seed", []) if rd else []
        for i, row in enumerate(rows):
            db.add(FrameworkRegisterEntry(
                tenant_id=tid, journey_id=journey_id, uploaded_framework_id=framework_id,
                register_type=register_type, seq=i, is_seed=True,
                data=row.get("data", {}) or {},
                created_by=user_id,
            ))
        if rows:
            db.commit()


def _summary(entries: List[FrameworkRegisterEntry], register_type: str) -> Dict[str, Any]:
    total = len(entries)
    by_status: Dict[str, int] = {}
    by_result: Dict[str, int] = {}
    for e in entries:
        if e.status:
            by_status[e.status] = by_status.get(e.status, 0) + 1
        if e.result:
            by_result[e.result] = by_result.get(e.result, 0) + 1
    out: Dict[str, Any] = {"total": total, "by_status": by_status, "by_result": by_result,
                           "moved_to_risk": sum(1 for e in entries if e.risk_register_id)}
    if register_type == "gap_analysis":
        applicable = [e for e in entries if (e.status or "") != "not_applicable"]
        covered = [e for e in applicable if (e.status or "") == "covered"]
        out["coverage_pct"] = round(100.0 * len(covered) / len(applicable), 1) if applicable else 0.0
    return out


# ── Endpoints ────────────────────────────────────────────────────────────────
# NOTE: literal routes must be declared before the "/{register_type}" catch-all
# so "/framework-risks" isn't parsed as a register_type.
@router.get("/framework-risks")
def framework_risks(
    journey_id: int = Query(...),
    framework_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Risks created or moved from this framework — for the Risk Treatment picker.

    Includes risks linked from any of this journey's register entries (moved-to-risk)
    plus risks tagged under this framework in the ERM register.
    """
    tid = _tenant_id(user, db)
    linked_ids = [
        row[0] for row in db.query(FrameworkRegisterEntry.risk_register_id).filter(
            FrameworkRegisterEntry.tenant_id == tid,
            FrameworkRegisterEntry.journey_id == journey_id,
            FrameworkRegisterEntry.risk_register_id.isnot(None),
        ).all() if row[0] is not None
    ]

    conds = []
    if linked_ids:
        conds.append(Risk.id.in_(linked_ids))
    fw = (framework_name or "").strip()
    if fw:
        conds.append(Risk.register_type == fw)
        conds.append(Risk.source_reference.ilike(f"{fw}%"))

    q = db.query(Risk).filter(Risk.tenant_id == tid)
    q = q.filter(or_(*conds)) if conds else q.filter(Risk.id.in_(linked_ids or [-1]))
    risks = q.order_by(Risk.created_at.desc()).limit(300).all()
    return {
        "risks": [{
            "id": r.id,
            "title": r.title,
            "description": r.description,
            "category": r.category,
            "status": r.status,
            "register_type": r.register_type,
            "source_reference": r.source_reference,
            "inherent_score": r.inherent_score,
            "residual_score": r.residual_score,
        } for r in risks]
    }


@router.get("/{register_type}")
def list_entries(
    register_type: str,
    journey_id: int = Query(...),
    framework_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    _validate_type(register_type)
    tid = _tenant_id(user, db)
    existing = _query(db, tid, journey_id, register_type).all()
    if not existing and _has_seed(register_type):
        _seed(db, tid, journey_id, framework_id, register_type, user.id)
        existing = _query(db, tid, journey_id, register_type).all()
    return {
        "register_type": register_type,
        "entries": [_serialize(e) for e in existing],
        "summary": _summary(existing, register_type),
    }


@router.post("/{register_type}", status_code=status.HTTP_201_CREATED)
def create_entry(
    register_type: str,
    payload: RegisterEntryPayload,
    journey_id: int = Query(...),
    framework_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    _validate_type(register_type)
    tid = _tenant_id(user, db)
    max_seq = db.query(FrameworkRegisterEntry).filter(
        FrameworkRegisterEntry.tenant_id == tid,
        FrameworkRegisterEntry.journey_id == journey_id,
        FrameworkRegisterEntry.register_type == register_type,
    ).count()
    e = FrameworkRegisterEntry(
        tenant_id=tid,
        journey_id=journey_id,
        uploaded_framework_id=framework_id,
        register_type=register_type,
        seq=max_seq,
        is_seed=False,
        created_by=user.id,
        **payload.model_dump(exclude_unset=True),
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _serialize(e)


@router.put("/entries/{entry_id}")
def update_entry(
    entry_id: int,
    payload: RegisterEntryPayload,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tid = _tenant_id(user, db)
    e = db.query(FrameworkRegisterEntry).filter(
        FrameworkRegisterEntry.id == entry_id,
        FrameworkRegisterEntry.tenant_id == tid,
    ).first()
    if not e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    db.refresh(e)
    return _serialize(e)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tid = _tenant_id(user, db)
    e = db.query(FrameworkRegisterEntry).filter(
        FrameworkRegisterEntry.id == entry_id,
        FrameworkRegisterEntry.tenant_id == tid,
    ).first()
    if not e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    db.delete(e)
    db.commit()
    return None


@router.post("/entries/{entry_id}/move-to-risk")
def move_entry_to_risk(
    entry_id: int,
    body: MoveToRiskRequest,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Promote a register entry into the ERM Risk Register and link it back."""
    tid = _tenant_id(user, db)
    e = db.query(FrameworkRegisterEntry).filter(
        FrameworkRegisterEntry.id == entry_id,
        FrameworkRegisterEntry.tenant_id == tid,
    ).first()
    if not e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    if e.risk_register_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Entry already moved to a risk")

    label = REGISTER_LABELS.get(e.register_type, e.register_type)
    fw_name = (body.framework_name or "ISO 27001").strip()
    data = e.data or {}
    # For generated-framework rows the content lives in data — derive a title/desc,
    # preferring a meaningful (non-short, non-numeric) value over a ref/id column.
    def _is_meaningful(v):
        s = str(v).strip()
        return len(s) > 3 and not s.replace(".", "").replace(",", "").isdigit()
    data_title = next((str(v).strip() for v in data.values() if v and _is_meaningful(v)), "")
    if not data_title:
        data_title = next((str(v).strip() for v in data.values() if v and str(v).strip()), "")
    title = (body.title or e.title or e.reference or data_title or f"{label} finding").strip()[:255]
    # Compose a useful description from the entry's fields.
    parts = []
    if e.reference:
        parts.append(f"{fw_name} {label} — {e.reference}")
    if body.description:
        parts.append(body.description)
    elif e.title:
        parts.append(e.title)
    for lbl, val in (("Gap/Action", e.action), ("Finding", e.finding_type),
                     ("Notes", e.notes), ("Evidence reviewed", e.evidence_reviewed)):
        if val:
            parts.append(f"{lbl}: {val}")
    if not e.title and not e.reference and data:
        for k, v in list(data.items())[:10]:
            if v and str(v).strip():
                parts.append(f"{k}: {str(v).strip()}")
    description = "\n".join(parts) if parts else None

    risk = Risk(
        tenant_id=tid,
        title=title,
        description=description,
        category=(body.category or "compliance"),
        risk_category="compliance",
        register_type=fw_name,
        status="open",
        owner_id=e.owner_id,
        source_type="framework_gap",
        source_reference=f"{fw_name} {label}" + (f" — {e.reference}" if e.reference else ""),
    )
    db.add(risk)
    db.flush()  # obtain risk.id
    e.risk_register_id = risk.id
    db.commit()
    db.refresh(e)
    return {"risk_id": risk.id, "entry": _serialize(e)}


@router.post("/{register_type}/reset")
def reset_register(
    register_type: str,
    journey_id: int = Query(...),
    framework_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Delete all rows for this register and re-seed from the template."""
    _validate_type(register_type)
    tid = _tenant_id(user, db)
    # Plain filtered delete — bulk delete can't run on an ordered query.
    db.query(FrameworkRegisterEntry).filter(
        FrameworkRegisterEntry.tenant_id == tid,
        FrameworkRegisterEntry.journey_id == journey_id,
        FrameworkRegisterEntry.register_type == register_type,
    ).delete(synchronize_session=False)
    db.commit()
    if _has_seed(register_type):
        _seed(db, tid, journey_id, framework_id, register_type, user.id)
    entries = _query(db, tid, journey_id, register_type).all()
    return {
        "register_type": register_type,
        "entries": [_serialize(e) for e in entries],
        "summary": _summary(entries, register_type),
    }


@router.post("/{register_type}/apply-ai")
def apply_ai(
    register_type: str,
    items: List[ApplyAIItem],
    journey_id: int = Query(...),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Apply AI-suggested assessment fields to existing rows (batch, one round-trip)."""
    _validate_type(register_type)
    tid = _tenant_id(user, db)
    # ISO registers apply to fixed columns; generated registers apply into data[key].
    is_iso = register_type in REGISTER_SEEDS
    valid_data_keys = set()
    if not is_iso:
        rd = D.register_def(register_type)
        valid_data_keys = {c.get("key") for c in (rd or {}).get("columns", [])}
    updated = 0
    for it in items:
        e = db.query(FrameworkRegisterEntry).filter(
            FrameworkRegisterEntry.id == it.id,
            FrameworkRegisterEntry.tenant_id == tid,
            FrameworkRegisterEntry.journey_id == journey_id,
            FrameworkRegisterEntry.register_type == register_type,
        ).first()
        if not e:
            continue
        for k, v in (it.fields or {}).items():
            if v is None or str(v) == "":
                continue
            if is_iso:
                if k in _AI_APPLIABLE:
                    setattr(e, k, v)
            elif k in valid_data_keys:
                e.data = {**(e.data or {}), k: v}
        updated += 1
    db.commit()
    entries = _query(db, tid, journey_id, register_type).all()
    return {
        "updated": updated,
        "register_type": register_type,
        "entries": [_serialize(e) for e in entries],
        "summary": _summary(entries, register_type),
    }
