"""Runnable check for the multi-IP asset matching helpers (no DB, no framework).
    python grc/services/test_finding_asset_linker_ips.py   ->  prints "ok"
"""
from grc.services.finding_asset_linker import _iter_asset_ips, _finding_ip, _looks_like_ip


def test_iter_asset_ips_merges_dedups_and_normalizes():
    # primary + history, deduped, order-stable, primary first
    assert _iter_asset_ips("192.168.1.3", ["192.168.1.13", "192.168.1.3"]) == \
        ["192.168.1.3", "192.168.1.13"]
    assert _iter_asset_ips(None, None) == []                 # legacy row (NULL)
    assert _iter_asset_ips("10.0.0.1", None) == ["10.0.0.1"]
    assert _iter_asset_ips(" 10.0.0.2 ", "10.0.0.3") == ["10.0.0.2", "10.0.0.3"]  # str + trim
    assert _iter_asset_ips(None, ["", "  ", "10.0.0.9"]) == ["10.0.0.9"]          # blanks dropped


def test_finding_ip_prefers_identity_and_rejects_names():
    assert _finding_ip("nessus-abc123", {"ip": "192.168.1.13"}) == "192.168.1.13"
    assert _finding_ip("192.168.1.9", {}) == "192.168.1.9"                 # ip-literal host
    assert _finding_ip("host.example.com", {"host_name": "host.example.com"}) is None
    assert _finding_ip(None, None) is None


def test_looks_like_ip():
    assert _looks_like_ip("192.168.1.13")
    assert _looks_like_ip("::1")
    assert not _looks_like_ip("desktop-ce3efjb")
    assert not _looks_like_ip("999.1.1.1")        # out of range octet
    assert not _looks_like_ip("192.168.1")        # only 3 octets


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("ok")
