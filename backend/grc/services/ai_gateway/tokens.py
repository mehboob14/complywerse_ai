"""Placeholders and their restoration.

A found value is replaced by ``<TYPE_n>`` (``<PERSON_1>``, ``<IP_PRIV_2>``), numbered by first appearance within one
call, so the same value always gets the same placeholder and a retry of the same text gives the same ones. The
placeholder is keyed by the **exact** string, not a case-folded one, so restoring it gives back exactly what was
there and the verbatim-quote checks the call sites run keep working.

The model's answer is restored before anything reads it: a bare ``<PERSON_1>``, a bracket or case variation of it
("[person_1]", "< PERSON_1 >") and a bare ``PERSON_1`` all map back, but only for placeholders this call issued. When the
answer is JSON the restored value is JSON-escaped, so a value containing a quote or a newline cannot break the document.
A placeholder with a known type but an unknown number is the model's invention and is removed, never guessed.
"""
from __future__ import annotations

import json
import re
from typing import Dict, Iterable, Set, Tuple

TOKEN = re.compile(r"<([A-Z][A-Z_]*?)_(\d+)>")
REMOVED = re.compile(r"<REMOVED_[A-Z_]+>")
_FENCE = re.compile(r"```[A-Za-z]*\s*(.*?)\s*```$", re.S)


def removed_marker(entity_type: str) -> str:
    """What stands where a secret or an account/identity number was: it is never restored."""
    return f"<REMOVED_{entity_type}>"


class TokenMap:
    """The placeholders issued during one call and the values they stand for."""

    def __init__(self, texts: Iterable[str] = ()):
        # placeholders already present in the input (text produced by an earlier stage) must not be issued again
        self._reserved: Set[Tuple[str, int]] = {(m.group(1), int(m.group(2))) for t in texts for m in TOKEN.finditer(t)}
        self._next: Dict[str, int] = {}
        self._by_value: Dict[Tuple[str, str], str] = {}
        self.values: Dict[Tuple[str, int], str] = {}

    def token(self, label: str, value: str) -> str:
        key = (label, value)
        if key in self._by_value:
            return self._by_value[key]
        n = self._next.get(label, 0)
        while True:
            n += 1
            if (label, n) not in self._reserved:
                break
        self._next[label] = n
        token = f"<{label}_{n}>"
        self._by_value[key] = token
        self.values[(label, n)] = value
        return token

    def is_reserved(self, label: str, n: int) -> bool:
        """A placeholder that was in the input already (not ours): left as it is if the answer repeats it."""
        return (label, n) in self._reserved

    @property
    def labels(self) -> Set[str]:
        return {label for label, _ in self.values}

    def __len__(self) -> int:
        return len(self.values)


def mask_tokens(text: str) -> str:
    """The text with every placeholder and removal marker blanked (same length, so offsets still line up), for
    scanning what is left. The filler is ``<``: spaces would let the word after ``password=<REMOVED_SECRET>`` look
    like the password, and no value pattern accepts a leading ``<``."""
    blank = lambda m: "<" * len(m.group(0))  # noqa: E731
    return REMOVED.sub(blank, TOKEN.sub(blank, text))


def is_json(text: str) -> bool:
    """Whether the text is a JSON document (bare or in a code fence): a restored value must then be JSON-escaped."""
    s = text.strip()
    fenced = _FENCE.match(s)
    if fenced:
        s = fenced.group(1)
    if not s or s[0] not in "[{":
        return False
    try:
        json.loads(s)
    except ValueError:
        return False
    return True


def restore(text: str, scope: TokenMap) -> Tuple[str, Dict[str, int]]:
    """Put the original values back. Returns the text and ``{"restored": n, "unknown": n}``."""
    stats = {"restored": 0, "unknown": 0}
    if not text or not len(scope):
        return text, stats
    alt = "|".join(re.escape(label) for label in sorted(scope.labels, key=len, reverse=True))
    bracketed = re.compile(rf"(?i)[<\[{{(]\s*({alt})\s*_\s*(\d+)\s*[>\]}})]")
    bare = re.compile(rf"(?i)(?<![\w<\[{{(])({alt})_(\d+)(?!\w)")
    escape = is_json(text)

    def swap(m: "re.Match", is_bracketed: bool) -> str:
        label, n = m.group(1).upper(), int(m.group(2))
        value = scope.values.get((label, n))
        if value is None:
            if is_bracketed and not scope.is_reserved(label, n):
                stats["unknown"] += 1
                return "[removed]"
            return m.group(0)
        stats["restored"] += 1
        return json.dumps(value, ensure_ascii=False)[1:-1] if escape else value

    text = bracketed.sub(lambda m: swap(m, True), text)
    text = bare.sub(lambda m: swap(m, False), text)
    return text, stats
