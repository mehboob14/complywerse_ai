"""Canonical external-asset roll-up — ONE registrable (apex) domain = ONE asset.

Single source of truth for "how many external assets are there", shared by every
dashboard, the estate overview and the Asset Register so their counts reconcile.

The rule (matches the register's `psl`-based client rollup in
`grc-frontend/src/lib/domains.ts`):

  * An external asset that is a DNS name rolls up under its registrable / apex
    domain — ``www.superior.edu.pk``, ``adfs.superior.edu.pk`` and the bare
    ``superior.edu.pk`` are ONE external asset (``superior.edu.pk``), not three.
  * An external asset that is a bare IP or a single-label host counts as ITSELF
    (one unit), since it can't be grouped under a domain.
  * Internal assets are NEVER rolled up — each is its own asset.

So the external count everywhere is the number of distinct registrable domains
(plus any non-groupable external hosts), never the flat subdomain count.

Pure functions, no DB / model imports — safe to import from any router or service.
Self-check (no DB):  python -m grc.modules.it_assets.asset_rollup   (from backend/)
"""
from __future__ import annotations

import ipaddress
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Tuple

# Multi-label public suffixes handled WITHOUT a full Public Suffix List, so
# ``a.b.co.uk`` groups under ``b.co.uk`` (not ``co.uk``) and ``x.superior.edu.pk``
# under ``superior.edu.pk`` (not ``edu.pk``). This is the UNION of the two lists
# that used to live (and disagree — ``edu.pk`` was missing from one) in
# asset_discovery.domain_hierarchy and estate_overview.service; both now delegate
# here so there is exactly one list. A name under an unlisted multi-part suffix
# falls back to last-two-labels, correct for the vast majority (.com/.ca/.net/…).
# ponytail: swap in `publicsuffix2`/`tldextract` only if a tenant's grouping is
# ever materially wrong; the callers don't change.
TWO_LEVEL_SUFFIXES = frozenset({
    # .uk
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk",
    # .au
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    # .nz
    "co.nz", "org.nz", "net.nz", "govt.nz",
    # .za
    "co.za", "org.za",
    # regional com.* / co.* / etc.
    "com.br", "com.mx", "com.ar", "com.tr", "com.sg", "com.hk", "com.cn",
    "com.tw", "co.jp", "or.jp", "ne.jp", "co.kr", "co.in", "net.in", "org.in",
    "gov.in", "co.id", "or.id", "go.id", "com.my", "com.ph", "com.sa", "com.eg",
    "com.ng", "co.ke", "com.ua", "com.ru",
    # .pk  (edu.pk was the missing one that broke superior.edu.pk grouping)
    "com.pk", "net.pk", "org.pk", "gov.pk", "edu.pk",
})


