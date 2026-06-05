import os
from dotenv import load_dotenv

# Load environment variables from .env file FIRST
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from grc.main import app as grc_app
from grc.models import init_grc_db
from grc.modules.workflow_engine import (
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)

app = FastAPI(title="ComplyVerse GRC Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    init_grc_db()
    # Workflow runtime: embedded by default for local dev. Set
    # DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1 to disable when running the
    # external workflow_watcher process (or with a shared Redis queue).
    _disable_wf = os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower()
    print(f"[WF] on_startup (outer): DISABLE_EMBEDDED_WORKFLOW_RUNTIME={_disable_wf!r}", flush=True)
    if _disable_wf not in ("1", "true", "yes", "on"):
        try:
            start_workflow_engine_runtime()
            print("[WF] Embedded workflow runtime started.", flush=True)
        except Exception as exc:
            print(f"[WF] start_workflow_engine_runtime failed: {exc}", flush=True)


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
