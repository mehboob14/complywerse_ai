"""Build the Annex E rows of the UAE Information Assurance Standard v2.1 library from the standard's own PDF.

Annex E of the standard (UAE Cyber Security Council, November 2025) reproduces three national technology security policies as
tables: the National Cloud Security Policy (Table 10), the National Cyber Security Policy for Artificial Intelligence (Table 11)
and the National IoT Security Policy (Table 12). They are not frameworks of their own. Each numbered policy control becomes one
extra ROW of the UAE IA library (seed_data/frameworks/uae_ia.json), in the shape of that library's own rows, in a staging file
that is merged into the library later. The seeder does not read the staging file (it loads seed_data/frameworks/*.json):

    python -I backend/grc/tools/build_uae_ia_annex_e_rows.py "UAE INFORMATION ASSURANCE STANDARD.pdf" \
        backend/grc/seed_data/uae_ia_annex_e_rows.json [--evidence backend/grc/seed_data/uae_ia_annex_e_evidence.json]

Apart from the evidence layer, nothing here is paraphrased or AI-authored: control names, statements and bullets are copied
verbatim from the PDF's text layer (line wraps and hyphenated line breaks repaired, page headers and footers dropped).

The tables, as printed (PDF page numbers; printed page = PDF page - 4):
  Policy Domain | Policy Sub-Domain | Control | [Applicability] | UAE IA Control v2.1
  - The Sub-Domain cell carries the policy's own control number and name ("2.1.1 Governance Framework"; in the AI policy
    "2.1 AI Cyber Security Governance"). That number and name are the row's number and title.
  - Under one sub-domain there are one or more rows of the table, each a "The entity shall ..." statement with its own
    Applicability (cloud only: "Applicable to IaaS, PaaS and SaaS") and its own list of UAE IA v2.1 controls (or NA). A control
    keeps all its statements, in print order, and each statement's applicability and mapping in `statements`.
  - A row of the table can run over a page break; the continuation is joined to it.
The Applicability column says which cloud service models a statement applies to.

How the parse is checked (the annex states no totals): a second, independent pass over the flat text of the same pages finds
the control numbers and, after each, the mapped control ids (and, in the cloud table, the "Applicable to" cells). It must
agree with the layout parse control by control. Control numbers must be consecutive within their domain, and every mapped id
must be a control of the standard (Annex D lists all 134).

Evidence recommendations are the one part that does not come from the PDF: the annex names no evidence. They are an authored
layer (seed_data/uae_ia_annex_e_evidence.json, outside seed_data/frameworks/ because the loader globs *.json there, keyed by the
row ids) merged in as each row's evidence_requirements. The build stops unless every row has 3-5 items and every obligation of
the row is covered by at least one item (`covers`, review traceability, not shipped). So the PDF plus the layer reproduce the
staging file byte for byte.

How a row lands in the seeder's fields (grc/seed_frameworks.py reads only the keys below):
  control_id          "<annex>-<the policy's own number>": E1-2.1.1 ... E1-2.9.2 (cloud), E2-2.1 ... E2-2.6 (AI), E3-2.1.1 ...
                      E3-2.8.1 (IoT). The library's own ids are M1.1.1 ... T9.2.1; the letter prefix keeps these ids unique and
                      keeps the framework page, which groups by the leading integer of a code, from putting them all under "2"
  original_reference  the policy's own number as printed          title   the control's name
  description         the first sentence of the first statement   full_text   every statement verbatim, bullets kept, a
                      blank line between statements
  domain              "E1 National Cloud Security Policy (Annex E)", "E2 ...", "E3 ..."
  category            the Policy Domain cell as printed ("2.1 Cloud Governance"; the AI policy has one, "2. Cyber Security Policy
                      for Artificial Intelligence")       section_number   the control_id        parent_section   "E1-2.1"
  is_mandatory        false: these controls apply when the entity uses the technology, like the library's "Based on risk
                      assessment". `applicability` is the Applicability column verbatim, or "When the entity uses ..."
  priority            "medium": the annex carries no priority (priority_tier is null)
  assessment_criteria each enumerated obligation as one sentence (lead-in + bullet); none where the control enumerates fewer
                      than two, and "take the following into account" bullets are considerations, not criteria
  ai_notes            applicability, source page and, as the last sentence, the UAE IA v2.1 controls the row maps to
Keys the seeder does not read (priority_tier, applicability, annex, uae_ia_controls, statements, obligations, pdf_page) stay
in the JSON for reviewers and the crosswalk tools.

Requires PyMuPDF. Run it isolated (python -I) on an untrusted download.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SEED = Path(__file__).resolve().parents[1] / "seed_data"
ANNEX_D = range(201, 207)                      # PDF pages of the standard's control-by-control mapping: all 134 control ids
ID_CELL = re.compile(r"[MT]\d+\.\d+\.\d+")
PARAGRAPH_GAP = 14.5                           # Word's line pitch here is 11.9pt; a new paragraph starts further down
CONSIDERATION = re.compile(r"\btake the following into account\b", re.I)
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")

SOURCE = "UAE Information Assurance Standard, Version 2.1, November 2025 (UAE Cyber Security Council, classification Open)"
ABOUT = ("Rows E1-*, E2-* and E3-* for the UAE Information Assurance Standard library (frameworks/uae_ia.json): the three national "
         "technology security policies of its Annex E, one row per numbered policy control, in the shape of the library's own rows. "
         "E1 = Table 10 National Cloud Security Policy, E2 = Table 11 National Cyber Security Policy for Artificial Intelligence, "
         "E3 = Table 12 National IoT Security Policy; control_id = the annex prefix, a dash and the policy's own number. Built from "
         "the standard's PDF by backend/grc/tools/build_uae_ia_annex_e_rows.py; text verbatim, evidence_requirements from "
         "uae_ia_annex_e_evidence.json. Staging only, to be merged into the library: the seeder does not read this file.")
POLICIES: List[Dict[str, Any]] = [
    # annex prefix, table, printed heading, the library domain, control number depth, Applicability column, applicability otherwise
    {"annex": "E1", "table": 10, "heading": "National Cloud Security Policy", "domain": "E1 National Cloud Security Policy (Annex E)",
     "depth": 3, "applicability": True, "when": None},
    {"annex": "E2", "table": 11, "heading": "National Cyber Security Policy for Artificial Intelligence",
     "domain": "E2 National Cyber Security Policy for Artificial Intelligence (Annex E)",
     "depth": 2, "applicability": False, "when": "When the entity uses AI/ML systems"},
    {"annex": "E3", "table": 12, "heading": "National Internet of Things (IoT) Security Policy",
     "domain": "E3 National IoT Security Policy (Annex E)",
     "depth": 3, "applicability": False, "when": "When the entity uses IoT devices and services"},
]
# Printed ids that are not a control of the standard as printed -> the intended id (none needed so far; the build stops on any
# other id that is not in Annex D, so a new typo is looked at, not guessed).
ID_REPAIRS: Dict[str, str] = {}


def fail(msg: str):
    sys.exit(f"build_uae_ia_annex_e_rows: {msg}")


# ── geometry: entries, rules, cells ──────────────────────────────────────────────────────────────

class Entry:
    """One printed line of a cell, or one list marker (a bullet, or the dash of a sub-item)."""
    __slots__ = ("page", "x", "x1", "y", "y1", "base", "size", "bold", "white", "marker", "raw", "ind")

    def __init__(self, page, x, x1, y, y1, base, size, bold, white, marker, raw):
        self.page, self.x, self.x1, self.y, self.y1, self.base = page, x, x1, y, y1, base
        self.size, self.bold, self.white, self.marker, self.raw, self.ind = size, bold, white, marker, raw, 0.0

    @property
    def text(self) -> str:
        return " ".join(self.raw.split())


def entries_of(page) -> List[Entry]:
    """Every line and list marker of a page. A marker is a Symbol-font bullet, a U+2022 bullet, or the Cambria dash of a
    sub-item; Word prints it as its own run, so it is told apart from the text next to it."""
    out: List[Entry] = []
    for block in page.get_text("dict")["blocks"]:
        for ln in block.get("lines", []):
            run: List[dict] = []

            def flush():
                if run and "".join(s["text"] for s in run).strip():
                    sp = [s for s in run if s["text"].strip()]
                    out.append(Entry(page.number + 1, sp[0]["bbox"][0], sp[-1]["bbox"][2], min(s["bbox"][1] for s in sp),
                                     max(s["bbox"][3] for s in sp), sp[0]["origin"][1], max(s["size"] for s in sp),
                                     all("Bold" in s["font"] for s in sp), all(s["color"] == 0xFFFFFF for s in sp), None,
                                     "".join(s["text"] for s in run)))
                run.clear()

            for s in ln["spans"]:
                t = s["text"].strip()
                kind = ("bullet" if "Symbol" in s["font"] or t in ("•", "") else
                        "dash" if t == "-" and "Cambria" in s["font"] else None)
                if kind:
                    flush()
                    out.append(Entry(page.number + 1, s["bbox"][0], s["bbox"][2], s["bbox"][1], s["bbox"][3], s["origin"][1],
                                     s["size"], False, False, kind, s["text"]))
                else:
                    run.append(s)
            flush()
    return out


def rules_of(page) -> Tuple[List[Tuple[float, float, float]], List[float]]:
    """The table borders: Word draws them as thin black filled rectangles. -> ([(y, x0, x1)] horizontal, [x] vertical)."""
    hs, vs = [], []
    for d in page.get_drawings():
        fill, r = d.get("fill"), d["rect"]
        if fill is None or any(round(v, 2) != 0.0 for v in fill):
            continue
        if r.height < 1.0 and r.width > 20:
            hs.append((round(r.y0, 1), round(r.x0, 1), round(r.x1, 1)))
        elif r.width < 1.0 and r.height > 3:
            vs.append(round(r.x0, 1))
    return hs, vs


def in_print_order(entries: List[Entry]) -> List[Entry]:
    """Top to bottom, left to right on one line. A marker and its text share a baseline to within a point, so lines are
    the runs of entries whose baselines are within 2pt (the line pitch is 11.9pt)."""
    out: List[Entry] = []
    line: List[Entry] = []
    for e in sorted(entries, key=lambda e: e.base):
        if line and e.base - line[0].base > 2.0:
            out += sorted(line, key=lambda e: e.x)
            line = []
        line.append(e)
    return out + sorted(line, key=lambda e: e.x)


def cluster(xs: List[float], gap: float = 1.0) -> List[float]:
    out: List[float] = []
    for x in sorted(xs):
        if not out or x - out[-1] > gap:
            out.append(x)
    return out


def intervals(ys: List[float]) -> List[Tuple[float, float]]:
    ys = cluster(ys, 0.6)
    return [(a, b) for a, b in zip(ys, ys[1:]) if b - a > 8]


def locate_tables(doc) -> List[Dict[str, Any]]:
    """The three tables of Annex E, found by their printed headings ("1. National Cloud Security Policy") and captions
    ("Table 10 National Cloud Security Policy Controls", printed below each table)."""
    first = last = None
    for p in range(len(doc)):
        for e in entries_of(doc[p]):
            if e.size > 15 and e.text.startswith("Annex E:"):
                first = p + 1
            if e.size > 15 and e.text.startswith("Annex F:"):
                last = p + 1
    if not first or not last or last <= first:
        fail("cannot find Annex E and Annex F")
    tables: List[Dict[str, Any]] = []
    for pno in range(first, last):
        for e in sorted(entries_of(doc[pno - 1]), key=lambda e: e.base):
            m = re.fullmatch(r"(\d)\. (National .+)", e.text)
            if m and e.bold and 11 < e.size < 13:
                tables.append({"heading": m.group(2), "first": pno, "last": None, "number": None})
            m = re.fullmatch(r"Table (\d+) (National .+)", e.text)
            if m:
                if not tables or tables[-1]["last"]:
                    fail(f"table caption without a heading: {e.text!r}")
                tables[-1].update(last=pno, number=int(m.group(1)), caption=m.group(2))
    if [t["number"] for t in tables] != [p["table"] for p in POLICIES] or [t["heading"] for t in tables] != [p["heading"] for p in POLICIES]:
        fail(f"Annex E holds {[(t['number'], t['heading']) for t in tables]}, expected {[(p['table'], p['heading']) for p in POLICIES]}")
    return tables


def read_page(page, with_applicability: bool, header_page: bool) -> List[Dict[str, Any]]:
    """The rows of one page of a table, in print order: {page, y0, y1, dom, sub, entries, applic, mapped}.
    dom and sub are the cell {key, lines} the row sits in (empty lines = the cell started on an earlier page)."""
    roles = ["dom", "sub", "control"] + (["applic"] if with_applicability else []) + ["map"]
    hs, vs = rules_of(page)
    xs = cluster(vs)
    if len(xs) != len(roles) + 1:
        fail(f"p{page.number + 1}: expected {len(roles)} columns, found vertical borders at {xs}")
    col = dict(zip(roles, zip(xs, xs[1:])))
    ys = {r: sorted(y for y, x0, x1 in hs if abs(x0 - (col[r][0] + 0.5)) < 1.5 and abs(x1 - col[r][1]) < 1.5) for r in roles}
    cells = {r: intervals(ys[r]) for r in ("dom", "sub", "control")}
    ents = [e for e in entries_of(page) if (e.marker or e.size <= 10.5) and e.base < 790]      # AI bullets are 12pt
    body = [e for e in ents if not e.white]
    rows = [{"page": page.number + 1, "y0": a, "y1": b, "entries": [], "applic": [], "mapped": []} for a, b in cells["control"]
            if not any(e.white and a <= (e.y + e.y1) / 2 < b for e in ents)]
    if header_page and len(rows) == len(cells["control"]):
        fail(f"p{page.number + 1}: no header row found")
    if not rows:
        fail(f"p{page.number + 1}: no table rows")
    texts: Dict[str, Dict[Tuple[float, float], List[Entry]]] = {"dom": {}, "sub": {}}
    for e in body:
        role = next((r for r in roles if col[r][0] - 0.5 <= e.x < col[r][1]), None)
        yc = (e.y + e.y1) / 2
        if role in ("dom", "sub"):
            hit = [c for c in cells[role] if c[0] <= yc < c[1]]
            if hit:
                texts[role].setdefault(hit[0], []).append(e)
            continue
        hit = [r for r in rows if r["y0"] <= yc < r["y1"]]
        if not hit or role is None:
            continue
        row = hit[0]
        if role == "control":
            e.ind = e.x - col["control"][0]
            row["entries"].append(e)
        elif role == "applic":
            row["applic"].append(e.text)
        else:
            row["mapped"].append(e.text)
    for row in rows:
        row["entries"] = in_print_order(row["entries"])
        mid = (row["y0"] + row["y1"]) / 2
        for role in ("dom", "sub"):
            rng = next((c for c in cells[role] if c[0] <= mid < c[1]), None)
            if rng is None:
                fail(f"p{page.number + 1}: a row at y={mid:.0f} has no {role} cell")
            row[role] = {"key": (role, page.number + 1, rng[0]), "lines": in_print_order(texts[role].get(rng, []))}
    return rows


def join(lines: List[Entry]) -> str:
    """Wrapped lines -> one string. A line that ends in a hyphen right after a letter was broken inside a hyphenated word
    ("third-" / "party"), so no space is added; a hyphen followed by a space in the print keeps it."""
    text, prev = "", ""
    for ln in lines:
        text += ("" if re.search(r"[A-Za-z0-9]-$", prev) or not text else " ") + ln.text
        prev = ln.raw
    return text


# ── rows -> controls ─────────────────────────────────────────────────────────────────────────────

def split_number(text: str) -> Tuple[str, str]:
    m = re.fullmatch(r"(\d+(?:\.\d+)*\.?)\s+(.+)", text)
    if not m:
        fail(f"a cell that should start with its number reads {text!r}")
    return m.group(1), m.group(2)


def is_continuation(row: Dict[str, Any], first_on_page: bool, new_cell: bool, with_applicability: bool) -> bool:
    """A row at the top of a page that is not a new domain or sub-domain: the rest of the row above, when it has no
    Applicability cell (cloud) or its text starts with a bullet or a lower-case word (the others)."""
    if not first_on_page or new_cell or not row["entries"]:
        return False
    if with_applicability:
        return not row["applic"]
    e = row["entries"][0]
    return bool(e.marker) or e.text[:1].islower()


def read_policy(doc, table: Dict[str, Any], policy: Dict[str, Any]) -> List[Dict[str, Any]]:
    """-> controls in print order: {number, name, domain, statements: [{pages, entries, applic, mapped}]}."""
    controls: List[Dict[str, Any]] = []
    seen: set = set()
    domain = None
    for pno in range(table["first"], table["last"] + 1):
        for i, row in enumerate(read_page(doc[pno - 1], policy["applicability"], pno == table["first"])):
            new = {}
            for role in ("dom", "sub"):
                cell = row[role]
                new[role] = bool(cell["lines"]) and cell["key"] not in seen
                seen.add(cell["key"])
            if new["dom"]:
                domain = split_number(join(row["dom"]["lines"]))
            if is_continuation(row, i == 0 and pno != table["first"], new["dom"] or new["sub"], policy["applicability"]):
                st = controls[-1]["statements"][-1]
                st["pages"].append(pno)
                st["entries"] += row["entries"]
                st["mapped"] += row["mapped"]
                continue
            if new["sub"]:
                number, name = split_number(join(row["sub"]["lines"]))
                controls.append({"number": number, "name": name, "domain": domain, "page": pno, "statements": []})
            if not controls or domain is None:
                fail(f"p{pno}: a row before any sub-domain")
            controls[-1]["statements"].append({"pages": [pno], "entries": row["entries"], "applic": " ".join(row["applic"]),
                                                "mapped": row["mapped"]})
    return controls


# ── statements -> blocks, obligations, text ──────────────────────────────────────────────────────

def blocks_of(entries: List[Entry]) -> List[Dict[str, Any]]:
    """A statement's lines as blocks: heading (bold), para, bullet (with its '-' sub-items). A flush-left line continues the
    paragraph above unless a bullet, a change of weight or a gap comes between; an indented line wraps its bullet or sub-item."""
    blocks: List[Dict[str, Any]] = []
    cur: Optional[List[Entry]] = None
    prev: Optional[Entry] = None
    for e in entries:
        if e.marker == "bullet":
            blocks.append({"kind": "bullet", "lines": [], "subs": []})
            cur = blocks[-1]["lines"]
        elif e.marker == "dash":
            if not blocks or blocks[-1]["kind"] != "bullet":
                fail(f"p{e.page}: a sub-item marker outside a bullet")
            blocks[-1]["subs"].append([])
            cur = blocks[-1]["subs"][-1]
        elif e.ind < 12:
            kind = "heading" if e.bold else "para"
            same = (blocks and blocks[-1]["kind"] == kind and cur is blocks[-1]["lines"] and prev is not None
                    and (prev.page != e.page or e.base - prev.base <= PARAGRAPH_GAP))
            if not same:
                blocks.append({"kind": kind, "lines": [], "subs": []})
                cur = blocks[-1]["lines"]
            cur.append(e)
        else:
            if cur is None:
                fail(f"p{e.page}: an indented line with nothing above it: {e.text[:50]!r}")
            cur.append(e)
        prev = e
    for b in blocks:
        b["text"] = join(b["lines"])
        b["sub_texts"] = [join(s) for s in b["subs"]]
        if not b["text"] or any(not t for t in b["sub_texts"]):
            fail(f"an empty {b['kind']} in a statement")
    return blocks


def bullet_text(b: Dict[str, Any]) -> str:
    return " ".join([b["text"]] + [f"- {t}" for t in b["sub_texts"]])


def obligations_of(blocks: List[Dict[str, Any]]) -> List[Tuple[str, bool]]:
    """The statement's separate things to do, as (text, is_consideration). A paragraph that no bullet follows is one; a
    paragraph that bullets follow is a lead-in, and each bullet is one (lead-in + bullet), after any whole sentences that
    come before the lead-in. Bullets under "shall take the following into account" are considerations."""
    out: List[Tuple[str, bool]] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b["kind"] == "heading":
            i += 1
        elif b["kind"] == "bullet":
            fail(f"a bullet with no lead-in: {b['text'][:50]!r}")
        elif i + 1 < len(blocks) and blocks[i + 1]["kind"] == "bullet":
            sentences = SENTENCE_END.split(b["text"])
            lead = sentences[-1]
            if not lead.endswith(":"):
                fail(f"a lead-in that does not end with a colon: {lead[:60]!r}")
            out += [(s, False) for s in sentences[:-1]]
            j = i + 1
            while j < len(blocks) and blocks[j]["kind"] == "bullet":
                out.append((f"{lead} {bullet_text(blocks[j])}", bool(CONSIDERATION.search(lead))))
                j += 1
            i = j
        else:
            out.append((b["text"], False))
            i += 1
    return out


def statement_text(blocks: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for b in blocks:
        if b["kind"] == "bullet":
            lines.append("• " + b["text"])
            lines += [f"   - {t}" for t in b["sub_texts"]]
        else:
            lines.append(b["text"])
    return "\n".join(lines)


def first_sentence(blocks: List[Dict[str, Any]]) -> str:
    """The statement's first sentence ("The entity shall:" alone says nothing, so a lead-in under 40 characters takes its first bullet)."""
    i = next((i for i, b in enumerate(blocks) if b["kind"] == "para"), None)
    if i is None:
        fail("a statement without a paragraph")
    sentence = SENTENCE_END.split(blocks[i]["text"])[0]
    if sentence == blocks[i]["text"] and sentence.endswith(":") and len(sentence) < 40 and i + 1 < len(blocks) and blocks[i + 1]["kind"] == "bullet":
        sentence += " " + bullet_text(blocks[i + 1])
    return sentence


