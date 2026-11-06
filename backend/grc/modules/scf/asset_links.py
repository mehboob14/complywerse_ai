"""SCF Stage F — asset ↔ control links via NormalizedControl bridge.

Canonical link table is ``grc_asset_control_links``
(``AssetControlLink``: ``asset_id`` + ``normalized_control_id`` only).

Reuses Stage E ``ensure_normalized_for_control`` / ``control_status_indicator``.
Per-asset check status is an **indicator only** — never mutates scores.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from grc.models import (
    AssetControlLink,
    AssetExternalIdentity,
    CompliancePluginRun,
    ITAsset,
    NormalizedControl,
    SCFCheckResult,
    SCFScope,
)
from grc.modules.scf.risk_links import (
    control_status_indicator,
    ensure_normalized_for_control,
)
from grc.rich_audit import write_rich_audit_log

_IN_SCOPE_CAP = 200

_STATUS_MAP = {
    "pass": "passed",
    "passed": "passed",
    "fail": "failed",
    "failed": "failed",
    "error": "failed",
    "partial": "partial",
    "not_run": "not_run",
    "not_applicable": "passed",
    "unknown": "unknown",
}


def _normalize_status(raw: Optional[str]) -> str:
    key = (raw or "").strip().lower()
    return _STATUS_MAP.get(key, "unknown")


def _aggregate_statuses(statuses: List[str]) -> str:
    """Reduce a list of raw statuses to passed|failed|partial|not_run|unknown."""
    if not statuses:
        return "not_run"
    normed = {_normalize_status(s) for s in statuses}
    if "failed" in normed:
        if "passed" in normed or "partial" in normed:
            return "partial"
        return "failed"
    if "partial" in normed:
        return "partial"
    if "passed" in normed:
        return "passed"
    if normed <= {"not_run"}:
        return "not_run"
    return "unknown"


def _norm_fw_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")


def _scope_slug_set(scope: SCFScope) -> Set[str]:
    raw = list(scope.framework_slugs or [])
    out: Set[str] = set()
    for slug in raw:
        if not slug:
            continue
        out.add(_norm_fw_token(str(slug)))
        # Also accept display-ish forms (pci_dss ↔ pci-dss ↔ PCI DSS).
        out.add(_norm_fw_token(str(slug).replace("_", "-")))
    try:
        from grc.modules.scf.registry import expand_source_slugs, label_for_slug

        for slug in expand_source_slugs(raw):
            out.add(_norm_fw_token(str(slug)))
        for slug in raw:
            label = label_for_slug(str(slug))
            if label:
                out.add(_norm_fw_token(label))
    except Exception:  # noqa: BLE001 — keep overlap cheap if registry missing
        pass
    out.discard("")
    return out


def _asset_scope_tokens(compliance_scope: Any) -> Set[str]:
    if not compliance_scope:
        return set()
    if isinstance(compliance_scope, str):
        items = [compliance_scope]
    elif isinstance(compliance_scope, (list, tuple, set)):
        items = list(compliance_scope)
    else:
        return set()
    return {_norm_fw_token(str(x)) for x in items if x} - {""}


def _resource_candidates(resource: str) -> List[str]:
    """String heuristics for matching SCFCheckResult.resource to an asset.

    Returns unique candidates in preference order (exact resource first).
    """
    raw = (resource or "").strip()
    if not raw:
        return []
    out: List[str] = [raw]
    # ARN: arn:aws:ec2:region:acct:instance/i-abc
    if raw.lower().startswith("arn:"):
        parts = raw.split(":")
        if len(parts) >= 6:
            resource_part = parts[5]
            # instance/i-xxx or volume/vol-xxx
            if "/" in resource_part:
                out.append(resource_part.split("/", 1)[1])
            out.append(resource_part)
        # aws:ec2:i-xxx style short form from ARN bits
        if len(parts) >= 3:
            svc = parts[2]
            tail = parts[5] if len(parts) > 5 else ""
            short_id = tail.split("/")[-1] if tail else ""
            if svc and short_id:
                out.append(f"aws:{svc}:{short_id}")
    # aws:ec2:i-xxx or aws:s3:bucket
    m = re.match(r"^aws:([a-z0-9-]+):(.+)$", raw, re.IGNORECASE)
    if m:
        out.append(m.group(2).strip())
        out.append(raw)
    # de-dupe preserving order
    seen: Set[str] = set()
    uniq: List[str] = []
    for c in out:
        c = (c or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        uniq.append(c)
    return uniq


def match_asset_by_resource(
    db: Session,
    tenant_id: int,
    resource: str,
) -> Optional[int]:
    """Resolve an asset id from a check ``resource`` string (read-side only)."""
    candidates = _resource_candidates(resource)
    if not candidates:
        return None

    # 1) AssetExternalIdentity.external_id (prefer aws source_system)
    for cand in candidates:
        row = (
            db.query(AssetExternalIdentity.asset_id)
            .filter(
                AssetExternalIdentity.tenant_id == tenant_id,
                AssetExternalIdentity.external_id == cand,
                AssetExternalIdentity.source_system == "aws",
            )
            .first()
        )
        if row is not None:
            return int(row[0] if not isinstance(row, int) else row)

    for cand in candidates:
        row = (
            db.query(AssetExternalIdentity.asset_id)
            .filter(
                AssetExternalIdentity.tenant_id == tenant_id,
                AssetExternalIdentity.external_id == cand,
            )
            .first()
        )
        if row is not None:
            return int(row[0] if not isinstance(row, int) else row)

    # 2) ITAsset.cloud_resource_id / host_name
    for cand in candidates:
        asset = (
            db.query(ITAsset.id)
            .filter(
                ITAsset.tenant_id == tenant_id,
                or_(ITAsset.cloud_resource_id == cand, ITAsset.host_name == cand),
            )
            .first()
        )
        if asset is not None:
            return int(asset[0] if not isinstance(asset, int) else asset)
    return None


def per_asset_check_status(
    db: Session,
    tenant_id: int,
    scf_id: str,
    asset_id: int,
) -> str:
    """Latest status for this control on this asset.

    Prefer SCFCheckResult rows tied to runs for ``asset_id`` (paths 1–2).
    Fall back to resource-string matching (path 3). Never mutates scores.
    """
    code = (scf_id or "").strip()
    if not code or db is None:
        return "unknown"

    # Paths 1–2: check results whose run is pinned to this asset.
    rows = (
        db.query(SCFCheckResult.status, SCFCheckResult.collected_at, SCFCheckResult.check_id)
        .join(
            CompliancePluginRun,
            CompliancePluginRun.id == SCFCheckResult.run_id,
        )
        .filter(
            SCFCheckResult.tenant_id == tenant_id,
            SCFCheckResult.scf_id == code,
            CompliancePluginRun.asset_id == asset_id,
        )
        .order_by(SCFCheckResult.collected_at.desc())
        .all()
    )
    if rows:
        latest: Dict[str, str] = {}
        for status, _collected, check_id in rows:
            key = check_id or "_"
            if key not in latest:
                latest[key] = status or ""
        return _aggregate_statuses(list(latest.values()))

    # Path 3: match resource strings to this asset's identities.
    identities: Set[str] = set()
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id)
        .first()
    )
    if asset is not None:
        for v in (asset.cloud_resource_id, asset.host_name, asset.name):
            if v:
                identities.add(str(v).strip())
    for ext in (
        db.query(AssetExternalIdentity.external_id)
        .filter(
            AssetExternalIdentity.tenant_id == tenant_id,
            AssetExternalIdentity.asset_id == asset_id,
        )
        .all()
    ):
        val = ext[0] if not isinstance(ext, str) else ext
        if val:
            identities.add(str(val).strip())

    if not identities:
        return "not_run"

    # Pull recent results for this control and match resource → asset.
    recent = (
        db.query(
            SCFCheckResult.status,
            SCFCheckResult.resource,
            SCFCheckResult.check_id,
            SCFCheckResult.collected_at,
        )
        .filter(
            SCFCheckResult.tenant_id == tenant_id,
            SCFCheckResult.scf_id == code,
            SCFCheckResult.resource.isnot(None),
        )
        .order_by(SCFCheckResult.collected_at.desc())
        .limit(200)
        .all()
    )
    matched: Dict[str, str] = {}
    for status, resource, check_id, _collected in recent:
        cands = set(_resource_candidates(resource or ""))
        if not (cands & identities):
            # Also accept if resource resolves to this asset_id
            resolved = match_asset_by_resource(db, tenant_id, resource or "")
            if resolved != asset_id:
                continue
        key = check_id or (resource or "_")
        if key not in matched:
            matched[key] = status or ""

    if matched:
        return _aggregate_statuses(list(matched.values()))
    return "not_run"


def _check_detail_for_asset(
    db: Session,
    tenant_id: int,
    scf_id: str,
    asset_id: int,
) -> Optional[str]:
    """Best-effort latest detail string for UI; never raises."""
    try:
        row = (
            db.query(SCFCheckResult.detail)
            .join(
                CompliancePluginRun,
                CompliancePluginRun.id == SCFCheckResult.run_id,
            )
            .filter(
                SCFCheckResult.tenant_id == tenant_id,
                SCFCheckResult.scf_id == scf_id,
                CompliancePluginRun.asset_id == asset_id,
            )
            .order_by(SCFCheckResult.collected_at.desc())
            .first()
        )
        if row and row[0]:
            return str(row[0])[:500]
    except Exception:  # noqa: BLE001
        return None
    return None


def list_assets_for_control(
    db: Session,
    tenant_id: int,
    scf_id: str,
) -> List[Dict[str, Any]]:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    rows = (
        db.query(AssetControlLink)
        .options(joinedload(AssetControlLink.asset))
        .join(ITAsset, ITAsset.id == AssetControlLink.asset_id)
        .filter(
            AssetControlLink.normalized_control_id == nc.id,
            ITAsset.tenant_id == tenant_id,
        )
        .all()
    )
    out: List[Dict[str, Any]] = []
    for link in rows:
        asset = link.asset
        if asset is None:
            continue
        check_status = per_asset_check_status(db, tenant_id, scf_id, asset.id)
        item: Dict[str, Any] = {
            "link_id": link.id,
            "asset_id": asset.id,
            "name": asset.name,
            "asset_type": getattr(asset, "asset_type", None),
            "status": getattr(asset, "status", None),
            "criticality": getattr(asset, "criticality", None),
            "check_status": check_status,
        }
        detail = _check_detail_for_asset(db, tenant_id, scf_id, asset.id)
        if detail:
            item["check_detail"] = detail
        out.append(item)
    return out


def link_asset(
    db: Session,
    tenant_id: int,
    scf_id: str,
    asset_id: int,
    actor_id: Optional[int],
) -> AssetControlLink:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id)
        .first()
    )
    if asset is None:
        raise ValueError(f"Asset {asset_id} not found for tenant")

    existing = (
        db.query(AssetControlLink)
        .filter(
            AssetControlLink.asset_id == asset_id,
            AssetControlLink.normalized_control_id == nc.id,
        )
        .first()
    )
    if existing is not None:
        return existing

    link = AssetControlLink(asset_id=asset_id, normalized_control_id=nc.id)
    db.add(link)
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="asset_control_link",
        resource_type="asset_control_link",
        resource_id=link.id,
        resource_name=scf_id,
        summary=f"Linked asset {asset_id} to control {scf_id}",
        after={"asset_id": asset_id, "normalized_control_id": nc.id, "scf_id": scf_id},
    )
    return link


def unlink_asset(
    db: Session,
    tenant_id: int,
    scf_id: str,
    link_id: int,
    actor_id: Optional[int] = None,
) -> None:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    link = (
        db.query(AssetControlLink)
        .join(ITAsset, ITAsset.id == AssetControlLink.asset_id)
        .filter(
            AssetControlLink.id == link_id,
            AssetControlLink.normalized_control_id == nc.id,
            ITAsset.tenant_id == tenant_id,
        )
        .first()
    )
    if link is None:
        raise ValueError(f"Link {link_id} not found for control {scf_id}")

    asset_id = link.asset_id
    db.delete(link)
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="asset_control_unlink",
        resource_type="asset_control_link",
        resource_id=link_id,
        resource_name=scf_id,
        summary=f"Unlinked asset {asset_id} from control {scf_id}",
        before={"asset_id": asset_id, "normalized_control_id": nc.id, "scf_id": scf_id},
    )


def in_scope_assets(
    db: Session,
    tenant_id: int,
    scope: Optional[SCFScope],
) -> List[Dict[str, Any]]:
    """Assets whose compliance_scope overlaps scope frameworks, plus untagged.

    Untagged (empty/null compliance_scope) included with ``in_scope_tag=False``.
    If scope has no frameworks, return ``[]``. Cap 200.
    """
    if scope is None:
        return []
    slugs = list(scope.framework_slugs or [])
    if not slugs:
        return []

    slug_set = _scope_slug_set(scope)
    assets = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tenant_id)
        .order_by(ITAsset.id.asc())
        .limit(2000)  # soft pre-filter before overlap; final cap below
        .all()
    )
    out: List[Dict[str, Any]] = []
    for asset in assets:
        tokens = _asset_scope_tokens(getattr(asset, "compliance_scope", None))
        if not tokens:
            tagged = False
        elif tokens & slug_set:
            tagged = True
        else:
            continue
        out.append({
            "asset_id": asset.id,
            "name": asset.name,
            "asset_type": getattr(asset, "asset_type", None),
            "status": getattr(asset, "status", None),
            "criticality": getattr(asset, "criticality", None),
            "compliance_scope": list(getattr(asset, "compliance_scope", None) or []),
            "in_scope_tag": tagged,
        })
        if len(out) >= _IN_SCOPE_CAP:
            break
    return out


def list_controls_for_asset(
    db: Session,
    tenant_id: int,
    asset_id: int,
) -> List[Dict[str, Any]]:
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id)
        .first()
    )
    if asset is None:
        raise ValueError(f"Asset {asset_id} not found for tenant")

    rows = (
        db.query(AssetControlLink)
        .options(joinedload(AssetControlLink.normalized_control))
        .filter(AssetControlLink.asset_id == asset_id)
        .all()
    )
    out: List[Dict[str, Any]] = []
    for link in rows:
        nc: Optional[NormalizedControl] = link.normalized_control
        if nc is None:
            nc = (
                db.query(NormalizedControl)
                .filter(NormalizedControl.id == link.normalized_control_id)
                .first()
            )
        if nc is None:
            continue
        scf_key = getattr(nc, "scf_id", None) or getattr(nc, "code", None) or ""
        custom = (getattr(nc, "source", None) or "") == "custom"
        out.append({
            "link_id": link.id,
            "normalized_control_id": nc.id,
            "scf_id": getattr(nc, "scf_id", None),
            "code": nc.code,
            "name": nc.name,
            "source": getattr(nc, "source", None),
            "custom": custom,
            "control_status": control_status_indicator(db, nc, tenant_id=tenant_id),
            "check_status": per_asset_check_status(db, tenant_id, str(scf_key), asset_id)
            if scf_key
            else "unknown",
            "control_status_indicator": True,
        })
    return out
