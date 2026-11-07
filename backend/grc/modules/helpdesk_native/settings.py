"""Settings — native conversion of
`helpdesk/helpdesk/doctype/hd_settings/hd_settings.py` + `helpdesk/api/config.py`.

Frappe's HD Settings is an `issingle` doctype (one global row); natively it is one
row per tenant, created on first read with the model's column defaults (which are
the Frappe JSON defaults). Converted:

  * validate()            -> _validate(): auto_close_after_days > 0 (when auto-close
                             is on), feedback status must be Resolved-category,
                             default agent status must be enabled.
  * get_config()          -> get_config(): the guest-safe public subset, with the
                             favicon fallback to the bundled default.

SKIPPED (noted, not converted):
  * email-template CRUD / validate_email_contents — the outbound-mail workflow is
    not wired in the native engine; the template columns persist for parity.
  * get_base_support_rotation / create_base_support_rotation — depends on Frappe
    `Assignment Rule`, which is NOT a converted doctype (base_support_rotation
    stays a plain String column).
  * on_update realtime (frappe.publish_realtime "helpdesk:settings-updated") — no
    realtime bus natively.
  * update_ticket_permissions (guest ticket-creation permission) — Frappe desk
    permission plumbing, out of scope.

Tenant scope: HDSettings.tenant_id (unique per tenant). Mutations return
{"ok": true}; reads never 4xx (get_config returns static defaults if the tenant
can't be resolved).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import HDAgentStatus, HDSettings, HDTicketStatus, get_db
from .common import require_settings_manage, require_settings_view, tenant_id

router = APIRouter()

_DEFAULT_FAVICON = "/assets/helpdesk/desk/favicon.svg"

# Columns the settings page may write (links by id to converted doctypes; the
# layout/section-break fields of the doctype are not columns and are excluded).
_WRITABLE = {
    "default_priority_id", "default_agent_status_id", "default_ticket_type_id",
    "default_ticket_status_id", "ticket_reopen_status_id", "update_status_to_id",
    "auto_close_status_id", "send_email_feedback_on_status_id", "base_support_rotation",
    "restrict_tickets_by_agent_group", "do_not_restrict_tickets_without_an_agent_group",
    "assign_within_team", "disable_saved_replies_global_scope", "prefer_knowledge_base",
    "allow_anyone_to_create_tickets", "is_feedback_mandatory", "enable_comment_reactions",
    "auto_set_customer_from_contact", "auto_update_status", "auto_close_tickets",
    "auto_close_after_days", "enable_outside_hours_banner", "outside_working_hours_message",
    "brand_name", "brand_logo", "favicon", "setup_complete",
    "initial_helpdesk_name_setup_skipped", "show_customer_portal_permission_notice",
    "show_ticket_field_permission_notice", "persona_captured",
    "name_weight", "subject_weight", "description_weight", "headings_weight",
    "skip_email_workflow", "instantly_send_email", "enable_email_ticket_feedback",
    "feedback_email_content", "send_acknowledgement_email", "acknowledgement_email_content",
    "enable_reply_email_to_agent", "reply_email_to_agent_content",
    "enable_reply_email_via_agent", "reply_via_agent_email_content",
}


class SettingsBody(BaseModel):
    # The settings page posts any subset of _WRITABLE; extras are captured and
    # filtered by key against _WRITABLE in update_settings() (unknown keys ignored).
    model_config = {"extra": "allow"}


# Email-workflow fields served/updated by the dedicated /settings/email endpoints.
# Each template column maps to the mail module's DEFAULT_TEMPLATES key, so the editor
# can show the baked-in default when the override is blank (Frappe parity).
_EMAIL_FLAGS = (
    "skip_email_workflow", "instantly_send_email", "enable_email_ticket_feedback",
    "send_acknowledgement_email", "enable_reply_email_to_agent",
    "enable_reply_email_via_agent", "send_email_feedback_on_status_id",
)
_EMAIL_TEMPLATES = {
    "acknowledgement_email_content": "acknowledgement",
    "reply_email_to_agent_content": "reply_to_agents",
    "reply_via_agent_email_content": "reply_via_agent",
    "feedback_email_content": "share_feedback",
}


class EmailSettingsBody(BaseModel):
    # Any subset of the email flags + template columns; filtered against the set
    # above in update_email_settings (unknown keys ignored).
    model_config = {"extra": "allow"}


def _get_or_create(db: Session, tid: int) -> HDSettings:
    """Frappe `issingle` -> per-tenant singleton; create-on-first-read with the
    model's (Frappe) defaults."""
    s = db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()
    if s is None:
        s = HDSettings(tenant_id=tid)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _validate(db: Session, tid: int, s: HDSettings) -> None:
    # validate_auto_close_days
    if s.auto_close_tickets and (s.auto_close_after_days or 0) <= 0:
        raise HTTPException(status_code=400, detail="Day count for auto closing tickets cannot be negative or zero")
    # validate_send_feedback_when_ticket_closed
    if s.enable_email_ticket_feedback:
        status = (
            db.query(HDTicketStatus)
            .filter(HDTicketStatus.id == s.send_email_feedback_on_status_id, HDTicketStatus.tenant_id == tid)
            .first()
        )
        if not status or status.category != "Resolved":
            raise HTTPException(status_code=400, detail="The status for sending feedback must be of Resolved category.")
    # validate_default_agent_status
    if s.default_agent_status_id:
        st = (
            db.query(HDAgentStatus)
            .filter(HDAgentStatus.id == s.default_agent_status_id, HDAgentStatus.tenant_id == tid)
            .first()
        )
        if not st or not st.enabled:
            raise HTTPException(status_code=400, detail="The default agent status must be enabled.")


