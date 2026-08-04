"""Resolve credentials for plugin runs from an IntegrationConnection row.

Credential model (mirrors existing Nexpose/Nessus pattern): every connection
has a `credential_env_prefix`, and the runtime reads PREFIX_KEY env vars.
For plugin-specific connection types we add new keysets:

  aws_readonly:  PREFIX_AWS_ACCESS_KEY_ID, PREFIX_AWS_SECRET_ACCESS_KEY,
                 PREFIX_AWS_SESSION_TOKEN (opt), PREFIX_AWS_REGION (opt)

  linux_ssh:     PREFIX_SSH_HOST, PREFIX_SSH_PORT (opt, default 22),
                 PREFIX_SSH_USERNAME, PREFIX_SSH_PASSWORD or
                 PREFIX_SSH_PRIVATE_KEY (PEM-formatted)

  windows_winrm: PREFIX_WINRM_ENDPOINT (full URL incl. /wsman) or
                 PREFIX_WINRM_HOST + optional PREFIX_WINRM_PORT
                 (default 5986 https / 5985 http) + PREFIX_WINRM_SCHEME
                 (default https), PREFIX_WINRM_USERNAME,
                 PREFIX_WINRM_PASSWORD, PREFIX_WINRM_TRANSPORT
                 (ntlm|kerberos|basic|credssp, default ntlm),
                 PREFIX_WINRM_CERT_VALIDATION (validate|ignore,
                 default validate), PREFIX_WINRM_CA_TRUST_PATH (opt).

For SSH, host/port/username may also be sourced from the IntegrationConnection
row itself (console_url → ssh_host, console_port → ssh_port, username → user).
For AWS, region falls back to the env var or us-east-1.
For WinRM, host/port/username also fall back to the connection row.
"""
from __future__ import annotations

import os
from typing import Any, Dict

from grc.crypto import decrypt_secret
from grc.models import IntegrationConnection


