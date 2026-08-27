"""Tests for the asset-discovery foundation: the schema spine and its guard rails.

DB-free, matching the rest of the suite — these assert the model shape, the route
surface, and the scope/method validation, none of which need a live database.
The end-to-end CRUD round-trip is exercised separately against a tenant DB.
"""
import pytest

from grc.models import (
    ITAsset,
    DiscoveryCampaign, DiscoveryScope, DiscoveryRun, DiscoveryJob, DiscoveryObservation,
)
from grc.models._47_asset_discovery_models import (
    DISCOVERY_METHODS, SCOPE_KINDS, RUN_STATUSES, OBSERVATION_RESOLUTIONS,
)
from grc.main import app


# ── Schema spine ─────────────────────────────────────────────────────────────

def test_the_five_discovery_tables_exist():
    expected = {
        DiscoveryCampaign: "grc_discovery_campaigns",
        DiscoveryScope: "grc_discovery_scopes",
        DiscoveryRun: "grc_discovery_runs",
        DiscoveryJob: "grc_discovery_jobs",
        DiscoveryObservation: "grc_discovery_observations",
    }
    for model, table in expected.items():
        assert model.__tablename__ == table


def test_observation_defaults_to_pending():
    """The whole safety story: a scan writes observations as 'pending' and nothing
    becomes an asset until the identity step resolves them. If this default drifts,
    discovery could start minting assets directly — the thing we are avoiding."""
    col = DiscoveryObservation.__table__.columns["resolution"]
    assert col.default.arg == "pending"
    assert "pending" in OBSERVATION_RESOLUTIONS


def test_run_defaults_to_queued():
    assert DiscoveryRun.__table__.columns["status"].default.arg == "queued"
    assert "queued" in RUN_STATUSES


def test_children_cascade_from_campaign():
    """Deleting a campaign must take its scopes, runs, jobs and observations with
    it — otherwise a deleted campaign leaves orphaned scan history behind."""
    for fk in DiscoveryScope.__table__.foreign_keys:
        if fk.column.table.name == "grc_discovery_campaigns":
            assert fk.ondelete == "CASCADE"
    for fk in DiscoveryJob.__table__.foreign_keys:
        if fk.column.table.name == "grc_discovery_runs":
            assert fk.ondelete == "CASCADE"
    for fk in DiscoveryObservation.__table__.foreign_keys:
        if fk.column.table.name == "grc_discovery_runs":
            assert fk.ondelete == "CASCADE"


def test_observation_asset_link_survives_asset_delete():
    """resolved_asset_id points at grc_it_assets but must SET NULL, not cascade —
    deleting an asset should not erase the evidence that we once saw it."""
    for fk in DiscoveryObservation.__table__.foreign_keys:
        if fk.column.table.name == "grc_it_assets":
            assert fk.ondelete == "SET NULL"


def test_every_discovery_table_is_tenant_scoped():
    for model in (DiscoveryCampaign, DiscoveryScope, DiscoveryRun, DiscoveryJob, DiscoveryObservation):
        assert "tenant_id" in model.__table__.columns, f"{model.__name__} is missing tenant_id"


# ── Route surface ────────────────────────────────────────────────────────────

def _discovery_paths():
    return {r.path for r in app.routes if getattr(r, "path", "").startswith("/discovery")}


@pytest.mark.parametrize("path", [
    "/discovery/campaigns",
    "/discovery/campaigns/{campaign_id}",
    "/discovery/campaigns/{campaign_id}/scopes",
    "/discovery/campaigns/{campaign_id}/run",
    "/discovery/scopes/{scope_id}",
    "/discovery/runs",
])
def test_discovery_route_is_registered(path):
    assert path in _discovery_paths()


def test_no_literal_route_shadowed_by_campaign_id():
    """Same class of bug that hit /assets/composite-weights: a literal segment
    registered after /campaigns/{campaign_id} would be captured by the param."""
    paths = [r.path for r in app.routes if getattr(r, "path", "").startswith("/discovery")]
    catch = "/discovery/campaigns/{campaign_id}"
    assert catch in paths
    after = [p for p in paths[paths.index(catch):]
             if p.startswith("/discovery/campaigns/") and "{campaign_id}" not in p]
    assert not after, f"literal campaign routes after the catch-all: {after}"


# ── Validation ───────────────────────────────────────────────────────────────

def test_scope_validation_accepts_good_and_rejects_bad():
    from grc.modules.asset_discovery.router import _validate_scope
    from fastapi import HTTPException

    _validate_scope("cidr", "10.0.0.0/24")          # ok
    _validate_scope("ip_range", "10.0.0.1-10.0.0.9")  # ok
    _validate_scope("ad_ou", "OU=x,DC=y")            # ok

    for kind, bad in [("cidr", "nope"), ("cidr", "10.0.0.0/99"),
                      ("ip_range", "10.0.0.1"), ("bogus_kind", "x")]:
        with pytest.raises(HTTPException):
            _validate_scope(kind, bad)


