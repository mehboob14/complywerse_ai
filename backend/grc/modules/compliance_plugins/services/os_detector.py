"""One-shot OS detection used at Connect-Wizard handshake + Bulk-Discovery
import time. Populates `ITAsset.os_family`, `.os_version`, and
`.os_normalized` so the benchmark matcher can later route only the right
CIS rules to each host (Win-11 rules to Win 11, not to Server 2022).

The detector is best-effort:
  • If the probe succeeds, returns a normalized tuple.
  • If it fails for any reason (auth, parse, runtime), it returns
    (None, None, None) so the calling code can still create the asset
    without a version stamp — scan_all just won't filter on version for
    that one host, falling back to runner-type matching only.

We intentionally do NOT raise — failing to detect OS shouldn't block an
otherwise-successful onboarding.
"""
from __future__ import annotations

import re
from typing import Optional, Tuple


# ─── Canonical OS normaliser ────────────────────────────────────────────
#
# Each branch below maps raw detection output to a stable key the
# benchmark matcher can compare against. Keys are lowercase, hyphen-
# separated; major-version only by default. Sub-version specifics
# (24H2, R2, LTS) are captured in os_version for display, not the key.

_WIN_VERSION_RE = re.compile(
    r"\bwindows\s*(?P<v>11|10|8\.1|8|7|server\s+\d{4}(?:\s*r2)?)",
    re.IGNORECASE,
)
# Capture Windows DisplayVersion (24H2 / 23H2 / 22H2 / 21H2 / 21H1 /
# 20H2 / 1909 / etc.) — registry-read on the host, or sometimes embedded
# in WMI Caption strings on newer builds.
_WIN_DISPLAY_VERSION_RE = re.compile(r"\b(2[0-9]H[12]|1909|1903|1809|1803)\b", re.IGNORECASE)
# Capture Windows edition (Enterprise/Pro/Home/Education/LTSC).
_WIN_EDITION_RE = re.compile(
    r"\b(Enterprise|Education|Pro(?:\s*for\s*Workstations)?|Home|LTSC|Datacenter|Standard)\b",
    re.IGNORECASE,
)
# Capture Cisco IOS XE minor (17.9, 17.6, 16.12 etc.)
_CISCO_IOSXE_MINOR_RE = re.compile(r"ios[\s-]*xe.*?(\d+)\.(\d+)", re.IGNORECASE)

_UBUNTU_RE  = re.compile(r"ubuntu\s+(?P<v>\d+\.\d+)", re.IGNORECASE)
_DEBIAN_RE  = re.compile(r"debian.*\b(\d+)\b", re.IGNORECASE)
_ALMA_RE    = re.compile(r"alma\s*linux.*\b(\d+)\b", re.IGNORECASE)
_ORACLE_RE  = re.compile(r"oracle\s*linux.*\b(\d+)\b", re.IGNORECASE)
_AMAZON_RE  = re.compile(r"amazon\s*linux\s*(?P<v>\d{4})", re.IGNORECASE)
_RHEL_RE    = re.compile(r"red\s*hat.*\b(\d+)\b", re.IGNORECASE)
_CENTOS_RE  = re.compile(r"cent[o0]s.*\b(\d+)\b", re.IGNORECASE)
_ROCKY_RE   = re.compile(r"rocky\s*linux.*\b(\d+)\b", re.IGNORECASE)
_SUSE_RE    = re.compile(r"suse|sles", re.IGNORECASE)
_OPENSUSE_RE = re.compile(r"opensuse", re.IGNORECASE)
_FEDORA_RE  = re.compile(r"fedora", re.IGNORECASE)
_ALPINE_RE  = re.compile(r"alpine", re.IGNORECASE)
_PHOTON_RE  = re.compile(r"photon", re.IGNORECASE)
_KALI_RE    = re.compile(r"kali", re.IGNORECASE)
_ARCH_RE    = re.compile(r"arch\s*linux|manjaro", re.IGNORECASE)
_CISCO_RE   = re.compile(r"ios[\s-]*xe|nx-?os|asa|firepower", re.IGNORECASE)


