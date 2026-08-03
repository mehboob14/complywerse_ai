"""Runtime lookup of the technique-level threat-intel association — which actors and
malware/tools MITRE records as USING a technique.

Read-only over the distilled seed (``seed_data/attack/threat_intel_map.json``),
lazy-loaded once, no network call. This layer is DERIVED: it is a pure function of the
chain's techniques (already in the assessment hash) and the catalogue version (already
on the snapshot header), so it carries no independent state and never enters the hash
— Phase 3 is untouched, and a v20 re-ingest that reassigns actors surfaces through the
normal re-render.

The ONLY claim it produces is technique-level — "the techniques in this chain are used
by these actors". There is NO CVE→actor link in the source and none is manufactured;
the honesty rides on binding each actor list to the specific technique that carries it.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# grc/modules/vuln_management/attack/ -> grc/seed_data/attack/
_SEED = Path(__file__).resolve().parents[3] / "seed_data" / "attack" / "threat_intel_map.json"

# Names to show per technique before the count carries the rest — some techniques
# (T1190) are used by 40+ groups; a full dump would drown the signal.
PER_TECHNIQUE_CAP = 12

_DATA = None


def _load() -> dict:
    global _DATA
    if _DATA is None:
        try:
            _DATA = json.loads(_SEED.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("threat-intel seed failed to load from %s", _SEED)
            _DATA = {"technique_actors": {}, "technique_software": {},
                     "attack_version": None, "attribution": ""}
    return _DATA


def reload_seed() -> None:
    """Drop the cached seed (after a re-ingest)."""
    global _DATA
    _DATA = None


def for_chain(chain) -> dict:
    """Given the assessment chain (technique dicts with technique_id/name/tactic_name),
    return the threat-intel section: per-technique actor/software associations plus a
    distinct-union headline count. Techniques with no association are omitted (so a
    greyed/empty technique never implies "no actors" falsely). Empty ``by_technique``
    means the chain's techniques carry no MITRE group/software mapping.
    """
    data = _load()
    tech_actors = data.get("technique_actors", {})
    tech_software = data.get("technique_software", {})

    by_technique = []
    union_actors: dict = {}
    union_software: dict = {}
    for t in chain or []:
        tid = t.get("technique_id")
        actors = tech_actors.get(tid) or []
        software = tech_software.get(tid) or []
        if not actors and not software:
            continue
        for a in actors:
            union_actors[a["id"]] = a
        for s in software:
            union_software[s["id"]] = s
        by_technique.append({
            "technique_id": tid,
            "name": t.get("name"),
            "tactic_name": t.get("tactic_name"),
            "actors": actors[:PER_TECHNIQUE_CAP],
            "actor_total": len(actors),
            "software": software[:PER_TECHNIQUE_CAP],
            "software_total": len(software),
        })

    return {
        "attack_version": data.get("attack_version"),
        "attribution": data.get("attribution"),
        "by_technique": by_technique,
        "actor_total": len(union_actors),
        "software_total": len(union_software),
    }
