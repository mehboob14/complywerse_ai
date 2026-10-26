"""Build the UAE Information Assurance Standard v2.1 framework library from the standard's own PDF.

The standard (UAE Cyber Security Council, November 2025) is not in SCF, so its library is read
straight from the published PDF's text layer. Apart from the evidence layer below, nothing here is
paraphrased or AI-authored: control names, statements, sub-controls and implementation guidance are
copied verbatim (line wraps and hyphenated line breaks repaired, page headers and footers dropped).

    python -I backend/grc/tools/build_uae_ia_catalog.py "UAE INFORMATION ASSURANCE STANDARD.pdf" \
        backend/grc/seed_data/frameworks/uae_ia.json [--evidence backend/grc/seed_data/uae_ia_evidence.json]

Evidence recommendations are the one part that does not come from the PDF: the standard names no evidence. They are an
authored layer, to be reviewed like code (seed_data/uae_ia_evidence.json, outside seed_data/frameworks/ because the loader
globs *.json there) that this script merges in as each control's evidence_requirements. Every item lists the sub-controls it
evidences in `covers`; the script stops unless every control has items and every sub-control is covered by at least one.
`covers` is review traceability and is not shipped. So the PDF plus the layer reproduce the committed catalog byte for byte.

Where each fact comes from (PDF page numbers; printed page = PDF page - 4):
  Chapter 2 (13-182)  families, sub-families, controls. The priority legend "P1 P2 P3 P4" is printed
                      on every control; the real priority is the highlighted cell, so it is read
                      from the cell fills and checked against Annex C.
  Annex A  (192)      the standard's own totals                       asserted
  Annex B  (193-195)  the always-applicable controls                  asserted == Applicability rows
  Annex C  (196-200)  controls by priority                            asserted == highlighted cells
  Annex D  (201-206)  mapping to ISO 27001/27002:2022, NIST 800-53 r5, ISRv3   kept on each control
  Annex G  (226-230)  mapping to UAE IA v1.1                          kept on each control
  Annex H  (231-235)  control type (preventive/detective/corrective)  kept on each control
Annex E/F (national cloud/AI/IoT/encryption policy controls and their mapping) are not part of the
control set and are not read.

How a control lands in the seeder's fields (grc/seed_frameworks.py reads only the keys below):
  description         the control statement                     full_text   statement + numbered sub-controls
  assessment_criteria each sub-control as one sentence. The sub-control is the standard's unit of
                      conformity, and the framework page shows these as a tick list that scores the control
  ai_notes            applicability, priority, type, Annex D/G references and the implementation guidance
                      (informational in the standard, so kept apart from the requirement text that AI gap
                      analysis reads); the certification API serves it as `implementation_guidance`
  is_mandatory        true = Always applicable; false = Based on risk assessment (applicable unless excluded)
  evidence_requirements  the authored layer above: {name, description, filetype} like ADHICS and PISF, plus
                      collection_frequency on the few items that are event-driven or continuous. The seeder reads a
                      frequency only from the entry itself (a dict entry otherwise defaults to annually) and infers the
                      evidence type from the name and description, so the wording avoids misleading keywords
  priority            P1 high, P2 medium, P3/P4 low. priority_level is deliberately NOT written: the
                      framework page turns any framework with P1-P3 levels into NDMO's "3-year roadmap"
                      (Year 1/2/3, P4 ignored). The exact level is kept in the extra key `priority_tier`
Keys the seeder does not read (priority_tier, applicability, control_type, mappings, uae_ia_v1_1, ...)
stay in the JSON for the crosswalk tools and reviewers.

Requires PyMuPDF. Run it isolated (python -I) on an untrusted download.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

EVIDENCE_LAYER = Path(__file__).resolve().parents[1] / "seed_data" / "uae_ia_evidence.json"
CHAPTER2 = range(13, 183)                     # PDF pages holding M1..T9
ANNEX_A = 192
ANNEX_B, ANNEX_C, ANNEX_D, ANNEX_G, ANNEX_H = range(193, 196), range(196, 201), range(201, 207), range(226, 231), range(231, 236)

# the standard's own totals (Annex A tables 4-5, Annex C table 7)
EXPECT = {"Family": 15, "Sub-Family": 47, "Control": 134, "Sub-Control": 449,
          "Always Applicable": 70, "Risk Based": 64, "P1": 39, "P2": 60, "P3": 24, "P4": 11}

ID = re.compile(r"[MT]\d+(\.\d+){0,2}")
CONTROL_ID = re.compile(r"[MT]\d+\.\d+\.\d+")
SECTION_OF = {"Objective": "objective", "Performance Indicator": "performance_indicator",
              "Performance indicator": "performance_indicator", "Automation Guidance": "automation_guidance",
              "Relevant Threats and": "threats", "Control": "statement", "Sub-Control": "subcontrols",
              "Implementation Guidance": "guidance"}
MARKER_ONLY = re.compile(r"[a-z]{1,2}\.|\d+\)|•")        # "f." / "3)" / a bullet alone on a line
ITEM_START = re.compile(r"([a-z]{1,2}\.|\d+[.)]|•)\s")
NESTED = re.compile(r"([a-z]{1,2}|[ivx]+)\.\s|•\s")        # "a. " / "ii. " / bullet under a numbered item
PARAGRAPH_GAP = 14.5                           # Word's line pitch is 13.2pt; a new paragraph adds 3pt
PRIORITY_FILL = {(1.0, 0.0, 0.0): 0, (1.0, 0.753, 0.0): 1, (1.0, 1.0, 0.0): 2, (0.0, 0.69, 0.941): 3}  # P1..P4
APPLICABILITY = {"always applicable": "Always applicable", "based on risk assessment": "Based on risk assessment"}
SEVERITY = {"P1": "high", "P2": "medium", "P3": "low", "P4": "low"}   # Chapter 3.5; see metadata.adoption_approach


class Line:
    __slots__ = ("page", "x", "x1", "y", "y1", "size", "white", "raw")

    def __init__(self, page, x, x1, y, y1, size, white, raw):
        self.page, self.x, self.x1, self.y, self.y1, self.size, self.white, self.raw = page, x, x1, y, y1, size, white, raw

    @property
    def text(self) -> str:
        return " ".join(self.raw.split())


def fail(msg: str):
    sys.exit(f"build_uae_ia_catalog: {msg}")


def page_lines(page, merge_rows: bool = False) -> List[Line]:
    """Body lines of one page in content-stream order (Word writes table cells row by row).
    The running footer ("Document Classification: Open", page number) sits below y=790.
    merge_rows glues back pieces of one visual line that PyMuPDF split: justified text ("Relevant" "Threats" "and"),
    a list marker from its text ("f." "continue ..."), a bullet from its text. Only text on the same baseline within
    18pt of the previous piece joins, so a table's label column never joins its content column."""
    out: List[Line] = []
    for block in page.get_text("dict")["blocks"]:
        for ln in block.get("lines", []):
            spans = [s for s in ln["spans"] if s["text"].strip()]
            if not spans or not 5 < ln["bbox"][1] < 790:
                continue
            new = Line(page.number + 1, ln["bbox"][0], ln["bbox"][2], ln["bbox"][1], ln["bbox"][3],
                       max(s["size"] for s in spans), all(s["color"] == 0xFFFFFF for s in spans),
                       "".join(s["text"] for s in ln["spans"]))
            prev = out[-1] if out else None
            if (merge_rows and prev and not prev.white and not new.white and abs(new.y1 - prev.y1) < 2
                    and 0 <= new.x - prev.x1 < 18):
                prev.raw, prev.x1 = prev.raw + " " + new.raw, new.x1
            else:
                out.append(new)
    return out


