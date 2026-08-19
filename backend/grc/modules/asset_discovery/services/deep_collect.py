"""Deep collection — turn a discovered network host into a fully-profiled asset.

A network sweep only proves a host is up. The answers an operator actually wants
— what OS, what software, is there antivirus / an EDR — come from an
AUTHENTICATED probe. This module runs that probe against the hosts a run just
resolved, using the stored CredentialProfiles, and writes the result onto the
asset (installed software → detected_software_json, and via apply_posture the
antivirus/EDR posture).

It reuses the existing agentless collectors (collect_windows / collect_linux),
driven directly from a credential profile — no IntegrationConnection needed.

Safety / isolation:
  * Only runs when the tenant has an active winrm/ssh credential; otherwise a
    complete no-op (no logins attempted).
  * Each host is probed inside its own savepoint, so one unreachable or
    auth-failing host never rolls back another host's collected inventory.
  * Bounded per run so a huge sweep can't fan out into thousands of logins in
    one pass.
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.crypto import decrypt_secret
from grc.models import (
    ITAsset, DiscoveryRun, DiscoveryObservation, CredentialProfile,
    IntegrationConnection,
)

logger = logging.getLogger(__name__)

# Cap authenticated logins per run. A sweep can find thousands of hosts; deep-
# collecting all of them synchronously in one pass would be abusive. The rest
# get collected on the next run (or an on-demand probe).
MAX_DEEP_COLLECT_PER_RUN = 512


def transport_for_observation(obs: DiscoveryObservation) -> Optional[str]:
    """windows | linux | None, from the sweep evidence alone.

    An unclaimed observation has no asset row to consult, so the open ports are
    all we have: 445/3389 → Windows, 22 → Linux. This is what lets a Windows
    login be tried ONLY against Windows devices — trying a WinRM credential
    against a Linux box is a guaranteed failed login, and enough failed logins
    against a domain account trips lockout.
    """
    raw = obs.raw if isinstance(obs.raw, dict) else {}
    guess = str(raw.get("os_guess") or raw.get("os") or "").lower()
    if guess.startswith("windows"):
        return "windows"
    if guess.startswith(("linux", "ubuntu", "debian", "rhel", "centos")):
        return "linux"
    ports = raw.get("open_ports") or []
    if 445 in ports or 3389 in ports or 5985 in ports or 5986 in ports:
        return "windows"
    if 22 in ports:
        return "linux"
    return None


def agentless_port_state(obs: DiscoveryObservation, transport: str) -> str:
    """'open' | 'closed' | 'unknown' — is the port the collector will dial
    actually listening?

    Windows discovery finds hosts on 445 (SMB), but the agentless collector
    talks WinRM on 5985/5986. Those are different services: a machine can answer
    on 445 all day with WinRM switched off, which is the default on a
    workstation. Attempting anyway costs a 65-second connect timeout per host
    and then reports "login failed", which reads as a bad password and sends the
    operator to fix the wrong thing.

    'unknown' is returned when the sweep that produced this observation never
    probed the relevant port, so an older observation is never mistaken for
    evidence that the port is shut.
    """
    raw = obs.raw if isinstance(obs.raw, dict) else {}
    probed = raw.get("probed_ports")
    open_ports = raw.get("open_ports") or []
    wanted = (5985, 5986) if transport == "windows" else (22,)
    if not probed or not any(p in probed for p in wanted):
        return "unknown"
    return "open" if any(p in open_ports for p in wanted) else "closed"


# ── Discovery→kind bridge ───────────────────────────────────────────────────
# Map an OPEN SERVICE PORT seen by the sweep to the typed collector that can
# inventory it with its OWN credential kind — so a discovered Postgres box can
# be connected AS a database (databases/schemas/extensions), not merely as a
# generic host. Cloud kinds (aws/azure/do) have no LAN port — wizard-only.
SERVICE_SUGGESTIONS: tuple = (
    # (port, credential kind, integration_type, label, default port)
    (5432, "postgres", "postgres_sql", "PostgreSQL", 5432),
    (3306, "mysql",    "mysql_sql",    "MySQL",      3306),
    (1433, "mssql",    "mssql_sql",    "SQL Server", 1433),
    (1521, "oracle",   "oracle_sql",   "Oracle DB",  1521),
    (6443, "k8s",      "k8s_api",      "Kubernetes", 6443),
    (636,  "ldap",     "ldap_query",   "LDAPS / AD", 636),
    (389,  "ldap",     "ldap_query",   "LDAP / AD",  389),
    (23,   "cisco",    "netdev_ssh",   "Network device (SSH)", 22),  # telnet gear → try SSH mgmt
)

def service_suggestions_for(open_ports) -> List[Dict[str, Any]]:
    """Which typed connects make sense for this device, from sweep evidence.
    De-duplicated by kind (LDAPS wins over LDAP when both answer)."""
    out: List[Dict[str, Any]] = []
    seen: set = set()
    ports = set(open_ports or [])
    for port, kind, itype, label, dport in SERVICE_SUGGESTIONS:
        if port in ports and kind not in seen:
            seen.add(kind)
            out.append({"kind": kind, "integration_type": itype, "label": label,
                        "port": port, "default_port": dport})
    return out


def typed_credentials_dict(kind: str, ip: str, port: int, username: str,
                           password: str, database: Optional[str] = None) -> Dict[str, Any]:
    """Build the creds dict a typed platform collector expects, keyed by its
    prefix contract ({kind}_host/_port/_username/_password; cisco uses ssh_*).
    Secrets stay in-memory only — never logged, never persisted here."""
    if kind == "cisco":
        return {"ssh_host": ip, "ssh_port": port or 22,
                "ssh_username": username, "ssh_password": password,
                "ssh_accept_unknown_hosts": "1"}
    if kind == "ldap":
        return {"ldap_host": ip, "ldap_port": port or 389,
                "ldap_use_ssl": bool(port == 636),
                "ldap_bind_dn": username, "ldap_username": username,
                "ldap_password": password}
    if kind == "k8s":
        return {"k8s_server": f"https://{ip}:{port or 6443}",
                "k8s_token": password}
    d = {f"{kind}_host": ip, f"{kind}_port": port,
         f"{kind}_username": username, f"{kind}_password": password}
    if database:
        d[f"{kind}_database"] = database
    return d


def live_port_open(ip: Optional[str], ports, timeout: float = 2.0) -> bool:
    """Fresh TCP check of the login port RIGHT NOW — overrides the (possibly stale)
    sweep result. This is what makes "try anyway" real: a box whose WinRM the sweep
    marked closed but that has since been enabled will connect, and a box that's
    truly off fails in ~2s (not a 65s WinRM handshake timeout), reported as
    'unreachable' — a connection error, never a bad-password lockout.
    """
    import socket
    if not ip:
        return False
    for p in ports:
        try:
            with socket.create_connection((str(ip), int(p)), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def classify_collect_error(exc: Exception) -> str:
    """'unreachable' | 'auth' | 'error' — what kind of failure this was.

    A connect timeout and a rejected password are not the same event and must
    not carry the same label: one means the service is off or firewalled, the
    other means the credential is wrong.
    """
    text = f"{type(exc).__name__}: {exc}".lower()
    if any(k in text for k in ("connecttimeout", "timed out", "connection refused",
                               "max retries exceeded", "no route to host",
                               "network is unreachable", "getaddrinfo",
                               "name or service not known", "connectionerror")):
        return "unreachable"
    if any(k in text for k in ("401", "unauthorized", "access is denied", "access denied",
                               "authentication", "auth failed", "bad username",
                               "logon failure", "permission denied")):
        return "auth"
    return "error"


def infer_internet_facing(ip: Optional[str]) -> Optional[bool]:
    """Derive network exposure from the address itself.

    A globally-routable address is reachable from the internet by definition.
    RFC1918 / loopback / link-local / CGNAT space is not — with one honest
    caveat: a private host can still be published via NAT or a port-forward,
    and no local scan can see that. So a False here means "not exposed by its
    address", which is the correct default, and the operator can still tick the
    box in Edit if the host is published.

    Returns None when the address can't be parsed, so callers leave the field
    alone rather than guessing.
    """
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(str(ip).strip())
    except ValueError:
        return None
    if addr.is_loopback or addr.is_link_local or addr.is_private or addr.is_reserved:
        return False
    return bool(addr.is_global)


def link_orphan_vulns_to_asset(db: Session, asset) -> int:
    """Retro-link scanner findings that were imported BEFORE this asset existed.

    A Nessus/Tenable finding carries the scanned host name. If the asset didn't
    exist yet at import time (e.g. the scan landed before network discovery
    created the host), the finding stayed unlinked. When the asset is later
    created, link any finding whose ``affected_host`` matches this asset's
    host_name / fqdn / ip — the SAME name-first/IP-last identity the scanner sync
    uses — so the register and inventory converge instead of drifting. Best-effort:
    never raises into the caller (a link failure must not fail asset creation)."""
    import logging
    from sqlalchemy import or_, func
    from grc.models import Vulnerability, VulnerabilityAssetLink
    try:
        names = {n.lower() for n in (getattr(asset, "host_name", None), getattr(asset, "fqdn", None)) if n}
        ip = getattr(asset, "ip_address", None)
        conds = []
        if names:
            conds.append(func.lower(Vulnerability.affected_host).in_(names))
        if ip:
            conds.append(Vulnerability.affected_host == ip)
        if not conds:
            return 0
        vulns = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == asset.tenant_id,
            Vulnerability.affected_host.isnot(None),
            or_(*conds),
        ).all()
        linked = 0
        for v in vulns:
            if db.query(VulnerabilityAssetLink.id).filter(
                VulnerabilityAssetLink.vulnerability_id == v.id,
                VulnerabilityAssetLink.asset_id == asset.id,
            ).first():
                continue
            db.add(VulnerabilityAssetLink(
                vulnerability_id=v.id, asset_id=asset.id,
                impact_on_asset="Detected by scanner on this host",
                created_by=None, link_source="scanner", auto_linked=True,
            ))
            linked += 1
        return linked
    except Exception:
        logging.getLogger(__name__).exception(
            "link_orphan_vulns_to_asset failed (non-fatal) for asset %s",
            getattr(asset, "id", "?"),
        )
        return 0


def promote_observation(db: Session, obs: DiscoveryObservation,
                        profile: CredentialProfile, transport: str) -> ITAsset:
    """Authenticate to an unclaimed device and, ONLY on success, make it an asset.

    This is the discovery→inventory gate. The asset row is created first because
    collect_host writes onto one, but if the collect raises (bad credentials,
    unreachable, wrong transport) the row is removed again, so a failed attempt
    leaves inventory exactly as it was. Nothing enters IT Asset Inventory without
    a successful authenticated read behind it.
    """
    from grc.modules.asset_discovery.services.resolver import _create_from

    asset = _create_from(db, obs.tenant_id, obs)
    # Network segment IS machine-derived — it is the scope the sweep found this
    # device in. Leaving it blank and calling it "manual only" was wrong: the
    # campaign already knows which subnet answered.
    raw = obs.raw if isinstance(obs.raw, dict) else {}
    scope = raw.get("scope")
    if scope and not getattr(asset, "network_segment", None):
        asset.network_segment = str(scope)[:100]

    # Exposure is derivable from the address, so don't make the operator type
    # it. Set at creation only — a later re-collect must never overwrite a
    # human's answer, and this value moves criticality by +2.5.
    #
    # Both columns are written together on purpose: `internet_facing` feeds
    # criticality and the asset page while `is_internet_facing` feeds risk
    # posture, and nothing keeps them in sync. Setting one and not the other is
    # how the two scores end up disagreeing about the same fact.
    exposed = infer_internet_facing(asset.ip_address)
    if exposed is not None:
        asset.internet_facing = exposed
        if hasattr(asset, "is_internet_facing"):
            asset.is_internet_facing = exposed
    db.flush()
    try:
        collect_host(db, asset, profile, transport)
    except Exception:
        # Undo the speculative row — no half-born assets.
        db.delete(asset)
        db.flush()
        raise
    obs.resolution = "created"
    obs.resolved_asset_id = asset.id
    obs.resolution_note = f"credential '{profile.name}' succeeded — promoted to asset #{asset.id}"
    # Retro-link any scanner findings imported before this host existed.
    link_orphan_vulns_to_asset(db, asset)
    db.flush()
    return asset


def _transport_for_host(asset: ITAsset, obs: Optional[DiscoveryObservation]) -> Optional[str]:
    """windows | linux | None. Prefer a known OS; otherwise infer from the open
    ports the sweep saw (445/3389 → Windows, 22 → Linux)."""
    fam = (getattr(asset, "os_family", None) or getattr(asset, "os_normalized", None) or "").lower()
    if fam.startswith("windows"):
        return "windows"
    if fam.startswith(("linux", "ubuntu", "debian", "rhel", "centos", "rocky",
                       "almalinux", "oraclelinux", "amazonlinux", "sles", "suse")):
        return "linux"
    ports = []
    if obs is not None and isinstance(obs.raw, dict):
        ports = obs.raw.get("open_ports") or []
    if 445 in ports or 3389 in ports:
        return "windows"
    if 22 in ports:
        return "linux"
    return None


def _cidr_match(ip: Optional[str], cidrs: Optional[List[str]]) -> bool:
    """A profile with no cidrs applies to any host; otherwise the host IP must
    fall inside one of them."""
    if not cidrs:
        return True
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for c in cidrs:
        try:
            if addr in ipaddress.ip_network(c, strict=False):
                return True
        except ValueError:
            continue
    return False


def select_credential(db: Session, tenant_id: int, ip: Optional[str],
                      transport: str) -> Optional[CredentialProfile]:
    """The highest-priority active credential of the right kind whose
    applicability covers this host."""
    kind = "winrm" if transport == "windows" else "ssh"
    candidates = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id == tenant_id,
        CredentialProfile.kind == kind,
        CredentialProfile.is_active.is_(True),
    ).order_by(CredentialProfile.priority, CredentialProfile.id).all()
    for c in candidates:
        if _cidr_match(ip, c.applies_to_cidrs):
            return c
    return None


def winrm_port_for(ip: Optional[str], explicit: Optional[int] = None) -> int:
    """The WinRM port that is actually open on `ip`. An explicit port always
    wins; otherwise prefer HTTPS 5986, fall back to HTTP 5985 when only that
    answers (Enable-PSRemoting alone opens 5985 only). Hardwiring 5986 made
    every such host report "service not reachable"."""
    if explicit:
        return int(explicit)
    if live_port_open(ip, [5986]):
        return 5986
    if live_port_open(ip, [5985]):
        return 5985
    return 5986


def winrm_endpoint_for(ip: str, port: int) -> str:
    return f"{'http' if port == 5985 else 'https'}://{ip}:{port}/wsman"


def _credentials_dict(profile: CredentialProfile, ip: str, transport: str) -> Dict[str, Any]:
    """Build the dict shape collect_windows / collect_linux expect from a stored
    profile. The secret is decrypted here and nowhere else."""
    secret = decrypt_secret(profile.secret_encrypted)
    if transport == "windows":
        user = f"{profile.domain}\\{profile.username}" if profile.domain else profile.username
        port = winrm_port_for(ip, profile.port)
        return {
            "winrm_endpoint": winrm_endpoint_for(ip, port),
            "winrm_username": user,
            "winrm_password": secret,
            "winrm_transport": profile.winrm_transport or "ntlm",
            # Discovered hosts routinely present self-signed WinRM certs; skip
            # cert validation for the probe (a profile could tighten this later).
            "winrm_server_cert_validation": "ignore",
        }
    return {
        "ssh_host": ip,
        "ssh_username": profile.username,
        "ssh_password": secret if profile.secret_kind == "password" else None,
        "ssh_private_key": secret if profile.secret_kind == "ssh_key" else None,
        "ssh_port": profile.port or 22,
        "ssh_accept_unknown_hosts": "1" if profile.ssh_accept_unknown_hosts else "0",
    }


def _ensure_integration_connection(db: Session, asset: ITAsset,
                                   profile: CredentialProfile, transport: str) -> None:
    """Register (or refresh) an IntegrationConnection for this host so the SAME
    credential that just enriched the asset ALSO powers CIS benchmark runs.

    This is the unification: discovery no longer needs a second, separate login
    set up through the Connect Wizard — the host it just authenticated to is
    registered as a first-class connection, keyed by host, and the CIS runner
    picks it up by runner_type. One credential, two jobs (inventory + CIS).

    Idempotent per (tenant, integration_type, host): a second scan refreshes the
    existing row rather than piling up duplicates. Best-effort — the caller wraps
    this so a registration failure never fails the collect.
    """
    host = asset.host_name or asset.ip_address
    if not host:
        return
    itype = "windows_winrm" if transport == "windows" else "linux_ssh"
    if transport == "windows":
        user = f"{profile.domain}\\{profile.username}" if profile.domain else profile.username
        port = winrm_port_for(asset.ip_address, profile.port)
    else:
        user = profile.username
        port = profile.port or 22
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == asset.tenant_id,
        IntegrationConnection.integration_type == itype,
        IntegrationConnection.console_url == host,
    ).first()
    if conn is None:
        db.add(IntegrationConnection(
            tenant_id=asset.tenant_id,
            integration_type=itype,
            category="compliance",
            connection_name=f"Discovery — {host}",
            console_url=host,
            console_port=port,
            auth_method="basic",
            username=user,
            # Same grc.crypto scheme as the CredentialProfile, so
            # resolve_credentials_for_connection() decrypts it unchanged.
            password=profile.secret_encrypted,
            is_active=True,
            status="connected",
        ))
    else:
        conn.username = user
        conn.password = profile.secret_encrypted
        conn.console_port = port
        conn.is_active = True
        conn.status = "connected"
    db.flush()


def promote_observation_typed(db: Session, obs: DiscoveryObservation,
                              kind: str, integration_type: str,
                              creds: Dict[str, Any]) -> ITAsset:
    """Discovery→kind bridge: authenticate to a discovered device AS its detected
    service (Postgres / MySQL / MSSQL / Oracle / K8s / LDAP / network device) and,
    ONLY on success, promote it to a typed asset carrying that kind's OWN deep
    inventory (platform_kind + platform_properties). Same gate as the host path:
    a failed connect deletes the speculative row — nothing half-born."""
    from grc.modules.asset_discovery.services.resolver import _create_from
    from grc.modules.asset_discovery.services.platform_collectors import collect_platform

    asset = _create_from(db, obs.tenant_id, obs)
    raw = obs.raw if isinstance(obs.raw, dict) else {}
    scope = raw.get("scope")
    if scope and not getattr(asset, "network_segment", None):
        asset.network_segment = str(scope)[:100]
    exposed = infer_internet_facing(asset.ip_address)
    if exposed is not None:
        asset.internet_facing = exposed
        if hasattr(asset, "is_internet_facing"):
            asset.is_internet_facing = exposed
    db.flush()
    try:
        result = collect_platform(integration_type, creds)
        if result is None:
            raise RuntimeError(f"no collector registered for {integration_type}")
        platform_kind, props = result
        asset.platform_kind = platform_kind
        # Merge over discovery metadata rather than clobbering unrelated keys.
        merged = dict(asset.platform_properties or {})
        merged.update(props or {})
        asset.platform_properties = merged
        asset.last_seen_at = datetime.utcnow()
        asset.last_seen_source = "agentless"
    except Exception:
        db.delete(asset)
        db.flush()
        raise
    obs.resolution = "created"
    obs.resolved_asset_id = asset.id
    obs.resolution_note = f"connected as {kind} — promoted to typed asset #{asset.id}"
    link_orphan_vulns_to_asset(db, asset)
    db.flush()
    return asset


def _fill_columns_from_deep(asset: ITAsset, sections: Dict[str, Any]) -> None:
    """Derive the flat hardware columns from the RICH deep sections so the
    summary card and the deep card are always in agreement — the deep collector
    is the single source of truth. Fill-if-empty: a curated value (or one the
    lighter probe already set) is never clobbered.

    Section shapes (Windows Win32_* / Linux lscpu·dmidecode·lsblk), each wrapped
    as {"status","data"}: cpu.data={logical_processors|cpus, model,…};
    memory.data={total_gb,…}; storage.data={physical_disks:[{size_gb}],…} (Linux
    storage_disks is a list); identity.data={manufacturer,model,serial,…}.
    """
    def _data(key: str) -> Any:
        s = sections.get(key)
        return s.get("data") if isinstance(s, dict) and s.get("status") == "discovered" else None

    def _set(col: str, val: Any) -> None:
        if val in (None, "", 0):
            return
        if getattr(asset, col, None) in (None, "", 0):
            setattr(asset, col, val)

    def _to_int(v: Any) -> Optional[int]:
        try:
            n = int(float(str(v).strip()))
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None

    cpu = _data("cpu")
    if isinstance(cpu, dict):
        _set("cpu_cores", _to_int(cpu.get("logical_processors") or cpu.get("cpus")))

    mem = _data("memory")
    if isinstance(mem, dict):
        _set("memory_gb", _to_int(mem.get("total_gb")))

    # Storage: Windows → {physical_disks:[{size_gb}]}; Linux storage_disks → list.
    total_disk = 0
    for key in ("storage", "storage_disks"):
        sd = _data(key)
        disks = sd.get("physical_disks") if isinstance(sd, dict) else (sd if isinstance(sd, list) else None)
        for d in (disks or []):
            n = _to_int(isinstance(d, dict) and (d.get("size_gb") or d.get("SIZE")))
            if n:
                total_disk += n
    if total_disk:
        _set("storage_gb", total_disk)

    idn = _data("identity")
    if isinstance(idn, dict):
        for col, key in (("manufacturer", "manufacturer"), ("model", "model"), ("serial_number", "serial")):
            v = str(idn.get(key) or "").strip()
            if v:
                _set(col, v[:255])


def collect_host(db: Session, asset: ITAsset, profile: CredentialProfile,
                 transport: str) -> Dict[str, Any]:
    """Authenticate to one host, inventory it, and write the result onto the
    asset (software + hardware + security posture). Raises RuntimeError with a
    human cause on transport/auth failure."""
    from grc.modules.compliance_plugins.services.agentless_inventory import (
        collect_windows, collect_linux,
    )
    from grc.modules.compliance_plugins.services.software_normaliser import (
        enrich_inventory, preserve_promotions,
    )
    from grc.modules.compliance_plugins.services.security_classifier import apply_posture

    ip = asset.ip_address
    if not ip:
        raise RuntimeError("asset has no ip_address to probe")
    creds = _credentials_dict(profile, ip, transport)
    raw, hardware = collect_windows(creds) if transport == "windows" else collect_linux(creds)

    # Auto-discovered hardware (vCPU / RAM / disk / OEM / serial / fqdn / mac) —
    # fill blanks, never clobber a curated value.
    for col, val in (hardware or {}).items():
        if val is not None and getattr(asset, col, None) in (None, "", 0):
            setattr(asset, col, val)

    # A wizard-added host arrives with host_name == the IP the operator typed —
    # a placeholder, not its real name (the fill-blanks loop above leaves it
    # untouched because it isn't empty). Once the authenticated probe returns the
    # real hostname, replace the placeholder. A curated name (≠ the IP) is kept.
    real_host = (hardware or {}).get("host_name")
    if real_host and (asset.host_name or "").strip() in ("", (asset.ip_address or "").strip()):
        asset.host_name = real_host

    # Exposure: a public (globally-routable) IP is internet-reachable by
    # definition, but a wizard-added host defaulted to internet_facing=False and
    # rendered "Not exposed". Derive it from the address — fill-only, so a value
    # an operator deliberately changed is never flipped back. Both exposure
    # columns are set together (build_signals reads either).
    try:
        import ipaddress as _ipa
        _ip_obj = _ipa.ip_address((asset.ip_address or "").strip()) if asset.ip_address else None
        if _ip_obj is not None and _ip_obj.is_global and not asset.internet_facing:
            asset.internet_facing = True
            if hasattr(asset, "is_internet_facing"):
                asset.is_internet_facing = True
    except ValueError:
        pass

    # Vendor falls back to the hardware manufacturer when finance hasn't set a
    # procurement vendor — a real machine-derived value, not a fabricated guess.
    if getattr(asset, "manufacturer", None) and not getattr(asset, "vendor", None):
        asset.vendor = asset.manufacturer

    enriched = enrich_inventory(db, raw)

    # Deep-profile each detected product IN THE SAME PASS, while we already hold
    # an authenticated session. Previously these properties were only fetched
    # when an operator promoted the software to an asset, which had two
    # consequences: a promoted app arrived thin if the host was unreachable at
    # that moment, and nothing ever refreshed the values afterwards. Collecting
    # them with the host scan means the facts are already on file BEFORE anyone
    # decides to promote, and every re-scan brings them up to date.
    #
    # Bounded by design: only products with a probe set (see software_profiler)
    # are touched, so a laptop with 28 packages runs probes for the one or two
    # that are real server software, not for Zoom and WinRAR.
    try:
        from grc.modules.compliance_plugins.services.software_profiler import (
            profile_software, probes_for,
        )

        def _run(shell: str, command: str):
            from grc.modules.compliance_plugins.runners.winrm_runner import windows_winrm_runner
            from grc.modules.compliance_plugins.runners.ssh_runner import linux_ssh_runner
            cd = {"shell": shell, "command": command, "expect": {"kind": "exit_zero"}}
            res = (windows_winrm_runner if transport == "windows" else linux_ssh_runner)(cd, creds)
            out = res.raw_output or {}
            return out.get("stdout", ""), out.get("exit_status", 1)

        for entry in enriched:
            key = entry.get("software_key")
            if not key or not probes_for(key, transport):
                continue
            attrs = profile_software(_run, key, transport)
            if attrs:
                entry["attributes"] = attrs
    except Exception:  # noqa: BLE001 — profiling must never fail the collect
        logger.info("deep_collect: software profiling failed for %s",
                    asset.ip_address, exc_info=True)

    asset.detected_software_json = preserve_promotions(asset.detected_software_json, enriched)
    apply_posture(asset)

    # OS profile — the network sweep and the hardware probe never set it, but the
    # CIS matcher routes ENTIRELY off os_normalized (a blank key = no benchmark can
    # match). Run the SAME detector the Connect Wizard / "Re-detect OS" button uses,
    # over the WinRM/SSH session we already hold, so a discovered host is fully
    # profiled AND CIS-ready in a single pass — no second connection, no manual
    # re-detect. Best-effort: a detection miss must never fail the collect.
    try:
        from grc.modules.compliance_plugins.services.os_detector import detect_for_runner_full
        runner = "windows_winrm" if transport == "windows" else "linux_ssh"
        fam, ver, norm, build, edition = detect_for_runner_full(runner, creds)
        if fam:
            asset.os_family = fam
        if ver:
            asset.os_version = ver
        if norm:
            asset.os_normalized = norm
        if build and hasattr(asset, "os_build"):
            asset.os_build = build
        if edition and hasattr(asset, "os_edition"):
            asset.os_edition = edition
    except Exception:
        logger.info("deep_collect: OS detection failed for %s", asset.ip_address, exc_info=True)

    # Deep, OS-appropriate structured inventory → asset.platform_properties.
    # This is the AUTHORITATIVE hardware/components collector: rich per-DIMM /
    # per-disk / per-NIC / GPU / CPU-model / services / security detail, each
    # section status-wrapped (discovered / permission_denied / not_supported /
    # error …). The flat columns above are DERIVED from these sections
    # (_fill_columns_from_deep) so the summary card and the deep card can never
    # disagree — one source of truth. Best-effort for the OVERALL collect (a
    # failure here never fails the promote), but NEVER silent: a hard failure is
    # recorded as a visible `_collect` error section instead of vanishing.
    deep_sections: Dict[str, Any] = {}
    try:
        from grc.modules.compliance_plugins.services.agentless_inventory import (
            collect_windows_deep, collect_linux_deep,
        )
        deep_sections = (collect_windows_deep(creds) if transport == "windows"
                         else collect_linux_deep(creds))
    except Exception as exc:  # noqa: BLE001 — deep inventory must never fail the collect
        logger.info("deep_collect: deep platform inventory failed for %s",
                    asset.ip_address, exc_info=True)
        from grc.modules.asset_discovery.services.platform_collectors import (
            section as _sec, classify_error as _ce,
        )
        deep_sections = {"collection_status": _sec(_ce(exc), None, note=f"{type(exc).__name__}: {exc}"[:300])}

    if deep_sections:
        props = dict(asset.platform_properties or {})
        props.update(deep_sections)  # merge/refresh sections; keep unrelated keys
        asset.platform_properties = props
        _fill_columns_from_deep(asset, deep_sections)
    # platform_kind stays "server" for an agentless OS host (the UI routes the
    # detail card off it); set it if nothing else has.
    if not getattr(asset, "platform_kind", None):
        asset.platform_kind = "server"

    asset.last_seen_at = datetime.utcnow()
    asset.last_seen_source = "agentless"
    db.add(asset)
    db.flush()

    # Unify with CIS: register this host as an IntegrationConnection so the same
    # credential can also RUN the CIS benchmark against it — no second, separate
    # Connect-Wizard login for the same machine. Best-effort.
    try:
        _ensure_integration_connection(db, asset, profile, transport)
    except Exception:
        logger.info("deep_collect: connection registration failed for %s",
                    asset.ip_address, exc_info=True)

    return {"software": len(enriched), "posture": asset.security_posture}


def deep_collect_run(db: Session, run_id: int) -> Dict[str, int]:
    """After a run's observations are resolved, authenticate to each resolved
    host that a credential covers and pull its full inventory. No-op if the
    tenant has no active winrm/ssh credentials. Best-effort, per-host isolated."""
    run = db.get(DiscoveryRun, run_id)
    if run is None:
        return {"collected": 0, "failed": 0, "skipped": 0}

    has_creds = db.query(CredentialProfile.id).filter(
        CredentialProfile.tenant_id == run.tenant_id,
        CredentialProfile.is_active.is_(True),
        CredentialProfile.kind.in_(("winrm", "ssh")),
    ).first()
    if not has_creds:
        return {"collected": 0, "failed": 0, "skipped": 0, "reason": "no_credentials"}

    obs_rows = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.run_id == run_id,
        DiscoveryObservation.resolution.in_(("created", "merged")),
        DiscoveryObservation.resolved_asset_id.isnot(None),
    ).all()

    collected = failed = skipped = 0
    seen_assets: set = set()
    for obs in obs_rows:
        if collected + failed >= MAX_DEEP_COLLECT_PER_RUN:
            logger.info("deep_collect: run %s hit the per-run cap", run_id)
            break
        if obs.resolved_asset_id in seen_assets:
            continue
        seen_assets.add(obs.resolved_asset_id)
        asset = db.get(ITAsset, obs.resolved_asset_id)
        if asset is None:
            continue
        transport = _transport_for_host(asset, obs)
        if transport is None:
            skipped += 1
            continue
        profile = select_credential(db, run.tenant_id, asset.ip_address, transport)
        if profile is None:
            skipped += 1
            continue
        try:
            with db.begin_nested():
                collect_host(db, asset, profile, transport)
            db.commit()
            collected += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failed += 1
            logger.info("deep_collect: host %s failed: %s", asset.ip_address, exc)
    return {"collected": collected, "failed": failed, "skipped": skipped}
