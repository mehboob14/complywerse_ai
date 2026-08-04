"""Framework template definitions loaded from seed JSON.

Each file in seed_data/framework_templates/<framework_key>.json defines a
framework's register + document tabs (parsed from the official templates). The
generic register/document engine renders these, so adding a framework is data,
not code. ISO 27001 keeps its own hand-tuned (hardcoded) tabs and is NOT in this
registry.
"""
import os
import re
import glob
import json
import threading
from typing import Any, Dict, List, Optional

_DEFS: Optional[Dict[str, dict]] = None
_LOCK = threading.Lock()
_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "seed_data", "framework_templates")


def _load() -> Dict[str, dict]:
    global _DEFS
    if _DEFS is not None:
        return _DEFS
    with _LOCK:
        if _DEFS is not None:
            return _DEFS
        defs: Dict[str, dict] = {}
        for path in glob.glob(os.path.join(_DIR, "*.json")):
            if os.path.basename(path).startswith("_"):
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    d = json.load(f)
                key = d.get("framework_key")
                if key:
                    defs[key] = d
            except Exception:
                continue
        _DEFS = defs
        return defs


def all_definitions() -> Dict[str, dict]:
    return _load()


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def match_definition(framework_name: Optional[str]) -> Optional[dict]:
    """Match a framework display name to its definition via name_patterns."""
    n = _norm(framework_name)
    if not n:
        return None
    for d in _load().values():
        for pat in d.get("name_patterns", []):
            if _norm(pat) and _norm(pat) in n:
                return d
    return None


def register_def(register_type: str) -> Optional[dict]:
    for d in _load().values():
        for r in d.get("registers", []):
            if r.get("type") == register_type:
                return r
    return None


def document_def(doc_type: str) -> Optional[dict]:
    for d in _load().values():
        for doc in d.get("documents", []):
            if doc.get("type") == doc_type:
                return doc
    return None


def all_register_types() -> set:
    return {r.get("type") for d in _load().values() for r in d.get("registers", [])}


def all_doc_types() -> set:
    return {doc.get("type") for d in _load().values() for doc in d.get("documents", [])}
