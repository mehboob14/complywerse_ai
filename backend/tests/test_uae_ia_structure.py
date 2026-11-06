"""UAE Information Assurance Standard v2.1: the standard's own hierarchy in the library, for the Requirements view.

Above the controls the standard has families and sub-families; under a control it has numbered sub-controls, a few with lettered
points and bullets under them. The catalog (seed_data/frameworks/uae_ia.json, built by grc/tools/build_uae_ia_catalog.py) carries both:
metadata.document_structure.control_structure, and on every control a `native_attributes` with the priority tier, applicability, control
types, implementation guidance, the evidence items that evidence the control as a whole, and its sub-controls as a tree, each with the
evidence items whose `covers` (in the evidence layers) name it. The artifact catalogue lists, per artifact, the sub-controls its evidence
covers. These tests hold all of it to the standard's own numbers, to the text the rows already carry (`full_text`, `assessment_criteria`,
`obligations`) and to the evidence layers, and recount the derived lists independently of the builder. No PDF, no database.
"""
import copy
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import pytest

SEED = Path(__file__).resolve().parents[1] / "grc" / "seed_data"
CATALOG = SEED / "frameworks" / "uae_ia.json"
ARTIFACTS = SEED / "artifact_catalog.json"
FAMILIES = [f"M{i}" for i in range(1, 7)] + [f"T{i}" for i in range(1, 10)]
ANNEXES = ["E1", "E2", "E3", "F1", "F2", "F3", "F4"]
SUBS_PER_FAMILY = [3, 4, 4, 3, 3, 3, 5, 3, 4, 1, 4, 2, 4, 2, 2]       # Annex A: 47 sub-families in 15 families
ANNEX_PARTS = [9, 1, 8, 5, 4, 7, 6]                                    # the parts of the seven annex policies
NATIVE_KEYS = ["priority_tier", "applicability", "control_types", "implementation_guidance", "control_evidence", "sub_controls"]
NODE_KEYS = ["code", "number", "text", "lead_in", "criterion_index", "consideration", "points", "evidence"]
GUIDANCE_HEAD = "Implementation Guidance (for information purposes only; not a requirement of the standard):\n"
# the keys the 134 controls had before `native_attributes`, and a digest of their values (the standard's text, verbatim): a change to any
# of them is deliberate, so it should show up here. Recompute: sha256 of json.dumps([{k: r[k] for k in OLD_KEYS} for r in core],
# ensure_ascii=False, separators=(",", ":")) encoded as UTF-8
OLD_KEYS = ["control_id", "original_reference", "title", "description", "full_text", "domain", "category", "section_number", "parent_section",
            "is_mandatory", "priority", "assessment_criteria", "ai_notes", "evidence_requirements", "priority_tier", "applicability",
            "control_type", "mappings", "uae_ia_v1_1", "sub_control_count", "pdf_page"]
OLD_DIGEST = "cc196abe797d8d861ff36c2aa69e763e77daf0aea5c26c13d67dfaa64ddf990d"
# printed points under a numbered item: control -> (lines lettered "a.", lines lettered "a)", bullet lines, lines one level deeper
# than the item's first level). 29 + 11 + 20 = 60 lines in 11 controls; M1.3.2 and M6.2.1 print "a)" and the others "a."
POINTS = {"M1.3.1": (4, 0, 0, 0), "M1.3.2": (0, 5, 0, 0), "M2.3.1": (0, 0, 7, 0), "M2.3.3": (4, 0, 0, 0), "M6.2.1": (0, 6, 0, 0),
          "M6.2.2": (3, 0, 0, 0), "M6.2.3": (7, 0, 4, 4), "M6.3.1": (3, 0, 0, 0), "T1.3.5": (0, 0, 3, 0), "T5.1.1": (0, 0, 6, 0),
          "T8.2.7": (8, 0, 0, 0)}
# evidence items of the standard's controls that cover no sub-control: they evidence the control statement itself (an approval, an inspection)
CONTROL_LEVEL = [
    ("M1.2.1", "Top management approval of the policy"), ("M2.1.1", "Risk management policy approval and version history"),
    ("M3.1.1", "Awareness and training policy approval and review history"), ("T1.1.1", "Asset management policy approval and version record"),
    ("T2.1.1", "Physical and environmental security procedures"), ("T2.1.1", "Physical and environmental security policy approval and review history"),
    ("T2.3.7", "Screen lock configuration"), ("T2.3.7", "Clear desk inspection results"), ("T3.2.1", "Monitoring policy approval and review record"),
    ("T3.4.4", "Post-quantum transition plan"), ("T7.1.1", "Policy communication to internal and external parties"),
    ("T7.3.2", "Outsourced development review records"), ("T7.4.2", "Test environment access settings"),
    ("T8.1.1", "Incident management policy approval record")]


def _layer(name):
    return json.loads((SEED / name).read_text(encoding="utf-8"))["controls"]


