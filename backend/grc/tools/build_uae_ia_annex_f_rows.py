r"""Build the Annex F rows of the UAE Information Assurance Standard v2.1 library from the standard's own PDF.

Annex F of the standard (UAE Cyber Security Council, November 2025), "Mapping of National Security Policies with UAE IA v2.1",
maps four national security policies to the standard's controls, one table each: the National Encryption Policy (Table 13), the
National Secure Remote Work Policy (Table 14), the National Third Party Security Policy (Table 15) and the National Data Exchange
Security Policy (Table 16). They are not frameworks of their own, and the annex does not say that an entity has to follow them: it
only says which UAE IA v2.1 controls each part of a policy corresponds to. Each numbered section (sub-domain) of a policy becomes
one extra ROW of the UAE IA library (seed_data/frameworks/uae_ia.json), in the shape of that library's own rows and of the Annex E
rows (build_uae_ia_annex_e_rows.py), in a staging file that is merged into the library later. The seeder does not read the staging
file (it loads seed_data/frameworks/*.json):

    python -I backend/grc/tools/build_uae_ia_annex_f_rows.py "UAE INFORMATION ASSURANCE STANDARD.pdf" \
        backend/grc/seed_data/uae_ia_annex_f_rows.json [--evidence backend/grc/seed_data/uae_ia_annex_f_evidence.json] [--check]

--check rebuilds in memory and compares with the file given, byte for byte, and writes nothing (exit 1 when they differ).

Apart from the evidence layer, nothing here is paraphrased or AI-authored: section names and Objective sentences are copied
verbatim from the PDF's text layer (line wraps and hyphenated line breaks repaired, page headers and footers dropped).

The tables, as printed (PDF page numbers; printed page = PDF page - 4):
  Section | Sub-domain | Objective | UAE IA v2.1 controls         (the heads differ: "Policy Domain", "Domain", "Section Name" ...)
  - The Section cell is the policy's top-level section ("2. Governance"); one cell spans all the sub-domains below it, and it
    can start on one page and go on, empty, on the next. Its name can wrap over three lines ("6. Post" / "Quantum" / "Cryptography").
  - Each row is one sub-domain: its number and name ("2.1 General Requirements"), its Objective (one sentence) and the UAE IA v2.1
    control ids, one per line (two on one line in Table 15: "T9.1.1 T9.1.2"). A row can be cut by a page break: the mapping cell
    of 3.3 in Table 14 goes on at the top of the next page; the Sub-domain and Objective cells are complete before it.
  - The ids are typed by hand and carry typos: a full stop after the letter ("T.3.4.3" for T3.4.3, 16 times), trailing spaces,
    and one id printed twice in a cell. They are read, not copied, and every repair is reported at the end of the build.

How the parse is checked: the annex states no totals, so the oracle is the number of sub-domains per section of each policy
(POLICIES below: 21, 12, 24 and 21 rows, 78 in all). The layout parse must find exactly those numbers, in order. A second,
independent pass over the flat text of the same pages finds the sub-domain numbers and, after each, the mapped ids; it must agree
with the layout parse row by row. Every Objective and every "number name" must be found in the page text as printed, and every
mapped id must be a control of the standard (Annex D lists all 134).

Evidence recommendations are the one part that does not come from the PDF: the annex names no evidence. They are an authored
layer (seed_data/uae_ia_annex_f_evidence.json, outside seed_data/frameworks/ because the loader globs *.json there, keyed by the
row ids) merged in as each row's evidence_requirements. The build stops unless every row has 1-3 items. The annex has one objective
per row, so there is nothing to trace and the items carry no `covers`. So the PDF plus the layer reproduce the staging file byte for byte.

How a row lands in the seeder's fields (grc/seed_frameworks.py reads only the keys below):
  control_id          "<annex>-<the sub-domain's printed number>": F1-2.1 ... F1-6.1 (encryption), F2-2.1 ... F2-5.3 (remote work),
                      F3-2.1 ... F3-8.4 (third party), F4-2.1 ... F4-7.2 (data exchange). The library's own ids are M1.1.1 ... T9.2.1
                      and the Annex E rows are E1-..., E3-...; the letter prefix keeps these ids unique and keeps the framework page,
                      which groups by the leading integer of a code, from putting them all under "2"
  original_reference  the sub-domain's number as printed          title   the sub-domain's name
  description         the Objective, verbatim                     full_text   the Objective and, on the next line, the mapped controls
  domain              "F1 National Encryption Policy mapping (Annex F)", "F2 ...", "F3 ...", "F4 ..."
  category            the Section cell as printed ("2. Governance")  section_number   the control_id   parent_section   "F1-2"
  is_mandatory        false: the annex states no duty. `applicability` says what the row is: "Mapping of the National Encryption
                      Policy to UAE IA v2.1 controls"
  priority            "medium": the annex carries no priority (priority_tier is null)
  assessment_criteria none: one Objective per row is one obligation, not an enumeration
  ai_notes            source page and, as the last sentence, the UAE IA v2.1 controls the row maps to
Keys the seeder does not read (priority_tier, applicability, annex, uae_ia_controls, statements, obligations, pdf_page) stay
in the JSON for reviewers and the crosswalk tools; they are the same keys as the Annex E rows carry, with the Objective as the
row's single obligation and its mapped controls as its single statement.

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
STRAY_DOT = re.compile(r"^([MT])\.(?=\d)")     # "T.3.4.3": a full stop typed after the letter
ID_LINE = re.compile(r"\s*(?:[MT]\.?\d+\.\d+\.\d+\.?\s*)+")      # a line of the mapping column in the flat text
ROLES = ("sec", "sub", "obj", "map")           # the four columns, left to right

SOURCE = "UAE Information Assurance Standard, Version 2.1, November 2025 (UAE Cyber Security Council, classification Open)"
ABOUT = ("Rows F1-*, F2-*, F3-* and F4-* for the UAE Information Assurance Standard library (frameworks/uae_ia.json): the four national "
         "security policies of its Annex F, one row per numbered policy section (sub-domain), in the shape of the library's own rows. "
         "F1 = Table 13 National Encryption Policy, F2 = Table 14 National Secure Remote Work Policy, F3 = Table 15 National Third Party "
         "Security Policy, F4 = Table 16 National Data Exchange Security Policy; control_id = the annex prefix, a dash and the "
         "sub-domain's printed number. Built from the standard's PDF by backend/grc/tools/build_uae_ia_annex_f_rows.py; text verbatim, "
         "evidence_requirements from uae_ia_annex_f_evidence.json. Staging only, to be merged into the library: the seeder does not "
         "read this file.")
POLICIES: List[Dict[str, Any]] = [
    # annex prefix, table, printed heading, the library domain, and the oracle: sub-domains per section, in print order
    {"annex": "F1", "table": 13, "heading": "National Encryption Policy", "domain": "F1 National Encryption Policy mapping (Annex F)",
     "sections": {2: 4, 3: 6, 4: 3, 5: 7, 6: 1}},
    {"annex": "F2", "table": 14, "heading": "National Secure Remote Work Policy",
     "domain": "F2 National Secure Remote Work Policy mapping (Annex F)", "sections": {2: 3, 3: 3, 4: 3, 5: 3}},
    {"annex": "F3", "table": 15, "heading": "National Third Party Security Policy",
     "domain": "F3 National Third Party Security Policy mapping (Annex F)", "sections": {2: 2, 3: 4, 4: 2, 5: 6, 6: 3, 7: 3, 8: 4}},
    {"annex": "F4", "table": 16, "heading": "National Data Exchange Security Policy",
     "domain": "F4 National Data Exchange Security Policy mapping (Annex F)", "sections": {2: 5, 3: 3, 4: 1, 5: 7, 6: 3, 7: 2}},
]
EXPECT_TOTAL = 78                              # 21 + 12 + 24 + 21


def fail(msg: str):
    sys.exit(f"build_uae_ia_annex_f_rows: {msg}")


# ── geometry: lines, rules, cells ────────────────────────────────────────────────────────────────

class Entry:
    """One printed line of a cell (or of the page)."""
    __slots__ = ("page", "x", "y", "y1", "base", "size", "bold", "white", "raw")

    def __init__(self, page, x, y, y1, base, size, bold, white, raw):
        self.page, self.x, self.y, self.y1, self.base = page, x, y, y1, base
        self.size, self.bold, self.white, self.raw = size, bold, white, raw

    @property
    def text(self) -> str:
        return " ".join(self.raw.split())


def entries_of(page) -> List[Entry]:
    """Every line of a page that holds text."""
    out: List[Entry] = []
    for block in page.get_text("dict")["blocks"]:
        for ln in block.get("lines", []):
            sp = [s for s in ln["spans"] if s["text"].strip()]
            if sp:
                out.append(Entry(page.number + 1, sp[0]["bbox"][0], min(s["bbox"][1] for s in sp), max(s["bbox"][3] for s in sp),
                                 sp[0]["origin"][1], max(s["size"] for s in sp), all("Bold" in s["font"] for s in sp),
                                 all(s["color"] == 0xFFFFFF for s in sp), "".join(s["text"] for s in ln["spans"])))
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
    """Top to bottom, left to right on one line (baselines within 2pt; the line pitch is 11.9pt)."""
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
    """The four tables of Annex F, found by their printed headings ("1. UAE IA v2.1 control mapping with National Encryption
    Policy") and captions ("Table 13 UAE IA v2.1 control mapping with National Encryption Policy", printed below each table)."""
    first = last = None
    for p in range(len(doc)):
        for e in entries_of(doc[p]):
            if e.size > 15 and e.text.startswith("Annex F:"):
                first = p + 1
            if e.size > 15 and e.text.startswith("Annex G:"):
                last = p + 1
    if not first or not last or last <= first:
        fail("cannot find Annex F and Annex G")
    tables: List[Dict[str, Any]] = []
    for pno in range(first, last):
        for e in sorted(entries_of(doc[pno - 1]), key=lambda e: e.base):
            m = re.fullmatch(r"(\d)\. UAE IA v2\.1 control mapping with (National .+)", e.text)
            if m and e.bold and 11 < e.size < 13:
                tables.append({"index": int(m.group(1)), "heading": m.group(2), "first": pno, "last": None, "number": None})
            m = re.fullmatch(r"Table (\d+) UAE IA v2\.1 control mapping with (National .+)", e.text)
            if m:
                if not tables or tables[-1]["last"]:
                    fail(f"table caption without a heading: {e.text!r}")
                tables[-1].update(last=pno, number=int(m.group(1)), caption=m.group(2))
    got = [(t["index"], t["number"], t["heading"], t.get("caption")) for t in tables]
    want = [(i, p["table"], p["heading"], p["heading"]) for i, p in enumerate(POLICIES, start=1)]
    if got != want:
        fail(f"Annex F holds {got}, expected {want}")
    return tables


def read_page(page, header_page: bool) -> List[Dict[str, Any]]:
    """The rows of one page of a table, in print order: {page, y0, y1, sub, obj, ids, sec}. sub, obj and ids are the printed lines
    of those cells; sec is the {key, lines} of the Section cell the row sits in (empty lines = the cell started on an earlier
    page). Text inside the table that falls in no cell stops the build."""
    n = page.number + 1
    hs, vs = rules_of(page)
    xs = cluster(vs)
    if len(xs) != len(ROLES) + 1:
        fail(f"p{n}: expected {len(ROLES)} columns, found vertical borders at {xs}")
    col = dict(zip(ROLES, zip(xs, xs[1:])))
    cells = {r: intervals(sorted(y for y, x0, x1 in hs if abs(x0 - (col[r][0] + 0.5)) < 1.5 and abs(x1 - col[r][1]) < 1.5)) for r in ROLES}
    if not cells["sub"] or not (cells["sub"] == cells["obj"] == cells["map"]):
        fail(f"p{n}: the rows of the Sub-domain, Objective and mapping columns do not line up")
    ents = [e for e in entries_of(page) if e.base < 790]
    head = [i for i, (a, b) in enumerate(cells["sub"]) if any(e.white and a <= (e.y + e.y1) / 2 < b for e in ents)]
    if head != ([0] if header_page else []):
        fail(f"p{n}: header rows at {head}, expected {[0] if header_page else []}")
    top, bottom = cells["sub"][0][0], cells["sub"][-1][1]
    rows = [{"page": n, "y0": a, "y1": b, "sub": [], "obj": [], "ids": []} for i, (a, b) in enumerate(cells["sub"]) if i not in head]
    sec_lines: Dict[Tuple[float, float], List[Entry]] = {c: [] for c in cells["sec"]}
    for e in ents:
        yc = (e.y + e.y1) / 2
        if e.white or not top <= yc < bottom:              # the header row, the heading above the table, its caption, the footer
            continue
        role = next((r for r in ROLES if col[r][0] - 0.5 <= e.x < col[r][1]), None)
        if role is None:
            fail(f"p{n}: a line outside the table columns: {e.text[:50]!r}")
        if role == "sec":
            cell = next((c for c in cells["sec"] if c[0] <= yc < c[1]), None)
            if cell is None:
                fail(f"p{n}: a Section line outside any cell: {e.text[:50]!r}")
            sec_lines[cell].append(e)
            continue
        row = next((r for r in rows if r["y0"] <= yc < r["y1"]), None)
        if row is None:
            fail(f"p{n}: a {role} line outside any row: {e.text[:50]!r}")
        row["ids" if role == "map" else role].append(e)
    for row in rows:
        mid = (row["y0"] + row["y1"]) / 2
        cell = next((c for c in cells["sec"] if c[0] <= mid < c[1]), None)
        if cell is None:
            fail(f"p{n}: a row at y={mid:.0f} has no Section cell")
        row["sec"] = {"key": (n, cell[0]), "lines": in_print_order(sec_lines[cell])}
        for k in ("sub", "obj", "ids"):
            row[k] = in_print_order(row[k])
    if not rows:
        fail(f"p{n}: no table rows")
    return rows


def join(lines: List[Entry], joined: Optional[List[str]] = None) -> str:
    """Wrapped lines -> one string. A line that ends in a hyphen right after a letter was broken inside a hyphenated word
    ("third-" / "party"), so no space is added (the word is noted in `joined`); a hyphen followed by a space in the print keeps it."""
    text, prev = "", ""
    for ln in lines:
        glued = bool(re.search(r"[A-Za-z0-9]-$", prev))
        if glued and joined is not None:
            joined.append((prev.split()[-1] + ln.text.split()[0]).rstrip(".,;:"))
        text += ("" if glued or not text else " ") + ln.text
        prev = ln.raw
    return text


def split_number(text: str) -> Tuple[str, str]:
    m = re.fullmatch(r"(\d+(?:\.\d+)*\.?)\s+(.+)", text)
    if not m:
        fail(f"a cell that should start with its number reads {text!r}")
    return m.group(1), m.group(2)


# ── rows ─────────────────────────────────────────────────────────────────────────────────────────

def read_policy(doc, table: Dict[str, Any]) -> List[Dict[str, Any]]:
    """-> sub-domains in print order: {number, name, section, page, pages, obj, ids} (obj and ids are the printed lines)."""
    out: List[Dict[str, Any]] = []
    section = None
    seen: set = set()
    for pno in range(table["first"], table["last"] + 1):
        for i, row in enumerate(read_page(doc[pno - 1], pno == table["first"])):
            sec = row["sec"]
            if sec["lines"] and sec["key"] not in seen:
                section = split_number(join(sec["lines"]))
            seen.add(sec["key"])
            if row["sub"]:
                if section is None:
                    fail(f"p{pno}: a row before any section")
                number, name = split_number(join(row["sub"]))
                if not row["obj"] or not row["ids"]:
                    fail(f"p{pno}: {number} {name}: an empty Objective or mapping cell")
                out.append({"number": number, "name": name, "section": section, "page": pno, "pages": [pno], "obj": row["obj"],
                            "ids": list(row["ids"])})
            else:
                # a row the page break cut: its Sub-domain and Objective cells were complete on the page before, only the mapping goes on
                if not (i == 0 and pno != table["first"] and out and not row["obj"] and row["ids"]):
                    fail(f"p{pno}: a row without a sub-domain that is not the end of the row above")
                out[-1]["pages"].append(pno)
                out[-1]["ids"] += row["ids"]
    return out


def check_numbering(policy: Dict[str, Any], rows: List[Dict[str, Any]]) -> None:
    """The oracle: the sub-domains read are exactly 2.1 ... 2.n, 3.1 ... 3.m ... of POLICIES, in order, each under the section
    of its first number. A row the parse lost, or one it made up, shows here."""
    want = [f"{s}.{k}" for s, n in policy["sections"].items() for k in range(1, n + 1)]
    got = [r["number"] for r in rows]
    if got != want:
        fail(f"{policy['annex']}: sub-domains read {got}, expected {want}")
    for r in rows:
        if r["section"][0].rstrip(".") != r["number"].split(".")[0]:
            fail(f"{policy['annex']} {r['number']} sits under section {r['section'][0]}")


def normalized(text: str) -> str:
    """Page text as one line: a hyphenated line break is closed, other line breaks and runs of blanks become one space."""
    return re.sub(r"\s+", " ", re.sub(r"(?<=[A-Za-z0-9])-\n", "-", text)).strip()


def flat_pass(doc, table: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Section numbers, sub-domain numbers and the raw tokens of their mapping cells, read from page.get_text() alone: a line that
    starts with 'n.k' opens a sub-domain, a line that starts with 'n. ' a section; id lines after it belong to it."""
    opener = re.compile(r"\s*(\d+\.\d+)(?:\s|$)")
    section = re.compile(r"\s*(\d+)\.\s+(?!UAE IA)\S")
    sections: List[str] = []
    out: List[Dict[str, Any]] = []
    for pno in range(table["first"], table["last"] + 1):
        for line in doc[pno - 1].get_text("text").splitlines():
            m = opener.match(line)
            if m:
                out.append({"number": m.group(1), "tokens": []})
            elif section.match(line):
                sections.append(section.match(line).group(1))
            elif out and ID_LINE.fullmatch(line):
                out[-1]["tokens"] += line.split()
    return sections, out


def cross_check(policy: Dict[str, Any], rows: List[Dict[str, Any]], flat: Tuple[List[str], List[Dict[str, Any]]], pages: Dict[int, str]) -> None:
    """The layout parse and the text pass must list the same sections and sub-domains with the same mapped tokens, and what the
    layout parse took for a name and an Objective must be in the page text as printed."""
    sections, flat_rows = flat
    a, b = [r["number"] for r in rows], [f["number"] for f in flat_rows]
    if a != b:
        fail(f"{policy['annex']}: the layout parse and the text pass list different sub-domains: {sorted(set(a) ^ set(b))} / {len(a)} vs {len(b)}")
    layout_sections = list(dict.fromkeys(r["section"][0].rstrip(".") for r in rows))
    if layout_sections != sections:
        fail(f"{policy['annex']}: sections {layout_sections} in the layout parse, {sections} in the text pass")
    for r, f in zip(rows, flat_rows):
        layout = [t for e in r["ids"] for t in e.text.split()]
        if layout != f["tokens"]:
            fail(f"{policy['annex']} {r['number']}: mapped ids differ: layout {layout}, text {f['tokens']}")
        page = pages[r["page"]]
        if f"{r['number']} {r['name']}" not in page or join(r["obj"]) not in page:
            fail(f"{policy['annex']} {r['number']}: the name or the Objective is not in the page text as printed")


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


def clean_ids(tokens: List[str], where: str, known: set, repairs: List[str]) -> List[str]:
    """Printed mapping tokens -> control ids. Repairs a full stop typed after the letter ("T.3.4.3") or at the end, and drops an id
    repeated in the cell; every id must be a control of the standard. Each repair is noted in `repairs`."""
    ids: List[str] = []
    for raw in tokens:
        t = raw.strip()
        fixed = STRAY_DOT.sub(r"\1", t).rstrip(".")
        if fixed != t:
            repairs.append(f"{where}: printed {t!r}, read as {fixed!r}")
        if fixed not in known:
            fail(f"{where}: {t!r} is not a control of the standard")
        if fixed in ids:
            repairs.append(f"{where}: {fixed} is printed twice in one cell, kept once")
            continue
        ids.append(fixed)
    return ids


def assemble(policy: Dict[str, Any], raw_rows: List[Dict[str, Any]], known: set, repairs: List[str]) -> List[Dict[str, Any]]:
    out = []
    for r in raw_rows:
        where = f"{policy['annex']} {r['number']}"
        joined: List[str] = []
        objective = join(r["obj"], joined)
        repairs += [f"{where}: the Objective breaks {w!r} over two lines, joined" for w in joined]
        tokens: List[str] = []
        for e in r["ids"]:
            parts = e.text.split()
            if len(parts) > 1:
                repairs.append(f"{where}: {e.text!r} is printed on one line, read as {len(parts)} ids")
            tokens += parts
        out.append({"id": f"{policy['annex']}-{r['number']}", "number": r["number"], "name": r["name"], "section": r["section"],
                    "page": r["page"], "pages": r["pages"], "objective": objective, "ids": clean_ids(tokens, where, known, repairs)})
    return out


def parse(pdf: Path) -> Tuple[List[Tuple[Dict[str, Any], Dict[str, Any]]], List[str], Any]:
    """The PDF -> ([(policy, row)], repairs, the open document). No evidence layer yet."""
    try:
        import fitz                                                            # PyMuPDF
    except ImportError:
        fail("PyMuPDF is required: pip install PyMuPDF")
    doc = fitz.open(str(pdf))
    known = standard_control_ids(doc)
    repairs: List[str] = []
    rows: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for policy, table in zip(POLICIES, locate_tables(doc)):
        raw = read_policy(doc, table)
        check_numbering(policy, raw)
        cross_check(policy, raw, flat_pass(doc, table),
                    {p: normalized(doc[p - 1].get_text("text")) for p in range(table["first"], table["last"] + 1)})
        rows += [(policy, c) for c in assemble(policy, raw, known, repairs)]
    if len(rows) != EXPECT_TOTAL or len({c["id"] for _, c in rows}) != EXPECT_TOTAL:
        fail(f"Annex F holds {len(rows)} rows, expected {EXPECT_TOTAL}")
    return rows, repairs, doc


# ── the evidence layer ───────────────────────────────────────────────────────────────────────────

ITEM_KEYS = {"name", "description", "filetype", "collection_frequency"}      # what the seeder reads from a dict entry


def check_layer(layer: Dict[str, Any], rows: List[Dict[str, Any]]) -> None:
    """The layer holds 1-3 items for exactly the rows, in row order, each with the keys the seeder reads and nothing else
    (`covers` too: one objective per row leaves nothing to trace)."""
    ids = [c["id"] for c in rows]
    if len(set(ids)) != len(ids):
        fail("row ids are not unique")
    if list(layer["controls"]) != ids:
        fail(f"the evidence layer and the annex list different rows: {sorted(set(layer['controls']) ^ set(ids))}")
    for cid in ids:
        items = layer["controls"][cid]
        if not 1 <= len(items) <= 3:
            fail(f"{cid}: {len(items)} evidence items, expected 1 to 3")
        for it in items:
            if not {"name", "description", "filetype"} <= set(it) or set(it) - ITEM_KEYS:
                fail(f"{cid}: an evidence item with the keys {sorted(it)}")
            if not all(isinstance(it[k], str) and it[k].strip() for k in it):
                fail(f"{cid}: an evidence item with an empty or non-text value: {it.get('name')!r}")


def evidence_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """A row's authored items as the seeder's dict entries."""
    return [{k: it[k] for k in ("name", "description", "filetype", "collection_frequency") if k in it} for it in items]


# ── the rows ─────────────────────────────────────────────────────────────────────────────────────

def control_row(policy: Dict[str, Any], c: Dict[str, Any], items: List[Dict[str, Any]], printed: int) -> Dict[str, Any]:
    sec_no, sec_name = c["section"]
    ids = c["ids"]
    return {
        "control_id": c["id"], "original_reference": c["number"], "title": c["name"],
        "description": c["objective"], "full_text": f"{c['objective']}\nMapped UAE IA v2.1 controls: {', '.join(ids)}",
        "domain": policy["domain"], "category": f"{sec_no} {sec_name}",
        "section_number": c["id"], "parent_section": f"{policy['annex']}-{sec_no.rstrip('.')}",
        "is_mandatory": False, "priority": "medium",
        "assessment_criteria": [],
        "ai_notes": (f"Source: UAE IA v2.1 (November 2025), Annex F, Table {policy['table']} ({policy['heading']}), printed page "
                     f"{printed}. Maps to UAE IA v2.1 controls: {', '.join(ids)}."),
        "evidence_requirements": evidence_items(items),
        # not read by the seeder; kept so the crosswalk tools and reviewers need not re-read the PDF
        "priority_tier": None, "applicability": f"Mapping of the {policy['heading']} to UAE IA v2.1 controls", "annex": policy["annex"],
        "uae_ia_controls": ids, "statements": [{"pdf_pages": c["pages"], "uae_ia_controls": ids}], "obligations": [c["objective"]],
        "pdf_page": c["page"]}


def build(pdf: Path, layer_path: Path) -> Tuple[Dict[str, Any], List[str]]:
    rows, repairs, doc = parse(pdf)
    layer = json.loads(layer_path.read_text(encoding="utf-8"))
    check_layer(layer, [c for _, c in rows])
    out = [control_row(policy, c, layer["controls"][c["id"]], printed_page(doc, c["page"])) for policy, c in rows]
    return {"about": ABOUT, "standard": "UAE Information Assurance Standard", "version": "2.1", "source": SOURCE,
            "source_pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "controls": out}, repairs


def render(payload: Dict[str, Any]) -> bytes:
    return (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def summary(payload: Dict[str, Any], path: Path) -> None:
    print(f"{path} ({path.stat().st_size:,} bytes): {len(payload['controls'])} rows")
    for policy in POLICIES:
        c = [x for x in payload["controls"] if x["annex"] == policy["annex"]]
        items = [len(x["evidence_requirements"]) for x in c]
        mapped = [i for x in c for i in x["uae_ia_controls"]]
        print(f"{policy['annex']} {policy['heading']} (Table {policy['table']}):")
        print(f"  {len({x['category'] for x in c})} sections, {len(c)} rows (each a sub-domain)")
        print(f"  UAE IA v2.1 controls mapped: {len(set(mapped))} distinct, {len(mapped)} references")
        print(f"  evidence items: {sum(items)} (min {min(items)}, median {statistics.median(items)}, max {max(items)}), "
              f"by row {dict(sorted(Counter(items).items()))}")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="the standard's PDF")
    ap.add_argument("out", type=Path, help="the staging file to write (seed_data/uae_ia_annex_f_rows.json)")
    ap.add_argument("--evidence", type=Path, default=SEED / "uae_ia_annex_f_evidence.json",
                    help="authored evidence layer (default: %(default)s)")
    ap.add_argument("--check", action="store_true", help="rebuild in memory, compare with OUT byte for byte, write nothing")
    args = ap.parse_args(argv)
    payload, repairs = build(args.pdf, args.evidence)
    data = render(payload)
    if args.check:
        same = args.out.exists() and args.out.read_bytes() == data
        print(f"{args.out} {'is what the PDF and the evidence layer build' if same else 'DIFFERS from what the PDF and the evidence layer build'}")
        return 0 if same else 1
    with open(args.out, "wb") as f:
        f.write(data)
    print("wrote", end=" ")
    summary(payload, args.out)
    for r in repairs:
        print("printed typo kept out of the data:", r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
