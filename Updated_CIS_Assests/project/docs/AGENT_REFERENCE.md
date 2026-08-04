# Compliverse Agent — Reference Document

Single-source brief covering: what the agent is, every bug we fixed in the
2026-06-09 debug session, OS strict-detection logic, asset linking, scan
execution flow, and where each piece lives in the codebase.

Use this as the handoff doc when someone new joins or when production
needs the same fixes applied.

---

## 1. The agent in one sentence

> A single-file Python script that runs as a privileged background service
> on a target host, dials OUT to Compliverse every 30 seconds, fetches scan
> jobs, executes them locally using the OS's native shell, and posts results
> back. Outbound HTTPS only — never inbound.

## 2. Two operating modes

```
ENDPOINT mode (default)                   COLLECTOR mode
──────────────                            ──────────────
Installed ON the target host.             Installed on one Linux box inside
Scans itself.                              the customer's LAN. Scans OTHER
                                          hosts via WinRM / SSH / DB / API.
COMPLYVERSE_MODE=endpoint                 COMPLYVERSE_MODE=collector
```

Same Python script for both. The mode flag toggles which jobs the agent
fetches and how it executes them.

## 3. Bugs we fixed in the 2026-06-09 session (10 total)

Each row: what was wrong, why it failed, where the fix landed.

| # | Bug | Why it broke | File + change |
|---|---|---|---|
| 1 | Scheduled-task XML rejected `[System.TimeSpan]::MaxValue` | Windows Task Scheduler serializes it to `P10675199DT2H48M5.4775807S`, out of range | `main.py:247` — use `(New-TimeSpan -Days 9999)` |
| 2 | Token stored in installer-user's `%USERPROFILE%\.compliverse\` | SYSTEM-context agent has different `$env:USERPROFILE` (`C:\Windows\System32\config\systemprofile`) so it can't find the token | `main.py:234` — write to `$env:ProgramData\Compliverse` instead |
| 3 | Agent defaulted `STATE_DIR = ~/.compliverse` | On Windows under SYSTEM, that resolves to the unreachable systemprofile dir | `demo_agent.py:36` — added `_default_state_dir()` that returns OS-appropriate system-shared paths |
| 4 | Windows installer didn't set `COMPLYVERSE_URL` env var | Agent fell back to `http://localhost:5000` | `main.py` — installer now writes machine-level env vars for URL + STATE |
| 5 | URL detection didn't honor HTTPS or `X-Forwarded-Proto` | On production behind cloudflare/nginx, installer baked `http://...` into agent which then 308'd into a redirect loop | `main.py:169` — new `_backend_origin_for_agent()` that checks env override → `X-Forwarded-Proto` header → request scheme → falls back to detection |
| 6 | Loop crashed on transient errors (backend restart, DNS blip) | `try/except` only caught `_TokenRevoked`; any other exception bubbled up and killed Python | `demo_agent.py:990` — added catch-all `except Exception` that logs + sleeps + retries |
| 7 | Agent exited on 401 "token revoked" instead of re-enrolling | Forced manual cleanup every time an admin wiped stale rows | `demo_agent.py:841` — raises `_TokenRevoked`; main loop catches → wipes `agent.json` → re-reads `enrollment.txt` → re-enrolls → resumes |
| 8 | OS detection misreported Windows 11 as Windows 10 | Registry's `ProductName` still says "Windows 10 Pro" on Win11 boxes (legacy) | `demo_agent.py:138` — also read `CurrentBuildNumber`; ≥22000 forces Windows 11 |
| 9 | Asset DELETE returned 500 with FK violation | 11 child tables reference `grc_it_assets.id` with `NO ACTION` on delete; any linked record blocked the delete | `assets_router.py:920` — manual cascade: delete pure-link rows, delete asset-owned history rows, NULL `asset_id` on agent rows |
| 10 | Linux + macOS installers wrote token to user dir | Same shape as Bug #2 — root/launchd context couldn't find it | `main.py` Linux installer → `/var/lib/compliverse`; macOS installer → `/Library/Application Support/Compliverse` |

## 4. Installer flow (per platform)

### Windows (`.cmd` → `.ps1`)

