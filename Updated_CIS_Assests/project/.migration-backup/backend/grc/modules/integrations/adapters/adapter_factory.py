import logging
import os
from typing import Dict

from grc.models import IntegrationConnection
from .base_adapter import BaseAdapter
from .rapid7_adapter import Rapid7Adapter
from .nessus_adapter import NessusAdapter

logger = logging.getLogger(__name__)

ADAPTER_REGISTRY = {
    "nexpose": Rapid7Adapter,
    "rapid7": Rapid7Adapter,
    "insightvm": Rapid7Adapter,
    "nessus": NessusAdapter,
    "tenable": NessusAdapter,
}

# Connection types that are NOT vuln-scanner adapters but are used by the
# Compliance Plugin Engine. They have no sync flow; the plugin runner pulls
# credentials directly from env vars (see compliance_plugins/services/credentials.py).
PLUGIN_ONLY_CONNECTION_TYPES = {"aws_readonly", "linux_ssh", "windows_winrm"}

CREDENTIAL_KEYS = {
    "nexpose": ("USERNAME", "PASSWORD", "API_KEY"),
    "rapid7": ("USERNAME", "PASSWORD", "API_KEY"),
    "insightvm": ("USERNAME", "PASSWORD", "API_KEY"),
    "nessus": ("ACCESS_KEY", "SECRET_KEY", "USERNAME", "PASSWORD", "API_KEY"),
    "tenable": ("ACCESS_KEY", "SECRET_KEY", "USERNAME", "PASSWORD", "API_KEY"),
    "aws_readonly": ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"),
    "linux_ssh": ("SSH_HOST", "SSH_PORT", "SSH_USERNAME", "SSH_PASSWORD", "SSH_PRIVATE_KEY"),
}


def build_adapter(connection: IntegrationConnection) -> BaseAdapter:
    integration_type = (connection.integration_type or "nexpose").lower()
    if integration_type in PLUGIN_ONLY_CONNECTION_TYPES:
        raise ValueError(
            f"Integration type '{integration_type}' is plugin-only (CIS Benchmark Engine) and does not support the vuln-scanner sync flow. "
            f"Use POST /grc/compliance-plugins/{{id}}/runs instead."
        )
    adapter_cls = ADAPTER_REGISTRY.get(integration_type)
    if not adapter_cls:
        raise ValueError(f"Unsupported integration type: {integration_type}. Supported: {list(ADAPTER_REGISTRY.keys())}")

    prefix = connection.credential_env_prefix
    cred_keys = CREDENTIAL_KEYS.get(integration_type, ("USERNAME", "PASSWORD", "API_KEY"))

    credentials: Dict[str, str] = {}
    for key in cred_keys:
        env_val = os.environ.get(f"{prefix}_{key}", "")
        credentials[key.lower()] = env_val

    # Inline credentials (if provided) take precedence over env vars.
    if getattr(connection, "username", None):
        credentials["username"] = connection.username
    if getattr(connection, "password", None):
        credentials["password"] = connection.password

    verify_ssl = os.environ.get(f"{prefix}_VERIFY_SSL", "false").lower() == "true"

    return adapter_cls(
        console_url=connection.console_url,
        console_port=connection.console_port,
        credentials=credentials,
        verify_ssl=verify_ssl,
    )


def get_transformer(integration_type: str):
    from .transformer import Rapid7Transformer
    from .nessus_transformer import NessusTransformer

    t = (integration_type or "nexpose").lower()
    if t in ("nessus", "tenable"):
        return NessusTransformer
    return Rapid7Transformer
