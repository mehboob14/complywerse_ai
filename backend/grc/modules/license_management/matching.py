"""Software recognition for the license engine — pure functions, no DB.

An installed product (one element of ITAsset.detected_software_json) has to be
tied to the entitlement that covers it. There is no maintained recognition
library in the MVP (that is the Phase-2 catalog), so the join is, in order:

  tier 1  software_key equality — the entitlement's explicit key(s), else the keys
          derived from its product name by the SAME software_normaliser the scan
          used to stamp the install;
  tier 2  prefix keys, written "microsoft-365-apps*" in the entitlement's key;
  tier 3  publisher + normalised product name (only for entitlements WITHOUT an
          explicit key — an explicit key means "match exactly this and nothing
          else").

Name matching is deliberately conservative: it would rather report an install as
unlicensed (a false alarm an operator can fix by typing a software_key) than
silently burn a seat of the wrong product. "Visual Studio" must never swallow
"Visual Studio Code", so after the product's tokens only version numbers and
known edition/qualifier words may follow.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from grc.modules.compliance_plugins.services.software_normaliser import (
    _NOISE_RE,
    _slug,
    normalise_software,
)

# detected_software_json `source` values that are not an installed licensable
# product: Windows Server roles/features and bare listening processes.
SKIP_SOURCES = frozenset({"windows_role", "listening_process"})
# Linux package-manager rows: hundreds per host and overwhelmingly open source.
# They can be matched to an entitlement (e.g. a commercial rpm) but are never
# flagged "unlicensed" on their own.
OS_PACKAGE_SOURCES = frozenset({"dpkg", "rpm"})
_KNOWN_SOURCES = SKIP_SOURCES | OS_PACKAGE_SOURCES | {
    "registry", "wmi", "agent", "heartbeat", "manual", "service",
}


def clean(value: Any) -> str:
    """str(value) trimmed; NUL characters (which PostgreSQL text cannot hold) removed."""
    return str(value).replace(chr(0), "").strip() if value is not None else ""


# ── name normalisation ──────────────────────────────────────────────────────

_PAREN = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
_MARKS = re.compile("[®™©]")
_ARCH = re.compile(r"\b(?:x64|x86|amd64|arm64|win32|win64|64[\s-]?bit|32[\s-]?bit)\b")
_LOCALE = re.compile(
    r"\b(?:en|de|fr|es|it|pt|ja|ko|zh|ru|nl|sv|da|fi|nb|no|pl|tr|cs|hu|ar|he|th|uk|el|ro|bg|hr|sk|sl|id|vi)"
    r"-(?:us|gb|au|ca|in|de|fr|es|mx|it|br|pt|jp|kr|cn|tw|hk|ru|nl|se|dk|fi|no|pl|tr|cz|hu|sa|il|th|ua|gr|ro|bg|hr|sk|si|id|vn|ie|nz|za|ch|at|be)\b"
)
_DOTTED_VERSION = re.compile(r"\bv?\d+(?:\.\d+)+[a-z]?\b")
_TOKEN = re.compile(r"[a-z0-9]+(?:\+\+|#)?")


def name_tokens(name: Any) -> List[str]:
    """'7-Zip 23.01 (x64)' -> ['7', 'zip']; 'Microsoft SQL Server 2022 (64-bit)' ->
    ['microsoft', 'sql', 'server', '2022']. Architecture, locale, parenthesised
    build text and dotted versions are dropped; bare numbers (2019, 365) stay
    because they are part of a product's identity."""
    s = clean(name).lower()
    s = _MARKS.sub("", s)
    s = _PAREN.sub(" ", s)
    s = _ARCH.sub(" ", s)
    s = _LOCALE.sub(" ", s)
    s = _DOTTED_VERSION.sub(" ", s)
    return _TOKEN.findall(s)


def name_key(name: Any) -> str:
    """Stable per-product identity of an install, version/arch/locale-proof — used
    to collapse duplicate registry rows ('Office - en-us' and '- de-de')."""
    return "-".join(name_tokens(name))


def pub_root(publisher: Any) -> str:
    """First significant word of a publisher: 'Microsoft Corporation' and
    'Microsoft' -> 'microsoft'; 'Adobe Systems Incorporated' -> 'adobe'."""
    for t in _TOKEN.findall(clean(publisher).lower()):
        if t != "the":
            return t
    return ""


# Words that may follow a product name without making it a different product.
_QUALIFIERS = frozenset({
    "x64", "x86", "bit", "en", "us", "gb", "edition", "version", "ver", "v",
    "build", "release", "update", "sp1", "sp2", "sp3", "r2", "lts", "dc", "for",
    "windows", "desktop", "client", "suite", "apps", "app", "the", "and", "with",
})
# Edition words: used both as allowed suffixes and to detect an edition conflict
# (entitlement says "Enterprise", the install says "Professional").
_ED_CANON = {"pro": "professional"}
_EDITIONS = frozenset({
    "standard", "enterprise", "professional", "pro", "datacenter", "developer",
    "express", "home", "business", "community", "ultimate", "premium", "basic",
    "essentials", "starter", "student", "education", "web", "workgroup", "plus",
    "lite", "team",
})


def _prefix_match(inst: Sequence[str], prod: Sequence[str], edition: Set[str]) -> bool:
    n = len(prod)
    if n == 0 or len(inst) < n or list(inst[:n]) != list(prod):
        return False
    rest = inst[n:]
    for t in rest:
        # version-like (2019, 365, 19c, 11g, 8u291), a qualifier or an edition word
        if not ((t[:1].isdigit() and len(t) <= 8) or t in _QUALIFIERS or t in _EDITIONS):
            return False
    inst_editions = {_ED_CANON.get(t, t) for t in rest if t in _EDITIONS}
    if edition and inst_editions and not (inst_editions & edition):
        return False
    return True


