# Frontend (Next.js 14) — staging image, multi-stage to keep runner small.

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install deps first so the layer caches across code changes.
COPY package.json package-lock.json* ./
RUN npm ci

# Build with public env baked in at compile time. Anything the browser
# needs (NEXT_PUBLIC_*) must be available now, not at runtime. The same
# applies to next.config.js rewrites: Next.js evaluates them at build
# time and stores the resolved destinations in routes-manifest.json, so
# the *server-side* BACKEND_URL must also be available here — otherwise
# the rewrite falls back to NEXT_PUBLIC_BACKEND_URL and loops the proxy
# back through the public port.
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG BACKEND_URL=http://backend:4000
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    BACKEND_URL=${BACKEND_URL}

COPY . .
RUN npm run build

# ---- runner ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Re-install prod-only deps so node_modules is lean.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the built app from the builder stage.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js

# Runtime entrypoint: rewrites the `routes-manifest.json` destination so
# the /api/* proxy points at the backend service name on the Docker
# network, regardless of what was baked at build time. Next.js evaluates
# rewrites destinations at request time (the manifest is just a config
# file), so this is safe to run on every container start.
COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
MANIFEST=/app/.next/routes-manifest.json
TARGET="${BACKEND_URL:-http://backend:4000}"
if [ -f "$MANIFEST" ]; then
  # Replace any pre-baked http(s)://host:port prefix that's followed by
  # /grc/ with the runtime BACKEND_URL value. Matches both the docker
  # service name we want AND any leaked NEXT_PUBLIC_BACKEND_URL value.
  sed -i -E "s|https?://[^\"/]+/grc/|${TARGET}/grc/|g" "$MANIFEST"
  echo "[entrypoint] routes-manifest patched: /api/* -> ${TARGET}/grc/*"
fi
exec npm start
EOF
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
