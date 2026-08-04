"""Live credential pre-flight for integration connections.

Goal: catch bad credentials at the wizard / "Add Connection" step rather
than letting them sit in the DB and silently fail every scheduled scan.

Each runner type has its own pre-flight strategy:

  • windows_winrm  — open a WinRM session and run `whoami` (read-only).
                     Returns:
                       ok           → AUTH OK + identity string
                       auth_failed  → username/password rejected by NTLM
                     network_unreachable → host name does not resolve / port closed
                     ssl_error    → unusual: pywinrm reports an SSL issue
                                     even though we default `cert_validation`
                                     to "ignore". Happens when the cert is
                                     totally absent (HTTP listener only).

  • linux_ssh      — open paramiko SSH session and `whoami`.
                     Returns the same { ok / auth_failed / network_unreachable
                     / host_key_unknown } status.

  • aws_readonly   — boto3 STS GetCallerIdentity.

The pre-flight never *writes* anything — only reads — so it is safe to
run repeatedly (eg. from a "Test Connection" button on the UI).
"""
from __future__ import annotations

import socket
from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class PreflightResult:
    ok: bool
    code: str       # "ok" | "auth_failed" | "network_unreachable" | "ssl_error" | "config_error" | "unknown"
    detail: str     # human-readable explanation
    identity: str | None = None   # who we authenticated as (for "ok" results)


# ─── Windows WinRM ──────────────────────────────────────────────────────────

def _preflight_winrm(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import winrm  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "pywinrm not installed on this server")

    endpoint = creds.get("winrm_endpoint")
    username = creds.get("winrm_username")
    password = creds.get("winrm_password")
    transport = (creds.get("winrm_transport") or "ntlm").lower()
    cert_val = (creds.get("winrm_server_cert_validation") or "ignore").lower()
    if not endpoint or not username or not password:
        return PreflightResult(False, "config_error",
            "WinRM endpoint, username, and password are all required")

    # Cheap TCP reachability check first — gives the operator a clearer
    # error than the eventual pywinrm timeout if the host is offline /
    # WinRM service is not running / firewall blocks 5986.
    try:
        from urllib.parse import urlparse
        u = urlparse(endpoint)
        host = u.hostname
        port = u.port or (5986 if u.scheme == "https" else 5985)
        with socket.create_connection((host, port), timeout=5):
            pass
    except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
        return PreflightResult(
            False, "network_unreachable",
            f"Cannot reach {endpoint!r}: {type(e).__name__} — is WinRM running on the target and is port {port} open?",
        )

    try:
        session = winrm.Session(
            endpoint,
            auth=(username, password),
            transport=transport,
            server_cert_validation=cert_val,
            read_timeout_sec=15,
            operation_timeout_sec=10,
        )
        r = session.run_cmd("whoami")
        if int(r.status_code) == 0:
            ident = (r.std_out or b"").decode("utf-8", errors="replace").strip()
            return PreflightResult(True, "ok", "WinRM auth succeeded.", identity=ident)
        else:
            err = (r.std_err or b"").decode("utf-8", errors="replace").strip()
            return PreflightResult(False, "config_error",
                f"WinRM responded but `whoami` exited {r.status_code}: {err[:200]}")
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        low = msg.lower()
        if "credentials were rejected" in low or "401" in low or "access is denied" in low:
            return PreflightResult(False, "auth_failed",
                "WinRM rejected the username/password. Check spelling, verify the account "
                "exists on the target Windows host, and confirm it is not locked.")
        if "ssl" in low or "certificate" in low:
            return PreflightResult(False, "ssl_error",
                f"TLS handshake failed: {msg[:200]}")
        return PreflightResult(False, "unknown", f"WinRM error: {msg[:200]}")


# ─── Linux SSH ──────────────────────────────────────────────────────────────

