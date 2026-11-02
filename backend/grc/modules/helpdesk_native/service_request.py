"""Service Requests — process-scoped list + the service catalog (spec §5).

A service request is an HDTicket with process='service_request'. Besides the
list, this serves GET /helpdesk/service-catalog: the category→subcategory map
the New-Ticket form reads. The seeder (itsm_seed, Agent A) is the single runtime
source — default map + optional HDSettings override live there — so the endpoint
just returns what itsm_seed exposes. The spec's default map (§3.5) is kept here
only as a transitional fallback so the endpoint is live before the seeder lands.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...models import get_db
from . import tickets  # Agent A's write path; attrs resolve at call time
from . import itsm_seed  # single source of the catalog (SERVICE_CATALOG constant)
from .common import require_processes_view, require_view, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


@router.get("/service-requests")
def list_service_requests(db: Session = Depends(get_db),
                          _: bool = Depends(require_processes_view)):
    return tickets.list_tickets(db, tenant_id(db), process="service_request")


# The catalog feeds the GENERAL New-Ticket form (any agent who can create a ticket),
# so it stays on tickets:view per the SoD map's "process read → ... (or tickets:view)".
@router.get("/service-catalog")
def service_catalog(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    """Returns the category→subcategory map, e.g. {"IT": ["Hardware", ...], ...}.
    itsm_seed.SERVICE_CATALOG is the one runtime source of truth."""
    return itsm_seed.SERVICE_CATALOG
