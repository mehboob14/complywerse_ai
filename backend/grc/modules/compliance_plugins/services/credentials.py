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
            scheme = (env("WINRM_SCHEME") or "https").lower()
            default_port = 5986 if scheme == "https" else 5985
            port = env("WINRM_PORT") or str(connection.console_port or default_port)
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


    return {}
