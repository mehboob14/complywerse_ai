"""MITRE ATT&CK Enterprise catalogue — Layer 1 of the exploitability pipeline.

Static, identical for every tenant and every vulnerability. Nothing here knows
what a vuln is; downstream layers only ever *select* from this table, never
write to it.

Shape of the contract:

    technique dict, keyed by T-number, each tagged with its tactic(s) and a
    kill-chain order index

The order index comes from ``x-mitre-matrix.tactic_refs``, which ATT&CK
publishes already sorted left-to-right. It is not hand-maintained here, so a
version bump that reorders or inserts a tactic is picked up by re-running the
ingest rather than by editing code.

Backing store is ``seed_data/attack/enterprise_attack_catalog.json``, produced
by ``scripts/ingest_attack_catalog.py``. It is read once per process and held
in memory — ~700 techniques, so lookups are a plain ``dict.get()``.

Deliberately not a DB table: it is read-only reference data with no tenant
variance, and these are per-tenant databases, so a table would mean the same
700 rows duplicated into every tenant plus seeding machinery to keep them in
sync. Same call ``cwe_control_map.py`` makes. If tenant-specific annotation is
ever needed, add an override table keyed on ``technique_id`` and layer it on
top — exactly the ``CweControlOverride`` pattern — rather than moving the base
catalogue into the database.

Missing or unreadable catalogue file → the cache stays empty and every lookup
returns None/empty. Callers degrade to "no ATT&CK view for this vuln"; nothing
raises. Enrichment must never break a request.

ATT&CK is licensed for commercial use with attribution:

    (c) 2026 The MITRE Corporation. This work is reproduced and distributed
    with the permission of The MITRE Corporation.

Surface that notice anywhere the chain is rendered or exported.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# grc/modules/vuln_management/attack/ -> grc/seed_data/attack/
CATALOG_PATH = (
    Path(__file__).resolve().parents[3] / "seed_data" / "attack" / "enterprise_attack_catalog.json"
)

MITRE_ATTRIBUTION = (
    "(c) 2026 The MITRE Corporation. This work is reproduced and distributed "
    "with the permission of The MITRE Corporation."
)

# T1190, T1059.001 — case-insensitive on the way in, canonical uppercase out.
_TECHNIQUE_RE = re.compile(r"^T\d{4}(?:\.\d{3})?$", re.IGNORECASE)

# Guards against a malformed catalogue with a revoked-by cycle.
_MAX_REVOKED_HOPS = 5

_lock = threading.Lock()
_catalog: Dict[str, object] = {}
_techniques: Dict[str, dict] = {}
_tactics: Dict[str, dict] = {}
_technique_mitigations: Dict[str, List[str]] = {}
_mitigations: Dict[str, dict] = {}
_loaded_at: Optional[datetime] = None
_load_attempted = False
_load_error: Optional[str] = None


def _read_catalog_file() -> Optional[dict]:
    try:
        with CATALOG_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logger.warning(
            "ATT&CK catalogue missing at %s — run scripts/ingest_attack_catalog.py --download. "
            "ATT&CK views will be empty until then.",
            CATALOG_PATH,
        )
        return None
    except Exception as exc:
        logger.exception("ATT&CK catalogue unreadable at %s: %s", CATALOG_PATH, exc)
        return None


def _install(payload: dict) -> None:
    """Assumes the lock is held."""
    global _catalog, _techniques, _tactics, _technique_mitigations, _mitigations
    global _loaded_at, _load_error
    _catalog = payload
    _techniques = payload.get("techniques") or {}
    _tactics = payload.get("tactics") or {}
    _technique_mitigations = payload.get("technique_mitigations") or {}
    _mitigations = payload.get("mitigations") or {}
    _loaded_at = datetime.utcnow()
    _load_error = None


def _ensure_loaded() -> None:
    """First-access loader. Repeat calls after the first are a bool check."""
    global _load_attempted, _load_error
    if _load_attempted:
        return
    with _lock:
        if _load_attempted:
            return
        _load_attempted = True
        payload = _read_catalog_file()
        if payload is None:
            _load_error = f"catalogue not loaded from {CATALOG_PATH}"
            return
        _install(payload)
        logger.info(
            "ATT&CK catalogue loaded: v%s, %d techniques, %d tactics",
            payload.get("attack_version"),
            len(_techniques),
            len(_tactics),
        )


def reload_catalog() -> bool:
    """Force a re-read from disk, e.g. after re-running the ingest script.
    Returns True on success; on failure the previous copy stays live.
    """
    global _load_attempted
    payload = _read_catalog_file()
    if payload is None:
        return False
    with _lock:
        _install(payload)
        _load_attempted = True
    logger.info("ATT&CK catalogue reloaded: %d techniques", len(_techniques))
    return True


# ──────────────────────────────────────────────────────────────────────────
# Technique lookup
# ──────────────────────────────────────────────────────────────────────────
def normalise_technique_id(raw: Optional[str]) -> Optional[str]:
    """'t1190 ' -> 'T1190'. Returns None if it isn't a T-number at all."""
    if not raw or not isinstance(raw, str):
        return None
    candidate = raw.strip().upper()
    return candidate if _TECHNIQUE_RE.match(candidate) else None


