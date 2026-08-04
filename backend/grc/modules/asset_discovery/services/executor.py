"""Discovery execution — turn a campaign's scopes into a run, jobs, and
observations.

This is the worker the foundation was built for. It reuses the existing
per-host probe primitive (modules/onboarding.service._probe_one) — the actual,
already-shipping network touch — and wraps it in discovery-specific
orchestration: one job per scope, exclusion-aware target expansion, and a write
of one DiscoveryObservation per reachable host.

Two invariants it must never break:
  1. It writes ONLY to the discovery tables. It never touches grc_it_assets —
     every observation lands with resolution='pending' and waits for the
     identity resolver. That is what makes running scans safe today.
  2. Excluded ranges are removed from the target set BEFORE probing, not
     filtered out of the results afterwards. An excluded host is never touched.

Threading: probes run in a ThreadPoolExecutor (network I/O), but every DB write
happens on the caller's session in the main thread — the Session is not
thread-safe, so threads only ever return plain dicts.

Execution is synchronous today, matching the existing /onboarding/discover
endpoint. `start_run` is written so the scheduling increment can call it
unchanged from a Celery task.
"""
from __future__ import annotations

import csv
import ipaddress
import logging
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from functools import lru_cache
from typing import Any, Callable, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from grc.models import (
    DiscoveryCampaign, DiscoveryScope, DiscoveryRun, DiscoveryJob, DiscoveryObservation,
)
from grc.modules.onboarding.service import _probe_one, MAX_HOSTS
from .fingerprint import (  # noqa: F401
    FingerprintFn, fingerprint_host, noop_fingerprint, classify as _classify_fp,
    netbios_name, reverse_dns, mdns_name, ssdp_info,
)

logger = logging.getLogger(__name__)

# "Is this host up?" — probe a small set of ports that cover the common cases
# (SMB/Windows, SSH/Linux, RDP). A host answering ANY of them is recorded. This
# is host-presence discovery, not a service scan; deep fingerprinting is a later
# authenticated step.
# 5985/5986 are WinRM (HTTP/HTTPS) — the port the agentless Windows collector
# actually dials. Without probing them, a host that answers on 445 looks
# "Windows, ready to connect", the collector then waits out a 65s connect
# timeout on 5986, and the failure gets reported as a refused login. Knowing up
# front whether WinRM is listening is the difference between "your password is
# wrong" and "WinRM is not enabled on this machine" — completely different fixes.
# 80/443 catch web-managed appliances.
#
# IMPORTANT: this is the TCP set — it only finds hosts that answer on a TCP
# port. Network gear that speaks only SNMP (UDP/161) or a DNS box (UDP/53) is
# invisible to a TCP connect, which is why discovery used to surface only
# Windows/Linux. Those UDP protocols + service fingerprinting live in
# fingerprint.py and run per-host in _sweep_host, so an SNMP-only router is
# still discovered and classified. Keep 445 first: a unit test uses
# NETWORK_SWEEP_PORTS[0] as the host's "answering" port.
#
# Two families here. The first are HOST-LOGIN ports (a credential can be used).
# The rest are IDENTITY ports: a device that takes no host login still reveals
# WHAT IT IS by which of these it answers — a printer on 9100, a camera on 554,
# a phone on 5060. This is what turns "Unknown / no ports" into a real type.
NETWORK_SWEEP_PORTS: tuple = (
    445, 22, 3389, 5985, 5986,      # host login: SMB / SSH / RDP / WinRM
    80, 443, 8080, 8443,            # web management consoles
    9100, 515, 631,                 # printer: JetDirect / LPD / IPP
    554,                            # IP camera: RTSP
    5060,                           # VoIP phone / PBX: SIP
    139, 23,                        # NetBIOS / Telnet (legacy gear)
    # SERVICE ports — each maps to a typed platform collector, so discovery can
    # say "this is a PostgreSQL box → connect with a postgres credential" instead
    # of hiding every service behind a generic host login (the discovery→kind
    # bridge). Kept AFTER the identity ports: same sweep, richer classification.
    5432, 3306, 1433, 1521,         # databases: PostgreSQL / MySQL / MSSQL / Oracle
    6443,                           # Kubernetes API
    389, 636,                       # LDAP / LDAPS (Active Directory)
    # NoSQL / search — we have no typed collector for these YET, but probing them
    # turns an otherwise "Unknown" box into "MongoDB / Redis / Elasticsearch host",
    # which is the honest identification the operator asked for.
    27017, 6379, 9200,              # MongoDB / Redis / Elasticsearch
)
# Ports that mean "an agentless credential can actually be used here".
WINRM_PORTS = (5985, 5986)
SSH_PORT = 22

