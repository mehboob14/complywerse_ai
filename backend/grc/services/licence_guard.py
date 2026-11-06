"""Keep SCF text away from language models.

The Secure Controls Framework is CC BY-ND 4.0, and its guidebook (GEN-FAQ-006)
prohibits using AI to leverage SCF content to generate policies, standards,
procedures, metrics, risks, threats or other derivative content. NOTICE.md
asserts that no SCF prose reaches a model anywhere in this codebase.

That claim was false in six places when it was checked (2026-09-16): each read
`NormalizedControl.name/statement/objective` — verbatim SCF text on rows with
`source='scf'` — and put it in a prompt without looking at the source. Every
tenant's control library is SCF, so every one of those features leaked.

Two layers, because either alone is not enough:

* **At the call sites** — `is_restricted_control` / `exclude_restricted` let a
  feature degrade deliberately (use our own text, or say it is unavailable)
  instead of erroring. Each known path uses them.

* **At the choke point** — `assert_llm_safe` runs inside the OpenAI shim in
  `config.py`, which every chat completion already passes through. It refuses
  any prompt carrying a verbatim run of SCF prose, whichever code built it.
  That is what keeps the NOTICE.md claim true for paths nobody has found yet,
  and for ones written after this.

How the choke point recognises SCF prose: every run of 12 consecutive words
from SCF's own long-form text (control descriptions and questions, assessment
objectives, evidence-request descriptions, maturity criteria, solutions) is
fingerprinted. SCF sentences of 6-11 words are matched as whole phrases.
Anything shorter is not — a control *name* like "Multi-Factor Authentication"
is a phrase anyone writes, and the call-site guards cover names.

Wording SCF shares verbatim with the framework libraries we ship is dropped
from the fingerprint. SCF quotes its sources — measured, 56 of 12,035 framework
texts share a 12-word run with SCF, 27 of them NIST SP 800-53, which is public
domain. Blocking those runs would refuse legitimate prompts over text that is
not SCF's to restrict. What remains is SCF's own expression, and our
consolidated evidence text measured zero hits against it.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, FrozenSet, Iterable, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: `NormalizedControl.source` values whose text may not reach a model.
RESTRICTED_SOURCES: FrozenSet[str] = frozenset({"scf"})

_SHINGLE = 12
# Fingerprint every 4th window. Any verbatim run of 15+ words therefore contains
# at least one fingerprinted window, at a quarter of the memory. The prompt side
# is scanned at every position.
_STRIDE = 4
_WORD = re.compile(r"[a-z0-9]+")
_SEED = Path(__file__).resolve().parent.parent / "seed_data"


class LicenceRestrictedContent(RuntimeError):
    """A prompt carried licence-restricted text, so it was not sent."""


# ── call-site helpers ───────────────────────────────────────────────────────
def is_restricted_control(control: Any) -> bool:
    """True when a NormalizedControl's name, statement and objective are SCF text."""
    return (getattr(control, "source", None) or "").strip().lower() in RESTRICTED_SOURCES


def exclude_restricted(query, model):
    """Narrow a NormalizedControl query to rows whose text may reach a model.

    `source NOT IN (...)` alone would also drop NULL sources — SQL treats
    `NULL NOT IN` as unknown — and those are ordinary tenant-authored rows.
    """
    from sqlalchemy import or_

    return query.filter(or_(model.source.is_(None), model.source.notin_(RESTRICTED_SOURCES)))


# ── choke point ─────────────────────────────────────────────────────────────
def _words(text: str) -> List[str]:
    return _WORD.findall(text.lower())


def _windows(words: List[str], stride: int) -> Iterator[str]:
    for i in range(0, len(words) - _SHINGLE + 1, stride):
        yield " ".join(words[i:i + _SHINGLE])