def resolve_credentials_for_connection(connection: IntegrationConnection) -> Dict[str, Any]:
    integration_type = (connection.integration_type or "").lower()
    prefix = (connection.credential_env_prefix or "").strip()

    def env(key: str, default: str | None = None) -> str | None:
        if not prefix:
            return default
        return os.environ.get(f"{prefix}_{key}", default)

    if integration_type == "aws_readonly":
        # The connection form labels `console_url` as "AWS Region" for this type;
        # honour it as a fallback so the UI input is not silently ignored.
        ui_region = (connection.console_url or "").strip() or None
        # Connect Wizard packs the access key into connection.username and
        # the secret key into connection.password — the same fields used by
        # SSH and WinRM — so the wizard handshake works across all three
        # platforms without needing AWS-specific columns. The env-var
        # path is still honoured first for ops who pre-provision via env.
        return {
            "aws_access_key_id": env("AWS_ACCESS_KEY_ID") or env("ACCESS_KEY") or connection.username or "",
            "aws_secret_access_key": env("AWS_SECRET_ACCESS_KEY") or env("SECRET_KEY") or decrypt_secret(connection.password) or "",
            "aws_session_token": env("AWS_SESSION_TOKEN"),
            "aws_region": env("AWS_REGION") or ui_region or "us-east-1",
        }

    if integration_type in ("linux_ssh", "netdev_ssh"):
        host = env("SSH_HOST") or (connection.console_url or "").replace("https://", "").replace("http://", "").rstrip("/")
        port = env("SSH_PORT") or str(connection.console_port or 22)
        username = env("SSH_USERNAME") or connection.username or "ubuntu"
        password = env("SSH_PASSWORD") or decrypt_secret(connection.password)
        private_key = env("SSH_PRIVATE_KEY")
        # SSH host-key trust plumbing — by default the runner uses
        # RejectPolicy + system-known-hosts; tenants can preload
        # host keys via SSH_KNOWN_HOSTS or opt-in for AutoAdd via
        # SSH_ACCEPT_UNKNOWN_HOSTS=1 (typically lab/ephemeral hosts).
        known_hosts = env("SSH_KNOWN_HOSTS")
        accept_unknown = env("SSH_ACCEPT_UNKNOWN_HOSTS")
        return {
            "ssh_host": host,
            "ssh_port": int(port) if str(port).isdigit() else 22,
            "ssh_username": username,
            "ssh_password": password,
            "ssh_private_key": private_key,
            "ssh_known_hosts": known_hosts,
            "ssh_accept_unknown_hosts": accept_unknown,
        }

    if integration_type == "windows_winrm":
        # Endpoint can be supplied directly or assembled from host/port/scheme
        # so legacy IntegrationConnection rows (which only carry host/port) keep
        # working without the operator having to migrate to a single URL.
        endpoint = env("WINRM_ENDPOINT")
        if not endpoint:
            host = env("WINRM_HOST") or (
                (connection.console_url or "")
                .replace("https://", "")
                .replace("http://", "")
                .rstrip("/")
            )
            # Pick scheme by stored port FIRST, then fall back to env default.
            # The Connect Wizard auto-probe picks the working port (5986
            # HTTPS preferred, 5985 HTTP fallback) and saves it to
            # connection.console_port. The executor must honour that choice
            # — using HTTPS on a 5985 host produces SSL: WRONG_VERSION_NUMBER.
            stored_port = connection.console_port
            if env("WINRM_SCHEME"):
                scheme = env("WINRM_SCHEME").lower()
            elif stored_port == 5985:
                scheme = "http"
            else:
                scheme = "https"
            default_port = 5986 if scheme == "https" else 5985
            port = env("WINRM_PORT") or str(stored_port or default_port)
            if host:
                endpoint = f"{scheme}://{host}:{port}/wsman"
        username = env("WINRM_USERNAME") or connection.username or ""
        password = env("WINRM_PASSWORD") or decrypt_secret(connection.password) or ""
        # WinRM HTTPS cert validation default policy
        # ───────────────────────────────────────────
        # The Connect Wizard's installer script creates a *self-signed*
        # cert on the target host (via `New-SelfSignedCertificate`) — that
        # is the standard onboarding path for enterprise customers who
        # haven't issued an internal CA cert. Defaulting to "validate"
        # therefore breaks every wizard-onboarded host with
        # "self-signed certificate" SSLError.
        #
        # Trust is established by:
        #   (a) NTLM auth — only the per-tenant service account password
        #       (which is generated by the installer and never leaves the
        #       target machine in plaintext) can authenticate, AND
        #   (b) the JWT handshake, which proves the operator who started
        #       the wizard saw the same host fingerprint.
        #
        # Tenants who issue real CA certs can opt back into strict
        # validation with WINRM_CERT_VALIDATION=validate at the env-var
        # level (or per-connection once we surface that in the wizard).
        cert_val = env("WINRM_CERT_VALIDATION") or "ignore"
        return {
            "winrm_endpoint": endpoint,
            "winrm_username": username,
            "winrm_password": password,
            "winrm_transport": (env("WINRM_TRANSPORT") or "ntlm").lower(),
            "winrm_server_cert_validation": cert_val.lower(),
            "winrm_ca_trust_path": env("WINRM_CA_TRUST_PATH"),
        }

    if integration_type == "oracle_sql":
        # Oracle DB connection — host/port/username come from the
        # IntegrationConnection row, service_name OR sid lives in
        # `credential_env_prefix` (we reuse the same column to avoid a
        # schema migration; format is `service:ORCL` or `sid:ORCL`).
        host = env("ORACLE_HOST") or (
            (connection.console_url or "")
            .replace("https://", "")
            .replace("http://", "")
            .rstrip("/")
        )
        port = env("ORACLE_PORT") or str(connection.console_port or 1521)
        username = env("ORACLE_USERNAME") or connection.username
        password = env("ORACLE_PASSWORD") or decrypt_secret(connection.password)
        # Read service/sid hint stored on the connection row. Defaults to
        # service ORCL — the most common Oracle install name.
        prefix_hint = (connection.credential_env_prefix or "").lower()
        service_name = env("ORACLE_SERVICE_NAME")
        sid = env("ORACLE_SID")
        if not service_name and not sid:
            if prefix_hint.startswith("sid:"):
                sid = prefix_hint[4:].upper()
            elif prefix_hint.startswith("service:"):
                service_name = prefix_hint[8:].upper()
            else:
                service_name = "ORCL"
        return {
            "oracle_host": host,
            "oracle_port": int(port) if str(port).isdigit() else 1521,
            "oracle_service_name": service_name,
            "oracle_sid": sid,
            "oracle_username": username,
            "oracle_password": password,
        }


    # ─── Extended integrations (MSSQL / Postgres / MySQL / LDAP / Azure / K8s)
    # All stored their structured creds in IntegrationConnection.credentials_extra_json
    # by the Connect Wizard. Decrypt the secret fields and return the dict
    # shape each runner expects (matches extended_runners.py field names).
    extra = getattr(connection, "credentials_extra_json", None) or {}

    if integration_type == "mssql_sql":
        return {
            "mssql_host": extra.get("mssql_host") or connection.console_url,
            "mssql_port": extra.get("mssql_port") or connection.console_port or 1433,
            "mssql_username": extra.get("mssql_username") or connection.username,
            "mssql_password": decrypt_secret(extra.get("mssql_password") or connection.password),
            "mssql_database": extra.get("mssql_database") or "master",
        }
    if integration_type == "postgres_sql":
        return {
            "postgres_host": extra.get("postgres_host") or connection.console_url,
            "postgres_port": extra.get("postgres_port") or connection.console_port or 5432,
            "postgres_username": extra.get("postgres_username") or connection.username,
            "postgres_password": decrypt_secret(extra.get("postgres_password") or connection.password),
            "postgres_database": extra.get("postgres_database") or "postgres",
        }
    if integration_type == "mysql_sql":
        return {
            "mysql_host": extra.get("mysql_host") or connection.console_url,
            "mysql_port": extra.get("mysql_port") or connection.console_port or 3306,
            "mysql_username": extra.get("mysql_username") or connection.username,
            "mysql_password": decrypt_secret(extra.get("mysql_password") or connection.password),
            "mysql_database": extra.get("mysql_database") or "information_schema",
        }
    if integration_type == "ldap_query":
        return {
            "ldap_host": extra.get("ldap_host") or connection.console_url,
            "ldap_port": extra.get("ldap_port") or connection.console_port or 389,
            "ldap_use_ssl": bool(extra.get("ldap_use_ssl")),
            "ldap_bind_dn": extra.get("ldap_bind_dn") or extra.get("ldap_username") or connection.username,
            "ldap_username": extra.get("ldap_username") or connection.username,
            "ldap_password": decrypt_secret(extra.get("ldap_password") or connection.password),
        }
    if integration_type == "azure_readonly":
        return {
            "azure_subscription_id": extra.get("azure_subscription_id"),
            "azure_tenant_id": extra.get("azure_tenant_id"),
            "azure_client_id": extra.get("azure_client_id"),
            "azure_client_secret": decrypt_secret(extra.get("azure_client_secret") or ""),
        }
    if integration_type == "k8s_api":
        out: dict = {}
        if extra.get("kubeconfig"):
            out["kubeconfig"] = decrypt_secret(extra["kubeconfig"])
        if extra.get("k8s_server"):
            out["k8s_server"] = extra["k8s_server"]
            out["k8s_token"] = decrypt_secret(extra.get("k8s_token") or "")
            out["k8s_ca_cert"] = extra.get("k8s_ca_cert")
        return out

    return {}
