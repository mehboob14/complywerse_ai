"""Milestone 0 — the reasoning trace that the flow view / animation walks.

The load-bearing test is `test_trace_result_equals_build_view`: it is what makes the
animation render the ENGINE'S path and never a script. The rest lock the honest
moments the animation must dramatize (the CAPEC miss, the all-assumed no-path) and
the determinism the replay depends on.
"""
import json

import pytest

from grc.modules.vuln_management.attack.trace import explain
from grc.modules.vuln_management.attack.view import build_view


class _Row:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _vuln(**kw):
    base = dict(id=1, cve_id="CVE-2024-0001", cwe_id=None, cvss_vector=None, status="open",
                public_exploit_count=None, exploitdb_count=None, exploitdb_verified_count=None,
                exploit_source=None, kev_flag=False, epss_score=None)
    base.update(kw)
    return _Row(**base)


def _asset(**kw):
    base = dict(id=1, name="host-1", is_internet_facing=None, lifecycle_state="active", status="active")
    base.update(kw)
    return _Row(**base)


NET = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"
LOCAL = "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"


def _path(chain):
    return [(c["technique_id"], c["status"], c.get("mapping_source")) for c in chain]


_CASES = [
    (_vuln(cwe_id="CWE-89", cvss_vector=NET, exploitdb_count=1, exploitdb_verified_count=1), _asset(is_internet_facing=True)),
    (_vuln(cwe_id="CWE-20", cvss_vector=NET, exploitdb_count=1), _asset(is_internet_facing=False)),
    (_vuln(), _asset(is_internet_facing=True)),                                   # all-assumed
    (_vuln(cvss_vector=LOCAL), _asset(is_internet_facing=True)),                  # local, no entry
]


@pytest.mark.parametrize("v,a", _CASES)
def test_trace_result_equals_build_view(v, a):
    """The trace's result IS the engine's output — same techniques, same statuses,
    same verdict. This is the structural 'renders the trace, never a script' lock."""
    tr = explain(v, a)
    view = build_view(v, a)
    assert _path(tr["result"]["chain"]) == _path(view["chain"])
    assert tr["result"]["verdict"]["verdict"] == view["verdict"]["verdict"]


@pytest.mark.parametrize("v,a", _CASES)
def test_trace_is_deterministic(v, a):
    """Same finding -> byte-identical trace every time, or the replay flickers between
    routes on re-render."""
    fingerprints = {json.dumps(explain(v, a), sort_keys=True, default=str) for _ in range(5)}
    assert len(fingerprints) == 1


def test_trace_shows_capec_miss_and_analyst_fallthrough_for_cwe89():
    """The honest moment: CWE-89 reaches for CAPEC, MISSES, and falls through to the
    analyst map — recorded as an explicit hit=False, not an omission."""
    tr = explain(_vuln(cwe_id="CWE-89", cvss_vector=NET), _asset(is_internet_facing=True))
    map_stage = next(s for s in tr["stages"] if s["stage"] == "map" and s["cwe"] == "CWE-89")
    assert map_stage["capec"]["hit"] is False
    assert "T1190" in map_stage["analyst"]["techniques"]
    # and no selected technique claims a capec_chain source — the miss is real end-to-end
    select_stage = next(s for s in tr["stages"] if s["stage"] == "select")
    assert all("capec_chain" not in t["sources"] for t in select_stage["techniques"])


def test_trace_all_assumed_has_no_derived_mapping_and_caps_to_unlikely():
    """No CWE, no vector -> the assumed stage fires and there is nothing real to draw a
    path from; the verdict is the insufficient-data cap, not a confident 'possible'."""
    tr = explain(_vuln(), _asset(is_internet_facing=True))
    assert any(s["stage"] == "assumed" for s in tr["stages"])
    assert not any(s["stage"] == "map" for s in tr["stages"])   # no CWE -> no map stage
    verdict = next(s for s in tr["stages"] if s["stage"] == "verdict")
    assert verdict["verdict"] == "unlikely" and verdict["entry_state"] == "assumed_insufficient"


def test_trace_blocked_entry_is_a_visible_badge_not_just_a_verdict():
    """The internal-asset case: the entry technique must carry a BLOCKED badge in the
    reach stage (the event the animation dramatizes), not only a severed verdict."""
    tr = explain(_vuln(cwe_id="CWE-89", cvss_vector=NET, exploitdb_count=1), _asset(is_internet_facing=False))
    reach = next(s for s in tr["stages"] if s["stage"] == "reach")
    t1190 = next(b for b in reach["badges"] if b["technique_id"] == "T1190")
    assert t1190["status"] == "blocked" and t1190["is_entry"] is True
    verdict = next(s for s in tr["stages"] if s["stage"] == "verdict")
    assert verdict["verdict"] == "unlikely"
