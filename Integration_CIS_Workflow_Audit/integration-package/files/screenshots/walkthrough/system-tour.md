# System Tour — Which Command Runs on Which PC, Where Cisco Sits, How and Why

Bilkul system ke real code se. Har step ke saath file path + line number diya hai — tu khud verify kar sakta hai.

---

## CAST OF CHARACTERS (4 different machines)

| Machine            | Role                       | OS              | Agent installed? |
|--------------------|----------------------------|-----------------|------------------|
| **Mehboob ka laptop** | Operator (browses dashboard) | Windows/Mac     | No — sirf browser |
| **Cloud server**   | Compliverse backend         | Linux (cloud)   | No — yeh backend hai |
| **Bank ka Linux VM** | Collector host             | Linux           | YES — collector mode |
| **Hassan ka PC**   | Endpoint target             | Windows         | YES — endpoint mode |
| **Cisco router 10.0.0.5** | Scan target only         | IOS             | NEVER — router pe agent install nahi hota |

---

## STEP 1 — Mehboob clicks "Install Agent" (Mehboob ka laptop)

**Kya hua:** Mehboob browser mein dashboard pe `+ Install New Agent` button dabata hai.

**Code:** [artifacts/grc-frontend/src/app/(dashboard)/admin/agents/page.tsx:183-200](artifacts/grc-frontend/src/app/(dashboard)/admin/agents/page.tsx:183)

```tsx
<button onClick={() => setNewAgentMode('collector')}>
  <div>Collector (1 agent / LAN)</div>
  <div>Installed on one LAN box. Scans neighbors using stored credentials.</div>
</button>
<button onClick={() => setNewAgentMode('endpoint')}>
  <div>Endpoint (1 agent / host)</div>
  <div>One agent per machine. Pushed via GPO / SCCM / Intune / Ansible.</div>
</button>
```

**Mehboob fills form:**
- Name: `cisco-collector-vm`
- Mode: `Collector`
- Target OS: `Linux` ← matlab collector VM Linux pe hogi

**Submit click karta hai** → POST `/grc/agents/enroll` cloud server pe.

---

## STEP 2 — Cloud backend generates install command (Cloud server)

**File:** [.migration-backup/backend/grc/modules/agents/router.py:198-203](.migration-backup/backend/grc/modules/agents/router.py:198)

```python
install_win = f"iex (irm '{backend_url}/agent/install.ps1?token={raw_enroll}')"
install_linux = f"curl -sSL '{backend_url}/agent/install.sh?token={raw_enroll}' | sudo bash"
```

**Backend ne 2 lines generate ki:**

```
WINDOWS:  iex (irm 'https://compliverse.app/agent/install.ps1?token=enroll_a8f3c2...')
LINUX:    curl -sSL 'https://compliverse.app/agent/install.sh?token=enroll_a8f3c2...' | sudo bash
```

Yeh dono Mehboob ke browser mein UI pe dikhti hain — Mehboob copy karta hai.

**Why both?** Kyunki agent kisi bhi OS pe baith sakta hai. Mehboob ko apne target ke OS ke hisaab se choose karna hai.

---

## STEP 3 — Mehboob copies command, walks to the Linux VM

**Yahan switch hota hai PC.** Mehboob apna laptop chhod ke **bank ke server room** mein jata hai. Wahan ek Linux VM hai jo same network mein hai jis network mein Cisco routers hain.

**Linux VM pe SSH karke (or console pe paste karke):**

```bash
$ curl -sSL 'https://compliverse.app/agent/install.sh?token=enroll_a8f3c2...' | sudo bash
```

**File jo yeh command actually karta hai:** [.migration-backup/backend/grc/modules/agents/downloads.py:154-178](.migration-backup/backend/grc/modules/agents/downloads.py:154)

```sh
#!/bin/sh
TMP_DEB=$(mktemp /tmp/complyverse-agent-XXXXXX.deb)
echo "==> Downloading agent .deb from {backend_url}..."
curl -sSL '{backend_url}/agent/install.deb' -o "$TMP_DEB"
echo "==> Installing .deb..."
dpkg -i "$TMP_DEB" || apt-get install -f -y
rm -f "$TMP_DEB"
echo "==> Enrolling agent..."
sudo -u complyverse /opt/complyverse-agent/bin/complyverse-agent enroll \
    --backend '{backend_url}' --token '{token}'
echo "==> Starting service..."
systemctl enable --now complyverse-agent
```

**4 cheezen hoti hain Linux VM pe:**
1. `.deb` file download (~20KB)
2. `dpkg -i` se install (creates `/opt/complyverse-agent/`, creates `complyverse` system user)
3. Agent ko enroll karta hai — token bhej kar long-lived API token mil jata hai
4. `systemctl enable --now` — agent ab background service ban gaya, reboot ke baad bhi chalega

**Linux VM ab "agent #28" hai cloud ki nazar mein, status: active.**

---

## STEP 4 — Operator adds Cisco credentials (back to Mehboob's laptop)

