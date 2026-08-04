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

CREDENTIAL_KEYS = {
    "nexpose": ("USERNAME", "PASSWORD", "API_KEY"),
    "rapid7": ("USERNAME", "PASSWORD", "API_KEY"),
    "insightvm": ("USERNAME", "PASSWORD", "API_KEY"),
    "nessus": ("ACCESS_KEY", "SECRET_KEY", "USERNAME", "PASSWORD", "API_KEY"),
    "tenable": ("ACCESS_KEY", "SECRET_KEY", "USERNAME", "PASSWORD", "API_KEY"),
}


def build_adapter(connection: IntegrationConnection) -> BaseAdapter:
    integration_type = (connection.integration_type or "nexpose").lower()
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
