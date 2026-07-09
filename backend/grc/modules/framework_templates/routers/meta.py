"""Framework template definition endpoint.

Returns the register + document tab definitions for a framework so the generic
frontend can build and render its template tabs dynamically.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import GRCUser, get_db
from ....routers.auth_router import require_auth
from .. import definitions as D

router = APIRouter(tags=["Framework Template Definitions"])


@router.get("/definition")
def get_definition(
    framework_name: str = Query(...),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    d = D.match_definition(framework_name)
    if not d:
        return {"matched": False, "registers": [], "documents": []}
    return {
        "matched": True,
        "framework_key": d.get("framework_key"),
        "display_name": d.get("display_name"),
        "registers": [
            {
                "type": r["type"],
                "label": r["label"],
                "description": r.get("description", ""),
                "columns": r.get("columns", []),
                "formSections": r.get("formSections", []),
                "assetSource": r.get("assetSource"),
            }
            for r in d.get("registers", [])
        ],
        "documents": [
            {"type": doc["type"], "label": doc["label"], "control_ref": doc.get("control_ref")}
            for doc in d.get("documents", [])
        ],
    }
