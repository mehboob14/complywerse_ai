from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/test")
def test():
    return {"status": "ok"}

@app.get("/grc/auth/login")
def login():
    return {"message": "login endpoint"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4000)