# control id -> the evidence items (name, covers ...) of the three authored layers; the Annex F layer has no `covers` at all
LAYERS = {**_layer("uae_ia_evidence.json"), **_layer("uae_ia_annex_e_evidence.json"), **_layer("uae_ia_annex_f_evidence.json")}


def _natural(code):
    """M1.2.10 sorts after M1.2.9."""
    return [int(p) if p.isdigit() else p for p in re.findall(r"\d+|\D+", code)]


def _flat(points):
    return [s for p in points for s in (f"{p['label']} {p['text']}", *_flat(p.get("points", [])))]


def _sentence(node):
    """What `assessment_criteria` makes of a sub-control: lead-in, its own words, then every point in print order."""
    return " ".join(s for s in (node["lead_in"], node["text"], *_flat(node["points"])) if s)


def _point_lines(points, depth):
    return [line for p in points for line in ("   " * depth + f"{p['label']} {p['text']}", *_point_lines(p.get("points", []), depth + 1))]


def _full_text(c):
    """The control's `full_text` rebuilt from its sub-control tree: a lead-in is printed once above the items it governs."""
    lines, lead = ["Sub-Controls:"], None
    for n in c["native_attributes"]["sub_controls"]:
        if n["lead_in"] and n["lead_in"] != lead:
            lines.append(n["lead_in"])
        lead = n["lead_in"]
        inline = [p for p in n["points"] if p["label"].endswith(")")]                 # full_text keeps "a) ..." inside the item's own line
        lines.append(" ".join([f"{n['number']}) {n['text']}", *(f"{p['label']} {p['text']}" for p in inline)]))
        lines.extend(_point_lines(n["points"][len(inline):], 1))
    return c["description"] + "\n\n" + "\n".join(lines)


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, list):
        for x in o:
            yield from _strings(x)
    elif isinstance(o, dict):
        for x in o.values():
            yield from _strings(x)


@pytest.fixture(scope="module")
def catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rows(catalog):
    return catalog["controls"]


@pytest.fixture(scope="module")
def core(rows):
    """The standard's own 134 controls: the rows without an `annex` key."""
    return [r for r in rows if "annex" not in r]


@pytest.fixture(scope="module")
def structure(catalog):
    return catalog["metadata"]["document_structure"]["control_structure"]


@pytest.fixture(scope="module")
def artifacts():
    return json.loads(ARTIFACTS.read_text(encoding="utf-8"))["uae_ia"]["artifacts"]


# ── families and sub-families ────────────────────────────────────────────────────────────────────

def test_the_hierarchy_has_the_standards_families_and_sub_families(structure, rows):
    assert list(structure) == ["version", "source", "families", "subfamilies"]
    assert structure["version"] == 1 and structure["source"] == "UAE Information Assurance Standard v2.1, chapter 2"
    fams, subs = structure["families"], structure["subfamilies"]
    assert [f["id"] for f in fams] == FAMILIES + ANNEXES
    assert [f["kind"] for f in fams] == ["Management"] * 6 + ["Technical"] * 9 + ["Annex E"] * 3 + ["Annex F"] * 4
    core_s = [s for s in subs if "objective" in s]
    assert len(core_s) == 47 and subs[:47] == core_s and len(subs) == 47 + sum(ANNEX_PARTS)
    assert [sum(s["family"] == f["id"] for s in core_s) for f in fams[:15]] == SUBS_PER_FAMILY                 # Annex A's 15 and 47
    assert [sum(s["family"] == a for s in subs[47:]) for a in ANNEXES] == ANNEX_PARTS
    # every control's parent_section is a sub-family, none is left without a control, in the order the controls meet them
    assert [s["id"] for s in subs] == list(dict.fromkeys(r["parent_section"] for r in rows))
    assert len({x["id"] for x in fams + subs}) == len(fams) + len(subs)
    # what the standard prints for a family / sub-family; the annexes print nothing of it
    for f in fams[:15]:
        assert list(f) == ["id", "name", "kind", "objective", "performance_indicators"] and f["objective"] and all(f["performance_indicators"])
    for s in core_s:
        assert list(s) == ["id", "family", "name", "objective", "performance_indicators", "automation_guidance", "threats"], s["id"]
        assert s["objective"] and s["performance_indicators"] and s["automation_guidance"] and s["threats"], s["id"]
        assert all(s["performance_indicators"]) and all(s["threats"]) and len(set(s["threats"])) == len(s["threats"]), s["id"]
        assert s["id"].startswith(s["family"] + ".")
    assert all(list(f) == ["id", "name", "kind"] for f in fams[15:]) and all(list(s) == ["id", "family", "name"] for s in subs[47:])
    # the names are the ones the controls carry in `domain` and `category`
    fam, sub = {f["id"]: f for f in fams}, {s["id"]: s for s in subs}
    for r in rows:
        s = sub[r["parent_section"]]
        f = fam[s["family"]]
        if "annex" in r:
            assert r["annex"] == f["id"] and r["domain"] == f"{f['id']} {f['name']} ({f['kind']})" and r["category"].split(" ", 1)[1] == s["name"]
        else:
            assert r["domain"] == f"{f['id']} {f['name']}" and r["category"] == f"{s['id']} {s['name']}"
    # verbatim text: single spaces, no replacement characters, no page furniture (automation guidance keeps its paragraph breaks)
    for text in _strings(structure):
        assert "\ufffd" not in text and "Document Classification" not in text
        assert all(p and p == " ".join(p.split()) for p in text.split("\n")), text[:60]
    # the shape of the standard's tables, as counted in the PDF independently of the builder
    assert Counter(len(s["performance_indicators"]) for s in core_s) == {1: 38, 2: 7, 3: 1, 5: 1}
    assert Counter(len(s["threats"]) for s in core_s) == {2: 11, 3: 18, 4: 12, 5: 2, 6: 3, 7: 1}
    assert [f["id"] for f in fams[:15] if len(f["performance_indicators"]) > 1] == ["M2"]