def _is_ip_literal(value: str) -> bool:
    try:
        ipaddress.ip_address(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def registrable_domain(name: Optional[str]) -> Optional[str]:
    """The registrable / apex domain of a DNS name, or ``None`` if it isn't a
    groupable domain (empty, a bare IP, or a single-label host).

    ``ftp.liztek.ca`` → ``liztek.ca`` · ``liztek.ca`` → ``liztek.ca`` ·
    ``adfs.superior.edu.pk`` → ``superior.edu.pk`` · ``foo.bar.co.uk`` → ``bar.co.uk`` ·
    ``10.0.0.1`` / ``desktop-abc`` → ``None``.
    """
    if not name:
        return None
    host = str(name).strip().lower().rstrip(".")
    # a host:port or an IP is not a groupable domain
    if not host or ":" in host or _is_ip_literal(host):
        return None
    labels = [p for p in host.split(".") if p]
    if len(labels) < 2:
        return None  # a bare NetBIOS/single-label name is not a domain
    last_two = ".".join(labels[-2:])
    if len(labels) >= 3 and last_two in TWO_LEVEL_SUFFIXES:
        return ".".join(labels[-3:])
    return last_two


def external_unit_key(name: Optional[str], asset_id) -> str:
    """The roll-up bucket an external asset counts under: its apex domain when
    groupable, else a per-asset key so a bare IP / single-label host is its own
    unit (never silently merged with another)."""
    apex = registrable_domain(name)
    return apex if apex else f"id:{asset_id}"


def _field(asset_like, key, default=None):
    """Read ``key`` from an ORM object OR a dict, defensively (missing → default)."""
    if asset_like is None:
        return default
    if isinstance(asset_like, dict):
        return asset_like.get(key, default)
    return getattr(asset_like, key, default)


def is_external(asset_like) -> bool:
    """THE single source of truth for external-vs-internal classification.

    External == internet-facing OR EASM-discovered OR last seen outside-in:
    ``internet_facing`` (or the legacy ``is_internet_facing``) is truthy, OR
    ``origin_source == 'easm'``, OR ``last_seen_source == 'external'``. Everything
    else (credentialed hosts, imported/manual records, network-sweep devices) is
    internal.

    Accepts either an ORM ``ITAsset`` or a plain ``dict`` and reads every field
    with ``getattr``/``.get`` so it tolerates either shape and missing columns.
    ``name``/``ip`` are read defensively for callers that pass them but never
    change the decision — exposure flags alone define "external". Kept name- and
    signature-stable: other services (register, dashboards, the Help Desk CMDB)
    import this exact helper so their classification is identical by construction.
    """
    if bool(_field(asset_like, "internet_facing")) or bool(_field(asset_like, "is_internet_facing")):
        return True
    if str(_field(asset_like, "origin_source", "") or "").lower() == "easm":
        return True
    if str(_field(asset_like, "last_seen_source", "") or "").lower() == "external":
        return True
    return False


def unit_key_for(asset_like) -> str:
    """Roll-up bucket key for ANY asset (ORM or dict), using the canonical rules:
    an EXTERNAL asset folds under its registrable (apex) domain (or a per-id key
    when the name isn't a groupable domain); an INTERNAL asset is always its own
    unit (``int:<id>``) so internal assets are never merged. Distinct keys over a
    list therefore give the rolled-up asset count (external domains + non-groupable
    external hosts + every internal asset)."""
    asset_id = _field(asset_like, "id")
    if not is_external(asset_like):
        return f"int:{asset_id}"
    name = (_field(asset_like, "fqdn") or _field(asset_like, "host_name")
            or _field(asset_like, "name") or "")
    return external_unit_key(name, asset_id)


def rollup_external(rows: Iterable[Tuple[object, Optional[str], bool]]) -> Dict[str, object]:
    """Reconciled counts from ``(asset_id, dns_name, is_external)`` triples.

    Returns ``external`` (distinct registrable apex domains + non-groupable
    external hosts), ``internal`` (flat, never rolled up), ``total`` =
    external + internal, and ``subcounts`` = {apex_domain: number_of_subdomains}
    (names in the unit minus its apex representative) for the register badges.
    """
    units: Dict[str, int] = defaultdict(int)
    internal = 0
    for asset_id, name, is_ext in rows:
        if not is_ext:
            internal += 1
            continue
        units[external_unit_key(name, asset_id)] += 1
    external = len(units)
    subcounts = {k: n - 1 for k, n in units.items() if n > 1 and not k.startswith("id:")}
    return {
        "external": external,
        "internal": internal,
        "total": external + internal,
        "subcounts": subcounts,
    }


if __name__ == "__main__":  # self-check — no DB needed
    assert registrable_domain("adfs.superior.edu.pk") == "superior.edu.pk"
    assert registrable_domain("superior.edu.pk") == "superior.edu.pk"
    assert registrable_domain("anmc.drc.superior.edu.pk") == "superior.edu.pk"
    assert registrable_domain("ftp.liztek.ca") == "liztek.ca"
    assert registrable_domain("liztek.ca") == "liztek.ca"
    assert registrable_domain("foo.bar.co.uk") == "bar.co.uk"
    assert registrable_domain("x.example.com") == "example.com"
    assert registrable_domain("10.0.0.1") is None
    assert registrable_domain("desktop-abc") is None
    assert registrable_domain("demo.testfire.net") == "testfire.net"

    # superior (235 names, apex present) + liztek (7) + testfire (1) + 2 internal
    rows: List[Tuple[object, Optional[str], bool]] = []
    rows += [(i, f"h{i}.superior.edu.pk", True) for i in range(234)]
    rows += [(1000, "superior.edu.pk", True)]                       # the apex itself
    rows += [(2000 + i, f"h{i}.liztek.ca", True) for i in range(6)]
    rows += [(3000, "liztek.ca", True)]
    rows += [(4000, "demo.testfire.net", True)]                     # apex absent -> still 1 unit
    rows += [(5000, "dc01", False), (5001, "10.0.0.5", False)]      # internal, flat
    out = rollup_external(rows)
    assert out["external"] == 3, out
    assert out["internal"] == 2, out
    assert out["total"] == 5, out
    assert out["subcounts"]["superior.edu.pk"] == 234, out["subcounts"]
    assert out["subcounts"]["liztek.ca"] == 6, out["subcounts"]
    assert "testfire.net" not in out["subcounts"]  # single name -> 0 subs

    # is_external — ORM-like object and dict, every signal, defensive on missing fields
    class _A:  # minimal ORM stand-in
        def __init__(self, **kw): self.__dict__.update(kw)
    assert is_external(_A(internet_facing=True)) is True
    assert is_external(_A(is_internet_facing=True)) is True              # legacy column
    assert is_external(_A(origin_source="easm")) is True
    assert is_external(_A(last_seen_source="external")) is True
    assert is_external(_A(origin_source="network_sweep", internet_facing=False)) is False
    assert is_external({"internet_facing": True}) is True                # dict shape
    assert is_external({"origin_source": "import"}) is False
    assert is_external({}) is False and is_external(None) is False       # defensive
    assert is_external(_A(name="testphp.vulnweb.com", last_seen_source="external")) is True

    # unit_key_for — external folds by apex, internal is always its own unit
    assert unit_key_for(_A(id=1, name="adfs.superior.edu.pk", origin_source="easm")) == "superior.edu.pk"
    assert unit_key_for(_A(id=2, name="superior.edu.pk", origin_source="easm")) == "superior.edu.pk"
    assert unit_key_for(_A(id=3, name="dc01", origin_source="connect")) == "int:3"   # internal, flat
    assert unit_key_for({"id": 4, "fqdn": "ftp.liztek.ca", "internet_facing": True}) == "liztek.ca"
    # 243 external folding to 3 domains + 2 internal = 5 distinct unit keys
    keys = {unit_key_for(_A(id=i, name=f"h{i}.superior.edu.pk", origin_source="easm")) for i in range(234)}
    keys |= {unit_key_for(_A(id=900, name="superior.edu.pk", origin_source="easm"))}
    keys |= {unit_key_for(_A(id=1000 + i, name=f"h{i}.liztek.ca", internet_facing=True)) for i in range(7)}
    keys |= {unit_key_for(_A(id=2000, name="demo.testfire.net", last_seen_source="external"))}
    keys |= {unit_key_for(_A(id=3001, name="DESKTOP-A", origin_source="connect"))}
    keys |= {unit_key_for(_A(id=3002, name="DESKTOP-B", origin_source="agent"))}
    assert len(keys) == 5, sorted(keys)
    print("asset_rollup self-check OK")
