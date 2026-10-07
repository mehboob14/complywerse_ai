"""DigitalOcean's access rules: what the account's estate lets in, and who holds the keys.

DigitalOcean publishes no team-member API, so the people behind console logins are
outside any automated test. What the API does expose is where access is decided:
the cloud firewalls in front of the droplets, who may reach each database, and the
keys and tokens that open the account. `collect` reads those (read-only, every
resource on its own, so a token without one scope loses that resource and not the
review) and `RULES` judge them.

Everything between the API payload and the rule is a pure function, so the
interesting part (which firewall covers which droplet, whether port 22 is open to
the internet, how strong an SSH key is) is tested without a network.
"""
from __future__ import annotations

import base64
import struct
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import digitalocean as do
from .connector_rules import ConnectorRule, Pack, Resource, Snapshot, register

CONNECTOR = "digitalocean"
KEY_AGE_DAYS = do.KEY_AGE_DAYS

WORLD = {"0.0.0.0/0", "::/0"}
SSH_PORT = 22
# Ports of databases and caches that must never face the internet.
DB_PORTS = (3306, 5432, 6379, 27017, 1433, 9200, 11211, 25060, 25061)
_GENERIC_KEY_NAMES = {"key", "test", "default", "ssh", "mykey", "my-key", "new", "temp", "tmp", "admin", "root", "laptop"}
_MIN_RSA_BITS = 2048


# --------------------------------------------------------------------------- #
# Pure helpers: payload → the fields the rules judge                           #
# --------------------------------------------------------------------------- #
def ports_cover(ports: Any, port: int) -> bool:
    """Whether a DigitalOcean port field ("22", "8000-9000", "443,80", "0"/blank = every port) includes `port`."""
    text = str(ports if ports is not None else "").strip().lower()
    if text in ("", "0", "all"):
        return True
    for part in text.split(","):
        part = part.strip()
        try:
            if "-" in part:
                low, high = part.split("-", 1)
                if int(low) <= port <= int(high):
                    return True
            elif int(part) == port:
                return True
        except ValueError:
            continue
    return False


def _addresses(rule: Dict[str, Any]) -> List[str]:
    sources = rule.get("sources") or {}
    return [a for a in (sources.get("addresses") or []) if isinstance(a, str)]


def open_to_world(rule: Dict[str, Any]) -> bool:
    return any(a in WORLD for a in _addresses(rule))


def _is_ip_rule(rule: Dict[str, Any]) -> bool:
    return str(rule.get("protocol") or "").lower() in ("tcp", "udp")


def world_reaches(inbound: Iterable[Dict[str, Any]], port: int) -> bool:
    """Does any inbound rule let the whole internet reach `port`?"""
    return any(_is_ip_rule(r) and open_to_world(r) and ports_cover(r.get("ports"), port) for r in inbound)


def any_to_any(rule: Dict[str, Any]) -> bool:
    """An inbound rule that lets the internet reach every port."""
    every_port = str(rule.get("ports") or "").replace(" ", "").lower() in ("", "0", "all", "1-65535", "0-65535")
    return _is_ip_rule(rule) and open_to_world(rule) and every_port


def ssh_key_strength(public_key: str) -> Tuple[str, Optional[int]]:
    """(algorithm, bits) of an OpenSSH public key; ("unknown", None) when it cannot be read."""
    parts = (public_key or "").split()
    if len(parts) < 2:
        return "unknown", None
    kind = parts[0]
    if kind.startswith("sk-") and kind.endswith("@openssh.com"):       # a hardware-backed (FIDO) key
        kind = kind[3:-len("@openssh.com")]
    if kind == "ssh-ed25519":
        return "ed25519", 256
    if kind.startswith("ecdsa-sha2-nistp"):
        try:
            return "ecdsa", int(kind.rsplit("nistp", 1)[1])
        except ValueError:
            return "ecdsa", None
    if kind == "ssh-dss":
        return "dsa", 1024
    if kind != "ssh-rsa":
        return "unknown", None
    try:
        blob = base64.b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
        fields, offset = [], 0
        while offset + 4 <= len(blob) and len(fields) < 3:
            (length,) = struct.unpack(">I", blob[offset:offset + 4])
            fields.append(blob[offset + 4:offset + 4 + length])
            offset += 4 + length
        modulus = int.from_bytes(fields[2], "big")
        return "rsa", modulus.bit_length()
    except Exception:  # noqa: BLE001 — a key we cannot parse is "unknown", not "weak"
        return "unknown", None


