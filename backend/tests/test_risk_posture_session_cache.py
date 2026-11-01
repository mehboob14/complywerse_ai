"""Guard: the Risk Posture dashboard sweep must not re-run tenant-wide
queries once per asset. `resolve_weights_for_tenant` memoises on the
Session, so N assets trigger ONE weights lookup, not N. A fake Session
counts the queries to prove the collapse holds."""
from grc.modules.risk_posture.service import (
    _session_cache, resolve_weights_for_tenant, DEFAULT_WEIGHTS,
)


class _FakeSession:
    """Minimal stand-in: counts how many times a weights query runs."""
    def __init__(self):
        self.calls = 0

    def query(self, *_a, **_k):
        self.calls += 1
        return self

    def filter(self, *_a, **_k):
        return self

    def first(self):
        return None  # no override row → defaults


def test_session_cache_is_shared_and_persists():
    db = _FakeSession()
    a = _session_cache(db)
    a["x"] = 1
    assert _session_cache(db) is a and _session_cache(db)["x"] == 1


def test_weights_query_runs_once_per_tenant_across_sweep():
    db = _FakeSession()
    # Simulate a 50-asset sweep all resolving the same tenant's weights.
    for _ in range(50):
        w = resolve_weights_for_tenant(db, tenant_id=7)
        assert w == DEFAULT_WEIGHTS
    assert db.calls == 1, f"expected 1 weights query across the sweep, got {db.calls}"


def test_returned_weights_are_independent_copies():
    db = _FakeSession()
    w = resolve_weights_for_tenant(db, tenant_id=7)
    w["cis"] = 999  # mutating the caller's copy must not poison the cache
    assert resolve_weights_for_tenant(db, tenant_id=7)["cis"] == DEFAULT_WEIGHTS["cis"]


if __name__ == "__main__":
    test_session_cache_is_shared_and_persists()
    test_weights_query_runs_once_per_tenant_across_sweep()
    test_returned_weights_are_independent_copies()
    print("ok")