def test_the_annex_policies_are_families_with_their_parts_and_no_text(structure):
    fams = {f["id"]: f for f in structure["families"]}
    assert fams["E1"] == {"id": "E1", "name": "National Cloud Security Policy", "kind": "Annex E"}
    assert fams["E2"]["name"] == "National Cyber Security Policy for Artificial Intelligence"
    assert fams["F1"] == {"id": "F1", "name": "National Encryption Policy mapping", "kind": "Annex F"}
    subs = [s for s in structure["subfamilies"] if s["family"] in ANNEXES]
    assert subs[0] == {"id": "E1-2.1", "family": "E1", "name": "Cloud Governance"}
    assert [s["name"] for s in subs if s["family"] == "F1"] == ["Governance", "Data at Rest", "Data in Motion", "Key Management",
                                                                  "Post Quantum Cryptography"]
    assert [s for s in subs if s["family"] == "E2"] == [{"id": "E2-2", "family": "E2", "name": "Cyber Security Policy for Artificial Intelligence"}]


def test_the_user_reference_sub_family_and_the_others_are_verbatim(structure):
    sub = {s["id"]: s for s in structure["subfamilies"]}
    assert sub["M1.3"] == {
        "id": "M1.3", "family": "M1", "name": "Support",
        "objective": "To provide sufficient resources, appropriate communication, and documentation for the entity’s Information Security Program.",
        "performance_indicators": ["Percentage of incidents that are caused by a lack of qualified resources for information security.",
                                   "Percentage of projects with completed information security risk assessments."],
        "automation_guidance": "Not applicable",
        "threats": ["Breaches of information security", "Lack of information security in project management", "Insufficient resources",
                    "Non-compliance with information security controls", "Non-compliance with national regulatory mandates",
                    "Lack of skilled information security personnel", "Incomplete or not up-to-date documentation"]}
    assert sub["M1.1"] == {
        "id": "M1.1", "family": "M1", "name": "Entity Context and Leadership",
        "objective": "To establish leadership and a management framework to initiate and control the implementation of information security "
                     "within the entity.",
        "performance_indicators": ["Percentage of tasks or milestones from the information security implementation plan that have been completed."],
        "automation_guidance": "Not applicable",
        "threats": ["Insufficient resources", "Non-compliance with information security controls", "Lack of skilled information security personnel",
                    "Incomplete or not up-to-date documentation"]}
    assert structure["families"][0] == {
        "id": "M1", "name": "Strategy and Planning", "kind": "Management",
        "objective": "To provide suitable organizational environment, leadership, and support for information security.",
        "performance_indicators": ["Percentage of security initiatives approved by leadership that have been successfully executed."]}
    # the longest table of the standard: five performance indicators, the first beside the label and four in further paragraphs
    assert sub["T5.2"]["performance_indicators"] == [
        "Percentage of identities that are managed by centralized identity management system.",
        "The total number of access requests processed within a specified timeframe.",
        "The number of unauthorized access attempts detected and prevented.",
        "Percentage of accuracy in access provisioning and deprovisioning.",
        "Number of delayed access change requests and the average time taken to action them."]
    assert sub["T5.2"]["threats"][0] == "Use of stolen login credentials" and len(sub["T5.2"]["threats"]) == 4
    # straight apostrophes stay where the standard prints them, curly ones elsewhere
    assert "entity's security requirements" in next(f for f in structure["families"] if f["id"] == "T6")["objective"]


