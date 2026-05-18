"""CPE / PURL matcher — Phase 4 piece.

Given a CVE's NVD `affected_configurations`, walks every
`SoftwareIdentifier` row in the tenant and returns the asset IDs whose
identifiers match. Used to auto-create `VulnerabilityAssetLink` rows on
CVE enrichment, with `link_source="cpe_match"` and `auto_linked=True`.

Match rules:
  * CPE 2.3 component match: identical `vendor` AND `product`.
    Wildcards (`*` or `-`) in the NVD CPE match anything.
  * Version range: NVD supplies one or more of `versionStartIncluding`,
    `versionStartExcluding`, `versionEndIncluding`, `versionEndExcluding`.
    If a SoftwareIdentifier has no `version`, only the wildcard CPE
    matches it (otherwise we'd guess wrong).
  * PURL: matches on parsed `vendor` (namespace) + `product` (name) +
    `version`. Same range rules apply.
  * Only `vulnerable=true` cpeMatch entries are considered.

Failure mode: every parse/compare is wrapped — a malformed CPE in the
SoftwareIdentifier table never crashes the matcher; it just doesn't match
that row.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_CPE_PREFIX = "cpe:2.3:"
# Versions: split on '.' / '-' / '_' and try int comparison per part.
_VERSION_SPLIT = re.compile(r"[.\-_+]")


@dataclass
class CpeComponents:
    part: str = "*"      # a | o | h | *
    vendor: str = "*"
    product: str = "*"
    version: str = "*"

    def is_wild_version(self) -> bool:
        return self.version in ("*", "-", "")


def parse_cpe(cpe: str) -> Optional[CpeComponents]:
    """Parse a CPE 2.3 string. Returns None on malformed input."""
    if not isinstance(cpe, str):
        return None
    s = cpe.strip()
    if not s.startswith(_CPE_PREFIX):
        return None
    parts = s[len(_CPE_PREFIX):].split(":")
    if len(parts) < 5:
        return None
    return CpeComponents(
        part=(parts[0] or "*").lower(),
        vendor=(parts[1] or "*").lower(),
        product=(parts[2] or "*").lower(),
        version=(parts[3] or "*").lower(),
    )


def parse_purl(purl: str) -> Optional[CpeComponents]:
    """Parse a PURL string. We treat namespace as vendor, name as product."""
    if not isinstance(purl, str) or not purl.startswith("pkg:"):
        return None
    body = purl[len("pkg:"):]
    # body = type/namespace/name@version  OR  type/name@version
    if "@" in body:
        path, _, version = body.partition("@")
    else:
        path, version = body, "*"
    segments = [seg for seg in path.split("/") if seg]
    if len(segments) < 2:
        return None
    # type/[namespace/]name
    if len(segments) == 2:
        vendor = ""
        product = segments[1]
    else:
        vendor = "/".join(segments[1:-1])
        product = segments[-1]
    return CpeComponents(
        part="a",
        vendor=vendor.lower(),
        product=product.lower(),
        version=(version or "*").lower(),
    )


def _version_tuple(v: str) -> Tuple[Any, ...]:
    """Best-effort version tuple. Numeric parts become ints; non-numeric
    parts stay as lowercase strings. Empty / wild returns ()."""
    if not v or v in ("*", "-"):
        return ()
    out: List[Any] = []
    for chunk in _VERSION_SPLIT.split(v):
        if not chunk:
            continue
        if chunk.isdigit():
            out.append((0, int(chunk)))
        else:
            # Non-numeric chunks sort AFTER numeric chunks of the same
            # position. Common case: "1.0.0-beta" < "1.0.0".
            out.append((1, chunk.lower()))
    return tuple(out)


def _cmp_versions(a: str, b: str) -> int:
    """Return -1 / 0 / +1 comparing two version strings. Wild → 0 (equal)."""
    ta, tb = _version_tuple(a), _version_tuple(b)
    if not ta or not tb:
        return 0
    return (ta > tb) - (ta < tb)


def _version_in_range(
    version: Optional[str], *,
    start_including: Optional[str], start_excluding: Optional[str],
    end_including: Optional[str], end_excluding: Optional[str],
) -> bool:
    """True when `version` falls inside the NVD range bounds. Any None bound
    is treated as open-ended."""
    if not version:
        # No version on the asset's identifier — only the wildcard CPE
        # match makes sense. Caller has already checked `is_wild_version()`.
        return True
    if start_including and _cmp_versions(version, start_including) < 0:
        return False
    if start_excluding and _cmp_versions(version, start_excluding) <= 0:
        return False
    if end_including and _cmp_versions(version, end_including) > 0:
        return False
    if end_excluding and _cmp_versions(version, end_excluding) >= 0:
        return False
    return True


def _components_match(asset: CpeComponents, target: CpeComponents) -> bool:
    """vendor + product equality, with wildcards from the NVD side
    matching anything. Asset side wildcards are treated as no-match
    (we don't want to claim every vendor on a tenant matches)."""
    if target.vendor not in ("*", "-") and asset.vendor != target.vendor:
        return False
    if target.product not in ("*", "-") and asset.product != target.product:
        return False
    return True


def match_cve_to_asset_ids(
    db: Session, *,
    tenant_id: int,
    cve_id: str,
    configurations: List[Dict[str, Any]],
) -> List[int]:
    """Return distinct `asset_id` values whose SoftwareIdentifier rows match
    any `vulnerable=true` cpeMatch entry inside `configurations`.

    Best-effort: never raises. Bad rows just don't match.
    """
    from ..models import SoftwareIdentifier

    if not configurations:
        return []

    # Load every SoftwareIdentifier for this tenant. For larger tenants we
    # could narrow by (vendor, product) inside the loop, but keeping it
    # simple is fine until row counts force a smarter query.
    try:
        rows = (
            db.query(SoftwareIdentifier)
            .filter(SoftwareIdentifier.tenant_id == tenant_id)
            .all()
        )
    except Exception:
        logger.exception("cpe_matcher: SoftwareIdentifier query failed tenant=%s", tenant_id)
        return []

    if not rows:
        return []

    # Pre-parse the inventory once.
    parsed_inventory: List[Tuple[int, CpeComponents, str]] = []  # (asset_id, components, raw_version)
    for r in rows:
        try:
            if r.identifier_type == "cpe":
                comp = parse_cpe(r.identifier)
            elif r.identifier_type == "purl":
                comp = parse_purl(r.identifier)
            else:
                comp = None
            if comp is None:
                continue
            # Prefer the structured columns when set (faster + cleaner).
            if r.vendor:
                comp.vendor = (r.vendor or "").lower()
            if r.product:
                comp.product = (r.product or "").lower()
            if r.version:
                comp.version = (r.version or "").lower()
            parsed_inventory.append((r.asset_id, comp, comp.version))
        except Exception:
            continue

    matched: set = set()
    for cfg in configurations:
        try:
            for node in (cfg.get("nodes") or []):
                self_match = _process_node(node, parsed_inventory)
                matched.update(self_match)
        except Exception:
            logger.debug("cpe_matcher: bad configuration node skipped cve=%s", cve_id)
            continue

    return sorted(matched)


def _process_node(node: Dict[str, Any], parsed_inventory) -> List[int]:
    """Process one NVD config node — returns matching asset ids."""
    out: List[int] = []
    cpe_matches = node.get("cpeMatch") or []
    for cm in cpe_matches:
        if not isinstance(cm, dict):
            continue
        if not cm.get("vulnerable"):
            continue
        target = parse_cpe(cm.get("criteria") or "")
        if target is None:
            continue
        start_inc = cm.get("versionStartIncluding")
        start_exc = cm.get("versionStartExcluding")
        end_inc = cm.get("versionEndIncluding")
        end_exc = cm.get("versionEndExcluding")
        # CPE's own `version` field is itself a range hint — if it's
        # specific (not wildcard) and no explicit start/end bounds were
        # supplied, treat it as an exact-match constraint.
        exact_version = None
        if not target.is_wild_version() and not any(
            (start_inc, start_exc, end_inc, end_exc)
        ):
            exact_version = target.version

        for asset_id, comp, raw_version in parsed_inventory:
            if not _components_match(comp, target):
                continue
            if exact_version:
                if comp.is_wild_version():
                    continue
                if _cmp_versions(raw_version, exact_version) != 0:
                    continue
            else:
                # Range bounds path.
                if comp.is_wild_version() and not target.is_wild_version():
                    # Asset says "any version of this product"; NVD wants a
                    # narrower band. We can't safely claim a match — skip.
                    continue
                if not _version_in_range(
                    raw_version,
                    start_including=start_inc, start_excluding=start_exc,
                    end_including=end_inc, end_excluding=end_exc,
                ):
                    continue
            out.append(asset_id)

    # Walk child nodes for nested AND/OR configurations.
    for child in (node.get("children") or []):
        out.extend(_process_node(child, parsed_inventory))
    return out


def write_auto_links(
    db: Session, *,
    vuln_id: int,
    tenant_id: int,
    asset_ids: List[int],
) -> int:
    """Create `VulnerabilityAssetLink` rows for each unmatched `asset_id`.

    Skips pairs that already have a link (idempotent re-runs). Returns the
    count of new rows added.
    """
    from ..models import VulnerabilityAssetLink

    if not asset_ids:
        return 0

    existing_pairs = set(
        db.query(VulnerabilityAssetLink.asset_id)
        .filter(VulnerabilityAssetLink.vulnerability_id == vuln_id)
        .filter(VulnerabilityAssetLink.asset_id.in_(asset_ids))
        .all()
    )
    existing_ids = {row[0] for row in existing_pairs}

    new_count = 0
    for asset_id in asset_ids:
        if asset_id in existing_ids:
            continue
        try:
            db.add(VulnerabilityAssetLink(
                vulnerability_id=vuln_id,
                asset_id=asset_id,
                link_source="cpe_match",
                auto_linked=True,
            ))
            new_count += 1
        except Exception:
            logger.exception("cpe_matcher: failed to add link vuln=%s asset=%s", vuln_id, asset_id)
    try:
        db.flush()
    except Exception:
        db.rollback()
        logger.exception("cpe_matcher: flush failed")
        return 0
    return new_count
