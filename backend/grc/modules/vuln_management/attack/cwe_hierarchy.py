"""CWE ChildOf hierarchy — the ancestor-walk half of Layer 2's fallback.

Loads ``seed_data/attack/cwe_hierarchy.json`` (built by
``scripts/ingest_cwe_hierarchy.py`` from MITRE's CWE catalogue). Its one job:
given a CWE that has NO direct CAPEC->ATT&CK mapping, climb the ChildOf chain to
the nearest ancestor that DOES map (e.g. CWE-289 -> CWE-1390 -> CWE-287) so
selection.py can borrow that ancestor's techniques as an approximate,
clearly-labelled "via parent" mapping.

A child weakness is a more specific case of its parent, so the parent's attack
patterns are a valid over-approximation of the child's — real MITRE data, not a
guess, but broader than an exact match (hence lower confidence + a depth label).

Same failure posture as ``capec_map``: missing/unreadable file -> empty -> the
walk finds nothing and selection simply falls through to the CVSS-vector rules,
exactly as before this module existed.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAP_PATH = (
    Path(__file__).resolve().parents[3] / "seed_data" / "attack" / "cwe_hierarchy.json"
)
_CWE_RE = re.compile(r"(\d+)")

_lock = threading.Lock()
_child_of: Dict[str, List[str]] = {}
_names: Dict[str, str] = {}
_loaded = False


def _ensure_loaded() -> None:
    global _loaded, _child_of, _names
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        _loaded = True
        try:
            payload = json.loads(MAP_PATH.read_text(encoding="utf-8"))
            _child_of = payload.get("child_of") or {}
            _names = payload.get("names") or {}
            logger.info(
                "CWE hierarchy loaded: CWE v%s, %d weaknesses with a ChildOf parent",
                payload.get("cwe_version"), len(_child_of),
            )
        except Exception:
            logger.warning(
                "CWE hierarchy not loaded from %s — ancestor-walk disabled, selection "
                "falls through to CVSS rules as before.", MAP_PATH, exc_info=True,
            )


def _norm(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    m = _CWE_RE.search(str(raw))
    return m.group(1) if m else None


def parents(cwe: Optional[str]) -> List[str]:
    """Direct ChildOf parent CWE numbers for one CWE ('287' style). [] if none."""
    _ensure_loaded()
    return list(_child_of.get(_norm(cwe) or "", []))


def name(cwe: Optional[str]) -> Optional[str]:
    _ensure_loaded()
    return _names.get(_norm(cwe) or "")


def walk_to_mapped(
    cwe: Optional[str], is_mapped: Callable[[str], bool], max_depth: int = 6
) -> Tuple[Optional[str], int]:
    """Breadth-first climb of the ChildOf hierarchy from ``cwe`` to the NEAREST
    ancestor for which ``is_mapped(ancestor)`` is True.

    Returns ``(ancestor_cwe_number, depth)`` — depth 1 = direct parent — or
    ``(None, 0)`` if no ancestor maps within ``max_depth``. ``cwe`` itself is NOT
    tested (the caller has already checked the direct mapping). Level-by-level so
    the shallowest (most specific) mapped ancestor wins; cycle-safe via ``seen``.
    """
    _ensure_loaded()
    start = _norm(cwe)
    if not start:
        return None, 0
    seen = {start}
    current = [p for p in _child_of.get(start, [])]
    depth = 1
    while current and depth <= max_depth:
        nxt: List[str] = []
        for anc in current:
            if anc in seen:
                continue
            seen.add(anc)
            if is_mapped(anc):
                return anc, depth
            nxt.extend(_child_of.get(anc, []))
        current = nxt
        depth += 1
    return None, 0