**Yahan se important:** Linux VM pe agent install ho gaya, **lekin agent ko abhi tak nahi pata Cisco router kahan hai**. Yeh operator add karta hai dashboard se.

**Dashboard mein:**
1. Connect Wizard kholi → "Network Devices" tab
2. New connection add karta hai:
   - Type: `netdev_ssh` (Cisco)
   - Host: `10.0.0.5`
   - Username: `svc-compliverse`
   - Password: `••••••••`
   - **Collector agent**: `cisco-collector-vm` ← yahan select karta hai

**Code jo cred ko encrypt karta hai cloud DB mein:** [.migration-backup/backend/grc/modules/compliance_plugins/services/credentials.py](.migration-backup/backend/grc/modules/compliance_plugins/services/credentials.py)

Yeh row `integration_connections` table mein save hoti hai with `assigned_agent_id=28`.

---

## STEP 5 — Agent heartbeat picks up the new cred (Linux VM)

**Linux VM pe agent har 30 second pe cloud ko ping karta hai.** Agent code:

**File:** `.migration-backup/backend/agent/complyverse_agent/jobs.py` (function `tick()`):

```python
def tick():
    heartbeat()                    # POST /grc/agents/heartbeat
    fetch_collector_creds()         # GET  /grc/agents/fetch-creds  → encrypted creds
    jobs = fetch_jobs()             # GET  /grc/agents/jobs         → list of scans
    for j in jobs:
        result = execute_job(j)     # actually SSH to Cisco
        push_result(result)         # POST /grc/agents/results
```

**`fetch_collector_creds()`** cloud se Cisco router ka encrypted credential utha kar agent ke **local vault** mein save kar deta hai. Local vault = Fernet-encrypted file on the Linux VM at `/opt/complyverse-agent/var/vault.cv`.

---

## STEP 6 — Cloud assigns a CIS scan job (Cloud server)

Cloud ke pas CIS Cisco IOS benchmark hai (`CIS_Cisco_IOS_Benchmark_v4`). Backend agent #28 ko bolega:

```json
{
  "job_id": 9001,
  "asset_id": 17,
  "check_definition": {
    "command": "show running-config | include enable secret",
    "expect": {"kind": "stdout_contains", "value": "enable secret"},
    "timeout_seconds": 15
  },
  "credential_id": "cisco-10-0-0-5"
}
```

**Yeh 50 check definitions hoti hain ek scan mein.** Cisco benchmark mein ~150 rules hain.

---

## STEP 7 — Agent SSH-es to Cisco router (Linux VM → Cisco router)

**File:** [.migration-backup/backend/agent/complyverse_agent/collector_ssh.py:1-35](.migration-backup/backend/agent/complyverse_agent/collector_ssh.py:1)

```python
"""SSH collector — agent's collector-mode executor.

Used when the agent is installed on one Linux/Windows VM inside the bank
network and needs to scan OTHER devices (Cisco switches, Linux servers,
even Oracle if you tunnel through SSH) on behalf of the cloud.
"""

import paramiko

# Agent reads cred from local vault
cred = vault.get_collector_cred("cisco-10-0-0-5")
# cred = {"type":"ssh","host":"10.0.0.5","port":22,
#         "username":"svc-compliverse","password":"..."}

client = paramiko.SSHClient()
client.connect(cred["host"], port=cred["port"],
               username=cred["username"], password=cred["password"])

# Run the CIS-defined command
stdin, stdout, stderr = client.exec_command(check["command"])
output = stdout.read().decode()

# Apply the expectation (stdout_contains "enable secret")
if check["expect"]["value"] in output:
    result = {"status": "passed"}
else:
    result = {"status": "failed"}
```

**Yahan critical baat:**
- SSH connection **Linux VM se Cisco router** pe ja raha hai (local LAN, fast, no firewall problem)
- Cred **Linux VM ke local vault** se aaya, cloud se nahi
- Output (config dump) **Linux VM mein process hota hai**, cloud ko sirf pass/fail jaata hai

**Why this matters:** Bank ka raw `running-config` (jisme passwords, IPs sab hain) kabhi cloud pe nahi jata. Cloud ko sirf 0/1 status milta hai. **Senior ka "paranoid mode" yahi hai.**

---

## STEP 8 — Agent pushes result back (Linux VM → Cloud)

```python
push_result({
    "job_id": 9001,
    "status": "passed",
    "evidence_hash": "sha256:...",
    "completed_at": "2026-05-22T14:30:00Z"
})
```

Cloud DB mein `compliance_plugin_runs` table update ho jata hai. Dashboard pe Mehboob refresh karta hai → Cisco router 10.0.0.5 ka scan result dikh jata hai.

---

## SIDE-BY-SIDE — Same flow Endpoint mode mein

**Hassan ka Windows laptop** scan karna hai. Mehboob:

1. **Dashboard pe form:** Name = `hassan-laptop`, Mode = **Endpoint**, OS = **Windows**
2. **Backend ne yeh command generate ki:**
   ```
   iex (irm 'https://compliverse.app/agent/install.ps1?token=enroll_b9e7d1...')
   ```