def normalise_windows(raw: str, display_version: Optional[str] = None) -> Optional[str]:
    """Turn raw Win32_OperatingSystem.Caption (+ optional DisplayVersion)
    into a benchmark match key.

    When `display_version` is provided (read from registry value
    HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\DisplayVersion),
    we return the BUILD-specific key so the matcher routes Win 10 22H2
    rules only to 22H2 hosts, not to 21H2 hosts.

    Examples → returns:
      "Microsoft Windows 11 Pro", "23H2"   → "windows-11-23H2"
      "Microsoft Windows 11 Pro"           → "windows-11"
      "Microsoft Windows 10 Enterprise", "22H2" → "windows-10-22H2"
      "Microsoft Windows 10 Enterprise"    → "windows-10"
      "Microsoft Windows Server 2022 Std"  → "windows-server-2022"
      "Microsoft Windows Server 2008 R2"   → "windows-server-2008-r2"

    If the caption itself contains the display version (some WMI
    Caption strings on newer builds embed it), we'll pick that up too.
    """
    m = _WIN_VERSION_RE.search(raw)
    if not m:
        return None
    v = m.group("v").lower().strip()
    if v.startswith("server"):
        # "server 2022" → "windows-server-2022"; preserve "r2" suffix
        normalized = "windows-" + v.replace(" ", "-")
        return re.sub(r"-+", "-", normalized)

    base = f"windows-{v}"
    # Build resolution: prefer explicit display_version, fall back to
    # whatever is embedded in the Caption string.
    build = (display_version or "").strip()
    if not build:
        m2 = _WIN_DISPLAY_VERSION_RE.search(raw)
        if m2:
            build = m2.group(1)
    if build:
        # Canonical case for 22H2-style: digit + 'H' + digit
        build_clean = re.sub(r"^(\d+)h(\d+)$", lambda mm: f"{mm.group(1)}H{mm.group(2)}", build.lower())
        return f"{base}-{build_clean}"
    return base


def detect_windows_edition(raw: str) -> Optional[str]:
    """Extract Windows edition (Enterprise / Pro / Home / LTSC / Datacenter)
    from a Win32_OperatingSystem.Caption. Used to set asset.os_edition so
    the AI router can pick the right CIS benchmark edition variant.
    """
    m = _WIN_EDITION_RE.search(raw or "")
    return m.group(1).strip() if m else None


def detect_windows_build(raw: str, display_version: Optional[str] = None) -> Optional[str]:
    """Just the Windows build (22H2 / 23H2 / 1909) — used to populate
    asset.os_build alongside the normalized key.
    """
    if display_version:
        return display_version.strip()
    m = _WIN_DISPLAY_VERSION_RE.search(raw or "")
    return m.group(1) if m else None


def normalise_linux(raw: str) -> Optional[str]:
    """Parse `/etc/os-release` content into a benchmark match key.

    The caller hands us the full file contents; we extract the
    distro ID + major version. Returns None for unrecognised distros
    so the matcher knows to skip Linux-specific benchmarks on that host.
    """
    if not raw:
        return None
    low = raw.lower()
    if "ubuntu" in low:
        m = _UBUNTU_RE.search(raw) or re.search(r'VERSION_ID="?(\d+\.\d+)"?', raw)
        if m:
            ver = m.group(1) if m.lastindex == 1 else m.group("v")
            return f"ubuntu-{ver}"
        return "ubuntu"
    if "debian" in low:
        m = re.search(r'VERSION_ID="?(\d+)"?', raw) or _DEBIAN_RE.search(raw)
        if m:
            return f"debian-{m.group(1)}"
        return "debian"
    if "almalinux" in low or "alma" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw) or _ALMA_RE.search(raw)
        if m:
            return f"almalinux-{m.group(1)}"
        return "almalinux"
    if "oracle linux" in low or "ol-" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw) or _ORACLE_RE.search(raw)
        if m:
            return f"oraclelinux-{m.group(1)}"
        return "oraclelinux"
    if "amazon linux" in low or "amzn" in low:
        m = re.search(r'VERSION_ID="?(\d{4}|\d+)"?', raw) or _AMAZON_RE.search(raw)
        if m:
            ver = m.group(1) if m.lastindex == 1 else m.group("v")
            return f"amazonlinux-{ver}"
        return "amazonlinux"
    if "red hat" in low or "rhel" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw) or _RHEL_RE.search(raw)
        if m:
            return f"rhel-{m.group(1)}"
        return "rhel"
    if "rocky linux" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw) or _ROCKY_RE.search(raw)
        return f"rockylinux-{m.group(1)}" if m else "rockylinux"
    if "centos" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw) or _CENTOS_RE.search(raw)
        return f"centos-{m.group(1)}" if m else "centos"
    if "opensuse" in low:
        m = re.search(r'VERSION_ID="?(\d+\.\d+|\d+)', raw)
        return f"opensuse-{m.group(1)}" if m else "opensuse"
    if "suse linux enterprise" in low or "sles" in low:
        m = re.search(r'VERSION_ID="?(\d+(?:\.\d+)?)', raw)
        return f"sles-{m.group(1)}" if m else "sles"
    if "fedora" in low:
        m = re.search(r'VERSION_ID="?(\d+)', raw)
        return f"fedora-{m.group(1)}" if m else "fedora"
    if "alpine" in low:
        m = re.search(r'VERSION_ID="?(\d+\.\d+)', raw)
        return f"alpine-{m.group(1)}" if m else "alpine"
    if "photon" in low:
        m = re.search(r'VERSION_ID="?(\d+\.\d+|\d+)', raw)
        return f"photon-{m.group(1)}" if m else "photon"
    if "kali" in low:
        m = re.search(r'VERSION_ID="?(\d{4}\.\d+|\d{4})', raw)
        return f"kali-{m.group(1)}" if m else "kali"
    if "arch linux" in low or "manjaro" in low:
        return "manjaro" if "manjaro" in low else "arch-linux"
    return None


