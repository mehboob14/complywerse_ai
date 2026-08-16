"""Backfill — link scanner findings to the assets they were found on, by host.

Nessus stamps every finding with ``affected_host`` (the host it was detected on)
and, separately, creates asset rows carrying ``host_name`` / ``ip_address`` /
``fqdn``. The live sync links the two ONLY when a per-connection ``link_assets``
toggle is on AND the host resolved to an asset in the very same pass — so
historically-imported findings routinely sit UNLINKED. An unlinked finding is
not cosmetic: the per-host score reads its internet-exposure as 0/10 and its
asset-criticality as "assumed medium", and a CTEM scope (which resolves through
asset links) can't see it at all. That is the single biggest reason the data
looks thin.

This service closes the gap independently of the sync: match a finding's
``affected_host`` to an asset by its identity fields and create the link.

Matching is deliberately conservative — exact on the clean identity fields
(host_name / ip / fqdn), then a guarded substring fallback on the display name
(so "DESKTOP-CE3EFJB" still matches an asset named "PostgreSQL 18 @
DESKTOP-CE3EFJB"), never a loose token match that could attach a finding to the
wrong box. Idempotent (one link per vuln×asset, guarded by the unique index and
an explicit existence check); the caller owns the commit unless ``commit=True``.
"""

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

# A host token shorter than this is too ambiguous for the substring fallback
# ("db", "01") — exact-match only below it.
_MIN_FALLBACK_LEN = 4


def _norm(v: Optional[str]) -> Optional[str]:
    return v.strip().lower() if isinstance(v, str) and v.strip() else None


def _build_asset_index(db: Session, tenant_id: int) -> Tuple[Dict[str, int], List[Tuple[str, int]], int]:
    """(exact-identity → asset_id, [(normalized_name, asset_id)], asset_count).

    Identity keys (host_name / ip / fqdn / name) map to the FIRST asset that
    claims them — deterministic given a stable asset ordering, and duplicate
    identities across assets are a data problem this backfill shouldn't paper
    over by guessing."""
    from ..models import ITAsset
    exact: Dict[str, int] = {}
    names: List[Tuple[str, int]] = []
    rows = db.query(
        ITAsset.id, ITAsset.host_name, ITAsset.name, ITAsset.ip_address, ITAsset.fqdn,
    ).filter(ITAsset.tenant_id == tenant_id).order_by(ITAsset.id.asc()).all()
    for a in rows:
        for ident in (a.host_name, a.ip_address, a.fqdn):
            k = _norm(ident)
            if k and k not in exact:
                exact[k] = a.id
        n = _norm(a.name)
        if n:
            exact.setdefault(n, a.id)
            names.append((n, a.id))
    return exact, names, len(rows)


def _match(host: str, exact: Dict[str, int], names: List[Tuple[str, int]]) -> Optional[int]:
    aid = exact.get(host)
    if aid is not None:
        return aid
    if len(host) >= _MIN_FALLBACK_LEN:
        for name, asset_id in names:
            if host in name:        # asset display name contains the host token
                return asset_id
    return None


def backfill_host_links(db: Session, tenant_id: int, *, commit: bool = False) -> Dict[str, Any]:
    """Link every unlinked finding to the asset its ``affected_host`` names.

    Returns a report: assets seen, findings carrying a host, how many matched,
    how many were newly linked vs already linked, and how many hosts matched no
    asset (surfaced honestly, never silently dropped). ``commit=False`` (default)
    computes + stages the links for the caller to commit; ``commit=True`` is the
    one-shot convenience for a script/endpoint."""
    from ..models import Vulnerability, VulnerabilityAssetLink
    exact, names, n_assets = _build_asset_index(db, tenant_id)
    report: Dict[str, Any] = {
        "assets": n_assets, "findings_with_host": 0, "matched": 0,
        "newly_linked": 0, "already_linked": 0, "unmatched": 0,
    }
    if not exact:
        return report

    findings = db.query(Vulnerability.id, Vulnerability.affected_host).filter(
        Vulnerability.tenant_id == tenant_id,
        Vulnerability.affected_host.isnot(None),
    ).all()
    for f in findings:
        host = _norm(f.affected_host)
        if not host:
            continue
        report["findings_with_host"] += 1
        asset_id = _match(host, exact, names)
        if asset_id is None:
            report["unmatched"] += 1
            continue
        report["matched"] += 1
        exists = db.query(VulnerabilityAssetLink.id).filter(
            VulnerabilityAssetLink.vulnerability_id == f.id,
            VulnerabilityAssetLink.asset_id == asset_id,
        ).first()
        if exists:
            report["already_linked"] += 1
            continue
        db.add(VulnerabilityAssetLink(
            vulnerability_id=f.id, asset_id=asset_id,
            notes="Auto-linked by host-name match (backfill)",
            link_source="host_match", auto_linked=True,
        ))
        report["newly_linked"] += 1

    if commit:
        db.commit()
    return report