def join(lines: List[Line]) -> str:
    """Wrapped lines -> one string. A line that ends in a hyphen right after a letter was broken inside a
    hyphenated word ("cross-" / "functional"), so no space is added; "likelihood- " keeps its space."""
    text, prev = "", ""
    for ln in lines:
        text += ("" if re.search(r"[A-Za-z0-9]-$", prev) or not text else " ") + ln.text
        prev = ln.raw
    return text


def paragraphs(lines: List[Line]) -> List[str]:
    """Wrapped lines -> paragraphs and list items. A new one starts at a list marker or an extra 3pt gap;
    across a page break, at a capital after a sentence end."""
    out, cur, prev = [], [], None
    for ln in lines:
        if prev is not None and (ITEM_START.match(ln.text)
                                 or (ln.page == prev.page and ln.y - prev.y > PARAGRAPH_GAP)
                                 or (ln.page != prev.page and prev.text[-1:] in ".:;" and ln.text[:1].isupper())):
            out.append(join(cur))
            cur = []
        cur.append(ln)
        prev = ln
    if cur:
        out.append(join(cur))
    return out


def priority_of(cells: List[Tuple[float, float, float, tuple]], ln: Line) -> str:
    """The highlighted P-cell of the control header on `ln`'s row. Cells are told apart by their order, not
    their label (one header is mistyped "P1 P1 P2 P3"); the fill colour must agree with the position."""
    yc = ln.y + 5.5
    cols: List[Tuple[float, tuple]] = []
    for x, y0, y1, fill in sorted(c for c in cells if c[1] <= yc <= c[2]):
        if not cols or x - cols[-1][0] >= 12:                  # a cell's outer and inner rectangles collapse into one
            cols.append((x, fill))
    hot = [i for i, (_, fill) in enumerate(cols) if fill in PRIORITY_FILL]
    if len(cols) != 4 or len(hot) != 1 or PRIORITY_FILL[cols[hot[0]][1]] != hot[0]:
        fail(f"cannot read the priority highlight of the control header at p{ln.page} ({ln.text})")
    return f"P{hot[0] + 1}"


