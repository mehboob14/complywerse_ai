"""ERM onboarding utilities — one-click seeding of a client's ERM framework.

Additive + idempotent: seeding only inserts rows through existing models and is a
no-op on re-run, so it is safe to trigger from the live platform during handover.
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ....models import Tenant, get_db
from ....routers.auth_router import require_auth, require_tenant_permission
from ....services.onelink_seed import seed_onelink
from ..onelink_register_import import import_onelink_register

router = APIRouter(prefix="/onboarding")

_ALLOWED_XLSX = (".xlsx", ".xls")


@router.post("/seed-onelink", dependencies=[Depends(require_tenant_permission("erm:risks:create"))])
def seed_onelink_data(db: Session = Depends(get_db), current_user=Depends(require_auth)):
    """Seed 1LINK's ERM framework (governance committees, qualitative risk appetite,
    a 3x3 likelihood/impact scale, and a representative RCSA risk register with
    controls, mitigation actions and KRIs) into the current tenant.

    Idempotent: re-running only fills gaps, never duplicates or overwrites.
    """
    tenant = db.query(Tenant).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No tenant resolved for this request.")
    summary = seed_onelink(db, tenant.id)
    return {"ok": True, "tenant": tenant.slug, "seeded": summary}


@router.post("/import-register", dependencies=[Depends(require_tenant_permission("erm:risks:create"))])
async def import_onelink_register_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Import a 1LINK RCSA risk-register workbook (their 71-column template) into the
    current tenant's risk register. Every column is preserved verbatim on each risk.
    Idempotent: rows already imported (same Risk ID) are skipped."""
    name = (file.filename or "").lower()
    if not name.endswith(_ALLOWED_XLSX):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Please upload an .xlsx or .xls file.")
    tenant = db.query(Tenant).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No tenant resolved for this request.")
    data = await file.read()
    result = import_onelink_register(db, tenant.id, data)
    return {"ok": True, "tenant": tenant.slug, **result}
