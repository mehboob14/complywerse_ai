# Compliverse — GRC + CIS Compliance Automation Platform

A multi-tenant Governance, Risk, and Compliance (GRC) SaaS designed for banks and financial institutions. Combines CIS Benchmark scanning, vulnerability management, policy attestation, and risk posture quantification — with a banking-grade agent architecture that keeps credentials inside the customer's network.

> Built by [@hasanshahidd](https://github.com/hasanshahidd). This repository contains the work on **CIS agents**, **plugin automation**, **risk posture**, and the surrounding GRC modules that ship with the platform.

---

## What's in the box

| Module                | What it does                                                                 |
|-----------------------|------------------------------------------------------------------------------|
| **CIS Agents**        | Outbound-only agents that scan Windows / Linux endpoints + Cisco / Oracle / AWS targets without opening the customer firewall. |
| **Plugin Automation** | 5,300+ CIS Benchmark rules across 5 runner types — auto-matched to assets, bulk-approved, scheduled or on-demand. |
| **Risk Posture**      | Per-asset composite risk score (0–100) combining CIS gap, vulnerabilities, CIA criticality, control coverage, and linked-risk residual. Per-tenant weight tuning. |
| **Bulk Discovery**    | Scan a CIDR range, find live hosts on the runner's port, bulk-import the responders as assets with credentials in one shot. |
| **Setup Wizard**      | Single entry point for adding agents — 5-step progressive flow (Method → Type → How many → Configure → Done) with smart recommendations. |
| **Connect Wizard**    | Agentless onboarding for banks comfortable with cloud-direct WinRM / SSH / SQL connections. |
| **Policy & Governance**| Documents, attestations, committees, regulatory feeds, policy AI drafting. |
| **ERM**               | Risk register, RCSA campaigns, KRIs, appetite, heatmaps, bowtie analysis. |
| **Internal Audit**    | Engagements, findings, test scripts, QAIP, continuous control monitoring. |
| **Vendor Risk (TPRM)**| Onboard vendors, send questionnaires via secure links, score and re-assess. |
| **Vulnerability Mgmt**| Findings from Nessus / Rapid7 / Qualys, SLA tracking, remediation reporting.|
| **ComplyChat AI**     | Plain-English Q&A grounded in your own GRC data (SQL-only RAG). |

---

## Architecture at a glance

```
                                Customer (Bank) infrastructure
            ┌────────────────────────────────────────────────────────────┐
            │                                                            │
            │   Endpoint agents (Windows / Linux)                        │
            │   ──────────────────────────────                           │
            │   1 agent per PC, scans local OS settings                  │
            │   (secedit, registry, sysctl, dpkg, …).                    │
            │                                                            │
            │   Collector agent (Linux / Windows VM)                     │
            │   ──────────────────────────────                           │
            │   1 agent → many targets. SSH/SQL/API outbound from        │
            │   inside the LAN to Cisco / Oracle / AWS, using creds      │
            │   fetched from the cloud or set locally (Scenario A/B).    │
            │                                                            │
            └────────────┬───────────────────────────────────────────────┘
                         │ outbound HTTPS only (heartbeat / fetch-creds /
                         │ fetch-jobs / push-results)
                         ▼
            ┌────────────────────────────────────────────────────────────┐
            │  Compliverse cloud (FastAPI + Postgres + Vite SPA)         │
            │  ───────────────────────────────                           │
            │  • Plugin library (5,300+ CIS checks across 5 runners)     │
            │  • Per-tenant Postgres schema (`tenant_<slug>`)            │
            │  • Encrypted credential store (Fernet) + hashed tokens     │
            │  • Risk-posture composite scorer, framework cascader       │
            │  • Audit log with cryptographic hash chain                 │
            └────────────────────────────────────────────────────────────┘
```

This mirrors the SWIFT CSP architecture pattern: **the vendor never reaches into the bank's network**. Bank IT installs the agent themselves on a VM they own; the agent calls home on outbound HTTPS only. No inbound firewall hole, no cloud-side SSH into customer systems.

---

## Repository layout

```
complyverseai-final/
├── .migration-backup/
│   └── backend/                 ← FastAPI service (the production code)
│       ├── main.py              ← entrypoint, mounts /grc app
│       ├── grc/
│       │   ├── main.py          ← /grc subapp, includes all routers
│       │   ├── models.py        ← SQLAlchemy models (185+ tables)
│       │   ├── routers/         ← REST endpoints (auth, tenants, frameworks, …)
│       │   ├── modules/         ← Feature modules:
│       │   │   ├── agents/      ← Agent enrollment, heartbeat, fetch-creds
│       │   │   ├── compliance_plugins/  ← CIS plugin library + runners
│       │   │   ├── risk_posture/        ← Composite risk scoring + weights
│       │   │   ├── onboarding/          ← Bulk discovery + import
│       │   │   ├── chatbot/             ← ComplyChat (RAG on SQL)
│       │   │   ├── erm/                 ← Risk register, RCSA, KRIs
│       │   │   ├── workflow_engine/     ← Approval workflows
│       │   │   ├── vendor_risk/         ← TPRM
│       │   │   ├── evidence/            ← Evidence vault
│       │   │   └── …
│       │   └── seed_frameworks.py       ← ISO 27001, NIST CSF, PCI, etc.
│       └── agent/                       ← Bank-side agent code (Python)
│           ├── complyverse_agent/       ← Core agent package
│           │   ├── enroll.py            ← One-time token → API token swap
│           │   ├── jobs.py              ← Heartbeat loop, fetch-creds, fetch-jobs
│           │   ├── vault.py             ← Local Fernet-encrypted credential store
│           │   ├── collector_ssh.py     ← Paramiko SSH for Cisco / Linux
│           │   ├── local_windows.py     ← secedit / registry / etc. evaluators
│           │   └── tray_ui.py           ← Tkinter cred-management UI
│           └── packaging/
│               ├── windows/             ← NSIS installer + signed .exe
│               ├── linux/               ← Debian/RPM packages
│               └── deploy_templates/    ← GPO PowerShell + Ansible playbooks
│
├── artifacts/
│   ├── grc-frontend/            ← Vite + React + Tailwind SPA
│   │   └── src/app/(dashboard)/ ← Page-per-route layout
│   │       ├── admin/agents/    ← Agent management + Setup Wizard
│   │       ├── admin/discover/  ← Bulk Host Discovery
│   │       ├── risk-posture/    ← Risk dashboard + weight tuning
│   │       ├── compliance/plugins/  ← CIS plugin library + runs
│   │       └── …
│   └── api-server/              ← Express proxy (api/* → grc/*)
│
├── lib/                         ← Shared TypeScript utilities
├── pricing/                     ← Plan/quota definitions
├── docs/                        ← Internal architecture notes
└── scripts/                     ← Dev helpers (start-all.sh, etc.)
```

---

## CIS Agent — how it works

The agent is a small Python service the bank installs on its own machines. Two modes:

### 1. Endpoint mode — 1 agent per host

- Installs on the machine you want to audit (Windows / Linux / macOS).
- Scans **its own** local OS settings: registry policies, secedit, services, sysctl, dpkg, etc.
- **No credentials required** — local access is implicit.
- Mass deploy via Active Directory GPO startup script (see `Deploy-ComplyverseAgent.ps1`).

### 2. Collector mode — 1 agent → many remote targets

- Installs on a single Linux VM (or Windows server) inside the bank's LAN.
- SSHes / queries Cisco routers, Oracle databases, AWS accounts, vCenter, etc. from inside the bank network.
- **Credentials** live in the agent's local encrypted vault (Fernet, AES-128-CBC + HMAC-SHA256). Two ways to populate:
  - **Scenario A — paranoid mode:** bank operator runs `complyverse-agent cred set` on the agent host; credentials never leave the bank network.
  - **Scenario B — cloud-managed:** operator adds credentials in the dashboard; backend encrypts them in `integration_connections`; the agent pulls them on every heartbeat via `/grc/agents/fetch-creds`.

### Lifecycle

```
1. Operator creates the agent in the Setup Wizard          → status = pending
2. Cloud returns a one-time enrollment_token + install cmd
3. Bank IT runs the install command on the target machine
4. Agent calls /grc/agents/enroll with the token           → status = active
   Cloud destroys the enrollment_token (one-time-use) and issues a long-lived api_token
5. Agent heartbeats /grc/agents/heartbeat every 30 seconds
6. Agent fetches /grc/agents/fetch-creds                   ← creds for Collector mode
7. Agent fetches /grc/agents/jobs                          ← list of applicable CIS plugins
8. Agent executes the checks locally and POSTs results to /grc/agents/results
9. Results cascade into:
       • compliance_plugin_runs (audit-friendly immutable log)
       • Risk Posture composite score recalculation
       • Control coverage cascade (one plugin → N frameworks)
       • Evidence vault with hash-chained audit trail
```

### Token security model

- **Enrollment token:** one-time-use, expires on first call, SHA-256 hashed in DB.
- **API token:** long-lived but tenant-scoped, also hashed at rest. Revokable per agent.
- **SSH / WinRM / SQL credentials:** Fernet-encrypted per tenant. Decrypted at the moment of dispatch to the agent over HTTPS bearer auth.

This is the same outbound-only pattern that SWIFT Alliance Access, CrowdStrike Falcon, Tenable Nessus Agent, and Qualys Cloud Agent all use — the vendor never has a foothold inside the bank.

---

## Plugin Automation — the rule library

5,300+ CIS Benchmark rules pre-loaded across 5 runner types:

| Runner type     | Count  | What it scans                                       |
|-----------------|--------|-----------------------------------------------------|
| `windows_winrm` | 2,918  | Windows Server / Windows 11 hardening               |
| `linux_ssh`     | 1,763  | Debian / RHEL / Ubuntu hardening                    |
| `netdev_ssh`    | 262    | Cisco IOS / ASA configuration                       |
| `aws_readonly`  | 228    | AWS account configuration (IAM, S3, EC2, …)         |
| `oracle_sql`    | 184    | Oracle Database hardening                           |

Each plugin is a `check_definition`: a runner command + an expected result. Operators can:

- **Filter** by severity, runner type, or benchmark.
- **Bulk-approve** rules per tenant (or leave on `auto_approved` for known-safe CIS controls).
- **Scan All** against every connected asset, or scan individually.
- **Upload a CIS Benchmark PDF** — the parser extracts every rule into a new plugin set.
- **Hand-author** plugins when the parser can't synthesise an executable check.

Runs are immutable: every execution writes one row to `compliance_plugin_runs` with the raw output (truncated), pass/fail status, timestamp, and a SHA-256 evidence hash for auditor chain-of-custody.

---

## Risk Posture — composite scoring

Each scanned asset gets a single 0–100 risk score combining five dimensions:

```
Score = 25% × CIS gap
      + 30% × vulnerability load
      + 15% × CIA criticality
      + 15% × control coverage gap
      + 15% × linked-risk residual
```

Weights are **per-tenant tunable** via the **⚙ Tune weights** modal — banks adjust them to match their own risk philosophy. Built-in `Banking (default)` preset; saving custom values writes a row to `grc_tenant_risk_weights` with `preset_name = "Custom"` and `updated_by = <user_id>`.

Dimensions with no data are **excluded and renormalized** — so a brand-new asset with only one CIS scan and no vuln data still gets a usable score, weighted entirely on what's actually measurable. The UI's **Data Quality** column shows what percentage of the formula could be computed.

Bands:

- **0–24:** Low
- **25–49:** Moderate
- **50–74:** High
- **75–100:** Critical

---

## Setup Wizard — one button, five steps

Replaces the older scattered `+ Install New Agent` + `⚡ Bulk Enroll` buttons with a single guided flow:

1. **Method** — Agentless (cloud-direct WinRM/SSH/SQL) vs With Agent (outbound program).
2. **Type** — Endpoint (1 PC = 1 agent, scans itself) vs Collector (1 VM = many targets).
3. **How many** — Single / Bulk paste / From Discovery. The wizard recommends Single for Collector and Bulk for Endpoint; either is allowed.
4. **Configure** — hostnames or single agent name + target OS.
5. **Done** — install commands, CSV download, and a 3-step deploy guide explaining what the operator does vs what AD GPO does automatically.

The Bulk Discovery page has a `⚡ Send N hostnames to Bulk Enroll` button that handoffs reachable hosts to the wizard at step 4 with everything pre-filled.

---

## Tech stack

- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, asyncpg/psycopg.
- **Database:** PostgreSQL 18, multi-tenant schemas (`public` for shared lookup tables, `tenant_<slug>` for per-bank data).
- **Frontend:** Vite + React 18 + Tailwind CSS + React Query + Wouter (routing).
- **Agent:** Python 3.11, paramiko (SSH), pywin32 (Windows DPAPI vault), cryptography (Fernet for Linux vault), Tkinter (tray UI).
- **Packaging:** NSIS (Windows installer), NSSM (Windows service), `dpkg-deb` / RPM (Linux), GPO PowerShell + Ansible templates (mass deploy).
- **Encryption:** Fernet at rest, bearer tokens over HTTPS, optional code-signing for the Windows agent.

---

## Running locally

Tested on Windows + WSL Ubuntu.

```bash
# 1. Database — PostgreSQL 18 on port 5433 (any port works; update DATABASE_URL).
# 2. Copy .env.example to .env in each of:
#    .migration-backup/backend/
#    artifacts/api-server/
#    artifacts/grc-frontend/
#    Fill in DATABASE_URL, SESSION_SECRET, OPENAI_API_KEY (optional).

# 3. Backend (port 5000)
cd .migration-backup/backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload

# 4. Express proxy (port 8080) — proxies /api/* → backend /grc/*
pnpm --filter @workspace/api-server run dev

# 5. Frontend (port 20080)
PORT=20080 BASE_PATH=/ pnpm --filter @workspace/grc-frontend run dev
```

Open <http://localhost:20080/login>.

For Replit / one-command launch, see `scripts/start-all.sh`.

---

## Status

What's done:

- ✅ Multi-tenant FastAPI backend with 185+ tables
- ✅ 5,300+ CIS plugins seeded across 5 runner types
- ✅ Agent enrollment, heartbeat, fetch-creds, fetch-jobs, push-results — end-to-end verified
- ✅ Endpoint + Collector modes, Scenario A + B credentials, GPO mass-deploy script, Bulk Enroll API
- ✅ Setup Wizard, Bulk Discovery, Risk Posture with tunable weights, Plugin Automation page
- ✅ RBAC: 3 granular permissions (`compliance:scan:execute`, `compliance:agents:manage`, `compliance:discover:execute`) and the **Scanning Admin** preset role
- ✅ Audit log with structured AI-summary support, evidence chain-of-custody hashing
- ✅ ComplyChat (SQL-only RAG) for natural-language Q&A on GRC data

What's next:

- 🔄 EV code-signing certificate for the Windows agent (currently self-signed)
- 🔄 SBOM publication + Snyk/Trivy CI gate
- 🔄 mTLS for agent ↔ cloud (currently bearer tokens over HTTPS)
- 🔄 Pre-built regional frameworks (SAMA, NCA, UAE IA) — currently uploaded as custom
- 🔄 Real-device verification on Cisco / Oracle lab hardware
- 🔄 GPO mass-deploy validation in a real Active Directory environment

---

## License

Private — not open source. All rights reserved.

For collaboration: contact [@hasanshahidd](https://github.com/hasanshahidd).
