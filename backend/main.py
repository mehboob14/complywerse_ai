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
