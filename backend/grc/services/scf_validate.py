"""CTEM Validate on the SCF Control Library, by SCF's own crosswalks — no AI.

SCF is CC BY-ND and its terms forbid AI over its text, so `licence_guard` keeps
SCF out of the AI mapper's corpus. Validate maps findings to SCF by rule instead:

  * CWE → its OWASP Top 10 2025 category (OWASP's published CWE lists) → the SCF
    controls SCF itself maps to that category (`grc_scf_mapping`, source
    `owasp_top_10_2025`), most category-specific first;
  * CVE (a published flaw to patch) → NIST 800-53 R5 SI-02 Flaw Remediation →
    the SCF Vulnerability & Patch Management (VPM) controls SCF maps to it.

Links go to each SCF control's NormalizedControl bridge row (source='scf') with
an `auto:cwe:` note, which every reader already shows as basis "rule".
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

NOT_LOADED = "SCF library not loaded — run scf_import (python -m grc.tools.scf_import --tenant <slug>)"
RULE_PREFIX = "auto:cwe:"
OWASP_SOURCE = "owasp_top_10_2025"
NIST_SOURCE = "nist_800_53_r5"
FLAW_REMEDIATION = "SI-02"
# shortcut: top 5 SCF controls per OWASP category (fewest categories, then SCF weight);
# SCF ships no relationship strength, so raise this or add a second crosswalk if users
# find the pick too narrow.
TOP_PER_CATEGORY = 5

# OWASP Top 10 2025 category → CWEs, from OWASP's published per-category lists
# (2021 lists carried to their 2025 numbers, SSRF folded into A01, A10 new).
# shortcut: common CWEs only; extend from owasp.org/Top10/2025 when a finding's CWE is unmapped.
_OWASP_2025_CWES: Dict[str, Tuple[int, ...]] = {
    "A01:2025": (22, 23, 35, 59, 200, 201, 219, 264, 275, 276, 284, 285, 352, 359, 377, 402, 425,
                 441, 497, 538, 540, 548, 552, 566, 601, 639, 651, 668, 706, 862, 863, 913, 918,
                 922, 1275),
    "A02:2025": (2, 11, 13, 15, 16, 260, 315, 520, 526, 537, 541, 547, 611, 614, 776, 942,
                 1004, 1032, 1174),
    "A03:2025": (937, 1035, 1104, 1395),
    "A04:2025": (261, 296, 310, 319, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 335,
                 336, 337, 338, 340, 347, 523, 720, 757, 759, 760, 780, 818, 916),
    "A05:2025": (20, 74, 75, 77, 78, 79, 80, 83, 87, 88, 89, 90, 91, 93, 94, 95, 96, 97, 98, 99,
                 113, 116, 138, 184, 470, 471, 564, 610, 643, 644, 652, 917),
    "A06:2025": (73, 183, 213, 235, 256, 257, 266, 269, 311, 312, 313, 316, 419, 430, 434, 444,
                 451, 472, 501, 522, 525, 539, 579, 598, 602, 642, 646, 650, 653, 656, 657, 799,
                 807, 840, 841, 927, 1021, 1173),
    "A07:2025": (255, 259, 287, 288, 290, 294, 295, 297, 300, 302, 304, 306, 307, 346, 384, 521,
                 613, 620, 640, 798, 940, 1216),
    "A08:2025": (345, 353, 426, 494, 502, 565, 784, 829, 830, 915),
    "A09:2025": (117, 223, 532, 778),
    "A10:2025": (209, 248, 252, 391, 476, 636, 703, 754, 755),
}
CWE_TO_OWASP: Dict[str, str] = {f"CWE-{n}": cat for cat, cwes in _OWASP_2025_CWES.items() for n in cwes}


class ScfNotLoaded(Exception):
    pass


def scf_release_id(db: Session) -> Optional[int]:
    """The ready SCF release (current one first), or None when scf_import never ran."""
    from sqlalchemy import inspect
    from ..models import SCFRelease
    if not inspect(db.get_bind()).has_table(SCFRelease.__tablename__):   # tenant never migrated
        return None
    row = db.query(SCFRelease.id).filter(SCFRelease.import_status == "ready").order_by(
        SCFRelease.is_current.desc(), SCFRelease.id.desc()).first()
    return row[0] if row else None


def _norm_cwe(raw: Optional[str]) -> Optional[str]:
    s = (raw or "").strip().upper()
    if not s:
        return None
    s = s.split(",")[0].split()[0]
    return s if s.startswith("CWE-") else (f"CWE-{s}" if s.isdigit() else None)


def _mappings(db: Session, release_id: int, tenant_id: int, source: str, codes=None) -> List[Tuple[str, str]]:
    """(requirement_code, scf_id) rows of one SCF source: shipped rows + this tenant's own."""
    from ..models import SCFMapping
    q = db.query(SCFMapping.requirement_code, SCFMapping.scf_id).filter(
        SCFMapping.release_id == release_id, SCFMapping.source_slug == source,
        SCFMapping.match_mode == "exact",
        or_(SCFMapping.tenant_id.is_(None), SCFMapping.tenant_id == tenant_id))
    if codes is not None:
        q = q.filter(SCFMapping.requirement_code.in_(list(codes)))
    return q.all()


