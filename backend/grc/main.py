from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from .models import init_grc_db
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
    compliance_assessments_router
)
from .routers.admin_router import router as admin_router
from .modules.erm import erm_router
from .modules.governance import governance_module_router
from .modules.framework_upload import framework_upload_router
from .modules.compliance import compliance_router
from .modules.evidence import evidence_module_router
from .modules.control_library import control_library_router
from .modules.vuln_management import vuln_management_router
from .modules.chatbot import chatbot_router
from .modules.audit_management import audit_management_router
from .modules.vendor_risk import vendor_risk_router
from .modules.workflow_engine import (
    workflow_engine_router,
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)
from .middleware.subdomain import TenantMiddleware

app = FastAPI(
    title="Enterprise GRC Platform API",
    description="Enterprise-scale Governance, Risk, and Compliance platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(erm_router)
app.include_router(governance_module_router)
app.include_router(framework_upload_router)
app.include_router(compliance_router)
app.include_router(evidence_module_router)
app.include_router(control_library_router)
app.include_router(vuln_management_router)
app.include_router(chatbot_router)
app.include_router(audit_management_router)
app.include_router(vendor_risk_router)
app.include_router(workflow_engine_router)


@app.on_event("startup")
def on_startup():
    init_grc_db()
    start_workflow_engine_runtime()


@app.on_event("shutdown")
def on_shutdown():
    stop_workflow_engine_runtime()


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