def _preflight_ssh(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import paramiko  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "paramiko not installed on this server")

    host = creds.get("ssh_host")
    port = int(creds.get("ssh_port") or 22)
    username = creds.get("ssh_username")
    password = creds.get("ssh_password")
    pkey = creds.get("ssh_private_key")
    if not host or not username:
        return PreflightResult(False, "config_error", "SSH host and username are required")
    if not (password or pkey):
        return PreflightResult(False, "config_error", "SSH password or private key required")

    try:
        with socket.create_connection((host, port), timeout=5):
            pass
    except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
        return PreflightResult(False, "network_unreachable",
            f"Cannot reach {host}:{port}: {type(e).__name__} — is sshd running on the target?")

    client = paramiko.SSHClient()
    # Accept the host key on first contact — same trust model as the wizard.
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        if pkey:
            from io import StringIO
            pkey_obj = paramiko.RSAKey.from_private_key(StringIO(pkey))
            client.connect(host, port=port, username=username, pkey=pkey_obj, timeout=10)
        else:
            client.connect(host, port=port, username=username, password=password, timeout=10,
                           allow_agent=False, look_for_keys=False)
        # 5s was too tight for cross-internet targets — auth would succeed
        # then the exec channel would hit socket.timeout (which stringifies to
        # ""), surfacing a blank "SSH error:". 20s gives a remote host room to
        # open the session channel and return `whoami`.
        _stdin, stdout, _stderr = client.exec_command("whoami", timeout=20)
        ident = stdout.read().decode().strip()
        return PreflightResult(True, "ok", "SSH auth succeeded.", identity=ident)
    except paramiko.AuthenticationException:
        return PreflightResult(False, "auth_failed",
            "SSH rejected the credentials. Check username/password or private key.")
    except paramiko.SSHException as e:
        detail = str(e) or f"{type(e).__name__} (no message)"
        return PreflightResult(False, "unknown", f"SSH protocol error: {detail}")
    except Exception as e:  # noqa: BLE001
        # Never surface a blank error: socket.timeout / EOFError stringify to
        # "", which told the operator nothing. Fall back to the exception type
        # plus a hint about the usual post-auth cause.
        detail = str(e)[:200] or (
            f"{type(e).__name__} with no message — auth succeeded but the read-only "
            "`whoami` did not return in time (slow/remote host or the account's "
            "session was closed by the server)."
        )
        return PreflightResult(False, "unknown", f"SSH error: {detail}")
    finally:
        try:
            client.close()
        except Exception:
            pass


# ─── AWS Read-Only ──────────────────────────────────────────────────────────

def _preflight_aws(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import boto3  # type: ignore
        from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "boto3 not installed on this server")

    ak = creds.get("aws_access_key_id")
    sk = creds.get("aws_secret_access_key")
    st = creds.get("aws_session_token") or None
    region = creds.get("aws_region") or "us-east-1"
    if not ak or not sk:
        return PreflightResult(False, "config_error",
            "AWS access_key_id and secret_access_key are required")

    try:
        session = boto3.session.Session(
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            aws_session_token=st,
            region_name=region,
        )
        sts = session.client("sts")
        ident = sts.get_caller_identity()
        return PreflightResult(True, "ok",
            f"AWS STS reachable; arn={ident.get('Arn')}",
            identity=ident.get("Arn"))
    except NoCredentialsError:
        return PreflightResult(False, "auth_failed", "boto3 reported no credentials supplied")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("InvalidClientTokenId", "SignatureDoesNotMatch", "AuthFailure"):
            return PreflightResult(False, "auth_failed",
                f"AWS rejected credentials ({code}). Verify access key + secret.")
        return PreflightResult(False, "unknown", f"AWS error: {code}: {e}")
    except EndpointConnectionError as e:
        return PreflightResult(False, "network_unreachable",
            f"Cannot reach AWS STS endpoint: {e}")


# ─── SQL databases (Postgres / MSSQL / MySQL) ───────────────────────────────