```
Double-click .cmd
   ↓
.cmd self-elevates (UAC prompt)
   ↓
.cmd downloads .ps1 from /grc/agent/setup.ps1
   ↓
.ps1 runs as admin:
   1. mkdir C:\ProgramData\Compliverse
   2. curl agent.py → save to C:\ProgramData\Compliverse\agent.py
   3. find python.exe via Get-Command python
   4. if Token arg present: write to C:\ProgramData\Compliverse\enrollment.txt
   5. SetMachine env vars:
        COMPLYVERSE_URL  = baked from installer download URL
        COMPLYVERSE_STATE = C:\ProgramData\Compliverse
        COMPLYVERSE_EXPECT_OS = windows
   6. Register-ScheduledTask "ComplyverseAgent"
        Trigger 1: AtStartup
        Trigger 2: Once @ now+30s, repeat every 1min for 9999 days
        Action: cmd.exe /c "python.exe" "agent.py" >> agent.log 2>&1
        Principal: SYSTEM, RunLevel Highest
   7. Start-ScheduledTask
   8. SYNCHRONOUS DIAGNOSTIC: Start-Job python agent.py for 15s, capture output
```

### Linux (`.sh`)

```
sudo bash setup.sh <TOKEN>
   ↓
1. OS fence: refuse if not Linux
2. mkdir /opt/compliverse → curl agent.py
3. Auto-install python3 if missing (apt/dnf/yum)
4. Write token to /var/lib/compliverse/enrollment.txt (mode 600)
5. Write /etc/systemd/system/compliverse-agent.service:
      [Service]
      Environment=COMPLYVERSE_URL=...
      Environment=COMPLYVERSE_STATE=/var/lib/compliverse
      Environment=COMPLYVERSE_EXPECT_OS=linux
      Environment=COMPLYVERSE_MODE=${COMPLYVERSE_MODE:-endpoint}
      ExecStart=/usr/bin/python3 /opt/compliverse/agent.py
      Restart=always
      RestartSec=10
6. systemctl daemon-reload && systemctl enable --now compliverse-agent
7. SYNCHRONOUS DIAGNOSTIC: timeout 15 journalctl -u compliverse-agent -f
8. Check systemctl is-active → print pass/fail
```

### macOS (`.command`)

```
sudo bash setup.command <TOKEN>
   ↓
1. OS fence: refuse if not Darwin
2. mkdir /Library/Application Support/Compliverse → curl agent.py
3. Write token to /Library/Application Support/Compliverse/enrollment.txt
4. Write /Library/LaunchDaemons/com.compliverse.agent.plist:
      ProgramArguments: python3 /Library/Application Support/Compliverse/agent.py
      RunAtLoad: true
      KeepAlive: true     ← auto-restart on crash
      EnvironmentVariables:
        COMPLYVERSE_URL
        COMPLYVERSE_STATE = /Library/Application Support/Compliverse
        COMPLYVERSE_EXPECT_OS = macos
5. launchctl load /Library/LaunchDaemons/com.compliverse.agent.plist
6. SYNCHRONOUS DIAGNOSTIC: tail -F /Library/Logs/Compliverse/agent.log for 15s
7. launchctl list | grep com.compliverse.agent → print pass/fail
```

## 5. Agent runtime lifecycle (any OS)

```
1. Boot log written to agent.log (always — even before anything else)

2. detect_os() runs:
     Windows: read HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion
              ProductName + CurrentBuildNumber + DisplayVersion
              → if build >= 22000 → force Windows 11
              → normalize to "windows-10-22H2" / "windows-11-25H2" /
                "windows-server-2022" / etc.
     Linux:   read /etc/os-release PRETTY_NAME
              → normalize to "ubuntu-22.04" / "rhel-9" / etc.
     macOS:   sw_vers ProductVersion + BuildVersion
              → "macOS 14.4"

3. EXPECT_OS gate:
     If COMPLYVERSE_EXPECT_OS != detected → log + sys.exit(3)
     (prevents Linux installer being copied to a Windows host)

4. load_state() — read agent.json
     If api_token exists → use it, skip enrollment
     Else → enroll():
        Read enrollment.txt
        POST /grc/agents/enroll with token
        Receive api_token + agent_id
        Save to agent.json

5. while True (the loop):
     try:
       heartbeat(api_token)    → POST /grc/agents/heartbeat
                                  body: hostname, OS profile, version
                                  response: linked_asset_id, pending_scan?
       fetch_and_run_jobs(api_token)  → GET /grc/agents/jobs (long-poll 25s)
                                        for each job:
                                          run check command (PS/bash/python)
                                          collect: status, output, duration
                                        POST /grc/agents/results (batched)
     except _TokenRevoked:
       wipe agent.json
       re-enroll from enrollment.txt
       continue
     except KeyboardInterrupt:
       raise
     except Exception as e:
       log "tick failed: <e>. Retrying in 30s"
       (don't crash)
     time.sleep(30)
```

