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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