# Type of the injectable probe: (ip, port, timeout_s) -> result dict with a
# 'status' of 'reachable'|'unreachable' and optional 'hostname'/'rtt_ms'.
ProbeFn = Callable[[str, int, float], Dict[str, Any]]

_MAC_RE = re.compile(
    r"(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})")


def read_neighbor_table() -> Dict[str, str]:
    """The OS ARP / neighbor table as {ip: mac}.

    Why this matters: an ordinary IP firewall drops TCP/UDP probes but generally
    cannot hide a host from ARP while still allowing normal Layer-2/IP
    connectivity — so ARP/NDP discovers REACHABLE hosts on the scanner's local
    Layer-2 segment, including ones that answer no port. This is NOT literally
    "every powered-on device": static / proxy-ARP setups, private-VLAN or
    wireless client isolation, non-participating hosts, IPv6-only devices (which
    use NDP, not ARP), and some virtual environments can still be missed. ARP is
    layer-2, so remote / cross-router targets never appear (no false positives
    for an off-LAN range). Best-effort; never raises. The TCP sweep populates the
    cache (a connect attempt resolves ARP even when the SYN is later dropped), so
    this is read AFTER the sweep."""
    table: Dict[str, str] = {}
    try:
        if sys.platform.startswith("linux"):
            with open("/proc/net/arp") as fh:
                next(fh, None)  # header
                for line in fh:
                    parts = line.split()
                    if len(parts) >= 4 and parts[3] not in ("00:00:00:00:00:00", "0x0"):
                        table[parts[0]] = parts[3].lower()
        else:  # windows / macos: parse `arp -a`
            out = subprocess.run(["arp", "-a"], capture_output=True, text=True,
                                 timeout=15).stdout
            for line in out.splitlines():
                m = _MAC_RE.search(line)
                if m:
                    table[m.group(1)] = m.group(2).replace("-", ":").lower()
    except Exception:
        logger.debug("read_neighbor_table failed", exc_info=True)
    return table


# OUI -> vendor lookup. Best-effort, NOT authoritative: modern phones/laptops
# use RANDOMIZED (locally-administered) MACs that map to no vendor, so those
# return None (never a guess). For a globally-administered MAC we resolve from
# (a) the full IEEE OUI dataset when bundled at _OUI_FILE, else (b) a small
# confident curated map. Drop the IEEE `oui.csv` (columns: assignment,
# organization) at _OUI_FILE for complete coverage — read once, offline.
_OUI_FILE = os.path.join(os.path.dirname(__file__), "data", "oui.csv")

_OUI_CURATED = {
    "b8:27:eb": "Raspberry Pi", "dc:a6:32": "Raspberry Pi", "e4:5f:01": "Raspberry Pi",
    "00:0c:29": "VMware", "00:50:56": "VMware", "00:05:69": "VMware",
    "3c:07:54": "Apple", "f0:18:98": "Apple", "a4:83:e7": "Apple",
    "52:54:00": "QEMU/KVM", "00:15:5d": "Microsoft (Hyper-V)", "00:1c:42": "Parallels",
}


@lru_cache(maxsize=1)
def _oui_db() -> Dict[str, str]:
    """Curated map, merged with the full IEEE dataset when bundled. Loaded once."""
    db = dict(_OUI_CURATED)
    try:
        if os.path.exists(_OUI_FILE):
            with open(_OUI_FILE, newline="", encoding="utf-8", errors="replace") as fh:
                for row in csv.reader(fh):
                    if len(row) >= 2 and row[1].strip():
                        h = re.sub(r"[^0-9a-fA-F]", "", row[0])[:6].lower()
                        if len(h) == 6:
                            db[f"{h[0:2]}:{h[2:4]}:{h[4:6]}"] = row[1].strip()
    except Exception:
        logger.debug("OUI dataset load failed", exc_info=True)
    return db


