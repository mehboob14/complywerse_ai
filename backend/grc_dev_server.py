"""Local dev launcher — serves the GRC app under the /grc prefix.

The Next.js frontend rewrites /api/* -> http://127.0.0.1:4000/grc/* (see
grc-frontend/next.config.js), so for local development the backend must answer
under /grc. The application routes are mounted at root in grc/main.py; this thin
wrapper mounts that app at /grc so the proxy resolves without touching app code.

Run from the backend/ directory:
    python -m uvicorn grc_dev_server:application --host 127.0.0.1 --port 4000
"""
from fastapi import FastAPI

from grc.main import app as _inner

application = FastAPI(title="GRC dev /grc mount")
application.mount("/grc", _inner)


@application.get("/health")
def _health():
    return {"status": "ok", "mounted": "/grc"}
