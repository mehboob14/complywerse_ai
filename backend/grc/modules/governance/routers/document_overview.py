"""Governance > Documents > Overview: the library at a glance for a department (rules and definitions: ../documents_overview.py).

GET /governance/document-overview              the figures of one scope: ?department_id=<id> | none (no department) | absent (the first choice)
GET /governance/document-overview/ids?kind=    the documents behind a figure (stuck, late_approvals, late_acknowledgements, on_hold)

Both need a sign-in and either the right to read the whole library or the headship of a department; neither writes.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import GRCUser, get_db
from ....routers.auth_router import require_auth
from .. import documents_overview

router = APIRouter(prefix="/document-overview", tags=["Governance Documents Overview"])


@router.get("")
def get_overview(department_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return documents_overview.summary(db, current_user, department_id)


@router.get("/ids")
def get_ids(kind: str = Query(...), department_id: Optional[str] = Query(None), db: Session = Depends(get_db),
            current_user: GRCUser = Depends(require_auth)):
    return documents_overview.ids(db, current_user, kind, department_id)
