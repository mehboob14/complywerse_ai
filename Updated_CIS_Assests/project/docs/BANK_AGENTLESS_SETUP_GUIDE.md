# Compliverse — Agentless (Cloud-Direct) Setup Guide

**Audience:** Bank IT / InfoSec admin
**Time required:** 30-60 minutes (most of which is firewall change approval)
**Result:** Compliverse cloud will scan your Windows / Linux / Cisco / Oracle / VMware estate without any software installed on your hosts.

---

## 1. How it works (one paragraph)

Compliverse runs in cloud. Your devices stay in your network. We do not deploy any agent on your machines. Instead, your firewall allows our static IPs to reach specific management ports on your hosts (WinRM 5986, SSH 22, Oracle 1521, vCenter 443). We use the credentials you provide — encrypted in our vault — to run read-only CIS benchmark checks against each host and report findings back to your Compliverse dashboard. Every check is read-only; no configuration is ever modified.

If your security policy does **not** allow inbound firewall changes, see the Agent-Install Setup Guide instead (separate doc).

---

## 2. Step 1 — Whitelist Compliverse egress IPs

Log in to Compliverse as an Administrator and visit:

```
Administration → Onboarding → Cloud Egress IPs
```

Or hit the endpoint directly:

```
GET https://<your-tenant>.compliverse.app/api/onboarding/egress-ips
```

You will see a list like:

```json
{
  "region": "ap-south-1",
  "ips": ["203.0.113.45", "203.0.113.46"],
  "ports": [
    { "port": 5986, "purpose": "WinRM HTTPS (Windows hosts)" },
    { "port": 22,   "purpose": "SSH (Linux + Cisco network devices)" },
    { "port": 443,  "purpose": "VMware vCenter / ESXi REST API" },
    { "port": 1521, "purpose": "Oracle TNS Listener (Database)" }
  ]
}
```

Add an **ALLOW** rule in your firewall:

```
SOURCE      = <Compliverse egress IPs>
DESTINATION = <your scoped management subnets>
PORTS       = TCP 22, 443, 1521, 5986
ACTION      = ALLOW
```

Restrict the destination to only the management subnets that contain devices Compliverse should scan. Do not open these ports to the whole estate unless necessary.

---

## 3. Step 2 — Per-platform host preparation

### 3.1 Windows hosts (WinRM)

By default, WinRM is **disabled** on workstations and only available on servers. Enable it on each host you want scanned. The standard way is via Group Policy (GPO) — applies to thousands of PCs in one push:

```
Computer Configuration
  → Policies
    → Windows Settings
      → Security Settings
        → System Services
          → Windows Remote Management (WS-Management)
            = Automatic
```

Then add a firewall inbound rule (in the same GPO):

```
Port            = 5986
Protocol        = TCP
Profile         = Domain
Scope (local)   = Any
Scope (remote)  = <Compliverse egress IPs>
Action          = Allow
```

Create a dedicated read-only service account in Active Directory:

```
Username:   COMPLIVERSE\svc-compliverse
Group:      Add to "Remote Management Users" on each target host
Permissions: Read-only — no local admin, no domain admin
```

### 3.2 Linux hosts (SSH)

Ensure SSH is running and accessible from the Compliverse egress IPs. Create a dedicated read-only user:

```bash
sudo useradd -m -s /bin/bash svc-compliverse
sudo passwd svc-compliverse   # or set up SSH key auth (preferred)
# Restrict sudo: NONE — this account never needs sudo for CIS reads
```

If you use SSH key auth (preferred), share the public key with Compliverse via the dashboard's **Credentials** section. Never paste private keys to support.

### 3.3 Cisco IOS / NX-OS / ASA / Firepower (SSH)

Create a read-only user on each device:

```
! Cisco IOS / IOS-XE / NX-OS
username svc-compliverse privilege 1 secret <strong-password>
ip ssh server algorithm publickey ssh-rsa rsa-sha2-256 rsa-sha2-512
```

`privilege 1` is read-only. Compliverse will run `show running-config`, `show version`, `show snmp`, `show ip ssh`, and similar non-modifying commands.

### 3.4 Oracle Database (SQL)

Create a read-only DBA user:

