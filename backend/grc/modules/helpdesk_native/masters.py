"""Help Desk master doctypes — native CRUD + guards (engine conversion).

1:1 transcription of four Frappe DocType controllers onto ComplyVerse's own tables. The
LOGIC and FLOW stay identical to Frappe — only the data layer changes (frappe.db
→ tenant-scoped SQLAlchemy, frappe.throw → HTTPException). Each guard cites the
Frappe source function it ports.

Sources (helpdesk-app/helpdesk/helpdesk/doctype/<name>/<name>.py):
  * hd_ticket_status          -> HDTicketStatus          (grc_hd_ticket_status)
  * hd_ticket_type            -> HDTicketType            (grc_hd_ticket_type)
  * hd_ticket_template(+field)-> HDTicketTemplate(+Field)(grc_hd_ticket_template)
  * hd_ticket_feedback_option -> HDTicketFeedbackOption  (grc_hd_ticket_feedback_option)

Patterns mirror the sibling native modules: tenant-scope every query via
`tenant_id(db)`; reads never 4xx on empty; mutations return {"ok": True}; a
missing/cross-tenant row → 404 (the tenant filter is the isolation guard, same
as replies._get_reply). This module owns its own `router`; the main session
includes it into router.py.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import (
    get_db,
    HDChangeType,
    HDIncidentCategory,
    HDProblemCategory,
    HDChangeCategory,
    HDTicketStatus,
    HDTicketType,
    HDTicketPriority,
    HDTicketTemplate,
    HDTicketTemplateField,
    HDTicketFeedbackOption,
    HDServiceLevelAgreement,
    HDSettings,
)
from .common import tenant_id, require_view, require_masterdata_view, require_settings_manage

router = APIRouter()

CLOSED = "Closed"

# ─── template constants (helpdesk/consts.py) ───────────────────────────────
DEFAULT_TICKET_TEMPLATE = "Default"
# never display data — the key authenticates guest feedback links (consts.py)
NEVER_CUSTOMER_VISIBLE_FIELDS = ("key",)
# set by the server; a customer reads but never submits these (consts.py)
SERVER_COMPUTED_FIELDS = [
    "last_customer_response", "last_agent_response", "first_responded_on", "sla",
    "response_by", "resolution_by", "resolution_date", "status_category",
    "on_hold_since", "first_response_time", "resolution_time",
    "first_response_failed_by", "resolution_failed_by",
]
# `validate_unallowed_fields` (hd_ticket_template.py)
UNALLOWED_TEMPLATE_FIELDS = ("status", "agreement_status", "subject")
# `verify_field_exists` → frappe.get_meta("HD Ticket").has_field. The native
# equivalent of the meta fieldname set is the forked HD Ticket DocType's own
# fieldnames (helpdesk-app/.../doctype/hd_ticket/hd_ticket.json, data fields).
HD_TICKET_FIELDS = frozenset({
    "subject", "raised_by", "status", "priority", "ticket_type", "agent_group",
    "ticket_split_from", "description", "template", "sla", "response_by",
    "agreement_status", "resolution_by", "service_level_agreement_creation",
    "on_hold_since", "total_hold_time", "first_response_time", "first_responded_on",
    "avg_response_time", "resolution_details", "opening_date", "opening_time",
    "resolution_date", "resolution_time", "user_resolution_time", "contact",
    "customer", "email_account", "via_customer_portal", "feedback_extra",
    "feedback", "feedback_rating", "summary", "is_merged", "merged_with", "key",
    "status_category", "last_agent_response", "last_customer_response",
    "raised_outside_working_hours", "first_response_failed_by", "resolution_failed_by",
})

# `allowed_ratings` (hd_ticket_feedback_option.py)
ALLOWED_RATINGS = [0.2, 0.4, 0.6, 0.8, 1.0]


# ═══════════════════════════════════════════════════════════════════════════
# HD Ticket Status  (list / create / update / disable + all guards)
# ═══════════════════════════════════════════════════════════════════════════
class StatusCreate(BaseModel):
    label_agent: str
    category: str                                   # Open | Paused | Resolved
    label_customer: Optional[str] = None
    different_view: Optional[bool] = None
    color: Optional[str] = None
    order: Optional[int] = None
    enabled: Optional[bool] = None


class StatusUpdate(BaseModel):
    label_agent: Optional[str] = None
    category: Optional[str] = None
    label_customer: Optional[str] = None
    different_view: Optional[bool] = None
    color: Optional[str] = None
    order: Optional[int] = None
    enabled: Optional[bool] = None


def _get_status(db: Session, tid: int, sid: int) -> HDTicketStatus:
    row = (
        db.query(HDTicketStatus)
        .filter(HDTicketStatus.id == sid, HDTicketStatus.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _validate_status_update(db: Session, tid: int, row: HDTicketStatus, data: dict) -> None:
    """All three HD Ticket Status validate() guards + before_rename, run against
    the pre-update row (`row`) and the incoming change set (`data`). `data` holds
    ONLY the fields the client sent, so membership == Frappe's has_value_changed."""
    old_label = row.label_agent
    old_category = row.category

    # before_rename: the 'Closed' status cannot be renamed.
    if old_label == CLOSED and "label_agent" in data and data["label_agent"] != CLOSED:
        raise HTTPException(status_code=400, detail="The 'Closed' status cannot be renamed.")

    # validate_closed_status_change: on the 'Closed' status only `color`/`order`
    # may be modified (a save that changes neither is rejected, as in Frappe).
    if old_label == CLOSED:
        order_changed = "order" in data and data["order"] != row.order
        color_changed = "color" in data and data["color"] != row.color
        if not (order_changed or color_changed):
            raise HTTPException(
                status_code=400,
                detail="Only the 'color' and 'order' fields of the 'Closed' status can be modified.",
            )

    # validate_required_categories: changing a status's category may not remove
    # the last status of the old category.
    if "category" in data and old_category and data["category"] != old_category:
        count = (
            db.query(HDTicketStatus)
            .filter(
                HDTicketStatus.tenant_id == tid,
                HDTicketStatus.category == old_category,
                HDTicketStatus.id != row.id,
            )
            .count()
        )
        if count == 0:
            raise HTTPException(
                status_code=400,
                detail=f"At least one ticket status with category '{old_category}' must exist in the system.",
            )

    # validate_disabling_status: only fires when the status ends up disabled.
    new_enabled = data.get("enabled", row.enabled)
    if new_enabled:
        return
    new_category = data.get("category", row.category)
    count = (
        db.query(HDTicketStatus)
        .filter(
            HDTicketStatus.tenant_id == tid,
            HDTicketStatus.enabled.is_(True),
            HDTicketStatus.category == new_category,
            HDTicketStatus.id != row.id,
            HDTicketStatus.label_agent != CLOSED,
        )
        .count()
    )
    if count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"At least one enabled status for {new_category} category must be enabled.",
        )
    # linked as an SLA default/reopen status?
    sla_linked = (
        db.query(HDServiceLevelAgreement)
        .filter(
            HDServiceLevelAgreement.tenant_id == tid,
            (HDServiceLevelAgreement.default_ticket_status_id == row.id)
            | (HDServiceLevelAgreement.ticket_reopen_status_id == row.id),
        )
        .first()
    )
    if sla_linked:
        raise HTTPException(
            status_code=400,
            detail="Cannot disable this status as it is linked as a default/reopen status in an SLA.",
        )
    # linked as an HD Settings default/reopen status?
    settings = db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()
    if settings and row.id in (settings.default_ticket_status_id, settings.ticket_reopen_status_id):
        raise HTTPException(
            status_code=400,
            detail="Cannot disable this status as it is linked as a default/reopen status in HD Settings.",
        )