def normalise_cisco(raw: str) -> Optional[str]:
    """Map a network device's `show version` (or equivalent banner) output
    to a CIS-benchmark family key.

    Despite the legacy name, this function covers ALL network device
    families the netdev_ssh runner can probe — Cisco, Juniper Junos, Aruba
    AOS, F5 BIG-IP TMOS, Palo Alto PAN-OS, FortiOS. The matcher routes the
    matching CIS Network Device Benchmark per family.
    """
    if not raw:
        return None
    low = raw.lower()
    # ── Cisco family ──
    if "ios xe" in low or "ios-xe" in low:
        m_minor = re.search(r"ios[\s-]*xe.*?version\s+(\d+)\.(\d+)", low)
        if m_minor:
            return f"cisco-ios-xe-{m_minor.group(1)}.{m_minor.group(2)}"
        m_major = re.search(r"ios[\s-]*xe\s+(?:software,\s*)?version\s+(\d+)", low)
        return f"cisco-ios-xe-{m_major.group(1)}" if m_major else "cisco-ios-xe"
    if "nx-os" in low or "nxos" in low:
        m = re.search(r"nx-?os.*?version\s+(\d+)\.(\d+)", low)
        return f"cisco-nxos-{m.group(1)}.{m.group(2)}" if m else "cisco-nxos"
    if "adaptive security appliance" in low or " asa " in low:
        m = re.search(r"asa.*?version\s+(\d+)\.(\d+)", low)
        return f"cisco-asa-{m.group(1)}.{m.group(2)}" if m else "cisco-asa"
    if "firepower" in low:
        return "cisco-firepower"
    if "cisco ios" in low or low.startswith("ios "):
        # Classic IOS — older routers / switches
        m = re.search(r"version\s+(\d+)\.(\d+)", low)
        return f"cisco-ios-{m.group(1)}.{m.group(2)}" if m else "cisco-ios"
    if "meraki" in low:
        return "cisco-meraki"
    # ── Juniper ──
    if "junos" in low:
        m = re.search(r"junos\s+(?:os\s+)?(?:software\s+)?(?:release\s+)?\[?(\d+)\.(\d+)", low)
        return f"juniper-junos-{m.group(1)}.{m.group(2)}" if m else "juniper-junos"
    # ── Aruba ──
    if "arubaos" in low or "aruba os" in low:
        m = re.search(r"arubaos.*?(\d+)\.(\d+)", low)
        return f"aruba-aos-{m.group(1)}.{m.group(2)}" if m else "aruba-aos"
    if "aruba" in low and "switch" in low:
        return "aruba-os-switch"
    # ── F5 ──
    if "big-ip" in low or "tmos" in low:
        m = re.search(r"(?:big-?ip|tmos).*?(\d+)\.(\d+)", low)
        return f"f5-bigip-{m.group(1)}.{m.group(2)}" if m else "f5-bigip"
    # ── Palo Alto ──
    if "pan-os" in low or "panos" in low:
        m = re.search(r"pan-?os.*?(\d+)\.(\d+)", low)
        return f"paloalto-panos-{m.group(1)}.{m.group(2)}" if m else "paloalto-panos"
    # ── Fortinet ──
    if "fortios" in low or "fortigate" in low:
        m = re.search(r"v?(\d+)\.(\d+)", low)
        return f"fortinet-fortios-{m.group(1)}.{m.group(2)}" if m else "fortinet-fortios"
    # ── Check Point ──
    if "gaia" in low or "check point" in low or "checkpoint" in low:
        return "checkpoint-gaia"
    return None


# ─── Detection probes — runs ONE remote command per asset, best-effort ──

