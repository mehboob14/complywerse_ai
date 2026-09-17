"""Custom controls: the register fields, the approval workflow and the links.

The parts that are easy to get quietly wrong: a code that collides with another
control (used to fail on the unique constraint as a 500), a retargeted mapping
still counted as inherited, a seeded framework whose requirement codes are keyed
on the wrong field, and an approval a submitter can grant themselves.
"""
from types import SimpleNamespace

import pytest

from grc.modules.scf import custom_controls as cc
from grc.modules.scf import record_links as rl
from grc.modules.scf import registry


# ── register fields ──────────────────────────────────────────────────────────
def test_profile_fields_are_validated_and_coerced():
    out = cc.clean_profile({
        "category": "  IT Security  ", "control_type": "Detective",
        "operating_frequency": "QUARTERLY", "department_id": "4",
        "effective_date": "2026-01-05", "review_date": "", "unknown": "dropped",
    })
    assert out["category"] == "IT Security"
    assert out["control_type"] == "detective" and out["operating_frequency"] == "quarterly"
    assert out["department_id"] == 4
    assert out["effective_date"].year == 2026 and out["review_date"] is None
    assert "unknown" not in out

    with pytest.raises(ValueError):
        cc.clean_profile({"control_type": "mitigating"})
    with pytest.raises(ValueError):
        cc.clean_profile({"effective_date": "last Tuesday"})


def test_authored_evidence_accepts_strings_and_objects_and_drops_blanks():
    rows = cc.clean_evidence([
        "Access review sign-off",
        {"name": "Group export", "collection_method": "automated", "filetype": "CSV"},
        {"name": "  "},
        "access review sign-off",          # same artifact, different case
    ])
    assert [r["name"] for r in rows] == ["Access review sign-off", "Group export"]
    assert rows[1]["collection_method"] == "automated"
    assert rows[0]["collection_method"] == "manual" and rows[0]["source"] == "authored"
    # An unknown method is not passed through to the views as a new dot colour.
    assert cc.clean_evidence([{"name": "x", "collection_method": "telepathy"}])[0]["collection_method"] == "manual"


def test_codes_are_allocated_in_sequence_and_never_reused():
    """Authoring a control from a policy statement should not make anyone invent
    an identifier, and two in a row must not collide."""
    class _Q:
        def __init__(self, rows):
            self._rows = rows

        def filter(self, *_a, **_k):
            return self

        def all(self):
            return self._rows

    class _Db:
        def __init__(self, existing):
            self._existing = existing
            self._calls = 0

        def query(self, *_a, **_k):
            self._calls += 1
            # first call: this tenant's custom scf_ids; second: codes already taken
            return _Q([(c,) for c in self._existing])

    assert cc.next_custom_code(_Db([]), 3) == "CTL-0001"
    assert cc.next_custom_code(_Db(["CTL-0001", "CTL-0007", "ACCESS-REVIEW"]), 3) == "CTL-0008"
    # A retired CTL-0008 still holds its number; the next one moves past it.
    assert cc.next_custom_code(_Db(["CTL-0008"]), 3) == "CTL-0009"


def test_lifecycle_transitions_are_a_closed_set():
    assert cc.LIFECYCLE_ACTIONS["approve"][0] == ("pending_approval",)
    assert cc.LIFECYCLE_ACTIONS["approve"][1] == "active"
    assert cc.LIFECYCLE_ACTIONS["deactivate"][0] == ("active",)
    # Every destination is a status the register knows.
    assert {rule[1] for rule in cc.LIFECYCLE_ACTIONS.values()} <= cc.VALID_LIFECYCLE


# ── inheritance ──────────────────────────────────────────────────────────────
class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *_a, **_k):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, rows):
        self._rows = rows

    def query(self, *_a, **_k):
        return _FakeQuery(self._rows)


def test_a_retargeted_requirement_stops_counting_as_inherited():
    """A reviewer moving a requirement onto another control moves the credit."""
    rows = [("IAC-17", "pci_dss", "8.2.1"), ("IAC-17", "pci_dss", "8.3.1")]
    retargets = {("pci_dss", "8.2.1", "IAC-17"): "IAC-06"}

    out = cc.inherited_requirements_from_scf(_FakeDb(rows), 1, ["IAC-17"], set(), retargets)
    assert [i["code"] for i in out["pci_dss"]] == ["8.3.1"]

    # …and one retargeted onto a control we implement comes with it.
    out = cc.inherited_requirements_from_scf(
        _FakeDb([]), 1, ["IAC-06"], set(), {("pci_dss", "8.2.1", "IAC-17"): "IAC-06"},
    )
    assert [i["code"] for i in out["pci_dss"]] == ["8.2.1"]

    # A suppressed mapping never comes back through either path.
    out = cc.inherited_requirements_from_scf(
        _FakeDb(rows), 1, ["IAC-17"], {("pci_dss", "8.3.1", "IAC-17")}, {},
    )
    assert [i["code"] for i in out["pci_dss"]] == ["8.2.1"]
    out = cc.inherited_requirements_from_scf(
        _FakeDb(rows), 1, ["IAC-06"], {("pci_dss", "8.2.1", "IAC-17")},
        {("pci_dss", "8.2.1", "IAC-17"): "IAC-06"},
    )
    assert out == {}


def test_seeded_frameworks_resolve_to_their_crosswalk_slug_and_join_field():
    """Seeded `grc_uploaded_frameworks` rows carry no slug, so a direct
    requirement link has to be recognised by the library's own name."""
    assert registry.slug_for_framework("ISO/IEC 42001:2023 AI Management System") == "iso_42001"
    assert registry.slug_for_framework("SOC 2 Type II") == "soc2"
    assert registry.slug_for_framework("Not A Framework") is None
    # ISO 42001 cites original_reference; its control_id is a local counter.
    assert registry.join_field_for_slug("iso_42001") == "original_reference"
    assert registry.join_field_for_slug("soc2") == "control_id"


# ── links ────────────────────────────────────────────────────────────────────
def test_every_link_type_writes_into_a_real_table_with_a_real_column():
    for key, spec in rl.SPECS.items():
        assert hasattr(spec.link_model, "normalized_control_id"), key
        assert hasattr(spec.link_model, spec.link_record_col), key
        assert hasattr(spec.model, spec.title_attr), key
        assert hasattr(spec.model, "tenant_id"), key
        for attr in (*spec.search_attrs, *spec.subtitle_attrs):
            assert hasattr(spec.model, attr), f"{key}.{attr}"
        if spec.status_attr:
            assert hasattr(spec.model, spec.status_attr), key
        if spec.alive_attr:
            assert hasattr(spec.model, spec.alive_attr), key
    assert set(rl.TYPE_ORDER) == set(rl.SPECS)


def test_denormalised_link_columns_are_filled_and_not_marked_as_ai():
    nc = SimpleNamespace(id=5, scf_id="CUST-01", code="CUST-01", name="Access review", source="custom")
    ev = rl.SPECS["evidence"].defaults(nc, SimpleNamespace(tenant_id=3))
    assert ev["control_code"] == "CUST-01" and ev["created_by_ai"] is False
    stmt = rl.SPECS["policy_statement"].defaults(nc, SimpleNamespace(tenant_id=3))
    assert stmt["control_kind"] == "normalized" and stmt["tenant_id"] == 3
    assert stmt["created_by_ai"] is False and stmt["link_source"] == "manual"


def test_unknown_link_type_is_rejected_rather_than_silently_ignored():
    with pytest.raises(ValueError):
        rl.write_permissions("mystery")
