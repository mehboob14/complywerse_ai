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

Matching, most-specific first, and NEVER a guess:
  1. EXACT on a clean identity field (host_name / ip / fqdn / name).
  2. NESSUS-ID RECOMPUTE — Nessus stores ``affected_host`` as a one-way hash of
     the host (``nessus-<sha>``), matched to the asset's ``external_asset_id``.
     When the asset that minted that id is deleted and a DIFFERENT asset now
     represents the same host, the hash points nowhere and can't be reversed. So
     we recompute that hash from each LIVE asset's name/ip and match on it — the
     only re-association possible without storing the raw host on the finding.
  3. Guarded substring on the display name (so "DESKTOP-CE3EFJB" still matches an
     asset named "PostgreSQL 18 @ DESKTOP-CE3EFJB").

Two hosts can genuinely share a name/ip, so any identity claimed by more than one
asset is AMBIGUOUS and is refused outright — a finding is never attached to
whichever box sorted first. Idempotent (one link per vuln×asset, guarded by the
unique index and an explicit existence check); the caller owns the commit unless
``commit=True``.
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

# A host token shorter than this is too ambiguous for the substring fallback
# ("db", "01") — exact-match only below it.
_MIN_FALLBACK_LEN = 4

# Sentinel for an identity claimed by 2+ assets — the matcher refuses it.
_AMBIGUOUS = object()


def _norm(v: Optional[str]) -> Optional[str]:
    return v.strip().lower() if isinstance(v, str) and v.strip() else None


def _nessus_ids_for(host_name: Optional[str], ip: Optional[str], tenant_id: int) -> Set[str]:
    """Every ``nessus-<hash>`` id a Nessus finding scanned on THIS asset could
    carry. Mirrors ``NessusTransformer._stable_asset_id`` (key = name-or-ip),
    computing BOTH the name-keyed and ip-keyed variants (a scan with no resolved
    name keys on ip). Degrades to empty if the transformer can't be imported, so
    this optional path never crashes the backfill."""
    ids: Set[str] = set()
    try:
        from ..modules.integrations.adapters.nessus_transformer import NessusTransformer
        sid = NessusTransformer._stable_asset_id
    except Exception:  # noqa: BLE001 — recompute is best-effort enrichment
        return ids
    hn = (host_name or "").strip()
    ip_ = (ip or "").strip()
    if hn:
        ids.add(sid(hn, ip_, tenant_id))
    if ip_:
        ids.add(sid("", ip_, tenant_id))
    return {i.lower() for i in ids if i}


def _index_put(idx: Dict[str, Any], key: Optional[str], asset_id: int) -> None:
    """Map identity->asset, flipping it to AMBIGUOUS if a DIFFERENT asset already
    claims it (two hosts can share a name/ip — we must not pick one)."""
    if not key:
        return
    if key in idx and idx[key] != asset_id:
        idx[key] = _AMBIGUOUS
    else:
        idx.setdefault(key, asset_id)


def _build_asset_index(
    db: Session, tenant_id: int
) -> Tuple[Dict[str, Any], List[Tuple[str, int]], Dict[str, Set[int]], int]:
    """(exact identity -> asset_id|AMBIGUOUS, [(name, asset_id)],
        nessus_id -> {asset_ids}, asset_count)."""
    from ..models import ITAsset
    exact: Dict[str, Any] = {}
    names: List[Tuple[str, int]] = []
    nessus: Dict[str, Set[int]] = {}
    rows = db.query(
        ITAsset.id, ITAsset.host_name, ITAsset.name, ITAsset.ip_address, ITAsset.fqdn,
    ).filter(ITAsset.tenant_id == tenant_id).order_by(ITAsset.id.asc()).all()
    for a in rows:
        for ident in (a.host_name, a.ip_address, a.fqdn):
            _index_put(exact, _norm(ident), a.id)
        n = _norm(a.name)
        if n:
            _index_put(exact, n, a.id)
            names.append((n, a.id))
        for sid in _nessus_ids_for(a.host_name, a.ip_address, tenant_id):
            nessus.setdefault(sid, set()).add(a.id)
    return exact, names, nessus, len(rows)


def _match(host: str, exact: Dict[str, Any], names: List[Tuple[str, int]],
           nessus: Dict[str, Set[int]]) -> Tuple[Optional[int], str]:
    """(asset_id, reason). reason: exact | nessus | name | ambiguous | none.
    2+ candidate assets always returns (None, "ambiguous") — never a guess."""
    aid = exact.get(host)
    if aid is _AMBIGUOUS:
        return None, "ambiguous"
    if aid is not None:
        return aid, "exact"
    if host.startswith("nessus-"):
        cands = nessus.get(host)
        if cands:
            return (next(iter(cands)), "nessus") if len(cands) == 1 else (None, "ambiguous")
    if len(host) >= _MIN_FALLBACK_LEN:
        hits = {asset_id for name, asset_id in names if host in name}
        if len(hits) == 1:
            return next(iter(hits)), "name"
        if len(hits) > 1:
            return None, "ambiguous"
    return None, "none"