def priority_cells(page) -> List[Tuple[float, float, float, tuple]]:
    """(x0, y0, y1, fill) of every filled rectangle that can be a P-cell (about 20-30pt square, right of x=430)."""
    return [(d["rect"].x0, d["rect"].y0, d["rect"].y1, tuple(round(v, 3) for v in d["fill"]))
            for d in page.get_drawings()
            if d.get("fill") is not None and 17 < d["rect"].width < 35 and 17 < d["rect"].height < 25 and d["rect"].x0 > 430]


# ── Chapter 2 ───────────────────────────────────────────────────────────────────────────────────

def read_nodes(doc) -> List[Dict[str, Any]]:
    """Families, sub-families and controls in document order, each with its raw header and body lines."""
    nodes: List[Dict[str, Any]] = []
    node, repeat = None, False
    for pno in CHAPTER2:
        page = doc[pno - 1]
        cells = None
        for ln in page_lines(page, merge_rows=True):
            t = ln.text
            if ln.size > 12 or (re.fullmatch(r"P[1-4]", t) and ln.x > 430):    # banners; the priority legend
                continue
            if ln.white and ln.x < 100 and ID.fullmatch(t):
                repeat = bool(node) and node["id"] == t                       # Word repeats a header row after a page break
                if not repeat:
                    node = {"id": t, "kind": t.count("."), "lines": [], "page": pno}
                    if node["kind"] == 2:
                        cells = cells or priority_cells(page)
                        node["priority"] = priority_of(cells, ln)
                    nodes.append(node)
                continue
            if repeat:
                if ln.white or ln.x >= 430:                                    # still inside the repeated header row
                    continue
                repeat = False
            node["lines"].append(ln)
    return nodes


def label_of(ln: Line) -> Optional[str]:
    """The cell a label line opens ("Control" -> statement). The guidance bar may carry a note, "Implementation
    Guidance (for information purpose only)", and one is indented to x=54; the other labels sit at x=48.8."""
    if ln.text.startswith("Implementation Guidance") and (ln.white or 46 < ln.x < 52):
        return "guidance"
    return SECTION_OF.get(ln.text) if 46 < ln.x < 52 else None


def split_header(node: Dict[str, Any]) -> Tuple[List[Line], Dict[str, List[Line]]]:
    """(header lines, {section: lines}). The header is the leading dark-filled run; every other line belongs to
    the cell opened by the label ("Control", "Sub-Control", "Objective" ...) before it."""
    lines = node["lines"]
    n = 0
    while n < len(lines) and (lines[n].white and not label_of(lines[n]) or lines[n].x >= 430):
        n += 1
    sections: Dict[str, List[Line]] = {}
    cur = None
    for ln in lines[n:]:
        if label_of(ln):
            cur = label_of(ln)
            sections[cur] = []
        elif 46 < ln.x < 52 and ln.text == "Vulnerabilities":                  # 2nd line of "Relevant Threats and"
            continue
        elif cur is None or MARKER_ONLY.fullmatch(ln.text):
            fail(f"stray text at p{ln.page}: {ln.text[:60]!r}")                # before the first label / a split-off marker
        else:
            sections[cur].append(ln)
    return lines[:n], sections


