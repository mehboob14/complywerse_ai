#!/bin/bash
set -e

# Install Node.js dependencies
pnpm install --frozen-lockfile

# NOTE: Database schema is managed entirely by the Python FastAPI backend
# via SQLAlchemy (init_grc_db). Do NOT run drizzle-kit push here — the
# lib/db Drizzle schema is empty and pushing it would drop all GRC tables.
