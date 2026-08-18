"""Phase 4 — choke-point ranking, analytic-truth verified.

Definition (settled): a finding's score = the number of distinct VIABLE
(asset) chains it participates in — its latest snapshot per (vuln, asset)
whose verdict is viable (likely/possible). A severed chain (unlikely) is not
worth breaking, so it does not count.

The ground truth here is HAND-COMPUTED, not the service checked against
itself: fixtures are built so the expected ranking is obvious by inspection,
and the service must reproduce it exactly — the analytic-truth pattern (like
the 39.3% curve), available because the data is deliberately small. Real
chains would prove nothing here: the dev tenant's are all 'unlikely'
(0 viable), so a real-data check is vacuous by construction — fixtures are
the only non-vacuous correctness proof.

Locked: latest-snapshot-wins, viable-only predicate, deterministic tie-break
(count desc then finding id), the rankable predicate named, and no summing.
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ReachabilitySnapshot, ReachabilityStep
from grc.services.choke_points import rank_choke_points, is_rankable
from grc.modules.vuln_management.attack.verdict import is_viable_verdict

TENANT = 1
T0 = datetime(2026, 8, 1, 12, 0, 0)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    ReachabilitySnapshot.__table__.create(engine)
    ReachabilityStep.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.close_ = session.close
    yield session
    session.close()


_sid = [0]
def _snap(db, vuln, asset, verdict, when=T0):
    _sid[0] += 1
    db.add(ReachabilitySnapshot(
        id=_sid[0], tenant_id=TENANT, vulnerability_id=vuln, asset_id=asset,
        verdict=verdict, content_hash=f"h{_sid[0]}", assessed_at=when))
    return _sid[0]


def _seed(db):
    # vuln 100: viable on assets 1,2,3 -> chain_count 3 (the clear #1)
    _snap(db, 100, 1, "possible"); _snap(db, 100, 2, "possible"); _snap(db, 100, 3, "likely")
    # vuln 101: viable on 1,2; severed on 3 -> chain_count 2
    _snap(db, 101, 1, "possible"); _snap(db, 101, 2, "possible"); _snap(db, 101, 3, "unlikely")
    # vuln 102: viable on 1 only -> chain_count 1
    _snap(db, 102, 1, "likely")
    # vuln 104: also chain_count 1 -> ties 102, must order AFTER (id asc)
    _snap(db, 104, 1, "possible")
    # vuln 103: only severed -> chain_count 0 -> NOT rankable, excluded
    _snap(db, 103, 1, "unlikely")
    # latest-wins: an OLD viable snapshot for 102 on asset 2 that a NEWER
    # 'unlikely' supersedes -> must NOT count (else 102 would be 2)
    _snap(db, 102, 2, "possible", when=T0 - timedelta(days=5))
    _snap(db, 102, 2, "unlikely", when=T0)  # newer wins -> asset 2 not viable
    db.commit()


def test_rankable_predicate_named():
    # the predicate is pinned: rankable == has >=1 viable chain
    assert is_rankable(1) is True
    assert is_rankable(3) is True
    assert is_rankable(0) is False


def test_ranking_matches_hand_computed_truth(db):
    _seed(db)
    ranking = rank_choke_points(db, TENANT)
    # analytic ground truth, computed by inspection above:
    expected = [(100, 3, 1), (101, 2, 2), (102, 1, 3), (104, 1, 4)]
    got = [(c["vulnerability_id"], c["chain_count"], c["rank"]) for c in ranking]
    assert got == expected, f"expected {expected}, got {got}"


def test_severed_only_finding_excluded(db):
    _seed(db)
    ranking = rank_choke_points(db, TENANT)
    assert 103 not in [c["vulnerability_id"] for c in ranking]


def test_latest_snapshot_wins(db):
    _seed(db)
    ranking = rank_choke_points(db, TENANT)
    v102 = next(c for c in ranking if c["vulnerability_id"] == 102)
    # asset 2's newer 'unlikely' supersedes the old 'possible' -> count stays 1
    assert v102["chain_count"] == 1
    assert {ch["asset_id"] for ch in v102["chains"]} == {1}


def test_deterministic_tie_break(db):
    _seed(db)
    r1 = [c["vulnerability_id"] for c in rank_choke_points(db, TENANT)]
    r2 = [c["vulnerability_id"] for c in rank_choke_points(db, TENANT)]
    assert r1 == r2, "identical recompute must be byte-identical (no tie jitter)"
    # 102 before 104 on equal counts (finding id asc)
    assert r1.index(102) < r1.index(104)


def test_decomposition_is_self_contained(db):
    _seed(db)
    top = rank_choke_points(db, TENANT)[0]
    # every claimed chain carries its own (asset, snapshot, verdict) so the
    # explainability click never needs a live join to mutable chain tables
    assert len(top["chains"]) == top["chain_count"] == 3
    for ch in top["chains"]:
        assert {"asset_id", "snapshot_id", "verdict"} <= set(ch)
        assert is_viable_verdict(ch["verdict"])


def test_empty_when_no_viable_chains(db):
    # the real dev-tenant condition: all 'unlikely' -> empty ranking, honestly
    _snap(db, 200, 1, "unlikely"); _snap(db, 200, 2, "unlikely")
    db.commit()
    assert rank_choke_points(db, TENANT) == []


# ── tie-break by risk signal (audit-fix, 18 Aug): equal leverage must not order
#    a Medium above a CISA-KEV, actively-exploited High purely by row id ────────
def test_equal_leverage_tie_breaks_by_kev_then_epss_then_severity():
    from grc.models import Vulnerability
    engine = create_engine("sqlite://")
    for m in (ReachabilitySnapshot, ReachabilityStep, Vulnerability):
        m.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    # three findings, ALL breaking exactly 1 path (equal leverage):
    #   284 = Medium, no KEV        (lowest id — would win under the old id tie-break)
    #   285 = High, CISA-KEV, EPSS  (should now rank #1)
    #   286 = High, no KEV, EPSS    (should rank #2, above the Medium)
    db.add_all([
        Vulnerability(id=284, tenant_id=TENANT, vuln_id="V-284", title="node-tar", severity="medium",
                      cvss_score=5.5, epss_score=0.10, kev_flag=False),
        Vulnerability(id=285, tenant_id=TENANT, vuln_id="V-285", title="winverify", severity="high",
                      cvss_score=7.8, epss_score=0.40, kev_flag=True),
        Vulnerability(id=286, tenant_id=TENANT, vuln_id="V-286", title="winrar", severity="high",
                      cvss_score=7.8, epss_score=0.20, kev_flag=False),
    ])
    _snap(db, 284, 1, "likely"); _snap(db, 285, 1, "likely"); _snap(db, 286, 1, "likely")
    db.commit()
    order = [c["vulnerability_id"] for c in rank_choke_points(db, TENANT)]
    assert order == [285, 286, 284], order          # KEV first, then EPSS-higher High, then Medium
    db.close()


def test_higher_leverage_still_wins_over_a_kev_with_fewer_paths():
    from grc.models import Vulnerability
    engine = create_engine("sqlite://")
    for m in (ReachabilitySnapshot, ReachabilityStep, Vulnerability):
        m.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        Vulnerability(id=1, tenant_id=TENANT, vuln_id="V-1", title="broad", severity="medium", kev_flag=False),
        Vulnerability(id=2, tenant_id=TENANT, vuln_id="V-2", title="kev", severity="high", kev_flag=True),
    ])
    # vuln 1 breaks 2 paths, KEV vuln 2 breaks 1 -> leverage still wins: 1 before 2
    _snap(db, 1, 1, "likely"); _snap(db, 1, 2, "likely"); _snap(db, 2, 1, "likely")
    db.commit()
    order = [c["vulnerability_id"] for c in rank_choke_points(db, TENANT)]
    assert order == [1, 2], order
    db.close()
