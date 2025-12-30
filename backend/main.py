from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from router import router
from models import init_db
from seed_data import seed_database

app = FastAPI(title="PCI DSS Lifecycle API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def on_startup():
    init_db()
    seed_database()


@app.get("/")
def root():
    return {"message": "PCI DSS Lifecycle API", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