def clean_ids(tokens: List[str], where: str, known: set, repairs: List[str]) -> Tuple[List[str], str]:
    """Printed mapping cell -> (control ids, the printed 'not mapped' token or ''). Repairs a trailing full stop and drops a
    repeated id; every id must be a control of the standard."""
    ids: List[str] = []
    na = ""
    for raw in tokens:
        t = raw.strip()
        if re.fullmatch(r"N/?A", t):
            na = t
            continue
        fixed = ID_REPAIRS.get(t, t.rstrip("."))
        if fixed != t:
            repairs.append(f"{where}: printed {t!r}, read as {fixed!r}")
        if fixed not in known:
            fail(f"{where}: {t!r} is not a control of the standard")
        if fixed in ids:
            repairs.append(f"{where}: {fixed} is printed twice in one cell, kept once")
            continue
        ids.append(fixed)
    return ids, na


def assemble(policy: Dict[str, Any], raw_controls: List[Dict[str, Any]], known: set, repairs: List[str]) -> List[Dict[str, Any]]:
    out = []
    for c in raw_controls:
        where = f"{policy['annex']} {c['number']}"
        statements, obligations, texts, description = [], [], [], ""
        for st in c["statements"]:
            blocks = blocks_of(st["entries"])
            description = description or first_sentence(blocks)
            if policy["applicability"] and not st["applic"]:
                fail(f"{where}: a statement without an Applicability cell")
            ids, na = clean_ids(st["mapped"], where, known, repairs)
            if not ids and not na:
                fail(f"{where}: a statement with no mapped control and no NA")
            statements.append({"pages": st["pages"], "applicability": st["applic"], "ids": ids, "na": na})
            obligations += obligations_of(blocks)
            texts.append(statement_text(blocks))
        out.append({"number": c["number"], "name": c["name"], "domain": c["domain"], "page": c["page"], "statements": statements,
                    "obligations": obligations, "text": "\n\n".join(texts), "description": description})
    return out


