# Backend (FastAPI / uvicorn) — staging image
# Single-stage; the app is ~all-Python so a builder stage adds little.
FROM python:3.11-slim

# psycopg2-binary (and a few other wheels) need libpq + build basics.
# tini gives us a proper PID-1 for clean signal handling.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential libpq-dev curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so the layer caches across code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Then copy the app code.
COPY . .

# uploads/ is written at runtime; mount a named volume on top of it in compose.
RUN mkdir -p /app/uploads /app/static

EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4000", "--workers", "2", "--proxy-headers"]
