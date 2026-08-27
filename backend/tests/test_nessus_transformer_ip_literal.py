"""Nessus scan hosts that report a bare IP as their "hostname".

An uncredentialed scan of an address has no DNS name, so the scan host list
carries hostname="162.244.93.14" and NO separate ip field. The transformer must
surface that as the host's ip_address (so the IP-last asset match and the
host_identity "ip" stamp both work) while leaving the stable external id
untouched — vuln ids and auto-close key off it.
"""
import hashlib

from grc.modules.integrations.adapters.nessus_transformer import NessusTransformer

TENANT = 1


def _scan_host(**over):
    raw = {"host_id": 2, "hostname": "162.244.93.14", "_source": "scan", "_scan_name": "liztek server"}
    raw.update(over)
    return raw


def test_ip_literal_hostname_becomes_ip_address():
    t = NessusTransformer.transform_asset(_scan_host(), connection_id=6, tenant_id=TENANT)
    assert t["ip_address"] == "162.244.93.14"
    assert t["host_name"] == "162.244.93.14"  # unchanged — identity field


def test_stable_asset_id_unchanged_by_the_ip_fallback():
    t = NessusTransformer.transform_asset(_scan_host(), connection_id=6, tenant_id=TENANT)
    expected = "nessus-" + hashlib.sha256(f"{TENANT}:nessus:162.244.93.14".encode()).hexdigest()[:24]
    assert t["external_asset_id"] == expected


def test_real_hostname_with_explicit_ip_is_untouched():
    t = NessusTransformer.transform_asset(
        _scan_host(hostname="web01", **{"host-ip": "10.0.0.5"}), connection_id=6, tenant_id=TENANT
    )
    assert t["host_name"] == "web01"
    assert t["ip_address"] == "10.0.0.5"


def test_real_hostname_without_ip_stays_ip_less():
    t = NessusTransformer.transform_asset(_scan_host(hostname="web01"), connection_id=6, tenant_id=TENANT)
    assert t["host_name"] == "web01"
    assert t["ip_address"] == ""
