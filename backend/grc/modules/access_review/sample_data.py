"""Sample-data mode for connectors that have no real system to point at.

There is no live SailPoint / SAP / Okta to demo against, so each connector can
load a representative population through the SAME real map + ingest path. The
data is clearly tagged (emails end in `.sample`) and produces real findings, so
the whole pipeline can be exercised per source without external credentials.
"""
from __future__ import annotations

from typing import Any, Dict, List


def make_sample(tag: str) -> List[Dict[str, Any]]:
    """Already-normalised records (the map() output shape) for a connector.

    Deliberately varied so the rule packs fire: an over-privileged admin, a
    Segregation-of-Duties pair holder, a terminated-still-active leaver, a
    privilege-creep user, and a clean user. `tag` keeps emails/ids unique per
    connector so two sample loads don't collide.
    """
    slug = tag.replace(":", "-")

    def u(n: int, name: str, dept: str, ents: List[str], term: bool = False) -> Dict[str, Any]:
        return {
            "external_id": f"{slug}-{n}",
            "email": f"{name.lower().replace(' ', '.')}.{n}@{slug}.sample",
            "display_name": name, "department": dept, "designation": None,
            "account_enabled": True, "terminated": term, "entitlements": ents,
        }

    return [
        u(1, "Ada Admin", "Finance", ["Administrator", "Approver"]),          # over-privileged + SoD
        u(2, "Bob Builder", "Marketing", ["Administrator"]),                  # over-privileged
        u(3, "Lee Leaver", "Sales", ["Editor"], term=True),                   # terminated-still-active
        u(4, "Cara Clean", "IT", ["Viewer"]),                                 # clean
        u(5, "Pat Privileged", "Sales",
          ["Administrator", "Approver", "Editor", "Viewer", "Payments"]),     # over-priv + SoD + creep
    ]
