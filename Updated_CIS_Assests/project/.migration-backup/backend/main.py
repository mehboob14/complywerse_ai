import os
from dotenv import load_dotenv

# Load environment variables from .env file FIRST
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from grc.main import app as grc_app
from grc.models import init_grc_db
from grc.modules.workflow_engine import (
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)

app = FastAPI(title="ComplyVerse GRC Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/grc", grc_app)

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)


@app.on_event("startup")
def on_startup():
    init_grc_db()
    # Workflow runtime: embedded by default for local dev. Set
    # DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1 to disable when running the
    # external workflow_watcher process (or with a shared Redis queue).
    _disable_wf = os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower()
    print(f"[WF] on_startup (outer): DISABLE_EMBEDDED_WORKFLOW_RUNTIME={_disable_wf!r}", flush=True)
    if _disable_wf not in ("1", "true", "yes", "on"):
        try:
            start_workflow_engine_runtime()
            print("[WF] Embedded workflow runtime started.", flush=True)
        except Exception as exc:
            print(f"[WF] start_workflow_engine_runtime failed: {exc}", flush=True)

    # ── Orphan scan reaper ──────────────────────────────────────────
    # Per Hassan: closes the last 0.2% gap on scan-result integrity. If
    # the backend is killed mid-scan (Ctrl-C, kubectl rollout, crash),
    # the in-flight run rows are written as status='running' but never
    # get their terminal verdict. Without this they stay stuck forever,
    # silently invisible to the operator on /admin/overview's pass-rate
    # math.
    #
    # On every backend boot we mark any 'running' row older than 30
    # minutes as status='error' with error_message='scanner_orphaned'
    # so the row reaches a terminal verdict and the operator can see
    # which scans were dropped. 30 min is well past any legitimate
    # scan duration (longest CIS rule runs ~10s incl. WinRM RTT) but
    # short enough that the orphan list never grows unbounded.
    try:
        from sqlalchemy import text as _sa_text
        from grc.models import SessionLocal as _SessionLocal
        _s = _SessionLocal()
        try:
            n = _s.execute(_sa_text(
                """
                UPDATE grc_compliance_plugin_runs
                SET status = 'error',
                    completed_at = COALESCE(completed_at, now()),
                    error_message = COALESCE(
                        error_message,
                        'scanner_orphaned: backend restarted mid-scan; '
                        'this run never received a terminal verdict from '
                        'the runner. No retry was performed automatically.'
                    ),
                    duration_ms = COALESCE(
                        duration_ms,
                        CAST(EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS INTEGER)
                    )
                WHERE status = 'running'
                  AND started_at < now() - interval '30 minutes'
                """
            )).rowcount or 0
            _s.commit()
            if n:
                print(f"[reaper] marked {n} orphaned 'running' run(s) as 'error'",
                      flush=True)
        finally:
            _s.close()
    except Exception as exc:  # noqa: BLE001
        # Reaper failure must NOT prevent the API from starting up. Log
        # loudly so a developer can investigate but keep serving.
        print(f"[reaper] failed (continuing): {exc}", flush=True)


@app.on_event("shutdown")
def on_shutdown():
    stop_workflow_engine_runtime()


@app.get("/")
def root():
    return {
        "message": "ComplyVerse GRC Platform API",
        "version": "1.0.0",
        "docs": "/grc/docs",
        "health": "/grc/health"
    }


# ─── Agent installer downloads (stubs for demo) ──────────────────────────
# Real builds are produced by a separate pipeline (signed MSI, notarised
# PKG, etc.) and shipped to a CDN. Until that's wired, these endpoints
# return a small text placeholder so the download buttons in the UI don't
# 404 during product demos. The placeholder includes the canonical install
# command and contact for the real binary.
from pathlib import Path
from fastapi.responses import Response, PlainTextResponse


def _stub_installer(platform: str, filename: str) -> Response:
    body = (
        f"# Compliverse Agent installer — {platform} ({filename})\n"
        f"# DEMO PLACEHOLDER\n"
        f"#\n"
        f"# The real signed binary is produced by the agent build pipeline\n"
        f"# and is not bundled with the GRC backend repository. For the\n"
        f"# production installer, contact your Compliverse onboarding rep\n"
        f"# or use the enrollment token from /admin/agents to register a\n"
        f"# host that already has the agent installed.\n"
        f"#\n"
        f"# Tracked at: COMPLYVERSE-AGENT-DIST.\n"
    )
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_AGENT_PAYLOAD_DIR = Path(__file__).resolve().parent / "agent_payloads"




