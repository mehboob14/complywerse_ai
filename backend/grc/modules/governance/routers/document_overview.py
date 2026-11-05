"""Governance > Documents > Overview: the library at a glance for a department (rules and definitions: ../documents_overview.py).

GET /governance/document-overview              the figures of one scope: ?department_id=<id> | none (no department) | absent (the first choice)
GET /governance/document-overview/ids?kind=    the documents behind a figure (stuck, late_approvals, late_acknowledgements, on_hold)
GET /governance/document-overview/board        the documents of the scope as a Kanban: ?group=status|type|department&per=<cards a column lists>
GET /governance/document-overview/export       the documents of the scope as a CSV file (an attachment)

All need a sign-in and either the right to read the whole library or the headship of a department; none writes.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
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


@router.get("/board")
def get_board(department_id: Optional[str] = Query(None), group: str = Query("status"), per: int = Query(documents_overview.BOARD_CARDS, ge=1),
              db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return documents_overview.board(db, current_user, department_id, group, per)


@router.get("/export")
def export_documents(department_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    text, name = documents_overview.export_documents(db, current_user, department_id)
    return Response(content=text.encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})