def parse_subcontrols(lines: List[Line]) -> List[Dict[str, Any]]:
    """The Sub-Control cell as entries in print order: {"lead": "The entity shall:"} for an unnumbered paragraph,
    {"n", "text", "nested"} for a '1) ...' item with the 'a. ...' and bullet points under it. A numbered item's own
    wrapped lines hang at x~193, so an unnumbered line at the item indent (x~175) is a paragraph of its own."""
    entries: List[Dict[str, Any]] = []
    for ln in lines:
        m = re.match(r"(\d+)\)\s", ln.text + " ")
        last = entries[-1] if entries else None
        if m and ln.x < 185:
            entries.append({"n": int(m.group(1)), "lines": [Line(ln.page, ln.x, ln.x1, ln.y, ln.y1, ln.size, ln.white,
                                                                  re.sub(r"^\s*\d+\)\s*", "", ln.raw))], "nested": []})
        elif ln.x < 185:
            prev = last["lead"][-1] if last and "lead" in last else None
            if prev and (prev.page != ln.page or ln.y - prev.y <= PARAGRAPH_GAP):
                last["lead"].append(ln)
            else:
                entries.append({"lead": [ln]})
        elif not last or "n" not in last:
            fail(f"indented sub-control text with no item above it at p{ln.page}: {ln.text[:60]!r}")
        elif NESTED.match(ln.text):
            last["nested"].append([ln])
        elif last["nested"]:
            last["nested"][-1].append(ln)
        else:
            last["lines"].append(ln)
    out = []
    for e in entries:
        if "lead" in e:
            out.append({"lead": join(e["lead"])})
            continue
        nested, after_letter = [], False
        for n in e["nested"]:
            text = join(n)
            nested.append(("   " if text.startswith("•") and after_letter else "") + text)   # bullets under 'd.' sit deeper
            after_letter = after_letter and text.startswith("•") or not text.startswith("•")
        out.append({"n": e["n"], "text": join(e["lines"]), "nested": nested})
    return out


def build_hierarchy(nodes: List[Dict[str, Any]]):
    """-> (families, controls): families[i] = {id, name, objective, performance_indicator, sub_families: [...]}
    and controls as flat dicts that carry their family and sub-family."""
    families: List[Dict[str, Any]] = []
    controls: List[Dict[str, Any]] = []
    fam = sub = None
    for node in nodes:
        header, sec = split_header(node)
        name = join([h for h in header if h.x >= 100 and h.x < 300 and h.text not in ("Priority", "Applicability")]) if node["kind"] == 2 \
            else join([h for h in header if h.x >= 100])
        if node["kind"] == 0:
            fam = {"id": node["id"], "name": name, "objective": "\n".join(paragraphs(sec["objective"])),
                   "performance_indicator": "\n".join(paragraphs(sec["performance_indicator"])), "sub_families": []}
            families.append(fam)
        elif node["kind"] == 1:
            sub = {"id": node["id"], "name": name, "objective": "\n".join(paragraphs(sec["objective"])),
                   "performance_indicator": "\n".join(paragraphs(sec["performance_indicator"])),
                   "automation_guidance": "\n".join(paragraphs(sec["automation_guidance"])),
                   "relevant_threats_and_vulnerabilities": [re.sub(r"^•\s*", "", p) for p in paragraphs(sec["threats"])]}
            fam["sub_families"].append(sub)
        else:
            appl = APPLICABILITY.get(join([h for h in header if h.x >= 430]).lower())
            controls.append({
                "id": node["id"], "name": name, "page": node["page"], "priority": node["priority"], "applicability": appl,
                "family": fam, "sub_family": sub, "statement": join(sec["statement"]),
                "sub_controls": parse_subcontrols(sec["subcontrols"]),
                "guidance": paragraphs(sec.get("guidance", []))})
    return families, controls