def test_method_validation():
    from grc.modules.asset_discovery.router import _validate_method
    from fastapi import HTTPException
    for m in DISCOVERY_METHODS:
        _validate_method(m)
    with pytest.raises(HTTPException):
        _validate_method("telepathy")


def test_vocabularies_are_non_empty():
    assert DISCOVERY_METHODS and SCOPE_KINDS and RUN_STATUSES and OBSERVATION_RESOLUTIONS


# ── Executor: target expansion + exclusions (pure, DB-free) ──────────────────

class _Scope:
    """Minimal stand-in so the expansion logic can be tested without the ORM."""
    def __init__(self, kind, value, exclude=False):
        self.kind, self.value, self.exclude = kind, value, exclude


def test_cidr_expands_to_usable_hosts():
    from grc.modules.asset_discovery.services.executor import _ips_for_scope
    assert _ips_for_scope(_Scope("cidr", "10.0.0.0/30")) == {"10.0.0.1", "10.0.0.2"}


def test_ip_range_is_inclusive_and_order_insensitive():
    from grc.modules.asset_discovery.services.executor import _ips_for_scope
    fwd = _ips_for_scope(_Scope("ip_range", "10.0.0.5-10.0.0.7"))
    rev = _ips_for_scope(_Scope("ip_range", "10.0.0.7-10.0.0.5"))
    assert fwd == rev == {"10.0.0.5", "10.0.0.6", "10.0.0.7"}


def test_ad_ou_scope_has_no_network_targets():
    from grc.modules.asset_discovery.services.executor import _ips_for_scope
    assert _ips_for_scope(_Scope("ad_ou", "OU=Servers,DC=corp,DC=local")) == set()


def test_exclusions_are_subtracted_from_targets():
    """The scan-safety guarantee: an excluded host is removed from the target set
    (so it is never even probed), not filtered out of the results afterwards."""
    from grc.modules.asset_discovery.services.executor import _ips_for_scope, _targets_for_job
    include = _Scope("cidr", "10.0.0.0/29")           # .1 .. .6
    excluded = _ips_for_scope(_Scope("cidr", "10.0.0.2/32"))
    targets = _targets_for_job(include, excluded)
    assert "10.0.0.2" not in targets
    assert "10.0.0.1" in targets and "10.0.0.6" in targets


def test_sweep_host_returns_none_when_no_port_answers():
    from grc.modules.asset_discovery.services.executor import _sweep_host
    dead = lambda ip, port, t: {"status": "unreachable"}
    assert _sweep_host("10.0.0.9", dead, 0.1) is None


def test_sweep_host_records_open_ports_and_hostname():
    from grc.modules.asset_discovery.services.executor import _sweep_host, NETWORK_SWEEP_PORTS
    def up(ip, port, t):
        if port == NETWORK_SWEEP_PORTS[0]:
            return {"status": "reachable", "hostname": "web01", "rtt_ms": 3}
        return {"status": "unreachable"}
    res = _sweep_host("10.0.0.1", up, 0.1)
    assert res and res["hostname"] == "web01" and NETWORK_SWEEP_PORTS[0] in res["open_ports"]


def test_run_endpoint_still_registered_as_post():
    from grc.main import app
    run_routes = [r for r in app.routes
                  if getattr(r, "path", "") == "/discovery/campaigns/{campaign_id}/run"]
    assert run_routes and "POST" in run_routes[0].methods


# ── Production-shape guarantees ──────────────────────────────────────────────

def test_campaign_name_is_unique_per_tenant():
    """A campaign name is an operator-facing identifier; duplicates within a
    tenant make run history and audit trails ambiguous."""
    uqs = [c for c in DiscoveryCampaign.__table__.constraints
           if c.__class__.__name__ == "UniqueConstraint"]
    cols = {tuple(sorted(col.name for col in u.columns)) for u in uqs}
    assert ("name", "tenant_id") in cols


def test_run_endpoint_is_async_202():
    """Execution must not block the request — a /20 sweep runs for minutes. The
    endpoint returns 202 and the client polls, matching the CIS scan-all pattern."""
    from grc.main import app
    run_route = next(r for r in app.routes
                     if getattr(r, "path", "") == "/discovery/campaigns/{campaign_id}/run")
    assert run_route.status_code == 202


def test_executor_splits_create_from_execute():
    """create_run (fast, in-request) and execute_run (slow, on the worker) must
    be separable so the endpoint can return before the sweep finishes and a
    future scheduler can reuse execute_run unchanged."""
    from grc.modules.asset_discovery.services import executor
    assert hasattr(executor, "create_run")
    assert hasattr(executor, "execute_run")
    assert hasattr(executor, "start_run")  # synchronous convenience retained


def test_run_concurrency_lock_helpers_exist():
    from grc.modules.asset_discovery import router
    assert router._acquire_run_lock(999001, 999002) is True
    # second acquire of the same key is refused
    assert router._acquire_run_lock(999001, 999002) is False
    router._release_run_lock(999001, 999002)
    assert router._acquire_run_lock(999001, 999002) is True
    router._release_run_lock(999001, 999002)


