"""AI asset-layout planner (Layer 2) — hermetic, no network.

Locks the owner's contract: the model only ever sees field KEYS (never values);
a plan that invents/drops keys, uses an unknown card, or overlong headings is
REJECTED so the caller falls back to the generic Layer-1 renderer.
"""
from types import SimpleNamespace

from grc.services import asset_layout_ai as L


def _asset():
    return SimpleNamespace(
        id=168, platform_kind=None, asset_type="infrastructure", last_seen_source="external",
        app_attributes_json={"listen_port": 5432},
        platform_properties={
            "fingerprint": {"x": 1},                       # hidden
            "discovery_classification": {"device_type": "host"},  # hidden
            "engine": "PostgreSQL",                        # flat scalar
            "external_probe": {"ip": "162.244.93.14", "tls_issuer": "YE2", "live": True, "title": None},
            "os": {"status": "discovered", "data": {"edition": "Pro", "build": "22631", "dimms": [{"a": 1}]}},
        },
    )


def test_collect_keys_sends_keys_not_values():
    keys = L.collect_field_keys(_asset())
    names = {k["key"] for k in keys}
    # the real keys are present, with only a TYPE hint
    assert {"engine", "external_probe.ip", "external_probe.tls_issuer", "external_probe.live",
            "os.edition", "os.build", "app.listen_port"} <= names
    # hidden / nested / empty things are NOT sent
    assert not any(n.startswith("fingerprint") or n.startswith("discovery_classification") for n in names)
    assert "os.dimms" not in names            # list inside a section is not a scalar
    assert "external_probe.title" not in names  # None is skipped
    # and NO value ever appears in the payload
    blob = str(keys)
    for secret in ("162.244.93.14", "YE2", "PostgreSQL", "22631", "5432"):
        assert secret not in blob, f"value leaked into model input: {secret}"


def test_validate_accepts_a_clean_plan():
    keys = L.collect_field_keys(_asset())
    raw = {
        "fields": [{"key": k["key"], "heading": "H " + k["key"][-8:], "card": "Other"} for k in keys],
        "cards": [{"name": "Other", "size": "full", "order": 1}],
    }
    plan = L.validate_plan(raw, keys)
    assert plan and plan["cards"] == [{"name": "Other", "size": "full", "order": 1}]
    assert {f["key"] for f in plan["fields"]} == {k["key"] for k in keys}


def test_validate_rejects_invented_or_dropped_keys_and_bad_cards():
    keys = L.collect_field_keys(_asset())
    good = [{"key": k["key"], "heading": "x", "card": "Network"} for k in keys]
    cards = [{"name": "Network", "size": "half", "order": 1}]
    # invented key → reject
    assert L.validate_plan({"fields": good + [{"key": "made_up", "heading": "x", "card": "Network"}], "cards": cards}, keys) is None
    # dropped key → reject
    assert L.validate_plan({"fields": good[:-1], "cards": cards}, keys) is None
    # unknown card → reject
    bad_card = [dict(f, card="Wizardry") for f in good]
    assert L.validate_plan({"fields": bad_card, "cards": [{"name": "Wizardry", "size": "half", "order": 1}]}, keys) is None
    # overlong heading → reject
    long_h = [dict(f, heading="x" * 41) for f in good]
    assert L.validate_plan({"fields": long_h, "cards": cards}, keys) is None
    # garbage → reject
    assert L.validate_plan("not a dict", keys) is None


def test_validate_adds_missing_card_and_sorts():
    keys = L.collect_field_keys(_asset())
    fields = [{"key": k["key"], "heading": "x", "card": "Security"} for k in keys]
    # model forgot to list the Security card at all
    plan = L.validate_plan({"fields": fields, "cards": [{"name": "Other", "size": "half", "order": 5}]}, keys)
    assert plan is not None
    names = [c["name"] for c in plan["cards"]]
    assert "Security" in names and names == sorted(names, key=lambda n: [c["order"] for c in plan["cards"] if c["name"] == n][0])


def test_keyset_hash_is_order_independent_and_sensitive():
    a = [{"key": "x", "type": "text"}, {"key": "y", "type": "text"}]
    b = list(reversed(a))
    assert L.keyset_hash(a) == L.keyset_hash(b)
    assert L.keyset_hash(a) != L.keyset_hash(a + [{"key": "z", "type": "text"}])
