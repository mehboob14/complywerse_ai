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
    """Build the canonical backend URL the agent installer should
    phone home to. Resolution order:

      1. COMPLYVERSE_BACKEND_URL env var — set this in production to
         the public URL (e.g. https://grc.bank.com). Always wins.
      2. X-Forwarded-Host (+ X-Forwarded-Proto) — reverse-proxy
         deployments behind nginx / a CDN.
      3. Fallback: host from request Host header + port from
         scope["server"] (uvicorn's actual bind). Port from Host
         header is the proxy's port in dev, not what the agent should
         target.

    Production deploys MUST set COMPLYVERSE_BACKEND_URL.
    """
    env_url = (os.environ.get("COMPLYVERSE_BACKEND_URL") or "").strip().rstrip("/")
    if env_url:
        return env_url

    xfh = request.headers.get("x-forwarded-host")
    if xfh:
        proto = request.headers.get("x-forwarded-proto") or "https"
        return f"{proto}://{xfh}"

    host_hdr = request.headers.get("host") or ""
    host_only = host_hdr.split(":")[0] if host_hdr else "localhost"
    server = request.scope.get("server") or (None, None)
    bind_port = server[1] or 4000
    proto = "http"
    return f"{proto}://{host_only}:{bind_port}"


# ───────────────────────────────────────────────────────────────────────
# Python-direct install path (DEV — bypasses NSIS .exe)
# ───────────────────────────────────────────────────────────────────────
# The production install path packages the agent into a signed NSIS .exe
# (build.ps1 in backend/agent/packaging/windows). That requires NSIS,
# signtool, etc. — too much for a dev box.
#
# This zipapp endpoint serves the same Python agent module as a single
# .pyz (zipapp) the operator's machine can run directly with
# `python agent.pyz <command>`. install.ps1 prefers this path when
# Python is on PATH and the .exe doesn't exist.


