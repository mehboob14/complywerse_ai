"""The change-detection hash for exploitability history (Phase 3).

Persistence writes a new ReachabilitySnapshot ONLY when the MATERIAL content of an
assessment changes — never on a re-render (the live view is free via build_view).
This module defines, in exactly one place, WHAT counts as material: the fields
whose change is a genuine audit event. "What counts as a change" is the history
table's whole contract, so it lives here and nowhere else.

HASHED SET — and nothing else:
  * verdict                       — the top-line finding
  * per technique, sorted by id:  technique_id, status, mapping_source,
                                   mapping_confidence, assumed

DELIBERATELY EXCLUDED (each would flap the hash and drag us back to write-on-read):
  * assessed_at / evaluated_at    — a fresh timestamp every call. Verified: it
                                    changes run-to-run while the hashed set does not,
                                    so its exclusion is load-bearing, not cosmetic.
  * the AI narration              — non-deterministic prose; hashing it would flag a
                                    change on every expand. It is stored WITH the
                                    snapshot, never IN the hash.
  * verdict_reason wording, counts, signal_pct, evidence blurbs, mitigations —
                                    derived from the hashed set or incidental; a
                                    change there carries no audit meaning.

To make a new field's change an audit event, add it HERE (and it will start writing
snapshots). Never widen the set incidentally.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict


def material_fields(view: Dict[str, Any]) -> Dict[str, Any]:
    """The exact fields whose change is an audit event, in canonical (sorted) form so
    the hash is order-independent and stable across runs."""
    chain = view.get("chain") or []
    return {
        "verdict": (view.get("verdict") or {}).get("verdict"),
        "techniques": sorted(
            [
                [
                    t.get("technique_id"),
                    t.get("status"),
                    t.get("mapping_source"),
                    t.get("mapping_confidence"),
                    bool(t.get("assumed")),
                ]
                for t in chain
            ]
        ),
    }


def assessment_hash(view: Dict[str, Any]) -> str:
    """Stable SHA-256 over the material fields only. Two assessments with identical
    material content hash the same regardless of timestamp or narration."""
    canonical = json.dumps(material_fields(view), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