def _match_by_identity(host_identity: Any, exact: Dict[str, Any],
                       names: List[Tuple[str, int]]) -> Tuple[Optional[int], str]:
    """Fallback when ``affected_host`` (the scanner's opaque hash id) didn't
    resolve: match on the finding's REAL ``host_identity`` — the {host_name, ip}
    the sync stamps alongside the hash (see Vulnerability.host_identity). This is
    the single biggest reason findings sit unlinked: the hash no longer maps to
    an asset, but the real host is right there on the finding. Same never-guess
    rule — an identity claimed by 2+ assets returns (None, 'ambiguous')."""
    if not isinstance(host_identity, dict):
        return None, "none"
    for raw in (host_identity.get("host_name"), host_identity.get("ip"),
                host_identity.get("ip_address"), host_identity.get("fqdn")):
        n = _norm(raw)
        if not n:
            continue
        aid = exact.get(n)
        if aid is _AMBIGUOUS:
            return None, "ambiguous"
        if aid is not None:
            return aid, "identity"
    hn = _norm(host_identity.get("host_name"))
    if hn and len(hn) >= _MIN_FALLBACK_LEN:
        hits = {asset_id for name, asset_id in names if hn in name or name in hn}
        if len(hits) == 1:
            return next(iter(hits)), "identity_name"
        if len(hits) > 1:
            return None, "ambiguous"
    return None, "none"


def backfill_host_links(db: Session, tenant_id: int, *, commit: bool = False,
                        assign_unmatched_to_asset_id: Optional[int] = None) -> Dict[str, Any]:
    """Link every unlinked finding to the asset its ``affected_host`` names.

    Returns a report: assets seen, findings carrying a host, matched, newly
    linked vs already linked, unmatched (no asset), ambiguous (2+ candidate
    assets — refused), and assigned-unmatched.

    ``assign_unmatched_to_asset_id`` is the human-in-the-loop escape hatch for
    findings whose host matches NO asset (the opaque-Nessus-key case): the
    operator names the asset those findings belong to and they are linked there
    with ``link_source=manual_bulk``. It applies to UNMATCHED findings only —
    AMBIGUOUS ones (a host shared by 2+ assets) are left for a per-finding human
    decision, never blanket-assigned. The target must be a real asset in this
    tenant or it is ignored (never links to a stranger)."""
    from ..models import Vulnerability, VulnerabilityAssetLink, ITAsset
    exact, names, nessus, n_assets = _build_asset_index(db, tenant_id)
    report: Dict[str, Any] = {
        "assets": n_assets, "findings_with_host": 0, "matched": 0,
        "matched_via_identity": 0, "newly_linked": 0, "already_linked": 0,
        "unmatched": 0, "ambiguous": 0, "assigned_unmatched": 0,
    }
    if not exact and not nessus:
        return report

    # Validate the override target belongs to this tenant before trusting it.
    override_id = None
    if assign_unmatched_to_asset_id is not None:
        ok = db.query(ITAsset.id).filter(
            ITAsset.id == assign_unmatched_to_asset_id,
            ITAsset.tenant_id == tenant_id,
        ).first()
        override_id = assign_unmatched_to_asset_id if ok else None

    from sqlalchemy import or_
    findings = db.query(
        Vulnerability.id, Vulnerability.affected_host, Vulnerability.host_identity
    ).filter(
        Vulnerability.tenant_id == tenant_id,
        or_(Vulnerability.affected_host.isnot(None),
            Vulnerability.host_identity.isnot(None)),
    ).all()
    for f in findings:
        host = _norm(f.affected_host)
        asset_id, reason = None, "none"
        if host:
            report["findings_with_host"] += 1
            asset_id, reason = _match(host, exact, names, nessus)
        # The scanner's affected_host is often an opaque hash that no longer maps
        # to an asset — fall back to the finding's REAL host_identity.
        if asset_id is None and reason != "ambiguous":
            aid2, reason2 = _match_by_identity(f.host_identity, exact, names)
            if aid2 is not None:
                asset_id, reason = aid2, reason2
            elif reason2 == "ambiguous":
                reason = "ambiguous"
        if asset_id is None:
            if reason == "ambiguous":
                report["ambiguous"] += 1
                continue                       # 2+ candidate hosts — never guess
            report["unmatched"] += 1
            if override_id is None:
                continue
            asset_id, source = override_id, "manual_bulk"
            report["assigned_unmatched"] += 1
        else:
            report["matched"] += 1
            if reason in ("identity", "identity_name"):
                report["matched_via_identity"] += 1
            source = "identity_match" if reason in ("identity", "identity_name") else "host_match"
        exists = db.query(VulnerabilityAssetLink.id).filter(
            VulnerabilityAssetLink.vulnerability_id == f.id,
            VulnerabilityAssetLink.asset_id == asset_id,
        ).first()
        if exists:
            report["already_linked"] += 1
            continue
        db.add(VulnerabilityAssetLink(
            vulnerability_id=f.id, asset_id=asset_id,
            notes=("Bulk-assigned to this asset by an operator (orphaned scanner host)"
                   if source == "manual_bulk"
                   else "Auto-linked by host match (backfill)"),
            link_source=source, auto_linked=True,
        ))
        report["newly_linked"] += 1

    if commit:
        db.commit()
    return report
