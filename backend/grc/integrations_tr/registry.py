"""Client factory: a connection's ``mode`` picks the live or simulated client.

Callers only ever use the returned object's interface, so switching a tenant
from simulated to live is a Settings change, not a code change.
"""
from __future__ import annotations

from ..models import TR_PROVIDER_WC1, TR_PROVIDER_CLEAR, TR_PROVIDER_TRRI
from . import connections


def wc1_client(conn):
    if conn.mode == "live":
        from .wc1 import WC1Client
        creds = connections.credentials(conn)
        return WC1Client(connections.base_url(conn), creds.get("api_key", ""), creds.get("api_secret", ""),
                         limiter_key=f"wc1:{conn.tenant_id}")
    from .simulated import SimulatedWC1Client
    return SimulatedWC1Client(conn)


def clear_client(conn):
    if conn.mode == "live":
        from .clear import ClearClient
        return ClearClient(connections.base_url(conn), connections.credentials(conn),
                           connections.effective_config(conn))
    from .simulated_clear import SimulatedClearClient
    return SimulatedClearClient()


def trri_client(conn):
    if conn.mode == "live":
        from .trri import TRRIClient
        return TRRIClient(conn)
    from .simulated_trri import SimulatedTRRIClient
    return SimulatedTRRIClient()


_FACTORIES = {TR_PROVIDER_WC1: wc1_client, TR_PROVIDER_CLEAR: clear_client, TR_PROVIDER_TRRI: trri_client}


def client_for(conn):
    return _FACTORIES[conn.provider](conn)