def test_the_hierarchy_says_what_document_structure_sections_already_said(catalog, structure):
    sections = catalog["metadata"]["document_structure"]["sections"]
    fam, sub = {f["id"]: f for f in structure["families"]}, {s["id"]: s for s in structure["subfamilies"]}
    assert [s["number"] for s in sections] == [f["id"] for f in structure["families"]]
    for sec in sections[:15]:
        f = fam[sec["number"]]
        assert (sec["name"], sec["description"]) == (f"{f['id']} {f['name']}", f["objective"])
        assert sec["performance_indicator"].split("\n") == f["performance_indicators"]
        assert [x["id"] for x in sec["sub_families"]] == [s["id"] for s in structure["subfamilies"] if s["family"] == f["id"]]
        for x in sec["sub_families"]:
            s = sub[x["id"]]
            assert (x["name"], x["objective"], x["automation_guidance"], x["relevant_threats_and_vulnerabilities"]) == (
                s["name"], s["objective"], s["automation_guidance"], s["threats"])
            assert x["performance_indicator"].split("\n") == s["performance_indicators"]
    for sec in sections[15:]:
        assert sec["name"] == f"{sec['number']} {fam[sec['number']]['name']} ({fam[sec['number']]['kind']})"
        assert [(x["id"], x["name"]) for x in sec["sub_families"]] == [(s["id"], s["name"]) for s in structure["subfamilies"] if s["family"] == sec["number"]]


# ── native attributes ────────────────────────────────────────────────────────────────────────────

def test_every_control_carries_its_native_attributes(rows, core):
    assert len(rows) == 262 and all(list(r)[-1] == "native_attributes" for r in rows)
    for r in rows:
        na = r["native_attributes"]
        assert list(na) == NATIVE_KEYS and json.loads(json.dumps(na)) == na
        assert na["priority_tier"] == r["priority_tier"] and na["applicability"] == r["applicability"], r["control_id"]
        if "annex" in r:
            assert na["priority_tier"] is None and na["control_types"] == [] and na["implementation_guidance"] is None
        else:
            assert na["control_types"] == r["control_type"] and na["control_types"] and na["priority_tier"] in ("P1", "P2", "P3", "P4")
            # the control page's guidance, verbatim and informational: exactly what ai_notes ends with
            assert r["ai_notes"].endswith(GUIDANCE_HEAD + na["implementation_guidance"]), r["control_id"]
            assert "Document Classification" not in na["implementation_guidance"] and "\ufffd" not in na["implementation_guidance"]
    assert Counter(r["native_attributes"]["priority_tier"] for r in core) == {"P1": 39, "P2": 60, "P3": 24, "P4": 11}
    assert Counter(r["native_attributes"]["applicability"] for r in core) == {"Always applicable": 70, "Based on risk assessment": 64}
    guidance = next(r for r in core if r["control_id"] == "M1.3.1")["native_attributes"]["implementation_guidance"].split("\n")
    assert guidance[0].startswith("The entity should allocate appropriate resources for information security") and guidance[1].startswith("a. resources needed")
    assert len(guidance) == 7 and guidance[5].startswith("e. training programs")                 # paragraph breaks and the a./b. lists are kept