3. Mehboob yeh command **Hassan ke laptop pe** Admin PowerShell mein paste karta hai (not on his own laptop)
4. **PowerShell wrapper:** [.migration-backup/backend/grc/modules/agents/downloads.py:124-139](.migration-backup/backend/grc/modules/agents/downloads.py:124)
   - Downloads `ComplyverseAgent-Setup.exe`
   - Runs silently: `setup.exe /S /TOKEN=enroll_b9e7d1... /BACKEND=https://...`
   - NSIS installer → C:\Program Files\Compliverse\Agent\ + registers as Windows Service via NSSM
5. **Agent #29 active** ho gaya Hassan ke laptop pe
6. **Cloud assigns Windows CIS jobs** (e.g. `Win11 Benchmark`)
7. Agent **apne hi laptop pe** scan karta hai (no SSH, no remote — local commands)

   **File:** `.migration-backup/backend/agent/complyverse_agent/local_windows.py`
   ```python
   # user_rights_check via secedit
   subprocess.run(["secedit", "/export", "/cfg", tmp_path])
   # Read tmp_path, parse, compare with CIS expected value
   ```
8. **No credentials needed!** Agent local hai, local files padh sakta hai (registry, secedit, sc query, etc.). Yeh **Endpoint mode** ka core difference hai — no SSH, no creds.

9. **Mass deploy:** Same `install.ps1` command 500 PCs pe push karne ke liye GPO/SCCM use karte hain. File: `.migration-backup/backend/agent/packaging/deploy_templates/gpo-startup.ps1`. Senior ka "Mehboob admin login + git repo se multi-user PCs me install" — yahi hai.

---

## WHY (this whole architecture)

| Decision                         | Reason                                                    |
|----------------------------------|-----------------------------------------------------------|
| Cisco/Oracle pe agent NAHI install hota | Cisco IOS me 3rd-party software install karna allowed nahi hai. Sirf SSH se config dump milta hai. |
| Agent ke 3 OS options: Win/Lin/Mac | Agent ek Python program hai — kisi real OS pe chahiye |
| Collector mode SSH karta hai     | 1 agent → 50 routers scan kar sake. Har router pe install impossible. |
| Endpoint mode local commands chalata hai | Local files (registry, secedit) ke liye SSH ki zaroorat nahi |
| Encrypted vault on agent (Fernet) | Bank cred cloud pe na rahe — agent local vault use kare |
| Same install.ps1 for 1 PC or 500 PCs | Mass deploy = same script GPO se sab pe push, har PC apna agent install kar leta hai |

---

## SENIOR'S 11 INSTRUCTIONS — MAPPED TO THIS FLOW

1. **NSIS .exe for Windows** → STEP 7 Endpoint flow. File: `.migration-backup/backend/agent/packaging/windows/install_demo.nsi`
2. **Agent on Windows scans network devices via SSH** → Collector mode. Yeh aap chah rahe the.
3. **Credentials with SSH** → STEP 4 + 5. Cred encrypt, vault, paramiko.
4. **Scenario A: Bank types creds locally** → Agent ka tray UI (`tray_ui.py`) — bank operator agent box pe baith ke `complyverse-agent cred set` chalata hai
5. **Scenario B: Bank gives creds to cloud, pre-deployed agents** → STEP 4 dashboard flow
6. **Mehboob ke git repo se multi-user PCs me install** → STEP 9 mass deploy (GPO/SCCM)
7. **Agents auto-pickup** → STEP 5 (`fetch_collector_creds` + `fetch_jobs` har 30 sec)
8. **Mehboob doesn't run scans himself** → RBAC permission `compliance:scan:execute` — Mehboob ke pas nahi hoti by default
9. **Banking user / risk user no scan rights** → Same RBAC — `compliance:scan:execute` permission unhe assign nahi hoti
10. **Scanning Admin role** → Tenant schema mein `Scanning Admin` preset role bana hua hai with the 3 perms
11. **Multi-platform: Win + Linux + Oracle + Cisco + AWS** →
    - Windows + Linux: Endpoint mode
    - Cisco: Collector via SSH (paramiko)
    - Oracle: Collector via SQL*Net (oracle_runner)
    - AWS: Collector via boto3 (aws_runner)
    - File: `.migration-backup/backend/grc/modules/compliance_plugins/runners/registry.py`

---

## TLDR — 3 sentences

1. **Agent kahan install hota hai** = "Target OS" dropdown (Windows/Linux/macOS only — because agent needs an OS to run on)
2. **Agent kya scan karta hai** = MODE choice:
   - **Endpoint** = sirf apni host (local files via PowerShell/secedit). No creds. Mass deploy via GPO.
   - **Collector** = network neighbors (Cisco/Oracle/AWS) via SSH/SQL/API. Needs creds in vault. 1 agent → many targets.
3. **Cisco/Oracle/AWS dropdown me nahi aate** kyunki yeh **scan targets** hain (agent install nahi hota), agent unhe **dur se scan** karta hai Collector mode mein.

Senior ka full 11/11 yeh same architecture ke through deliver hota hai.
