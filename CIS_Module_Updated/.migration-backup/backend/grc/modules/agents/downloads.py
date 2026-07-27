"""Public agent download endpoints.

Senior's "git repo se install karo" ask: cloud must serve the agent
binary + wrapper scripts so bank IT can run `Invoke-WebRequest` or `curl`
on a fresh PC and bootstrap the agent in one line.

Endpoints (all public — no auth header required, but PS1/SH wrappers
require a one-time enrollment token in the query string so randoms can't
silently install agents into a tenant):

  GET /agent/install.exe                    → Windows .exe installer (raw)
  GET /agent/install.ps1?token=enroll_xxx   → PS wrapper: downloads .exe + runs /S /TOKEN=xxx
  GET /agent/install.sh?token=enroll_xxx    → bash wrapper for Linux (downloads .deb + dpkg -i + enroll)
  GET /agent/install.deb                    → Linux .deb (raw)

The binaries are read from disk at request time (no preloading into RAM)
so a `git pull` + rebuild on the cloud side picks up the new artifact
without a process restart.

The wrappers embed the token + backend URL as build-time values, so the
operator only needs to copy-paste a single line.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse

logger = logging.getLogger(__name__)

# Standalone router — mounted at /agent (NOT under /agents) so the
# download URLs match the install commands we hand operators:
# https://tenant.compliverse.app/agent/install.exe
router = APIRouter(prefix="/agent", tags=["Agent downloads"])


# Where to look for the built artifacts. Configurable via env so the
# real prod build can shove them on a CDN volume.
_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_EXE_PATH = _BACKEND_ROOT / "agent" / "packaging" / "windows" / "ComplyverseAgent-Setup-1.0.0.exe"
_DEFAULT_DEB_PATH = _BACKEND_ROOT / "agent" / "packaging" / "linux" / "bin" / "complyverse-agent_1.0.0_all.deb"
_DEFAULT_GPO_PATH = _BACKEND_ROOT / "agent" / "packaging" / "deploy_templates" / "gpo" / "Deploy-ComplyverseAgent.ps1"


def _exe_path() -> Path:
    return Path(os.environ.get("COMPLYVERSE_AGENT_EXE_PATH", str(_DEFAULT_EXE_PATH)))


def _deb_path() -> Path:
    return Path(os.environ.get("COMPLYVERSE_AGENT_DEB_PATH", str(_DEFAULT_DEB_PATH)))


def _backend_url_from_request(request: Request) -> str:
    """Build the canonical backend URL from the incoming request.

    Banks behind a load balancer / reverse proxy will hit us via a
    public hostname like `https://tenant.compliverse.app`. We use the
    `X-Forwarded-Host` / `X-Forwarded-Proto` headers if present (set by
    the proxy), otherwise fall back to the raw request scheme + host.
    """
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost:5000"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    return f"{proto}://{host}"


@router.get("/install.exe")
def download_exe():
    """Stream the Windows NSIS installer.

    Operator usage on the target machine:
        Invoke-WebRequest 'https://tenant.compliverse.app/agent/install.exe' -OutFile setup.exe
        .\\setup.exe /S /TOKEN=enroll_xxx /BACKEND=https://tenant.compliverse.app
    """
    p = _exe_path()
    if not p.exists():
        raise HTTPException(
            404,
            "Agent .exe not built on this deploy. Operator: run "
            "`backend/agent/packaging/windows/build.ps1` then retry.",
        )
    return FileResponse(
        path=str(p),
        media_type="application/vnd.microsoft.portable-executable",
        filename="ComplyverseAgent-Setup-1.0.0.exe",
    )


@router.get("/deploy-gpo.ps1", response_class=PlainTextResponse)
def download_gpo_script(request: Request):
    """Serve the AD Group Policy mass-deploy script.

    Operator workflow:
      1. Click "Download GPO script" in the wizard after bulk-enroll
      2. Drop both the .exe AND the CSV on \\fileserver\compliverse\
      3. Point a Computer-Configuration Startup script policy at this PS1
      4. On next reboot each PC reads its hostname row from the CSV, runs
         the silent installer with that token, and the agent comes online.

    We patch the placeholder backend URL with whatever the request hit us
    on so the script "just works" without the operator editing it.
    """
    p = Path(os.environ.get("COMPLYVERSE_AGENT_GPO_PATH", str(_DEFAULT_GPO_PATH)))
    if not p.exists():
        raise HTTPException(
            404,
            "GPO deploy script not present on this deploy. Operator: ensure "
            "`backend/agent/packaging/deploy_templates/gpo/Deploy-ComplyverseAgent.ps1` "
            "is committed to the repo.",
        )
    script = p.read_text(encoding="utf-8")
    backend_url = _backend_url_from_request(request)
    # The template uses your-tenant.compliverse.app as a stand-in so it
    # always reads. Swap to whatever public hostname this request used.
    script = script.replace("https://your-tenant.compliverse.app", backend_url)
    return PlainTextResponse(script, media_type="text/x-powershell; charset=utf-8")


@router.get("/install.deb")
def download_deb():
    """Stream the Linux .deb package."""
    p = _deb_path()
    if not p.exists():
        raise HTTPException(
            404,
            "Agent .deb not built on this deploy. Operator: rebuild via "
            "`packaging/linux` and retry.",
        )
    return FileResponse(
        path=str(p),
        media_type="application/vnd.debian.binary-package",
        filename="complyverse-agent_1.0.0_all.deb",
    )


@router.get("/install.ps1", response_class=PlainTextResponse)
def install_ps1(
    request: Request,
    token: str = Query(..., min_length=8, max_length=200, regex=r"^enroll_[a-f0-9]+$"),
):
    """One-line PowerShell wrapper.

    Operator usage (single line, paste into Admin PowerShell on target):
        iex (irm 'https://tenant.compliverse.app/agent/install.ps1?token=enroll_xxx')

    The wrapper:
      1. Downloads install.exe into %TEMP%
      2. Runs it silently with /S /TOKEN=<this token> /BACKEND=<this cloud URL>
      3. Cleans up the temp file
    """
    backend_url = _backend_url_from_request(request)
    script = f"""# Compliverse Agent — one-line installer wrapper
