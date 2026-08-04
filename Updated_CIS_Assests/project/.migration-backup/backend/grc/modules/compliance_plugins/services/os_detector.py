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


def _truncate_to_second_level(version: str) -> str:
    """Reduce a dotted version to major.minor for CIS benchmark matching.

    Operates on a RAW version string ('24.04.2'). Used inside the OS
    detectors after parsing VERSION_ID. For full os_normalized KEYS
    ('ubuntu-24.04.2'), use truncate_os_key_to_second_level below.
       '24.04.2'  → '24.04'
       '9.4'      → '9.4'
       '12'       → '12'
    """
    if not version:
        return version
    parts = version.split('.')
    return '.'.join(parts[:2]) if len(parts) >= 2 else version


def normalise_os_freetext(text_in: str) -> Optional[str]:
    """Deterministic regex pass over a free-text OS string the operator
    typed into the manual asset form ("Windows 11 Pro", "Ubuntu 24.04.2
    LTS", "win server 2022"). Returns a level-2 os_normalized key or None.

    Runs BEFORE the AI normaliser: zero latency, zero API dependency, and
    covers the overwhelming majority of what bank operators actually type.
    The AI only sees the leftovers regex can't parse.
    """
    if not text_in:
        return None
    t = text_in.strip().lower()
    # Windows Server before client Windows (both contain "windows")
    m = re.search(r"win(?:dows)?\s*server\s*(2025|2022|2019|2016|2012\s*r2|2012)", t)
    if m:
        return f"windows-server-{m.group(1).replace(' ', '-')}"
    m = re.search(r"win(?:dows)?\s*(11|10|8\.1|8|7)\b(?:.*?\b(\d{2}h\d)\b)?", t)
    if m:
        base = f"windows-{m.group(1)}"
        return f"{base}-{m.group(2).upper()}" if m.group(2) else base
    m = re.search(r"ubuntu\s*(\d{2}\.\d{2})", t)
    if m:
        return f"ubuntu-{m.group(1)}"
    m = re.search(r"debian\s*(?:gnu/linux\s*)?(\d+(?:\.\d+)?)", t)
    if m:
        return f"debian-{_truncate_to_second_level(m.group(1))}"
    m = re.search(r"(?:rhel|red\s*hat(?:\s*enterprise\s*linux)?)\s*(\d+(?:\.\d+)?)", t)
    if m:
        return f"rhel-{_truncate_to_second_level(m.group(1))}"
    m = re.search(r"centos\s*(?:stream\s*)?(\d+)", t)
    if m:
        return f"rhel-{m.group(1)}"
    m = re.search(r"almalinux\s*(\d+(?:\.\d+)?)", t)
    if m:
        return f"almalinux-{_truncate_to_second_level(m.group(1))}"
    m = re.search(r"rocky(?:\s*linux)?\s*(\d+(?:\.\d+)?)", t)
    if m:
        return f"rocky-{_truncate_to_second_level(m.group(1))}"
    m = re.search(r"oracle\s*linux\s*(\d+)", t)
    if m:
        return f"oraclelinux-{m.group(1)}"
    m = re.search(r"amazon\s*linux\s*(2023|2)\b", t)
    if m:
        return f"amazonlinux-{m.group(1)}"
    m = re.search(r"(?:sles|suse)\s*(?:linux\s*enterprise\s*)?(\d+)", t)
    if m:
        return f"sles-{m.group(1)}"
    m = re.search(r"mac\s*os|macos|os\s*x", t)
    if m:
        v = re.search(r"(\d+(?:\.\d+)?)", t)
        if v:
            return f"macos-{_truncate_to_second_level(v.group(1))}"
        for name, key in (("sequoia", "macos-15.0"), ("sonoma", "macos-14.0"),
                          ("ventura", "macos-13.0"), ("monterey", "macos-12.0")):
            if name in t:
                return key
        return None
    m = re.search(r"cisco\s*ios\s*xe\s*(\d+\.\d+)?", t)
    if m:
        return f"cisco-ios-xe-{m.group(1)}" if m.group(1) else "cisco-ios-xe"
    if "fortigate" in t or "fortios" in t:
        m = re.search(r"(\d+\.\d+)", t)
        return f"fortigate-{m.group(1)}" if m else "fortigate"
    return None