def check_numbering(policy: Dict[str, Any], controls: List[Dict[str, Any]]) -> None:
    """Numbers are consecutive within their domain (2.1.1, 2.1.2 ... then 2.2.1), so a control the parse lost shows as a gap."""
    depth = policy["depth"]
    last: Optional[List[int]] = None
    for c in controls:
        parts = [int(p) for p in c["number"].split(".")]
        if len(parts) != depth:
            fail(f"{policy['annex']} {c['number']}: expected {depth} numbers")
        if depth == 3 and ".".join(c["number"].split(".")[:2]) != c["domain"][0]:
            fail(f"{policy['annex']} {c['number']} sits under domain {c['domain'][0]}")
        if last is None:
            ok = parts[-1] == 1 and (depth == 2 or parts[-2] == 1)
        else:
            ok = (parts[:-1] == last[:-1] and parts[-1] == last[-1] + 1) or (
                depth == 3 and parts[:-2] == last[:-2] and parts[-2] == last[-2] + 1 and parts[-1] == 1)
        if not ok:
            fail(f"{policy['annex']}: {c['number']} follows {'.'.join(map(str, last)) if last else 'nothing'}")
        last = parts


# ── the second, independent pass over the flat text ──────────────────────────────────────────────

def flat_pass(doc, table: Dict[str, Any], policy: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Control numbers, the raw tokens of their mapping cells and the "Applicable to" cells, read from page.get_text() alone:
    a line that starts with a control number opens a control; id lines and NA lines after it belong to it."""
    number = re.compile(r"\s*(2(?:\.\d+){%d})(?:\s|$)" % (policy["depth"] - 1))
    out: List[Dict[str, Any]] = []
    for pno in range(table["first"], table["last"] + 1):
        for line in doc[pno - 1].get_text("text").splitlines():
            m = number.match(line)
            if m:
                out.append({"number": m.group(1), "mapped": [], "applic": 0})
            elif out and re.fullmatch(r"\s*(?:[MT]\d+\.\d+\.\d+\.?|N/?A)\s*", line):
                out[-1]["mapped"].append(line.strip())
            elif out and line.strip() == "Applicable to":
                out[-1]["applic"] += 1
    return out


def cross_check(policy: Dict[str, Any], raw_controls: List[Dict[str, Any]], flat: List[Dict[str, Any]]) -> None:
    if [c["number"] for c in raw_controls] != [f["number"] for f in flat]:
        a, b = [c["number"] for c in raw_controls], [f["number"] for f in flat]
        fail(f"{policy['annex']}: the layout parse and the text pass list different controls: {sorted(set(a) ^ set(b))} / {len(a)} vs {len(b)}")
    for c, f in zip(raw_controls, flat):
        layout = [t.strip() for st in c["statements"] for t in st["mapped"]]
        if layout != f["mapped"]:
            fail(f"{policy['annex']} {c['number']}: mapped ids differ: layout {layout}, text {f['mapped']}")
        if policy["applicability"] and len(c["statements"]) != f["applic"]:
            fail(f"{policy['annex']} {c['number']}: {len(c['statements'])} statements, {f['applic']} 'Applicable to' cells in the text")


def standard_control_ids(doc) -> set:
    ids = set()
    for pno in ANNEX_D:
        ids |= {e.text for e in entries_of(doc[pno - 1]) if e.x < 100 and ID_CELL.fullmatch(e.text)}
    if len(ids) != 134:
        fail(f"Annex D lists {len(ids)} control ids, the standard has 134")
    return ids


def printed_page(doc, pno: int) -> int:
    """The page number printed in the footer (PDF page - 4 here, but read, not assumed)."""
    nums = [e.text for e in entries_of(doc[pno - 1]) if e.base > 790 and e.x > 500 and e.text.isdigit()]
    if len(nums) != 1:
        fail(f"p{pno}: cannot read the printed page number")
    return int(nums[0])


# ── the evidence layer ───────────────────────────────────────────────────────────────────────────

ITEM_KEYS = {"name", "description", "filetype", "collection_frequency"}      # what the seeder reads from a dict entry


def check_layer(layer: Dict[str, Any], controls: List[Dict[str, Any]]) -> None:
    """The layer holds 3-5 items for exactly the rows, in row order, and every obligation of every row is covered by at least
    one item (a changed PDF with a new or renumbered obligation stops here until the layer is reviewed)."""
    ids = [c["id"] for c in controls]
    if len(set(ids)) != len(ids):
        fail("row ids are not unique")
    if list(layer["controls"]) != ids:
        fail(f"the evidence layer and the annex list different rows: {sorted(set(layer['controls']) ^ set(ids))}")
    for c in controls:
        items, n = layer["controls"][c["id"]], len(c["obligations"])
        if not 3 <= len(items) <= 5:
            fail(f"{c['id']}: {len(items)} evidence items, expected 3 to 5")
        covered = set()
        for it in items:
            if not {"name", "description", "filetype", "covers"} <= set(it) or set(it) - ITEM_KEYS - {"covers"}:
                fail(f"{c['id']}: an evidence item with the keys {sorted(it)}")
            if not it["covers"] or it["covers"] != sorted(set(it["covers"])) or not all(isinstance(k, int) and 1 <= k <= n for k in it["covers"]):
                fail(f"{c['id']}: {it['name']!r} covers {it['covers']}, the row has obligations 1..{n}")
            covered |= set(it["covers"])
        if covered != set(range(1, n + 1)):
            fail(f"{c['id']}: no evidence item covers obligation(s) {sorted(set(range(1, n + 1)) - covered)} of 1..{n}")


def evidence_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """A row's authored items as the seeder's dict entries. `covers` stays in the layer."""
    return [{k: it[k] for k in ("name", "description", "filetype", "collection_frequency") if k in it} for it in items]


# ── the rows ─────────────────────────────────────────────────────────────────────────────────────

def mapped_ids(c: Dict[str, Any]) -> List[str]:
    return list(dict.fromkeys(i for st in c["statements"] for i in st["ids"]))


def criteria_of(c: Dict[str, Any]) -> List[str]:
    """Enumerated obligations as sentences. Where a control enumerates fewer than two things to do, it has none, and
    "take the following into account" bullets never count: they are considerations, not things the entity shall do."""
    crit = [text for text, consideration in c["obligations"] if not consideration]
    return crit if len(crit) >= 2 else []


def applicability_of(policy: Dict[str, Any], c: Dict[str, Any]) -> str:
    if not policy["applicability"]:
        return policy["when"]
    return "; ".join(dict.fromkeys(st["applicability"] for st in c["statements"]))


def notes_of(policy: Dict[str, Any], c: Dict[str, Any], printed: int) -> str:
    ids = mapped_ids(c)
    na = next((st["na"] for st in c["statements"] if st["na"]), "NA")
    return (f"Applicability: {applicability_of(policy, c)}. Source: UAE IA v2.1 (November 2025), Annex E, Table {policy['table']} "
            f"({policy['heading']}), printed page {printed}. Maps to UAE IA v2.1 controls: "
            + (", ".join(ids) if ids else f"none (the annex prints {na})") + ".")


def control_row(policy: Dict[str, Any], c: Dict[str, Any], items: List[Dict[str, Any]], printed: int) -> Dict[str, Any]:
    dom_no, dom_name = c["domain"]
    statements = []
    for st in c["statements"]:
        s: Dict[str, Any] = {"pdf_pages": st["pages"]}
        if policy["applicability"]:
            s["applicability"] = st["applicability"]
        s["uae_ia_controls"] = st["ids"]
        if st["na"]:
            s["printed_as"] = st["na"]
        statements.append(s)
    return {
        "control_id": c["id"], "original_reference": c["number"], "title": c["name"],
        "description": c["description"], "full_text": c["text"],
        "domain": policy["domain"], "category": f"{dom_no} {dom_name}",
        "section_number": c["id"], "parent_section": f"{policy['annex']}-{dom_no.rstrip('.')}",
        "is_mandatory": False, "priority": "medium",
        "assessment_criteria": criteria_of(c), "ai_notes": notes_of(policy, c, printed),
        "evidence_requirements": evidence_items(items),
        # not read by the seeder; kept so the crosswalk tools and reviewers need not re-read the PDF
        "priority_tier": None, "applicability": applicability_of(policy, c), "annex": policy["annex"],
        "uae_ia_controls": mapped_ids(c), "statements": statements, "obligations": [text for text, _ in c["obligations"]],
        "pdf_page": c["page"]}


def build(pdf: Path, layer_path: Path) -> Tuple[Dict[str, Any], List[str]]:
    try:
        import fitz                                                            # PyMuPDF
    except ImportError:
        fail("PyMuPDF is required: pip install PyMuPDF")
    doc = fitz.open(str(pdf))
    known = standard_control_ids(doc)
    tables = locate_tables(doc)
    repairs: List[str] = []
    controls: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for policy, table in zip(POLICIES, tables):
        raw = read_policy(doc, table, policy)
        cross_check(policy, raw, flat_pass(doc, table, policy))
        check_numbering(policy, raw)
        for c in assemble(policy, raw, known, repairs):
            c["id"] = f"{policy['annex']}-{c['number']}"
            controls.append((policy, c))
    layer = json.loads(layer_path.read_text(encoding="utf-8"))
    check_layer(layer, [c for _, c in controls])
    rows = [control_row(policy, c, layer["controls"][c["id"]], printed_page(doc, c["page"])) for policy, c in controls]
    return {"about": ABOUT, "standard": "UAE Information Assurance Standard", "version": "2.1", "source": SOURCE,
            "source_pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "controls": rows}, repairs


def summary(payload: Dict[str, Any], path: Path) -> None:
    print(f"wrote {path} ({path.stat().st_size:,} bytes): {len(payload['controls'])} rows")
    for policy in POLICIES:
        c = [x for x in payload["controls"] if x["annex"] == policy["annex"]]
        st = [s for x in c for s in x["statements"]]
        items = [len(x["evidence_requirements"]) for x in c]
        mapped = [i for x in c for i in x["uae_ia_controls"]]
        print(f"{policy['annex']} {policy['heading']} (Table {policy['table']}):")
        print(f"  {len({x['category'] for x in c})} policy domains, {len(c)} controls (each a sub-domain), {len(st)} statements, "
              f"{sum(len(x['obligations']) for x in c)} obligations")
        print(f"  applicability: by control {dict(Counter(x['applicability'] for x in c))}; "
              f"by statement {dict(Counter(s.get('applicability') or x['applicability'] for x in c for s in x['statements']))}")
        print(f"  UAE IA v2.1 controls mapped: {len(set(mapped))} distinct, {len(mapped)} references; "
              f"statements printed NA: {sum(1 for s in st if not s['uae_ia_controls'])}")
        print(f"  assessment criteria: {sum(1 for x in c if x['assessment_criteria'])} controls, "
              f"{sum(len(x['assessment_criteria']) for x in c)} criteria")
        print(f"  evidence items: {sum(items)} (min {min(items)}, median {statistics.median(items)}, max {max(items)})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="the standard's PDF")
    ap.add_argument("out", type=Path, help="the staging file to write (seed_data/uae_ia_annex_e_rows.json)")
    ap.add_argument("--evidence", type=Path, default=SEED / "uae_ia_annex_e_evidence.json",
                    help="authored evidence layer (default: %(default)s)")
    args = ap.parse_args()
    payload, repairs = build(args.pdf, args.evidence)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    summary(payload, args.out)
    for r in repairs:
        print("printed typo kept out of the data:", r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
