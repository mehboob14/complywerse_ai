"""Find sensitive values in text by their shape: secrets, card and account numbers, national ids, e-mail addresses,
phone numbers, IP addresses, cloud ids and internal host names.

Everything here is language-independent and needs no database. Each detector returns ``Entity`` spans; the caller
picks non-overlapping ones with ``resolve`` (higher priority wins, then the longer span). A value that only looks like
one of these things is dropped by a validator (Luhn, IBAN mod-97, octet range, entropy, a context word) so that
ordinary numbers, versions, hashes and dates are left alone.

``action`` says what happens to a found value: ``drop`` (secrets and account/identity numbers: removed, never
restored) or ``tokenize`` (replaced by a placeholder the answer can be restored from).
"""
from __future__ import annotations

import ipaddress
import math
import re
from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class Entity:
    type: str                 # SECRET, PAN, IBAN, NATIONAL_ID, MAC, EMAIL, PHONE, IP_PRIV, IP_PUB, CLOUD_ID, HOST, PERSON...
    start: int
    end: int
    value: str
    action: str = "tokenize"  # tokenize | drop
    priority: int = 50
    source: str = "pattern"   # pattern | dictionary


DROP_TYPES = frozenset({"SECRET", "PAN", "IBAN", "NATIONAL_ID", "MAC"})


def _entity(kind: str, text: str, start: int, end: int, *, action: str, priority: int) -> Entity:
    return Entity(kind, start, end, text[start:end], action, priority)


# ── secrets ────────────────────────────────────────────────────────────────
_NOT_SECRET_VALUES = frozenset("""
required optional mandatory enabled disabled enforced true false none null nil yes no n/a na tbd todo strong weak
complex simple minimum maximum changed expired hidden masked redacted removed stored encrypted hashed salted that this
the not only set used shared unique reset policy policies manager vault default empty blank unknown string value
password passwords secret secrets token tokens key keys
""".split())


def _secret_kv_ok(m: "re.Match") -> bool:
    value = m.group(1)
    if value.casefold().strip(".") in _NOT_SECRET_VALUES or value.startswith(("<", "$", "{", "%")):
        return False
    assigned = "=" in m.group(0)[: m.start(1) - m.start(0)]
    quoted = m.group(0)[m.start(1) - m.start(0) - 1:m.start(1) - m.start(0)] in "\"'"
    # `password=...` is an assignment; `Password: Minimum` in prose is not. After a colon, only a value that looks
    # like a credential (a digit or symbol in it, or long, or quoted) is taken for one.
    return assigned or quoted or len(value) >= 12 or any(not c.isalpha() for c in value)


# (no word boundary before the key: db_password=..., SMTP_PWD=... are the usual spellings)
_KV_SECRET = re.compile(
    r"(?i)(?:password|passwd|pwd|pass|passphrase|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|"
    r"secret[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|credentials?|authorization)"
    r"[\"']?\s*(?:=>|[:=])\s*[\"']?([^\s\"',;<>)}\]]{4,})")

_SECRET_RULES: List[Tuple["re.Pattern", int, Optional[Callable]]] = [
    (re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----", re.S), 0, None),
    (re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[A-Za-z0-9+/=\s]{20,}"), 0, None),
    (re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b"), 0, None),                  # AWS access key id
    (re.compile(r"\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{20,}"), 0, None),                    # API secret keys
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"), 0, None),      # GitHub
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), 0, None),                                          # Slack
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), 0, None),                                              # Google API key
    (re.compile(r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b"), 0, None),                              # Stripe
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), 0, None),          # JWT
    (re.compile(r"(?i)\bBearer\s+([A-Za-z0-9._~+/=-]{20,})"), 1, None),
    (_KV_SECRET, 1, _secret_kv_ok),
    (re.compile(r"(?i)\b[a-z][a-z0-9+.\-]*://[^\s/:@]+:([^\s/@]{3,})@"), 1, None),                   # user:password@host
]
_LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9+/_\-])[A-Za-z0-9+/_\-]{32,}={0,2}(?![A-Za-z0-9+/_\-])")
_HEX = re.compile(r"^[0-9a-fA-F]+$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")


def _entropy(s: str) -> float:
    counts = {c: s.count(c) for c in set(s)}
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def _random_looking(s: str) -> bool:
    """A long run that is neither a hex digest, a UUID nor a hyphenated slug, mixes letters and digits and has a high
    entropy: what an API key or token looks like."""
    if _HEX.match(s) or _UUID.match(s):
        return False
    if sum(s.count(c) for c in "-_/") >= 3:                      # a slug or a path: most of its parts are plain words
        parts = re.split(r"[-_/]", s)
        if sum(p.isalpha() and len(p) >= 3 for p in parts) / len(parts) >= 0.6:
            return False
    kinds = (any(c.islower() for c in s), any(c.isupper() for c in s), any(c.isdigit() for c in s))
    return sum(kinds) >= 2 and kinds[2] and _entropy(s) >= 4.2