def category_controls(db: Session, release_id: int, tenant_id: int) -> Dict[str, List[str]]:
    """OWASP category → its TOP_PER_CATEGORY SCF controls. A control SCF maps to fewer
    categories is more specific to this one; SCF weight breaks ties, then the id."""
    from ..models import SCFControl
    rows = _mappings(db, release_id, tenant_id, OWASP_SOURCE)
    cats_of: Dict[str, Set[str]] = {}
    for cat, scf_id in rows:
        cats_of.setdefault(scf_id, set()).add(cat)
    weight = dict(db.query(SCFControl.scf_id, SCFControl.weight).filter(
        SCFControl.release_id == release_id, SCFControl.status == "active",
        SCFControl.scf_id.in_(list(cats_of))).all()) if cats_of else {}
    out: Dict[str, List[str]] = {}
    for cat in {c for c, _ in rows}:
        ids = [s for s, cats in cats_of.items() if cat in cats and s in weight]
        ids.sort(key=lambda s: (len(cats_of[s]), -(weight[s] or 0), s))
        out[cat] = ids[:TOP_PER_CATEGORY]
    return out


def flaw_controls(db: Session, release_id: int, tenant_id: int) -> List[str]:
    """SCF's VPM controls for NIST SI-02 — SCF also maps antimalware signature updates
    there, which is not the fix for a CVE."""
    return sorted({s for _, s in _mappings(db, release_id, tenant_id, NIST_SOURCE, [FLAW_REMEDIATION])
                   if s.startswith("VPM-")})


def rules_for(cwe: Optional[str], cve: Optional[str], by_cat: Dict[str, List[str]],
              flaw: List[str]) -> List[Tuple[str, str]]:
    """(scf_id, link note) for one finding; empty when no rule applies."""
    out: List[Tuple[str, str]] = []
    cat = CWE_TO_OWASP.get(cwe or "")
    for scf_id in by_cat.get(cat, []) if cat else []:
        out.append((scf_id, f"{RULE_PREFIX}{cwe} · OWASP {cat} → SCF {scf_id}"))
    if (cve or "").strip():
        seen = {s for s, _ in out}
        out += [(s, f"{RULE_PREFIX}vuln-mgmt · {cve.strip()} → NIST {FLAW_REMEDIATION} → SCF {s}")
                for s in flaw if s not in seen]
    return out


def map_findings(db: Session, tenant_id: int, vuln_ids: List[int], *, actor_id: Optional[int] = None) -> Dict[str, int]:
    """Write the SCF rule links for these findings. Idempotent: an existing link to
    the same control is kept as it is (a human or AI link is never relabelled)."""
    from ..models import NormalizedControl, Vulnerability, VulnerabilityControlLink
    release_id = scf_release_id(db)
    if release_id is None:
        raise ScfNotLoaded(NOT_LOADED)
    by_cat = category_controls(db, release_id, tenant_id)
    flaw = flaw_controls(db, release_id, tenant_id)
    bridge = dict(db.query(NormalizedControl.scf_id, NormalizedControl.id).filter(
        NormalizedControl.source == "scf", NormalizedControl.scf_id.isnot(None)).all())
    summary = {"findings": len(vuln_ids), "findings_mapped": 0, "links_created": 0, "no_rule": 0}
    if not vuln_ids:
        return summary
    existing: Set[Tuple[int, int]] = set(db.query(
        VulnerabilityControlLink.vulnerability_id, VulnerabilityControlLink.normalized_control_id).filter(
        VulnerabilityControlLink.vulnerability_id.in_(vuln_ids),
        VulnerabilityControlLink.normalized_control_id.isnot(None)).all())
    for v in db.query(Vulnerability.id, Vulnerability.cwe_id, Vulnerability.cve_id).filter(
            Vulnerability.tenant_id == tenant_id, Vulnerability.id.in_(vuln_ids)).all():
        rules = [(bridge[s], note) for s, note in rules_for(_norm_cwe(v.cwe_id), v.cve_id, by_cat, flaw) if s in bridge]
        if not rules:
            summary["no_rule"] += 1
            continue
        summary["findings_mapped"] += 1
        for nc_id, note in rules:
            if (v.id, nc_id) in existing:
                continue
            db.add(VulnerabilityControlLink(vulnerability_id=v.id, normalized_control_id=nc_id,
                                            compliance_impact="at_risk", notes=note, created_by=actor_id))
            existing.add((v.id, nc_id))
            summary["links_created"] += 1
    db.flush()
    return summary
