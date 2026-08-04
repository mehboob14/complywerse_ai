"""Regression tests for the IT asset inventory and its collection paths.

These guard the *classes* of defect the asset-discovery audit found, not just
the individual instances that were fixed:

  * a model column shipped without a matching ALTER TABLE entry
  * a literal route registered after the `/{asset_id}` catch-all
  * an optional SDK whose import shim silently returns None
  * a re-inventory forgetting which apps were already promoted

Every test here is DB-free so it runs anywhere the rest of the suite does.
"""
import inspect
import re

import pytest

from grc.models import ITAsset
from grc.modules.compliance.schema_migrations import _COLUMN_ADDS
from grc.modules.compliance_plugins.services.software_normaliser import (
    preserve_promotions,
)
from grc.routers.assets_router import router as assets_router


def _asset_migration_columns() -> set:
    return {col for table, col, _ddl, _idx in _COLUMN_ADDS if table == "grc_it_assets"}


def _asset_model_columns() -> set:
    return {c.name for c in ITAsset.__table__.columns}


# ── Schema migrations ────────────────────────────────────────────────────────
# There is no Alembic in this project. Per-tenant DBs are provisioned with
# `Base.metadata.create_all`, which creates missing TABLES but never adds
# missing COLUMNS to a table that already exists. A column added to the model
# without a matching `_COLUMN_ADDS` entry therefore works perfectly on every
# fresh tenant and raises UndefinedColumn on every query for every older one —
# and because SQLAlchemy SELECTs all mapped columns, that takes down the whole
# asset module for those tenants.

# The hardware / procurement block. These shipped on the model and were read and
# written by the router, the agent heartbeat and the schemas, but had no
# migration entry at all.
ITAM_PARITY_COLUMNS = [
    "cpu_cores", "memory_gb", "storage_gb", "agent_version", "manufacturer",
    "model", "serial_number", "department", "assigned_user", "purchase_cost",
    "purchase_date", "warranty_expiry", "eol_date", "environment",
]


@pytest.mark.parametrize("column", ITAM_PARITY_COLUMNS)
def test_itam_parity_column_has_a_migration(column):
    assert column in _asset_migration_columns(), (
        f"ITAsset.{column} is declared on the model but has no _COLUMN_ADDS "
        f"entry. Tenant DBs created before it landed will raise UndefinedColumn "
        f"on every asset query."
    )


@pytest.mark.parametrize("column", ITAM_PARITY_COLUMNS)
def test_itam_parity_column_is_still_on_the_model(column):
    assert column in _asset_model_columns()


def test_migration_entries_name_real_asset_columns():
    """A typo in a _COLUMN_ADDS tuple creates a stray column that no ORM
    attribute maps to — the ALTER succeeds and the real column stays missing,
    so the failure looks exactly like the one it was meant to fix."""
    unknown = _asset_migration_columns() - _asset_model_columns()
    assert not unknown, f"_COLUMN_ADDS references columns not on ITAsset: {sorted(unknown)}"


def test_serial_number_is_indexed():
    """Identity resolution matches on serial_number as a strong key; an
    unindexed match column turns every ingest into a sequential scan."""
    entries = [e for e in _COLUMN_ADDS
               if e[0] == "grc_it_assets" and e[1] == "serial_number"]
    assert entries, "serial_number has no migration entry"
    assert entries[0][3], "serial_number should be indexed"


# ── Route ordering ───────────────────────────────────────────────────────────
# Starlette matches routes in registration order. `/{asset_id}` is typed `int`,
# so any literal route registered after it is captured by the path param and
# FastAPI 422s on the coercion — the handler is unreachable and nothing in the
# code looks wrong. This bit `/assets/composite-weights`, which the frontend
# called on every asset page.

def _route_paths():
    return [r.path for r in assets_router.routes]


def test_no_literal_route_after_the_asset_id_catch_all():
    paths = _route_paths()
    catch_all = "/assets/{asset_id}"
    assert catch_all in paths, "the /{asset_id} catch-all route has moved or been renamed"
    after = [p for p in paths[paths.index(catch_all):] if "{asset_id}" not in p]
    assert not after, (
        f"these literal routes are registered after {catch_all} and will 422 "
        f"instead of matching: {after}. Move them above it."
    )


@pytest.mark.parametrize("path", [
    "/assets/composite-weights",
    "/assets/facets",
    "/assets/saved-views",
    "/assets/dashboard",
    "/assets/inventory-overview",
    "/assets/import/upload",
])
def test_literal_asset_routes_are_reachable(path):
    paths = _route_paths()
    assert path in paths, f"{path} is no longer registered"
    assert paths.index(path) < paths.index("/assets/{asset_id}"), (
        f"{path} is registered after the catch-all and is unreachable"
    )


def test_agentless_probe_endpoint_is_registered():
    """The agentless collector is ~440 lines that sat with zero callers. If the
    route disappears it silently becomes dead code again."""
    assert "/assets/{asset_id}/probe-inventory" in _route_paths()