## 6. Asset auto-creation logic

The join key is `host_name` (case-insensitive), scoped per tenant.

```
heartbeat arrives → has hostname X
   ↓
SELECT id FROM grc_it_assets
WHERE tenant_id = agent.tenant_id
  AND LOWER(host_name) = LOWER(X)
   ↓
   ├─ Found → asset.id reused
   │           agent.asset_id = found.id
   │           OS profile fields refreshed if newer
   │
   └─ Not found → CREATE:
           INSERT INTO grc_it_assets (
             tenant_id     = agent.tenant_id,
             name          = "agent-host:" + hostname,
             host_name     = hostname,
             description   = "Auto-created from agent heartbeat (agent #N)",
             asset_type    = 'infrastructure',
             criticality   = 'medium',
             status        = 'active',
             owner_id      = agent.created_by_user_id   ← who minted the token
           )
           agent.asset_id = new.id
```

Same pattern in `connect_wizard_router.py` for agentless flow:
- look up existing by hostname → reuse, or
- create new with `owner_id = current_user.id`.

## 7. Strict OS → CIS benchmark matching

After detection, the backend asks: "which CIS benchmark applies?"

```
asset.os_normalized = "windows-11-25H2"
                       │
                       ▼
SELECT benchmark_name FROM grc_benchmark_os_mappings
WHERE is_active = TRUE
  AND (os_pattern = asset.os_normalized
       OR asset.os_normalized LIKE os_pattern || '%')
ORDER BY priority DESC
LIMIT 1
                       │
                       ▼
       'CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1'
                       │
                       ▼
SELECT * FROM grc_compliance_plugins
WHERE benchmark = '<that name>'
  AND enabled = TRUE
  AND review_status IN ('approved', 'auto_approved')
                       │
                       ▼
            548 applicable rules
```

**No AI in the matching.** It's an operator-curated table
(`grc_benchmark_os_mappings`). When a new Windows release ships,
operators add one row mapping the new OS pattern to the right benchmark.

Code: `compliance_plugins/services/run_service.py::pick_benchmark_for_os()`

## 8. Scan execution flow

```
Operator clicks "Scan now" on asset/{id} Compliance tab
   ↓
POST /grc/compliance-plugins/scan-all { asset_id }
   ↓
Backend looks up: which agent is bound to this asset?
   ↓
   ┌─── Endpoint agent ─────────┐  ┌─── Collector path (PR1 pending) ────┐
   │ agent.pending_scan_at = NOW│  │ collector.pending_scan_at = NOW      │
   │ list of plugin_ids stored  │  │ job payload includes target host +   │
   │ in pending_jobs            │  │ decrypted credentials from vault     │
   └────────────────────────────┘  └──────────────────────────────────────┘
   ↓
Agent's next heartbeat / job poll picks it up (within 30s)
   ↓
Agent runs each plugin:
   Windows: powershell.exe -Command "<check>"
   Linux:   bash -c "<check>"
   Oracle:  SELECT <check> via SQL driver
   AWS:     boto3 API call
   ↓ each run produces:
   { plugin_id, status: 'passed'|'failed'|'error',
     output, evidence, duration_ms }
   ↓
POST /grc/agents/results (batched, up to 200 per tick)
   ↓
Backend writes grc_compliance_plugin_runs rows
   ↓
React Query polls runs every 2s → live progress bar updates
   ↓
Risk Posture vuln dimension recomputes
   ↓
Pass/fail badges appear on the Compliance tab
```

## 9. State files on disk (per OS)

