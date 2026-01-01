from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .models import init_grc_db
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
    certification_router,
    advanced_erm_router
)

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

app.include_router(auth_router)
app.include_router(tenants_router)
app.include_router(frameworks_router)
app.include_router(controls_router)
app.include_router(evidence_router)
app.include_router(risks_router)
app.include_router(governance_router)
app.include_router(documents_router)
app.include_router(assets_router)
app.include_router(dashboard_router)
app.include_router(certification_router)
app.include_router(advanced_erm_router)


@app.on_event("startup")
def on_startup():
    init_grc_db()


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
            "advanced-erm"
        ]
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}
