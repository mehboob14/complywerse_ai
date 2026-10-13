"""What the platform knows about one tenant, so its own names can be found in text no pattern would catch.

People, the organisation and its units, vendors, projects, committees, assets, host names and domains are read from
the tenant's database and matched in prompts (case-insensitively, on word boundaries, tolerant of line breaks inside
a name and of Arabic diacritics). A term is left out when it is a public name (a framework, a regulator, a common
product, a role title) or an ordinary word a tenant happened to use as a unit or asset name ("Finance", "Server"): see
``allowlist``. Given names and surnames are matched **with their capitalisation**, so "Mark" is found and the
verb "mark" is not.

The dictionary is cached per tenant for a minute. If it cannot be built and there is no earlier copy, ``get`` raises
and the guard refuses the call rather than send names it could not check.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Dict, Iterable, List, Optional, Tuple

from . import allowlist
from .patterns import Entity

logger = logging.getLogger(__name__)

TTL_SECONDS = 60
MIN_LEN = 4
MAX_TERMS = 200_000
_SPACE = "\x00"                                           # stands for "any whitespace" inside a trie
_DIACRITICS = "ً-ْـ"                      # Arabic marks that may sit between letters
_ARABIC = re.compile("[؀-ۿ]")
_STRIP = re.compile(f"[{_DIACRITICS}]")
_IP_LIKE = re.compile(r"^[\d.:/]+$")


def _norm(term: str) -> str:
    """The form terms and matches are compared in: single spaces, no Arabic marks, case-folded."""
    return _STRIP.sub("", re.sub(r"\s+", " ", term).strip()).casefold()


def _emit(node: dict) -> str:
    if "" in node and len(node) == 1:
        return ""
    optional = "" in node
    alts = []
    for ch in sorted(k for k in node if k != ""):
        piece = r"\s+" if ch == _SPACE else re.escape(ch)
        if _ARABIC.match(ch):
            piece += f"[{_DIACRITICS}]*"
        alts.append(piece + _emit(node[ch]))
    if len(alts) == 1:
        return f"(?:{alts[0]})?" if optional else alts[0]
    body = "|".join(alts)
    return f"(?:{body})?" if optional else f"(?:{body})"


def _compile(terms: Iterable[str], flags: int) -> Optional["re.Pattern"]:
    trie: dict = {}
    count = 0
    for term in terms:
        node = trie
        for ch in term.replace(" ", _SPACE):
            node = node.setdefault(ch, {})
        node[""] = {}
        count += 1
    if not count:
        return None
    return re.compile(r"(?<![\w])" + _emit(trie) + r"(?![\w])", flags | re.UNICODE)


class Dictionary:
    """Terms of one tenant: ``ci`` are matched ignoring case, ``cs`` (given names and surnames) with their case."""

    def __init__(self, ci: Dict[str, str], cs: Dict[str, str]):
        self.ci, self.cs = ci, cs
        self._rx_ci = _compile(ci, re.IGNORECASE)
        self._rx_cs = _compile(cs, 0)

    def __len__(self) -> int:
        return len(self.ci) + len(self.cs)

    def find(self, text: str) -> List[Entity]:
        out: List[Entity] = []
        for rx, terms, fold in ((self._rx_ci, self.ci, True), (self._rx_cs, self.cs, False)):
            if rx is None:
                continue
            for m in rx.finditer(text):
                key = _norm(m.group(0)) if fold else _STRIP.sub("", re.sub(r"\s+", " ", m.group(0)))
                kind = terms.get(key)
                if kind:
                    out.append(Entity(kind, m.start(), m.end(), m.group(0), "tokenize", 50, "dictionary"))
        return out


class _Builder:
    def __init__(self):
        self.ci: Dict[str, str] = {}
        self.cs: Dict[str, str] = {}

    def _ok(self, value, min_len: int) -> Optional[str]:
        if not isinstance(value, str):
            return None
        v = re.sub(r"\s+", " ", value).strip()
        if len(v) < min_len or v.isdigit() or "@" in v or _IP_LIKE.match(v):
            return None
        if allowlist.is_public(v) or allowlist.is_generic(v):
            return None
        return v

    def add(self, value, kind: str, min_len: int = MIN_LEN) -> None:
        v = self._ok(value, min_len)
        if not v or len(self.ci) + len(self.cs) >= MAX_TERMS:
            return
        if kind != "ORG" and re.fullmatch(r"[^\W\d_]+", v):
            # a plain single word ("Falcon", "araza") could also be a word of the prompt's own instructions: it is
            # only hunted as it is capitalised in the data. The organisation's name is always matched.
            self.cs.setdefault(_STRIP.sub("", v), kind)
        else:
            self.ci.setdefault(_norm(v), kind)

    def add_name(self, display: Optional[str]) -> None:
        """A person: the full name case-insensitively, each part of it (4+ letters) with its capitalisation."""
        if not display or not isinstance(display, str):
            return
        name = re.sub(r"\s*[(\[].*$", "", display).strip()      # "Arif Malik (DigitalOcean)" -> "Arif Malik"
        self.add(display, "PERSON")
        self.add(name, "PERSON")
        words = [w for w in re.findall(r"[^\W\d_]+", name) if len(w) >= MIN_LEN]
        if len(name.split()) >= 2:
            for w in words:
                if w[0].isupper() and not allowlist.is_public(w) and not allowlist.is_generic(w):
                    self.cs.setdefault(_STRIP.sub("", w), "PERSON")

    def done(self) -> Dictionary:
        return Dictionary(self.ci, self.cs)


def _rows(db, model, *columns):
    try:
        return db.query(*[getattr(model, c) for c in columns]).all()
    except Exception:                                      # a table or column this tenant does not have yet
        db.rollback()
        return []


def build(db) -> Dictionary:
    """Read the tenant's own names from its database session."""
    from ... import models as m

    b = _Builder()
    for display, username in _rows(db, m.GRCUser, "display_name", "username"):
        b.add_name(display)
        b.add(username, "PERSON")
    for name, legal, sub, contact in _rows(db, m.Tenant, "name", "legal_entity", "subdomain", "primary_contact_name"):
        for v in (name, legal, sub):
            b.add(v, "ORG")
        b.add_name(contact)
    for (name,) in _rows(db, m.BusinessUnit, "name"):
        b.add(name, "ORG_UNIT")
    for name, code in _rows(db, m.GRCDepartment, "name", "code"):
        b.add(name, "ORG_UNIT")
        b.add(code, "ORG_UNIT", min_len=3)
    for (name,) in _rows(db, m.Team, "name"):
        b.add(name, "ORG_UNIT")
    for (name,) in _rows(db, m.GovernanceCommittee, "name"):
        b.add(name, "ORG_UNIT")
    for name, owner in _rows(db, m.ISProject, "name", "project_owner_name"):
        b.add(name, "PROJECT")
        b.add_name(owner)
    for name, domains, contact in _rows(db, m.Vendor, "name", "domains", "primary_contact_name"):
        b.add(name, "VENDOR")
        b.add_name(contact)
        for d in domains if isinstance(domains, list) else []:
            b.add(d, "HOST", min_len=5)
    for name, host, fqdn, aliases, vendor, owner, custodian, assigned in _rows(
            db, m.ITAsset, "name", "host_name", "fqdn", "dns_aliases", "vendor", "owner_name", "custodian", "assigned_user"):
        b.add(name, "ASSET")
        b.add(host, "HOST", min_len=3)
        b.add(fqdn, "HOST", min_len=5)
        for alias in aliases if isinstance(aliases, list) else []:
            b.add(alias, "HOST", min_len=3)
        b.add(vendor, "VENDOR")
        for person in (owner, custodian, assigned):
            b.add_name(person)
    return b.done()


