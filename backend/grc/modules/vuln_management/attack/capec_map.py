"""CWE -> CAPEC -> ATT&CK lookup — the standards-based half of Layer 2 selection.

Reads ``seed_data/attack/cwe_technique_map.json`` (built by
``scripts/ingest_capec_mapping.py``) into memory once. Given a CWE, returns the
techniques the published CAPEC chain maps it to, each carrying its CAPEC
provenance so the UI can show *why* a technique was selected.

Read the honest coverage note before relying on this as a primary selector:
the chain reaches only ~149 CWEs and ~25% of techniques, and misses the common
web-app weaknesses (SQLi/XSS/command-injection/path-traversal) entirely — see
the ingest script's module docstring. In the selection layer this is the
high-confidence ``capec_chain`` tier, unioned with the deterministic
CVSS-vector rules (which carry the entry-tactic techniques) and a small curated
gap-filler. It is not the backbone on its own.

Same failure posture as the catalogue: missing/unreadable file -> empty lookup,
every call returns [], nothing raises.
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

MAP_PATH = (
    Path(__file__).resolve().parents[3] / "seed_data" / "attack" / "cwe_technique_map.json"
)

# 'CWE-89', 'cwe 89', '89' -> '89'. The file keys on the bare number.
_CWE_RE = re.compile(r"(\d+)")

_lock = threading.Lock()
_payload: Dict[str, object] = {}
_cwe_techniques: Dict[str, list] = {}
_capec: Dict[str, dict] = {}
_loaded_at: Optional[datetime] = None
_load_attempted = False
_load_error: Optional[str] = None


def _read_file() -> Optional[dict]:
    try:
        with MAP_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logger.warning(
            "CWE->technique map missing at %s — run scripts/ingest_capec_mapping.py. "
            "CAPEC-chain selection will be empty until then.",
            MAP_PATH,
        )
        return None
    except Exception as exc:
        logger.exception("CWE->technique map unreadable at %s: %s", MAP_PATH, exc)
        return None


def _ensure_loaded() -> None:
    global _load_attempted, _payload, _cwe_techniques, _capec, _loaded_at, _load_error
    if _load_attempted:
        return
    with _lock:
        if _load_attempted:
            return
        _load_attempted = True
        payload = _read_file()
        if payload is None:
            _load_error = f"map not loaded from {MAP_PATH}"
            return
        _payload = payload
        _cwe_techniques = payload.get("cwe_techniques") or {}
        _capec = payload.get("capec") or {}
        _loaded_at = datetime.utcnow()
        _load_error = None
        logger.info(
            "CWE->technique map loaded: CAPEC v%s, %d CWEs, %d techniques",
            payload.get("capec_version"),
            len(_cwe_techniques),
            (payload.get("counts") or {}).get("distinct_techniques_reached"),
        )


def reload_map() -> bool:
    global _load_attempted
    payload = _read_file()
    if payload is None:
        return False
    with _lock:
        global _payload, _cwe_techniques, _capec, _loaded_at, _load_error
        _payload = payload
        _cwe_techniques = payload.get("cwe_techniques") or {}
        _capec = payload.get("capec") or {}
        _loaded_at = datetime.utcnow()
        _load_error = None
        _load_attempted = True
    return True


def normalise_cwe(raw: Optional[str]) -> Optional[str]:
    """'CWE-89' / 'cwe 89' / '89' / 89 -> '89'. None if no number present."""
    if raw is None:
        return None
    m = _CWE_RE.search(str(raw))
    return m.group(1) if m else None


def techniques_for_cwe(cwe: Optional[str]) -> List[dict]:
    """CAPEC-chain techniques for one CWE. Each record carries via_capec /
    capec_name / capec_abstraction / mapping_fit provenance. [] if none — which
    is the common case for web-app CWEs, by design not by bug.
    """
    key = normalise_cwe(cwe)
    if not key:
        return []
    _ensure_loaded()
    return list(_cwe_techniques.get(key) or [])


def techniques_for_cwes(cwes) -> List[dict]:
    """Union across several CWEs, de-duplicated by technique_id. A technique
    reached through more than one CWE keeps the union of its CAPEC provenance.
    """
    _ensure_loaded()
    merged: Dict[str, dict] = {}
    for cwe in cwes or []:
        for link in techniques_for_cwe(cwe):
            tid = link["technique_id"]
            if tid not in merged:
                merged[tid] = dict(link)
            else:
                existing = merged[tid]
                for c in link.get("via_capec") or []:
                    if c not in existing["via_capec"]:
                        existing["via_capec"].append(c)
    return sorted(merged.values(), key=lambda l: (l.get("order") if l.get("order") is not None else 99, l["technique_id"]))


def has_cwe(cwe: Optional[str]) -> bool:
    key = normalise_cwe(cwe)
    if not key:
        return False
    _ensure_loaded()
    return key in _cwe_techniques


def get_capec(capec_id: Optional[str]) -> Optional[dict]:
    """CAPEC metadata (name, abstraction, techniques) by id ('66' or 'CAPEC-66')."""
    if capec_id is None:
        return None
    key = _CWE_RE.search(str(capec_id))
    if not key:
        return None
    _ensure_loaded()
    return _capec.get(key.group(1))


def map_status() -> dict:
    _ensure_loaded()
    return {
        "loaded": _loaded_at is not None,
        "loaded_at": _loaded_at.isoformat() if _loaded_at else None,
        "path": str(MAP_PATH),
        "error": _load_error,
        "capec_version": _payload.get("capec_version"),
        "capec_date": _payload.get("capec_date"),
        "validated_against_attack_version": _payload.get("validated_against_attack_version"),
        "generated_at": _payload.get("generated_at"),
        "counts": _payload.get("counts") or {},
    }
