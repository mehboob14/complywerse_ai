import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import Response
from .models import init_grc_db

logger = logging.getLogger(__name__)

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
from .modules.compliance_plugins import compliance_plugins_router
from .modules.risk_posture import risk_posture_router
from .modules.agents import agent_downloads_router, agents_router
from .modules.onboarding import onboarding_router
from .middleware.subdomain import TenantMiddleware

app = FastAPI(
    title="Enterprise GRC Platform API's",
    description="Enterprise Governance, Risk, and Compliance platform",
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

        # For non-2xx JSON responses, capture the error body so the AI summary
        # can show the real failure reason (e.g. validator messages). We must
        # consume the streaming body and re-attach an identical iterator so the
        # client still receives the response.
        response_error = None
        try:
            status = getattr(response, "status_code", 200)
            ctype = response.headers.get("content-type", "") if hasattr(response, "headers") else ""
            if status >= 400 and "application/json" in ctype.lower():
                body_chunks = [chunk async for chunk in response.body_iterator]
                # Cap captured body at 16 KB to avoid bloating audit rows with
                # large error pages.
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
            # Never let response-capture errors break the actual response.
            response_error = None

        write_audit_log(request, response, started_at, request_payload, response_error)
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
app.include_router(compliance_plugins_router)
app.include_router(risk_posture_router)
app.include_router(agents_router)
app.include_router(agent_downloads_router)
app.include_router(onboarding_router)
from grc.routers.connect_wizard_router import router as connect_wizard_router
app.include_router(connect_wizard_router)


@app.on_event("startup")
def on_startup():
    init_grc_db()
    try:
        from .modules.compliance_plugins.seed import seed_compliance_plugins
        seed_compliance_plugins()
    except Exception as exc:
        logger.warning(f"seed_compliance_plugins failed: {exc}")
    # Workflow runtime: embedded by default for local dev. Set
    # DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1 in production where a separate
    # workflow_watcher process is running (or a shared queue like Redis is
    # configured), to avoid dual-execution.
    _disable_wf = os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower()
    print(f"[WF] on_startup: DISABLE_EMBEDDED_WORKFLOW_RUNTIME={_disable_wf!r}", flush=True)
    if _disable_wf not in ("1", "true", "yes", "on"):
        try:
            start_workflow_engine_runtime()
            print("[WF] Embedded workflow runtime started (local dev mode).", flush=True)
            logger.info("[WF] Embedded workflow runtime started (local dev mode).")
        except Exception as exc:
            print(f"[WF] start_workflow_engine_runtime failed: {exc}", flush=True)
            logger.warning(f"start_workflow_engine_runtime failed: {exc}")
    else:
        print(f"[WF] Embedded runtime DISABLED by env var.", flush=True)

    _disable_complychat_embedding_worker = os.getenv("DISABLE_COMPLYCHAT_EMBED_WORKER", "").strip().lower()
    _embed_worker_autostart = os.getenv("COMPLYCHAT_EMBED_WORKER_AUTOSTART", "true").strip().lower()
    if _disable_complychat_embedding_worker not in ("1", "true", "yes", "on") and _embed_worker_autostart in ("1", "true", "yes", "on"):
        start_complychat_embedding_worker()

    openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
    if openai_key:
        logger.info("[AI] OPENAI_API_KEY is set — AI features ENABLED (policy generation, risk recommendations, compliance gap analysis, ComplyChatBot)")
    else:
        logger.warning("[AI] OPENAI_API_KEY not found in environment variables! AI features are DISABLED. Set the OPENAI_API_KEY secret to enable policy generation, risk recommendations, compliance gap analysis, and ComplyChatBot.")


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
    openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
    return {
        "status": "healthy",
        "ai_features": "enabled" if openai_key else "disabled",
    }