def _is_randomized_mac(mac: str) -> bool:
    """A locally-administered MAC (bit 0x02 of the first octet) is almost always
    a privacy-randomized address that maps to no real vendor."""
    try:
        return bool(int(mac.split(":")[0], 16) & 0x02)
    except Exception:
        return False


def _parse_snmp_communities(raw: Optional[str]) -> Optional[List[bytes]]:
    """Comma-separated campaign SNMP communities -> list of bytes, or None to let
    fingerprinting fall back to the env default."""
    if not raw:
        return None
    out = [c.strip().encode() for c in raw.split(",") if c.strip()]
    return out or None


def _oui_vendor(mac: Optional[str]) -> Optional[str]:
    """Vendor from the MAC OUI, or None. Returns None for randomized/private
    MACs and for any prefix not in the curated map — a best-effort hint that
    never asserts a vendor it isn't sure of."""
    if not mac:
        return None
    m = mac.lower().replace("-", ":")
    if _is_randomized_mac(m):
        return None
    return _oui_db().get(m[:8])


# Infer OS from a resolved hostname. A Windows "DESKTOP-…" / "LAPTOP-…" NetBIOS
# name is Windows; "MacBook…"/"iMac" is macOS; "iPhone"/"iPad" is iOS; an
# "Android-…" name is Android. This is a medium-confidence NAME+protocol signal —
# it turns the honest-but-vague "Host" into "Windows host" / "macOS host" /
# "Android" where the name makes it clear. It NEVER overrides an OS a probe proved.
_WIN_NAME_RE = re.compile(r"^(desktop|laptop|win|pc|wks)[-_]", re.I)
_ANDROID_NAME_RE = re.compile(r"^android[-_ ]", re.I)


def _os_from_hostname(name: Optional[str]) -> Optional[str]:
    n = (name or "").strip()
    if not n:
        return None
    low = n.lower()
    if _WIN_NAME_RE.match(n):
        return "windows"
    if "macbook" in low or "imac" in low or low.startswith(("mac-", "mac_")) or low.endswith(("-mac", "_mac")):
        return "macos"
    if "iphone" in low or "ipad" in low or "ipod" in low:
        return "ios"
    if _ANDROID_NAME_RE.match(n):
        return "android"
    return None


def is_in_blackout(campaign: DiscoveryCampaign, now: datetime) -> bool:
    """Is `now` inside one of the campaign's blackout windows?

    Windows are [{ "days": [0-6 Mon..Sun], "start": "HH:MM", "end": "HH:MM" }].
    A window with start > end crosses midnight (e.g. 22:00–06:00). Scheduled runs
    must not start during a blackout — a change freeze or end-of-day batch is
    exactly when a scan must stay off the network. Malformed windows are ignored
    (fail-open on the individual window, not the whole check) rather than
    crashing a scheduler tick.
    """
    windows = campaign.blackout_windows or []
    if not isinstance(windows, list):
        return False
    wd = now.weekday()
    cur = now.hour * 60 + now.minute
    for w in windows:
        try:
            days = w.get("days")
            if days and wd not in days:
                continue
            sh, sm = (int(x) for x in str(w["start"]).split(":"))
            eh, em = (int(x) for x in str(w["end"]).split(":"))
            start, end = sh * 60 + sm, eh * 60 + em
        except Exception:
            continue
        if start == end:
            continue
        inside = (start <= cur < end) if start < end else (cur >= start or cur < end)
        if inside:
            return True
    return False