def test_the_standards_controls_keep_every_key_they_had(core, rows):
    assert rows[:134] == core and all(list(r)[:len(OLD_KEYS)] == OLD_KEYS for r in core)
    digest = hashlib.sha256(json.dumps([{k: r[k] for k in OLD_KEYS} for r in core], ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    assert digest.hexdigest() == OLD_DIGEST


# ── sub-controls of the standard's controls ──────────────────────────────────────────────────────

def test_a_core_control_has_its_numbered_items_as_sub_controls(core):
    codes = [n["code"] for c in core for n in c["native_attributes"]["sub_controls"]]
    assert len(codes) == len(set(codes)) == 449
    for c in core:
        nodes = c["native_attributes"]["sub_controls"]
        assert len(nodes) == c["sub_control_count"] == len(c["assessment_criteria"]), c["control_id"]
        assert [n["number"] for n in nodes] == list(range(1, len(nodes) + 1))
        for n in nodes:
            assert list(n) == NODE_KEYS and n["code"] == f"{c['control_id']}.{n['number']}"
            assert n["text"] and n["text"] == n["text"].strip() and n["consideration"] is False
            assert n["criterion_index"] == n["number"] - 1 and _sentence(n) == c["assessment_criteria"][n["criterion_index"]], n["code"]
        assert _full_text(c) == c["full_text"], c["control_id"]            # the tree loses nothing of the printed list
    by_id = {c["control_id"]: c["native_attributes"]["sub_controls"] for c in core}
    first = by_id["M1.1.1"][0]
    assert (first["code"], first["lead_in"], first["text"]) == ("M1.1.1.1", "The entity shall determine:",
                                                                "interested parties that are relevant to its information security.")
    assert [n["lead_in"] for n in by_id["M3.2.1"][:2]] == [None, "The entity shall:"]            # a lead-in printed mid-list governs the items after it
    assert by_id["M3.2.1"][1]["text"].startswith("provide training")


def test_printed_points_are_kept_as_deep_as_they_are_printed(core):
    found = {}
    for c in core:
        for n in c["native_attributes"]["sub_controls"]:
            seen = [0, 0, 0, 0]

            def walk(points, depth):
                for p in points:
                    assert list(p) in (["label", "text"], ["label", "text", "points"]) and p["text"] and p.get("points", [None])
                    assert re.fullmatch(r"[a-z]{1,2}[.)]|•", p["label"]), p
                    seen[2 if p["label"] == "•" else 1 if p["label"].endswith(")") else 0] += 1
                    seen[3] += depth > 0
                    walk(p.get("points", []), depth + 1)

            walk(n["points"], 0)
            if any(seen[:3]):
                found[c["control_id"]] = tuple(a + b for a, b in zip(found.get(c["control_id"], (0, 0, 0, 0)), seen))
    assert found == POINTS
    assert [sum(v[i] for v in found.values()) for i in range(4)] == [29, 11, 20, 4]
    nodes = {c["control_id"]: c["native_attributes"]["sub_controls"] for c in core}
    m623 = nodes["M6.2.3"][0]["points"]
    assert [p["label"] for p in m623] == [f"{ch}." for ch in "abcdefg"] and [len(p.get("points", [])) for p in m623] == [0, 0, 0, 4, 0, 0, 0]
    assert [p["text"] for p in m623[3]["points"]] == ["nonconformities and corrective actions.", "monitoring and measurement results",
                                                      "audit results.", "fulfillment of information security objectives."]
    assert nodes["M6.2.3"][1]["points"] == [] and len(nodes["M2.3.1"][0]["points"]) == 4 and len(nodes["M2.3.1"][1]["points"]) == 3
    assert [p["label"] for p in nodes["T1.3.5"][0]["points"]] == ["•"] * 3 and len(nodes["T5.1.1"][0]["points"]) == 6
    assert nodes["M1.3.1"][2]["text"] == "The entity shall:" and len(nodes["M1.3.1"][2]["points"]) == 4          # item 3) holds a. - d.
    # "a) ..." points are on the item too, though full_text and the criteria have always printed them inline in its text
    assert nodes["M1.3.2"][0]["text"] == "The entity shall determine:" and nodes["M1.3.2"][0]["lead_in"] is None
    assert [(p["label"], p["text"]) for p in nodes["M1.3.2"][0]["points"]] == [
        ("a)", "on what to communicate."), ("b)", "when to communicate."), ("c)", "with whom to communicate."),
        ("d)", "who shall communicate."), ("e)", "how to communicate.")]
    assert nodes["M6.2.1"][0]["text"].endswith("effectiveness of the information security, including:")
    assert [p["label"] for p in nodes["M6.2.1"][0]["points"]] == ["a)", "b)", "c)", "d)", "e)", "f)"] and nodes["M6.2.1"][1]["points"] == []


# ── evidence per sub-control ─────────────────────────────────────────────────────────────────────

def test_each_sub_control_lists_the_evidence_items_whose_covers_name_it(core):
    reach, control_level = Counter(), []
    for c in core:
        items = LAYERS[c["control_id"]]
        assert [e["name"] for e in c["evidence_requirements"]] == [i["name"] for i in items]
        for n in c["native_attributes"]["sub_controls"]:
            want = [i["name"] for i in items if n["number"] in i["covers"]]           # in the layer's order, nothing else
            assert n["evidence"] == want and want, n["code"]
            reach[len(want)] += 1
        # the items that cover nothing evidence the control as a whole, and appear under no sub-control
        names = [i["name"] for i in items if not i["covers"]]
        assert c["native_attributes"]["control_evidence"] == names
        control_level += [(c["control_id"], name) for name in names]
        assert not set(names) & {e for n in c["native_attributes"]["sub_controls"] for e in n["evidence"]}
    assert reach == {1: 309, 2: 120, 3: 20}                                            # every one of the 449 is covered by 1-3 items
    assert control_level == CONTROL_LEVEL


# ── Annex E and F ────────────────────────────────────────────────────────────────────────────────

def test_annex_e_obligations_are_sub_controls_and_considerations_tick_nothing(rows):
    e_rows = [r for r in rows if r.get("annex", "")[:1] == "E"]
    assert len(e_rows) == 50 and sum(len(r["obligations"]) for r in e_rows) == 172
    consideration = ticking = shall_without_criterion = 0
    reach = Counter()
    for r in e_rows:
        nodes, crit, items = r["native_attributes"]["sub_controls"], r["assessment_criteria"], LAYERS[r["control_id"]]
        assert [n["number"] for n in nodes] == list(range(1, len(r["obligations"]) + 1))        # the numbers `covers` uses
        place = 0
        for n, ob in zip(nodes, r["obligations"]):
            assert list(n) == NODE_KEYS and n["code"] == f"{r['control_id']}.{n['number']}", n["code"]
            assert _sentence(n) == ob                                                    # lead-in + bullet + sub-items = the obligation
            assert n["lead_in"] is None or n["lead_in"].endswith(":")
            assert n["consideration"] is bool(re.search(r"take the following into account", ob, re.I))
            assert n["evidence"] == [i["name"] for i in items if n["number"] in i["covers"]] and n["evidence"], n["code"]
            reach[len(n["evidence"])] += 1
            if crit and not n["consideration"]:                  # the criterion at its place among the obligations that are not considerations
                assert n["criterion_index"] == place and crit[place] == ob, n["code"]
                place += 1
            else:                                                # a consideration, or a row that has no criteria (fewer than two things to do)
                assert n["criterion_index"] is None
            consideration += n["consideration"]
            ticking += n["criterion_index"] is not None
            shall_without_criterion += not n["consideration"] and n["criterion_index"] is None
        assert place == len(crit) and r["native_attributes"]["control_evidence"] == []
    assert (consideration, ticking, shall_without_criterion) == (9, 142, 21)
    assert sum(1 for r in e_rows if r["assessment_criteria"]) == 29
    assert reach == {1: 94, 2: 43, 3: 31, 4: 4}
    by_id = {r["control_id"]: r["native_attributes"]["sub_controls"] for r in e_rows}
    first = by_id["E1-2.1.1"]                                    # one shall, then six bullets to take into account
    assert [n["consideration"] for n in first] == [False] + [True] * 6 and [n["criterion_index"] for n in first] == [None] * 7
    assert first[0]["lead_in"] is None and first[1]["lead_in"].endswith("shall take the following into account:")
    portability = by_id["E1-2.5.2"][1]                           # a bullet with three dashed sub-items
    assert portability["text"] == "Demonstrated commitment to data portability, covering:" and portability["criterion_index"] == 1
    assert portability["points"] == [{"label": "-", "text": t} for t in ("Duration of data storage", "Data protection controls", "Data deletion processes")]
    assert by_id["E1-2.1.3"][0]["code"] == "E1-2.1.3.1" and by_id["E1-2.1.3"][0]["criterion_index"] == 0


def test_annex_f_rows_state_an_objective_and_have_no_sub_controls(rows):
    f_rows = [r for r in rows if r.get("annex", "")[:1] == "F"]
    assert len(f_rows) == 78 and all("covers" not in i for r in f_rows for i in LAYERS[r["control_id"]])
    for r in f_rows:
        na = r["native_attributes"]
        assert na["sub_controls"] == [] and r["assessment_criteria"] == []
        assert na["control_evidence"] == [e["name"] for e in r["evidence_requirements"]]        # all of its items evidence the row as a whole
    assert sum(len(r["native_attributes"]["control_evidence"]) for r in f_rows) == 129


def test_codes_criteria_and_evidence_names_hold_together_in_all_262_controls(rows):
    codes = [n["code"] for r in rows for n in r["native_attributes"]["sub_controls"]]
    assert len(codes) == len(set(codes)) == 449 + 172
    for r in rows:
        nodes = r["native_attributes"]["sub_controls"]
        ticks = [n["criterion_index"] for n in nodes if n["criterion_index"] is not None]
        assert ticks == list(range(len(r["assessment_criteria"]))), r["control_id"]            # one node per criterion, in order
        names = {e["name"] for e in r["evidence_requirements"]}
        assert all(n["evidence"] and set(n["evidence"]) <= names for n in nodes) and set(r["native_attributes"]["control_evidence"]) <= names
        assert len(set(n["evidence"][i] for n in nodes for i in range(len(n["evidence"])))) + len(r["native_attributes"]["control_evidence"]) == len(names)


# ── artifacts ────────────────────────────────────────────────────────────────────────────────────

def test_an_artifact_lists_the_sub_controls_its_evidence_items_cover(artifacts, rows):
    owner = {i["name"]: (cid, i.get("covers", [])) for cid, items in LAYERS.items() for i in items}      # names are unique over the library
    assert len(owner) == 860
    library = {n["code"] for r in rows for n in r["native_attributes"]["sub_controls"]}
    assert len(artifacts) == 462                          # 256 documents, the 152 templates of records (round 5), then the 54 for Annex E (round 5b)
    for a in artifacts:
        keys = list(a)
        assert keys.index("sub_controls") == keys.index("evidence") + 1 and keys[-1] == "sub_controls", a["artifact_id"]
        want = sorted({f"{owner[name][0]}.{k}" for name in a["evidence"] for k in owner[name][1]}, key=_natural)
        assert a["sub_controls"] == want and set(want) <= library, a["artifact_id"]
    assert sum(bool(a["sub_controls"]) for a in artifacts) == 412                        # 206 documents and all 206 templates
    # the 50 without any: the 49 Annex F artifacts (objectives only) and the post-quantum transition plan (a control-level item)
    assert sorted(a["artifact_id"] for a in artifacts if not a["sub_controls"] and not a["control_ref"].startswith("F")) == ["UAEIA-100"]
    assert sum(not a["sub_controls"] and a["control_ref"].startswith("F") for a in artifacts) == 49
    core_codes = {n["code"] for r in rows[:134] for n in r["native_attributes"]["sub_controls"]}
    e_codes = {n["code"] for r in rows[134:] for n in r["native_attributes"]["sub_controls"]}
    served = {c for a in artifacts for c in a["sub_controls"]}
    assert (len(core_codes & served), len(core_codes)) == (449, 449)        # 292 by the documents, the other 157 (records and outputs) by the templates
    assert len(core_codes & {c for a in artifacts[:256] for c in a["sub_controls"]}) == 292
    assert (len(e_codes & served), len(e_codes)) == (172, 172)              # 80 by the documents, the other 92 (records and outputs) by round 5b
    assert len(e_codes & {c for a in artifacts[:256] for c in a["sub_controls"]}) == 80
    assert next(a for a in artifacts if a["artifact_id"] == "UAEIA-001")["sub_controls"] == [f"M1.2.1.{k}" for k in range(1, 6)]


def test_the_builder_rewrites_only_that_entry_and_keeps_the_line_ends(catalog, tmp_path):
    from grc.tools import build_uae_ia_catalog as b

    committed = ARTIFACTS.read_bytes()
    # the file as it was before the lists: no sub_controls (they hold strings only, so the first closing bracket ends one)
    old = re.sub(rb',\r?\n\s+"sub_controls": \[[^\]]*\]', b"", committed)
    assert b'"sub_controls"' not in old and len(old) < len(committed)
    for name, text in (("as_committed.json", old), ("lf_only.json", old.replace(b"\r\n", b"\n"))):
        path = tmp_path / name
        path.write_bytes(text)
        assert b.sync_artifacts(path, catalog["controls"]) == 462
        want = committed if name == "as_committed.json" else committed.replace(b"\r\n", b"\n")
        assert path.read_bytes() == want                                             # same bytes, whichever line ends the file has
        assert b.sync_artifacts(path, catalog["controls"]) == 462 and path.read_bytes() == want        # a second run changes nothing
    # it stops on a file it cannot rewrite safely, and on evidence the library does not have
    path = tmp_path / "bad.json"
    path.write_bytes(old.replace(b'"name": "UAE Information Assurance Standard",\r\n    "artifacts"', b'"name": "UAE",\r\n    "artifacts"'))
    path.write_bytes(path.read_bytes().replace(b"\r\n    ", b"\r\n   "))
    with pytest.raises(SystemExit, match="laid out"):
        b.sync_artifacts(path, catalog["controls"])
    path.write_bytes(old.replace(b"Approved information security policy", b"A policy nobody asked for", 1))
    with pytest.raises(SystemExit, match="not an item of the library"):
        b.sync_artifacts(path, catalog["controls"])
    path.write_bytes(b'{"x": 1}')
    with pytest.raises(SystemExit, match="exactly one entry"):
        b.sync_artifacts(path, catalog["controls"])


# ── the builder's own steps ──────────────────────────────────────────────────────────────────────

def test_the_builder_reads_depth_from_the_printed_indent_and_places_points_by_it():
    from grc.tools import build_uae_ia_catalog as b

    def line(raw, x, y):
        return b.Line(1, x, x + 100, y, y + 11, 10.0, False, raw)

    entries = b.parse_subcontrols([line("1) The entity shall:", 174.6, 0), line("a. first", 192.6, 13), line("wrapped", 210.6, 26),
                                   line("• deeper", 210.6, 39), line("• deeper still", 210.6, 52), line("b. second", 192.6, 65),
                                   line("2) next", 174.6, 78)])
    assert entries[0]["nested"] == ["a. first wrapped", "   • deeper", "   • deeper still", "b. second"] and entries[0]["depths"] == [0, 1, 1, 0]
    assert b.points_of(entries[0]) == [{"label": "a.", "text": "first wrapped", "points": [{"label": "•", "text": "deeper"},
                                                                                         {"label": "•", "text": "deeper still"}]},
                                       {"label": "b.", "text": "second"}]
    assert entries[1]["nested"] == [] and b.points_of(entries[1]) == [] and entries[1]["parts"] == ["next"]
    # "a) ..." lines stay in the item's text (that is how full_text and the criteria read them) and `parts` splits them off for the tree
    entries = b.parse_subcontrols([line("1) The entity shall determine:", 174.6, 0), line("a) on what", 192.6, 13), line("to talk.", 210.6, 26),
                                   line("b) when.", 192.6, 39), line("2) next", 174.6, 52)])
    assert entries[0]["text"] == "The entity shall determine: a) on what to talk. b) when." and entries[0]["nested"] == []
    assert entries[0]["parts"] == ["The entity shall determine:", "a) on what to talk.", "b) when."]
    assert b.points_of(entries[0]) == [{"label": "a)", "text": "on what to talk."}, {"label": "b)", "text": "when."}]
    for bad in ({"n": 1, "nested": ["   • deep"], "depths": [1], "parts": ["x"]}, ):                        # no point above it to hold it
        with pytest.raises(SystemExit, match="cannot place"):
            b.points_of(bad)
    with pytest.raises(SystemExit, match="no words"):
        b.points_of({"n": 1, "nested": ["a."], "depths": [0], "parts": ["x"]})
    with pytest.raises(SystemExit, match="the a\\) points are"):                                              # b) with no a) before it
        b.points_of({"n": 1, "nested": [], "depths": [], "parts": ["x", "b) second"]})


def test_the_builder_builds_sub_controls_and_derives_the_criterion_from_them():
    from grc.tools import build_uae_ia_catalog as b

    control = {"id": "M9.9.9", "sub_controls": [{"n": 1, "text": "first.", "nested": [], "depths": [], "parts": ["first."]},
                                                {"lead": "The entity shall:"},
                                                {"n": 2, "text": "second:", "nested": ["a. x", "   • y"], "depths": [0, 1], "parts": ["second:"]}]}
    items = [{"name": "Register", "covers": [1, 2]}, {"name": "Log", "covers": [2]}, {"name": "Approval", "covers": []}]
    nodes = b.core_nodes(control, items)
    assert [(n["code"], n["lead_in"], n["criterion_index"], n["evidence"]) for n in nodes] == [
        ("M9.9.9.1", None, 0, ["Register"]), ("M9.9.9.2", "The entity shall:", 1, ["Register", "Log"])]
    assert [b.sentence(n) for n in nodes] == b.criteria(control) == ["first.", "The entity shall: second: a. x • y"]
    assert b.native_attributes("P1", "Always applicable", ["Preventive"], "text", items, nodes)["control_evidence"] == ["Approval"]
    # an Annex E row: whole sentences, then a lead-in with its bullets (one with sub-items); the row has criteria
    full = ("The entity shall keep a policy. The entity shall ensure that contracts include:\n• Alpha.\n• Beta, covering:\n   - one\n   - two\n"
            "When choosing, the entity shall take the following into account:\n• size")
    obligations = ["The entity shall keep a policy.", "The entity shall ensure that contracts include: Alpha.",
                   "The entity shall ensure that contracts include: Beta, covering: - one - two",
                   "When choosing, the entity shall take the following into account: size"]
    row = {"control_id": "E9-9.9", "full_text": full, "obligations": obligations, "assessment_criteria": obligations[:3]}
    nodes = b.annex_nodes("E", row, [{"name": "Policy", "covers": [1, 4]}, {"name": "Contract clauses", "covers": [2, 3]}])
    assert [(n["lead_in"] is None, n["consideration"], n["criterion_index"], n["evidence"]) for n in nodes] == [
        (True, False, 0, ["Policy"]), (False, False, 1, ["Contract clauses"]), (False, False, 2, ["Contract clauses"]),
        (False, True, None, ["Policy"])]
    assert nodes[2]["points"] == [{"label": "-", "text": "one"}, {"label": "-", "text": "two"}] and nodes[2]["text"] == "Beta, covering:"
    assert [b.sentence(n) for n in nodes] == obligations and b.annex_nodes("F", row, []) == []
    with pytest.raises(SystemExit, match="match no obligation"):
        b.annex_nodes("E", {**row, "full_text": full + "\n• stray"}, [])


def test_the_builder_stops_on_a_hierarchy_that_does_not_fit_the_standard(catalog, rows):
    from grc.tools import build_uae_ia_catalog as b

    structure = catalog["metadata"]["document_structure"]["control_structure"]
    b.check_structure(structure, rows)
    b.check_sub_controls(rows)

    def stops(match, change, check=b.check_structure, arg=None):
        broken = copy.deepcopy(structure if arg is None else arg)
        change(broken)
        with pytest.raises(SystemExit, match=match):
            check(broken, copy.deepcopy(rows))

    sub = lambda s, i: next(x for x in s["subfamilies"] if x["id"] == i)                         # noqa: E731
    stops("46 sub-families", lambda s: s["subfamilies"].remove(sub(s, "T4.1")))
    stops("M1.3: no automation guidance or no threat", lambda s: sub(s, "M1.3").update(threats=[]))
    stops("no objective", lambda s: sub(s, "T9.2").update(performance_indicators=[]))
    stops("no sub-family 'M1.3'", lambda s: s["subfamilies"].remove(sub(s, "M1.3")) or s["subfamilies"].append({**sub(s, "M2.1"), "id": "M9.9"}))
    stops("that fits", lambda s: sub(s, "M1.3").update(name="Support and resources"))

    def broken_rows(change):
        mutated = copy.deepcopy(rows)
        change(mutated)
        with pytest.raises(SystemExit):
            b.check_sub_controls(mutated)

    broken_rows(lambda r: r[0]["native_attributes"]["sub_controls"][0].update(text="another sentence"))           # not the criterion's words
    broken_rows(lambda r: r[0]["native_attributes"]["sub_controls"][1].update(code="M1.1.1.1"))                   # a code twice
    broken_rows(lambda r: r[0]["native_attributes"]["sub_controls"][0].update(evidence=[]))                       # nothing evidences it
    broken_rows(lambda r: r[0]["native_attributes"]["sub_controls"][0].update(evidence=["Not an item of this control"]))
    broken_rows(lambda r: r[0]["native_attributes"]["sub_controls"].pop())                                        # fewer than the control counts