# ── Annexes ─────────────────────────────────────────────────────────────────────────────────────

def read_table(doc, pages, columns: List[float]) -> Dict[str, List[str]]:
    """{control id: [text of each data column]} for an annex table. `columns` are the x where the data columns
    start; the number and name columns to their left are ignored. Rows that run over a page keep collecting."""
    rows: Dict[str, List[List[Line]]] = {}
    cur = None
    for pno in pages:
        for ln in page_lines(doc[pno - 1]):
            if ln.size > 12 or ln.white:                                       # annex title; the dark header row
                continue
            if ln.x < 100 and CONTROL_ID.fullmatch(ln.text):
                cur = rows.setdefault(ln.text, [[] for _ in columns])
            elif cur is not None and ln.x >= columns[0] - 3:
                cur[max(i for i, x in enumerate(columns) if ln.x >= x - 3)].append(ln)
    return {cid: [join(cell) for cell in cells] for cid, cells in rows.items()}


def ids_by_heading(doc, pages) -> Dict[str, List[str]]:
    """Annex B/C lists: control ids under each 'Pn Controls' heading ('' when there is none)."""
    out: Dict[str, List[str]] = defaultdict(list)
    head = ""
    for pno in pages:
        for ln in page_lines(doc[pno - 1]):
            m = re.fullmatch(r"(P\d) Controls", ln.text)
            if m:
                head = m.group(1)
            elif ln.x < 100 and CONTROL_ID.fullmatch(ln.text):
                out[head].append(ln.text)
    return out


def annex_totals(doc) -> Dict[str, int]:
    """Annex A (Tables 4-5) and Annex C (Table 7): label line followed by its number."""
    out: Dict[str, int] = {}
    for pno in (ANNEX_A, ANNEX_C[0]):
        texts = [ln.text for ln in page_lines(doc[pno - 1])]
        for label, num in zip(texts, texts[1:]):
            if label in EXPECT and num.isdigit():
                out[label] = int(num)
    return out


def annex_d_mapping(cells: List[str]) -> Dict[str, List[str]]:
    """Annex D row -> references per standard. One ISO column holds both ISO standards: 'Clause 4.1' is ISO 27001:2022,
    a bare '5.11' is ISO 27002:2022. The NIST column keeps phrases such as 'All XX-1 controls'. The printed cells have
    typos (a missing comma in ISRv3 '5.5 6.1.4', a space in NIST 'PE- 20'), which are repaired here, not in the text."""
    iso_cell, nist_cell, isr_cell = cells
    iso = [r.strip() for r in iso_cell.split(",") if r.strip() not in ("", "None")]
    if [r for r in iso if not (r.startswith("Clause ") or re.fullmatch(r"\d+\.\d+", r))]:
        fail(f"unrecognised ISO reference in Annex D: {iso}")
    nist = [re.sub(r"-\s+(\d)", r"-\1", r.strip()) for r in nist_cell.split(",") if r.strip() not in ("", "None")]
    isr = re.findall(r"All Domains|\d+(?:\.\d+)*", isr_cell)
    dedup = lambda refs: list(dict.fromkeys(refs))                              # M5.2.1 prints CA-2 twice
    return {"iso_27001_2022": [r for r in iso if r.startswith("Clause ")],
            "iso_27002_2022": [r for r in iso if not r.startswith("Clause ")],
            "nist_800_53_r5": dedup(nist), "isr_v3": dedup(isr)}


# ── assemble ────────────────────────────────────────────────────────────────────────────────────