| OS | enrollment.txt | agent.py | agent.json (api_token) | agent.log |
|---|---|---|---|---|
| Windows | `C:\ProgramData\Compliverse\` | same | same | same |
| Linux | `/var/lib/compliverse/` | `/opt/compliverse/` | `/var/lib/compliverse/` | `/var/log/compliverse/` |
| macOS | `/Library/Application Support/Compliverse/` | same | same | `/Library/Logs/Compliverse/` |

All three use the SAME path for enrollment.txt + agent.json — this is critical
for the SYSTEM/root context to read what the installer wrote (bug #2 / #10 fix).

## 10. Frontend changes from the session

| File | Change |
|---|---|
| `artifacts/grc-frontend/src/app/(dashboard)/assets/[id]/page.tsx` | Added `apiClient` to imports; added scrollable max-height to Applicable Rules list; added "▶ Scan now" button on Compliance tab |
| `artifacts/grc-frontend/src/app/(dashboard)/my-runs/page.tsx` | Added "Owner" column; "not started" badge for users with zero runs; cleaned up the misleading "0/5304 0% passing" for non-active users |
| `artifacts/grc-frontend/src/app/(dashboard)/risk-posture/page.tsx` | Added V2-ENHANCED callout; updated formula description |
| `artifacts/grc-frontend/src/app/(dashboard)/risk-posture/asset/[id]/page.tsx` | Built the full v2 surface: Business Impact + Live Preview + Before/After exploit comparison + Lens control + per-vuln boxed breakdown |
| `artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/library/page.tsx` | Removed the misleading "▶ Run a scan" CTA (was just navigating to /assets); page now correctly read-only |
| `artifacts/grc-frontend/src/app/(dashboard)/vulnerabilities/page.tsx` | Added "CVE" column to the registry table so it matches the per-asset page naming |
| `artifacts/grc-frontend/src/lib/api.ts` | Exported `apiClient`; added `riskPostureApi.previewAsset()` |

## 11. Backend changes from the session

| File | Change |
|---|---|
| `.migration-backup/backend/main.py` | All 3 installer endpoints — token path, env vars, OS detection, diagnostics, URL scheme detection |
| `.migration-backup/backend/agent_payloads/demo_agent.py` | OS-aware default state dir, boot log, Win11 build detection, catch-all loop, auto re-enroll on revocation |
| `.migration-backup/backend/grc/routers/assets_router.py` | Cascade cleanup on DELETE; owner_id auto-set on Connect Wizard auto-create |
| `.migration-backup/backend/grc/modules/agents/router.py` | owner_id auto-set on agent heartbeat auto-create |
| `.migration-backup/backend/grc/modules/compliance_plugins/router.py` | `_run_to_dict()` now includes `asset_owner` so the Runs feed can show who owns each scanned asset |
| `.migration-backup/backend/grc/modules/risk_posture/` | full v2 module: `effective_risk.py` formula + `external_feeds.py` EPSS/KEV fetchers + preview endpoint |
| `.migration-backup/backend/grc/modules/vuln_management/routers/vulnerabilities.py` | Made nullable model fields Optional in response schema (was 500'ing on legacy rows) |
| `.migration-backup/backend/grc/schemas.py` | New v2 fields; tolerance on legacy nulls |

## 12. What's NOT yet implemented

| Feature | Why it matters | Effort |
|---|---|---|
| **Collector job routing** | ~~Cloud-SaaS agentless to customer LAN doesn't work~~ ✅ **Shipped 2026-06-10**. See §15. | ~~~1 day~~ |
| **Bulk Connect Wizard** ("same creds for 50 devices") | Bank operators won't paste creds 50 times | ~1.5 days |
| **Strong Linux OS detection** (kernel, init, distro family) | Linux benchmark matching is coarse | ~half day |
| **Role detection** (IIS, MSSQL, Apache, etc.) | One server may need multiple benchmarks; we only apply one | ~2 days |
| **Proxy support** (`HTTP_PROXY`, CA bundle override) | Banks behind corporate proxies | ~2 hours |
| **Self-update mechanism** for agents | Fixes ship without re-install | ~3 days |

## 13. Sanity tests to run before any deploy

```
1. Install endpoint agent on a Windows VM:
     - row goes ACTIVE within 60s
     - asset auto-created with owner = installing user
     - OS detected as windows-11-XX or windows-server-XXXX
     - applicable rules count matches the matched benchmark

2. Install endpoint agent on Ubuntu via WSL:
     - row goes ACTIVE
     - asset auto-created
     - OS detected as ubuntu-XX.XX
     - applicable rules = a Linux benchmark

3. Trigger Scan Now from /assets/{id}:
     - progress bar increments live
     - results land in grc_compliance_plugin_runs
     - Risk Posture vuln score updates

4. Restart backend mid-scan:
     - agent does NOT crash
     - logs "tick failed: ... retrying in 30s"
     - resumes on next tick

5. Revoke the agent from /admin/agents:
     - agent does NOT crash
     - logs "token revoked - wiping stale state and re-enrolling"
     - re-enrolls using enrollment.txt
     - heartbeat resumes with NEW agent_id

6. Delete the asset from /assets/{id}:
     - returns 204
     - agent row gets asset_id = NULL (kept alive)
     - on next heartbeat, agent auto-creates a fresh asset
       with the same hostname

7. Hit /risk-posture and click any asset:
     - drills into v2 page
     - Business Impact + Live Preview + Before/After all render
     - "▶ Scan now" works