_CACHE: Dict[str, Tuple[float, Dictionary]] = {}
_LOCK = threading.Lock()
_BUILDING: Dict[str, threading.Lock] = {}                 # one lock per tenant: a slow build never stalls another tenant


def get(slug: str) -> Dictionary:
    """The tenant's dictionary: cached for a minute; an older copy is kept if a refresh fails."""
    now = time.monotonic()
    hit = _CACHE.get(slug)
    if hit and now - hit[0] < TTL_SECONDS:
        return hit[1]
    with _LOCK:
        lock = _BUILDING.setdefault(slug, threading.Lock())
    with lock:
        hit = _CACHE.get(slug)
        if hit and time.monotonic() - hit[0] < TTL_SECONDS:
            return hit[1]
        try:
            from ...db import open_tenant_session
            db = open_tenant_session(slug)
            try:
                fresh = build(db)
            finally:
                db.close()
        except Exception:
            if hit:
                logger.warning("tenant dictionary refresh failed; keeping the previous copy", exc_info=True)
                _CACHE[slug] = (time.monotonic(), hit[1])
                return hit[1]
            raise
        _CACHE[slug] = (time.monotonic(), fresh)
        return fresh


def invalidate(slug: Optional[str] = None) -> None:
    with _LOCK:
        _CACHE.pop(slug, None) if slug else _CACHE.clear()