def _build_agent_zipapp() -> bytes:
    """Zip up backend/agent/complyverse_agent/ into a Python zipapp.

    Cached in-process at module-load — the agent source rarely changes
    in dev, and rebuilding on every download adds 50-100ms per request.
    Call _invalidate_zipapp_cache() to force a rebuild (or restart
    uvicorn — autoreload picks up source changes anyway).
    """
    import io
    import zipfile

    pkg_root = (Path(__file__).resolve().parents[3]
                / "agent" / "complyverse_agent")
    if not pkg_root.exists():
        raise HTTPException(
            500,
            f"Agent source not found at {pkg_root}. "
            "Operator: ensure backend/agent/complyverse_agent/ is committed."
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # The zipapp entrypoint — runs `python -m complyverse_agent ...`
        zf.writestr("__main__.py", "from complyverse_agent.__main__ import main\nmain()\n")
        for f in pkg_root.rglob("*.py"):
            rel = f.relative_to(pkg_root.parent)  # → complyverse_agent/...
            zf.write(f, arcname=str(rel).replace("\\", "/"))
    buf.seek(0)
    return buf.getvalue()


_ZIPAPP_CACHE: dict[str, bytes] = {}


@router.get("/agent.pyz")
def download_agent_pyz():
    """Return the agent as a single Python zipapp.

    Operator on the target machine:
        Invoke-WebRequest 'http://backend/grc/agent/agent.pyz' -OutFile agent.pyz
        python agent.pyz enroll --backend http://backend --token enroll_xxx
        python agent.pyz run    # background loop
    """
    from fastapi.responses import Response
    if "data" not in _ZIPAPP_CACHE:
        _ZIPAPP_CACHE["data"] = _build_agent_zipapp()
    return Response(
        content=_ZIPAPP_CACHE["data"],
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="complyverse-agent.pyz"',
            "X-Agent-Mode": "python-zipapp",
        },
    )


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
    # Two install paths, tried in order:
    #   1. Python-direct (no NSIS) - download agent.pyz, run with system
    #      Python. Works on any dev box with Python on PATH.
    #   2. NSIS .exe - production path. Only kicks in if Python isn't
    #      on PATH.
    # IMPORTANT: this PS1 script is downloaded by Invoke-WebRequest
    # which writes bytes to disk; PowerShell then reads it with the
    # system codepage (cp1252 on en-US Windows). Any non-ASCII char
    # (em-dash, smart quotes, box-drawing) gets mojibake-mangled and
    # breaks the parser. Keep this template ASCII-only.
    script = f"""# Compliverse Agent - one-line installer wrapper
# Auto-generated by the cloud for token: {token[:18]}...
$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:ProgramData 'Compliverse'
$null = New-Item -ItemType Directory -Force -Path $installDir

$pyzPath = Join-Path $installDir 'complyverse-agent.pyz'

# Path A: Python-direct (preferred on dev boxes)
# Try multiple candidates and verify each actually runs - venv shims
# sometimes point at deleted Python installs and segfault.
function Find-WorkingPython {{
    $candidates = @()
    # 1. py launcher with explicit version preferences
    $py = (Get-Command py -ErrorAction SilentlyContinue).Path
    if ($py) {{
        foreach ($ver in @('-3.11', '-3.12', '-3.13', '-3.10', '-3')) {{
            $candidates += ,@($py, $ver)
        }}
    }}
    # 2. Standard install locations
    foreach ($p in @(
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "C:\Python311\python.exe", "C:\Python312\python.exe",
        "C:\Python310\python.exe", "C:\Python313\python.exe"
    )) {{
        if (Test-Path $p) {{ $candidates += ,@($p) }}
    }}
    # 3. python on PATH (last resort - might be a broken venv shim)
    $px = (Get-Command python -ErrorAction SilentlyContinue).Path
    if ($px) {{ $candidates += ,@($px) }}

    foreach ($c in $candidates) {{
        $exe = $c[0]
        $args = if ($c.Count -gt 1) {{ @($c[1], '--version') }} else {{ @('--version') }}
        try {{
            $out = & $exe @args 2>&1
            if ($LASTEXITCODE -eq 0 -and $out -match 'Python 3\.\d+') {{
                if ($c.Count -gt 1) {{
                    return @{{ Exe = $exe; PreArg = $c[1] }}
                }} else {{
                    return @{{ Exe = $exe; PreArg = $null }}
                }}
            }}
        }} catch {{ continue }}
    }}
    return $null
}}

$pyInfo = Find-WorkingPython
if ($pyInfo) {{ $python = $pyInfo.Exe; $pyPreArg = $pyInfo.PreArg }} else {{ $python = $null; $pyPreArg = $null }}

if ($python) {{
    Write-Host "==> Python found at $python - using Python-direct install"
    Write-Host "==> Downloading agent zipapp from {backend_url}..."
    try {{
        Invoke-WebRequest -Uri '{backend_url}/grc/agent/agent.pyz' -OutFile $pyzPath -UseBasicParsing
    }} catch {{
        Write-Host "==> ERROR downloading agent.pyz: $($_.Exception.Message)"
        exit 4
    }}
    Write-Host "==> Enrolling agent against {backend_url}"
    if ($pyPreArg) {{
        & $python $pyPreArg $pyzPath enroll --backend '{backend_url}' --token '{token}'
    }} else {{
        & $python $pyzPath enroll --backend '{backend_url}' --token '{token}'
    }}
    if ($LASTEXITCODE -ne 0) {{
        Write-Host "==> Enrollment failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }}
    Write-Host "==> Agent enrolled. Start heartbeat loop with:"
    if ($pyPreArg) {{ Write-Host "    $python $pyPreArg $pyzPath run" }} else {{ Write-Host "    $python $pyzPath run" }}
    Write-Host "==> Or install as a Windows service:"
    if ($pyPreArg) {{ Write-Host "    $python $pyPreArg $pyzPath service install" }} else {{ Write-Host "    $python $pyzPath service install" }}
    exit 0
}}

# Path B: NSIS .exe fallback (production / Python-less hosts)
Write-Host "==> Python not on PATH - falling back to .exe installer"
$tempExe = Join-Path $env:TEMP 'ComplyverseAgent-Setup.exe'
Write-Host "==> Downloading agent installer from {backend_url}..."
Invoke-WebRequest -Uri '{backend_url}/grc/agent/install.exe' -OutFile $tempExe -UseBasicParsing
Write-Host "==> Running silent install"
$p = Start-Process -FilePath $tempExe -ArgumentList '/S','/TOKEN={token}','/BACKEND={backend_url}' -Wait -PassThru
if ($p.ExitCode -eq 0) {{
    Write-Host "==> Agent installed successfully."
}} else {{
    Write-Host "==> Installer exited with code $($p.ExitCode)."
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
    curl -sSL '{backend_url}/grc/agent/install.deb' -o "$TMP_DEB"
elif command -v wget >/dev/null 2>&1; then
    wget -q '{backend_url}/grc/agent/install.deb' -O "$TMP_DEB"
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