def _ips_for_scope(scope: DiscoveryScope) -> Set[str]:
    """Expand one scope to a set of IP strings. Unsupported kinds (ad_ou) return
    empty — AD enumeration needs a stored credential and lands with that work."""
    if scope.kind == "cidr":
        net = ipaddress.ip_network(scope.value, strict=False)
        hosts = list(net.hosts()) if net.num_addresses > 2 else list(net)
        return {str(h) for h in hosts}
    if scope.kind == "ip_range":
        start_s, _, end_s = scope.value.partition("-")
        start = ipaddress.ip_address(start_s.strip())
        end = ipaddress.ip_address(end_s.strip())
        if int(end) < int(start):
            start, end = end, start
        return {str(ipaddress.ip_address(i)) for i in range(int(start), int(end) + 1)}
    return set()


def _targets_for_job(job_scope: DiscoveryScope, exclusions: Set[str]) -> List[str]:
    """The include scope's IPs minus every excluded IP. Sorted for deterministic
    ordering (tests, and stable observation order)."""
    return sorted(_ips_for_scope(job_scope) - exclusions,
                  key=lambda ip: int(ipaddress.ip_address(ip)))


def _sweep_host(
    ip: str, probe: ProbeFn, timeout_s: float,
    fingerprinter: FingerprintFn = noop_fingerprint,
    mac: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Probe one host: TCP presence across NETWORK_SWEEP_PORTS, then a
    protocol-aware fingerprint (SNMP/DNS over UDP, SSH/HTTP banners). Returns a
    compact evidence dict if the host answered on ANY TCP port OR any UDP
    service, else None. Never raises — a probe failure is just 'not reachable'.

    ``fingerprinter`` is injectable and defaults to a no-op so unit tests do no
    real network I/O; production passes ``fingerprint.fingerprint_host``."""
    open_ports: List[int] = []
    hostname = None
    rtt = None
    for port in NETWORK_SWEEP_PORTS:
        try:
            res = probe(ip, port, timeout_s)
        except Exception:  # noqa: BLE001 — a probe error is a non-answer
            continue
        if res.get("status") == "reachable":
            open_ports.append(port)
            hostname = hostname or res.get("hostname")
            rtt = rtt if rtt is not None else res.get("rtt_ms")
    # Protocol-aware fingerprint. Runs even when NO TCP port answered, because an
    # SNMP-only router or a DNS box has no open TCP port yet must still be found.
    try:
        fp = fingerprinter(ip, open_ports, timeout_s)
    except Exception:  # noqa: BLE001 — never let a fingerprint error sink a sweep
        fp = {"udp_services": []}
    # Present if it answered on TCP, on a UDP service (SNMP/DNS), OR has an ARP
    # neighbor entry (mac) — the last catches hosts that answer no port but are
    # unmistakably alive on the LAN (firewalled, client-isolated, sleeping,
    # UDP-only, or simply exposing nothing we probed).
    if not open_ports and not fp.get("udp_services") and not mac:
        return None
    return {"ip": ip, "hostname": hostname, "open_ports": open_ports,
            "rtt_ms": rtt, "fingerprint": fp, "mac": mac}


def _sweep_targets(
    targets: List[str], *, probe: ProbeFn, timeout_s: float, max_workers: int,
    rate_limit_per_min: Optional[int] = None,
    fingerprinter: FingerprintFn = noop_fingerprint,
) -> List[Dict[str, Any]]:
    """Probe a list of hosts concurrently and return the reachable ones.

    When rate_limit_per_min is set the hosts are processed in per-minute batches
    of that size — never more than N hosts touched in any rolling minute. In a
    bank's network an unthrottled sweep is a career-limiting incident, so this
    is a hard cap, not a hint. Unlimited (None/<=0) keeps the fast path."""
    findings: List[Dict[str, Any]] = []
    if not targets:
        return findings

    def _probe_batch(batch: List[str]) -> None:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futs = {pool.submit(_sweep_host, ip, probe, timeout_s, fingerprinter): ip for ip in batch}
            for fut in as_completed(futs):
                res = fut.result()
                if res:
                    findings.append(res)

    if not rate_limit_per_min or rate_limit_per_min <= 0:
        _probe_batch(targets)
        return findings

    import time
    for i in range(0, len(targets), rate_limit_per_min):
        batch = targets[i:i + rate_limit_per_min]
        started = time.monotonic()
        _probe_batch(batch)
        # Hold the minute open if this batch finished early and more remain, so
        # the throughput never exceeds rate_limit_per_min hosts/minute.
        if i + rate_limit_per_min < len(targets):
            elapsed = time.monotonic() - started
            if elapsed < 60.0:
                time.sleep(60.0 - elapsed)
    return findings


def _run_job(
    db: Session, run: DiscoveryRun, job: DiscoveryJob, scope: DiscoveryScope,
    exclusions: Set[str], *, probe: ProbeFn, timeout_s: float, max_workers: int,
    rate_limit_per_min: Optional[int] = None,
    fingerprinter: FingerprintFn = noop_fingerprint,
) -> int:
    """Probe one job's targets and write an observation per reachable host.
    Returns the number of hosts seen. Raises on a target set that's too large so
    the caller can mark the job failed with a real cause."""
    job.status = "running"
    job.started_at = datetime.utcnow()
    job.attempts = (job.attempts or 0) + 1
    db.flush()

    targets = _targets_for_job(scope, exclusions)
    if len(targets) > MAX_HOSTS:
        raise ValueError(
            f"scope {scope.value!r} expands to {len(targets)} hosts; "
            f"max {MAX_HOSTS} per job"
        )

    findings = _sweep_targets(
        targets, probe=probe, timeout_s=timeout_s, max_workers=max_workers,
        rate_limit_per_min=rate_limit_per_min, fingerprinter=fingerprinter,
    )

    # ── ARP-based liveness enrichment ───────────────────────────────────────
    # The TCP sweep above resolved ARP for the hosts it touched. Reading the
    # neighbor table now surfaces reachable hosts on the local L2 segment that
    # answered NO probe — comprehensive coverage of the local network, not a
    # literal census of every device (see read_neighbor_table for
    # what ARP can miss). Off-LAN / cross-router targets never appear, so this is
    # a no-op for a remote scan. Only enrich targets actually in scope.
    try:
        neighbors = read_neighbor_table()
    except Exception:
        neighbors = {}
    if neighbors:
        found_ips = {f["ip"] for f in findings}
        for f in findings:
            if not f.get("mac"):
                f["mac"] = neighbors.get(f["ip"])
        for ip in targets:
            if ip in neighbors and ip not in found_ips:
                # Alive per ARP but silent on every port/UDP probe. This is an
                # honest "discovered, identity unknown" asset — evidence is ARP +
                # MAC only. Do NOT infer WHY it is silent (firewall, isolation,
                # sleep, UDP-only…). Record it so it is visible in discovery.
                fp = {"udp_services": []}
                fp.update(_classify_fp([], fp))  # device_type='unknown'
                findings.append({"ip": ip, "hostname": None, "open_ports": [],
                                 "rtt_ms": None, "fingerprint": fp,
                                 "mac": neighbors[ip], "arp_only": True})

    # Name resolution for live hosts still lacking a hostname — NetBIOS asks the
    # host its Windows name directly, reverse DNS asks the resolver. This is what
    # puts a name on a host that answers no TCP/UDP service.
    _unnamed = [f for f in findings if not f.get("hostname")]
    if _unnamed:
        def _resolve_name(f):
            try:
                ip = f["ip"]
                fpd = f.setdefault("fingerprint", {})
                unknown = fpd.get("device_type") in (None, "unknown")

                def _ev(tag):
                    ev = fpd.setdefault("evidence", [])
                    if tag not in ev:
                        ev.append(tag)

                # 1) NetBIOS — a Windows/macOS/Samba SMB host (name).
                nb = netbios_name(ip, timeout_s)
                if nb:
                    f["hostname"] = nb
                    if unknown:
                        fpd["device_type"] = "host"
                        fpd["confidence"] = max(fpd.get("confidence") or 0, 0.5)
                        _ev("netbios")
                else:
                    # 2) No SMB: consumer/IoT multicast — mDNS (Bonjour: Apple /
                    #    printer / IoT) for the name, SSDP (UPnP: TV / media / NAS
                    #    / router) for the device kind.
                    md = mdns_name(ip, timeout_s)
                    ss = ssdp_info(ip, timeout_s)
                    f["hostname"] = md or reverse_dns(ip, timeout_s)
                    if unknown and ss:
                        fpd["device_type"] = "appliance"  # UPnP device
                        if not fpd.get("product"):
                            fpd["product"] = ss
                        fpd["confidence"] = max(fpd.get("confidence") or 0, 0.6)
                        _ev("ssdp")
                    elif unknown and md:
                        fpd["device_type"] = "host"  # Bonjour host (Apple/etc.)
                        fpd["confidence"] = max(fpd.get("confidence") or 0, 0.5)
                        _ev("mdns")

                # 3) OS from the resolved name — DESKTOP-* -> Windows, MacBook* ->
                #    macOS, Android-* -> Android. Never overrides a probe-proven OS.
                if not fpd.get("os_guess"):
                    osg = _os_from_hostname(f.get("hostname"))
                    if osg:
                        fpd["os_guess"] = osg
                        _ev("hostname:" + osg)
                        if fpd.get("device_type") in (None, "unknown"):
                            fpd["device_type"] = "host"
                        fpd["confidence"] = max(fpd.get("confidence") or 0, 0.6)
            except Exception:  # noqa: BLE001 — naming is best-effort
                pass
            return f
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            list(pool.map(_resolve_name, _unnamed))

    # OS from hostname for EVERY named device — not just the ones the naming step
    # above touched. A DESKTOP-* that answered SMB got its name during the sweep
    # (so it skipped the naming step) and would otherwise stay a bare "Host"; this
    # pass makes classification consistent regardless of HOW the name was found.
    for f in findings:
        fpd = f.setdefault("fingerprint", {})
        if fpd.get("os_guess"):
            continue
        osg = _os_from_hostname(f.get("hostname"))
        if osg:
            fpd["os_guess"] = osg
            ev = fpd.setdefault("evidence", [])
            if ("hostname:" + osg) not in ev:
                ev.append("hostname:" + osg)
            if fpd.get("device_type") in (None, "unknown"):
                fpd["device_type"] = "host"
            fpd["confidence"] = max(fpd.get("confidence") or 0, 0.6)

    # MAC-derived hints (no network): OUI vendor for globally-administered MACs,
    # and a randomized/private-MAC flag. Best-effort — a randomized MAC yields no
    # vendor rather than a misleading guess.
    for f in findings:
        mac = f.get("mac")
        if not mac:
            continue
        fpd = f.setdefault("fingerprint", {})
        fpd["mac_randomized"] = _is_randomized_mac(mac.lower().replace("-", ":"))
        ov = _oui_vendor(mac)
        if ov:
            # An OUI identifies the NIC MANUFACTURER, not the device kind. It is
            # vendor EVIDENCE only: it must never set or raise device_type /
            # confidence. Device type still requires independent proof (SNMP /
            # HTTP / mDNS / service behaviour). Recorded with its source so the
            # classification stays explainable.
            fpd.setdefault("oui_vendor", ov)
            if not fpd.get("vendor"):
                fpd["vendor"] = ov
                fpd["vendor_source"] = "ieee_oui"
            ev = fpd.setdefault("evidence", [])
            if "mac_oui" not in ev:
                ev.append("mac_oui")

    findings.sort(key=lambda f: int(ipaddress.ip_address(f["ip"])))
    now = datetime.utcnow()
    for f in findings:
        fp = f.get("fingerprint") or {}
        db.add(DiscoveryObservation(
            tenant_id=run.tenant_id, run_id=run.id, job_id=job.id,
            source="cidr", observed_at=now,
            host_name=f.get("hostname"), ip_address=f["ip"], mac_address=f.get("mac"),
            # probed_ports records what this sweep actually checked, so a later
            # step can tell "WinRM was closed" from "we never looked". Without
            # it, observations written by an older build would be wrongly read
            # as proof that WinRM is disabled.
            #
            # device_type/os_guess/vendor are the protocol-aware classification
            # (SNMP sysDescr / SSH / HTTP), surfaced at the top of raw for easy
            # reading; the full evidence lives under 'fingerprint'. This is what
            # turns "only Windows/Linux" into routers/switches/firewalls/DNS too.
            raw={"open_ports": f["open_ports"], "rtt_ms": f.get("rtt_ms"),
                 "scope": scope.value, "probed_ports": list(NETWORK_SWEEP_PORTS),
                 "arp_only": f.get("arp_only", False),
                 "device_type": fp.get("device_type"),
                 "os_guess": fp.get("os_guess"),
                 "vendor": fp.get("vendor"),
                 "vendor_source": fp.get("vendor_source"),
                 "product": fp.get("product"),
                 "confidence": fp.get("confidence"),
                 "evidence": fp.get("evidence"),
                 "fingerprint": fp},
            resolution="pending",
        ))

    job.hosts_seen = len(findings)
    job.status = "succeeded"
    job.finished_at = datetime.utcnow()
    db.flush()
    return len(findings)


def create_run(
    db: Session, campaign: DiscoveryCampaign, *, trigger: str = "manual", user=None,
) -> DiscoveryRun:
    """Create and commit a run in 'queued' status, so the caller has an id to
    poll before any scanning starts. The request handler calls this, then hands
    the run id to a background worker which calls execute_run."""
    run = DiscoveryRun(
        tenant_id=campaign.tenant_id, campaign_id=campaign.id,
        trigger=trigger, status="queued",
        created_by_id=getattr(user, "id", None),
        created_by_name=(getattr(user, "display_name", None)
                         or getattr(user, "username", None)) if user else None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def execute_run(
    db: Session,
    run_id: int,
    *,
    probe: Optional[ProbeFn] = None,
    timeout_s: float = 1.0,
    max_workers: int = 32,
    fingerprinter: Optional[FingerprintFn] = None,
) -> DiscoveryRun:
    """Execute a previously-created run: a job per include scope, probe each,
    record observations, transition status. Safe to call from a background
    thread or a scheduled task — it takes a run_id and owns its own session's
    transaction. `probe` is injectable (resolved at call time) so tests drive it
    without touching a real network.

    Returns the finished DiscoveryRun (committed). Never writes to grc_it_assets.
    """
    if probe is None:
        probe = _probe_one

    run = db.get(DiscoveryRun, run_id)
    if run is None:
        raise ValueError(f"discovery run {run_id} not found")
    campaign = db.get(DiscoveryCampaign, run.campaign_id)
    if campaign is None:
        raise ValueError(f"campaign {run.campaign_id} for run {run_id} not found")

    # Fingerprinter: real protocol-aware fingerprinting by default. SNMP read
    # communities come from the CAMPAIGN (a per-scan discovery credential) when
    # configured, else fingerprint_host falls back to the env default — so
    # 'public' is never hard-coded as the production credential. Injectable so a
    # test can pass noop_fingerprint for a pure-TCP, no-UDP run.
    if fingerprinter is not None:
        fp_fn = fingerprinter
    else:
        _comms = _parse_snmp_communities(campaign.snmp_communities)
        if _comms:
            def fp_fn(ip, ports, t, _c=_comms):
                return fingerprint_host(ip, ports, t, communities=_c)
        else:
            fp_fn = fingerprint_host

    run.status = "running"
    run.started_at = datetime.utcnow()
    db.commit()

    include_scopes = [s for s in campaign.scopes if not s.exclude]
    rate_limit = campaign.rate_limit_hosts_per_min
    exclusions: Set[str] = set()
    for s in campaign.scopes:
        if s.exclude:
            try:
                exclusions |= _ips_for_scope(s)
            except ValueError:
                logger.warning("discovery: skipping unparseable exclusion %r", s.value)

    total_hosts = 0
    total_obs = 0
    errors: List[str] = []

    for scope in include_scopes:
        # ad_ou scopes are accepted by config but have no network executor yet.
        kind = "ad_enum" if scope.kind == "ad_ou" else "cidr_sweep"
        job = DiscoveryJob(
            tenant_id=run.tenant_id, run_id=run.id, kind=kind,
            target=scope.value, status="queued",
        )
        # Commit the job row BEFORE running it, so a failure inside the job's
        # savepoint can roll back that job's observations without also erasing
        # the job row itself (or any earlier job's committed findings).
        db.add(job)
        db.commit()

        if kind == "ad_enum":
            job.status = "failed"
            job.error = "AD enumeration needs a stored credential (not built yet)."
            job.finished_at = datetime.utcnow()
            db.commit()
            errors.append(f"{scope.value}: AD not supported yet")
            continue

        try:
            # Savepoint per job: a failure here rolls back ONLY this job's
            # half-written observations, never a sibling job's. Before this the
            # whole-session rollback wiped every earlier job in the run.
            with db.begin_nested():
                seen = _run_job(db, run, job, scope, exclusions,
                                probe=probe, timeout_s=timeout_s, max_workers=max_workers,
                                rate_limit_per_min=rate_limit, fingerprinter=fp_fn)
            db.commit()  # release the savepoint's work to the run
            total_hosts += seen
            # observations for this job = its findings (host_seen == obs written)
            total_obs += seen
        except Exception as exc:  # noqa: BLE001
            db.rollback()  # unwind the failed savepoint; the job row survives
            job = db.get(DiscoveryJob, job.id)
            if job:
                job.status = "failed"
                job.error = str(exc)
                job.finished_at = datetime.utcnow()
                db.commit()
            errors.append(f"{scope.value}: {exc}")
            logger.exception("discovery job failed: campaign=%s scope=%s",
                             campaign.id, scope.value)

    # Re-load counters that a mid-loop rollback may have expired.
    run = db.get(DiscoveryRun, run.id)
    run.hosts_seen = total_hosts
    run.observations = total_obs
    run.finished_at = datetime.utcnow()
    # Honest status: failed only if NOTHING succeeded; otherwise succeeded with
    # per-job errors recorded on the job rows and summarised here.
    any_ok = any(j.status == "succeeded" for j in run.jobs)
    if errors and not any_ok:
        run.status = "failed"
    else:
        run.status = "succeeded"
    if errors:
        run.error = "; ".join(errors)[:2000]

    # Keep the campaign's last-run marker current so the scheduler can compute
    # the next due time.
    campaign = db.get(DiscoveryCampaign, campaign.id)
    campaign.last_run_at = run.finished_at

    db.commit()

    # Resolve this run's observations into assets: confident matches auto-merge,
    # unknown hosts auto-create as 'discovered', ambiguous go to the review
    # queue. This is the deliberate, separate step that is allowed to write
    # grc_it_assets — the sweep above never does. Kept inside execute_run so a
    # scan produces inventory in one pass; a resolver failure must not fail the
    # run (the observations survive and can be resolved later from the inbox).
    try:
        from .resolver import resolve_run
        resolve_run(db, run.id)
    except Exception:
        logger.exception("discovery: auto-resolve failed for run %s", run.id)

    # Deep-collect: for each host we just resolved, if a stored credential covers
    # it, authenticate and pull OS / software / antivirus so a network-discovered
    # box is fully profiled, not just "seen". No-op when no credentials exist, so
    # this adds nothing for tenants that haven't opted in. Best-effort — a failed
    # login must never fail the run.
    try:
        from .deep_collect import deep_collect_run
        deep_collect_run(db, run.id)
    except Exception:
        logger.exception("discovery: deep-collect failed for run %s", run.id)

    db.refresh(run)
    return run


def start_run(
    db: Session,
    campaign: DiscoveryCampaign,
    *,
    trigger: str = "manual",
    user=None,
    probe: Optional[ProbeFn] = None,
    timeout_s: float = 1.0,
    max_workers: int = 32,
) -> DiscoveryRun:
    """Synchronous create-then-execute. Used by scheduled tasks (which are
    already off the request path) and by tests that want a deterministic,
    fully-finished run in one call. The interactive endpoint does NOT use this —
    it calls create_run then runs execute_run on a background thread."""
    run = create_run(db, campaign, trigger=trigger, user=user)
    return execute_run(db, run.id, probe=probe, timeout_s=timeout_s, max_workers=max_workers)
