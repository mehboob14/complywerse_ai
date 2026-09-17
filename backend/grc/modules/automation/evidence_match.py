"""Find evidence already in the library that could satisfy a required artifact.

Pure functions, no database, no model. The Assurance tab asks "does the tenant
already hold something that proves 'Business Continuity Plan' for this
control?" and this answers with a ranked list, each suggestion carrying the
reason it was made, because an assessor has to be able to see why a file was
put forward before accepting it.

Signals, strongest first:

1. **The same artifact, already linked on another control.** Artifact names
   repeat across controls ("operations security policy" is required on 137),
   so a file a person linked as that artifact once is very likely the file for
   every other control asking for it. This is a person's decision being
   reused, not a guess.
2. **Linked to a framework control that maps to this control.** The crosswalk
   graph already says the two controls ask for the same thing.
3. **Text.** The artifact's name and description (our own consolidated text,
   never SCF prose) scored against the evidence's name, type, description,
   AI summary and extracted document text, weighted by how rare each term is
   in this tenant's library — "continuity" is informative, "policy" is not.

No model is involved, deliberately. Matching runs on every open of the tab
across every artifact, it must be explainable term by term, and a model call
would have to keep SCF text out of the prompt.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

_TOKEN = re.compile(r"[a-z0-9]+")

# Grammatical noise — dropped outright.
_STOPWORDS = frozenset("""
a an and are as at be been by can for from has have in into is it its of on or
that the their this to was were which with within without all any each every
other such than then there these those via per upon also must shall should
will may including include includes including e g i ie etc
""".split())

# Words every compliance artifact uses. Kept, but counted at a third of their
# weight: with a small library, rarity alone can't tell that "policy" says
# nothing — every tenant's first ten uploads might all be policies.
_GENERIC = frozenset("""
policy policies procedure procedures record records report reports document
documents documentation evidence plan plans process processes management
information security control controls log logs register list approved approval
annual review reviews standard standards program programme framework formal
""".split())
_GENERIC_WEIGHT = 1 / 3

# How much a term found in a given field counts toward "the document is about
# this": a term in the file's name or AI summary is strong, the same term buried
# in forty pages of extracted text is weaker.
FIELD_PRESENCE = {"name": 1.0, "summary": 1.0, "description": 0.9, "type": 0.8, "text": 0.7}
TEXT_CHARS = 8000          # enough of a document to know what it is about
MIN_TEXT_SCORE = 25        # below this a text-only match is not worth showing
# Rarity only means something once there is a library to be rare in. With a
# handful of uploads every term is "rare", so IDF would just be noise.
_RARITY_MIN_DOCS = 20


def artifact_key(name: Optional[str]) -> str:
    """Identity for an artifact across controls: its name, normalised.

    Consolidated artifacts have no id of their own, but their names are
    already consistent — the same document is named the same way on every
    control that asks for it — so the normalised name is the join key.
    """
    return " ".join(_TOKEN.findall((name or "").lower()))


def _stem(tok: str) -> str:
    # Just enough to meet plurals halfway: records/record, policies/policy.
    if len(tok) > 4 and tok.endswith("ies"):
        return tok[:-3] + "y"
    if len(tok) > 4 and tok.endswith("s") and not tok.endswith("ss"):
        return tok[:-1]
    return tok


_GENERIC_STEMS = frozenset(_stem(g) for g in _GENERIC)


def tokenize(text: Optional[str]) -> List[str]:
    return [_stem(t) for t in _TOKEN.findall((text or "").lower()) if t not in _STOPWORDS and len(t) > 1]


def _term_weight(term: str) -> float:
    return _GENERIC_WEIGHT if term in _GENERIC_STEMS else 1.0


@dataclass
class EvidenceDoc:
    """What a matcher can know about one library item."""
    id: int
    name: str = ""
    evidence_type: str = ""
    description: str = ""
    summary: str = ""
    text: str = ""
    file_name: str = ""
    status: str = ""
    is_stale: bool = False
    expired: bool = False
    _fields: Dict[str, Dict[str, int]] = field(default_factory=dict, repr=False)

    def fields(self) -> Dict[str, Dict[str, int]]:
        if not self._fields:
            src = {
                "name": f"{self.name} {self.file_name}",
                "type": self.evidence_type,
                "description": self.description,
                "summary": self.summary,
                "text": (self.text or "")[:TEXT_CHARS],
            }
            for fname, value in src.items():
                counts: Dict[str, int] = {}
                for t in tokenize(value):
                    counts[t] = counts.get(t, 0) + 1
                self._fields[fname] = counts
        return self._fields

    def terms(self) -> Set[str]:
        out: Set[str] = set()
        for counts in self.fields().values():
            out.update(counts)
        return out


@dataclass
class Suggestion:
    evidence_id: int
    score: int
    signal: str                 # "same_artifact" | "crosswalk" | "text"
    reasons: List[str]


def document_frequencies(docs: Sequence[EvidenceDoc]) -> Dict[str, int]:
    df: Dict[str, int] = {}
    for d in docs:
        for t in d.terms():
            df[t] = df.get(t, 0) + 1
    return df


def _rarity(term: str, df: Dict[str, int], n_docs: int) -> float:
    """1.0 for a term few documents use, down to 0.3 for one nearly all do."""
    if n_docs < _RARITY_MIN_DOCS:
        return 1.0
    share = df.get(term, 0) / n_docs
    return max(0.3, 1.0 - share)


def _coverage(terms: Set[str], presence: Dict[str, float], df: Dict[str, int], n_docs: int) -> float:
    weights = {t: _term_weight(t) * _rarity(t, df, n_docs) for t in terms}
    total = sum(weights.values())
    return sum(w * presence.get(t, 0.0) for t, w in weights.items()) / total if total else 0.0


def text_score(artifact_name: str, artifact_description: str, doc: EvidenceDoc,
               df: Dict[str, int], n_docs: int) -> Tuple[int, List[str], bool]:
    """(0-100, matched name terms, whether every match came only from extracted text).

    The artifact's NAME says what the document is, so the score is mostly how
    much of the name the document covers; the description only adds support.
    Coverage is measured as a share of the artifact's own terms, so a two-word
    artifact and a long one mean the same thing at the same score, and terms
    that appear in no document never inflate the denominator the way a rarity-
    weighted maximum did.
    """
    name_terms = set(tokenize(artifact_name))
    if not name_terms:
        return 0, [], False
    desc_terms = set(tokenize(artifact_description)) - name_terms
    fields = doc.fields()

    presence: Dict[str, float] = {}
    strongest_field: Dict[str, str] = {}
    for fname, counts in fields.items():
        for term in counts:
            # Two-letter acronyms (AI, HR, DR, IT) are everywhere in prose: an
            # evidence summary reading "Unable to parse AI response" once made
            # an encryption policy the top match for "AI Policy". They count only
            # when they are part of what the file is called.
            if len(term) <= 2 and fname != "name":
                continue
            if FIELD_PRESENCE[fname] > presence.get(term, 0.0):
                presence[term] = FIELD_PRESENCE[fname]
                strongest_field[term] = fname

    distinctive = {t for t in name_terms if _term_weight(t) == 1.0}
    matched = sorted(t for t in distinctive if presence.get(t))
    # A document sharing none of the name's distinctive words is about something
    # else, however much compliance boilerplate it shares.
    if distinctive and not matched:
        return 0, [], False

    name_cov = _coverage(name_terms, presence, df, n_docs)
    if desc_terms:
        score = 0.75 * name_cov + 0.25 * _coverage(desc_terms, presence, df, n_docs)
    else:
        score = name_cov
    hit_fields = {strongest_field[t] for t in name_terms | desc_terms if t in strongest_field}
    return round(100 * score), matched or sorted(t for t in name_terms if presence.get(t)), hit_fields == {"text"}


def rank(
    artifact_name: str,
    artifact_description: str,
    docs: Sequence[EvidenceDoc],
    *,
    df: Optional[Dict[str, int]] = None,
    same_artifact: Optional[Dict[int, List[str]]] = None,
    crosswalk: Optional[Dict[int, List[str]]] = None,
    exclude: Iterable[int] = (),
    limit: int = 3,
) -> List[Suggestion]:
    """Rank library items for one required artifact.

    `same_artifact` maps evidence id → controls where a person linked it as this
    artifact; `crosswalk` maps evidence id → framework controls it is linked to
    that map to this control; `exclude` is what is already linked here.
    """
    excluded = set(exclude)
    same_artifact = same_artifact or {}
    crosswalk = crosswalk or {}
    df = df if df is not None else document_frequencies(docs)
    n = max(len(docs), 1)
    out: List[Suggestion] = []

    for doc in docs:
        if doc.id in excluded or (doc.status or "").lower() == "rejected":
            continue
        reasons: List[str] = []
        if doc.id in same_artifact:
            where = same_artifact[doc.id]
            reasons.append(f"Linked as '{artifact_name}' on {', '.join(where[:3])}"
                           + (f" +{len(where) - 3} more" if len(where) > 3 else ""))
            score, signal = 95, "same_artifact"
        elif doc.id in crosswalk:
            where = crosswalk[doc.id]
            reasons.append(f"Linked to {', '.join(where[:2])}, which maps to this control")
            score, signal = 70, "crosswalk"
        else:
            score, terms, text_only = text_score(artifact_name, artifact_description, doc, df, n)
            if score < MIN_TEXT_SCORE:
                continue
            signal = "text"
            quoted = ", ".join(f"'{t}'" for t in terms[:3])
            reasons.append(f"Document text mentions {quoted}" if text_only else f"Name or summary matches {quoted}")

        # Freshness and review state are facts about the file, not its topic:
        # an expired policy is still the right document, but it no longer proves
        # anything until it is renewed, so it ranks below a current one.
        if doc.expired or doc.is_stale:
            score = round(score * 0.6)
            reasons.append("Expired — renew before relying on it")
        elif (doc.status or "").lower() in ("draft", "pending_review"):
            score = round(score * 0.9)
            reasons.append("Not yet approved")
        out.append(Suggestion(doc.id, score, signal, reasons))

    out.sort(key=lambda s: (-s.score, s.evidence_id))
    return out[:limit]
