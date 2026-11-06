"""SCF applicability engine — pure resolve + recompute against materialised state."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy.orm import Session

from grc.models import (
    SCFAuditPeriod,
    SCFControl,
    SCFControlState,
    SCFMapping,
    SCFScope,
)
from grc.modules.scf.registry import expand_source_slugs

# Audit-period statuses that freeze the SoA — recompute is blocked while open.
_BLOCKING_AUDIT_STATUSES = ("open", "fieldwork")


def _attr(obj: Any, name: str, default=None):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _pptdf_has(pptdf: Optional[str], word: str, letter: str) -> bool:
    """True if PPTDF names the dimension as a word or single letter (defensive)."""
    raw = (pptdf or "").strip()
    if not raw:
        return False
    lower = raw.lower()
    if word.lower() in lower:
        return True
    # Letter token: standalone or in a concatenated PPTDF string like "TDF".
    upper = raw.upper()
    letter = letter.upper()
    if letter in upper and len(raw) <= 8 and re.fullmatch(r"[A-Za-z|/,;\-\s]+", raw):
        # Prefer word match when full words are present; letter match for short codes.
        if any(ch.isalpha() and len(tok) > 1 for tok in re.split(r"[|/,;\-\s]+", raw) if tok):
            return False  # has words — already checked word above
        return letter in set(ch for ch in upper if ch.isalpha())
    # Explicit single-letter or pipe-separated: "F", "T|F", "Facility|Data"
    parts = [p.strip() for p in re.split(r"[|/,;]+", raw) if p.strip()]
    for p in parts:
        if p.upper() == letter or p.lower() == word.lower():
            return True
    return False


def _esp_levels_in_baselines(baselines: Optional[Iterable], esp_level: int) -> bool:
    """True if baselines intersects ESP levels 1..esp_level (defensive key forms)."""
    if not baselines or esp_level <= 0:
        return False
    wanted = set(range(1, esp_level + 1))
    found: Set[int] = set()
    for b in baselines:
        if b is None:
            continue
        s = str(b).strip().lower().replace(" ", "_").replace("-", "_")
        # esp_1, esp_level_1, esplevel1, 'esp level 1 foundational', …
        m = re.search(r"esp(?:_?level)?_?(\d)", s)
        if m:
            found.add(int(m.group(1)))
            continue
        m = re.search(r"level[_\s]*(\d)", s)
        if m and "esp" in s:
            found.add(int(m.group(1)))
    return bool(found & wanted)


def can_self_approve(requested_by: Optional[int], reviewed_by: Optional[int]) -> bool:
    """Segregation of duties: reviewer must differ from requester."""
    if requested_by is None or reviewed_by is None:
        return True
    return int(requested_by) != int(reviewed_by)


def resolve_one(
    control: Any,
    scope: Any,
    state_row: Any = None,
    ancestor_states: Optional[Sequence[Any]] = None,
    mapping_source_slugs_for_control: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """First-match applicability for one control against a scope.

    Returns ``{is_applicable, source, obligation, reason}``.
    """
    pptdf = _attr(control, "pptdf")
    has_facilities = bool(_attr(scope, "has_facilities", True))
    processes_pd = bool(_attr(scope, "processes_personal_data", True))

    # 0. HARD GATES
    if _pptdf_has(pptdf, "Facility", "F") and not has_facilities:
        return {
            "is_applicable": False,
            "source": "gate",
            "obligation": None,
            "reason": "No owned or leased facilities in scope",
        }
    if _pptdf_has(pptdf, "Data", "D") and not processes_pd:
        return {
            "is_applicable": False,
            "source": "gate",
            "obligation": None,
            "reason": "Personal data processing is out of scope",
        }

    # 1. EXPLICIT override — survives every recompute
    if state_row is not None and _attr(state_row, "is_applicable") is not None:
        src = _attr(state_row, "applicability_source") or "override"
        # Only treat as an override when source says so, OR when is_applicable was
        # set without a derived/gate/baseline stamp (human path / pending review).
        if src == "override" or src not in ("derived", "gate", "baseline", "inherited"):
            return {
                "is_applicable": bool(_attr(state_row, "is_applicable")),
                "source": "override",
                "obligation": _attr(state_row, "obligation"),
                "reason": _attr(state_row, "applicability_reason"),
            }

    # 2. INHERITED — first ancestor with an explicit decision
    for anc in ancestor_states or []:
        if anc is None:
            continue
        if _attr(anc, "is_applicable") is None:
            continue
        src = _attr(anc, "applicability_source") or "override"
        if src in ("derived", "gate", "baseline", "inherited"):
            continue
        return {
            "is_applicable": bool(_attr(anc, "is_applicable")),
            "source": "inherited",
            "obligation": _attr(anc, "obligation"),
            "reason": _attr(anc, "applicability_reason"),
        }

    # 3. DERIVED from in-scope framework mappings
    fw_slugs = list(_attr(scope, "framework_slugs") or [])
    obligations = dict(_attr(scope, "framework_obligations") or {})
    expanded = expand_source_slugs(fw_slugs)
    mapped = {s for s in (mapping_source_slugs_for_control or []) if s}
    hits = expanded & mapped
    if hits:
        # Obligation from product slugs that contributed to the match.
        matching_products: List[str] = []
        for slug in fw_slugs:
            prod_expanded = expand_source_slugs([slug])
            if prod_expanded & mapped:
                matching_products.append(slug)
        is_mcr = any(
            str(obligations.get(s) or "").upper() == "MCR" for s in matching_products
        )
        return {
            "is_applicable": True,
            "source": "derived",
            "obligation": "MCR" if is_mcr else "DSR",
            "reason": None,
        }

    # 4. BASELINE overlay (ESP)
    esp_level = int(_attr(scope, "esp_level") or 0)
    baselines = _attr(control, "baselines") or []
    if esp_level > 0 and _esp_levels_in_baselines(baselines, esp_level):
        return {
            "is_applicable": True,
            "source": "baseline",
            "obligation": "DSR",
            "reason": None,
        }

    # 5. else N/A derived
    return {
        "is_applicable": False,
        "source": "derived",
        "obligation": None,
        "reason": None,
    }


def _is_override_row(row: Any) -> bool:
    """Human override: is_applicable set and not a recompute-owned source."""
    if row is None or _attr(row, "is_applicable") is None:
        return False
    src = _attr(row, "applicability_source")
    return src == "override" or src not in ("derived", "gate", "baseline", "inherited")


def _audit_period_blocks(db: Session, scope: SCFScope) -> Optional[SCFAuditPeriod]:
    return (
        db.query(SCFAuditPeriod)
        .filter(
            SCFAuditPeriod.scope_id == scope.id,
            SCFAuditPeriod.status.in_(_BLOCKING_AUDIT_STATUSES),
        )
        .first()
    )


def _mapping_index(db: Session, release_id: int) -> Dict[str, Set[str]]:
    """scf_id → set of mapping source_slugs for the release."""
    idx: Dict[str, Set[str]] = {}
    for scf_id, slug in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug)
        .filter(SCFMapping.release_id == release_id)
        .all()
    ):
        idx.setdefault(scf_id, set()).add(slug)
    return idx


def _ancestor_override_map(
    db: Session, scope: SCFScope, tenant_id: int,
) -> Dict[str, List[SCFControlState]]:
    """For each scf_id, ordered list of ancestor override states (nearest first)."""
    chain: List[int] = []
    cur = scope.parent_id
    seen = set()
    while cur and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        parent = db.query(SCFScope.parent_id).filter(SCFScope.id == cur).first()
        cur = parent[0] if parent else None
    if not chain:
        return {}
    rows = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id.in_(chain),
            SCFControlState.is_applicable.isnot(None),
        )
        .all()
    )
    order = {sid: i for i, sid in enumerate(chain)}
    by_scf: Dict[str, List[SCFControlState]] = {}
    for r in rows:
        if not _is_override_row(r):
            continue
        by_scf.setdefault(r.scf_id, []).append(r)
    for scf_id, lst in by_scf.items():
        lst.sort(key=lambda r: order.get(r.scope_id, 999))
    return by_scf


def _compute_answers(db: Session, scope: SCFScope) -> Dict[str, Dict[str, Any]]:
    controls = (
        db.query(SCFControl)
        .filter(SCFControl.release_id == scope.release_id)
        .all()
    )
    mappings = _mapping_index(db, scope.release_id)
    existing = {
        r.scf_id: r
        for r in db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == scope.tenant_id,
            SCFControlState.scope_id == scope.id,
        )
        .all()
    }
    ancestors = _ancestor_override_map(db, scope, scope.tenant_id)
    answers: Dict[str, Dict[str, Any]] = {}
    for ctl in controls:
        answers[ctl.scf_id] = resolve_one(
            ctl,
            scope,
            state_row=existing.get(ctl.scf_id),
            ancestor_states=ancestors.get(ctl.scf_id) or [],
            mapping_source_slugs_for_control=mappings.get(ctl.scf_id) or set(),
        )
    return answers


def diff_recompute(db: Session, scope: SCFScope) -> Dict[str, Any]:
    """Compare current materialised (non-override) states vs newly derived answers."""
    blocking = _audit_period_blocks(db, scope)
    if blocking is not None:
        return {
            "blocked": True,
            "reason": f"Audit period '{blocking.name}' is {blocking.status}",
            "audit_period_id": blocking.id,
            "added": [],
            "removed": [],
            "unchanged": 0,
            "preview": [],
        }

    new_answers = _compute_answers(db, scope)
    current_rows = {
        r.scf_id: r
        for r in db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == scope.tenant_id,
            SCFControlState.scope_id == scope.id,
        )
        .all()
    }

    added: List[str] = []
    removed: List[str] = []
    unchanged = 0
    preview: List[Dict[str, Any]] = []

    for scf_id, ans in new_answers.items():
        row = current_rows.get(scf_id)
        if row is not None and _is_override_row(row):
            unchanged += 1
            continue
        was_app = bool(row.is_applicable) if row is not None and row.is_applicable is not None else None
        # For derived materialised rows, is_applicable holds the answer.
        if row is not None and not _is_override_row(row):
            was_app = bool(row.is_applicable) if row.is_applicable is not None else False
            if row.applicability_source in ("derived", "gate", "baseline") and row.is_applicable is None:
                # legacy empty stamp
                was_app = False
        now_app = bool(ans["is_applicable"])
        if was_app is None:
            if now_app:
                added.append(scf_id)
                preview.append({"scf_id": scf_id, "change": "added", **ans})
            else:
                unchanged += 1
        elif was_app and not now_app:
            removed.append(scf_id)
            preview.append({"scf_id": scf_id, "change": "removed", **ans})
        elif (not was_app) and now_app:
            added.append(scf_id)
            preview.append({"scf_id": scf_id, "change": "added", **ans})
        else:
            unchanged += 1

    return {
        "blocked": False,
        "added": added,
        "removed": removed,
        "unchanged": unchanged,
        "added_count": len(added),
        "removed_count": len(removed),
        "preview": preview[:200],  # cap payload; counts are authoritative
        "summary": (
            f"{len(added)} newly applicable, {len(removed)} no longer applicable, "
            f"{unchanged} unchanged"
        ),
    }


def commit_recompute(db: Session, scope: SCFScope) -> Dict[str, Any]:
    """Upsert SCFControlState for all controls; never overwrite human overrides."""
    blocking = _audit_period_blocks(db, scope)
    if blocking is not None:
        raise ValueError(
            f"Cannot recompute while audit period '{blocking.name}' is {blocking.status}"
        )

    diff = diff_recompute(db, scope)
    answers = _compute_answers(db, scope)
    existing = {
        r.scf_id: r
        for r in db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == scope.tenant_id,
            SCFControlState.scope_id == scope.id,
        )
        .all()
    }
    now = datetime.utcnow()
    for scf_id, ans in answers.items():
        row = existing.get(scf_id)
        if row is not None and _is_override_row(row):
            continue  # NEVER overwrite overrides
        if row is None:
            row = SCFControlState(
                tenant_id=scope.tenant_id,
                scope_id=scope.id,
                scf_id=scf_id,
            )
            db.add(row)
            existing[scf_id] = row
        row.is_applicable = bool(ans["is_applicable"])
        row.applicability_source = ans["source"]
        row.obligation = ans.get("obligation")
        # Clear stale N/A reasons when becoming applicable; keep gate reasons.
        if ans["is_applicable"]:
            row.applicability_reason = None
        else:
            row.applicability_reason = ans.get("reason")
        row.updated_at = now

    db.commit()
    return {
        **diff,
        "committed": True,
        "applicable_count": sum(1 for a in answers.values() if a["is_applicable"]),
        "total_count": len(answers),
    }
