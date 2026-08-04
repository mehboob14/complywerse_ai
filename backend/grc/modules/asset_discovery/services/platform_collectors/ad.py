"""Active Directory / LDAP deep inventory collector.

Legacy `collect_ad` returned only rootDSE fields + three counts. This module
keeps the exact same ldap3 connection setup and credential keys (ldap_host /
ldap_port / ldap_use_ssl / ldap_bind_dn|ldap_username / ldap_password) but walks
the directory into a hierarchical inventory: forest/domain, domain controllers,
sites, OUs, computers, users (metadata only), and groups.

Contract (see status.py):
  * Flat identity scalars live at the top (directory, host, naming contexts …).
  * Every DEEP section is a named key wrapped by `collect_section(...)`, so a
    denied subtree degrades to `{"status": "permission_denied", ...}` and NEVER
    aborts the collect.
  * READ-ONLY paged searches. NO passwords or sensitive personal attributes
    (no mail/phone/address) — inventory metadata only.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import (
    register, collect_section, section, discovered,
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE, ERROR,
)

# userAccountControl bit: account disabled.
_UAC_DISABLED = 0x2


def _cap(items: List[Any], cap: int) -> Dict[str, Any]:
    return {"items": items[:cap], "count": len(items)}


def _val(entry, attr):
    """First value of an ldap3 attribute, or None."""
    try:
        v = entry[attr].value
    except Exception:  # noqa: BLE001
        return None
    if isinstance(v, list):
        return v[0] if v else None
    return v


@register("ldap_query")
def collect_ad(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-inventory an Active Directory / LDAP domain over a read-only bind.
    Same connection + credential keys as the legacy collector. Each subtree
    search is a paged, size-capped read wrapped as a status section, so a denied
    subtree marks only that section permission_denied and the collect succeeds."""
    try:
        import ldap3  # type: ignore
    except ImportError:
        raise RuntimeError("ldap3 not installed on this server")

    host = creds.get("ldap_host")
    port = int(creds.get("ldap_port") or 389)
    use_ssl = bool(creds.get("ldap_use_ssl"))
    bind_dn = creds.get("ldap_bind_dn") or creds.get("ldap_username")
    pw = creds.get("ldap_password")
    if not host or not bind_dn:
        raise RuntimeError("LDAP host and bind DN are required")

    server = ldap3.Server(host, port=port, use_ssl=use_ssl, get_info=ldap3.ALL)
    conn = ldap3.Connection(server, user=bind_dn, password=pw,
                            auto_bind=True, receive_timeout=20)

    props: Dict[str, Any] = {"directory": "Active Directory / LDAP", "host": host}
    try:
        # ── rootDSE-derived identity (flat scalars, same as legacy) ─────────
        info = server.info
        base: Optional[str] = None
        config_nc: Optional[str] = None
        schema_nc: Optional[str] = None
        forest_func = domain_func = forest_root_domain = None
        if info:
            ncs = list(getattr(info, "naming_contexts", []) or [])
            props["naming_contexts"] = ncs
            other = getattr(info, "other", {}) or {}

            def _o(key):
                val = other.get(key)
                if not val:
                    return None
                return val[0] if isinstance(val, list) else val

            for k in ("defaultNamingContext", "dnsHostName", "serverName",
                      "ldapServiceName"):
                v = _o(k)
                if v:
                    props[k] = v
            config_nc = _o("configurationNamingContext")
            schema_nc = _o("schemaNamingContext")
            forest_func = _o("forestFunctionality")
            domain_func = _o("domainFunctionality")
            forest_root_domain = _o("rootDomainNamingContext")
            dnc = _o("defaultNamingContext")
            base = dnc or (ncs[0] if ncs else None)

        props["default_naming_context"] = base

        def _search(search_base, filt, attributes, cap=300):
            """Run a paged, size-capped read and return the raw entries. Raises
            on a denied subtree so `collect_section` classifies the status."""
            entries = list(conn.extend.standard.paged_search(
                search_base=search_base,
                search_filter=filt,
                search_scope=ldap3.SUBTREE,
                attributes=attributes,
                paged_size=200,
                size_limit=cap,
                generator=True,
            ))
            # Only real entries carry a dn + attributes (skip referrals).
            return [e for e in entries if e.get("type") == "searchResEntry"][:cap]

        # ── forest / domain summary ─────────────────────────────────────────
        def _forest() -> Dict[str, Any]:
            return {
                "forest_name": forest_root_domain or base,
                "forest_functional_level": forest_func,
                "configuration_nc": config_nc,
                "schema_nc": schema_nc,
            }
        props["forest"] = collect_section(_forest)

        def _domain() -> Dict[str, Any]:
            return {
                "domain": base,
                "domain_functional_level": domain_func,
                "default_naming_context": base,
                "dns_host_name": props.get("dnsHostName"),
            }
        props["domain"] = collect_section(_domain)

        if not base:
            # No naming context → nothing else to walk; return identity only.
            props["note"] = "No default naming context exposed by rootDSE"
            return props

        # ── domain controllers (the Domain Controllers OU) ──────────────────
        def _dcs() -> Dict[str, Any]:
            dc_base = "OU=Domain Controllers," + base
            rows = []
            for e in _search(dc_base, "(objectClass=computer)",
                             ["name", "dNSHostName", "operatingSystem",
                              "operatingSystemVersion"], cap=100):
                a = e.get("attributes", {})
                rows.append({
                    "hostname": a.get("name"),
                    "dns_hostname": a.get("dNSHostName"),
                    "os": a.get("operatingSystem"),
                    "os_version": a.get("operatingSystemVersion"),
                })
            return _cap(rows, 100)
        props["domain_controllers"] = collect_section(_dcs)

        # ── sites (Configuration NC → CN=Sites) ─────────────────────────────
        def _sites() -> Dict[str, Any]:
            if not config_nc:
                raise RuntimeError("configurationNamingContext not available")
            sites_base = "CN=Sites," + config_nc
            rows = [{"site_name": e.get("attributes", {}).get("name") or e.get("attributes", {}).get("cn")}
                    for e in _search(sites_base, "(objectClass=site)",
                                     ["name", "cn"], cap=200)]
            return _cap(rows, 200)
        props["sites"] = collect_section(_sites)

        # ── organizational units (hierarchy via DN) ─────────────────────────
        def _ous() -> Dict[str, Any]:
            rows = []
            for e in _search(base, "(objectClass=organizationalUnit)",
                             ["ou", "name", "distinguishedName"], cap=300):
                a = e.get("attributes", {})
                rows.append({"name": a.get("ou") or a.get("name"), "dn": e.get("dn")})
            return _cap(rows, 300)
        props["ous"] = collect_section(_ous)

        # ── computers ───────────────────────────────────────────────────────
        def _computers() -> Dict[str, Any]:
            rows = []
            for e in _search(base, "(objectClass=computer)",
                             ["name", "distinguishedName", "operatingSystem",
                              "operatingSystemVersion", "userAccountControl",
                              "lastLogonTimestamp"], cap=300):
                a = e.get("attributes", {})
                uac = a.get("userAccountControl")
                enabled = None
                if isinstance(uac, int):
                    enabled = not bool(uac & _UAC_DISABLED)
                rows.append({
                    "name": a.get("name"),
                    "dn": e.get("dn"),
                    "os": a.get("operatingSystem"),
                    "os_version": a.get("operatingSystemVersion"),
                    "enabled": enabled,
                    "last_logon_timestamp": a.get("lastLogonTimestamp"),
                })
            return _cap(rows, 300)
        props["computers"] = collect_section(_computers)

        # ── users (inventory metadata only — NO sensitive attributes) ───────
        def _users() -> Dict[str, Any]:
            rows = []
            for e in _search(base, "(&(objectClass=user)(objectCategory=person))",
                             ["sAMAccountName", "distinguishedName",
                              "userAccountControl"], cap=300):
                a = e.get("attributes", {})
                uac = a.get("userAccountControl")
                enabled = None
                if isinstance(uac, int):
                    enabled = not bool(uac & _UAC_DISABLED)
                rows.append({
                    "sam_account_name": a.get("sAMAccountName"),
                    "dn": e.get("dn"),
                    "enabled": enabled,
                })
            return _cap(rows, 300)
        props["users"] = collect_section(_users)

        # ── groups ──────────────────────────────────────────────────────────
        def _groups() -> Dict[str, Any]:
            rows = []
            for e in _search(base, "(objectClass=group)",
                             ["name", "distinguishedName", "groupType", "member"],
                             cap=300):
                a = e.get("attributes", {})
                gt = a.get("groupType")
                scope = None
                if isinstance(gt, int):
                    # groupType bit 0x80000000 => security, low bits => scope.
                    if gt & 0x2:
                        scope = "global"
                    elif gt & 0x4:
                        scope = "domain_local"
                    elif gt & 0x8:
                        scope = "universal"
                members = a.get("member")
                mcount = len(members) if isinstance(members, list) else (1 if members else 0)
                rows.append({
                    "name": a.get("name"),
                    "dn": e.get("dn"),
                    "group_scope": scope,
                    "group_type": gt,
                    "member_count": mcount,
                })
            return _cap(rows, 300)
        props["groups"] = collect_section(_groups)

        return props
    finally:
        try:
            conn.unbind()
        except Exception:  # noqa: BLE001
            pass