def detect_windows(creds: dict) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Returns (family, version, normalized, build, edition). Best-effort.

    Now reads two values:
      1. Win32_OperatingSystem.Caption  (e.g. "Microsoft Windows 11 Enterprise")
      2. HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\DisplayVersion
         (e.g. "23H2") — combined to produce build-level normalized keys.
    """
    try:
        import winrm  # type: ignore
    except ImportError:
        return ("windows", None, None, None, None)
    endpoint = creds.get("winrm_endpoint")
    if not endpoint:
        return ("windows", None, None, None, None)
    try:
        session = winrm.Session(
            endpoint,
            auth=(creds.get("winrm_username"), creds.get("winrm_password")),
            transport=(creds.get("winrm_transport") or "ntlm").lower(),
            server_cert_validation=(creds.get("winrm_server_cert_validation") or "ignore").lower(),
            read_timeout_sec=15,
            operation_timeout_sec=10,
        )
        # One round-trip pulls Caption + DisplayVersion together so we
        # only pay the WinRM connection cost once. Output format:
        #     <Caption>\n---\n<DisplayVersion>
        r = session.run_ps(
            "$c = (Get-CimInstance Win32_OperatingSystem).Caption; "
            "$d = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' "
            "      -Name DisplayVersion -ErrorAction SilentlyContinue).DisplayVersion; "
            "Write-Output ($c + \"`n---`n\" + $d)"
        )
        if int(r.status_code) != 0:
            return ("windows", None, None, None, None)
        raw_full = (r.std_out or b"").decode("utf-8", errors="replace").strip()
        parts = raw_full.split("\n---\n", 1)
        caption = parts[0].strip() if parts else raw_full
        display_version = parts[1].strip() if len(parts) > 1 else None
        normalized = normalise_windows(caption, display_version)
        build = detect_windows_build(caption, display_version)
        edition = detect_windows_edition(caption)
        # os_version display string: combine caption + build when available
        display = caption
        if display_version and display_version not in caption:
            display = f"{caption} {display_version}"
        return ("windows", display, normalized, build, edition)
    except Exception:  # noqa: BLE001 — best-effort, never bubble
        return ("windows", None, None, None, None)


def detect_linux(creds: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """SSH `cat /etc/os-release` — best-effort, never raises."""
    try:
        import paramiko  # type: ignore
    except ImportError:
        return ("linux", None, None)
    host = creds.get("ssh_host")
    port = int(creds.get("ssh_port") or 22)
    user = creds.get("ssh_username")
    password = creds.get("ssh_password")
    if not host or not user:
        return ("linux", None, None)
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, port=port, username=user, password=password,
                       timeout=10, allow_agent=False, look_for_keys=False)
        _, stdout, _ = client.exec_command("cat /etc/os-release 2>/dev/null", timeout=5)
        raw = stdout.read().decode("utf-8", errors="replace")
        client.close()
        # Pull the human-readable version line for display
        m = re.search(r'PRETTY_NAME="?([^"\n]+)"?', raw)
        display = m.group(1) if m else None
        return ("linux", display, normalise_linux(raw))
    except Exception:  # noqa: BLE001
        return ("linux", None, None)


# ─── Service discovery — runs alongside OS detection at handshake time ──
#
# Maps listening TCP ports to the canonical software_key the Host-
# Applications panel uses for "promote to peer asset" — so a Linux host
# connection ALSO surfaces "PostgreSQL is running on this box" without
# the operator having to install a per-service agent. The output feeds
# ITAsset.detected_software_json; the panel renders it as the amber
# "Promotable apps" list.

# Port → (software_key, display name). software_key matches the same level-2
# normalisation the room-scan benchmark matcher already uses.
_PORT_TO_SOFTWARE: dict[int, tuple[str, str]] = {
    22:    ("openssh",          "OpenSSH server"),
    25:    ("postfix",          "Postfix / Sendmail"),
    53:    ("bind9",            "BIND / DNS"),
    80:    ("apache-httpd",     "HTTP server (Apache/Nginx — port 80)"),
    111:   ("rpcbind",          "rpcbind / portmap"),
    135:   ("windows-role-adcs","Windows MSRPC"),
    139:   ("windows-role-fileserver", "SMB"),
    389:   ("windows-role-adds","LDAP / AD DS"),
    443:   ("apache-httpd",     "HTTPS server (Apache/Nginx — port 443)"),
    445:   ("windows-role-fileserver", "SMB"),
    636:   ("windows-role-adds","LDAPS / AD DS"),
    1433:  ("mssql-2022",       "Microsoft SQL Server"),
    1521:  ("oracle-db-19c",    "Oracle Database listener"),
    2049:  ("nfs",              "NFS server"),
    2375:  ("docker",           "Docker daemon (insecure TCP)"),
    2376:  ("docker",           "Docker daemon (TLS)"),
    3306:  ("mysql-8.0",        "MySQL / MariaDB"),
    5432:  ("postgresql-16",    "PostgreSQL"),
    5601:  ("kibana",           "Kibana"),
    5672:  ("rabbitmq",         "RabbitMQ"),
    5984:  ("couchdb",          "CouchDB"),
    5985:  ("windows-winrm",    "WinRM HTTP"),
    5986:  ("windows-winrm",    "WinRM HTTPS"),
    6379:  ("redis",            "Redis"),
    6443:  ("kubernetes",       "Kubernetes API server"),
    7000:  ("cassandra",        "Cassandra"),
    7474:  ("neo4j",            "Neo4j"),
    8000:  ("apache-httpd",     "HTTP server (port 8000)"),
    8080:  ("tomcat-9.0",       "Web app server (Tomcat / proxy — port 8080)"),
    8443:  ("tomcat-9.0",       "Web app server (HTTPS — port 8443)"),
    9000:  ("sonarqube",        "SonarQube / dev tooling (port 9000)"),
    9092:  ("kafka",            "Kafka broker"),
    9200:  ("elasticsearch",    "Elasticsearch"),
    9300:  ("elasticsearch",    "Elasticsearch transport"),
    11211: ("memcached",        "Memcached"),
    15672: ("rabbitmq",         "RabbitMQ management UI"),
    27017: ("mongodb",          "MongoDB"),
    50000: ("ibm-db2",          "IBM DB2"),
}


def _discover_services_via_ssh(creds: dict) -> list[dict]:
    """Probe a Linux host via `ss -tlnp` (fallback `netstat`) and return
    a list of detected services keyed by listening TCP port. Each entry is
    `{"software_key": …, "name": …, "version": None, "source": "wizard_probe", "port": N}`.

    Best-effort: returns an empty list on any failure. The wizard handshake
    persists the result to ITAsset.detected_software_json, which the
    Host-Applications panel already reads.
    """
    try:
        import paramiko  # type: ignore
    except ImportError:
        return []
    host = creds.get("ssh_host")
    port = int(creds.get("ssh_port") or 22)
    user = creds.get("ssh_username")
    password = creds.get("ssh_password")
    if not host or not user:
        return []
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, port=port, username=user, password=password,
                       timeout=10, allow_agent=False, look_for_keys=False)
        # ss tlnp gives "LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=NNN,fd=N))"
        # Fall back to netstat for minimal Alpine/Photon images.
        cmd = (
            "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null "
            "|| echo NO_PORT_TOOL"
        )
        _, stdout, _ = client.exec_command(cmd, timeout=5)
        raw = stdout.read().decode("utf-8", errors="replace")
        client.close()
        if "NO_PORT_TOOL" in raw:
            return []
        seen_ports: set[int] = set()
        services: list[dict] = []
        # Each line has "host:port" somewhere; grab the right-hand-side port.
        for line in raw.splitlines():
            m = re.search(r"[:.](\d{1,5})\s", line)
            if not m:
                continue
            p = int(m.group(1))
            if p in seen_ports or p not in _PORT_TO_SOFTWARE:
                continue
            seen_ports.add(p)
            sw_key, sw_name = _PORT_TO_SOFTWARE[p]
            services.append({
                "software_key": sw_key,
                "name": sw_name,
                "version": None,
                "source": "wizard_probe",
                "port": p,
            })
        return services
    except Exception:  # noqa: BLE001
        return []


def _discover_services_via_winrm(creds: dict) -> list[dict]:
    """Probe a Windows host via WinRM for listening TCP ports + running
    services. Same shape as `_discover_services_via_ssh`.

    Uses Get-NetTCPConnection (Windows 8+/Server 2012+) to enumerate
    LISTEN-state ports, then maps each to a software_key. Also calls out
    Windows-specific roles by service name (DNS / DHCP / W3SVC / etc.).
    """
    try:
        import winrm  # type: ignore
    except ImportError:
        return []
    endpoint = creds.get("winrm_endpoint")
    if not endpoint:
        return []
    try:
        session = winrm.Session(
            endpoint,
            auth=(creds.get("winrm_username"), creds.get("winrm_password")),
            transport=(creds.get("winrm_transport") or "ntlm").lower(),
            server_cert_validation=(creds.get("winrm_server_cert_validation") or "ignore").lower(),
            read_timeout_sec=15,
            operation_timeout_sec=10,
        )
        # One round-trip: get listening ports + windows feature roles.
        ps = (
            "$ports = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue "
            "          | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique) -join ','; "
            "Write-Output \"PORTS:$ports\"; "
            "$features = Get-WindowsFeature -ErrorAction SilentlyContinue "
            "             | Where-Object { $_.Installed -eq $true } "
            "             | Select-Object -ExpandProperty Name; "
            "Write-Output \"FEATURES:$($features -join ',')\""
        )
        r = session.run_ps(ps)
        if int(r.status_code) != 0:
            return []
        raw = (r.std_out or b"").decode("utf-8", errors="replace")
        services: list[dict] = []
        seen_keys: set[str] = set()

        def _add(sw_key: str, sw_name: str, port: int | None = None):
            if sw_key in seen_keys:
                return
            seen_keys.add(sw_key)
            entry: dict = {
                "software_key": sw_key,
                "name": sw_name,
                "version": None,
                "source": "wizard_probe",
            }
            if port is not None:
                entry["port"] = port
            services.append(entry)

        for line in raw.splitlines():
            if line.startswith("PORTS:"):
                for p_str in line[len("PORTS:"):].split(","):
                    try:
                        p = int(p_str)
                    except ValueError:
                        continue
                    if p in _PORT_TO_SOFTWARE:
                        sw_key, sw_name = _PORT_TO_SOFTWARE[p]
                        _add(sw_key, sw_name, p)
            elif line.startswith("FEATURES:"):
                # Windows Server roles → canonical software_key (matches
                # software_normaliser.py mappings so promote-to-peer works).
                role_map = {
                    "AD-Domain-Services":      ("windows-role-adds",       "Active Directory Domain Services"),
                    "DNS":                     ("windows-role-dns",        "DNS Server"),
                    "DHCP":                    ("windows-role-dhcp",       "DHCP Server"),
                    "Web-Server":              ("iis-10",                  "IIS"),
                    "FileAndStorage-Services": ("windows-role-fileserver", "File and Storage Services"),
                    "Hyper-V":                 ("hyper-v",                 "Hyper-V"),
                    "Remote-Desktop-Services": ("windows-role-rds",        "Remote Desktop Services"),
                    "ADCS-Cert-Authority":     ("windows-role-adcs",       "Certificate Services"),
                }
                for raw_name in line[len("FEATURES:"):].split(","):
                    feat = raw_name.strip()
                    if feat in role_map:
                        sw_key, sw_name = role_map[feat]
                        _add(sw_key, sw_name)
        return services
    except Exception:  # noqa: BLE001
        return []


def discover_services_for_runner(runner_type: str, creds: dict) -> list[dict]:
    """Public entry point — dispatches by runner_type. Used by the wizard
    handshake to populate ITAsset.detected_software_json the moment a
    Linux/Windows host is connected, so the Host-Applications panel
    immediately shows everything running on the box."""
    runner = (runner_type or "").lower()
    if runner == "linux_ssh":
        return _discover_services_via_ssh(creds)
    if runner == "windows_winrm":
        return _discover_services_via_winrm(creds)
    # DB / cloud / identity runners are themselves the service — no inner
    # discovery to do. They were already classified by detect_for_runner_full.
    return []


def detect_for_runner(runner_type: str, creds: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Dispatcher — pick the right probe based on connection type.

    Returns the 3-tuple (os_family, os_version, os_normalized) used by
    legacy callers (connect_wizard_router, onboarding/router). For the
    extended 5-tuple (+ build + edition), call detect_for_runner_full().
    """
    family, version, normalized, _build, _edition = detect_for_runner_full(runner_type, creds)
    return (family, version, normalized)