def _detect_lan_ip() -> str:
    """Best-effort LAN IP discovery. The installer is downloaded onto a
    *different* machine than the backend, so a baked-in `localhost` URL
    would point the colleague's PC at itself and fail. Open a UDP socket
    to a public address (no packets actually sent) — the kernel picks the
    outbound interface, whose source IP is the reachable LAN address."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


def _backend_origin_for_agent(
    request_host: str | None = None,
    forwarded_proto: str | None = None,
) -> str:
    """Resolve the backend URL the installer should bake into agents.

    Order:
      1. ``COMPLYVERSE_PUBLIC_URL`` env var (proper prod config).
      2. Detect from the request Host header — but pick the right scheme:
           - X-Forwarded-Proto header (sent by nginx / cloudflare / ELB),
             OR
           - request.url.scheme,
           - default to http for LAN IPs.
      3. LAN IP probe (last resort for dev).
    """
    # 1) Explicit env override wins (prod/cloud deployment).
    explicit = os.environ.get("COMPLYVERSE_PUBLIC_URL")
    if explicit:
        return explicit.rstrip("/")
    # 2) If the download request reached us on a non-loopback Host header
    #    (the operator opened the admin UI at https://compliverse.ai or
    #    http://192.168.x.y:5000), keep using that exact host — it's
    #    already proven reachable from the operator's network.
    if request_host:
        host_part = request_host.split(":")[0]
        if host_part and host_part not in ("localhost", "127.0.0.1", "0.0.0.0"):
            # Choose scheme. Most production deployments sit behind a
            # reverse proxy that terminates TLS and forwards plain HTTP
            # internally — in that case the Host header is the public
            # domain but request.url.scheme would say "http". X-Forwarded-
            # Proto is the authoritative public scheme. If neither hints
            # at HTTPS but the host has no port (typical of a public
            # domain), assume HTTPS — operators rarely host bare HTTP on
            # port 80 for an admin UI.
            scheme = (forwarded_proto or "").strip().lower() or None
            if not scheme:
                # If the Host header includes no port, it's almost certainly
                # a public domain on 443. If it includes a port, leave http.
                scheme = "https" if ":" not in request_host else "http"
            return f"{scheme}://{request_host}"
    # 3) Otherwise, discover the LAN IP via outbound interface probe.
    return f"http://{_detect_lan_ip()}:5000"


@grc_app.get("/agent/agent.py", response_class=PlainTextResponse)
def serve_agent_py():
    p = _AGENT_PAYLOAD_DIR / "demo_agent.py"
    if not p.exists():
        return Response("# agent.py not found on backend", status_code=404)
    return Response(
        content=p.read_text(encoding="utf-8"),
        media_type="text/x-python",
        headers={"Content-Disposition": 'attachment; filename="agent.py"'},
    )


# Legacy alias kept so existing automation links don't break.
@grc_app.get("/agent/demo_agent.py", response_class=PlainTextResponse)
def serve_demo_agent_py_legacy():
    return serve_agent_py()


def _windows_install_ps1(base: str) -> str:
    ps = "# Compliverse Agent installer (Windows)\n"
    ps += "# Run as Administrator:\n"
    ps += "#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force\n"
    ps += "#   .\\ComplyverseAgent-setup.ps1 <ENROLLMENT_TOKEN>\n"
    ps += "param([Parameter(Mandatory=$false)][string]$Token)\n"
    ps += "$ErrorActionPreference = 'Stop'\n"
    # ── OS fence ── The Windows installer must ONLY run on Windows.
    # If someone runs it on Linux/macOS (e.g. via PowerShell Core), refuse
    # with a clear message pointing at the right installer.
    ps += "if ([Environment]::OSVersion.Platform -ne 'Win32NT') {\n"
    ps += "    Write-Host '[install] ERROR: this installer is for Windows only.' -ForegroundColor Red\n"
    ps += "    Write-Host '[install] Detected OS:' ([Environment]::OSVersion.Platform)\n"
    ps += "    Write-Host '[install] Use the Linux .sh or macOS .command installer for this host.' -ForegroundColor Yellow\n"
    ps += "    exit 99\n"
    ps += "}\n"
    ps += f"$base = '{base}'\n"
    ps += "$installDir = Join-Path $env:ProgramData 'Compliverse'\n"
    ps += "New-Item -ItemType Directory -Force -Path $installDir | Out-Null\n"
    ps += "$agentPath = Join-Path $installDir 'agent.py'\n"
    ps += "Write-Host \"[install] Fetching agent from $base ...\"\n"
    ps += "Invoke-WebRequest -UseBasicParsing -Uri \"$base/grc/agent/agent.py\" -OutFile $agentPath\n"
    ps += "Write-Host \"[install] Installed to $agentPath\"\n"
    ps += "$py = (Get-Command python -ErrorAction SilentlyContinue).Source\n"
    ps += "if (-not $py) {\n"
    ps += "    Write-Error 'Python 3.8+ not found. Install from https://www.python.org/downloads/ then re-run.'\n"
    ps += "    exit 2\n"
    ps += "}\n"
    ps += "if ($Token) {\n"
    # BUG-FIX: store the enrollment token in a SYSTEM-accessible directory.
    # The scheduled task below runs as the SYSTEM account, which has a
    # different $env:USERPROFILE than the human installing the agent
    # ("C:\\Windows\\System32\\config\\systemprofile"). If we stored the
    # token under the human's profile, the SYSTEM-context agent would
    # never find it → enrollment fails → no heartbeat → row stuck as
    # PENDING forever. ProgramData is readable by SYSTEM by default.
    ps += "    $stateDir = Join-Path $env:ProgramData 'Compliverse'\n"
    ps += "    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null\n"
    ps += "    Set-Content -Path (Join-Path $stateDir 'enrollment.txt') -Value $Token\n"
    ps += "    Write-Host '[install] Enrollment token stored at:' (Join-Path $stateDir 'enrollment.txt')\n"
    ps += "}\n"
    ps += "$taskName = 'ComplyverseAgent'\n"
    # Bake COMPLYVERSE_EXPECT_OS into the scheduled task's environment so
    # the agent self-aborts if someone relocates the binary to a non-Windows
    # box (e.g., copies the install folder over to a Linux VM).
    # DIAGNOSTIC WRAP: run python via cmd with stdout/stderr redirected
    # to a log file. The scheduled task running as SYSTEM has no console,
    # so a Python crash (missing module, syntax error, network refusal)
    # is invisible without this redirection. agent.log lives next to the
    # agent script so an operator can read it via File Explorer when
    # diagnosing "PENDING forever" rows.
    ps += "$logFile = Join-Path $installDir 'agent.log'\n"
    ps += "$cmdArgs = '/c \"\"' + $py + '\"\" \"\"' + $agentPath + '\"\" >> \"\"' + $logFile + '\"\" 2>&1'\n"
    ps += "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs\n"
    ps += "$env:COMPLYVERSE_EXPECT_OS = 'windows'\n"
    ps += "[System.Environment]::SetEnvironmentVariable('COMPLYVERSE_EXPECT_OS','windows',[System.EnvironmentVariableTarget]::Machine)\n"
    # BUG-FIX: bake the backend URL + state dir into SYSTEM-level env vars
    # so the scheduled task (running as SYSTEM) inherits them. Linux/macOS
    # installers pass these via systemd/launchd plist; Windows was missing
    # the equivalent and the agent fell back to "http://localhost:5000"
    # which only worked accidentally when the backend was on the same box.
    ps += f"[System.Environment]::SetEnvironmentVariable('COMPLYVERSE_URL','{base}',[System.EnvironmentVariableTarget]::Machine)\n"
    ps += "[System.Environment]::SetEnvironmentVariable('COMPLYVERSE_STATE',(Join-Path $env:ProgramData 'Compliverse'),[System.EnvironmentVariableTarget]::Machine)\n"
    ps += "$trigger1 = New-ScheduledTaskTrigger -AtStartup\n"
    # NOTE: do NOT pass [System.TimeSpan]::MaxValue here. Windows Task
    # Scheduler serializes it to "P10675199DT2H48M5.4775807S" which fails
    # XML validation with "value out of range." Use the documented
    # maximum (9999 days ≈ 27 years) which renders as "P9999D" and is
    # accepted. The task is also registered with -StartWhenAvailable +
    # AtStartup, so if it ever expires it self-recovers on next boot.
    ps += "$trigger2 = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddSeconds(30)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 9999)\n"
    ps += "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest\n"
    ps += "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999\n"
    ps += "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger1, $trigger2) -Principal $principal -Settings $settings -Force | Out-Null\n"
    ps += "Start-ScheduledTask -TaskName $taskName\n"
    ps += "Write-Host '[install] Compliverse Agent installed and running as a scheduled task.'\n"
    ps += "Write-Host '[install] Manage: schtasks /Query /TN ComplyverseAgent'\n"
    # SYNCHRONOUS DIAGNOSTIC: kick off Python ONCE in the foreground with a
    # 15-second timeout so the operator sees any startup error inline in
    # the installer window. The actual long-running agent comes from the
    # scheduled task above — this is purely to surface "Python not found",
    # "agent.py syntax error", or "backend unreachable" the moment they
    # happen rather than burying them in a SYSTEM-context log file.
    ps += "Write-Host ''\n"
    ps += "Write-Host '[install] Running 15-second diagnostic to surface any startup errors...'\n"
    ps += "Write-Host '------- AGENT FIRST-RUN OUTPUT BEGIN -------'\n"
    ps += f"$env:COMPLYVERSE_URL = '{base}'\n"
    ps += "$env:COMPLYVERSE_STATE = (Join-Path $env:ProgramData 'Compliverse')\n"
    ps += "$diagJob = Start-Job -ScriptBlock { param($py,$agent) & $py $agent 2>&1 } -ArgumentList $py,$agentPath\n"
    ps += "Wait-Job -Job $diagJob -Timeout 15 | Out-Null\n"
    ps += "Receive-Job -Job $diagJob | ForEach-Object { Write-Host $_ }\n"
    ps += "Stop-Job -Job $diagJob -ErrorAction SilentlyContinue | Out-Null\n"
    ps += "Remove-Job -Job $diagJob -Force -ErrorAction SilentlyContinue | Out-Null\n"
    ps += "Write-Host '------- AGENT FIRST-RUN OUTPUT END -------'\n"
    ps += "Write-Host ''\n"
    return ps


@grc_app.get("/agent/setup.ps1", response_class=PlainTextResponse)
def agent_install_ps1(request: Request):
    base = _backend_origin_for_agent(
        request.headers.get("host"),
        request.headers.get("x-forwarded-proto"),
    )
    return Response(
        content=_windows_install_ps1(base),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ComplyverseAgent-setup.ps1"'},
    )


@grc_app.get("/agent/setup.cmd", response_class=PlainTextResponse)
def agent_install_cmd(request: Request):
    """Self-elevating batch wrapper. Windows opens .ps1 in Notepad and
    blocks unsigned scripts by default, so double-clicking the .ps1 does
    nothing visible. A .cmd file double-clicks straight into cmd.exe,
    self-elevates to admin via UAC, and runs the embedded PowerShell with
    -ExecutionPolicy Bypass so the install completes without the user
    fighting Defender, SmartScreen, or ExecutionPolicy."""
    base = _backend_origin_for_agent(
        request.headers.get("host"),
        request.headers.get("x-forwarded-proto"),
    )
    cmd = "@echo off\r\n"
    cmd += "setlocal EnableDelayedExpansion\r\n"
    cmd += "REM Compliverse Agent installer (Windows) - double-click to run\r\n"
    cmd += "REM Optional: pass enrollment token as first argument\r\n"
    cmd += "REM Self-elevate to admin\r\n"
    cmd += "net session >nul 2>&1\r\n"
    cmd += "if %errorLevel% NEQ 0 (\r\n"
    cmd += "  echo [install] Requesting administrator privileges...\r\n"
    cmd += "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs\"\r\n"
    cmd += "  exit /b\r\n"
    cmd += ")\r\n"
    cmd += "set TOKEN=%~1\r\n"
    cmd += f"set BASE={base}\r\n"
    cmd += "set TMPPS=%TEMP%\\ComplyverseAgent-setup.ps1\r\n"
    cmd += "echo [install] Downloading installer script from %BASE% ...\r\n"
    cmd += "powershell -NoProfile -ExecutionPolicy Bypass -Command \"try { Invoke-WebRequest -UseBasicParsing -Uri '%BASE%/grc/agent/setup.ps1' -OutFile '%TMPPS%' } catch { Write-Host ('[install] ERROR: cannot reach backend at %BASE% - ' + $_.Exception.Message); exit 3 }\"\r\n"
    cmd += "if not exist \"%TMPPS%\" (\r\n"
    cmd += "  echo [install] FAILED - could not download installer script.\r\n"
    cmd += "  pause\r\n"
    cmd += "  exit /b 3\r\n"
    cmd += ")\r\n"
    cmd += "powershell -NoProfile -ExecutionPolicy Bypass -File \"%TMPPS%\" %TOKEN%\r\n"
    cmd += "set RC=%errorLevel%\r\n"
    cmd += "del /q \"%TMPPS%\" >nul 2>&1\r\n"
    cmd += "if %RC% NEQ 0 (\r\n"
    cmd += "  echo [install] FAILED with exit code %RC%\r\n"
    cmd += ") else (\r\n"
    cmd += "  echo [install] Done. The agent will phone home every minute.\r\n"
    cmd += ")\r\n"
    cmd += "pause\r\n"
    return Response(
        content=cmd,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="ComplyverseAgent-setup.cmd"'},
    )


@grc_app.get("/agent/setup.sh", response_class=PlainTextResponse)
def agent_install_sh_real(request: Request):
    base = _backend_origin_for_agent(
        request.headers.get("host"),
        request.headers.get("x-forwarded-proto"),
    )
    sh = "#!/usr/bin/env bash\n"
    sh += "# Compliverse Agent installer (Linux)\n"
    sh += "# Run as root: sudo bash ComplyverseAgent-setup.sh <ENROLLMENT_TOKEN>\n"
    sh += "set -euo pipefail\n"
    # ── OS fence ──
    sh += "if [ \"$(uname -s)\" != \"Linux\" ]; then\n"
    sh += "    echo '[install] ERROR: this installer is for Linux only.' >&2\n"
    sh += "    echo \"[install] Detected OS: $(uname -s)\" >&2\n"
    sh += "    echo '[install] On macOS use the .command installer. On Windows use the .cmd installer.' >&2\n"
    sh += "    exit 99\n"
    sh += "fi\n"
    sh += f"BASE='{base}'\n"
    sh += "TOKEN=\"${1:-}\"\n"
    sh += "INSTALL_DIR=/opt/compliverse\n"
    sh += "mkdir -p \"$INSTALL_DIR\"\n"
    sh += "echo \"[install] Fetching agent from $BASE ...\"\n"
    sh += "curl -fsSL \"$BASE/grc/agent/agent.py\" -o \"$INSTALL_DIR/agent.py\"\n"
    sh += "if ! command -v python3 >/dev/null 2>&1; then\n"
    sh += "    echo '[install] Installing python3 ...'\n"
    sh += "    if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y python3;\n"
    sh += "    elif command -v dnf >/dev/null 2>&1; then dnf install -y python3;\n"
    sh += "    elif command -v yum >/dev/null 2>&1; then yum install -y python3;\n"
    sh += "    else echo 'ERROR: install python3 manually then re-run.'; exit 2; fi\n"
    sh += "fi\n"
    # BUG-FIX: write the enrollment token to the SAME location the agent
    # reads from by default. Previously the installer wrote it under
    # /root/.compliverse but my recent agent state-dir fix moved the
    # Linux default to /var/lib/compliverse — meaning the installer +
    # agent disagreed and the agent could never find its token. Same
    # shape as Bug #2 on Windows. We now write to /var/lib/compliverse
    # explicitly and the agent reads from the same path.
    sh += "if [ -n \"$TOKEN\" ]; then\n"
    sh += "    mkdir -p /var/lib/compliverse\n"
    sh += "    echo \"$TOKEN\" > /var/lib/compliverse/enrollment.txt\n"
    sh += "    chmod 600 /var/lib/compliverse/enrollment.txt\n"
    sh += "    echo '[install] Enrollment token stored at /var/lib/compliverse/enrollment.txt'\n"
    sh += "fi\n"
    sh += "cat >/etc/systemd/system/compliverse-agent.service <<UNIT\n"
    sh += "[Unit]\n"
    sh += "Description=Compliverse Compliance Agent\n"
    sh += "After=network-online.target\n"
    sh += "Wants=network-online.target\n"
    sh += "\n"
    sh += "[Service]\n"
    sh += "Type=simple\n"
    sh += f"Environment=COMPLYVERSE_URL={base}\n"
    # Propagate COMPLYVERSE_MODE from the install env so collector agents
    # boot in collector mode after reboot. Endpoint default if unset.
    sh += "Environment=COMPLYVERSE_MODE=${COMPLYVERSE_MODE:-endpoint}\n"
    # OS lock for the agent itself — refuses to start on non-Linux hosts.
    sh += "Environment=COMPLYVERSE_EXPECT_OS=linux\n"
    # Explicit state dir — must match where the installer wrote
    # enrollment.txt (see the bug-fix comment above). Setting it
    # explicitly in the unit makes the contract obvious and survives
    # any future change to the agent's default.
    sh += "Environment=COMPLYVERSE_STATE=/var/lib/compliverse\n"
    sh += "ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py\n"
    sh += "Restart=always\n"
    sh += "RestartSec=10\n"
    sh += "\n"
    sh += "[Install]\n"
    sh += "WantedBy=multi-user.target\n"
    sh += "UNIT\n"
    sh += "systemctl daemon-reload\n"
    sh += "systemctl enable --now compliverse-agent.service\n"
    sh += "echo '[install] Compliverse Agent installed as systemd service.'\n"
    sh += "echo '[install] Manage: systemctl status compliverse-agent'\n"
    # SYNCHRONOUS DIAGNOSTIC — same shape as the Windows installer.
    # Without this, "install successful" gives no signal whether the
    # agent actually phoned home. We let systemd start the service,
    # then tail journalctl for 15 seconds so any startup error shows
    # up in the installer console. Same UX as the Windows .cmd.
    sh += "echo ''\n"
    sh += "echo '[install] Running 15-second diagnostic to surface any startup errors...'\n"
    sh += "echo '------- AGENT FIRST-RUN OUTPUT BEGIN -------'\n"
    sh += "timeout 15 journalctl -u compliverse-agent.service -f --no-pager --since '20 seconds ago' 2>/dev/null || true\n"
    sh += "echo '------- AGENT FIRST-RUN OUTPUT END -------'\n"
    sh += "echo ''\n"
    sh += "STATUS=$(systemctl is-active compliverse-agent.service)\n"
    sh += "echo \"[install] Service status: $STATUS\"\n"
    sh += "if [ \"$STATUS\" != 'active' ]; then\n"
    sh += "  echo '[install] WARNING: service is not active. Check: journalctl -u compliverse-agent.service'\n"
    sh += "fi\n"
    return Response(
        content=sh,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ComplyverseAgent-setup.sh"'},
    )


@grc_app.get("/agent/setup.command", response_class=PlainTextResponse)
def agent_install_macos(request: Request):
    base = _backend_origin_for_agent(
        request.headers.get("host"),
        request.headers.get("x-forwarded-proto"),
    )
    sh = "#!/usr/bin/env bash\n"
    sh += "# Compliverse Agent installer (macOS)\n"
    sh += "# Run: sudo bash ComplyverseAgent-setup.command <ENROLLMENT_TOKEN>\n"
    sh += "set -euo pipefail\n"
    # ── OS fence ──
    sh += "if [ \"$(uname -s)\" != \"Darwin\" ]; then\n"
    sh += "    echo '[install] ERROR: this installer is for macOS only.' >&2\n"
    sh += "    echo \"[install] Detected OS: $(uname -s)\" >&2\n"
    sh += "    echo '[install] On Linux use the .sh installer. On Windows use the .cmd installer.' >&2\n"
    sh += "    exit 99\n"
    sh += "fi\n"
    sh += f"BASE='{base}'\n"
    sh += "TOKEN=\"${1:-}\"\n"
    sh += "INSTALL_DIR='/Library/Application Support/Compliverse'\n"
    sh += "mkdir -p \"$INSTALL_DIR\"\n"
    sh += "curl -fsSL \"$BASE/grc/agent/agent.py\" -o \"$INSTALL_DIR/agent.py\"\n"
    # BUG-FIX: same as Linux — write the token to the system-shared
    # location the agent reads from (/Library/Application Support/Compliverse),
    # NOT the installing user's ~/.compliverse. The launchd daemon runs
    # as root so it can read this path; ~/.compliverse would be invisible
    # to it.
    sh += "STATE_DIR='/Library/Application Support/Compliverse'\n"
    sh += "if [ -n \"$TOKEN\" ]; then\n"
    sh += "    mkdir -p \"$STATE_DIR\" && echo \"$TOKEN\" > \"$STATE_DIR/enrollment.txt\" && chmod 600 \"$STATE_DIR/enrollment.txt\"\n"
    sh += "    echo \"[install] Enrollment token stored at $STATE_DIR/enrollment.txt\"\n"
    sh += "fi\n"
    sh += "cat >/Library/LaunchDaemons/com.compliverse.agent.plist <<'PLIST'\n"
    sh += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
    sh += "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
    sh += "<plist version=\"1.0\"><dict>\n"
    sh += "  <key>Label</key><string>com.compliverse.agent</string>\n"
    sh += "  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>/Library/Application Support/Compliverse/agent.py</string></array>\n"
    sh += "  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n"
    sh += "  <key>EnvironmentVariables</key>\n"
    sh += "  <dict>\n"
    sh += f"    <key>COMPLYVERSE_URL</key><string>{base}</string>\n"
    sh += "    <key>COMPLYVERSE_EXPECT_OS</key><string>macos</string>\n"
    sh += "    <key>COMPLYVERSE_STATE</key><string>/Library/Application Support/Compliverse</string>\n"
    sh += "  </dict>\n"
    sh += "</dict></plist>\n"
    sh += "PLIST\n"
    sh += "launchctl load /Library/LaunchDaemons/com.compliverse.agent.plist\n"
    sh += "echo '[install] Compliverse Agent installed as launchd daemon.'\n"
    # SYNCHRONOUS DIAGNOSTIC — same shape as Windows + Linux.
    # Watches the agent log for 15 seconds so the operator sees the
    # first heartbeat (or any startup error) inline.
    sh += "echo ''\n"
    sh += "echo '[install] Running 15-second diagnostic to surface any startup errors...'\n"
    sh += "echo '------- AGENT FIRST-RUN OUTPUT BEGIN -------'\n"
    sh += "LOG_FILE='/Library/Logs/Compliverse/agent.log'\n"
    sh += "mkdir -p \"$(dirname \"$LOG_FILE\")\"\n"
    sh += "touch \"$LOG_FILE\"\n"
    # macOS doesn't ship GNU `timeout`. Portable equivalent: start
    # tail in the background, sleep 15s, then kill its PID.
    sh += "tail -F \"$LOG_FILE\" 2>/dev/null & TAIL_PID=$!\n"
    sh += "sleep 15\n"
    sh += "kill $TAIL_PID 2>/dev/null || true\n"
    sh += "wait $TAIL_PID 2>/dev/null || true\n"
    sh += "echo '------- AGENT FIRST-RUN OUTPUT END -------'\n"
    sh += "echo ''\n"
    sh += "STATUS=$(launchctl list | grep com.compliverse.agent | awk '{print $2}')\n"
    sh += "if [ -n \"$STATUS\" ] && [ \"$STATUS\" = '0' ]; then\n"
    sh += "  echo '[install] Daemon is running.'\n"
    sh += "else\n"
    sh += "  echo \"[install] WARNING: daemon exit code: $STATUS. Check: $LOG_FILE\"\n"
    sh += "fi\n"
    return Response(
        content=sh,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ComplyverseAgent-setup.command"'},
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