def name_match(inst_tokens: Sequence[str], inst_pub: str,
               prod_tokens: Sequence[str], prod_pub: str, edition: Set[str]) -> bool:
    """Does an install called `inst_tokens` (publisher root `inst_pub`) look like
    the entitlement product `prod_tokens` (publisher root `prod_pub`)?"""
    if not inst_tokens or not prod_tokens:
        return False
    if inst_pub and prod_pub and inst_pub != prod_pub:
        return False  # two known, different publishers: never the same product
    inst_forms = [list(inst_tokens)]
    if inst_tokens[0] in (inst_pub, prod_pub) and len(inst_tokens) > 1:
        inst_forms.append(list(inst_tokens[1:]))      # drop a leading publisher word
    prod_forms = [list(prod_tokens)]
    if prod_tokens[0] == prod_pub and len(prod_tokens) > 1:
        prod_forms.append(list(prod_tokens[1:]))
    return any(_prefix_match(a, b, edition) for a in inst_forms for b in prod_forms)


# ── software keys ───────────────────────────────────────────────────────────

def parse_key_specs(specs: Iterable[Any]) -> Tuple[Set[str], Tuple[str, ...]]:
    """Entitlement software_key text -> (exact keys, prefixes). A value may hold
    several keys separated by comma/semicolon/space; a trailing '*' marks a
    prefix ('microsoft-365-apps*')."""
    exact: Set[str] = set()
    prefixes: List[str] = []
    for spec in specs:
        for part in re.split(r"[,;\s]+", clean(spec).lower()):
            if not part:
                continue
            if part.endswith("*"):
                if len(part) > 1:
                    prefixes.append(part[:-1])
            else:
                exact.add(part)
    return exact, tuple(prefixes)


def derive_keys(publisher: str, product: str, edition: Optional[str]) -> Set[str]:
    """Slug keys an install of this product would carry, derived from the
    entitlement's own text with the same _slug the scan used for the install.

    Deliberately NOT normalise_software(): that maps whole product families to one
    coarse benchmark key (every 'MySQL ...' -> mysql-8.0), which would let MySQL
    Workbench consume a MySQL Server seat. Operators who want a family key can type
    it into the entitlement's software_key; the name matcher covers the rest."""
    out: Set[str] = set()
    cands = [product, f"{publisher} {product}"]
    if edition:
        cands.append(f"{product} {edition}")
    for cand in cands:
        cand = clean(cand)
        if cand:
            s = _slug(cand)
            if s and s != "app":
                out.add(s)
    return out


# ── installs ────────────────────────────────────────────────────────────────

def read_install(entry: Any) -> Optional[Dict[str, Any]]:
    """One detected_software_json element -> a normalised install, or None when it
    is not a licensable product (role/process rows, runtimes, drivers, patches)."""
    if not isinstance(entry, dict):
        return None
    name = clean(entry.get("name"))
    if not name:
        return None
    source = clean(entry.get("source")).lower()
    if source in SKIP_SOURCES or _NOISE_RE.search(name):
        return None
    version = clean(entry.get("version")) or None
    publisher = clean(entry.get("publisher"))
    if not publisher and source and source not in _KNOWN_SOURCES \
            and len(source) > 2 and re.search(r"[a-z]", source):
        # the WMI collector stores Win32_Product.Vendor in `source`
        publisher = clean(entry.get("source"))
    key = clean(entry.get("software_key")).lower() or normalise_software(name, version) or _slug(name)
    toks = name_tokens(name)
    return {
        "name": name,
        "version": version,
        "publisher": publisher,
        "pub_root": pub_root(publisher),
        "source": source,
        "key": key,
        "keys": frozenset(k for k in (key, _slug(name)) if k),
        "tokens": toks,
        "name_key": "-".join(toks) or key,
        "os_package": source in OS_PACKAGE_SOURCES,
    }


# ── what the matcher knows about one entitlement group ──────────────────────

class Descriptor:
    """Matching view of one entitlement group (publisher + product + edition)."""

    __slots__ = ("pub_root", "prod_tokens", "edition_tokens", "exact_keys",
                 "prefix_keys", "derived_keys", "fuzzy")

    def __init__(self, publisher: str, product: str, edition: Optional[str],
                 software_keys: Iterable[Any] = ()):
        self.pub_root = pub_root(publisher)
        self.prod_tokens = name_tokens(product)
        self.edition_tokens = {_ED_CANON.get(t, t) for t in name_tokens(edition) if t in _EDITIONS} if edition else set()
        self.exact_keys, self.prefix_keys = parse_key_specs(software_keys)
        # An explicit key means "exactly this" — no fuzzy name matching for it.
        self.fuzzy = not (self.exact_keys or self.prefix_keys)
        self.derived_keys = frozenset(derive_keys(publisher, product, edition)) if self.fuzzy else frozenset()

    def tier(self, inst: Dict[str, Any]) -> Optional[int]:
        """1 = key equality, 2 = key prefix, 3 = name match, None = no match."""
        keys = inst["keys"]
        if keys & self.exact_keys:
            return 1                                  # operator-typed key: taken at its word
        if keys & self.derived_keys and not (
                inst["pub_root"] and self.pub_root and inst["pub_root"] != self.pub_root):
            return 1                                  # slug equality still needs a compatible publisher
        if self.prefix_keys and any(k.startswith(p) for k in keys for p in self.prefix_keys):
            return 2
        if self.fuzzy and name_match(inst["tokens"], inst["pub_root"],
                                     self.prod_tokens, self.pub_root, self.edition_tokens):
            return 3
        return None
