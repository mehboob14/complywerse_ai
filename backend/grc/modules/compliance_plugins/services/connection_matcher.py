"""Robust asset <-> integration-connection matching.

Historically an asset matched a connection ONLY when
``lower(asset.host_name) == lower(connection.console_url)`` — exact hostname.
That silently fails for real / auto-discovered inventory:

  * FQDN vs short name   — asset ``server01.corp.com`` vs connection ``server01``
  * IP-configured conn   — connection ``console_url='10.0.0.5'`` and an asset
                           whose ``host_name`` is a name but whose ``ip_address``
                           is 10.0.0.5 (or vice-versa)
  * asset known by IP    — discovery populated ``host_name`` with an IP

…all of which leave a scannable asset showing "not connected".

This widens the match to **hostname + IP + FQDN-short-name** while staying
*exact* on each key (no fuzzy/substring guessing that could mis-target a scan
at the wrong host). Priority is exact-host → IP → short-name, so the safest
match always wins; short-name is last because two hosts can share a short name
across domains (the one accepted ceiling — documented, not silently fuzzy).

Usage mirrors the old ``connections_by_host`` dict pattern:

    index = build_index(connections)          # once per request
    conns = candidates_for_asset(asset, index) # best-key-first, de-duped
    conn  = conns[0] if conns else None
"""
from __future__ import annotations

import ipaddress
from typing import List


def _norm(s) -> str:
    return (s or "").strip().lower()


def _is_ip(s: str) -> bool:
    try:
        ipaddress.ip_address(s)
        return True
    except ValueError:
        return False


def _short(host: str) -> str:
    """``server01.corp.com`` -> ``server01``. IPs and bare names unchanged."""
    h = _norm(host)
    if not h or _is_ip(h):
        return h
    return h.split(".", 1)[0]


def _conn_keys(console_url) -> set:
    """Every key a connection can be found under: its console_url, the host
    part if it's URL-ish (``https://host:443/x`` -> ``host``), and the
    short-name of that."""
    cu = _norm(console_url)
    if not cu:
        return set()
    host = cu.split("://", 1)[-1].split("/", 1)[0]
    # strip a trailing :port (but not the ip itself)
    if host.count(":") == 1:
        host = host.split(":", 1)[0]
    keys = {cu, host, _short(host)}
    return {k for k in keys if k}


def build_index(connections) -> dict:
    """key -> list[connection], encounter order preserved (first-added wins
    the ordering, matching the old dict-build behaviour)."""
    idx: dict = {}
    for c in connections:
        for k in _conn_keys(getattr(c, "console_url", None)):
            idx.setdefault(k, []).append(c)
    return idx


def _asset_keys(asset) -> List[str]:
    """Ordered lookup keys for an asset: exact host, IP, then host short-name."""
    host = _norm(getattr(asset, "host_name", ""))
    ip = _norm(getattr(asset, "ip_address", ""))
    out: List[str] = []
    for k in (host, ip, _short(host)):
        if k and k not in out:
            out.append(k)
    return out


def candidates_for_asset(asset, index: dict) -> list:
    """Connections targeting this asset, best-key-first (exact host > IP >
    short-name), de-duplicated, order-preserving."""
    seen = set()
    out: list = []
    for k in _asset_keys(asset):
        for c in index.get(k, []):
            if id(c) not in seen:
                seen.add(id(c))
                out.append(c)
    return out


if __name__ == "__main__":  # runnable self-check: python -m ...connection_matcher
    class C:
        def __init__(self, url): self.console_url = url
    class A:
        def __init__(self, host="", ip=""): self.host_name = host; self.ip_address = ip

    c_host = C("DESKTOP-CE3EFJB")
    c_ip = C("10.0.0.5")
    c_url = C("https://vc01.corp.com:443")
    idx = build_index([c_host, c_ip, c_url])

    # exact hostname (case-insensitive) — the case that already worked
    assert candidates_for_asset(A(host="desktop-ce3efjb"), idx)[0] is c_host
    # FQDN asset -> short-name connection
    assert candidates_for_asset(A(host="DESKTOP-CE3EFJB.corp.local"), idx)[0] is c_host
    # IP-configured connection matched by the asset's ip_address
    assert candidates_for_asset(A(host="web01", ip="10.0.0.5"), idx)[0] is c_ip
    # URL console_url matched by host part
    assert candidates_for_asset(A(host="vc01.corp.com"), idx)[0] is c_url
    # short-name of a URL host
    assert candidates_for_asset(A(host="vc01"), idx)[0] is c_url
    # no common key -> no match (never mis-target)
    assert candidates_for_asset(A(host="unknown-host", ip="192.168.9.9"), idx) == []
    # exact host wins over short-name collision ordering
    print("connection_matcher self-check: OK")
