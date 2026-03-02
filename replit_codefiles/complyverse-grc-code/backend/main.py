from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from router import router
from models import init_db
from seed_data import seed_database
from grc.main import app as grc_app
from grc.models import init_grc_db
import os

app = FastAPI(title="PCI DSS Lifecycle API", version="1.0.0")

frontend_origins = [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://0.0.0.0:5000",
]
replit_domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
if replit_domain:
    frontend_origins.append(f"https://{replit_domain}")
replit_domains_env = os.environ.get("REPLIT_DOMAINS", "")
if replit_domains_env:
    for d in replit_domains_env.split(","):
        d = d.strip()
        if d:
            frontend_origins.append(f"https://{d}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

app.mount("/grc", grc_app)

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.on_event("startup")
def on_startup():
    init_db()
    seed_database()
    init_grc_db()


@app.get("/")
def root():
    return {"message": "PCI DSS Lifecycle API", "version": "1.0.0", "grc_api": "/grc"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
