"""Phase 4 — technique-level threat-intel association.

Guards the one honesty rule the feature exists to hold: the claim is technique-level
("techniques in this chain are used by these actors"), never CVE→actor. Reads the
committed seed; DB- and network-free.
"""
from grc.modules.vuln_management.attack import threat_intel
from grc.modules.vuln_management.attack.threat_intel import PER_TECHNIQUE_CAP


def test_actors_are_bound_to_the_technique_that_carries_them():
    out = threat_intel.for_chain([
        {"technique_id": "T1190", "name": "Exploit Public-Facing Application", "tactic_name": "Initial Access"},
        {"technique_id": "T1595", "name": "Active Scanning", "tactic_name": "Reconnaissance"},
    ])
    by = {b["technique_id"]: b for b in out["by_technique"]}
    assert "T1190" in by and by["T1190"]["actor_total"] > 0
    # T1595 (recon) carries no group mapping and MUST be omitted — a technique with no
    # association can never render as "no actors" by sitting empty under an actor heading.
    assert "T1595" not in by
    assert by["T1190"]["name"] == "Exploit Public-Facing Application"


def test_per_technique_list_capped_but_total_carries_the_rest():
    bt = threat_intel.for_chain([{"technique_id": "T1190", "name": "x"}])["by_technique"][0]
    assert len(bt["actors"]) <= PER_TECHNIQUE_CAP
    assert bt["actor_total"] >= len(bt["actors"])  # +N more is real, not a truncation that lies


def test_union_is_distinct_and_seed_loaded():
    out = threat_intel.for_chain([
        {"technique_id": "T1190", "name": "a"},
        {"technique_id": "T1505.003", "name": "b"},
    ])
    assert out["actor_total"] >= max(b["actor_total"] for b in out["by_technique"])  # distinct union
    assert out["attack_version"]  # the seed actually loaded


def test_empty_chain_yields_no_association():
    out = threat_intel.for_chain([])
    assert out["by_technique"] == [] and out["actor_total"] == 0 and out["software_total"] == 0