# ── Identity resolver ────────────────────────────────────────────────────────

def test_asset_has_identity_resolution_columns():
    """The keys the resolver matches an observation against."""
    cols = set(ITAsset.__table__.columns.keys())
    for k in ("fqdn", "primary_mac", "cloud_resource_id", "source_system",
              "first_seen_at", "discovery_state"):
        assert k in cols, f"grc_it_assets is missing identity column {k}"


def test_external_identity_is_unique_per_source():
    from grc.models import AssetExternalIdentity
    uqs = [c for c in AssetExternalIdentity.__table__.constraints
           if c.__class__.__name__ == "UniqueConstraint"]
    cols = {tuple(sorted(col.name for col in u.columns)) for u in uqs}
    assert ("external_id", "source_system", "tenant_id") in cols


def test_external_identity_cascades_from_asset():
    """External ids are meaningless without their asset — deleting the asset
    must drop them, not orphan them."""
    from grc.models import AssetExternalIdentity
    for fk in AssetExternalIdentity.__table__.foreign_keys:
        if fk.column.table.name == "grc_it_assets":
            assert fk.ondelete == "CASCADE"


def test_resolver_exposes_auto_and_manual_entry_points():
    from grc.modules.asset_discovery.services import resolver
    for fn in ("resolve_observation", "resolve_run",
               "manual_adopt", "manual_merge", "manual_ignore"):
        assert hasattr(resolver, fn), f"resolver is missing {fn}"


def test_executor_auto_resolves_after_a_run():
    """A scan must produce inventory in one pass — execute_run has to call the
    resolver, otherwise observations pile up unresolved forever."""
    import inspect as _inspect
    from grc.modules.asset_discovery.services import executor
    src = _inspect.getsource(executor.execute_run)
    assert "resolve_run" in src, "execute_run no longer auto-resolves its observations"


def test_resolve_endpoint_actions_are_constrained():
    """Only adopt / merge / ignore are valid operator decisions."""
    from grc.modules.asset_discovery.router import ResolveIn
    import pydantic
    for good in ("adopt", "merge", "ignore"):
        assert ResolveIn(action=good).action == good
    with pytest.raises(pydantic.ValidationError):
        ResolveIn(action="delete_everything")


# ── SME-review fixes (regression guards) ─────────────────────────────────────

def test_executor_isolates_each_job_in_a_savepoint():
    """D-A: a failing job must not roll back sibling jobs' observations. The fix
    is a per-job savepoint; the old code did a whole-session db.rollback()."""
    import inspect as _inspect
    from grc.modules.asset_discovery.services import executor
    src = _inspect.getsource(executor.execute_run)
    assert "begin_nested" in src, "execute_run must isolate each job in a savepoint"


def test_resolver_isolates_each_observation_in_a_savepoint():
    """D-A: same guarantee on the resolve side."""
    import inspect as _inspect
    from grc.modules.asset_discovery.services import resolver
    src = _inspect.getsource(resolver.resolve_run)
    assert "begin_nested" in src, "resolve_run must isolate each observation in a savepoint"


def test_resolver_honours_a_standing_dismissal():
    """D-B: a re-seen ignored host must not be re-created or re-queued."""
    from grc.modules.asset_discovery.services import resolver
    assert hasattr(resolver, "_prior_ignored")
    import inspect as _inspect
    src = _inspect.getsource(resolver.resolve_observation)
    assert "_prior_ignored" in src, "resolve_observation must check for a standing dismissal"


def test_resolver_auto_creates_only_for_external_findings():
    """Refined invariant (Stage 2 / EASM). A NETWORK sweep still never writes
    inventory on its own — an unmatched internal device (even a positively
    identified printer / switch / DNS box) lands in 'unclaimed' and flows to
    Connect, guarding the phantom-asset bug (#138/#139). The ONE exception is an
    external (outside-in) find: it can never be logged into, so it is adopted as
    an evidence-only, internet-facing asset. Auto-creation is therefore gated
    strictly behind obs.source == 'external', and the unclaimed fall-through must
    come AFTER that carve-out so an internal hit can never reach it. Behavioural
    proof lives in tests/test_external_discovery.py (external → created,
    internal → unclaimed)."""
    import inspect as _inspect
    from grc.modules.asset_discovery.services import resolver
    src = _inspect.getsource(resolver.resolve_observation)
    assert '"unclaimed"' in src, "unmatched network devices must fall through to unclaimed"
    assert 'obs.source == "external"' in src, \
        "auto-create must be gated behind the external (EASM) carve-out"
    assert src.index('obs.source == "external"') < src.index('"unclaimed"'), \
        "the external carve-out must precede the unclaimed fall-through"


def test_run_endpoint_has_a_db_backed_concurrency_guard():
    """D-C: reject a second run when the DB shows one in flight (cross-process)."""
    import inspect as _inspect
    from grc.modules.asset_discovery import router
    src = _inspect.getsource(router.trigger_run)
    assert "queued" in src and "running" in src and "DiscoveryRun.status" in src, \
        "trigger_run must reject when a run is already queued/running in the DB"
