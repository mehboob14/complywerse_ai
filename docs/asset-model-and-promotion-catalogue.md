# Asset model & promotion catalogue

What kinds of asset the platform holds, which fields each kind legitimately
carries, where those fields come from, and which software becomes a child asset
of which parent.

Derived from the live benchmark library (201 benchmarks / 35,364 rules after
excluding ARCHIVE, parser-misfire and stub rows) and the actual collector code —
not from a wish list.

---

## 1. Asset classes

| Class | Enters inventory via | Reached by | Benchmarks |
|---|---|---|---|
| **Windows host** (client + server) | Discovery sweep → credential → deep collect | WinRM 5985/5986 | 25 (Win 10/11, Server 2008→2025) |
| **Linux / Unix host** | Discovery sweep → credential → deep collect | SSH 22 | 31 (Ubuntu, RHEL, Debian, Alma, Oracle, Amazon, SUSE, FreeBSD) |
| **macOS endpoint** | Agent (WinRM/SSH not typical) | SSH | 9 (Monterey → Tahoe) |
| **Network device** | Named target (a sweep can't credential it) | SSH / `netdev_ssh` | 14 (Cisco IOS-XE/NX-OS/ASA/Firepower, Juniper, FortiGate, Palo Alto, pfSense, F5, Aruba) |
| **Hypervisor** | Named target | SSH | 1 (ESXi 8.0) |
| **Cloud / SaaS account** | Named target + API credential | provider API | 19 (AWS, Azure, GCP, M365, Google Workspace, GitHub, Alibaba, IBM Cloud, DigitalOcean, Oracle Cloud) |
| **Container platform** | Named target | kubeconfig / SSH | 3 (AKS, Google COS) |
| **Application** *(child asset)* | **Promoted from a host's detected software** | the parent's connection | 36 keys — see §3 |

---

## 2. Field matrix — which fields apply to which class

`AUTO` = machine-collected · `MANUAL` = human/CMDB · `n/a` = does not exist for
that class and must not be rendered.

| Field | Windows / Linux host | Network device | Cloud account | Application (child) |
|---|---|---|---|---|
| host_name / ip_address | AUTO | AUTO | n/a | inherited from parent |
| fqdn, primary_mac | AUTO | AUTO | n/a | inherited from parent |
| network_segment | AUTO (campaign scope) | AUTO | n/a | inherited from parent |
| internet_facing | AUTO (from IP class) | AUTO | always true | inherited from parent |
| os_family / os_version / os_normalized | AUTO | AUTO (IOS-XE etc.) | n/a | the **software** key + version |
| os_build / os_edition | AUTO | n/a | n/a | **n/a** |
| manufacturer / model / serial_number | AUTO | n/a (SSH exposes none) | n/a | **n/a** — belongs to the host |
| cpu_cores / memory_gb / storage_gb | AUTO | n/a | n/a | **n/a** — belongs to the host |
| detected_software_json | AUTO | n/a | n/a | n/a |
| security_posture (AV/EDR) | AUTO | n/a | n/a | n/a |
| cloud_resource_id | n/a | n/a | AUTO | n/a |
| parent_asset_id | n/a | n/a | n/a | **the host it runs on** |
| owner, custodian, department, location | MANUAL | MANUAL | MANUAL | inherited, overridable |
| criticality, C/I/A, data_classification | MANUAL | MANUAL | MANUAL | inherited from parent |
| purchase cost/date, warranty, EOL | MANUAL | MANUAL | n/a | n/a |

**Rule:** never render a field a class cannot have. A wall of `—` reads as
"data missing" when the truth is "not applicable" — that was the original
complaint about the promoted PostgreSQL page.

---

## 3. Promotion catalogue — software → child asset

36 software keys have a CIS benchmark, so each can become a child asset that is
independently scanned, owned and scored.

### Runs on a Windows host

| Software | Benchmark | Rules |
|---|---|---|
| SQL Server 2012 / 2014 / 2019 / 2022 / 2025 | CIS MSSQL | 42–49 |
| IIS 8 / 10 | CIS Microsoft IIS | 55 |
| Exchange Server 2019 | CIS Exchange | 55 |
| SharePoint 2016 / 2019 | CIS SharePoint | 37–38 |
| Microsoft Defender Antivirus | CIS Defender | 59 |

### Runs on a Linux **or** Windows host

| Software | Benchmark | Rules |
|---|---|---|
| PostgreSQL 13–18 | CIS PostgreSQL | 71–72 |
| MySQL 8.0 / 8.4 | CIS Oracle MySQL | 84–86 |
| Oracle DB 19c / 23ai / 26ai | CIS Oracle Database | 90–93 |
| IBM DB2 12.1 | CIS DB2 | 190 |
| MongoDB 6 / 7 / 8 | CIS MongoDB | 23 |
| Cassandra 4.0 / 4.1 / 5.0 | CIS Cassandra | 20 |
| Apache HTTP 2.2 / 2.4 | CIS Apache HTTP | 82–87 |
| Tomcat 8 / 9 / 10 / 10.1 | CIS Tomcat | 61–63 |
| NGINX | CIS NGINX | 44 |
| IBM WebSphere Liberty | CIS WebSphere | 113 |

**Parent rule:** a promoted application's parent is always the host whose
`detected_software_json` produced it. It inherits *where it lives* (fqdn, mac,
network segment, exposure, last-seen, record source) and *business context*
(owner, criticality, C/I/A, classification). It never inherits the host's
chassis or capacity.

---

## 4. Common bank software with **no** CIS benchmark

Present in real estates, found by the collector, but not scannable — CIS
publishes nothing for them:

Redis · GitLab · Odoo · Docker Engine · WSL · Microsoft Office LTSC ·
Node.js · Python · Chrome / Edge · Zoom · WinRAR · Postman · VS Code

These should **not** silently become assets: a child asset that can never be
scanned is a row that inflates counts and reports 0% coverage forever.

Two defensible options:
1. Leave them in `detected_software_json` (current behaviour) — visible in the
   software table, not an asset.
2. Offer an explicit **"Promote anyway"** for licence/lifecycle tracking,
   flagged `no benchmark available` so nobody expects a scan.

Recommended: (2) as an explicit operator action, never automatic.

---

## 5. Gaps found while compiling this

- **Runner mismatches** (~2,000 rules): PostgreSQL/MySQL benchmarks tagged
  `linux_ssh` instead of `postgres_sql`/`mysql_sql`; MSSQL tagged
  `windows_winrm` instead of `mssql_sql`; Defender tagged `linux_ssh` instead of
  `windows_winrm`; several Cisco benchmarks `linux_ssh` instead of `netdev_ssh`.
  A promoted database child will scan over the wrong transport until fixed.
- **Duplicate exposure columns**: `internet_facing` (criticality, asset page) vs
  `is_internet_facing` (risk posture). Nothing keeps them in sync.
- **1,368 rules carry no `os_keys`** — they can never match any asset.
- **14 benchmarks are entirely keyless** — dead weight in the library.