def truncate_os_key_to_second_level(key: str) -> str:
    """Normalise a full os_normalized KEY to the major.minor convention.

    For write sites (asset create, asset update, agent heartbeat, connect
    wizard, CSV import) — keeps the matcher deterministic.

    Handles dotted-version suffixes inside the trailing segment:
      'ubuntu-24.04.2'        → 'ubuntu-24.04'
      'macos-14.4.1'          → 'macos-14.4'
      'rhel-9.4'              → 'rhel-9.4'  (already 2-level, unchanged)
      'windows-11-25H2'       → 'windows-11-25H2'  (release name, no dots)
      'cassandra-4.0'         → 'cassandra-4.0'  (already 2-level)
      ''                      → ''  (empty stays empty)
    """
    if not key:
        return key
    parts = key.rsplit('-', 1)
    if len(parts) != 2:
        return key
    prefix, tail = parts
    if re.match(r'^\d+(\.\d+){2,}$', tail):
        bits = tail.split('.')
        return f"{prefix}-{bits[0]}.{bits[1]}"
    return key


def normalise_linux(raw: str) -> Optional[str]:
    """Parse `/etc/os-release` content into a benchmark match key.

    Returns major.minor (or major if minor missing) — never the patch
    level. CIS publishes benchmarks per major.minor; patch-level
    differences are irrelevant to matching.
    """
    if not raw:
        return None
    low = raw.lower()
    # All distros: prefer VERSION_ID which gives the cleanest version
    # string. Truncate to major.minor uniformly.
    m_v = re.search(r'VERSION_ID="?([\d.]+)"?', raw)
    raw_ver = m_v.group(1) if m_v else ""
    v = _truncate_to_second_level(raw_ver)
    if "ubuntu" in low:
        return f"ubuntu-{v}" if v else "ubuntu"
    if "debian" in low:
        return f"debian-{v}" if v else "debian"
    if "almalinux" in low or "alma" in low:
        return f"almalinux-{v}" if v else "almalinux"
    if "rocky" in low:
        return f"rocky-{v}" if v else "rocky"
    if "oracle linux" in low or "ol-" in low:
        return f"oraclelinux-{v}" if v else "oraclelinux"
    if "amazon linux" in low or "amzn" in low:
        return f"amazonlinux-{v}" if v else "amazonlinux"
    if "red hat" in low or "rhel" in low:
        return f"rhel-{v}" if v else "rhel"
    if "sles" in low or "suse" in low:
        return f"sles-{v}" if v else "sles"
    return None


def normalise_cisco(raw: str) -> Optional[str]:
    """Map Cisco `show version` output to a CIS-benchmark family key.

    Now extracts IOS XE minor version too — "Cisco IOS XE Software, Version
    17.9.4a" → "cisco-ios-xe-17.9" so the matcher can pick the per-minor
    benchmark when available. Falls back to major key if minor not present.
    """
    if not raw:
        return None
    low = raw.lower()
    if "ios xe" in low or "ios-xe" in low:
        # Try minor X.Y first (preferred): "IOS XE Software, Version 17.9.4a"
        m_minor = re.search(r"ios[\s-]*xe.*?version\s+(\d+)\.(\d+)", low)
        if m_minor:
            return f"cisco-ios-xe-{m_minor.group(1)}.{m_minor.group(2)}"
        m_major = re.search(r"ios[\s-]*xe\s+(?:software,\s*)?version\s+(\d+)", low)
        return f"cisco-ios-xe-{m_major.group(1)}" if m_major else "cisco-ios-xe"
    if "nx-os" in low or "nxos" in low:
        return "cisco-nxos"
    if "adaptive security appliance" in low or " asa " in low:
        return "cisco-asa"
    if "firepower" in low:
        return "cisco-firepower"
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


def detect_for_runner(runner_type: str, creds: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Dispatcher — pick the right probe based on connection type.

    Returns the 3-tuple (os_family, os_version, os_normalized) used by
    legacy callers (connect_wizard_router, onboarding/router). For the
    extended 5-tuple (+ build + edition), call detect_for_runner_full().
    """
    family, version, normalized, _build, _edition = detect_for_runner_full(runner_type, creds)
    return (family, version, normalized)


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
        return detect_windows(creds)
    if runner == "linux_ssh":
        family, version, normalized = detect_linux(creds)
        return (family, version, normalized, None, None)
    if runner == "netdev_ssh":
        try:
            import paramiko  # type: ignore
            host = creds.get("ssh_host")
            user = creds.get("ssh_username")
            password = creds.get("ssh_password")
            port = int(creds.get("ssh_port") or 22)
            if not host or not user:
                return ("cisco", None, None, None, None)
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
            return ("cisco", raw.strip()[:200], normalized, build, None)
        except Exception:  # noqa: BLE001
            return ("cisco", None, None, None, None)
    if runner == "aws_readonly":
        return ("aws", "AWS account (cloud)", "aws-account", None, None)
    if runner == "oracle_sql":
        return ("oracle_db", None, None, None, None)
    return (None, None, None, None, None)
