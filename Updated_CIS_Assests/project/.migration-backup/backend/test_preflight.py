"""Prove the live pre-flight catches bad credentials in the wizard handshake.

Three scenarios:
  1. Good credentials  → handshake succeeds (200), connection saved.
  2. Wrong password    → handshake returns 400 with a clear hint.
  3. Wrong hostname    → handshake returns 400 (network_unreachable).
"""
from __future__ import annotations
import os, secrets, time, json
import jwt, requests

SESSION_SECRET = "dev-local-session-secret-change-me-9f8a4c2b1e7d6f3a5b8c"
BASE = "http://localhost:5000/grc"


def mint_token(tenant_id: int = 1, platform: str = "windows") -> str:
    nonce = secrets.token_urlsafe(16)
    now = int(time.time())
    return jwt.encode({
        "tenant_id": tenant_id, "user_id": 1, "platform": platform,
        "nonce": nonce, "iat": now, "exp": now + 600,
    }, SESSION_SECRET, algorithm="HS256")


def handshake(label: str, hostname: str, username: str, password: str) -> tuple[int, dict]:
    body = {
        "tenant_token": mint_token(),
        "hostname": hostname,
        "display_label": label,
        "os_name": "Windows",
        "winrm_endpoint": f"https://{hostname}:5986/wsman",
        "service_account": username,
        "agent_password": password,
    }
    r = requests.post(f"{BASE}/connect-wizard/handshake", json=body, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {"raw": r.text[:300]}
    return r.status_code, data


print("=" * 60)
print("Scenario 1: Good credentials (real password)")
print("=" * 60)
code, data = handshake("Preflight OK Test", "DESKTOP-CE3EFJB",
                        "compliverse_scanner", "ScannerSvc!2026")
print(f"HTTP {code}")
print(json.dumps(data, indent=2))
print()

print("=" * 60)
print("Scenario 2: Wrong password (should be rejected with code=auth_failed)")
print("=" * 60)
code, data = handshake("Preflight Bad Pwd Test", "DESKTOP-CE3EFJB",
                        "compliverse_scanner", "WRONG_PASSWORD_12345")
print(f"HTTP {code}")
print(json.dumps(data, indent=2))
print()

print("=" * 60)
print("Scenario 3: Wrong hostname (should be rejected with code=network_unreachable)")
print("=" * 60)
code, data = handshake("Preflight Bad Host Test", "nonexistent-host-9999.local",
                        "compliverse_scanner", "ScannerSvc!2026")
print(f"HTTP {code}")
print(json.dumps(data, indent=2))
