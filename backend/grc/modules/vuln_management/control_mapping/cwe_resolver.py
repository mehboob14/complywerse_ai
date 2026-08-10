"""Resolve a CWE to the tenant's framework controls + write links.

**Target tables.** This codebase has two parallel framework-control storage
systems:

  * `Framework` / `ControlObjective` / `FrameworkDomain` / `FrameworkControl`
    — the legacy hierarchy, populated by the older `seed_frameworks()` path.
  * `UploadedFramework` / `ParsedFrameworkControl` — the upload-driven
    seed path (`python -m grc.seed_frameworks --all-tenants`). This is
    where the 27 seeded frameworks (PCI, ISO 27001, HITRUST, etc.) actually
    live in every active tenant DB; the legacy tables are typically empty.

The auto-mapper writes against `ParsedFrameworkControl` because that's
where the data is. Writes go into `VulnerabilityControlLink.parsed_framework_control_id`
(new column); the legacy `framework_control_id` column is left untouched
so manual links targeting legacy controls keep working.

Two public functions:

  * `resolve_cwe_to_framework_controls(...)` — pure, side-effect-free.
    Returns the `ParsedFrameworkControl` rows that match the CWE's identifier
    list for this tenant. Each row carries `.uploaded_framework_id` plus
    the joined `UploadedFramework.short_code` / `name` for the response.

  * `auto_map_compliance_controls(vuln, db)` — writer. Creates
    `VulnerabilityControlLink` rows for every matched control, tagged
    with a `notes` marker so re-runs only delete their own rows.

Critical invariants the writer maintains:

  1. Existing manual links (rows whose `notes` doesn't start with
     `auto:cwe:`) are never touched — no delete, no update.
  2. A `(vulnerability_id, parsed_framework_control_id)` pair is unique
     in spirit (no DB constraint; we enforce in code). Skip writing when
     a row exists, regardless of who created it.
  3. On a CWE change, stale auto rows are removed and fresh ones added,
     but only auto rows.
  4. Failure inside the writer is logged and swallowed — never raised.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ....config import REDIS_URL
from ....models import (
    CweControlOverride,
    ParsedFrameworkControl, UploadedFramework,
    Vulnerability, VulnerabilityControlLink,
)
from .cwe_control_map import (
    ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION,
    ALWAYS_APPLICABLE_VULN_MGMT,
    lookup_cwe,
    normalise_cwe,
)

# Sentinel CWE-IDs that target the always-applicable rule sets in the
# override table. Operators can add or remove identifiers from these
# baselines using these sentinels.
SENTINEL_VULN_MGMT = "__vuln_mgmt__"
SENTINEL_KEV = "__kev__"

logger = logging.getLogger(__name__)

AUTO_LINK_NOTES_PREFIX = "auto:cwe:"
MAX_CONTROLS_PER_VULN = 20
RESOLVE_CACHE_TTL_SECONDS = 60 * 60  # 1h


@dataclass
class ResolvedControl:
    """A single matched control plus the framework metadata callers need.

    We don't return raw `ParsedFrameworkControl` rows because the writer
    + the response builder both need the parent framework's short_code
    and name to render badges / build the response shape.
    """
    parsed_control_id: int
    control_id: str           # e.g. "6.5.1", "A.14.2.5"
    title: Optional[str]
    uploaded_framework_id: int
    framework_short_code: Optional[str]
    framework_name: Optional[str]


def invalidate_tenant_cache(tenant_id: int) -> int:
    """Drop every cached resolver result for the tenant. Called by override
    CRUD so freshly-mutated tenant overrides take effect within seconds
    instead of the next 1-hour TTL boundary.

    Returns the number of keys deleted (0 when Redis is unreachable).
    """
    rc = _redis_client()
    if rc is None:
        return 0
    try:
        pattern = f"cwe_control_resolve_pfc:{tenant_id}:*"
        keys = list(rc.scan_iter(match=pattern))
        if keys:
            rc.delete(*keys)
        return len(keys)
    except Exception:
        logger.exception("CWE resolver: cache invalidation failed for tenant %s", tenant_id)
        return 0


def _redis_client():
    try:
        import redis  # type: ignore
    except Exception:
        return None
    url = REDIS_URL
    try:
        return redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _cache_key(tenant_id: int, cwe_id: str, has_cve: bool, is_kev: bool) -> str:
    return f"cwe_control_resolve_pfc:{tenant_id}:{cwe_id}:{int(has_cve)}:{int(is_kev)}"


def _normalise_short_code(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(c for c in value.upper() if c.isalnum())


def _normalise_code(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.lower().strip()


def _derive_short_code(name: Optional[str]) -> str:
    """`UploadedFramework` doesn't always have a populated short_code field,
    so derive one from the name when needed (alnum-only, uppercased)."""
    return _normalise_short_code(name)


def _framework_matches(haystacks: List[str], prefix: str) -> bool:
    """Loose framework match — true when the (normalised) prefix appears
    in any of the framework's normalised identifying strings (short_code,
    name). This is intentionally permissive so seed-file formatting drift
    doesn't break matches.

    Special handling for ISO/IEC: we also strip the literal "IEC" token
    from the haystack and retry, so a prefix like "ISO27001" matches the
    seeded "ISO/IEC 27001:2022" framework (which normalises to
    "ISOIEC270012022"). Same trick is harmless for non-ISO frameworks
    because they don't contain "IEC".
    """
    if not prefix:
        return False
    needle = _normalise_short_code(prefix)
    if not needle:
        return False
    for h in haystacks:
        normalised = _normalise_short_code(h)
        if needle in normalised:
            return True
        # ISO/IEC handling: try with the "IEC" infix removed.
        if "IEC" in normalised:
            if needle in normalised.replace("IEC", ""):
                return True
    return False


def _control_matches(haystacks: List[str], pattern: str) -> bool:
    """Case-insensitive substring match on any of the control's identifying
    strings (control_id, original_reference)."""
    if not pattern:
        return False
    needle = _normalise_code(pattern)
    if not needle:
        return False
    for h in haystacks:
        if needle in _normalise_code(h):
            return True
    return False


def _fetch_tenant_overrides(
    db: Session, tenant_id: int, cwe_keys: List[str],
) -> dict[str, List[Tuple[str, str, str]]]:
    """Pull all overrides for the tenant matching the requested CWE keys.

    Returns ``{cwe_id: [(framework_prefix, pattern, action), ...]}``.
    Empty dict on DB hiccup (overrides are optional — never break the
    resolver because of a query error).
    """
    if not cwe_keys:
        return {}
    try:
        rows = (
            db.query(
                CweControlOverride.cwe_id,
                CweControlOverride.framework_prefix,
                CweControlOverride.control_code_pattern,
                CweControlOverride.action,
            )
            .filter(
                CweControlOverride.tenant_id == tenant_id,
                CweControlOverride.cwe_id.in_(cwe_keys),
            )
            .all()
        )
    except Exception:
        logger.exception("CWE resolver: tenant-override fetch failed for tenant %s", tenant_id)
        return {}
    out: dict[str, List[Tuple[str, str, str]]] = {}
    for cwe, prefix, pattern, action in rows:
        out.setdefault(cwe, []).append((prefix, pattern, (action or "add").lower()))
    return out


def _build_identifier_list(
    cwe_id: str,
    has_cve: bool,
    is_kev: bool,
    db: Optional[Session] = None,
    tenant_id: Optional[int] = None,
) -> List[Tuple[str, str]]:
    """Combine the CWE-specific defaults, always-applicable rules, and
    per-tenant overrides into the final identifier list.

    Tenant overrides:
      - ``action=add``    appends to the relevant CWE / sentinel list
      - ``action=remove`` filters matching entries out of the defaults
    """
    seen: set = set()
    out: List[Tuple[str, str]] = []

    def _add_pair(prefix: str, pattern: str) -> None:
        key = (prefix.upper(), pattern.upper())
        if key in seen:
            return
        seen.add(key)
        out.append((prefix, pattern))

    # Step 1 — pull tenant overrides for the keys we'll consult.
    override_keys: List[str] = []
    if cwe_id:
        override_keys.append(cwe_id)
    if has_cve:
        override_keys.append(SENTINEL_VULN_MGMT)
    if is_kev:
        override_keys.append(SENTINEL_KEV)
    overrides: dict[str, List[Tuple[str, str, str]]] = {}
    if db is not None and tenant_id is not None and override_keys:
        overrides = _fetch_tenant_overrides(db, tenant_id, override_keys)

    def _removed_set(key: str) -> set:
        return {
            (p.upper(), c.upper())
            for p, c, act in overrides.get(key, [])
            if act == "remove"
        }

    def _added_list(key: str) -> List[Tuple[str, str]]:
        return [
            (p, c)
            for p, c, act in overrides.get(key, [])
            if act != "remove"
        ]

    # Step 2 — CWE-specific defaults minus tenant `remove`s, plus `add`s.
    if cwe_id:
        removed = _removed_set(cwe_id)
        for prefix, pattern in lookup_cwe(cwe_id):
            if (prefix.upper(), pattern.upper()) in removed:
                continue
            _add_pair(prefix, pattern)
        for prefix, pattern in _added_list(cwe_id):
            _add_pair(prefix, pattern)

    # Step 3 — always-applicable vuln-mgmt rules.
    if has_cve:
        removed = _removed_set(SENTINEL_VULN_MGMT)
        for prefix, pattern in ALWAYS_APPLICABLE_VULN_MGMT:
            if (prefix.upper(), pattern.upper()) in removed:
                continue
            _add_pair(prefix, pattern)
        for prefix, pattern in _added_list(SENTINEL_VULN_MGMT):
            _add_pair(prefix, pattern)

    # Step 4 — always-applicable active-exploitation rules.
    if is_kev:
        removed = _removed_set(SENTINEL_KEV)
        for prefix, pattern in ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION:
            if (prefix.upper(), pattern.upper()) in removed:
                continue
            _add_pair(prefix, pattern)
        for prefix, pattern in _added_list(SENTINEL_KEV):
            _add_pair(prefix, pattern)

    return out


def resolve_cwe_to_framework_controls(
    db: Session,
    tenant_id: int,
    cwe_id: Optional[str],
    has_cve: bool = False,
    is_kev: bool = False,
) -> List[ResolvedControl]:
    """Return the parsed-framework controls this CWE maps to for the tenant.

    Walks the (active) UploadedFrameworks visible to this tenant — own +
    shared — joined to their ParsedFrameworkControls, then filters in
    Python against the identifier list. Cached per-tenant in Redis for 1h.
    """
    cwe_key = normalise_cwe(cwe_id) if cwe_id else ""
    if not (cwe_key or has_cve or is_kev):
        return []

    identifiers = _build_identifier_list(cwe_key, has_cve, is_kev, db=db, tenant_id=tenant_id)
    if not identifiers:
        return []

    rc = _redis_client()
    cache_key = _cache_key(tenant_id, cwe_key or "_", has_cve, is_kev)
    cached_ids: Optional[List[int]] = None
    if rc is not None:
        try:
            raw = rc.get(cache_key)
            if raw:
                cached_ids = list(json.loads(raw))
        except Exception:
            cached_ids = None

    # Live query — every active framework visible to this tenant (own +
    # shared) joined to its parsed controls. The cross-table join is the
    # expensive part; we only do it on cache miss.
    try:
        from sqlalchemy import or_
        rows = (
            db.query(
                ParsedFrameworkControl.id,
                ParsedFrameworkControl.control_id,
                ParsedFrameworkControl.original_reference,
                ParsedFrameworkControl.title,
                UploadedFramework.id.label("ufw_id"),
                UploadedFramework.name.label("ufw_name"),
            )
            .join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id)
            .filter(
                UploadedFramework.is_active == True,  # noqa: E712
                or_(
                    UploadedFramework.tenant_id == tenant_id,
                    UploadedFramework.is_shared == True,  # noqa: E712
                ),
            )
            .all()
        )
    except Exception:
        logger.exception("CWE resolver: live query failed for tenant %s", tenant_id)
        return []

    matched: List[ResolvedControl] = []
    matched_ids: List[int] = []
    seen_ids: set = set()
    for pfc_id, ctl_id, orig_ref, title, ufw_id, ufw_name in rows:
        if pfc_id in seen_ids:
            continue
        framework_haystacks = [ufw_name or ""]
        control_haystacks = [ctl_id or "", orig_ref or ""]
        for prefix, pattern in identifiers:
            if _framework_matches(framework_haystacks, prefix) and _control_matches(control_haystacks, pattern):
                matched.append(ResolvedControl(
                    parsed_control_id=pfc_id,
                    control_id=ctl_id or orig_ref or "",
                    title=title,
                    uploaded_framework_id=ufw_id,
                    framework_short_code=_derive_short_code(ufw_name),
                    framework_name=ufw_name,
                ))
                matched_ids.append(pfc_id)
                seen_ids.add(pfc_id)
                break
        if len(matched) >= MAX_CONTROLS_PER_VULN:
            break

    # If a cache hit's IDs no longer exist (e.g. the framework was
    # re-seeded), we won't use them — the live query above re-derives.
    if cached_ids and not matched:
        # Replay path — fetch by cached IDs to skip the re-filter when
        # frameworks haven't changed.
        try:
            rep_rows = (
                db.query(
                    ParsedFrameworkControl.id,
                    ParsedFrameworkControl.control_id,
                    ParsedFrameworkControl.original_reference,
                    ParsedFrameworkControl.title,
                    UploadedFramework.id.label("ufw_id"),
                    UploadedFramework.name.label("ufw_name"),
                )
                .join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id)
                .filter(ParsedFrameworkControl.id.in_(cached_ids))
                .all()
            )
            if rep_rows:
                matched = [
                    ResolvedControl(
                        parsed_control_id=pfc_id, control_id=ctl_id or orig_ref or "",
                        title=title, uploaded_framework_id=ufw_id,
                        framework_short_code=_derive_short_code(ufw_name),
                        framework_name=ufw_name,
                    )
                    for pfc_id, ctl_id, orig_ref, title, ufw_id, ufw_name in rep_rows
                ][:MAX_CONTROLS_PER_VULN]
        except Exception:
            logger.exception("CWE resolver: cache replay failed for %s", cache_key)

    if rc is not None and matched_ids:
        try:
            rc.set(cache_key, json.dumps(matched_ids), ex=RESOLVE_CACHE_TTL_SECONDS)
        except Exception:
            pass

    return matched


def _vuln_status_to_impact(status: Optional[str]) -> str:
    s = (status or "").lower()
    if s in ("resolved", "remediated", "verified", "closed", "false_positive"):
        return "partial"
    return "at_risk"


def auto_map_compliance_controls(
    vuln: Vulnerability,
    db: Session,
    *,
    delete_stale: bool = True,
    user_id: Optional[int] = None,
) -> dict:
    """Find or create auto-mapped links for this vuln.

    Writes against `VulnerabilityControlLink.parsed_framework_control_id`
    because that's the table where seeded frameworks live for upload-
    driven tenants.

    Returns a small summary dict for the UI:
        {
            "matched_controls": int,
            "added": int,
            "kept": int,
            "removed_stale": int,
            "errors": [str, ...],
        }
    """
    summary: dict = {
        "matched_controls": 0,
        "added": 0,
        "kept": 0,
        "removed_stale": 0,
        "errors": [],
    }

    try:
        cwe_id = normalise_cwe(vuln.cwe_id) if vuln.cwe_id else ""
        has_cve = bool(vuln.cve_id and vuln.cve_id.strip().upper().startswith("CVE-"))
        is_kev = bool(vuln.kev_flag)

        if not (cwe_id or has_cve or is_kev):
            return summary

        controls = resolve_cwe_to_framework_controls(
            db, tenant_id=vuln.tenant_id,
            cwe_id=cwe_id, has_cve=has_cve, is_kev=is_kev,
        )
        summary["matched_controls"] = len(controls)
        target_pfc_ids = {c.parsed_control_id for c in controls}

        # Existing auto rows for this vuln, scoped to the parsed-FK column.
        existing_auto = (
            db.query(VulnerabilityControlLink)
            .filter(
                VulnerabilityControlLink.vulnerability_id == vuln.id,
                VulnerabilityControlLink.notes.like(f"{AUTO_LINK_NOTES_PREFIX}%"),
                VulnerabilityControlLink.parsed_framework_control_id.isnot(None),
            )
            .all()
        )
        existing_auto_by_pfc_id = {
            row.parsed_framework_control_id: row
            for row in existing_auto
            if row.parsed_framework_control_id is not None
        }

        # Existing links of ANY kind on parsed FK — never duplicate a pair.
        existing_any_pfc_ids = {
            row[0]
            for row in db.query(VulnerabilityControlLink.parsed_framework_control_id)
            .filter(
                VulnerabilityControlLink.vulnerability_id == vuln.id,
                VulnerabilityControlLink.parsed_framework_control_id.isnot(None),
            )
            .all()
        }

        impact = _vuln_status_to_impact(vuln.status)
        marker = f"{AUTO_LINK_NOTES_PREFIX}{cwe_id or 'vuln-mgmt'}"
        for pfc_id in target_pfc_ids:
            if pfc_id in existing_any_pfc_ids:
                summary["kept"] += 1
                continue
            link = VulnerabilityControlLink(
                vulnerability_id=vuln.id,
                parsed_framework_control_id=pfc_id,
                compliance_impact=impact,
                notes=marker,
                created_by=user_id,
            )
            db.add(link)
            summary["added"] += 1

        if delete_stale:
            for pfc_id, row in existing_auto_by_pfc_id.items():
                if pfc_id not in target_pfc_ids:
                    # A stale auto-link retracts the evidence it produced —
                    # same rule as manual unlink (audited per row).
                    try:
                        from ....services.control_assurance import retract_link_evidence
                        retract_link_evidence(
                            db,
                            tenant_id=vuln.tenant_id,
                            vulnerability_id=vuln.id,
                            control_ref={"parsed_framework_control_id": pfc_id},
                            actor_user_id=user_id,
                            reason="auto_link_stale_removed",
                        )
                    except Exception:
                        logger.exception("stale-link evidence retraction failed (non-fatal)")
                    db.delete(row)
                    summary["removed_stale"] += 1

        if summary["added"] or summary["removed_stale"]:
            try:
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("CWE auto-map: commit failed for vuln %s", vuln.id)
                summary["errors"].append("commit_failed")

    except Exception:
        logger.exception("CWE auto-map: unexpected failure for vuln %s", getattr(vuln, "id", "?"))
        summary["errors"].append("unexpected")

    return summary
