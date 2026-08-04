"""External-connector framework.

Houses the adapter base classes, provider registry, OAuth2 dispatcher,
and Celery sync tasks for every non-vuln-scanner integration:

  * Ticketing       — ServiceNow, BMC Remedy
  * SIEM            — Splunk, Wazuh, QRadar
  * Pen-test        — Metasploit, Core Impact
  * Collaboration   — MS Teams, Zoom, Office 365
  * Transcription   — Fireflies.ai

All connectors share the `IntegrationConnection` table, distinguished
by `category`. Credentials are stored Fernet-encrypted via
`services.connector_credentials`. OAuth2 refresh tokens live in
`oauth_tokens` alongside.
"""
from .base import (  # noqa: F401
    BaseConnectorAdapter,
    ConnectionTestResult,
    SyncResult,
    TicketingAdapter,
    SiemAdapter,
    PenTestAdapter,
    CollabAdapter,
    TranscribeAdapter,
)
from .registry import (  # noqa: F401
    ProviderMeta,
    PROVIDER_REGISTRY,
    get_provider_meta,
    list_providers,
    build_adapter,
)