def key_is_strong(algorithm: str, bits: Optional[int]) -> Optional[bool]:
    """True/False when the key can be judged, None when it cannot (never guess a key weak)."""
    if algorithm in ("ed25519",):
        return True
    if algorithm == "ecdsa":
        return None if bits is None else bits >= 256
    if algorithm == "rsa":
        return None if bits is None else bits >= _MIN_RSA_BITS
    if algorithm == "dsa":
        return False
    return None


# ---- one row per resource ------------------------------------------------- #
def account_row(account: Dict[str, Any]) -> Dict[str, Any]:
    status = str(account.get("status") or "").lower() or "unknown"
    return {"name": account.get("email") or "account", "email": account.get("email"),
            "status": status, "status_message": account.get("status_message") or "",
            "email_verified": bool(account.get("email_verified")),
            "team": (account.get("team") or {}).get("name")}


def ssh_key_rows(keys: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for k in keys:
        algorithm, bits = ssh_key_strength(k.get("public_key") or "")
        name = str(k.get("name") or k.get("fingerprint") or k.get("id") or "key")
        rows.append({"name": name, "fingerprint": k.get("fingerprint"), "algorithm": algorithm, "bits": bits,
                     "strong": key_is_strong(algorithm, bits),
                     "attributable": name.strip().lower() not in _GENERIC_KEY_NAMES and len(name.strip()) > 2,
                     "strength": f"{algorithm}{f'-{bits}' if bits else ''}"})
    return rows


def spaces_key_rows(keys: Iterable[Dict[str, Any]], now=None) -> List[Dict[str, Any]]:
    rows = []
    for k in keys:
        grants = [g for g in (k.get("grants") or []) if isinstance(g, dict)]
        full = not grants or any(not g.get("bucket") or str(g.get("permission") or "").lower() == "fullaccess"
                                 for g in grants)
        access = str(k.get("access_key") or "")
        rows.append({"name": f"{k.get('name') or 'Spaces key'} ({access[:4]}…{access[-4:]})" if len(access) > 8
                     else str(k.get("name") or access or "Spaces key"),
                     "full_access": full, "buckets": len({g.get("bucket") for g in grants if g.get("bucket")}),
                     "stale": do._older_than(k.get("created_at"), KEY_AGE_DAYS, now),
                     "created_at": k.get("created_at")})
    return rows


def api_token_rows(tokens: Iterable[Dict[str, Any]], now=None) -> List[Dict[str, Any]]:
    rows = []
    for t in tokens:
        scopes = t.get("scopes") or t.get("scope") or []
        if isinstance(scopes, str):
            scopes = [scopes]
        scopes = [str(s) for s in scopes]
        rows.append({"name": str(t.get("name") or t.get("id") or "token"), "scopes": scopes,
                     "unrestricted": not scopes or "*" in scopes or any(s.strip() == "*" for s in scopes),
                     "stale": do._older_than(t.get("created_at"), KEY_AGE_DAYS, now),
                     "created_at": t.get("created_at")})
    return rows


def firewall_rows(firewalls: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for f in firewalls:
        inbound = [r for r in (f.get("inbound_rules") or []) if isinstance(r, dict)]
        wide = [r for r in inbound if any_to_any(r)]
        rows.append({"name": str(f.get("name") or f.get("id") or "firewall"), "id": f.get("id"),
                     "status": f.get("status"), "droplet_ids": [d for d in (f.get("droplet_ids") or [])],
                     "tags": [t for t in (f.get("tags") or [])], "inbound": inbound,
                     "any_to_any_world": bool(wide),
                     "ssh_world": world_reaches(inbound, SSH_PORT)})
    return rows


def _applying(droplet: Dict[str, Any], firewalls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The cloud firewalls that cover this droplet — by its id or by a tag it carries."""
    tags = set(droplet.get("tags") or [])
    return [f for f in firewalls
            if droplet.get("id") in (f.get("droplet_ids") or []) or tags & set(f.get("tags") or [])]


def droplet_rows(droplets: Iterable[Dict[str, Any]], firewalls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Each droplet, with whether the internet can reach it and what stands in the way.

    A firewall list is a union: every rule of every firewall covering a droplet
    applies, and any rule that allows the traffic lets it in. A public droplet with
    no firewall at all is open on every port the host listens on, so SSH counts as
    reachable."""
    rows = []
    for d in droplets:
        nets = (d.get("networks") or {}).get("v4") or []
        public = any(n.get("type") == "public" for n in nets)
        applying = _applying(d, firewalls)
        inbound = [r for f in applying for r in (f.get("inbound") or [])]
        exposed_db = sorted({p for p in DB_PORTS if world_reaches(inbound, p)})
        if not public:
            ssh_open, why = False, "no public address"
        elif not applying:
            ssh_open, why = True, "no cloud firewall covers it, so port 22 is reachable from anywhere"
        elif world_reaches(inbound, SSH_PORT):
            ssh_open, why = True, "a firewall rule allows port 22 from any address"
        else:
            ssh_open, why = False, "port 22 is not open to the internet"
        rows.append({
            "name": str(d.get("name") or d.get("id") or "droplet"), "id": d.get("id"), "status": d.get("status"),
            "region": ((d.get("region") or {}).get("slug")), "tags": list(d.get("tags") or []),
            "public_ipv4": public, "firewalls": [f["name"] for f in applying], "firewalled": bool(applying),
            "ssh_open_world": ssh_open, "ssh_why": why,
            "db_ports_open_world": bool(exposed_db), "exposed_db_ports": ", ".join(str(p) for p in exposed_db),
        })
    return rows


def database_rows(clusters: Iterable[Dict[str, Any]], trusted: Dict[str, Optional[List[Dict[str, Any]]]],
                  users: Dict[str, Optional[List[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
    """Each cluster, with who may connect and how many admin users it has.
    `trusted`/`users` map cluster id → rules/users, or None when that call was refused."""
    rows = []
    for c in clusters:
        cid = str(c.get("id") or "")
        rules = trusted.get(cid)
        members = users.get(cid)
        known = rules is not None
        wide = bool(known and (not rules or any(str(r.get("value") or "") in WORLD for r in rules)))
        rows.append({
            "name": str(c.get("name") or cid), "id": cid, "engine": (c.get("engine") or "").lower(),
            "in_vpc": bool(c.get("private_network_uuid")),
            "trusted_known": known, "trusted_count": len(rules or []), "open_world": wide,
            "users_known": members is not None,
            "admin_users": sum(1 for u in (members or []) if (u.get("role") or "") == "primary"),
        })
    return rows


def database_user_rows(clusters: Iterable[Dict[str, Any]], users: Dict[str, Optional[List[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
    rows = []
    for c in clusters:
        cid = str(c.get("id") or "")
        for u in (users.get(cid) or []):
            plugin = str(((u.get("mysql_settings") or {}).get("auth_plugin")) or "")
            rows.append({"name": f"{u.get('name')} on {c.get('name') or cid}", "cluster": c.get("name"),
                         "engine": (c.get("engine") or "").lower(), "role": u.get("role"), "auth_plugin": plugin})
    return rows


# --------------------------------------------------------------------------- #
# Collection                                                                   #
# --------------------------------------------------------------------------- #
def _resource(rows: List[Dict[str, Any]], note: Optional[str] = None) -> Resource:
    return Resource(rows=rows, note=note)


def _refused(what: str, reason: Optional[str]) -> Resource:
    return Resource(error=f"The token cannot read {what}: {reason}")


def collect(token: str) -> Tuple[Snapshot, Dict[str, Any]]:
    """Read every resource the rules judge. Returns (snapshot, what was read, by count)."""
    snap: Snapshot = {}
    read: Dict[str, Any] = {}

    payload, reason = do._get(token, "/account")
    if reason:
        raise ValueError(f"DigitalOcean rejected the token — {reason}")
    account = (payload or {}).get("account") or {}
    snap["account"] = _resource([account_row(account)])
    read["account"] = 1

    keys, reason = do._paged(token, "/account/keys", "ssh_keys")
    snap["ssh_keys"] = _refused("SSH keys", reason) if reason else _resource(ssh_key_rows(keys))
    if not reason:
        read["ssh_keys"] = len(keys)

    spaces, reason = do._paged(token, "/spaces/keys", "keys", "spaces_keys")
    snap["spaces_keys"] = _refused("Spaces keys", reason) if reason else _resource(spaces_key_rows(spaces))
    if not reason:
        read["spaces_keys"] = len(spaces)

    tokens, reason = do._paged(token, "/tokens", "tokens")
    snap["api_tokens"] = _refused("API tokens", reason) if reason else _resource(api_token_rows(tokens))
    if not reason:
        read["api_tokens"] = len(tokens)

    firewalls_raw, reason = do._paged(token, "/firewalls", "firewalls")
    fw_rows = [] if reason else firewall_rows(firewalls_raw)
    snap["firewalls"] = _refused("cloud firewalls", reason) if reason else _resource(fw_rows)
    if not reason:
        read["firewalls"] = len(fw_rows)

    droplets_raw, d_reason = do._paged(token, "/droplets", "droplets")
    if d_reason:
        snap["droplets"] = _refused("droplets", d_reason)
    elif reason:
        # Without the firewall list a droplet's exposure cannot be judged either way.
        snap["droplets"] = _refused("the cloud firewalls that decide which droplets are exposed", reason)
    else:
        snap["droplets"] = _resource(droplet_rows(droplets_raw, fw_rows))
        read["droplets"] = len(droplets_raw)

    clusters, c_reason = do._paged(token, "/databases", "databases")
    if c_reason:
        snap["databases"] = snap["database_users"] = _refused("managed databases", c_reason)
    else:
        trusted: Dict[str, Optional[List[Dict[str, Any]]]] = {}
        users: Dict[str, Optional[List[Dict[str, Any]]]] = {}
        unread = 0
        for c in clusters[:do.MAX_CLUSTERS]:
            cid = str(c.get("id") or "")
            fw, why = do._get(token, f"/databases/{cid}/firewall")
            trusted[cid] = None if why else list((fw or {}).get("rules") or [])
            usr, why_u = do._paged(token, f"/databases/{cid}/users", "users")
            users[cid] = None if why_u else usr
            unread += (trusted[cid] is None) + (users[cid] is None)
        shown = clusters[:do.MAX_CLUSTERS]
        note = (f"only the first {do.MAX_CLUSTERS} of {len(clusters)} clusters were read"
                if len(clusters) > do.MAX_CLUSTERS else None)
        snap["databases"] = _resource(database_rows(shown, trusted, users), note)
        snap["database_users"] = _resource(database_user_rows(shown, users), note)
        read["databases"] = len(clusters)
    return snap, read


# --------------------------------------------------------------------------- #
# The rules                                                                    #
# --------------------------------------------------------------------------- #
_PUBLIC = ["public_ipv4", "truthy"]

RULES: Tuple[ConnectorRule, ...] = (
    # ---- Network access ----
    ConnectorRule(
        id="DO-NET-01", connector=CONNECTOR, domain="Network access", severity="high",
        name="Every internet-facing droplet is behind a cloud firewall",
        resource="droplets", scope=_PUBLIC, assertion={"all": ["firewalled", "truthy"]},
        reads="droplets with a public address, and the cloud firewalls that cover them",
        trips="a droplet with a public IPv4 address that no cloud firewall covers",
        fail_msg="{name} has a public address and no cloud firewall covers it",
        na_msg="No droplet has a public address.",
        scf=("NET-01", "NET-03", "NET-04", "IAC-20"),
        fix="Create a cloud firewall that allows only the ports the droplet serves, and attach it by droplet or tag."),
    ConnectorRule(
        id="DO-NET-02", connector=CONNECTOR, domain="Network access", severity="high",
        name="SSH (port 22) is not reachable from the whole internet",
        resource="droplets", scope=_PUBLIC, assertion={"none": ["ssh_open_world", "truthy"]},
        reads="inbound firewall rules for port 22 on every internet-facing droplet",
        trips="a droplet whose port 22 is open to 0.0.0.0/0, or that no firewall covers",
        fail_msg="{name}: {ssh_why}",
        na_msg="No droplet has a public address.",
        scf=("NET-04", "NET-03", "CRY-06", "IAC-20"),
        fix="Allow SSH only from your office or VPN addresses, or reach droplets through a bastion."),
    ConnectorRule(
        id="DO-NET-03", connector=CONNECTOR, domain="Network access", severity="high",
        name="Database and cache ports are not open to the internet",
        resource="droplets", scope=["firewalled", "truthy"], assertion={"none": ["db_ports_open_world", "truthy"]},
        reads="inbound firewall rules for database ports (3306, 5432, 6379, 27017 …)",
        trips="a firewall rule that lets any address reach a database or cache port",
        fail_msg="{name} exposes database port(s) {exposed_db_ports} to any address",
        na_msg="No droplet is covered by a cloud firewall, so there were no firewall rules to read (see DO-NET-01).",
        scf=("NET-04", "NET-03", "IAC-20"),
        fix="Restrict those ports to the droplets or private addresses that need them."),
    ConnectorRule(
        id="DO-NET-04", connector=CONNECTOR, domain="Network access", severity="high",
        name="No firewall allows all traffic from anywhere",
        resource="firewalls", assertion={"none": ["any_to_any_world", "truthy"]},
        reads="inbound rules of every cloud firewall",
        trips="an inbound rule that opens every port to 0.0.0.0/0",
        fail_msg="{name} has an inbound rule that opens every port to any address",
        na_msg="There are no cloud firewalls to read.",
        scf=("NET-04", "NET-04.1", "CFG-03", "NET-03"),
        fix="Replace the any-to-any rule with rules for the specific ports and sources needed."),
    # ---- Databases ----
    ConnectorRule(
        id="DO-DBS-01", connector=CONNECTOR, domain="Databases", severity="high",
        name="Managed databases accept connections only from trusted sources",
        resource="databases", scope=["trusted_known", "truthy"], assertion={"none": ["open_world", "truthy"]},
        reads="each managed database's trusted-sources list",
        trips="an empty trusted-sources list, or one that allows 0.0.0.0/0",
        fail_msg="{name} accepts connections from any address",
        na_msg="No managed database was found, or its trusted sources could not be read.",
        scf=("NET-04", "IAC-20", "NET-03"),
        fix="Add the droplets, Kubernetes clusters or addresses that need the database as trusted sources."),
    ConnectorRule(
        id="DO-DBS-02", connector=CONNECTOR, domain="Databases", severity="medium",
        name="Managed databases sit on a private network",
        resource="databases", assertion={"all": ["in_vpc", "truthy"]},
        reads="each managed database's VPC",
        trips="a database cluster that is not attached to a private VPC",
        fail_msg="{name} is not attached to a private network",
        na_msg="No managed database was found.",
        scf=("NET-03", "CLD-03", "NET-02"),
        fix="Place the cluster in a VPC and connect applications through its private address."),
    ConnectorRule(
        id="DO-DBS-03", connector=CONNECTOR, domain="Databases", severity="medium",
        name="Each database cluster has at most one admin user",
        resource="databases", scope=["users_known", "truthy"], assertion={"all": ["admin_users", "lte", 1]},
        reads="the users of each managed database and their role",
        trips="more than one user with the admin (primary) role",
        fail_msg="{name} has {admin_users} admin users",
        na_msg="No managed database was found, or its users could not be read.",
        scf=("IAC-16", "IAC-21", "IAC-08"),
        fix="Keep the default admin for administration and give applications their own least-privilege users."),
    ConnectorRule(
        id="DO-DBS-04", connector=CONNECTOR, domain="Databases", severity="medium",
        name="MySQL users do not use the legacy password plugin",
        resource="database_users", scope={"and": [["engine", "eq", "mysql"], ["auth_plugin", "ne", ""]]},
        assertion={"none": ["auth_plugin", "eq", "mysql_native_password"]},
        reads="the authentication plugin of every MySQL user",
        trips="a user that authenticates with mysql_native_password",
        fail_msg="{name} uses the legacy mysql_native_password plugin",
        na_msg="No MySQL user with a recorded authentication plugin was found.",
        scf=("IAC-10", "IAC-02"),
        fix="Switch the user to caching_sha2_password."),
    # ---- Keys and tokens ----
    ConnectorRule(
        id="DO-KEY-01", connector=CONNECTOR, domain="Keys & tokens", severity="high",
        name="SSH keys use a strong algorithm and length",
        resource="ssh_keys", scope=["strong", "ne", None], assertion={"all": ["strong", "truthy"]},
        reads="the public key of every SSH key on the account",
        trips="a DSA key, or an RSA key shorter than 2048 bits",
        fail_msg="{name} is a weak key ({strength})",
        na_msg="The account holds no SSH keys.",
        scf=("IAC-10", "CRY-01", "CRY-09"),
        fix="Replace it with an Ed25519 or RSA 3072+ key and remove the old one from the account."),
    ConnectorRule(
        id="DO-KEY-02", connector=CONNECTOR, domain="Keys & tokens", severity="low",
        name="SSH keys are named for the person or system that owns them",
        resource="ssh_keys", assertion={"all": ["attributable", "truthy"]},
        reads="the name of every SSH key",
        trips="a generic name such as 'key', 'test' or 'default', so no owner can be told from it",
        fail_msg="{name} cannot be tied to an owner",
        na_msg="The account holds no SSH keys.",
        scf=("IAC-09", "IAC-15"),
        fix="Rename the key after its owner or the system that uses it."),
    ConnectorRule(
        id="DO-SPC-01", connector=CONNECTOR, domain="Keys & tokens", severity="high",
        name="Spaces keys are limited to named buckets",
        resource="spaces_keys", assertion={"none": ["full_access", "truthy"]},
        reads="the grants on every Spaces access key",
        trips="a key with full access, or with no bucket limit",
        fail_msg="{name} can read and write every bucket",
        na_msg="The account holds no Spaces keys.",
        scf=("IAC-21", "IAC-20"),
        fix="Re-issue the key with a grant on only the buckets it needs."),
    ConnectorRule(
        id="DO-SPC-02", connector=CONNECTOR, domain="Keys & tokens", severity="medium",
        name=f"Spaces keys are rotated within {KEY_AGE_DAYS} days",
        resource="spaces_keys", assertion={"none": ["stale", "truthy"]},
        reads="the creation date of every Spaces access key",
        trips=f"a key issued more than {KEY_AGE_DAYS} days ago",
        fail_msg="{name} was issued more than 90 days ago",
        na_msg="The account holds no Spaces keys.",
        scf=("IAC-10", "CRY-09"),
        fix="Create a replacement key, move the application to it and delete the old one."),
    ConnectorRule(
        id="DO-TOK-01", connector=CONNECTOR, domain="Keys & tokens", severity="high",
        name="API tokens are scoped, not full-account",
        resource="api_tokens", assertion={"none": ["unrestricted", "truthy"]},
        reads="the scopes of every personal access token",
        trips="a token with no scope limit",
        fail_msg="{name} has no scope limit",
        na_msg="The account holds no API tokens.",
        scf=("IAC-21", "IAC-20"),
        fix="Re-issue the token with only the scopes it needs."),
    ConnectorRule(
        id="DO-TOK-02", connector=CONNECTOR, domain="Keys & tokens", severity="medium",
        name=f"API tokens are rotated within {KEY_AGE_DAYS} days",
        resource="api_tokens", assertion={"none": ["stale", "truthy"]},
        reads="the creation date of every personal access token",
        trips=f"a token issued more than {KEY_AGE_DAYS} days ago",
        fail_msg="{name} was issued more than 90 days ago",
        na_msg="The account holds no API tokens.",
        scf=("IAC-10", "CRY-09"),
        fix="Regenerate the token on a schedule and revoke the old one."),
    # ---- Account ----
    ConnectorRule(
        id="DO-ACC-01", connector=CONNECTOR, domain="Account", severity="medium",
        name="The DigitalOcean account is in good standing",
        resource="account", assertion={"all": ["status", "eq", "active"]},
        reads="the account's status",
        trips="a warning or locked account",
        fail_msg="The account is {status}: {status_message}",
        scf=("IAC-15",),
        fix="Resolve the billing or verification issue DigitalOcean reports."),
    ConnectorRule(
        id="DO-ACC-02", connector=CONNECTOR, domain="Account", severity="low",
        name="The account owner's email address is verified",
        resource="account", assertion={"all": ["email_verified", "truthy"]},
        reads="whether the account email is verified",
        trips="an unverified account email",
        fail_msg="{email} is not verified",
        scf=("IAC-28", "IAC-09"),
        fix="Verify the address from the confirmation email."),
)

PACK = register(Pack(
    connector=CONNECTOR, label="DigitalOcean", collect=collect, rules=RULES,
    token_for=do.token_for_tenant,
    limits=("DigitalOcean publishes no team-member API, so people with console logins cannot be tested "
            "automatically; the rules cover what the API shows — firewalls, droplets, databases, keys and tokens."),
))
