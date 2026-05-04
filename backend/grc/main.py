import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import Response
from .models import init_master_db
from .audit_logger import should_audit_request, parse_request_payload, write_audit_log
from .routers import (
    auth_router,
    tenants_router,
    frameworks_router,
    controls_router,
    evidence_router,
    risks_router,
    governance_router,
    documents_router,
    assets_router,
    dashboard_router,
    enriched_dashboard_router,
    certification_router,
    advanced_erm_router,
    compliance_assessments_router,
    critical_tasks_router,
    is_projects_router,
    tasks_router,
)


from .routers.admin_router import router as admin_router
from .modules.erm import erm_router
from .modules.governance import governance_module_router
from .modules.framework_upload import framework_upload_router
from .modules.compliance import compliance_router
from .modules.evidence import evidence_module_router
from .modules.control_library import control_library_router
from .modules.vuln_management import vuln_management_router
from .modules.chatbot import (
    chatbot_router,
    start_complychat_embedding_worker,
    stop_complychat_embedding_worker,
)
from .modules.vendor_risk import vendor_risk_router
from .modules.workflow_engine import (
    workflow_engine_router,
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)
from .modules.integrations import integrations_router
from .middleware.subdomain import TenantMiddleware

app = FastAPI(
    title="Enterprise GRC Platform API's",
    description="Enterprise Governance, Risk, and Compliance platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

def _build_cors_kwargs() -> dict:
    """Mirror the outer wrapper's env-driven CORS resolution.

    The outer FastAPI app in `backend/main.py` mounts this sub-app at
    `/grc`, so its CORS middleware is the primary line of defence. We
    still configure CORS here as defence-in-depth — and so this module is
    safe to import / run in isolation (tests, scripts) without exposing
    a wide-open `*` origin policy.
    """
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

# Compress JSON responses larger than 500 bytes — typical 5–10x reduction
# for the heavy coverage / heatmap / dashboard payloads. Critical for
# proxies/CDNs that enforce response-size limits in production.
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)

app.add_middleware(TenantMiddleware)


@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    if not should_audit_request(request):
        return await call_next(request)

    import time
    started_at = time.time()

    request_payload = None
    if request.method.upper() not in {"GET", "DELETE", "HEAD", "OPTIONS"}:
        body = await request.body()
        received = False

        async def receive():
            nonlocal received
            if received:
                return {"type": "http.request", "body": b"", "more_body": False}
            received = True
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive
        request_payload = await parse_request_payload(request, body)

    try:
        response = await call_next(request)
        write_audit_log(request, response, started_at, request_payload)
        return response
    except Exception:
        write_audit_log(request, Response(status_code=500), started_at, request_payload)
        raise

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(tenants_router)
app.include_router(frameworks_router)
app.include_router(controls_router)
app.include_router(evidence_router)
app.include_router(risks_router)
app.include_router(governance_router)
app.include_router(documents_router)
app.include_router(assets_router)
app.include_router(dashboard_router)
app.include_router(enriched_dashboard_router)
app.include_router(certification_router)
app.include_router(advanced_erm_router)
app.include_router(compliance_assessments_router)
app.include_router(critical_tasks_router)
app.include_router(is_projects_router)
app.include_router(tasks_router)
app.include_router(erm_router)
app.include_router(governance_module_router)
app.include_router(framework_upload_router)
app.include_router(compliance_router)
app.include_router(evidence_module_router)
app.include_router(control_library_router)
app.include_router(vuln_management_router)
app.include_router(chatbot_router)
app.include_router(vendor_risk_router)
app.include_router(workflow_engine_router)
app.include_router(integrations_router)


@app.on_event("startup")
def on_startup():
    init_master_db()

    # Self-heal: add any compliance-module columns that pre-existing tenant DBs
    # are missing. New tenants get them via `Base.metadata.create_all` at
    # provisioning time; this catches DBs that were created before the column
    # was introduced. Failures are logged and swallowed.
    try:
        from .modules.compliance.schema_migrations import ensure_compliance_columns
        ensure_compliance_columns()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("compliance schema self-heal failed")

    _disable_embedded = os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower()
    if _disable_embedded not in ("1", "true", "yes", "on"):
        start_workflow_engine_runtime()

    _disable_complychat_embedding_worker = os.getenv("DISABLE_COMPLYCHAT_EMBED_WORKER", "").strip().lower()
    _embed_worker_autostart = os.getenv("COMPLYCHAT_EMBED_WORKER_AUTOSTART", "true").strip().lower()
    if _disable_complychat_embedding_worker not in ("1", "true", "yes", "on") and _embed_worker_autostart in ("1", "true", "yes", "on"):
        start_complychat_embedding_worker()


@app.on_event("shutdown")
def on_shutdown():
    stop_workflow_engine_runtime()
    stop_complychat_embedding_worker()


@app.get("/")
def root():
    return {
        "message": "Enterprise GRC Platform API",
        "version": "1.0.0",
        "modules": [
            "frameworks",
            "controls", 
            "evidence",
            "risks",
            "governance",
            "documents",
            "assets",
            "certifications",
            "advanced-erm",
            "erm",
            "compliance",
            "compliance-assessments",
            "control-library",
            "vuln-management",
            "vendor-risk",
            "workflow-engine"
        ]
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}
