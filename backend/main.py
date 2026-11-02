import logging
import os
from dotenv import load_dotenv

# Load environment variables from .env file FIRST
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from grc.main import app as grc_app
from grc.models import init_master_db
from grc.startup_seed import ensure_startup_seed_data
from grc.modules.workflow_engine import (
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)

app = FastAPI(title="ComplyVerse GRC Platform API", version="1.0.0")


def _build_cors_kwargs() -> dict:

    regex = (os.getenv("ALLOWED_ORIGIN_REGEX") or "").strip()
    if regex:
        return {"allow_origin_regex": regex, "allow_origins": []}

    csv_origins = (os.getenv("ALLOWED_ORIGINS") or "").strip()
    if csv_origins:
        return {
            "allow_origins": [o.strip() for o in csv_origins.split(",") if o.strip()],
        }


    return {
        "allow_origin_regex": r"^https?://([a-z0-9-]+\.)?localhost(:[0-9]+)?$",
        "allow_origins": [],
    }


app.add_middleware(
    CORSMiddleware,
    **_build_cors_kwargs(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/grc", grc_app)

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)


@app.on_event("startup")
def on_startup():
    init_master_db()
    ensure_startup_seed_data()
    if os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower() not in ("1", "true", "yes", "on"):
        start_workflow_engine_runtime()
    # Help Desk per-tenant boot heal (schema columns + reference data). Here, not in
    # grc/main.py: grc_app is mounted, and a mounted app's startup never fires.
    try:
        from grc.modules.helpdesk_native.itsm_seed import run_boot_heal
        run_boot_heal()
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("helpdesk boot heal skipped", exc_info=True)
    _resume_inflight_scans_all_tenants()


def _resume_inflight_scans_all_tenants():
    """Hosted (Flow 1) scans and pentest Find scans run in in-process threads that die on restart.
    Re-attach / honestly fail them for EVERY active tenant in the registry, not just a default one."""
    log = logging.getLogger(__name__)
    try:
        from grc.db import MasterSession
        from grc.models import Tenant
        m = MasterSession()
        try:
            slugs = [t.slug for t in m.query(Tenant).filter(Tenant.is_active.is_(True)).all() if t.slug]
        finally:
            m.close()
    except Exception:  # noqa: BLE001
        log.warning("tenant enumeration for scan resume failed; using DEFAULT_TENANT_SLUG only", exc_info=True)
        slugs = [os.getenv("DEFAULT_TENANT_SLUG", "ava")]
    for slug in slugs:
        try:
            from grc.modules.integrations.services.hosted_scan import resume_inflight_hosted_scans
            resume_inflight_hosted_scans(slug)
        except Exception:  # noqa: BLE001
            log.warning("hosted-scan resume skipped for %s", slug, exc_info=True)
        try:
            from grc.modules.pentest.service import resume_inflight_scans
            resume_inflight_scans(slug)
        except Exception:  # noqa: BLE001
            log.warning("pentest resume skipped for %s", slug, exc_info=True)


@app.on_event("shutdown")
def on_shutdown():
    stop_workflow_engine_runtime()


@app.get("/")
def root():
    return {
        "message": "ComplyVerse GRC Platform API",
        "version": "1.0.0",
        "docs": "/grc/docs",
        "health": "/grc/health"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