def settings_row(s: HDSettings) -> dict:
    """Full settings for the settings page (every writable column + id)."""
    out = {"name": str(s.id)}
    out.update({k: getattr(s, k) for k in _WRITABLE})
    return out


def _public_subset(s: Optional[HDSettings]) -> dict:
    """config.py get_config() fields — the guest-safe subset."""
    def g(attr, default=None):
        return getattr(s, attr, default) if s is not None else default
    return {
        "brand_name": g("brand_name"),
        "brand_logo": g("brand_logo"),
        "favicon": g("favicon") or _DEFAULT_FAVICON,
        "prefer_knowledge_base": bool(g("prefer_knowledge_base", False)),
        "setup_complete": bool(g("setup_complete", False)),
        "skip_email_workflow": bool(g("skip_email_workflow", False)),
        "is_feedback_mandatory": bool(g("is_feedback_mandatory", True)),
        "restrict_tickets_by_agent_group": bool(g("restrict_tickets_by_agent_group", False)),
        "assign_within_team": bool(g("assign_within_team", False)),
        "disable_saved_replies_global_scope": bool(g("disable_saved_replies_global_scope", False)),
        "enable_comment_reactions": bool(g("enable_comment_reactions", False)),
    }


# ─── endpoints ─────────────────────────────────────────────────────────────
@router.get("/helpdesk/settings")
def get_settings(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return settings_row(_get_or_create(db, tenant_id(db)))


@router.post("/helpdesk/settings")
def update_settings(body: SettingsBody, db: Session = Depends(get_db), _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    s = _get_or_create(db, tid)
    data = body.model_dump()
    for k, val in data.items():
        if k in _WRITABLE:
            setattr(s, k, val)
    _validate(db, tid, s)
    db.commit()
    return {"ok": True}


@router.get("/helpdesk/settings/email")
def get_email_settings(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    """The email-workflow subset for the Email Settings page: the flags, each
    template's current (possibly null) content, and the baked-in default content so
    the editor can show the fallback when the override is blank."""
    from .mail import DEFAULT_TEMPLATES
    s = _get_or_create(db, tenant_id(db))
    flags = {k: getattr(s, k) for k in _EMAIL_FLAGS}
    templates = {
        col: {"content": getattr(s, col), "default": DEFAULT_TEMPLATES.get(kind, "")}
        for col, kind in _EMAIL_TEMPLATES.items()
    }
    return {"flags": flags, "templates": templates}


@router.post("/helpdesk/settings/email")
def update_email_settings(body: EmailSettingsBody, db: Session = Depends(get_db),
                          _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    s = _get_or_create(db, tid)
    allowed = set(_EMAIL_FLAGS) | set(_EMAIL_TEMPLATES)
    for k, val in body.model_dump().items():
        if k in allowed:
            setattr(s, k, val)
    _validate(db, tid, s)
    db.commit()
    return {"ok": True}


@router.get("/helpdesk/config")
def get_config(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    """Public branding subset. HARDENED (audit M4): now requires auth + settings:view
    (was guest-accessible) and is READ-ONLY — it no longer creates/commits an
    HDSettings row on a GET (the write-on-read is gone). An unconfigured tenant
    returns static defaults from `_public_subset(None)` without persisting anything;
    the settings row is created lazily on the first authenticated write."""
    tid = tenant_id(db)
    s = (
        db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()
        if tid is not None else None
    )
    return _public_subset(s)
