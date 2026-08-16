"""E4 — the third state named: viable / severed / UNDETERMINABLE.

The verdict engine used to render three situations as two `unlikely`s: a chain
we DERIVED as dead (every door blocked, or no network entry step at all — real
posture) and a chain we could not derive AT ALL (no CWE/CVSS to reason from —
`unlikely` as a data-gap default). Reading the second as the first is "a default
dressed up as posture": it tells the reader a finding is safe when the honest
answer is "we don't know, and only enrichment could tell us — if it even has a
CVE to enrich from."

The load-bearing assertions here:
  * a no-CWE/no-vector finding is `undeterminable`, NOT `severed`;
  * a LOCAL-only finding (AV:L → no network entry step, entry_state 'none') is
    `severed`, NOT `undeterminable` — 'none' is a CONCLUSION from the vector, not
    a data gap, so enrichment is not its lever;
  * coverage() splits the unviable set by the SAME predicate the engine uses, so
    the two can never drift.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.modules.vuln_management.attack.reachability import evaluate
from grc.modules.vuln_management.attack.verdict import (
    derive_viability, VIABILITY_VIABLE, VIABILITY_SEVERED, VIABILITY_UNDETERMINABLE,
)
from grc.modules.vuln_management.attack.selection import is_undeterminable


# ── duck-typed rows (engine reads via getattr; no ORM needed) ────────────────
class _Row:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _vuln(**kw):
    base = dict(id=1, cve_id="CVE-2024-0001", cwe_id=None, cwe_ids=None, cvss_vector=None,
                status="open", public_exploit_count=None, exploitdb_count=None,
                exploitdb_verified_count=None, exploit_source=None, kev_flag=False,
                epss_score=None, patch_references=[])
    base.update(kw)
    return _Row(**base)


def _asset(**kw):
    base = dict(id=1, name="host-1", is_internet_facing=None, internet_facing=None,
                criticality="medium", environment="production",
                lifecycle_state="operational", status="active")
    base.update(kw)
    return _Row(**base)


NET_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
LOCAL_VECTOR = "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"


# ══════════════════════════════════════════════════════════════════════════
# derive_viability — the pure classifier, exhaustive over the state space
# ══════════════════════════════════════════════════════════════════════════
def test_derive_viability_is_total_and_maps_the_three_states():
    # viable ⟺ verdict is likely/possible, regardless of entry_state.
    assert derive_viability("likely", "open") == VIABILITY_VIABLE
    assert derive_viability("possible", "open") == VIABILITY_VIABLE
    # unlikely + data-gap default → undeterminable (the third state).
    assert derive_viability("unlikely", "assumed_insufficient") == VIABILITY_UNDETERMINABLE
    # unlikely + a DERIVED dead-end → severed (real posture), both flavours.
    assert derive_viability("unlikely", "severed") == VIABILITY_SEVERED
    assert derive_viability("unlikely", "none") == VIABILITY_SEVERED


# ══════════════════════════════════════════════════════════════════════════
# End-to-end through evaluate(): the states the engine actually produces
# ══════════════════════════════════════════════════════════════════════════
def test_no_cwe_no_vector_finding_is_undeterminable_not_severed():
    """THE distinction the fix exists for. No CWE, no CVSS vector → the chain is
    the assumed no-data fallback → `unlikely` is a data-gap default. This must
    read 'undeterminable', never 'severed' — the finding isn't proven safe, it's
    un-analysed."""
    v = _vuln(cwe_id=None, cwe_ids=None, cvss_vector=None)
    a = _asset(is_internet_facing=False)          # concrete not-exposed
    rollup = evaluate(v, a)["rollup"]
    assert rollup["verdict"] == "unlikely"
    assert rollup["entry_state"] == "assumed_insufficient"
    assert rollup["viability"] == VIABILITY_UNDETERMINABLE
    # and it is NOT the concluded state — the whole point.
    assert rollup["viability"] != VIABILITY_SEVERED


def test_derived_blocked_door_is_severed_not_undeterminable():
    """Real CWE + network vector, but the asset isn't internet-exposed → the one
    network entry step (T1190) is BLOCKED on a definite fact. We derived a dead
    end; that is posture, not a data gap. `severed`, and enrichment is no lever."""
    v = _vuln(cwe_id="CWE-89", cvss_vector=NET_VECTOR)   # SQLi, AV:N
    a = _asset(is_internet_facing=False)
    rollup = evaluate(v, a)["rollup"]
    assert rollup["verdict"] == "unlikely"
    assert rollup["entry_state"] == "severed"
    assert rollup["viability"] == VIABILITY_SEVERED
    assert rollup["viability"] != VIABILITY_UNDETERMINABLE


def test_local_only_finding_is_severed_not_undeterminable():
    """AV:L → no network entry step applies at all (entry_state 'none'). That is a
    CONCLUSION from the vector — the attacker must already be local — not an
    absence of data. So it is `severed`, not `undeterminable`: enrichment can't
    open a door the vector says isn't there."""
    v = _vuln(cwe_id="CWE-269", cvss_vector=LOCAL_VECTOR)  # priv-esc, AV:L
    a = _asset(is_internet_facing=True)                    # exposure irrelevant when local-only
    rollup = evaluate(v, a)["rollup"]
    assert rollup["verdict"] == "unlikely"
    assert rollup["entry_state"] == "none"
    assert rollup["viability"] == VIABILITY_SEVERED


