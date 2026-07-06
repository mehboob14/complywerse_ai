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
    ai_risk_assessment_router,
    compliance_assessments_router,
    critical_tasks_router,
    is_projects_router,
    tasks_router,
    sso_router,
    entra_router,
    artifacts_router,
)
from .routers import dcc_router, audit_plan_router, nca_risk_router, nca_vuln_router, nca_container_router, nca_templates_router, reference_laws_router, nca_kpi_router
# Criticality Assessments — Information System (ISCA) + Infrastructure Asset (IACA) per bank-provided templates.
from .routers import criticality_assessments_router
# Phase 9 — cross-domain power search + exception-aging analytics.
from .routers import search_router
# Teams — admin CRUD for org teams used by the asset ownership-chain dropdown.
from .routers import teams_router


from .routers.admin_router import router as admin_router
from .modules.erm import erm_router
from .modules.governance import governance_module_router
from .modules.framework_upload import framework_upload_router
from .modules.compliance import compliance_router
from .modules.evidence import evidence_module_router
from .modules.control_library import control_library_router
from .modules.framework_templates import framework_templates_router
from .modules.vuln_management import vuln_management_router
from .modules.chatbot import (
    chatbot_router,
    start_complychat_embedding_worker,
    stop_complychat_embedding_worker,
)
from .modules.vendor_risk import vendor_risk_router
from .modules.auditor_portal import auditor_portal_router
from .modules.workflow_engine import (
    workflow_engine_router,
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)
from .modules.integrations import integrations_router, cloud_connectors_router
from .modules.issue_management import issue_management_router
# CIS integration (Phase 3 of the integration handoff) — new product surfaces:
#   * agents_router            — agent enroll / heartbeat / jobs / results
#   * agent_downloads_router   — public installer + GPO downloads
#   * risk_posture_router      — composite per-asset risk score + weights
#   * onboarding_router        — CIDR bulk discovery + import
#   * compliance_plugins_router — CIS plugin library + per-asset runs
#   * connect_wizard_router    — agentless first-connection wizard
from .modules.agents import agents_router, agent_downloads_router
from .modules.risk_posture import risk_posture_router
from .modules.onboarding import onboarding_router
from .modules.compliance_plugins import compliance_plugins_router
from .routers.connect_wizard_router import router as connect_wizard_router
from .routers.access_review_router import router as access_review_router
from .routers.ai_recommendations_router import router as ai_recommendations_router
from .middleware.subdomain import TenantMiddleware

app = FastAPI(
    title="Enterprise GRC Platform API's",
    description="Enterprise Governance, Risk, and Compliance platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

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

app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)

app.add_middleware(TenantMiddleware)


@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    if not should_audit_request(request):
        return await call_next(request)

    import time
    import json as _json
    from starlette.concurrency import iterate_in_threadpool
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
        response_error = None
        try:
            status = getattr(response, "status_code", 200)
            ctype = response.headers.get("content-type", "") if hasattr(response, "headers") else ""
            if status >= 400 and "application/json" in ctype.lower():
                body_chunks = [chunk async for chunk in response.body_iterator]
                joined = b"".join(body_chunks)
                if len(joined) <= 16 * 1024:
                    try:
                        response_error = _json.loads(joined.decode("utf-8"))
                    except Exception:
                        response_error = {"raw": joined.decode("utf-8", errors="replace")[:2000]}
                else:
                    response_error = {"truncated": True, "size": len(joined)}
                # Re-attach the body iterator so the client still gets the response.
                response.body_iterator = iterate_in_threadpool(iter([joined]))
        except Exception:
            response_error = None

        write_audit_log(request, response, started_at, request_payload, response_error)
        return response
    except Exception:
        write_audit_log(request, Response(status_code=500), started_at, request_payload)
        raise

# NCA routers MUST register BEFORE risks_router and vuln_management_router
# because those expose parametric `/risks/{risk_id}` and `/vulnerabilities/{vuln_id}`
# routes that would otherwise capture `/risks/nca` and `/vulnerabilities/nca`
# and try to parse "nca" as an int (→ 422 Unprocessable Entity).
app.include_router(nca_risk_router)
app.include_router(nca_vuln_router)
app.include_router(nca_container_router)
app.include_router(nca_templates_router)
app.include_router(reference_laws_router)
app.include_router(nca_kpi_router)
app.include_router(criticality_assessments_router.router)

app.include_router(auth_router)
app.include_router(sso_router)
app.include_router(entra_router)
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
app.include_router(ai_risk_assessment_router)
app.include_router(ai_recommendations_router)
app.include_router(compliance_assessments_router)
app.include_router(artifacts_router)
app.include_router(dcc_router)
app.include_router(audit_plan_router)
app.include_router(critical_tasks_router)
app.include_router(issue_management_router)
app.include_router(is_projects_router)
app.include_router(tasks_router)
app.include_router(erm_router)
app.include_router(governance_module_router)
app.include_router(framework_upload_router)
app.include_router(compliance_router)
app.include_router(evidence_module_router)
app.include_router(control_library_router)
app.include_router(framework_templates_router)
app.include_router(vuln_management_router)
app.include_router(chatbot_router)
app.include_router(vendor_risk_router)
app.include_router(auditor_portal_router)
app.include_router(workflow_engine_router)
app.include_router(integrations_router)
# Track A / Phase 7 — Cloud connector framework. Lives at `/cloud-connectors`
# so it doesn't collide with the existing `/integrations` Nessus/Nexpose
# routes; the legacy connections page keeps working unchanged.
app.include_router(cloud_connectors_router)
# External-connector framework (Ticketing / SIEM / Pen-test / Collab /
# Transcribe). Lives at `/connectors` alongside `/cloud-connectors` and
# the legacy `/integrations` vuln-scanner routes; each surface owns its
# own provider catalogue and credential storage.
from .modules.connectors.router import router as connectors_router  # noqa: E402
app.include_router(connectors_router)
# Phase 9 — cross-domain power search + exception-aging analytics.
app.include_router(search_router)
# Teams — admin CRUD for org teams + asset owning-team dropdown.
app.include_router(teams_router)

# CIS integration routers — additive only; existing routes unchanged.
app.include_router(agents_router)
app.include_router(agent_downloads_router)
app.include_router(risk_posture_router)
app.include_router(onboarding_router)
app.include_router(compliance_plugins_router)
app.include_router(connect_wizard_router)
app.include_router(access_review_router)


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