```

## 14. Production deploy checklist (after a code change)

1. Pull these files: `main.py`, `agent_payloads/demo_agent.py`,
   `agents/router.py`, `assets_router.py`, `connect_wizard_router.py`,
   `compliance_plugins/router.py`, `risk_posture/*`, `schemas.py`,
   `vuln_management/routers/vulnerabilities.py`
2. Set env var `COMPLYVERSE_PUBLIC_URL=https://your.cloud.url` on the
   production server (belt-and-braces fallback; the X-Forwarded-Proto fix
   should handle this for free if your proxy sends the header)
3. Restart backend
4. Confirm `/grc/agent/setup.cmd` download bakes `https://your.cloud.url`
5. Run end-to-end test from a test PC (sanity test #1 above)
6. Watch the agents page for ACTIVE status within 60s

Once that's green, customers can install installers from production
without hitting any of the 10 bugs we fixed today.

---

## 15. Collector job routing (shipped 2026-06-10)

The path that lets cloud-SaaS Compliverse scan into customer LAN hosts
without firewall changes.

### How it flows end-to-end

```
1. Customer's IT team installs the Collector agent on one Linux box
   inside their LAN (uses the .sh installer with COMPLYVERSE_MODE=collector).
   Collector dials OUT to cloud — only port 443.

2. Operator opens Connect Wizard, pastes target host + read-only creds.
   Picks a Collector from a dropdown ("which collector should reach this?").
   Backend writes:
     grc_integration_connections row with assigned_collector_agent_id = N

3. Operator clicks "▶ Scan now" on the asset.
   Backend run_service.py creates the run row but sets:
     status                = 'pending'
     executed_by_agent_id  = N   ← the collector
   And nudges agent.pending_scan_at so the collector's next long-poll wakes.

4. Collector polls GET /grc/agents/jobs (long-poll up to 25s).
   New code path: SELECT pending runs WHERE executed_by_agent_id = me.
   Decrypts target creds from the connection's vault.
   Returns jobs to the collector, marks them 'running' to prevent dup-poll.

5. Collector executes each job locally using the existing
   run_remote() dispatcher (paramiko SSH for Linux, pymssql for SQL, etc.).
   Each job carries:
     run_id           — the pending row to update
     connection_id    — origin of the credentials
     check_definition — what to run
     credentials      — decrypted by backend, sent over TLS

6. Collector POSTs results back via /grc/agents/results.
   Each result echoes run_id — backend updates the existing 'running' row
   in place rather than creating a new orphan. Operator's progress UI
   sees the SAME row resolve.
```

### Files touched

| File | Change |
|---|---|
| `migrations/collector_routing_2026_06_10.sql` | Two new nullable FK columns + indexes |
| `grc/models.py` | `IntegrationConnection.assigned_collector_agent_id`, `CompliancePluginRun.executed_by_agent_id` |
| `grc/modules/compliance_plugins/services/run_service.py` | When connection has a collector, create pending run + nudge collector instead of executing locally |
| `grc/modules/agents/router.py` | `/agents/jobs` now returns pending-runs-for-this-collector with priority; `/agents/results` accepts `run_id` and updates the existing row in place |
| `grc/routers/connect_wizard_router.py` | `HandshakeIn.assigned_collector_agent_id` accepted and persisted |
| `agent_payloads/demo_agent.py` | Echoes `run_id` back in results so backend can update the right row |

### Backwards compatibility

- Existing connections (`assigned_collector_agent_id = NULL`) keep using
  the direct backend-executes-it path. Zero breakage.
- Endpoint agents (mode='endpoint') ignore the new pending-run path —
  they continue using their hostname-bound asset for jobs.
- `/agents/results` still accepts entries without `run_id` (legacy
  collectors / endpoint agents) — they create new rows as before.

### What's still missing (UI)

The Connect Wizard now ACCEPTS `assigned_collector_agent_id` in the API,
but no frontend dropdown is yet rendering. Until that lands, operators
can set the field by editing the connection in the DB or via direct
POST. Next PR: add the picker to `ConnectWizard.tsx`.

### Verification SQL

```sql
-- A scan went through a collector when the run shows both fields set:
SELECT r.id, r.status, r.asset_id, r.executed_by_agent_id,
       c.connection_name, c.assigned_collector_agent_id
FROM grc_compliance_plugin_runs r
JOIN grc_integration_connections c ON c.id = r.connection_id
WHERE r.executed_by_agent_id IS NOT NULL
ORDER BY r.id DESC LIMIT 20;
```

---

**End of reference doc.** Keep this updated when new bugs are fixed or
new features ship — keeps the team unblocked when the next round of
debugging starts.
