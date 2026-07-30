"""Per-platform inventory collectors — the typed-asset "components" layer.

The OS-host collectors (collect_windows / collect_linux) capture CPU/RAM/disk +
installed software. But a database, a network device, a cloud account and an
identity store each have a COMPLETELY different component model — a Postgres
asset has no "VCPU / OS Edition", it has a version, databases, extensions and
security-relevant settings. Forcing every kind through the server columns left
those assets blank and misleading.

This module is the parallel to the CIS runner registry: one collector per
platform, each returning `(platform_kind, properties)` where `properties` is a
kind-specific JSON block. The frontend renders a dedicated detail card per
`platform_kind`, hiding the server hardware/OS fields that don't apply.

Contract, mirroring the runners:
  * READ-ONLY. Collectors MUST NOT mutate the target.
  * Best-effort per field — a query that fails degrades that field to absent,
    never fails the whole collect.
  * Registered by the same `integration_type` the Connect Wizard / CIS runners
    use, so one credential drives both the CIS scan and the inventory.

Only PostgreSQL is implemented here so far; the remaining platforms (mysql,
mssql, oracle, cisco, aws, digitalocean-account, azure, k8s, ad) register the
same way — each with its own distinct property model.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# integration_type -> the coarse kind that drives the detail card the UI shows.
PLATFORM_KINDS: Dict[str, str] = {
    "postgres_sql": "database",
    "mysql_sql": "database",
    "mssql_sql": "database",
    "oracle_sql": "database",
    "netdev_ssh": "network",
    "aws_readonly": "cloud",
    "azure_readonly": "cloud",
    "k8s_api": "cluster",
    "ldap_query": "identity",
}

# integration_type -> collector callable(creds) -> properties dict.
_COLLECTORS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def register(integration_type: str):
    def deco(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        _COLLECTORS[integration_type] = fn
        return fn
    return deco


def has_collector(integration_type: str) -> bool:
    return integration_type in _COLLECTORS


def collect_platform(
    integration_type: str, creds: Dict[str, Any]
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Run the platform collector. Returns (platform_kind, properties) or None
    when no collector is registered for this platform. Raises RuntimeError with
    a human cause on a connection/auth failure so the caller can record it."""
    fn = _COLLECTORS.get(integration_type)
    if fn is None:
        return None
    props = fn(creds)
    kind = PLATFORM_KINDS.get(integration_type, "server")
    return kind, props


# ── PostgreSQL ───────────────────────────────────────────────────────────────

# Security-relevant settings surfaced on the detail card (CIS Postgres themes:
# transport encryption, exposure, auth strength, logging).
_PG_SETTINGS = (
    "server_version", "ssl", "listen_addresses", "port",
    "password_encryption", "log_connections", "log_disconnections",
    "logging_collector", "max_connections", "shared_buffers",
)


