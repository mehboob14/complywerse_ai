"""References the person names in a request are attached by themselves.

"Update this policy following ISO 27001 and PCI DSS" attaches the platform's ISO/IEC 27001 and PCI DSS frameworks (when the
platform has them) before Comply Agent reads the request, so it can cite their clauses and its quotes can be checked; "align it
with our Access Control Policy" or "POL-007" attaches that library document. A name the platform does not hold (FFIEC, GLBA) is
left to Comply Agent, which may apply any standard from its own knowledge (see the system prompt) or ask which one is meant.

Matching is by words, not by meaning, and errs on the side of not attaching. A framework is named by:
* its full name ("Payment Card Industry Data Security Standard");
* its number, when it has a distinctive one ("27001", "ISO27001", "800-53"); a short number only right after its acronym ("SOC 2");
* when it has no distinctive number, its acronyms together ("PCI DSS", "PCI-DSS", "PCIDSS", "NCA ECC") or its issuer's acronym with
  the initials of its name ("NIST CSF", "SAMA CSF");
* the initials of its name when they spell a word of four letters or more ("GDPR", "PDPL", "HIPAA").
An issuer alone ("NIST", "ISO") never attaches a framework. A document is named by its title (two words or more) or its code.
What is attached is said in the turn's notes, and the person can remove it from References.
A law or standard a request names that the platform does not hold (``rules_named``, ``held``) is looked up on the internet first.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Sequence, Tuple

from . import references as refs

logger = logging.getLogger(__name__)

MAX_ATTACH = 4                              # at most this many references are attached from one request
_YEAR = re.compile(r"(19|20)\d\d")
_SMALL = {"of", "and", "the", "for", "on", "in", "to", "a", "an", "with", "by"}
_VERSION_WORDS = {"v", "ver", "version", "rev", "revision", "edition", "release"}
_GENERIC = _SMALL | {"framework", "frameworks", "standard", "standards", "control", "controls", "security", "information", "cybersecurity",
                     "cyber", "management", "requirements", "requirement", "guidelines", "guideline", "guide", "policy", "policies",
                     "procedure", "procedures", "regulation", "regulations", "law", "act", "rules", "version", "edition", "document", "data",
                     "system", "plan", "standard"}


def _words(text: str) -> List[str]:
    """Lower-case words, with letters and digits written together split apart ("ISO27001" -> "iso 27001", "800-53" -> "800 53")."""
    text = re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", text or "")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).split()


def _has_run(words: Sequence[str], run: Sequence[str]) -> bool:
    """Whether ``run`` appears in ``words`` as consecutive words."""
    n = len(run)
    return n > 0 and any(list(words[i:i + n]) == list(run) for i in range(len(words) - n + 1))


def _has_squashed(words: Sequence[str], token: str) -> bool:
    """Whether ``token`` is one word or a few consecutive words written together ("pci dss" -> "pcidss")."""
    for i in range(len(words)):
        joined = ""
        for w in words[i:i + 4]:
            joined += w
            if joined == token:
                return True
            if len(joined) >= len(token):
                break
    return False


def _parts(name: str) -> Tuple[List[str], List[str], List[str]]:
    """A framework name's acronyms ("ISO", "IEC", "PCI"), its identifying numbers (not a year, not a version after "v" or "Rev", not
    a dotted version) and the initials of its other capitalised words, read both ways where "Cybersecurity" may stand for one word or
    two ("ecc" for Essential Cybersecurity Controls, "csf" for Cybersecurity Framework)."""
    name = re.sub(r"\bv?\d+(?:\.\d+)+\b", " ", name or "")                 # a dotted version ("4.0.3", "v2.0") is not what names it
    tokens = re.findall(r"[A-Za-z]+|\d+", re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", name))
    acronyms: List[str] = []
    numbers: List[str] = []
    after_version = False
    for t in tokens:
        if t.isalpha():
            after_version = t.lower() in _VERSION_WORDS
            if t.isupper() and len(t) >= 2:
                acronyms.append(t.lower())
        elif not after_version and not _YEAR.fullmatch(t):
            numbers.append(t)
    capitals = [t for t in tokens if t.isalpha() and t[0].isupper() and not t.isupper() and t.lower() not in _SMALL and t.lower() not in _VERSION_WORDS]
    plain = "".join(t[0] for t in capitals).lower()                                      # "Essential Cybersecurity Controls" -> "ecc"
    split = "".join("cs" if t.lower() == "cybersecurity" else t[0] for t in capitals).lower()      # "Cybersecurity Framework" -> "csf"
    return acronyms, numbers, [plain] + ([split] if split != plain else [])


def named(text: str, name: str) -> bool:
    """Whether ``text`` names the framework called ``name`` (see the module's rules)."""
    words = _words(text)
    full = _words(name)
    if len(full) >= 2 and not all(w in _GENERIC for w in full) and _has_run(words, full):
        return True
    acronyms, numbers, readings = _parts(name)
    distinctive = sum(len(n) for n in numbers) >= 3
    if numbers:
        if distinctive and _has_run(words, numbers):
            return True
        if not distinctive and acronyms and _has_run(words, [acronyms[-1]] + numbers):
            return True                                                    # "SOC 2": the number right after its acronym
    if not distinctive and len(acronyms) >= 2 and (_has_run(words, acronyms) or _has_squashed(words, "".join(acronyms))):
        return True                                                        # "PCI DSS", "PCI-DSS", "PCIDSS", "NCA ECC"
    for initials in readings:
        if not distinctive and acronyms and len(initials) >= 2 and initials not in acronyms and _has_run(words, [acronyms[0], initials]):
            return True                                                    # "NIST CSF", "SAMA CSF", "NCA ECC"
        if len(initials) >= 4 and (initials in acronyms or not acronyms) and _has_squashed(words, initials):
            return True                                                    # "GDPR", "PDPL", "HIPAA", "PCIDSS"
    return False


def frameworks_named(text: str, frameworks: Sequence[Any]) -> List[Any]:
    """The frameworks of ``frameworks`` (UploadedFramework rows) that ``text`` names. Of several versions of one framework, the one
    whose version the request names, else the newest."""
    words = _words(text)
    groups: Dict[str, List[Any]] = {}
    for f in frameworks:
        if named(text, f.name):
            groups.setdefault(" ".join(_words(f.name)), []).append(f)
    out = []
    for group in groups.values():
        asked = [f for f in group if _words(f.version or "") and _has_run(words, _words(f.version or ""))]
        out.append((asked or sorted(group, key=lambda f: f.version or "", reverse=True))[0])
    return out


# the names of laws and standards in a request, as it writes them; like the rest, by words, erring on the side of finding none.
# Capitals that are a role, a team, a format or a word of a policy do not start one.
# ponytail: word patterns and a short stop-list; a false hit costs one web search, a miss answers from what Comply Agent knows. Widen
# the patterns (or the stop-list) from what people really type.
_NOT_A_RULE = (r"(?!(?:IT|HR|ICT|OT|IS|CEO|CFO|CIO|CISO|CTO|CRO|COO|CCO|CSO|CPO|CDO|CAE|CHRO|BISO|DPO|MLRO|EVP|SVP|AVP|BOD|RACI|ISMS|SOP|SLA|KPI|KRI|"
               r"BCP|DRP|BIA|PDF|URL|FAQ|TOC|NDA|MFA)\b)")
_ACRONYM = _NOT_A_RULE + r"[A-Z][A-Z0-9&]{2,}\b(?![-/]\d)(?:\s+(?:[A-Z][\w&]*|v?\d[\w.:/-]*))*"       # "DORA", "PCI DSS v4.0", "SOC 2"
_RULE_NAMES = (
    # a standard by its body and number: "ISO/IEC 42001", "NIST SP 800-207", "IEC 62443", "FIPS 140-3"
    re.compile(r"\b(?:ISO(?:\s*/\s*IEC)?|IEC|NIST(?:\s+SP)?|FIPS|IEEE|ETSI|BS|RFC)\s*[-:]?\s*\d{2,}(?:[-.:/]\d+)*"),
    # an issuer's acronym before what it issues: "SBP circular", "the SBP's cloud circular", "EBA guidelines", "FCA rules"
    re.compile(r"\b" + _NOT_A_RULE + r"[A-Z][A-Z0-9&]+(?:'s)?(?:\s+[\w&-]+){0,3}?\s+(?i:circulars?|regulations?|directives?|guidelines|rules|rulebook|handbook|notifications?)\b"),
    # capitalised words ending in a law: "Data Protection Act 2018", "EU AI Act", "Electronic Transactions Ordinance"
    re.compile(r"\b" + _NOT_A_RULE + r"(?:[A-Z][\w&'-]*\s+(?:(?:of|and|for|on|the)\s+)?){1,6}(?:Acts?|Laws?|Regulations?|Directives?|Circulars?|Ordinances?|Decrees?|Bills?|Statutes?)\b"),
    # acronyms the request is to follow: "align this policy with DORA", "a gap analysis against FFIEC and GLBA", "per PCI DSS v4.0" (not a code like POL-007)
    re.compile(r"\b(?i:against|(?:align\w*|compl\w*|conform\w*|consistent|in line|in accordance|map\w*)\s+(?:\w+\s+){0,3}?(?:with|to|against)|according to|"
               r"required by|per|under|follow\w*|meet\w*|based on)\s+(?:the\s+)?((?:" + _ACRONYM + r")(?:(?:\s*,\s*|\s+(?:and|or|&)\s+)(?:the\s+)?" + _ACRONYM + r")*)"),
)
_LAW_GENERIC = _GENERIC | {"acts", "laws", "directive", "directives", "circular", "circulars", "ordinance", "ordinances", "decree", "decrees",
                           "bill", "bills", "statute", "statutes", "rulebook", "handbook", "notification", "notifications"}


def rules_named(text: str) -> List[str]:
    """The laws, regulations and standards ``text`` names (see the patterns above), as it writes them, each once."""
    out: List[str] = []
    for pattern in _RULE_NAMES:
        for m in pattern.finditer(text or ""):
            for name in re.split(r"\s*,\s*|\s+(?:and|or|&)\s+(?:the\s+)?", m.group(1)) if pattern.groups else [m.group(0)]:
                name = re.sub(r"'s\b", "", name).strip()
                if name and not all(w in _LAW_GENERIC for w in _words(name)) and name not in out:
                    out.append(name)
    return out


def held(name: str, names: Sequence[str]) -> bool:
    """Whether the law or standard ``name`` (as a request writes it) is one of ``names``: it names one, or is part of one's name
    ("SBP circular" of "SBP Circular No. 5 of 2026")."""
    return any(named(name, n) or _has_run(_words(n), _words(name)) for n in names)


def documents_named(text: str, documents: Sequence[Any], *, exclude: Sequence[int] = ()) -> List[Any]:
    """The library documents ``text`` names: by a title of two words or more (three when every word is generic, as in "Information
    Security Policy"), or by document code. The longest title wins when one title is part of another."""
    words = _words(text)
    hits = []
    for d in documents:
        if d.id in exclude:
            continue
        title = _words(d.title)
        code = _words(getattr(d, "document_code", "") or "")
        specific = any(w not in _GENERIC for w in title)
        by_title = len(title) >= (2 if specific else 3) and _has_run(words, title)
        by_code = len("".join(code)) >= 4 and _has_run(words, code)
        if by_title or by_code:
            hits.append(d)
    hits.sort(key=lambda d: -len(_words(d.title)))
    out: List[Any] = []
    for d in hits:
        if not any(_has_run(_words(o.title), _words(d.title)) for o in out):
            out.append(d)
    return out


def attach_named(db, session, text: str) -> List[Dict[str, Any]]:
    """Attach to ``session`` what ``text`` names and is not attached yet: platform frameworks (whole) and library documents that have
    text. Returns what was attached ({key, title, kind}) and what could not be ({title, kind, skipped: why}). Never raises: a request
    is never refused over an attachment it did not ask for in so many words."""
    from ....models import GovernanceDocument, GRCUser, StudioReference
    from ..permissions import visible_filter

    try:
        present = db.query(StudioReference).filter(StudioReference.session_id == session.id).all()
        have = {(r.kind, r.source_id) for r in present}
        total = refs.total_chars(present)
        wanted: List[Tuple[str, Any]] = []
        for f in frameworks_named(text, [f for f, _count in refs.available_frameworks(db)]):
            if ("framework", f.id) not in have:
                wanted.append(("framework", f))
        query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id == session.tenant_id)
        visible = visible_filter(db, db.get(GRCUser, session.created_by))
        if visible is not None:                 # only what the person may read is matched: a skipped note would name the others
            query = query.filter(visible)
        docs = query.all() if session.tenant_id else []
        docs = [d for d in docs if (d.content or "").strip() or d.file_path]
        own = (session.title or "").strip().lower()
        for d in documents_named(text, docs, exclude=[session.document_id] if session.document_id else []):
            if ("document", d.id) not in have and ("parent_document", d.id) not in have and (d.title or "").strip().lower() != own:
                wanted.append(("document", d))
        out: List[Dict[str, Any]] = []
        for kind, source in wanted[:MAX_ATTACH]:
            title = getattr(source, "name", None) or getattr(source, "title", "")
            try:
                ref = refs.attach(db, session, kind, source_id=source.id, scope={"mode": "all"} if kind == "framework" else None)
            except refs.ReferenceProblem as exc:
                out.append({"key": "", "title": title, "kind": kind, "skipped": str(exc)})
                continue
            if total + ref.char_count > refs.MAX_TOTAL_CHARS:          # it would not fit with the others: the person chooses the parts
                db.delete(ref)
                db.flush()
                out.append({"key": "", "title": ref.title, "kind": kind,
                            "skipped": "it is too large to add whole to the other references; add the parts you need from References."})
                continue
            total += ref.char_count
            out.append({"key": ref.ref_key, "title": ref.title, "kind": kind})
        if out:
            db.commit()
        return out
    except Exception:       # noqa: BLE001 - the request goes ahead with what was attached by hand
        logger.warning("could not attach the references named in a request of studio session %s", getattr(session, "id", "?"), exc_info=True)
        db.rollback()
        return []


def summary(attached: Sequence[Dict[str, Any]]) -> str:
    return ", ".join(f"{a['title']} ({a['key']})" for a in attached if a.get("key"))


def note(attached: Sequence[Dict[str, Any]]) -> str:
    """One line for the turn's notes: what was attached because the request named it, and what could not be."""
    done = [a for a in attached if a.get("key")]
    parts = []
    if done:
        parts.append("Attached from the platform because your request names " + ("them" if len(done) > 1 else "it") + ": "
                     + ", ".join(f"{a['title']} ({a['key']})" for a in done) + ". Remove any you do not want in References.")
    parts += [f"{a['title']} is on the platform but was not attached: {a['skipped']}" for a in attached if not a.get("key")]
    return " ".join(parts)


def add_note(db, message_id: int, attached: Sequence[Dict[str, Any]]) -> None:
    """Put the attachment note first in a finished message's notes (for a turn that another writer, the draft, finished)."""
    from ....models import StudioMessage

    msg = db.get(StudioMessage, message_id)
    if msg is not None and attached:
        msg.notes = [note(attached)] + list(msg.notes or [])
        db.commit()