def _secrets(text: str) -> Iterable[Entity]:
    for rx, group, ok in _SECRET_RULES:
        for m in rx.finditer(text):
            if ok is not None and not ok(m):
                continue
            yield _entity("SECRET", text, m.start(group), m.end(group), action="drop", priority=100)
    for m in _LONG_TOKEN.finditer(text):
        if _random_looking(m.group(0)):
            yield _entity("SECRET", text, m.start(), m.end(), action="drop", priority=96)


# ── card, account and identity numbers ─────────────────────────────────────
_PAN = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")


def _luhn(digits: str) -> bool:
    total, flip = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if flip:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
        flip = not flip
    return total % 10 == 0


def _pan_ok(raw: str) -> bool:
    digits = re.sub(r"[ -]", "", raw)
    if not 13 <= len(digits) <= 19 or len(set(digits)) == 1 or not _luhn(digits):
        return False
    return digits[0] in "3456" or 2221 <= int(digits[:4]) <= 2720


_IBAN = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])")
_IBAN_LEN = {"PK": 24, "AE": 23, "SA": 24, "GB": 22, "DE": 22, "FR": 27, "ES": 24, "IT": 27, "NL": 18, "BE": 16, "CH": 21,
             "AT": 20, "IE": 22, "SE": 24, "NO": 15, "DK": 18, "FI": 18, "PL": 28, "PT": 25, "TR": 26, "QA": 29, "KW": 30,
             "BH": 22, "JO": 30, "LB": 28, "EG": 29, "IQ": 23, "LU": 20, "GR": 27, "CZ": 24, "HU": 28, "RO": 24}


def _iban_ok(raw: str) -> bool:
    iban = raw.replace(" ", "")
    if not 15 <= len(iban) <= 34 or _IBAN_LEN.get(iban[:2], len(iban)) != len(iban):
        return False
    rearranged = iban[4:] + iban[:4]
    number = "".join(str(int(c, 36)) for c in rearranged)
    return int(number) % 97 == 1


_NATIONAL_ID = [
    re.compile(r"(?<![\d-])\d{5}-\d{7}-\d(?![\d-])"),                                      # Pakistan CNIC
    re.compile(r"(?<![\d-])784-?\d{4}-?\d{7}-?\d(?![\d-])"),                                # UAE Emirates ID
    re.compile(r"(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])"),                                    # US SSN
    re.compile(r"(?i)(?:cnic|\bnic\b|national\s+id|identity\s+card|id\s+card|id\s*(?:no|number)\.?)[^\d\n]{0,25}(\d{13})(?!\d)"),
    re.compile(r"(?i)(?:iqama|national\s+id|nid|identity|residence|هوية|إقامة)[^\d\n]{0,25}([12]\d{9})(?!\d)"),
    re.compile(r"(?i)passport(?:\s*(?:no|number|#)\.?)?[\s:#-]{0,5}([A-Z]{1,2}\d{6,8}|\d{8,9})(?![A-Za-z0-9])"),
]


def _national_ids(text: str) -> Iterable[Entity]:
    for rx in _NATIONAL_ID:
        for m in rx.finditer(text):
            g = 1 if rx.groups else 0
            yield _entity("NATIONAL_ID", text, m.start(g), m.end(g), action="drop", priority=93)


_MAC = re.compile(r"(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])")


# ── e-mail, phone, IP, cloud ids, internal hosts ────────────────────────────
_EMAIL = re.compile(r"(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")

_PHONE_INTL = re.compile(r"(?<![\w+])\+\d{1,3}[\s.\-]?(?:\(\d{1,4}\)[\s.\-]?)?\d{1,4}(?:[\s.\-]?\d{2,4}){1,4}(?!\w)")
_PHONE_LOCAL = re.compile(r"(?<![\w.])0\d{2,3}[\s\-]\d{6,8}(?!\w)|(?<![\w.])0\d{9,10}(?![\w.])")
_PHONE_NA = re.compile(r"(?<!\w)\(\d{3}\)\s?\d{3}[\s\-]\d{4}(?!\w)")

_OCT = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
_IPV4 = re.compile(rf"(?<![\w.]){_OCT}(?:\.{_OCT}){{3}}(?!\w|\.\d)")
_IPV6 = re.compile(r"(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])")
# four dotted numbers after one of these words are a version or a clause number, not an address
_VERSION_WORD = re.compile(
    r"(?i)(?:version|ver\.?|build|release|rev\.?|v|clause|section|sec\.?|article|art\.?|control|requirement|req\.?|item|"
    r"para(?:graph)?|annex|appendix|step|chapter|fig(?:ure)?|table|page|row|§)\s*$")
_HEADING_END = re.compile(r"[ \t]+[A-Za-z(\"“]")


