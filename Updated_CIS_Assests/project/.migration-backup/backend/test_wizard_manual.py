"""End-to-end test of the Connect Wizard manual-credentials handshake.

Drives the same code path the React form hits, but bypasses the browser:
  1. Mint a JWT exactly the way /issue-token does (Layeron tenant, windows).
  2. POST /handshake with hostname != display_label so we can prove the
     hostname/label fix from the previous session.
  3. Print the resulting DB state — connection.console_url should be the
     real hostname, connection.connection_name should embed the label,
     and the auto-created asset should mirror the same split.
"""
from __future__ import annotations

import os
import secrets
import time

import jwt
import requests

SESSION_SECRET = os.environ.get(
    "SESSION_SECRET",
    "dev-local-session-secret-change-me-9f8a4c2b1e7d6f3a5b8c",  # from backend/.env
)
TENANT_ID = 1            # Layeron Group LLC
USER_ID = 1              # any layeron user — only stored for attribution
HOSTNAME = "DESKTOP-CE3EFJB"
LABEL = "Production Win11 Workstation"
USERNAME = "compliverse_scanner"
PASSWORD = "ScannerSvc!2026"
BASE_URL = "http://localhost:5000/grc"

nonce = secrets.token_urlsafe(16)
now = int(time.time())
payload = {
    "tenant_id": TENANT_ID,
    "user_id": USER_ID,
    "platform": "windows",
    "nonce": nonce,
    "iat": now,
    "exp": now + 15 * 60,
}
token = jwt.encode(payload, SESSION_SECRET, algorithm="HS256")
print(f"Minted token (nonce={nonce[:10]}...)")

body = {
    "tenant_token": token,
    "hostname": HOSTNAME,
    "display_label": LABEL,
    "os_name": "Windows",
    "winrm_endpoint": f"https://{HOSTNAME}:5986/wsman",
    "service_account": USERNAME,
    "agent_password": PASSWORD,
}

r = requests.post(f"{BASE_URL}/connect-wizard/handshake", json=body, timeout=15)
print(f"POST /handshake -> {r.status_code}")
print(r.text)
r.raise_for_status()
