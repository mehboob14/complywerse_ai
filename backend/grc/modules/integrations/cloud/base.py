"""Track A — Abstract base + result types for cloud connectors.

Every connector implements three operations:

  * `validate_credentials(payload)` — does the provider accept these keys?
    Called at admin-page save time; rejects on invalid creds *before* the
    encrypted blob hits the DB so we never store something that can't sync.
  * `health_check()` — quick "is the provider reachable, are creds still
    good?" probe. Fires from the admin page health pill + a daily Celery
    beat (not in this PR).
  * `sync(db)` — fetch assets + vulns + advisories, write them through the
    normalized data layer (Track B, deferred). Returns a `ConnectorSyncResult`
    so the orchestrator can record counts/errors uniformly.

Concrete adapters live in `aws_inspector.py`, `azure_defender.py`,
`gcp_scc.py`. Adapters are registered on import via `register_connector()`;
the package's `__init__.py` imports each one so the registry is populated
before the orchestrator boots.

Failure semantics:
  * `validate_credentials` raises `ConnectorCredentialsInvalid` with a
    user-safe message on bad keys, or returns `None` on success.
  * `health_check` returns a `ConnectorHealth` — never raises.
  * `sync` returns a `ConnectorSyncResult` — never raises; per-record
    failures roll up into `errors` so a single bad finding doesn't poison
    the whole run.
"""
from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Type

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ConnectorCredentialsInvalid(ValueError):
    """Raised from `validate_credentials` with a user-safe message. Caller
    maps to 400. Don't include cloud-provider error codes that could leak
    account identifiers — the message goes back to the operator."""


@dataclass
class ConnectorHealth:
    """Snapshot from `health_check()`. Stored on `CloudConnector.health_metrics`
    and `last_health_status` so the admin page can render a colored pill."""
    status: str  # "ok", "degraded", "error"
    detail: Optional[str] = None
    latency_ms: Optional[int] = None
    checked_at: Optional[str] = None  # ISO timestamp, populated by the caller


@dataclass
class ConnectorSyncResult:
    """Return value from `sync()`. The orchestrator records the counts so
    operators can see "imported 47 assets / 312 vulns / 0 errors" without
    parsing logs."""
    assets_new: int = 0
    assets_updated: int = 0
    vulnerabilities_new: int = 0
    vulnerabilities_updated: int = 0
    errors: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)


# ─── Registry ────────────────────────────────────────────────────────────────
# Maps `CloudConnector.provider` strings to concrete classes. Populated by
# `register_connector()`; the cloud package's __init__ pre-imports every
# adapter so the registry is filled before any orchestrator query runs.

PROVIDER_REGISTRY: Dict[str, Type["CloudConnectorBase"]] = {}


def register_connector(cls: Type["CloudConnectorBase"]) -> Type["CloudConnectorBase"]:
    if not getattr(cls, "provider", None):
        raise ValueError(f"{cls.__name__} must set a non-empty `provider` class attribute.")
    PROVIDER_REGISTRY[cls.provider] = cls  # type: ignore[index]
    return cls


def get_connector_class(provider: str) -> Optional[Type["CloudConnectorBase"]]:
    return PROVIDER_REGISTRY.get((provider or "").strip().lower())


# ─── Abstract base ───────────────────────────────────────────────────────────


class CloudConnectorBase(abc.ABC):
    """Subclass + set `provider` and `display_label`, then implement the
    three abstract methods. The orchestrator instantiates one adapter per
    `CloudConnector` row, passing the decrypted credentials and the
    `CloudConnector.id` for stamping back results."""

    #: Stable provider string. Must match `CloudConnector.provider`.
    provider: str = ""
    #: Human-readable label shown in the admin page picker.
    display_label: str = ""
    #: JSON schema-ish description of the credentials shape this connector
    #: expects. Used by the admin page to render the right form fields.
    credentials_schema: Dict[str, Any] = {}

    def __init__(self, connector_id: int, credentials: Optional[Dict[str, Any]] = None) -> None:
        self.connector_id = connector_id
        self.credentials = credentials or {}

    # Subclasses override these three:

    @abc.abstractmethod
    def validate_credentials(self, payload: Dict[str, Any]) -> None:
        """Raise `ConnectorCredentialsInvalid` if `payload` won't work."""
        ...

    @abc.abstractmethod
    def health_check(self) -> ConnectorHealth:
        """Quick liveness/auth probe. Should complete in <5s."""
        ...

    @abc.abstractmethod
    def sync(self, db: Session) -> ConnectorSyncResult:
        """Full sync. Writes via the normalized data layer (Track B); for
        now adapters may write directly to `ITAsset` + `Vulnerability` as
        long as they keep the `last_seen_source` field populated."""
        ...