def test_mixed_chain_with_assumed_entry_is_undeterminable_not_possible():
    """The live-audit bug (16 Aug): a CVE-less info item ("TLS 1.1 detected",
    CWE-327, NO CVSS vector) on a NON-internet-facing box read 'possible' and
    topped the choke ranking. Cause: the assumed-chain guard keyed on ALL
    techniques being assumed, but CWE-327 derives real post-foothold techniques
    → mixed chain → guard skipped → the assumed entry (T1203) leaked 'possible'.
    The verdict is a claim about the DOOR: assumed entry + no exploit evidence
    must cap at unlikely / undeterminable, whatever the CWE derives downstream."""
    # Exploit intel NEVER CHECKED (None) — the real shape of a Nessus info item.
    # (With counts == 0, T1203's "no public exploit" precondition blocks the
    # door outright → 'severed'; also correct, but a different path.)
    v = _vuln(cve_id=None, cwe_id="CWE-327", cwe_ids=["CWE-327"], cvss_vector=None,
              public_exploit_count=None, exploitdb_count=None, kev_flag=False)
    a = _asset(is_internet_facing=False, internet_facing=False)
    out = evaluate(v, a)
    chain = out["chain"]
    entry = [t for t in chain if (t.get("tactics") or [None])[0] in ("initial-access", "execution")]
    assert entry and all(t.get("assumed") for t in entry)          # entry IS assumed…
    assert any(not t.get("assumed") for t in chain)                 # …but chain is MIXED (CWE-derived steps)
    rollup = out["rollup"]
    assert rollup["verdict"] == "unlikely"                          # not 'possible'
    assert rollup["entry_state"] == "assumed_insufficient"
    assert rollup["viability"] == VIABILITY_UNDETERMINABLE


def test_ui_required_flaw_on_internal_box_stays_possible():
    """The legit sibling: a REAL vector with UI:R (user must open a file) is a
    genuine phishing-style entry that internet exposure does not gate. Must stay
    'possible' — the fix above must not over-correct into this."""
    v = _vuln(cve_id="CVE-2026-50015", cwe_id="CWE-22",
              cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H",
              public_exploit_count=0, exploitdb_count=0, kev_flag=False)
    a = _asset(is_internet_facing=False, internet_facing=False)
    rollup = evaluate(v, a)["rollup"]
    assert rollup["verdict"] == "possible"
    assert rollup["viability"] == VIABILITY_VIABLE