def _numbered_heading(text: str, start: int, end: int) -> bool:
    """``5.1.1.2 Access control`` at the start of a line is a numbered heading, not an IP address. A line that starts
    with a real-looking address (a private range, or any number over 40) is left to be treated as one."""
    parts = [int(p) for p in text[start:end].split(".")]
    if max(parts) > 40 or parts[0] in (10, 127, 169, 172, 192):
        return False
    line_start = text.rfind("\n", 0, start) + 1
    return not text[line_start:start].strip(" \t#*-•>") and bool(_HEADING_END.match(text, end))

_ARN = re.compile(r"\barn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:[^\s\"'<>)]+")
_AWS_ACCOUNT = re.compile(r"(?i)\b(?:aws\s+)?account(?:\s+id)?[^\d\n]{0,8}(\d{12})(?!\d)")
_INTERNAL_HOST = re.compile(
    r"(?i)\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\."
    r"(?:local|internal|corp|lan|intra|intranet|localdomain|home|private)\b")
# \\server\share, also as it appears inside JSON text (every backslash doubled)
_UNC = re.compile(r"(?<![\\\w])(?:\\\\){1,2}[A-Za-z0-9._$-]+(?:(?:\\){1,2}[^\s\\\"'<>|]+)*")


def _ip(text: str) -> Iterable[Entity]:
    if text.count(".") >= 3:
        for m in _IPV4.finditer(text):
            if _VERSION_WORD.search(text[max(0, m.start() - 14):m.start()]) or _numbered_heading(text, m.start(), m.end()):
                continue
            kind = "IP_PRIV" if not ipaddress.ip_address(m.group(0)).is_global else "IP_PUB"
            yield _entity(kind, text, m.start(), m.end(), action="tokenize", priority=68)
    if text.count(":") >= 2:
        for m in _IPV6.finditer(text):
            try:
                addr = ipaddress.IPv6Address(m.group(0))
            except ValueError:
                continue
            if len(m.group(0)) < 3:                                  # a bare "::"
                continue
            kind = "IP_PRIV" if not addr.is_global else "IP_PUB"
            yield _entity(kind, text, m.start(), m.end(), action="tokenize", priority=68)


def detect(text: str) -> List[Entity]:
    """Every candidate span in ``text`` (they may overlap: pass the list to ``resolve``)."""
    if not text:
        return []
    out: List[Entity] = list(_secrets(text))
    has_digit = any(c.isdigit() for c in text)
    if has_digit:
        out += [_entity("PAN", text, m.start(), m.end(), action="drop", priority=95)
                for m in _PAN.finditer(text) if _pan_ok(m.group(0))]
        out += [_entity("IBAN", text, m.start(), m.end(), action="drop", priority=94)
                for m in _IBAN.finditer(text) if _iban_ok(m.group(0))]
        out += list(_national_ids(text))
        out += [_entity("PHONE", text, m.start(), m.end(), action="tokenize", priority=60)
                for rx in (_PHONE_INTL, _PHONE_LOCAL, _PHONE_NA) for m in rx.finditer(text)
                if 8 <= sum(c.isdigit() for c in m.group(0)) <= 15]
        out += [_entity("CLOUD_ID", text, m.start(1), m.end(1), action="tokenize", priority=70)
                for m in _AWS_ACCOUNT.finditer(text)]
    out += list(_ip(text))
    if ":" in text or "-" in text:
        out += [_entity("MAC", text, m.start(), m.end(), action="drop", priority=80) for m in _MAC.finditer(text)]
    if "@" in text:
        out += [_entity("EMAIL", text, m.start(), m.end(), action="tokenize", priority=75) for m in _EMAIL.finditer(text)]
    if "arn:" in text:
        out += [_entity("CLOUD_ID", text, m.start(), m.end(), action="tokenize", priority=70) for m in _ARN.finditer(text)]
    if "." in text:
        out += [_entity("HOST", text, m.start(), m.end(), action="tokenize", priority=55) for m in _INTERNAL_HOST.finditer(text)]
    if "\\\\" in text:
        out += [_entity("HOST", text, m.start(), m.end(), action="tokenize", priority=54) for m in _UNC.finditer(text)]
    return out


def detect_dropped(text: str) -> List[Entity]:
    """Only what must never leave: secrets, card/account/identity numbers, MAC addresses (the residual check)."""
    return [e for e in detect(text) if e.type in DROP_TYPES]


def resolve(entities: Iterable[Entity], length: int) -> List[Entity]:
    """Choose non-overlapping spans: higher priority first, then longer, then earlier. Returned in text order."""
    taken = bytearray(length)
    chosen: List[Entity] = []
    for e in sorted(entities, key=lambda e: (-e.priority, -(e.end - e.start), e.start)):
        if e.end > e.start and taken.find(1, e.start, e.end) == -1:
            taken[e.start:e.end] = b"\x01" * (e.end - e.start)
            chosen.append(e)
    return sorted(chosen, key=lambda e: e.start)
