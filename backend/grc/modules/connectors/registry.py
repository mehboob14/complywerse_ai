"""Provider registry + adapter factory.

One place to look up which providers exist, which category they belong
to, how to instantiate their adapter, and what credential / config
fields the frontend should render on the setup modal.

Adding a new provider is one entry here + one adapter file. The CRUD
router, the frontend cards, and the sync dispatcher all discover new
providers automatically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Type

from .base import BaseConnectorAdapter


@dataclass
class ProviderField:
    """Describes one credential or config field for the setup modal."""
    key: str
    label: str
    kind: str = "text"  # text | password | url | textarea | select | toggle
    required: bool = True
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    options: List[Dict[str, str]] = field(default_factory=list)  # for kind=select
    is_credential: bool = True   # secret → encrypted_credentials; otherwise provider_config


@dataclass
class ProviderMeta:
    provider: str       # unique key — servicenow, splunk, …
    label: str          # display name
    category: str       # ticketing | siem | pentest | collab | transcribe
    description: str
    auth_method: str    # api_key | basic | oauth2 | token
    fields: List[ProviderField] = field(default_factory=list)
    adapter_cls: Optional[Type[BaseConnectorAdapter]] = None
    beta: bool = False
    oauth_scopes: List[str] = field(default_factory=list)
    docs_url: Optional[str] = None


# Registry is populated below from each adapter module's
# `register(registry)` hook so adding a new provider is one import +
# one .register() call.
PROVIDER_REGISTRY: Dict[str, ProviderMeta] = {}


def register(meta: ProviderMeta) -> None:
    """Register a provider. Idempotent — re-registers overwrite."""
    PROVIDER_REGISTRY[meta.provider] = meta


def get_provider_meta(provider: str) -> Optional[ProviderMeta]:
    return PROVIDER_REGISTRY.get(provider)


def list_providers(category: Optional[str] = None) -> List[ProviderMeta]:
    items = list(PROVIDER_REGISTRY.values())
    if category:
        items = [p for p in items if p.category == category]
    items.sort(key=lambda p: (p.category, p.label))
    return items


def build_adapter(
    *,
    provider: str,
    console_url: Optional[str],
    credentials: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
    oauth_tokens: Optional[Dict[str, Any]] = None,
    verify_ssl: bool = True,
) -> BaseConnectorAdapter:
    meta = get_provider_meta(provider)
    if not meta or meta.adapter_cls is None:
        raise ValueError(f"Unknown or unconfigured provider: {provider}")
    return meta.adapter_cls(
        console_url=console_url,
        credentials=credentials,
        config=config,
        oauth_tokens=oauth_tokens,
        verify_ssl=verify_ssl,
    )


# ─── Adapter modules register themselves on import ─────────────────
# Imports are at the bottom to avoid circular references (adapters
# import this module to call `register()`).

def _bootstrap() -> None:
    # Each provider module exposes `META: ProviderMeta` and we register
    # it here. Import errors on optional providers (e.g. msfrpc not
    # installed) shouldn't crash the registry — log and skip.
    import logging
    log = logging.getLogger(__name__)

    provider_modules = [
        # Working exemplars
        "grc.modules.connectors.providers.servicenow",
        "grc.modules.connectors.providers.splunk",
        "grc.modules.connectors.providers.metasploit",
        "grc.modules.connectors.providers.msteams",
        "grc.modules.connectors.providers.fireflies",
        # Beta stubs
        "grc.modules.connectors.providers.bmc_remedy",
        "grc.modules.connectors.providers.wazuh",
        "grc.modules.connectors.providers.qradar",
        "grc.modules.connectors.providers.core_impact",
        "grc.modules.connectors.providers.zoom",
        "grc.modules.connectors.providers.office365",
        # EASM passive sources — pull-only; read by the asset_discovery collector.
        "grc.modules.connectors.providers.shodan",
        "grc.modules.connectors.providers.censys",
        "grc.modules.connectors.providers.securitytrails",
    ]
    for mod_path in provider_modules:
        try:
            import importlib
            mod = importlib.import_module(mod_path)
            meta = getattr(mod, "META", None)
            if meta is not None:
                register(meta)
        except Exception:
            log.exception("Failed to import connector provider module %s", mod_path)


_bootstrap()