def test_open_entry_finding_is_viable():
    """Internet-exposed + network vector + a public exploit → a way in is open and
    confirmed. Viable, and the field says so plainly."""
    v = _vuln(cwe_id="CWE-89", cvss_vector=NET_VECTOR, kev_flag=True)
    a = _asset(is_internet_facing=True)
    rollup = evaluate(v, a)["rollup"]
    assert rollup["verdict"] in ("likely", "possible")
    assert rollup["viability"] == VIABILITY_VIABLE


# ══════════════════════════════════════════════════════════════════════════
# is_undeterminable — the finding-level predicate coverage() shares
# ══════════════════════════════════════════════════════════════════════════
def test_is_undeterminable_predicate():
    assert is_undeterminable(None, None) is True                 # no basis at all
    assert is_undeterminable("CWE-89", None) is False            # a mapping CWE is basis
    assert is_undeterminable(None, NET_VECTOR) is False          # a vector is basis
    assert is_undeterminable("CWE-89", NET_VECTOR) is False


# ══════════════════════════════════════════════════════════════════════════
# coverage() splits the unviable set by the SAME predicate — no drift
# ══════════════════════════════════════════════════════════════════════════
from grc.models import Vulnerability, ReachabilitySnapshot
from grc.services.choke_points import coverage

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Vulnerability.__table__.create(engine)
    ReachabilitySnapshot.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    _seed(s)
    yield s
    s.close()


_sid = [0]
def _snap(db, vuln_id, asset_id, verdict):
    _sid[0] += 1
    db.add(ReachabilitySnapshot(
        id=_sid[0], tenant_id=TENANT, vulnerability_id=vuln_id, asset_id=asset_id,
        verdict=verdict, content_hash=f"h{_sid[0]}"))


def _seed(db):
    _sid[0] = 0
    # 200: derivable (CWE + vector), chain stored but unviable → SEVERED
    db.add(Vulnerability(id=200, tenant_id=TENANT, vuln_id="V-200", title="sev",
                         severity="high", status="open", cwe_id="CWE-89", cvss_vector=NET_VECTOR))
    _snap(db, 200, 1, "unlikely")
    # 201: no CWE, no vector, chain stored but unviable → UNDETERMINABLE
    db.add(Vulnerability(id=201, tenant_id=TENANT, vuln_id="V-201", title="und",
                         severity="info", status="open", cwe_id=None, cvss_vector=None))
    _snap(db, 201, 1, "unlikely")
    # 202: viable chain → ranked, not in the unviable set at all
    db.add(Vulnerability(id=202, tenant_id=TENANT, vuln_id="V-202", title="via",
                         severity="high", status="open", cwe_id="CWE-89", cvss_vector=NET_VECTOR))
    _snap(db, 202, 1, "possible")
    # 203: NO snapshot → chainless (the generation lever, orthogonal to viability)
    db.add(Vulnerability(id=203, tenant_id=TENANT, vuln_id="V-203", title="none",
                         severity="low", status="open", cwe_id=None, cvss_vector=None))
    db.commit()


def test_coverage_splits_severed_and_undeterminable(db):
    cov = coverage(db, TENANT)
    assert cov["total_findings"] == 4
    assert cov["findings_with_stored_chains"] == 3      # 200, 201, 202
    assert cov["findings_chainless"] == 1               # 203
    assert cov["findings_ranked"] == 1                  # 202 (viable)
    # the split — the two reasons that are NOT one lever:
    assert cov["findings_chained_but_unviable"] == 2    # 200 + 201
    assert cov["findings_severed"] == 1                 # 200 (derived dead-end)
    assert cov["findings_undeterminable"] == 1          # 201 (no basis)
    # and the split is exhaustive over the unviable set.
    assert cov["findings_severed"] + cov["findings_undeterminable"] == cov["findings_chained_but_unviable"]
