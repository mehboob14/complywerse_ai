"""Request-template library + SLA preview — the read APIs the New-Ticket form uses.

§A3 GET /helpdesk/request-templates — the department-wise predefined request
library (seeded by itsm_seed.seed_request_templates) that pre-fills the form.
§A5 GET /helpdesk/sla-preview — the SLA that WOULD apply to a new ticket of a
given process/priority, so the form shows a real target instead of a static label.

Both are tenant-scoped reads; the main session mounts this one `router`.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...models import HDTicketTemplate, get_db
from . import sla
from .common import require_view, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


def _serialize(t: HDTicketTemplate) -> dict:
    return {
        "id": t.id,
        "template_name": t.template_name,
        "department_id": t.department_id,
        "department": t.department.name if t.department else None,
        "process": t.process,
        "default_subject": t.default_subject,
        "default_description": t.default_description,
        "default_category": t.default_category,
        "default_subcategory": t.default_subcategory,
        "default_impact": t.default_impact,
        "default_urgency": t.default_urgency,
        "icon": t.icon,
    }


@router.get("/request-templates")
def list_request_templates(department_id: Optional[int] = None,
                           process: Optional[str] = None,
                           db: Session = Depends(get_db),
                           _: bool = Depends(require_view)):
    """§A3. Enabled templates only, filtered by department_id and/or process when
    given. Tenant-scoped. 200-safe (empty list when nothing matches)."""
    tid = tenant_id(db)
    q = db.query(HDTicketTemplate).filter(
        HDTicketTemplate.tenant_id == tid,
        HDTicketTemplate.enabled.is_(True),
    )
    if department_id is not None:
        q = q.filter(HDTicketTemplate.department_id == department_id)
    if process:
        q = q.filter(HDTicketTemplate.process == process)
    rows = q.order_by(HDTicketTemplate.template_name.asc()).all()
    return {"templates": [_serialize(t) for t in rows]}


@router.get("/sla-preview")
def sla_preview(process: Optional[str] = None, priority: str = "Medium",
                db: Session = Depends(get_db), _: bool = Depends(require_view)):
    """§A5. The SLA that would apply to a new ticket of this process/priority."""
    return sla.sla_preview(db, tenant_id(db), process, priority)
