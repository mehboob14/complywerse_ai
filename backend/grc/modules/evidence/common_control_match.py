"""Which common controls a piece of evidence can stand for, with no model.

The Assurance tab asks, for one control, "which file in the library proves this
artifact?". This asks the reverse, the moment a file exists: "which controls
ask for a document like this?". Each of the 897 SCF controls that carries a
consolidated evidence set names the documents it wants ("Access control
policy", "Backup restoration test report"), in our own words rather than SCF's
prose. Those names are scored against the file with the same matcher the
Assurance tab uses (`automation.evidence_match`), and the controls that ask for
the best-matching artifacts are recommended.

No model is involved, deliberately: SCF's licence (CC BY-ND) does not allow AI
to be given its text, matching must run on every upload, and every
recommendation can be explained by the words it matched. Three signals,
strongest first:

1. **The same artifact, already linked by a person.** A file linked to one control
   as "Access control policy" is very likely the file for every other control
   that asks for it. This reuses a decision rather than guessing.
2. **Text.** The artifact's name (and description) against the file's name,
   type, description, AI summary and extracted text.
3. Controls outside the organisation's scope are left out when the scope is set,
   and controls the file is already linked to are never recommended again.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from grc.modules.automation.evidence_match import (
    EvidenceDoc, _term_weight, artifact_key, document_presence, score_with_presence, tokenize,
)

# A recommendation rests on one artifact, so it is held to a higher bar than the
# Assurance tab's per-artifact list (which uses 25): the file has to cover most of
# what the artifact is called.
MIN_SCORE = 40
SAME_ARTIFACT_SCORE = 95
# One artifact can be required by a hundred controls ("operations security policy"
# is on 137): show a few of each so the list is not one document repeated.
PER_ARTIFACT = 4
LIMIT = 10


def artifact_index(controls: Dict[str, Any]) -> Dict[str, Any]:
    """{"artifacts": {key: {name, description, controls}}, "terms": {term: {keys}}}.

    `controls` is the consolidated evidence file's {scf_id: {"artifacts": [...]}}. Terms are only the
    distinctive words of an artifact's name ("policy" and "report" are in half of them), so one file is
    scored against the few artifacts that share a real word with it, not all of them.
    """
    artifacts: Dict[str, Dict[str, Any]] = {}
    for scf_id, entry in (controls or {}).items():
        for a in (entry or {}).get("artifacts") or []:
            key = artifact_key(a.get("name"))
            if not key:
                continue
            slot = artifacts.setdefault(key, {"name": (a.get("name") or "").strip(),
                                              "description": a.get("description") or "", "controls": []})
            if scf_id not in slot["controls"]:
                slot["controls"].append(scf_id)
    terms: Dict[str, Set[str]] = defaultdict(set)
    for key, slot in artifacts.items():
        words = set(tokenize(slot["name"]))
        distinctive = [w for w in words if _term_weight(w) == 1.0]
        # "Information Security Policy" (asked for by 73 controls) is made only of words every artifact
        # uses; it is indexed under all of them, and its score still needs most of the phrase. A single
        # common word ("Policy") names no document, so it is not indexed at all.
        for t in distinctive or (words if len(words) >= 2 else ()):
            terms[t].add(key)
    return {"artifacts": artifacts, "terms": dict(terms)}


def _reason(matched: Sequence[str], text_only: bool) -> str:
    quoted = ", ".join(f"'{t}'" for t in list(matched)[:3])
    return f"Document text mentions {quoted}" if text_only else f"Name or summary matches {quoted}"


def recommend(
    doc: EvidenceDoc,
    index: Dict[str, Any],
    *,
    applicable: Optional[Set[str]] = None,
    linked_controls: Iterable[str] = (),
    linked_artifacts: Optional[Dict[str, List[str]]] = None,
    names: Optional[Dict[str, str]] = None,
    limit: int = LIMIT,
    per_artifact: int = PER_ARTIFACT,
) -> Dict[str, Any]:
    """The controls this document can evidence, best first.

    `applicable` is the scope's applicable SCF ids (None or empty when no scope is set: every control is
    a candidate). `linked_controls` are controls the file is already on. `linked_artifacts` maps an
    artifact key to the controls where a person linked this file as that artifact. `names` (scf_id ->
    control name) only breaks ties: among controls asking for the same artifact, the one whose own name
    the file also covers comes first, rather than the one that sorts first.
    Returns {"recommendations": [...], "candidate_count": n}.
    """
    artifacts = index["artifacts"]
    already = set(linked_controls)
    linked_artifacts = linked_artifacts or {}
    presence, strongest = document_presence(doc)

    # Artifacts worth scoring: those that share a distinctive word with the file, plus any the file
    # was already linked as.
    keys: Set[str] = set(k for k in linked_artifacts if k in artifacts)
    for term in presence:
        keys |= index["terms"].get(term, set())

    matches: List[Dict[str, Any]] = []
    for key in keys:
        slot = artifacts[key]
        if key in linked_artifacts:
            where = linked_artifacts[key]
            score, signal = SAME_ARTIFACT_SCORE, "same_artifact"
            reason = (f"Already linked as '{slot['name']}' on {', '.join(where[:3])}"
                      + (f" +{len(where) - 3} more" if len(where) > 3 else ""))
        else:
            score, matched, text_only = score_with_presence(slot["name"], slot["description"], presence, strongest, {}, 1)
            if score < MIN_SCORE:
                continue
            signal, reason = "text", _reason(matched, text_only)
        matches.append({"key": key, "name": slot["name"], "score": score, "signal": signal, "reason": reason,
                        "controls": slot["controls"]})

    # A control keeps its best artifact; the others are kept to show what else it asks for that fits.
    best: Dict[str, Dict[str, Any]] = {}
    for m in sorted(matches, key=lambda x: (-x["score"], x["name"])):
        for scf_id in m["controls"]:
            if scf_id in already or (applicable and scf_id not in applicable):
                continue
            cur = best.get(scf_id)
            if cur is None:
                best[scf_id] = {"scf_id": scf_id, "score": m["score"], "artifact": m["name"], "artifact_key": m["key"],
                                "signal": m["signal"], "reason": m["reason"],
                                "also_asked_by": max(len(m["controls"]) - 1, 0), "other_artifacts": []}
            elif m["name"] != cur["artifact"]:
                cur["other_artifacts"].append(m["name"])

    for c in best.values():
        c["rank"] = c["score"] + (score_with_presence(names[c["scf_id"]], "", presence, strongest, {}, 1)[0] / 10
                                  if names and names.get(c["scf_id"]) else 0)
    ranked = sorted(best.values(), key=lambda c: (-c["rank"], c["also_asked_by"], c["scf_id"]))
    picked: List[Dict[str, Any]] = []
    taken: Dict[str, int] = defaultdict(int)
    for c in ranked:
        if taken[c["artifact_key"]] >= per_artifact:
            continue
        taken[c["artifact_key"]] += 1
        picked.append(c)
        if len(picked) >= limit:
            break
    return {"recommendations": picked, "candidate_count": len(ranked)}
