"""Stage G — SCF covers bindings for connector / cloud checks.

A check's test status must not come from SOC 2 criteria alone. Prefer explicit
``covers`` tokens (ao_id or scf_id) from the check dict or the seed overlay;
SOC 2 remains the fallback when covers are empty.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

logger = logging.getLogger(__name__)

_OVERLAY_PATH = (
    Path(__file__).resolve().parents[3]
    / "seed_data"
    / "evidence"
    / "covers_overlay.json"
)

# ao_id tokens carry an assessment-objective suffix after the first ``_A``.
_AO_MARKER = "_A"


def _parent_scf_id(token: str) -> str:
    """``IAC-06_A01`` → ``IAC-06``; bare ``IAC-06`` / ``IAC-06.2`` → itself."""
    t = (token or "").strip()
    if not t:
        return ""
    if _AO_MARKER in t:
        return t.split(_AO_MARKER, 1)[0]
    return t


@lru_cache(maxsize=1)
def load_covers_overlay() -> Dict[str, Dict[str, Any]]:
    """check_id → {covers, rationale, reviewed_by} from the seed overlay."""
    if not _OVERLAY_PATH.is_file():
        return {}
    try:
        doc = json.loads(_OVERLAY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.exception("failed to load covers overlay %s", _OVERLAY_PATH)
        return {}
    bindings = doc.get("bindings") if isinstance(doc, dict) else None
    if not isinstance(bindings, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for check_id, row in bindings.items():
        if not isinstance(check_id, str) or not isinstance(row, dict):
            continue
        covers = row.get("covers")
        if not isinstance(covers, list):
            covers = []
        out[check_id] = {
            "covers": [str(x).strip() for x in covers if str(x).strip()],
            "rationale": row.get("rationale"),
            "reviewed_by": row.get("reviewed_by"),
        }
    return out


def covers_for_check(check: dict) -> List[str]:
    """Inline ``check['covers']`` wins; otherwise overlay by ``check['id']``."""
    if not isinstance(check, dict):
        return []
    inline = check.get("covers")
    if isinstance(inline, list) and inline:
        return [str(x).strip() for x in inline if str(x).strip()]
    cid = check.get("id")
    if not cid:
        return []
    row = load_covers_overlay().get(str(cid))
    if not row:
        return []
    return list(row.get("covers") or [])


def scf_targets_from_covers(covers: List[str]) -> Set[str]:
    """Map cover tokens to parent SCF control ids.

    ``IAC-06_A01`` → ``IAC-06``; bare ``IAC-06`` → itself.
    """
    out: Set[str] = set()
    for tok in covers or []:
        parent = _parent_scf_id(str(tok))
        if parent:
            out.add(parent)
    return out


def ao_id_from_token(token: str) -> Optional[str]:
    """Return the token as ao_id when it includes ``_A``; else None."""
    t = (token or "").strip()
    if t and _AO_MARKER in t:
        return t
    return None


def validate_covers_tokens(
    db,
    release_id: int,
    covers: Iterable[str],
) -> List[str]:
    """Return tokens that are neither a known scf_id nor a known ao_id."""
    tokens = [str(x).strip() for x in (covers or []) if str(x).strip()]
    if not tokens:
        return []
    from grc.models import SCFControl, SCFObjective

    scf_ids = {
        r[0]
        for r in db.query(SCFControl.scf_id)
        .filter(SCFControl.release_id == release_id)
        .all()
        if r[0]
    }
    ao_ids = {
        r[0]
        for r in db.query(SCFObjective.ao_id)
        .filter(SCFObjective.release_id == release_id)
        .all()
        if r[0]
    }
    unknown: List[str] = []
    for tok in tokens:
        if tok in ao_ids or tok in scf_ids:
            continue
        # Parent of an AO token must exist even if AO row is missing in a partial import.
        parent = _parent_scf_id(tok)
        if tok != parent and parent in scf_ids and ao_id_from_token(tok):
            # AO not in catalog yet — still flag as unknown so reviewers notice.
            unknown.append(tok)
            continue
        if parent in scf_ids and tok == parent:
            continue
        unknown.append(tok)
    return unknown
