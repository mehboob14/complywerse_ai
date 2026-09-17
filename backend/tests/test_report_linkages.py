"""Regression tests for Report Builder cross-module link counts.

The defect these guard is not a crash — it is a *silently wrong answer*, which
in a GRC product reads as an audit finding. The Report Builder offers "is not
linked to any X" gap filters for every module pair that has a join edge
(`EDGE_RESOLVERS`), but the link counts those filters read were only ever
produced by the hand-written `_ENRICHERS` table. Wherever the two tables
disagreed, "risks with no internal control linked" returned the entire risk
register and nobody saw an error.

The cause was ordering: `enrich_rows` wrote `link_<x>_count = 0` stubs BEFORE
calling `enrich_xmod_fields`, whose own `setdefault(..., len(rel_ids))` then
found the key already present and discarded the real count.

DB-free, like the rest of the suite: the dummy session raises on `.query()`,
which is exactly what both enrichment paths already treat as "no data", so the
only number that can reach the row is the one the edge resolver returned.
"""
import pytest

from grc.models import Risk
from grc.routers.reporting_router import FilterSpec, _build_condition
from grc.services import report_linkages, report_open_catalog


class _DeadSession:
    """Stands in for a Session. Every enrichment path wraps its queries in
    try/except, so raising here isolates the edge resolver under test."""

    def query(self, *_a, **_kw):
        raise RuntimeError("no database in this test")


@pytest.fixture
def fake_edge(monkeypatch):
    """Point one base→target pair at a resolver with known output."""

    def _install(base, target, mapping):
        edges = dict(report_open_catalog.EDGE_RESOLVERS)
        edges[(base, target)] = lambda _db, _ids: mapping
        monkeypatch.setattr(report_open_catalog, "EDGE_RESOLVERS", edges)

    return _install


def _enrich(base, target, rows):
    return report_linkages.enrich_rows(
        _DeadSession(), dataset=base, rows=rows, includes=[target], project=[],
    )


def test_edge_resolver_count_survives_to_the_row(fake_edge):
    """The bug: this came back 0 for every pair `_ENRICHERS` didn't cover."""
    fake_edge("risks", "internal_controls", {1: [7, 8, 9], 2: []})
    out = _enrich("risks", "internal_controls", [{"id": 1}, {"id": 2}])
    assert out[0]["link_internal_controls_count"] == 3
    assert out[1]["link_internal_controls_count"] == 0


def test_gap_filter_would_not_flag_a_linked_row(fake_edge):
    """`notlinked` is `count > 0` inverted (grid-utils.rowMatchesRules), so a
    zeroed count turns every row into a false 'orphan' finding."""
    fake_edge("risks", "internal_controls", {1: [7], 2: []})
    out = _enrich("risks", "internal_controls", [{"id": 1}, {"id": 2}])
    orphans = [r["id"] for r in out if not r["link_internal_controls_count"]]
    assert orphans == [2]


def test_every_included_target_still_gets_its_stub_keys(fake_edge):
    """Moving the stubs after enrichment must not drop the guarantee that the
    keys exist — a missing column makes the client filter match nothing."""
    fake_edge("risks", "internal_controls", {})
    out = _enrich("risks", "internal_controls", [{"id": 1}])
    for suffix in ("count", "names", "open_count"):
        assert f"link_internal_controls_{suffix}" in out[0]


def test_rows_without_an_id_still_get_stub_keys(fake_edge):
    fake_edge("risks", "internal_controls", {})
    out = _enrich("risks", "internal_controls", [{"id": None}])
    assert out[0]["link_internal_controls_count"] == 0


def test_offered_gap_filters_have_a_working_count_source():
    """`has_edge` drives which gap filters the UI offers, so every pair it
    advertises must be resolvable — otherwise the filter answers 'none linked'
    for every row in the register."""
    unresolvable = [
        pair for pair in report_open_catalog.EDGE_RESOLVERS
        if report_open_catalog.EDGE_RESOLVERS[pair] is None
    ]
    assert not unresolvable


# ── Server-side gap filters ──────────────────────────────────────────────────
# "risks with no evidence linked" used to be answered in the browser over
# whatever the build pass had fetched (SERVER_BUILD_CAP = 5000). Past that
# boundary every row counted as unlinked, so the filter reported a shortfall
# that did not exist — and said nothing about it. These pin it to SQL.


def test_linked_base_ids_only_returns_rows_that_have_a_link(fake_edge):
    fake_edge("risks", "evidence", {1: [5], 2: [], 3: [7, 8]})
    got = report_open_catalog.linked_base_ids(_DeadSession(), "risks", "evidence")
    assert got == {1, 3}


def test_linked_base_ids_is_none_without_a_join_edge():
    """None means 'cannot answer', which must stay distinguishable from the
    empty set — otherwise every row looks like an orphan."""
    assert report_open_catalog.linked_base_ids(_DeadSession(), "risks", "nope") is None


@pytest.mark.parametrize("op", ["linked", "notlinked"])
def test_gap_filter_compiles_to_sql_instead_of_being_skipped(fake_edge, op):
    fake_edge("risks", "evidence", {1: [5]})
    cond, skipped = _build_condition(
        Risk, FilterSpec(col="linkpresence_evidence", op=op), "text",
        db=_DeadSession(), dataset_key="risks",
    )
    assert skipped is None
    assert cond is not None
    assert "grc_risks.id" in str(cond)


def test_gap_filter_with_nothing_linked_is_all_or_nothing(fake_edge):
    """An empty id set must not compile to `IN ()`, which is a SQL error."""
    fake_edge("risks", "evidence", {})
    dead = _DeadSession()
    orphans, _ = _build_condition(
        Risk, FilterSpec(col="linkpresence_evidence", op="notlinked"), "text",
        db=dead, dataset_key="risks",
    )
    linked, _ = _build_condition(
        Risk, FilterSpec(col="linkpresence_evidence", op="linked"), "text",
        db=dead, dataset_key="risks",
    )
    assert str(orphans) == "true" and str(linked) == "false"


@pytest.mark.parametrize("col,kwargs", [
    # No db / dataset context at all (the /aggregate grand-total pass, say).
    ("linkpresence_evidence", {}),
    # Context, but the pair has no join edge.
    ("linkpresence_nope", {"db": _DeadSession(), "dataset_key": "risks"}),
])
def test_gap_filter_still_defers_to_the_client_when_it_cannot_resolve(col, kwargs):
    """The server must report the filter as skipped so the builder keeps
    applying it client-side. Returning no condition without saying so would
    hand back unfiltered rows as if the gap filter had been honoured."""
    cond, skipped = _build_condition(
        Risk, FilterSpec(col=col, op="notlinked"), "text", **kwargs,
    )
    assert cond is None
    assert skipped == "unsupported_operator"
