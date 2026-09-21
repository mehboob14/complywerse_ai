"""Attach a register finding to the rest of the platform.

The pen-test sheet names the hosts a finding touches, and the bank already holds
those hosts in the IT asset inventory and their weaknesses in the vulnerability
register; findings also name the vendors they concern. Matching them here is
what keeps the register from being a list of its own: the asset page shows the
audit finding, closing the vulnerability shows against the finding, and a vendor
issue reaches third-party risk.

Matching is deliberate rather than eager. A wrong link in a bank's audit
register is worse than a missing one, so a name that fits two records links to
neither, and text matches must be whole words.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

from ....models import (
    AuditIssueProfile, Issue, IssueAssetLink, IssueVendorLink, IssueVulnerabilityLink,
    ITAsset, Vendor, Vulnerability,
)

_SPLIT = re.compile(r"[,;/\n\r\t|]+| {2,}")


def _key(value: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9.\-_ ]+", " ", str(value or "").lower()).split())


def _unique_index(pairs: Iterable[tuple]) -> Dict[str, int]:
    """key → id, dropping any key two records share."""
    index: Dict[str, Any] = {}
    for key, ident in pairs:
        if not key or len(key) < 3:
            continue
        index[key] = ident if index.get(key) in (None, ident) else "ambiguous"
    return {k: v for k, v in index.items() if isinstance(v, int)}


def build_asset_index(db: Session) -> Dict[str, int]:
    """Assets by every name the register might use for them."""
    pairs = []
    for asset in db.query(ITAsset).all():
        for value in (asset.name, getattr(asset, "host_name", None), getattr(asset, "fqdn", None),
                      getattr(asset, "ip_address", None)):
            pairs.append((_key(value), asset.id))
        for extra in _SPLIT.split(str(getattr(asset, "known_ips", "") or "")):
            pairs.append((_key(extra), asset.id))
    return _unique_index(pairs)


def build_vendor_index(db: Session) -> Dict[str, int]:
    # Short names ("EY") would match half the register's prose, so they are left
    # to the source column, which already records the audit firm.
    return _unique_index(((_key(v.name), v.id) for v in db.query(Vendor).all()
                          if len(_key(v.name)) >= 4))


def build_vulnerability_index(db: Session) -> Dict[str, List[tuple]]:
    """Vulnerabilities grouped by the host they were found on."""
    grouped: Dict[str, List[tuple]] = {}
    for vuln in db.query(Vulnerability).all():
        for host in (getattr(vuln, "affected_host", None), getattr(vuln, "host_identity", None)):
            if _key(host):
                grouped.setdefault(_key(host), []).append((vuln.id, _key(vuln.title)))
    return grouped


def hosts_named_by(profile: AuditIssueProfile) -> List[str]:
    """The hosts a finding names, from its own columns."""
    out: Set[str] = set()
    for field in (profile.affected_hosts, profile.location):
        for part in _SPLIT.split(str(field or "")):
            if _key(part):
                out.add(_key(part))
    return sorted(out)


def _finding_text(issue: Issue, profile: AuditIssueProfile) -> str:
    return _key(" ".join(filter(None, [
        issue.title, profile.issue_text, profile.condition, profile.recommendation,
        profile.management_response,
    ])))


def _existing(db: Session, model, issue_id: int, column: str) -> Set[int]:
    return {getattr(row, column) for row in
            db.query(model).filter(model.issue_id == issue_id).all()}


def link_issue(db: Session, issue: Issue, profile: AuditIssueProfile, *,
               assets: Dict[str, int], vendors: Dict[str, int],
               vulnerabilities: Dict[str, List[tuple]],
               actor_id: Optional[int] = None) -> Dict[str, int]:
    """Link one finding to the assets, vulnerabilities and vendors it names."""
    made = {"assets": 0, "vulnerabilities": 0, "vendors": 0}
    hosts = hosts_named_by(profile)

    asset_ids = {assets[h] for h in hosts if h in assets}
    known_assets = _existing(db, IssueAssetLink, issue.id, "asset_id")
    for asset_id in asset_ids - known_assets:
        db.add(IssueAssetLink(issue_id=issue.id, asset_id=asset_id, created_by=actor_id,
                              notes="Named by the audit register"))
        made["assets"] += 1

    # Only a vulnerability on the same host whose title matches the finding's —
    # linking every weakness on a host would bury the real one.
    title = _key(issue.title)
    known_vulns = _existing(db, IssueVulnerabilityLink, issue.id, "vulnerability_id")
    for host in hosts:
        for vuln_id, vuln_title in vulnerabilities.get(host, []):
            if vuln_id in known_vulns or not vuln_title or len(vuln_title) < 12:
                continue
            if vuln_title in title or title in vuln_title:
                db.add(IssueVulnerabilityLink(issue_id=issue.id, vulnerability_id=vuln_id,
                                              created_by=actor_id,
                                              notes="Same host and finding in the audit register"))
                known_vulns.add(vuln_id)
                made["vulnerabilities"] += 1

    text = _finding_text(issue, profile)
    known_vendors = _existing(db, IssueVendorLink, issue.id, "vendor_id")
    for name, vendor_id in vendors.items():
        if vendor_id in known_vendors:
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", text):
            db.add(IssueVendorLink(issue_id=issue.id, vendor_id=vendor_id, created_by=actor_id,
                                   notes="Named in the audit finding"))
            known_vendors.add(vendor_id)
            made["vendors"] += 1

    return made