```sql
CREATE USER svc_compliverse IDENTIFIED BY <strong-password>;
GRANT CREATE SESSION TO svc_compliverse;
GRANT SELECT ON DBA_USERS                 TO svc_compliverse;
GRANT SELECT ON DBA_ROLES                 TO svc_compliverse;
GRANT SELECT ON DBA_ROLE_PRIVS            TO svc_compliverse;
GRANT SELECT ON DBA_SYS_PRIVS             TO svc_compliverse;
GRANT SELECT ON DBA_TAB_PRIVS             TO svc_compliverse;
GRANT SELECT ON DBA_AUDIT_TRAIL           TO svc_compliverse;
GRANT SELECT ON DBA_PROFILES              TO svc_compliverse;
GRANT SELECT_CATALOG_ROLE                 TO svc_compliverse;
```

Open **TCP 1521** to the database listener from Compliverse egress IPs.

### 3.5 VMware vCenter / ESXi (REST API)

In vCenter, create a custom role with **System.Read** permission only — no edit/delete. Assign the role to a service account at the root vCenter level:

```
User:   svc-compliverse@vsphere.local
Role:   Compliverse Read-Only Auditor
Scope:  Root inventory (recursive)
```

Open **TCP 443** to the vCenter endpoint from Compliverse egress IPs.

---

## 4. Step 3 — Add credentials in Compliverse

Log in to Compliverse as Administrator. For each scannable device:

```
Administration → Integrations → + Add Connection
  Type        = Windows WinRM  (or Linux SSH / Oracle SQL / VMware vCenter / Cisco SSH)
  Host        = <ip-or-fqdn>
  Port        = <default for type>
  Username    = svc-compliverse
  Password    = <as set above>
```

Compliverse encrypts the password at rest using Fernet (AES-128-CBC + HMAC-SHA256) before storing. Plaintext never persists.

After saving, click **Test Connection** in the same row. You should see:

```
✓ Connection successful — auth as DOMAIN\svc-compliverse
```

If you see auth failed / network unreachable, check the firewall rule + credential typo before proceeding.

---

## 5. Step 4 — Run your first scan

```
Compliance Plugins → All benchmarks (filter by platform)
  → Scan All
```

A confirmation modal will show: `2918 rules × 1 host = X total checks, ~Y minutes`. Click confirm. Scans run in cloud — your hosts only see brief read-only WinRM/SSH/SQL/HTTPS sessions originating from the Compliverse egress IPs you whitelisted.

---

## 6. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Test Connection` shows `network_unreachable` | Firewall rule not active or wrong port | Verify the ALLOW rule scope. Run `Test-NetConnection <host> -Port 5986` from a known-good host. |
| `Test Connection` shows `auth_failed` | Service account password expired or rejected | Reset password in AD / on host, re-enter in Compliverse. |
| WinRM works for some hosts, not others | WinRM disabled on those workstations | Apply the WinRM GPO + reboot the workstation, or run `Enable-PSRemoting -Force` locally. |
| All Oracle scans show `network_unreachable` | TNS Listener not exposed | Verify `lsnrctl status` shows the service registered on 1521. |
| vCenter test passes but ESXi rules fail | vCenter user lacks ESXi host scope | Re-assign the read-only role at the **vCenter root** (not the cluster level). |

---

## 7. Security commitments from Compliverse

1. **Read-only by contract.** Every runner refuses to execute write commands at the code level (verified at code review and via automated test suite).
2. **Encryption at rest.** Credential passwords are stored as `enc:v1:<Fernet-AEAD blob>` — DB dumps never expose plaintext.
3. **RBAC enforced.** Only users with `compliance:scan:execute` permission can trigger scans. Banking / risk-management users see the Scan button greyed out.
4. **Audit log.** Every scan trigger writes to `grc_audit_logs` with operator, timestamp, and scope.
5. **Tenant isolation.** Each bank's credentials live in a separate tenant-scoped vault. Cross-tenant access is impossible at the SQL layer.

---

## 8. Need help?

- **Slack / email:** support@compliverse.app
- **Setup verification call:** Compliverse onboarding engineer joins a 30-min call to walk through the firewall change with your security team.

---

_Last updated: Phase 3 release. Compliverse Platform v1.0._