@register("postgres_sql")
def collect_postgres(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory a PostgreSQL instance over a read-only connection.

    Reuses the same credential keys the CIS postgres runner uses
    (postgres_host/port/username/password/database). Returns the DB's OWN model:
    engine + version, listening port, databases, installed extensions, role
    summary, and the security-relevant settings.
    """
    try:
        import psycopg2  # type: ignore
    except ImportError:
        raise RuntimeError("psycopg2 not installed on this server")

    host = creds.get("postgres_host")
    port = int(creds.get("postgres_port") or 5432)
    user = creds.get("postgres_username")
    pw = creds.get("postgres_password")
    db = creds.get("postgres_database") or "postgres"
    if not host or not user:
        raise RuntimeError("PostgreSQL host and username are required")

    conn = psycopg2.connect(
        host=host, port=port, user=user, password=pw, dbname=db,
        connect_timeout=int(creds.get("timeout") or 10),
    )
    props: Dict[str, Any] = {"engine": "PostgreSQL", "host": host, "port": port}
    try:
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()

        def _safe(sql: str):
            try:
                cur.execute(sql)
                return cur.fetchall()
            except Exception:  # noqa: BLE001 — one query failing must not abort
                conn.rollback()
                return []

        ver = _safe("SHOW server_version")
        if ver:
            props["version"] = str(ver[0][0])

        dbs = _safe(
            "SELECT datname FROM pg_database "
            "WHERE datistemplate = false ORDER BY datname"
        )
        props["databases"] = [r[0] for r in dbs]
        props["database_count"] = len(props["databases"])

        exts = _safe("SELECT extname, extversion FROM pg_extension ORDER BY extname")
        props["extensions"] = [{"name": r[0], "version": r[1]} for r in exts]

        roles = _safe(
            "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname"
        )
        props["role_count"] = len(roles)
        props["superusers"] = [r[0] for r in roles if r[1]]
        props["login_roles"] = sum(1 for r in roles if r[2])

        placeholders = ",".join("'%s'" % s for s in _PG_SETTINGS)
        settings_rows = _safe(
            "SELECT name, setting FROM pg_settings "
            f"WHERE name IN ({placeholders}) ORDER BY name"
        )
        props["settings"] = {r[0]: r[1] for r in settings_rows}
        # Convenience flags the card highlights.
        s = props["settings"]
        props["ssl_enabled"] = (s.get("ssl") == "on")
        props["publicly_listening"] = (s.get("listen_addresses") in ("*", "0.0.0.0"))
        return props
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def _safe_cursor(cur, conn):
    """Return a `_safe(sql)->rows` helper that swallows per-query errors and
    rolls back so one failed query never aborts the whole collect."""
    def _safe(sql: str):
        try:
            cur.execute(sql)
            return cur.fetchall()
        except Exception:  # noqa: BLE001
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            return []
    return _safe


# ── MySQL / MariaDB ────────────────────────────────────────────────────────

@register("mysql_sql")
def collect_mysql(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pymysql  # type: ignore
    except ImportError:
        raise RuntimeError("pymysql not installed on this server")
    host = creds.get("mysql_host"); port = int(creds.get("mysql_port") or 3306)
    user = creds.get("mysql_username"); pw = creds.get("mysql_password")
    db = creds.get("mysql_database") or "information_schema"
    if not host or not user:
        raise RuntimeError("MySQL host and username are required")
    conn = pymysql.connect(host=host, port=port, user=user, password=pw,
                           database=db, connect_timeout=int(creds.get("timeout") or 10))
    props: Dict[str, Any] = {"engine": "MySQL / MariaDB", "host": host, "port": port}
    try:
        cur = conn.cursor(); _safe = _safe_cursor(cur, conn)
        v = _safe("SELECT VERSION()")
        if v:
            props["version"] = str(v[0][0])
        schemas = _safe("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name")
        props["databases"] = [r[0] for r in schemas]; props["database_count"] = len(props["databases"])
        plugins = _safe("SELECT plugin_name FROM information_schema.plugins WHERE plugin_status='ACTIVE' ORDER BY plugin_name")
        props["plugins"] = [r[0] for r in plugins]
        users = _safe("SELECT user, host FROM mysql.user")
        props["user_count"] = len(users) if users else None
        vs = _safe("SHOW VARIABLES WHERE Variable_name IN "
                   "('have_ssl','require_secure_transport','local_infile','max_connections','version_compile_os')")
        props["settings"] = {r[0]: r[1] for r in vs}
        props["ssl_enabled"] = (props["settings"].get("have_ssl") == "YES")
        return props
    finally:
        try: conn.close()
        except Exception: pass  # noqa: BLE001


# ── Microsoft SQL Server ────────────────────────────────────────────────────

@register("mssql_sql")
def collect_mssql(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pymssql  # type: ignore
    except ImportError:
        raise RuntimeError("pymssql not installed on this server")
    host = creds.get("mssql_host"); port = int(creds.get("mssql_port") or 1433)
    user = creds.get("mssql_username"); pw = creds.get("mssql_password")
    db = creds.get("mssql_database") or "master"
    if not host or not user:
        raise RuntimeError("MSSQL host and username are required")
    conn = pymssql.connect(server=host, port=str(port), user=user, password=pw,
                           database=db, login_timeout=int(creds.get("timeout") or 10))
    props: Dict[str, Any] = {"engine": "Microsoft SQL Server", "host": host, "port": port}
    try:
        cur = conn.cursor(); _safe = _safe_cursor(cur, conn)
        e = _safe("SELECT CAST(SERVERPROPERTY('Edition') AS VARCHAR(200)), "
                  "CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(50))")
        if e:
            props["edition"] = e[0][0]; props["version"] = e[0][1]
        dbs = _safe("SELECT name FROM sys.databases ORDER BY name")
        props["databases"] = [r[0] for r in dbs]; props["database_count"] = len(props["databases"])
        logins = _safe("SELECT name, is_disabled FROM sys.sql_logins")
        props["login_count"] = len(logins) if logins else None
        cfg = _safe("SELECT name, CAST(value_in_use AS VARCHAR(50)) FROM sys.configurations "
                    "WHERE name IN ('remote access','xp_cmdshell','clr enabled','contained database authentication')")
        props["settings"] = {r[0]: r[1] for r in cfg}
        return props
    finally:
        try: conn.close()
        except Exception: pass  # noqa: BLE001


# ── Oracle Database ─────────────────────────────────────────────────────────

@register("oracle_sql")
def collect_oracle(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import oracledb  # type: ignore
    except ImportError:
        raise RuntimeError("oracledb not installed on this server")
    host = creds.get("oracle_host"); port = int(creds.get("oracle_port") or 1521)
    user = creds.get("oracle_username"); pw = creds.get("oracle_password")
    service = creds.get("oracle_service_name"); sid = creds.get("oracle_sid")
    if not host or not user or not (service or sid):
        raise RuntimeError("Oracle host, username, and service_name/sid are required")
    dsn = oracledb.makedsn(host, port, service_name=service) if service else oracledb.makedsn(host, port, sid=sid)
    conn = oracledb.connect(user=user, password=pw, dsn=dsn)
    props: Dict[str, Any] = {"engine": "Oracle Database", "host": host, "port": port,
                             "service_name": service, "sid": sid}
    try:
        cur = conn.cursor(); _safe = _safe_cursor(cur, conn)
        v = _safe("SELECT banner FROM v$version WHERE ROWNUM = 1")
        if v:
            props["version"] = str(v[0][0])
        inst = _safe("SELECT instance_name, host_name, version FROM v$instance")
        if inst:
            props["instances"] = [{"name": r[0], "host": r[1], "version": r[2]} for r in inst]
        ts = _safe("SELECT tablespace_name FROM dba_tablespaces ORDER BY tablespace_name")
        props["tablespaces"] = [r[0] for r in ts]
        users = _safe("SELECT COUNT(*) FROM dba_users")
        if users:
            props["user_count"] = int(users[0][0])
        return props
    finally:
        try: conn.close()
        except Exception: pass  # noqa: BLE001


# ── Cisco / network device (SSH) ────────────────────────────────────────────

@register("netdev_ssh")
def collect_cisco(creds: Dict[str, Any]) -> Dict[str, Any]:
    import re
    try:
        import paramiko  # type: ignore
    except ImportError:
        raise RuntimeError("paramiko not installed on this server")
    host = creds.get("ssh_host"); port = int(creds.get("ssh_port") or 22)
    user = creds.get("ssh_username"); pw = creds.get("ssh_password")
    pkey = creds.get("ssh_private_key")
    if not host or not user:
        raise RuntimeError("SSH host and username are required")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: Dict[str, Any] = dict(hostname=host, port=port, username=user, timeout=15,
                                  allow_agent=False, look_for_keys=False)
    if pkey:
        from io import StringIO
        try:
            kwargs["pkey"] = paramiko.RSAKey.from_private_key(StringIO(pkey))
        except Exception:  # noqa: BLE001
            kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(StringIO(pkey))
    else:
        kwargs["password"] = pw
    client.connect(**kwargs)
    props: Dict[str, Any] = {"device_class": "network"}
    try:
        def _run(cmd: str) -> str:
            try:
                _i, out, _e = client.exec_command(cmd, timeout=15)
                return out.read().decode(errors="replace")
            except Exception:  # noqa: BLE001
                return ""
        ver = _run("show version")
        for key, pat in (
            ("os_version", r"(?:IOS[ -].*Version|Version)\s+([0-9][^\s,]+)"),
            ("model", r"(?:cisco\s+(\S+)\s+.*(?:processor|chassis)|Model number\s*:\s*(\S+))"),
            ("serial", r"(?:[Pp]rocessor board ID\s+(\S+)|System serial number\s*:\s*(\S+))"),
            ("uptime", r"\buptime is\s+(.+)"),
        ):
            m = re.search(pat, ver, re.IGNORECASE)
            if m:
                props[key] = next((g for g in m.groups() if g), "").strip()
        props["raw_show_version"] = ver[:2000]
        return props
    finally:
        try: client.close()
        except Exception: pass  # noqa: BLE001


# ── AWS account ─────────────────────────────────────────────────────────────

@register("aws_readonly")
def collect_aws(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError("boto3 not installed on this server")
    region = creds.get("aws_region") or "us-east-1"
    session = boto3.session.Session(
        aws_access_key_id=creds.get("aws_access_key_id"),
        aws_secret_access_key=creds.get("aws_secret_access_key"),
        aws_session_token=creds.get("aws_session_token") or None,
        region_name=region,
    )
    props: Dict[str, Any] = {"provider": "AWS", "region": region}

    def _safe(fn, default=None):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return default

    acct = _safe(lambda: session.client("sts").get_caller_identity().get("Account"))
    if acct:
        props["account_id"] = acct
    regions = _safe(lambda: [r["RegionName"] for r in session.client("ec2").describe_regions()["Regions"]], [])
    props["regions"] = regions; props["region_count"] = len(regions or [])
    props["ec2_instances"] = _safe(
        lambda: sum(len(r["Instances"]) for r in session.client("ec2").describe_instances()["Reservations"]))
    props["s3_buckets"] = _safe(lambda: len(session.client("s3").list_buckets()["Buckets"]))
    props["rds_instances"] = _safe(lambda: len(session.client("rds").describe_db_instances()["DBInstances"]))
    return props


# ── Azure subscription ──────────────────────────────────────────────────────

@register("azure_readonly")
def collect_azure(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from azure.identity import ClientSecretCredential  # type: ignore
        from azure.mgmt.resource import ResourceManagementClient  # type: ignore
    except ImportError:
        raise RuntimeError("azure-identity / azure-mgmt-resource not installed on this server")
    sub = creds.get("azure_subscription_id"); tenant = creds.get("azure_tenant_id")
    cid = creds.get("azure_client_id"); secret = creds.get("azure_client_secret")
    if not (sub and tenant and cid and secret):
        raise RuntimeError("Azure subscription/tenant/client id/secret are required")
    cred = ClientSecretCredential(tenant_id=tenant, client_id=cid, client_secret=secret)
    client = ResourceManagementClient(cred, sub)
    props: Dict[str, Any] = {"provider": "Azure", "subscription_id": sub}

    def _safe(fn, default=None):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return default

    rgs = _safe(lambda: [g.name for g in client.resource_groups.list()], [])
    props["resource_groups"] = rgs; props["resource_group_count"] = len(rgs or [])
    props["resource_count"] = _safe(lambda: sum(1 for _ in client.resources.list()))
    return props


# ── Kubernetes cluster ──────────────────────────────────────────────────────

@register("k8s_api")
def collect_k8s(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from kubernetes import client as k8s, config as k8scfg  # type: ignore
    except ImportError:
        raise RuntimeError("kubernetes client not installed on this server")
    import os as _os
    import tempfile
    kubeconfig = creds.get("kubeconfig")
    if kubeconfig:
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
            fh.write(kubeconfig); path = fh.name
        try:
            k8scfg.load_kube_config(config_file=path)
        finally:
            try: _os.unlink(path)
            except Exception: pass  # noqa: BLE001
    elif creds.get("k8s_server"):
        cfg = k8s.Configuration()
        cfg.host = creds.get("k8s_server")
        cfg.api_key = {"authorization": "Bearer " + (creds.get("k8s_token") or "")}
        cfg.verify_ssl = False
        k8s.Configuration.set_default(cfg)
    else:
        raise RuntimeError("Kubernetes needs a kubeconfig or server+token")
    props: Dict[str, Any] = {"provider": "Kubernetes"}

    def _safe(fn, default=None):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return default

    ver = _safe(lambda: k8s.VersionApi().get_code())
    if ver is not None:
        props["version"] = f"{ver.major}.{ver.minor}"
    core = k8s.CoreV1Api()
    props["node_count"] = _safe(lambda: len(core.list_node().items))
    ns = _safe(lambda: [n.metadata.name for n in core.list_namespace().items], [])
    props["namespaces"] = ns; props["namespace_count"] = len(ns or [])
    props["pod_count"] = _safe(lambda: len(core.list_pod_for_all_namespaces().items))
    return props


# ── Active Directory / LDAP ─────────────────────────────────────────────────

@register("ldap_query")
def collect_ad(creds: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import ldap3  # type: ignore
    except ImportError:
        raise RuntimeError("ldap3 not installed on this server")
    host = creds.get("ldap_host"); port = int(creds.get("ldap_port") or 389)
    use_ssl = bool(creds.get("ldap_use_ssl"))
    bind_dn = creds.get("ldap_bind_dn") or creds.get("ldap_username")
    pw = creds.get("ldap_password")
    if not host or not bind_dn:
        raise RuntimeError("LDAP host and bind DN are required")
    server = ldap3.Server(host, port=port, use_ssl=use_ssl, get_info=ldap3.DSA)
    conn = ldap3.Connection(server, user=bind_dn, password=pw, auto_bind=True, receive_timeout=15)
    props: Dict[str, Any] = {"directory": "Active Directory / LDAP", "host": host}
    try:
        info = server.info
        base = None
        if info:
            ncs = list(getattr(info, "naming_contexts", []) or [])
            props["naming_contexts"] = ncs
            other = getattr(info, "other", {}) or {}
            for k in ("defaultNamingContext", "domainFunctionality",
                      "forestFunctionality", "dnsHostName"):
                val = other.get(k)
                if val:
                    props[k] = val[0] if isinstance(val, list) else val
            dnc = other.get("defaultNamingContext")
            base = (dnc[0] if isinstance(dnc, list) else dnc) if dnc else (ncs[0] if ncs else None)

        def _count(filt: str):
            try:
                conn.search(base, filt, attributes=["cn"], size_limit=10000)
                return len(conn.entries)
            except Exception:  # noqa: BLE001
                return None

        if base:
            props["user_count"] = _count("(&(objectClass=user)(objectCategory=person))")
            props["computer_count"] = _count("(objectClass=computer)")
            props["ou_count"] = _count("(objectClass=organizationalUnit)")
        return props
    finally:
        try: conn.unbind()
        except Exception: pass  # noqa: BLE001