def _flatten(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _flatten(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _flatten(v)


def _load(name: str) -> Any:
    return json.loads((_SEED / "scf" / name).read_text(encoding="utf-8"))


def _scf_texts() -> Iterator[str]:
    controls = _load("controls.json")
    controls = controls if isinstance(controls, list) else controls.get("controls", [])
    for c in controls:
        for field in ("description", "control_question", "risk_if_not_implemented", "solutions"):
            yield from _flatten(c.get(field))

    objectives = _load("objectives.json")
    objectives = objectives if isinstance(objectives, list) else objectives.get("objectives", [])
    for o in objectives:
        yield from _flatten(o.get("objective"))

    erl = _load("erl.json")
    if isinstance(erl, dict):
        erl = next((v for v in erl.values() if isinstance(v, list)), [])
    for e in erl:
        yield from _flatten(e.get("description"))

    cmm = _load("cmm_levels.json")
    yield from _flatten(cmm.get("cmm_levels", {}) if isinstance(cmm, dict) else cmm)

    domains = _load("domains.json")
    if isinstance(domains, dict):
        domains = next((v for v in domains.values() if isinstance(v, list)), [])
    for d in domains:
        for field in ("intent", "principles"):
            yield from _flatten(d.get(field))


def _framework_texts() -> Iterator[str]:
    for path in sorted((_SEED / "frameworks").glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — one unreadable library must not disable the guard
            continue
        yield from _flatten(data.get("controls") if isinstance(data, dict) else data)


@lru_cache(maxsize=1)
def scf_fingerprints() -> FrozenSet[str]:
    """12-word windows of SCF's own prose, minus wording framework texts share.

    Empty when the SCF seed is not present: a deployment without SCF data has
    nothing to protect, so the guard opens rather than refusing every prompt.
    """
    try:
        prints = set()
        for text in _scf_texts():
            words = _words(text)
            if len(words) >= _SHINGLE:
                prints.update(_windows(words, _STRIDE))
    except Exception:  # noqa: BLE001
        logger.warning("licence_guard: SCF seed not loadable; model prompts are not screened", exc_info=True)
        return frozenset()

    for text in _framework_texts():
        words = _words(text)
        if len(words) >= _SHINGLE:
            prints.difference_update(_windows(words, 1))
    return frozenset(prints)


#: Below this many real words (3+ letters) a phrase is a name or a label, not a
#: sentence. Counting every token let "Security Testing & Evaluation (ST&E)"
#: through as six words — "st" and "e" — and refused our own artifact title.
_SHORT_MIN = 6


def _real_words(words: List[str]) -> int:
    return sum(1 for w in words if len(w) >= 3)


@lru_cache(maxsize=1)
def short_fingerprints() -> FrozenSet[str]:
    """SCF sentences too short for a 12-word window, as exact word sequences.

    Measured: 5,303 SCF texts are 6-11 words long — short objectives, terse
    control descriptions — and the 12-word fingerprint cannot see any of them,
    so a single-control prompt for one of those controls passed intact. They
    are matched as whole phrases instead, again minus any phrase that also
    occurs in the framework libraries.
    """
    try:
        phrases = set()
        for text in _scf_texts():
            words = _words(text)
            if len(words) < _SHINGLE and _real_words(words) >= _SHORT_MIN:
                phrases.add(" ".join(words))
    except Exception:  # noqa: BLE001
        return frozenset()

    lengths = sorted({p.count(" ") + 1 for p in phrases})
    firsts = {p.split(" ", 1)[0] for p in phrases}
    for text in _framework_texts():
        words = _words(text)
        for i, w in enumerate(words):
            if w not in firsts:
                continue
            for n in lengths:
                if i + n > len(words):
                    break
                phrases.discard(" ".join(words[i:i + n]))
    return frozenset(phrases)


@lru_cache(maxsize=1)
def _short_index() -> Dict[str, Tuple[int, ...]]:
    """Opening word pair -> the phrase lengths that start with it.

    Lets the scan test one pair per position and build a full phrase only when
    an SCF sentence could actually start there.
    """
    index: Dict[str, set] = {}
    for p in short_fingerprints():
        words = p.split(" ")
        index.setdefault(f"{words[0]} {words[1]}", set()).add(len(words))
    return {k: tuple(sorted(v)) for k, v in index.items()}


def find_restricted(text: str) -> Optional[str]:
    """The first run of SCF prose found in `text`, or None."""
    if not text:
        return None
    words = _words(text)

    prints = scf_fingerprints()
    if prints:
        for window in _windows(words, 1):
            if window in prints:
                return window

    short = short_fingerprints()
    if short:
        index = _short_index()
        for i in range(len(words) - 1):
            lengths = index.get(f"{words[i]} {words[i + 1]}")
            if not lengths:
                continue
            for n in lengths:
                if i + n > len(words):
                    break
                phrase = " ".join(words[i:i + n])
                if phrase in short:
                    return phrase
    return None


def _message_texts(messages: Iterable[Any]) -> Iterator[str]:
    for m in messages or ():
        content = m.get("content") if isinstance(m, dict) else getattr(m, "content", None)
        if isinstance(content, str):
            yield content
        elif isinstance(content, list):  # multi-part: [{"type": "text", "text": ...}, image parts]
            for part in content:
                text = part.get("text") if isinstance(part, dict) else None
                if isinstance(text, str):
                    yield text


def assert_llm_safe(messages: Iterable[Any]) -> None:
    """Raise LicenceRestrictedContent if any message carries SCF prose."""
    for text in _message_texts(messages):
        hit = find_restricted(text)
        if hit:
            logger.error(
                "Refused a model call carrying SCF text (CC BY-ND, no AI derivatives): %r", hit,
            )
            raise LicenceRestrictedContent(
                "This request included Secure Controls Framework text, which its licence "
                "does not allow to be sent to an AI model."
            )


# ── what features use instead ───────────────────────────────────────────────
def consolidated_recommendations(scf_id: Optional[str]) -> List[dict]:
    """Evidence recommendations for an SCF control, taken from our consolidated set.

    AI evidence recommenders cannot read an SCF control, so for those controls
    they return this instead: the artefacts assessors actually collect, merged
    across every framework that maps to the control. It is deterministic, cites
    no SCF prose, and is a better answer than the model's generic list anyway.
    Shaped like the recommenders' model output so callers persist it unchanged.
    """
    if not scf_id:
        return []
    try:
        from ..modules.automation.router import _consolidated_evidence
        artifacts = (_consolidated_evidence().get(scf_id) or {}).get("artifacts") or []
    except Exception:  # noqa: BLE001
        return []
    return [
        {
            "evidence_type": (a.get("name") or "Evidence")[:100],
            "description": a.get("description") or "",
            "priority": "high" if a.get("mandatory") else "medium",
            "confidence": None,
            "reasoning": (
                f"From the consolidated evidence set for SCF {scf_id} "
                f"({a.get('collection_method') or 'manual'} collection). Not AI-generated: "
                "SCF's licence does not allow its text to be sent to an AI model."
            ),
            "sample_names": [],
        }
        for a in artifacts
    ]
