"""Endpoint agent: the deep probe's hardware identity and routed IP land on the asset
(fill-only for hardware; never a link-local 169.254 address)."""
from types import SimpleNamespace

from grc.routers.agents_router import _apply_deep_identity, _routed_ipv4

NETWORK = {"data": [
    {"name": "Ethernet 2", "ipv4": ["169.254.12.7"], "gateway": []},          # disconnected adapter
    {"name": "Wi-Fi", "ipv4": ["192.168.1.3"], "gateway": ["192.168.1.1"]},   # the routed one
]}


def _asset(**kw):
    base = dict(ip_address="169.254.12.7", manufacturer=None, model=None, serial_number=None)
    return SimpleNamespace(**{**base, **kw})


def test_the_routed_adapter_wins_and_link_local_is_never_used():
    assert _routed_ipv4(NETWORK) == "192.168.1.3"
    assert _routed_ipv4({"data": [{"ipv4": ["169.254.1.1"], "gateway": ["169.254.1.254"]}]}) is None
    assert _routed_ipv4(None) is None


def test_hardware_fills_only_empty_columns_and_the_ip_is_refreshed():
    a = _asset(model="Set by a person")
    pp = {"identity": {"data": {"manufacturer": "Dell Inc.", "model": "Latitude 7440", "serial": "ABC123"}},
          "network": NETWORK}
    _apply_deep_identity(a, pp)
    assert (a.manufacturer, a.model, a.serial_number) == ("Dell Inc.", "Set by a person", "ABC123")
    assert a.ip_address == "192.168.1.3"


def test_no_routed_adapter_keeps_the_stored_ip():
    a = _asset(ip_address="10.0.0.5")
    _apply_deep_identity(a, {"network": {"data": [{"ipv4": ["169.254.3.3"], "gateway": []}]}})
    assert a.ip_address == "10.0.0.5"