def numbered(c: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [e for e in c["sub_controls"] if "n" in e]


def criteria(c: Dict[str, Any]) -> List[str]:
    """Each numbered sub-control as a complete sentence: the lead-in above it ("The entity shall:"), the item, and the
    a./b./bullet points under it."""
    out, lead = [], ""
    for e in c["sub_controls"]:
        if "lead" in e:
            lead = e["lead"]
        else:
            out.append(" ".join(p.strip() for p in [lead, e["text"], *e["nested"]] if p))
    return out


def full_text(c: Dict[str, Any]) -> str:
    lines = ["Sub-Controls:"]
    for e in c["sub_controls"]:
        if "lead" in e:
            lines.append(e["lead"])
        else:
            lines.append(f"{e['n']}) {e['text']}")
            lines.extend("   " + n for n in e["nested"])
    return c["statement"] + "\n\n" + "\n".join(lines)


def notes(c: Dict[str, Any], ref: Dict[str, List[str]], types: List[str], v1: List[str]) -> str:
    """Everything informational about a control, as plain text: where it sits in the standard, and the guidance."""
    def refs(key):
        return ", ".join(ref[key]) or "none listed"

    head = [f"Applicability: {c['applicability']}. Implementation priority: {c['priority']}. Control type: {', '.join(types)}. "
            f"UAE IA v1.1 (Annex G): {', '.join(v1) or 'new control'}.",
            "Mapping to leading standards (Annex D). ISO/IEC 27001:2022: " + refs("iso_27001_2022")
            + "; ISO/IEC 27002:2022: " + refs("iso_27002_2022") + "; NIST SP 800-53 r5: " + refs("nist_800_53_r5")
            + "; ISRv3: " + refs("isr_v3") + "."]
    if c["guidance"]:
        head += ["Implementation Guidance (for information purposes only; not a requirement of the standard):"] + c["guidance"]
    return "\n".join(head)


def check_evidence_layer(layer: Dict[str, Any], controls: List[Dict[str, Any]]) -> None:
    """The layer holds items for exactly the standard's controls, and every sub-control is covered by at least one item
    (a changed PDF with a new or renumbered sub-control stops here until the layer is reviewed)."""
    ids = [c["id"] for c in controls]
    if sorted(layer["controls"]) != sorted(ids):
        fail(f"the evidence layer and the standard list different controls: {sorted(set(layer['controls']) ^ set(ids))}")
    for c in controls:
        covered = {k for it in layer["controls"][c["id"]] for k in it["covers"]}
        if covered != set(range(1, len(numbered(c)) + 1)):
            fail(f"{c['id']}: evidence items cover sub-controls {sorted(covered)}, the control has 1..{len(numbered(c))}")


def evidence_items(layer: Dict[str, Any], c: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A control's authored items as the seeder's dict entries (as in ADHICS and PISF). `covers` stays in the layer."""
    return [{"name": it["name"], "description": it["description"], "filetype": it["filetype"],
             **({"collection_frequency": it["collection_frequency"]} if "collection_frequency" in it else {})}
            for it in layer["controls"][c["id"]]]


def metadata(families: List[Dict[str, Any]], controls: List[Dict[str, Any]], pdf_sha256: str) -> Dict[str, Any]:
    n_sub = sum(len(f["sub_families"]) for f in families)
    return {
        "name": "UAE Information Assurance Standard",
        "description": (
            "The UAE Information Assurance (UAE IA) Standard, issued by the UAE Cyber Security Council as a key "
            "component of the National Information Assurance Framework (NIAF), sets the minimum information "
            f"assurance requirements for entities in the UAE. It organises {len(controls)} controls and "
            f"{sum(len(numbered(c)) for c in controls)} sub-controls into {len(families)} families "
            f"({n_sub} sub-families): six management and nine technical. Each control is either always applicable or "
            "applicable based on the entity's risk assessment, and carries an implementation priority from P1 (first) to P4."),
        "version": "2.1",
        "source_organization": "UAE Cyber Security Council (CSC)",
        "jurisdiction": "United Arab Emirates",
        "effective_date": "2025-11-01",
        "date_note": "The standard is dated 'November 2025'; no day is given, so the first of the month is used.",
        "classification": "regulatory",
        "framework_type": "regulatory",
        "classification_reasoning": (
            "Published by the UAE Cyber Security Council as the national standard that Ministries, Federal Authorities "
            "and non-government Critical Information Infrastructure entities have to demonstrate compliance with (Chapter 1)."),
        "framework_purpose": (
            "To raise the minimum level of protection of information assets and supporting systems across all "
            "implementing entities in the UAE, and to serve as the national standard they demonstrate compliance with."),
        "framework_scope": (
            "Applies to Ministries and Federal Authorities and to non-government Critical Information Infrastructure (CII) "
            "entities. Where an Emirate CIIP programme exists, its Emirate Lead assesses applicability and enforces and "
            "monitors the standard for Emirate government entities and non-government CII entities; without one, the "
            "standard applies to Emirate government entities."),
        "framework_objectives": [
            "Achieve information assurance at national, Emirate, sectoral and entity level",
            "Apply a risk-based approach to deciding which controls an entity implements",
            "Clarify the roles and responsibilities of the stakeholders who plan, implement and monitor information assurance",
            "Provide a common catalogue of controls against prevalent threats and known vulnerabilities",
            "Implement in phases by control priority (P1 to P4)",
            "Define compliance and how the Cyber Security Council assesses it"],
        "target_audience": (
            "Ministries and Federal Authorities, non-government Critical Information Infrastructure entities and (where "
            "the standard applies) Emirate government entities; their information security leadership and teams; lead "
            "entities and sector regulators"),
        "certification_body": None,
        "certification_validity_period": None,
        "certification_levels": None,
        "certification_lifecycle": None,
        "required_artifacts": None,
        "regulatory_authority": "UAE Cyber Security Council (CSC), UAE Government",
        "compliance_deadline": None,
        "penalty_for_non_compliance": (
            "No penalties are stated. Omitting an Always Applicable control or any of its sub-controls is not acceptable "
            "and constitutes non-conformity to the standard (section 2.1)."),
        "adoption_approach": [
            "Run the entity risk assessment (section 3.3) before selecting controls",
            "Treat every control as applicable until the risk assessment says otherwise; the 70 Always Applicable controls "
            "are mandatory whatever the outcome, and an exclusion of any other control has to be justified and its risk "
            "accepted by an accountable person (sections 2.1 and 3.4)",
            "Implement in priority order, beginning with P1; priority sets the sequence of implementation and does not "
            "mean one control is more critical than another (section 3.5). In this library `priority` maps P1 to high, "
            "P2 to medium and P3 and P4 to low; the exact level is kept on the control",
            "In this library `is_mandatory` is true for Always Applicable controls and false for the controls that are "
            "Based on risk assessment. The standard treats both kinds as mandatory unless the risk assessment excludes the control",
            "Report progress to the lead entity or sector regulator (or to the CSC where there is none) and support its "
            "audit and testing (section 3.6)"],
        "hierarchy_structure": {
            "levels": ["Family", "Sub-family", "Control", "Sub-control"],
            "numbering_pattern": "M1.1.1 = management family M1, sub-family M1.1, control M1.1.1 (T1.1.1 for technical "
                                 "families); sub-controls are numbered 1), 2) ... inside the control"},
        "document_structure": {"sections": [
            {"number": f["id"], "name": f"{f['id']} {f['name']}", "description": f["objective"],
             "performance_indicator": f["performance_indicator"], "sub_families": f["sub_families"]} for f in families]},
        "source_framework_id": "UAE-IA-2.1",
        "source_pdf_sha256": pdf_sha256,
        "source_note": (
            "Built from the published PDF 'UAE Information Assurance Standard', Version 2.1, November 2025 (UAE Cyber "
            "Security Council, classification Open) by backend/grc/tools/build_uae_ia_catalog.py. Control names, "
            "statements, sub-controls and guidance are verbatim. Implementation guidance is informational in the standard "
            "and is kept in ai_notes, apart from the requirement text. Evidence requirements are not in the standard: they are "
            "recommendations authored for this library (backend/grc/seed_data/uae_ia_evidence.json), each grounded in the "
            "control's own statement, sub-controls or guidance and merged in by the same script. Annexes E and F are not part "
            "of this library."),
        "total_controls": len(controls),
    }


def build(pdf: Path, layer: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import fitz                                                            # PyMuPDF
    except ImportError:
        fail("PyMuPDF is required: pip install PyMuPDF")
    doc = fitz.open(str(pdf))
    families, controls = build_hierarchy(read_nodes(doc))

    d = read_table(doc, ANNEX_D, [250, 355, 470])
    g = read_table(doc, ANNEX_G, [300])
    h = read_table(doc, ANNEX_H, [380])
    always_b = ids_by_heading(doc, ANNEX_B)[""]
    by_prio = ids_by_heading(doc, ANNEX_C)
    totals = annex_totals(doc)

    # ── the standard's own totals, and the three independent lists ──
    got = {"Family": len(families), "Sub-Family": sum(len(f["sub_families"]) for f in families), "Control": len(controls),
           "Sub-Control": sum(len(numbered(c)) for c in controls),
           "Always Applicable": sum(c["applicability"] == "Always applicable" for c in controls),
           "Risk Based": sum(c["applicability"] == "Based on risk assessment" for c in controls),
           **Counter(c["priority"] for c in controls)}
    for label, want in EXPECT.items():
        if got.get(label) != want or totals.get(label) != want:
            fail(f"{label}: parsed {got.get(label)}, Annex says {totals.get(label)}, expected {want}")
    ids = [c["id"] for c in controls]
    if len(set(ids)) != len(ids) or sorted(ids) != sorted(set(d) & set(g) & set(h)):
        fail("control ids are not unique, or Annex D/G/H do not list exactly the same controls")
    if sorted(always_b) != sorted(c["id"] for c in controls if c["applicability"] == "Always applicable"):
        fail("Annex B does not match the Applicability rows")
    for lvl in ("P1", "P2", "P3", "P4"):
        if sorted(by_prio[lvl]) != sorted(c["id"] for c in controls if c["priority"] == lvl):
            fail(f"Annex C {lvl} list does not match the highlighted priorities")
    label_words = re.compile(r"Implementation Guidance|Sub-Control\b|Relevant Threats|Automation Guidance|Performance Indicator")
    for c in controls:
        if label_words.search(full_text(c)):
            fail(f"{c['id']}: a label of another cell leaked into the requirement text")
        nums = [e["n"] for e in numbered(c)]
        if nums != list(range(1, len(nums) + 1)) or not nums or not c["statement"] or not c["name"] or not c["applicability"] or not h[c["id"]][0].strip():
            fail(f"{c['id']}: incomplete (sub-control numbers {nums}, applicability {c['applicability']!r})")
    check_evidence_layer(layer, controls)

    out = []
    for c in controls:
        ref = annex_d_mapping(d[c["id"]])
        types = [t.strip() for t in h[c["id"]][0].split(",") if t.strip()]
        v1 = re.findall(r"[MT]\d+\.\d+\.\d+", g[c["id"]][0])
        crit = criteria(c)
        out.append({
            "control_id": c["id"], "original_reference": c["id"], "title": c["name"],
            "description": c["statement"], "full_text": full_text(c),
            "domain": f"{c['family']['id']} {c['family']['name']}",
            "category": f"{c['sub_family']['id']} {c['sub_family']['name']}",
            "section_number": c["id"], "parent_section": c["sub_family"]["id"],
            "is_mandatory": c["applicability"] == "Always applicable", "priority": SEVERITY[c["priority"]],
            "assessment_criteria": crit, "ai_notes": notes(c, ref, types, v1), "evidence_requirements": evidence_items(layer, c),
            # not read by the seeder; kept so the crosswalk tools and reviewers need not re-read the PDF
            "priority_tier": c["priority"], "applicability": c["applicability"], "control_type": types,
            "mappings": ref, "uae_ia_v1_1": v1, "sub_control_count": len(crit), "pdf_page": c["page"]})
    return {"metadata": metadata(families, controls, hashlib.sha256(pdf.read_bytes()).hexdigest()), "controls": out}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="the standard's PDF")
    ap.add_argument("out", type=Path, help="the catalog to write")
    ap.add_argument("--evidence", type=Path, default=EVIDENCE_LAYER, help="authored evidence layer (default: %(default)s)")
    args = ap.parse_args()
    payload = build(args.pdf, json.loads(args.evidence.read_text(encoding="utf-8")))
    out = args.out
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    c = payload["controls"]
    print(f"wrote {out} ({out.stat().st_size:,} bytes): {len(c)} controls, "
          f"{sum(x['sub_control_count'] for x in c)} sub-controls, {sum(len(x['evidence_requirements']) for x in c)} evidence items, "
          f"{sum(x['is_mandatory'] for x in c)} always applicable, {Counter(x['priority_tier'] for x in c)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