@router.get("/ticket-statuses")
def list_ticket_statuses(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDTicketStatus)
        .filter(HDTicketStatus.tenant_id == tid)
        .order_by(HDTicketStatus.order.asc())
        .all()
    )
    return {"ticket_statuses": [{
        "name": str(s.id),
        "label_agent": s.label_agent,
        "label_customer": s.label_customer,
        "category": s.category,
        "color": s.color,
        "order": s.order,
        "different_view": bool(s.different_view),
        "enabled": bool(s.enabled),
    } for s in rows]}


@router.post("/ticket-statuses")
def create_ticket_status(body: StatusCreate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    # is_new() → every validate_* guard early-returns in Frappe, so create only
    # persists the reqd fields.
    tid = tenant_id(db)
    db.add(HDTicketStatus(
        tenant_id=tid,
        label_agent=body.label_agent,
        category=body.category,
        label_customer=body.label_customer,
        different_view=bool(body.different_view),
        color=body.color,
        order=body.order,
        enabled=True if body.enabled is None else body.enabled,
    ))
    db.commit()
    return {"ok": True}


@router.put("/ticket-statuses/{sid}")
def update_ticket_status(sid: int, body: StatusUpdate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_status(db, tid, sid)
    data = body.model_dump(exclude_unset=True)
    _validate_status_update(db, tid, row, data)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.post("/ticket-statuses/{sid}/disable")
def disable_ticket_status(sid: int, db: Session = Depends(get_db),
                          _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_status(db, tid, sid)
    _validate_status_update(db, tid, row, {"enabled": False})
    row.enabled = False
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# HD Ticket Type  (CRUD + prevent delete of a system type)
# ═══════════════════════════════════════════════════════════════════════════
class TypeBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority_id: Optional[int] = None
    is_system: Optional[bool] = None
    disabled: Optional[bool] = None


def _get_type(db: Session, tid: int, tyid: int) -> HDTicketType:
    row = (
        db.query(HDTicketType)
        .filter(HDTicketType.id == tyid, HDTicketType.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/ticket-types")
def list_ticket_types(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDTicketType)
        .filter(HDTicketType.tenant_id == tid)
        .order_by(HDTicketType.name.asc())
        .all()
    )
    return {"ticket_types": [{
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "priority_id": t.priority_id,
        "is_system": bool(t.is_system),
        "disabled": bool(t.disabled),
    } for t in rows]}


# ─── ticket priorities (HD Ticket Priority) ─────────────────────────────────
# Frappe's priority controller is advisory-only (a msgprint + telemetry, no
# data guards), so this is plain tenant-scoped CRUD — exposing the `id` the SLA
# and type pickers need (the list previously lived only on /meta, id-less).
class PriorityBody(BaseModel):
    name: str
    level: Optional[str] = "Medium"       # Urgent | High | Medium | Low
    description: Optional[str] = None
    disabled: bool = False


def _get_priority(db: Session, tid: int, pid: int) -> HDTicketPriority:
    row = db.query(HDTicketPriority).filter(
        HDTicketPriority.tenant_id == tid, HDTicketPriority.id == pid).first()
    if not row:
        raise HTTPException(status_code=404, detail="Priority not found")
    return row


@router.get("/priorities")
def list_priorities(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDTicketPriority)
        .filter(HDTicketPriority.tenant_id == tid)
        .order_by(HDTicketPriority.name.asc())
        .all()
    )
    return {"priorities": [{
        "id": p.id,
        "name": p.name,
        "level": p.level,
        "description": p.description,
        "disabled": bool(p.disabled),
    } for p in rows]}


@router.get("/change-types")
def list_change_types_for_form(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    """The tenant's governance change types (Standard/Normal/Major/Emergency + any
    custom), for the New-ticket Change form. Creator-accessible (master-data view),
    unlike the settings-gated /helpdesk/admin/governance/change-types admin screen —
    so the dropdown is sourced from grc_hd_change_type instead of a hardcoded list."""
    tid = tenant_id(db)
    rows = (
        db.query(HDChangeType)
        .filter(HDChangeType.tenant_id == tid)
        .order_by(HDChangeType.code.asc())
        .all()
    )
    return {"change_types": [{
        "code": c.code,
        "name": c.name,
        "requires_cab": bool(c.requires_cab),
        "auto_approve": bool(c.auto_approve),
    } for c in rows]}


_PROCESS_CATEGORY_MODELS = {
    "incident": HDIncidentCategory,
    "problem": HDProblemCategory,
    "change": HDChangeCategory,
}


@router.get("/process-categories")
def list_process_categories(process: str, db: Session = Depends(get_db),
                            _: bool = Depends(require_masterdata_view)):
    """Per-process category tree (category + subcategory) for the New-ticket form's
    category picker. `process` = incident | problem | change. Returns a flat list
    the FE groups into dependent dropdowns (a subcategory links to its category via
    parent_id). Service requests use the catalogue, not this."""
    tid = tenant_id(db)
    model = _PROCESS_CATEGORY_MODELS.get((process or "").strip().lower())
    if model is None:
        return {"categories": []}
    rows = (
        db.query(model)
        .filter(model.tenant_id == tid)
        .order_by(model.sort_order.asc().nullslast(), model.name.asc())
        .all()
    )
    return {"categories": [{
        "id": c.id,
        "name": c.name,
        "level": c.level,
        "parent_id": c.parent_id,
    } for c in rows]}


@router.post("/priorities")
def create_priority(body: PriorityBody, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Priority name is required")
    if db.query(HDTicketPriority).filter(HDTicketPriority.tenant_id == tid,
                                         HDTicketPriority.name == name).first():
        raise HTTPException(status_code=400, detail="A priority with this name already exists")
    db.add(HDTicketPriority(tenant_id=tid, name=name, level=body.level or "Medium",
                            description=body.description, disabled=bool(body.disabled)))
    db.commit()
    return {"ok": True}


@router.put("/priorities/{pid}")
def update_priority(pid: int, body: PriorityBody, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_priority(db, tid, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/priorities/{pid}")
def delete_priority(pid: int, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_priority(db, tid, pid)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/ticket-types")
def create_ticket_type(body: TypeBody, db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    db.add(HDTicketType(
        tenant_id=tid,
        name=body.name,
        description=body.description,
        priority_id=body.priority_id,
        is_system=bool(body.is_system),
        disabled=bool(body.disabled),
    ))
    db.commit()
    return {"ok": True}


@router.put("/ticket-types/{tyid}")
def update_ticket_type(tyid: int, body: TypeBody, db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_type(db, tid, tyid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/ticket-types/{tyid}")
def delete_ticket_type(tyid: int, db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_type(db, tid, tyid)
    # on_trash → prevent_system_delete: System types can not be deleted.
    if row.is_system:
        raise HTTPException(status_code=400, detail="System types can not be deleted")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# HD Ticket Template (+ Template Field child)  (CRUD + validate() guards)
# ═══════════════════════════════════════════════════════════════════════════
class TemplateField(BaseModel):
    fieldname: Optional[str] = None
    required: Optional[bool] = None
    visible_to: Optional[str] = None                # Everyone | Agents
    editable_after_creation: Optional[bool] = None
    url_method: Optional[str] = None
    placeholder: Optional[str] = None


class TemplateBody(BaseModel):
    template_name: Optional[str] = None
    about: Optional[str] = None
    description_template: Optional[str] = None
    fields: Optional[List[TemplateField]] = None


def _get_template(db: Session, tid: int, tpid: int) -> HDTicketTemplate:
    row = (
        db.query(HDTicketTemplate)
        .filter(HDTicketTemplate.id == tpid, HDTicketTemplate.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _validate_template_fields(fields: List[TemplateField]) -> None:
    """HD Ticket Template.validate() field guards (order preserved)."""
    for f in fields:
        # verify_field_exists: the fieldname must be a real HD Ticket field.
        if f.fieldname and f.fieldname not in HD_TICKET_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Field `{f.fieldname}` does not exist in Ticket")
    for f in fields:
        # validate_unallowed_fields.
        if f.fieldname in UNALLOWED_TEMPLATE_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Field `{f.fieldname}` is not allowed in Ticket Template")
    for f in fields:
        # validate_customer_visible_fields: a field a customer can see (not
        # Agents-only) may not be a secret or a server-computed field. Frappe's
        # permlevel-based "internal field" check maps to visible_to here — an
        # internal field is marked `Agents`, so this gate (visible_to != Agents)
        # already excludes it; the remaining checks are the two name sets.
        if not f.fieldname or f.visible_to == "Agents":
            continue
        if f.fieldname in NEVER_CUSTOMER_VISIBLE_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Field `{f.fieldname}` is a secret and can never be shown to customers.")
        if f.fieldname in SERVER_COMPUTED_FIELDS:
            raise HTTPException(status_code=400,
                                detail=f"Field `{f.fieldname}` is set by the system and cannot be shown to customers.")
    # warn_customer_hidden_fields: advisory msgprint only (no DB effect, depends
    # on Frappe meta permlevels native has no store for) — not ported.


def _replace_fields(db: Session, row: HDTicketTemplate, fields: List[TemplateField]) -> None:
    row.fields.clear()  # delete-orphan cascade removes the old child rows
    for i, f in enumerate(fields):
        row.fields.append(HDTicketTemplateField(
            idx=i,
            fieldname=f.fieldname,
            required=bool(f.required),
            visible_to=f.visible_to,
            editable_after_creation=True if f.editable_after_creation is None else f.editable_after_creation,
            url_method=f.url_method,
            placeholder=f.placeholder,
        ))


@router.get("/ticket-templates")
def list_ticket_templates(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDTicketTemplate)
        .filter(HDTicketTemplate.tenant_id == tid)
        .order_by(HDTicketTemplate.template_name.asc())
        .all()
    )
    return {"ticket_templates": [{
        "name": str(t.id),
        "template_name": t.template_name,
        "about": t.about,
        "description_template": t.description_template,
        "fields": [{
            "fieldname": f.fieldname,
            "required": bool(f.required),
            "visible_to": f.visible_to,
            "editable_after_creation": bool(f.editable_after_creation),
            "url_method": f.url_method,
            "placeholder": f.placeholder,
        } for f in t.fields],
    } for t in rows]}


@router.post("/ticket-templates")
def create_ticket_template(body: TemplateBody, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    fields = body.fields or []
    _validate_template_fields(fields)
    row = HDTicketTemplate(
        tenant_id=tid,
        template_name=body.template_name or "Untitled",
        about=body.about,
        description_template=body.description_template,
    )
    _replace_fields(db, row, fields)
    db.add(row)
    db.commit()
    return {"ok": True}


@router.put("/ticket-templates/{tpid}")
def update_ticket_template(tpid: int, body: TemplateBody, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_template(db, tid, tpid)
    data = body.model_dump(exclude_unset=True)
    if body.fields is not None:
        _validate_template_fields(body.fields)
        _replace_fields(db, row, body.fields)
    for k in ("template_name", "about", "description_template"):
        if k in data:
            setattr(row, k, data[k])
    db.commit()
    return {"ok": True}


@router.delete("/ticket-templates/{tpid}")
def delete_ticket_template(tpid: int, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_template(db, tid, tpid)
    # on_trash → prevent_default_delete: the Default template can not be deleted.
    if row.template_name == DEFAULT_TICKET_TEMPLATE:
        raise HTTPException(status_code=400, detail="Default template can not be deleted")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# HD Ticket Feedback Option  (CRUD + rating / last-enabled guards)
# ═══════════════════════════════════════════════════════════════════════════
class FeedbackCreate(BaseModel):
    rating: float
    label: Optional[str] = None
    disabled: Optional[bool] = None


class FeedbackUpdate(BaseModel):
    rating: Optional[float] = None
    label: Optional[str] = None
    disabled: Optional[bool] = None


def _get_feedback(db: Session, tid: int, fid: int) -> HDTicketFeedbackOption:
    row = (
        db.query(HDTicketFeedbackOption)
        .filter(HDTicketFeedbackOption.id == fid, HDTicketFeedbackOption.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _validate_rating(rating) -> None:
    """validate_allowed_ratings + validate_bounds (run on every save)."""
    if rating not in ALLOWED_RATINGS:
        raise HTTPException(status_code=400, detail=f"Rating {rating} is not allowed")
    if not (0.2 <= rating <= 1.0):
        raise HTTPException(status_code=400, detail="Rating must be between 0.2 and 1.0")


@router.get("/feedback-options")
def list_feedback_options(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDTicketFeedbackOption)
        .filter(HDTicketFeedbackOption.tenant_id == tid)
        .order_by(HDTicketFeedbackOption.rating.asc())
        .all()
    )
    return {"feedback_options": [{
        "name": str(o.id),
        "label": o.label,
        "rating": o.rating,
        "disabled": bool(o.disabled),
    } for o in rows]}


@router.post("/feedback-options")
def create_feedback_option(body: FeedbackCreate, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    # is_new() → validate_one_enabled_option early-returns, but the rating/bounds
    # guards still run on create.
    tid = tenant_id(db)
    _validate_rating(body.rating)
    db.add(HDTicketFeedbackOption(
        tenant_id=tid,
        rating=body.rating,
        label=body.label,
        disabled=bool(body.disabled),
    ))
    db.commit()
    return {"ok": True}


@router.put("/feedback-options/{fid}")
def update_feedback_option(fid: int, body: FeedbackUpdate, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_feedback(db, tid, fid)
    data = body.model_dump(exclude_unset=True)
    new_rating = data.get("rating", row.rating)
    _validate_rating(new_rating)

    # validate_one_enabled_option: can't leave a rating with no enabled option.
    # Frappe skips the check when `disabled` didn't change AND it's already
    # disabled (disabling an already-disabled row is a no-op).
    disabled_changed = "disabled" in data and data["disabled"] != row.disabled
    new_disabled = data.get("disabled", row.disabled)
    if not (not disabled_changed and new_disabled):
        count = (
            db.query(HDTicketFeedbackOption)
            .filter(
                HDTicketFeedbackOption.tenant_id == tid,
                HDTicketFeedbackOption.rating == new_rating,
                HDTicketFeedbackOption.disabled.is_(False),
                HDTicketFeedbackOption.id != row.id,
            )
            .count()
        )
        if not count:
            raise HTTPException(
                status_code=400,
                detail=f"At least one feedback option must be enabled for rating {new_rating}",
            )

    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/feedback-options/{fid}")
def delete_feedback_option(fid: int, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    # Frappe HD Ticket Feedback Option has no on_trash guard — plain delete.
    tid = tenant_id(db)
    row = _get_feedback(db, tid, fid)
    db.delete(row)
    db.commit()
    return {"ok": True}