# ── Promotion preservation ───────────────────────────────────────────────────
# Every collection path rewrites detected_software_json wholesale. Without this
# merge, a re-probe forgets which detected apps were already promoted to child
# assets and asks the operator to promote them all over again.

def test_promotions_survive_a_reinventory():
    previous = [{"software_key": "nginx-1.24", "promoted_asset_id": 42}]
    enriched = [{"software_key": "nginx-1.24", "promoted_asset_id": None},
                {"software_key": "redis-7", "promoted_asset_id": None}]
    out = preserve_promotions(previous, enriched)
    assert out[0]["promoted_asset_id"] == 42
    assert out[1]["promoted_asset_id"] is None


def test_promotion_of_a_vanished_package_is_not_reattached():
    previous = [{"software_key": "apache-2.4", "promoted_asset_id": 9}]
    enriched = [{"software_key": "nginx-1.24", "promoted_asset_id": None}]
    out = preserve_promotions(previous, enriched)
    assert out[0]["promoted_asset_id"] is None


@pytest.mark.parametrize("previous", [None, [], [{"software_key": "x"}]])
def test_preserve_promotions_tolerates_empty_history(previous):
    enriched = [{"software_key": "x", "promoted_asset_id": None}]
    assert preserve_promotions(previous, enriched)[0]["promoted_asset_id"] is None


def test_preserve_promotions_ignores_malformed_history_entries():
    """detected_software_json is operator-visible JSON and has held junk before;
    a bad row must not take down the heartbeat."""
    previous = ["not-a-dict", None, {"software_key": "ok", "promoted_asset_id": 3}]
    enriched = [{"software_key": "ok", "promoted_asset_id": None}]
    assert preserve_promotions(previous, enriched)[0]["promoted_asset_id"] == 3


# ── Agent heartbeat ingest ───────────────────────────────────────────────────

def test_heartbeat_payload_declares_installed_software():
    from grc.modules.agents.router import HeartbeatPayload
    assert "installed_software" in HeartbeatPayload.model_fields


def test_heartbeat_consumes_the_software_it_is_sent():
    """The payload field was declared, documented, and populated by the agent
    for a long time while the handler never read it — the inventory was
    collected on every beat and dropped. Assert the wiring exists."""
    from grc.modules.agents.router import agent_heartbeat
    source = inspect.getsource(agent_heartbeat)
    assert "installed_software" in source, "heartbeat no longer reads the software payload"
    assert "detected_software_json" in source, "heartbeat no longer persists the inventory"


def test_heartbeat_stamps_last_seen():
    """A live heartbeat is a sighting. Without this an actively-managed host
    trips the 30-day stale filter and drags down the inventory scorecard."""
    from grc.modules.agents.router import agent_heartbeat
    source = inspect.getsource(agent_heartbeat)
    assert re.search(r"last_seen_at\s*=", source), "heartbeat no longer stamps last_seen_at"
    assert "last_seen_source" in source


# ── Optional SDK import shims ────────────────────────────────────────────────
# These shims swallow every exception and return None, which the sync layer
# reports as `sdk_not_installed`. That message is indistinguishable from a
# genuinely-missing package, so a wrong import path inside the shim can keep a
# provider dead indefinitely — which is exactly what happened to Azure, where
# ResourceManagementClient moved out of the package root in azure-mgmt-resource
# 23+ and the shim was never updated.

def test_azure_shim_resolves_when_the_sdk_is_installed():
    pytest.importorskip("azure.mgmt.security")
    from grc.modules.integrations.cloud.azure_defender import _try_import_azure
    bag = _try_import_azure()
    assert bag is not None, (
        "Azure SDKs are installed but the import shim still returns None — "
        "an import inside it is wrong, and the sync will report sdk_not_installed"
    )
    assert {"ClientSecretCredential", "SecurityCenter",
            "ResourceManagementClient", "errors"} <= set(bag)


def test_gcp_shim_resolves_when_the_sdk_is_installed():
    pytest.importorskip("google.cloud.securitycenter_v1")
    from grc.modules.integrations.cloud.gcp_scc import _try_import_gcp
    bag = _try_import_gcp()
    assert bag is not None, (
        "GCP SDK is installed but the import shim still returns None"
    )
    assert {"securitycenter", "service_account", "errors"} <= set(bag)


# ── Transport dependencies ───────────────────────────────────────────────────

@pytest.mark.parametrize("module", ["boto3", "paramiko", "winrm"])
def test_collection_transports_are_installed(module):
    """These three are load-bearing for AWS sync, SSH and WinRM collection, and
    every call site swallows the ImportError — so when they go missing the only
    symptom is assets arriving with no OS and no software, and no error at all.
    They were absent from requirements.txt for exactly that reason."""
    pytest.importorskip(module)