# Auto-generated by the cloud for token: {token[:18]}...
$ErrorActionPreference = 'Stop'
$tempExe = "$env:TEMP\\ComplyverseAgent-Setup.exe"
Write-Host "==> Downloading agent installer from {backend_url}..."
Invoke-WebRequest -Uri '{backend_url}/agent/install.exe' -OutFile $tempExe -UseBasicParsing
Write-Host "==> Running silent install (token={token[:14]}..., backend={backend_url})..."
$p = Start-Process -FilePath $tempExe -ArgumentList '/S','/TOKEN={token}','/BACKEND={backend_url}' -Wait -PassThru
if ($p.ExitCode -eq 0) {{
    Write-Host "==> Agent installed successfully."
}} else {{
    Write-Host "==> Installer exited with code $($p.ExitCode). Check %SystemRoot%\\Temp for logs."
    exit $p.ExitCode
}}
Remove-Item $tempExe -ErrorAction SilentlyContinue
"""
    return PlainTextResponse(script, media_type="text/plain; charset=utf-8")


@router.get("/install.sh", response_class=PlainTextResponse)
def install_sh(
    request: Request,
    token: str = Query(..., min_length=8, max_length=200, regex=r"^enroll_[a-f0-9]+$"),
):
    """One-line bash wrapper.

    Operator usage (single line, paste into root shell on target):
        curl -sSL 'https://tenant.compliverse.app/agent/install.sh?token=enroll_xxx' | sudo bash
    """
    backend_url = _backend_url_from_request(request)
    script = f"""#!/bin/sh
# Compliverse Agent — one-line installer wrapper
# Auto-generated by the cloud for token: {token[:18]}...
set -e
TMP_DEB=$(mktemp /tmp/complyverse-agent-XXXXXX.deb)
echo "==> Downloading agent .deb from {backend_url}..."
if command -v curl >/dev/null 2>&1; then
    curl -sSL '{backend_url}/agent/install.deb' -o "$TMP_DEB"
elif command -v wget >/dev/null 2>&1; then
    wget -q '{backend_url}/agent/install.deb' -O "$TMP_DEB"
else
    echo "==> ERROR: neither curl nor wget installed. Install one and retry."
    exit 1
fi
echo "==> Installing .deb..."
dpkg -i "$TMP_DEB" || apt-get install -f -y
rm -f "$TMP_DEB"
echo "==> Enrolling agent..."
sudo -u complyverse /opt/complyverse-agent/bin/complyverse-agent enroll \\
    --backend '{backend_url}' --token '{token}'
echo "==> Starting service..."
systemctl enable --now complyverse-agent
echo "==> Agent installed + enrolled. Check: systemctl status complyverse-agent"
"""
    return PlainTextResponse(script, media_type="text/x-shellscript; charset=utf-8")