def _tcp_open(host: str, port: int, timeout: float = 5.0) -> PreflightResult | None:
    """Return a network_unreachable result if TCP fails; None if open."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return None
    except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
        return PreflightResult(
            False, "network_unreachable",
            f"Cannot reach {host}:{port}: {type(e).__name__}",
        )


def _preflight_postgres(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import psycopg2  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "psycopg2 not installed on this server")
    host = creds.get("postgres_host")
    port = int(creds.get("postgres_port") or 5432)
    user = creds.get("postgres_username")
    pw = creds.get("postgres_password")
    db = creds.get("postgres_database") or "postgres"
    if not host or not user or not pw:
        return PreflightResult(False, "config_error",
            "postgres_host, postgres_username, and postgres_password are required")
    unreachable = _tcp_open(host, port)
    if unreachable:
        return unreachable
    try:
        conn = psycopg2.connect(
            host=host, port=port, user=user, password=pw, dbname=db, connect_timeout=8,
        )
        cur = conn.cursor()
        cur.execute("SELECT current_user, current_setting('server_version')")
        who, ver = cur.fetchone()
        cur.close()
        conn.close()
        return PreflightResult(True, "ok",
            f"PostgreSQL auth succeeded (server {ver}).", identity=str(who))
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        low = msg.lower()
        if "password" in low or "authentication" in low or "auth" in low:
            return PreflightResult(False, "auth_failed",
                f"PostgreSQL rejected the credentials: {msg[:220]}")
        if "timeout" in low or "could not connect" in low or "refused" in low:
            return PreflightResult(False, "network_unreachable", msg[:220])
        return PreflightResult(False, "unknown", f"PostgreSQL error: {msg[:220]}")


def _preflight_mssql(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import pymssql  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "pymssql not installed on this server")
    host = creds.get("mssql_host")
    port = int(creds.get("mssql_port") or 1433)
    user = creds.get("mssql_username")
    pw = creds.get("mssql_password")
    db = creds.get("mssql_database") or "master"
    if not host or not user or not pw:
        return PreflightResult(False, "config_error",
            "mssql_host, mssql_username, and mssql_password are required")
    unreachable = _tcp_open(host, port)
    if unreachable:
        return unreachable
    try:
        conn = pymssql.connect(server=host, port=port, user=user, password=pw,
                               database=db, login_timeout=8, timeout=8)
        cur = conn.cursor()
        cur.execute("SELECT SUSER_SNAME(), @@VERSION")
        who, ver = cur.fetchone()
        cur.close()
        conn.close()
        return PreflightResult(True, "ok",
            f"MSSQL auth succeeded ({str(ver)[:60]}…).", identity=str(who))
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        low = msg.lower()
        if "login failed" in low or "password" in low or "18456" in low:
            return PreflightResult(False, "auth_failed", f"MSSQL rejected credentials: {msg[:220]}")
        return PreflightResult(False, "unknown", f"MSSQL error: {msg[:220]}")


def _preflight_mysql(creds: Dict[str, Any]) -> PreflightResult:
    try:
        import pymysql  # type: ignore
    except ImportError:
        return PreflightResult(False, "config_error", "PyMySQL not installed on this server")
    host = creds.get("mysql_host")
    port = int(creds.get("mysql_port") or 3306)
    user = creds.get("mysql_username")
    pw = creds.get("mysql_password")
    db = creds.get("mysql_database") or "information_schema"
    if not host or not user or not pw:
        return PreflightResult(False, "config_error",
            "mysql_host, mysql_username, and mysql_password are required")
    unreachable = _tcp_open(host, port)
    if unreachable:
        return unreachable
    try:
        conn = pymysql.connect(host=host, port=port, user=user, password=pw,
                               database=db, connect_timeout=8, read_timeout=8)
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_USER(), VERSION()")
        who, ver = cur.fetchone()
        cur.close()
        conn.close()
        return PreflightResult(True, "ok",
            f"MySQL auth succeeded (server {ver}).", identity=str(who))
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        low = msg.lower()
        if "access denied" in low or "password" in low:
            return PreflightResult(False, "auth_failed", f"MySQL rejected credentials: {msg[:220]}")
        return PreflightResult(False, "unknown", f"MySQL error: {msg[:220]}")


# ─── Dispatcher ─────────────────────────────────────────────────────────────

def preflight_check(integration_type: str, creds: Dict[str, Any]) -> PreflightResult:
    """Run the appropriate pre-flight for an integration_type."""
    itype = (integration_type or "").lower()
    if itype == "windows_winrm":
        return _preflight_winrm(creds)
    if itype == "linux_ssh":
        return _preflight_ssh(creds)
    if itype == "aws_readonly":
        return _preflight_aws(creds)
    if itype == "postgres_sql":
        return _preflight_postgres(creds)
    if itype == "mssql_sql":
        return _preflight_mssql(creds)
    if itype == "mysql_sql":
        return _preflight_mysql(creds)
    # Unknown / Nessus / Nexpose — skip pre-flight (those have their own
    # vendor-specific auth flows handled elsewhere).
    return PreflightResult(True, "ok", f"No pre-flight defined for {itype!r}; skipped.")