def _family_fallback(
    result: Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Ensure normalized != None when we have a family.

    When the version probe fails (creds wrong, WinRM module missing,
    SSH timeout, etc.) we want the asset to at least be classified at
    the family level so the family-fallback BenchmarkOsMapping
    (e.g. pattern='windows' → Win 11 v5.0.1) picks it up. Without this,
    every probe failure produced an asset that scored 0 applicable
    rules and gave the operator no actionable signal.
    """
    family, version, normalized, build, edition = result
    if family and not normalized:
        normalized = family
    return (family, version, normalized, build, edition)


def detect_for_runner_full(
    runner_type: str, creds: dict
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Extended dispatcher returning (family, version, normalized, build, edition).

    New callers (agent heartbeat, refreshed Connect Wizard) use this to
    populate the full OS profile so the build-level matcher routes the
    exact CIS benchmark version.
    """
    runner = (runner_type or "").lower()
    if runner == "windows_winrm":
        return _family_fallback(detect_windows(creds))
    if runner == "linux_ssh":
        family, version, normalized = detect_linux(creds)
        return _family_fallback((family, version, normalized, None, None))
    if runner == "netdev_ssh":
        try:
            import paramiko  # type: ignore
            host = creds.get("ssh_host")
            user = creds.get("ssh_username")
            password = creds.get("ssh_password")
            port = int(creds.get("ssh_port") or 22)
            if not host or not user:
                return _family_fallback(("cisco", None, None, None, None))
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(host, port=port, username=user, password=password,
                           timeout=10, allow_agent=False, look_for_keys=False)
            # Full version line gives us minor (17.9) + train (Cupertino, Amsterdam)
            _, stdout, _ = client.exec_command("show version", timeout=5)
            raw = stdout.read().decode("utf-8", errors="replace")
            client.close()
            normalized = normalise_cisco(raw)
            # Extract minor build if we got cisco-ios-xe-X.Y
            build = None
            if normalized and normalized.startswith("cisco-ios-xe-"):
                tail = normalized.split("cisco-ios-xe-", 1)[1]
                if "." in tail:
                    build = tail  # the minor itself acts as the build identifier
            return _family_fallback(("cisco", raw.strip()[:200], normalized, build, None))
        except Exception:  # noqa: BLE001
            return _family_fallback(("cisco", None, None, None, None))
    if runner == "aws_readonly":
        return ("aws", "AWS account (cloud)", "aws-account", None, None)
    if runner == "oracle_sql":
        # Probe the Oracle version banner so the matcher routes the right
        # CIS Oracle DB Benchmark (12c/19c/21c). Falls back to family-level
        # when oracledb isn't installed or auth fails — at least the asset
        # gets classified as oracle.
        try:
            import oracledb  # type: ignore
        except ImportError:
            return _family_fallback(("oracle_db", "Oracle Database (oracledb driver not installed on backend)", "oracle-db", None, None))
        try:
            host = creds.get("oracle_host")
            port = int(creds.get("oracle_port") or 1521)
            service = creds.get("oracle_service_name")
            sid = creds.get("oracle_sid")
            username = creds.get("oracle_username")
            password = creds.get("oracle_password")
            if not host or not username or not password or (not service and not sid):
                return _family_fallback(("oracle_db", "Oracle Database (creds incomplete)", "oracle-db", None, None))
            dsn = (
                oracledb.makedsn(host, port, service_name=service)
                if service else oracledb.makedsn(host, port, sid=sid)
            )
            with oracledb.connect(user=username, password=password, dsn=dsn) as cn:
                with cn.cursor() as cur:
                    cur.execute("SELECT banner FROM v$version WHERE banner LIKE 'Oracle%' AND ROWNUM = 1")
                    row = cur.fetchone()
                    banner = (row[0] if row else "Oracle Database") or "Oracle Database"
            # Pick a build hint from the banner (12c, 19c, 21c, 23c, …).
            build = None
            for tag in ("23c", "21c", "19c", "18c", "12c", "11g"):
                if tag in banner:
                    build = tag
                    break
            normalized = f"oracle-db-{build}" if build else "oracle-db"
            return _family_fallback(("oracle_db", banner[:200], normalized, build, None))
        except Exception as exc:  # noqa: BLE001
            # Surface the actual error so operators can diagnose (auth /
            # network / TNS). The first line is short enough to fit in the
            # AI Classification "Version string" cell.
            err = str(exc).strip().splitlines()[0][:120]
            return _family_fallback(("oracle_db", f"Oracle Database (probe failed: {err})", "oracle-db", None, None))
    if runner == "postgres_sql":
        # SELECT version() returns e.g. "PostgreSQL 16.3 on x86_64-pc-linux-gnu, …".
        # Extract major version (16) so the matcher routes the right CIS
        # PostgreSQL Benchmark (postgresql-13/14/15/16). family-level fall-
        # back if psycopg2 not installed or auth fails.
        try:
            import psycopg2  # type: ignore
        except ImportError:
            return _family_fallback(("postgresql", "PostgreSQL (psycopg2 driver not installed on backend)", "postgresql", None, None))
        try:
            host = creds.get("postgres_host")
            port = int(creds.get("postgres_port") or 5432)
            user = creds.get("postgres_username")
            password = creds.get("postgres_password")
            database = creds.get("postgres_database") or "postgres"
            if not host or not user:
                return _family_fallback(("postgresql", "PostgreSQL (creds incomplete)", "postgresql", None, None))
            with psycopg2.connect(
                host=host, port=port, user=user, password=password,
                dbname=database, connect_timeout=5,
            ) as cn:
                with cn.cursor() as cur:
                    cur.execute("SELECT version()")
                    row = cur.fetchone()
                    banner = (row[0] if row else "PostgreSQL") or "PostgreSQL"
            # Banner shape: "PostgreSQL 16.3 on x86_64-...".
            build = None
            try:
                tokens = banner.split()
                if len(tokens) >= 2 and tokens[0] == "PostgreSQL":
                    version_token = tokens[1].rstrip(",")
                    build = version_token.split(".")[0]  # major version (e.g. "16")
            except Exception:  # noqa: BLE001
                pass
            normalized = f"postgresql-{build}" if build else "postgresql"
            return _family_fallback(("postgresql", banner[:200], normalized, build, None))
        except Exception as exc:  # noqa: BLE001
            err = str(exc).strip().splitlines()[0][:120]
            return _family_fallback(("postgresql", f"PostgreSQL (probe failed: {err})", "postgresql", None, None))
    if runner == "mssql_sql":
        # SERVERPROPERTY('productversion') / 'ProductMajorVersion' map to CIS
        # SQL Server Benchmark editions (2016/2017/2019/2022).
        try:
            import pymssql  # type: ignore
        except ImportError:
            return _family_fallback(("mssql", "Microsoft SQL Server (pymssql driver not installed on backend)", "mssql", None, None))
        try:
            host = creds.get("mssql_host")
            port = int(creds.get("mssql_port") or 1433)
            user = creds.get("mssql_username")
            password = creds.get("mssql_password")
            database = creds.get("mssql_database") or "master"
            if not host or not user:
                return _family_fallback(("mssql", "Microsoft SQL Server (creds incomplete)", "mssql", None, None))
            cn = pymssql.connect(
                server=host, port=str(port), user=user, password=password,
                database=database, login_timeout=5, timeout=5,
            )
            try:
                cur = cn.cursor()
                cur.execute(
                    "SELECT @@VERSION AS v, "
                    "       CAST(SERVERPROPERTY('ProductMajorVersion') AS NVARCHAR) AS major"
                )
                row = cur.fetchone()
                banner = (row[0] if row else "Microsoft SQL Server") or "Microsoft SQL Server"
                major = (row[1] if row else None)
            finally:
                cn.close()
            # ProductMajorVersion → year. 13=2016, 14=2017, 15=2019, 16=2022.
            edition_year_by_major = {"13": "2016", "14": "2017", "15": "2019", "16": "2022"}
            year = edition_year_by_major.get(str(major or "").strip())
            normalized = f"mssql-{year}" if year else "mssql"
            return _family_fallback(("mssql", banner[:200], normalized, year, None))
        except Exception as exc:  # noqa: BLE001
            err = str(exc).strip().splitlines()[0][:120]
            return _family_fallback(("mssql", f"Microsoft SQL Server (probe failed: {err})", "mssql", None, None))
    if runner == "mysql_sql":
        # SELECT VERSION() returns "8.0.36" / "10.11.6-MariaDB" / etc. The
        # major.minor identifies the CIS benchmark variant (MySQL 5.7 / 8.0
        # / MariaDB 10.6 / 10.11).
        try:
            import pymysql  # type: ignore
        except ImportError:
            return _family_fallback(("mysql", "MySQL / MariaDB (pymysql driver not installed on backend)", "mysql", None, None))
        try:
            host = creds.get("mysql_host")
            port = int(creds.get("mysql_port") or 3306)
            user = creds.get("mysql_username")
            password = creds.get("mysql_password")
            database = creds.get("mysql_database") or "information_schema"
            if not host or not user:
                return _family_fallback(("mysql", "MySQL / MariaDB (creds incomplete)", "mysql", None, None))
            cn = pymysql.connect(
                host=host, port=port, user=user, password=password,
                database=database, connect_timeout=5,
            )
            try:
                cur = cn.cursor()
                cur.execute("SELECT VERSION()")
                row = cur.fetchone()
                banner = (row[0] if row else "MySQL") or "MySQL"
            finally:
                cn.close()
            is_mariadb = "mariadb" in str(banner).lower()
            family = "mariadb" if is_mariadb else "mysql"
            # Build: major.minor (e.g. 8.0, 10.11)
            build = None
            try:
                parts = str(banner).split("-")[0].split(".")
                if len(parts) >= 2:
                    build = f"{parts[0]}.{parts[1]}"
            except Exception:  # noqa: BLE001
                pass
            normalized = f"{family}-{build}" if build else family
            return _family_fallback((family, str(banner)[:200], normalized, build, None))
        except Exception as exc:  # noqa: BLE001
            err = str(exc).strip().splitlines()[0][:120]
            return _family_fallback(("mysql", f"MySQL / MariaDB (probe failed: {err})", "mysql", None, None))
    if runner == "ldap_query":
        return _family_fallback(("active_directory", "Active Directory / LDAP", "active-directory", None, None))
    if runner == "azure_readonly":
        return ("azure", "Azure subscription (cloud)", "azure-subscription", None, None)
    if runner == "k8s_api":
        return _family_fallback(("kubernetes", "Kubernetes cluster", "kubernetes", None, None))
    if runner == "mock_pass":
        # Demo / synthetic runner. Don't pretend to detect an OS.
        return (None, None, None, None, None)
    return (None, None, None, None, None)