def get_technique(technique_id: Optional[str], follow_revoked: bool = True) -> Optional[dict]:
    """Look up one technique.

    Revoked techniques are followed to their replacement by default. Stored
    T-numbers go stale whenever MITRE retires one, and every external mapping
    source lags the current release — the redirect is what keeps an old
    mapping from silently resolving to nothing.
    """
    tid = normalise_technique_id(technique_id)
    if not tid:
        return None
    _ensure_loaded()
    tech = _techniques.get(tid)
    if tech is None or not follow_revoked:
        return tech
    hops = 0
    while tech.get("is_revoked") and tech.get("revoked_by") and hops < _MAX_REVOKED_HOPS:
        successor = _techniques.get(tech["revoked_by"])
        if successor is None or successor is tech:
            break
        tech = successor
        hops += 1
    return tech


def get_techniques(technique_ids) -> List[dict]:
    """Resolve many at once, dropping unknowns and de-duplicating (two inputs
    can redirect onto the same replacement). Order of first appearance is kept.
    """
    out: List[dict] = []
    seen = set()
    for raw in technique_ids or []:
        tech = get_technique(raw)
        if tech is None:
            continue
        tid = tech["technique_id"]
        if tid in seen:
            continue
        seen.add(tid)
        out.append(tech)
    return out


def all_techniques(include_inactive: bool = False) -> Dict[str, dict]:
    """The full technique dictionary. Deprecated/revoked entries are excluded
    unless asked for — they stay in the file so old ids still resolve, but they
    are not selectable.
    """
    _ensure_loaded()
    if include_inactive:
        return dict(_techniques)
    return {
        tid: t for tid, t in _techniques.items()
        if not t.get("is_deprecated") and not t.get("is_revoked")
    }


def parent_of(technique_id: Optional[str]) -> Optional[dict]:
    """Parent technique of a sub-technique, or None for a top-level one."""
    tech = get_technique(technique_id)
    if not tech or not tech.get("parent"):
        return None
    return get_technique(tech["parent"])


def subtechniques_of(technique_id: Optional[str]) -> List[dict]:
    tid = normalise_technique_id(technique_id)
    if not tid:
        return []
    _ensure_loaded()
    return sorted(
        (t for t in _techniques.values()
         if t.get("parent") == tid and not t.get("is_deprecated") and not t.get("is_revoked")),
        key=lambda t: t["technique_id"],
    )


# ──────────────────────────────────────────────────────────────────────────
# Tactics and kill-chain ordering
# ──────────────────────────────────────────────────────────────────────────
def get_tactic(shortname: Optional[str]) -> Optional[dict]:
    """By shortname ('initial-access'), which is the join key techniques use."""
    if not shortname or not isinstance(shortname, str):
        return None
    _ensure_loaded()
    return _tactics.get(shortname.strip().lower())


def kill_chain_tactics() -> List[dict]:
    """Every tactic in matrix order — Reconnaissance first, Impact last.

    This is the column order for the chain view. Tactics with no order index
    (shouldn't happen; the ingest warns if it does) sort to the end.
    """
    _ensure_loaded()
    return sorted(
        _tactics.values(),
        key=lambda t: (t.get("order") is None, t.get("order") or 0),
    )


def tactic_order(shortname: Optional[str]) -> Optional[int]:
    tactic = get_tactic(shortname)
    return tactic.get("order") if tactic else None


def technique_order(technique_id: Optional[str]) -> Optional[int]:
    """Where a technique sits on the kill chain — its earliest tactic. A
    technique under several tactics renders at its first opportunity.
    """
    tech = get_technique(technique_id)
    return tech.get("order") if tech else None


def techniques_for_tactic(shortname: Optional[str]) -> List[dict]:
    if not shortname or not isinstance(shortname, str):
        return []
    key = shortname.strip().lower()
    return sorted(
        (t for t in all_techniques().values() if key in (t.get("tactics") or [])),
        key=lambda t: t["technique_id"],
    )


# ──────────────────────────────────────────────────────────────────────────
# Mitigations — the bridge out to the control library
# ──────────────────────────────────────────────────────────────────────────
def mitigations_for(technique_id: Optional[str]) -> List[dict]:
    tech = get_technique(technique_id)
    if not tech:
        return []
    _ensure_loaded()
    ids = _technique_mitigations.get(tech["technique_id"]) or []
    return [_mitigations[m] for m in ids if m in _mitigations]


def get_mitigation(mitigation_id: Optional[str]) -> Optional[dict]:
    if not mitigation_id or not isinstance(mitigation_id, str):
        return None
    _ensure_loaded()
    return _mitigations.get(mitigation_id.strip().upper())


# ──────────────────────────────────────────────────────────────────────────
# Introspection
# ──────────────────────────────────────────────────────────────────────────
def catalog_status() -> dict:
    """Lightweight health probe — for the /enrich endpoint and startup logs."""
    _ensure_loaded()
    return {
        "loaded": _loaded_at is not None,
        "loaded_at": _loaded_at.isoformat() if _loaded_at else None,
        "path": str(CATALOG_PATH),
        "error": _load_error,
        "attack_version": _catalog.get("attack_version"),
        "generated_at": _catalog.get("generated_at"),
        "source_url": _catalog.get("source_url"),
        "counts": _catalog.get("counts") or {},
        "attribution": MITRE_ATTRIBUTION,
    }
