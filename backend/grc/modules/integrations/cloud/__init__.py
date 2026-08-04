"""Track A — Cloud connector framework.

The unified pattern any cloud (and later PSIRT) connector implements:

    class MyConnector(CloudConnectorBase):
        provider = "aws_inspector"
        def validate_credentials(self, credentials): ...
        def health_check(self): ...
        def sync(self, db): ...

The orchestrator (not in this PR — lands when the second connector
arrives) reads `provider` off each row and dispatches to the matching
class. For now we have one concrete shell (AWS Inspector) that
demonstrates the contract; Azure Defender + GCP SCC follow the same
template when their real credential testing is feasible.
"""
from __future__ import annotations

from .base import (
    CloudConnectorBase,
    ConnectorHealth,
    ConnectorSyncResult,
    PROVIDER_REGISTRY,
    get_connector_class,
    register_connector,
)
from .aws_inspector import AwsInspectorConnector
from .azure_defender import AzureDefenderConnector
from .gcp_scc import GcpSccConnector

# Self-register on import so the orchestrator can look up by provider
# string without each adapter needing manual wiring.
register_connector(AwsInspectorConnector)
register_connector(AzureDefenderConnector)
register_connector(GcpSccConnector)

__all__ = [
    "CloudConnectorBase",
    "ConnectorHealth",
    "ConnectorSyncResult",
    "PROVIDER_REGISTRY",
    "get_connector_class",
    "register_connector",
    "AwsInspectorConnector",
    "AzureDefenderConnector",
    "GcpSccConnector",
]
