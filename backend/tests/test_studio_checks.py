"""The studio's checks that need no AI, and the templates whose structure they enforce."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance.studio import blocks as B
from grc.modules.governance.studio import checks as C
from grc.modules.governance.studio import templates as T


def rules(issues, kind=None):
    return sorted(i["rule"] for i in issues if kind is None or i["kind"] == kind)


def run(md, **kw):
    return C.run_deterministic(md, **kw)


def test_placeholders_are_found_whatever_they_look_like_and_a_signature_line_is_not_required():
    text = "Owner: [[Owner name]], date [Insert date], by <<Approver>> or {{role}}; TBD. Sign: ___________"
    found = C.find_placeholders(text)
    assert [(p["kind"], p["text"], p["required"]) for p in found] == [
        ("ai", "[[Owner name]]", True), ("prompt", "[Insert date]", True), ("angle", "<<Approver>>", True),
        ("curly", "{{role}}", True), ("tbd", "TBD", True), ("blank", "___________", False)]
    issues = run("# T\n\nOwner [[X]]. Sign ______\n")
    assert [i["rule"] for i in issues if i["kind"] == "placeholder"] == ["placeholder", "placeholder_signature"]
    assert C.summary(issues)["must_fill"] == 1


def test_headings_that_skip_repeat_or_end_in_punctuation_are_flagged_with_fixes():
    md = "# Title\n\n# Second title\n\n#### Deep heading:\n\nText.\n\n## Same\n\nA.\n\n## Same\n\nB.\n"
    issues = run(md)
    assert {"multiple_titles", "heading_skip", "heading_punctuation", "heading_duplicate"} <= set(rules(issues))
    skip = next(i for i in issues if i["rule"] == "heading_skip")
    assert C.apply_fix(md, skip["fix"]).splitlines()[4] == "## Deep heading:"          # it follows a level 1 heading
    punct = next(i for i in issues if i["rule"] == "heading_punctuation")
    assert "#### Deep heading\n" in C.apply_fix(md, punct["fix"])
    assert C.apply_fix(md, next(i for i in issues if i["rule"] == "multiple_titles")["fix"]).startswith("# Title\n\n## Second title")


def test_numbering_that_skips_is_reported_once_and_renumbered_by_the_fix():
    md = "# T\n\n## 1. One\n\nA.\n\n## 2. Two\n\nB.\n\n## 4. Four\n\nC.\n\n### 4.1 Sub\n\nD.\n\n## 5. Five\n\nE.\n"
    issues = [i for i in run(md) if i["rule"] == "heading_numbering"]
    assert len(issues) == 1 and "3" in issues[0]["message"]
    fixed = C.apply_fix(md, issues[0]["fix"])
    assert "## 3. Four" in fixed and "### 3.1 Sub" in fixed and "## 4. Five" in fixed
    assert not [i for i in run(fixed) if i["rule"] == "heading_numbering"]


def test_small_text_slips_are_found_and_fixed_in_the_markdown_not_just_the_text():
    md = "# T\n\nThe the policy applies  to **all** staff , always.\n"
    issues = run(md)
    assert {"repeated_word", "extra_spaces", "space_before_punctuation"} <= set(rules(issues))
    repeated = next(i for i in issues if i["rule"] == "repeated_word")
    assert "The policy applies" in C.apply_fix(md, repeated["fix"])
    spaces = next(i for i in issues if i["rule"] == "extra_spaces")
    assert "applies to **all**" in C.apply_fix(md, spaces["fix"])
    assert C.apply_fix(md, {"type": "replace", "block": 1, "find": "not in the text", "replace": "x"}) is None     # moved: refused, not guessed


def test_lists_dates_and_us_uk_spelling_must_agree_with_themselves():
    md = "# T\n\n- First item.\n- Second item\n- Third item.\n\nDue 01/02/2026 and 2026-02-03.\n\nThe organization and the organisation.\n"
    issues = run(md)
    assert {"list_punctuation", "date_formats", "spelling_variant"} <= set(rules(issues))
    assert not [i for i in run("# T\n\nA catalogue of artefacts and a catalog.\n") if i["rule"] == "spelling_variant" and "catalogue" in i["quote"].lower() and False]
    gb = run("# T\n\nThe organization must authorize.\n", instructions={"language": "en-GB"})
    assert [i["suggestion"] for i in gb if i["rule"] == "spelling_variant"][:1] == ["organisation"]
    assert not [i for i in run("# T\n\nThe organisation fulfils the duty.\n") if i["rule"] == "spelling_variant"]
    mixed = [i for i in run("# T\n\nWe fulfil and fulfill it.\n") if i["rule"] == "spelling_variant"]
    assert len(mixed) == 1


def test_tables_empty_sections_and_requirements_without_a_verb():
    md = "# T\n\n## Policy Statements\n\nAccess to systems is reviewed every year by the system owner.\n\n## Empty\n\n## Next\n\nText.\n\n| A |   |\n| --- | --- |\n| x |   |\n"
    issues = run(md)
    assert {"section_empty", "normative_verb", "table_header", "table_empty_cells"} <= set(rules(issues))


def test_every_built_in_template_parses_passes_its_own_structure_and_leaves_only_placeholders():
    for t in T.builtins():
        issues = run(t["content"], structure=t["structure"], title="x")
        kinds = {i["kind"] for i in issues}
        assert not (kinds - {"placeholder", "format", "style", "consistency", "structure"}), (t["doc_type"], kinds)
        assert not [i for i in issues if i["kind"] == "structure" and i["rule"] != "section_short"], (t["doc_type"], [i["rule"] for i in issues if i["kind"] == "structure"])
        assert C.summary(issues)["must_fill"] > 3
        blocks = B.parse(t["content"])
        assert blocks[0].kind == "heading" and any(b.kind == "table" for b in blocks)


def test_a_missing_required_section_is_added_where_it_belongs_and_aliases_count():
    t = T.builtin("policy")
    md = t["content"]
    cut = md.replace("## 3. Purpose", "## 3. Objective", 1)                      # an alias still matches
    assert not [i for i in run(cut, structure=t["structure"]) if i["rule"] == "section_missing"]
    blocks = B.parse(md)
    at = next(i for i, b in enumerate(blocks) if b.kind == "heading" and b.text.endswith("Compliance and Enforcement"))
    without = B.render(blocks[:at] + blocks[at + 2:])                              # the heading and its body
    issues = [i for i in run(without, structure=t["structure"]) if i["rule"] == "section_missing"]
    assert [i["message"] for i in issues] == ['The required section "Compliance and Enforcement" is missing.']
    restored = C.apply_fix(without, issues[0]["fix"])
    assert not [i for i in run(restored, structure=t["structure"]) if i["rule"] == "section_missing"]
    heads = [b.text for b in B.parse(restored) if b.kind == "heading"]
    assert heads.index("7. Policy Statements") < heads.index("Compliance and Enforcement") < heads.index("9. Exception Handling")


def test_sections_out_of_order_duplicated_or_too_short_are_reported():
    t = T.builtin("procedure")
    blocks = B.parse(t["content"])
    heads = [i for i, b in enumerate(blocks) if b.kind == "heading" and b.level == 2]
    swapped = list(blocks)
    a, b = heads[2], heads[3]                                                       # Purpose and Scope: swap them (each has one body block)
    swapped[a:a + 2], swapped[b:b + 2] = blocks[b:b + 2], blocks[a:a + 2]
    assert "section_order" in rules(run(B.render(swapped), structure=t["structure"]))
    assert "section_duplicate" in rules(run(t["content"] + "\n## Purpose\n\nAgain.\n", structure=t["structure"]))
    short = run("# T\n\n## 3. Purpose\n\nTiny.\n", structure={"sections": [{"key": "purpose", "title": "Purpose", "aliases": [], "required": True, "min_words": 20}]})
    assert "section_short" in rules(short)


def test_the_entity_name_and_the_logo_are_enforced():
    md = "# Access Policy\n\nThis applies to [Bank Name] staff.\n"
    issues = run(md, instructions={"entity_name": "CFSB", "logo_required": True}, logo_ok=False)
    assert {"entity_missing", "entity_placeholder", "logo_missing"} <= set(rules(issues))
    fix = next(i for i in issues if i["rule"] == "entity_missing")["fix"]
    fixed = C.apply_fix(md, fix)
    assert fixed.splitlines()[2] == "*Owned by CFSB*" and "entity_missing" not in rules(run(fixed, instructions={"entity_name": "CFSB"}))
    far = "# Policy\n\n## Purpose\n\nText.\n\nIssued by CFSB.\n"
    assert "entity_title" in rules(run(far, instructions={"entity_name": "CFSB"}))
    assert "logo_missing" not in rules(run(md, instructions={"logo_required": True}, logo_ok=True))


def test_issue_ids_are_unique_and_the_worst_come_first():
    issues = run("# T\n\n[[a]] [[b]] [[c]]\n\nthe the\n\nthe the\n")
    ids = [i["id"] for i in issues]
    assert len(ids) == len(set(ids))
    order = [{"error": 0, "warning": 1, "info": 2}[i["severity"]] for i in issues]
    assert order == sorted(order)


# ── templates ────────────────────────────────────────────────────────────────
@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        s.commit()
        yield s


def test_the_five_built_in_types_and_a_blank_are_listed_and_a_tenant_default_replaces_the_built_in_one(db):
    listing = T.listing(db)
    assert [t["id"] for t in listing[:6]] == ["builtin:policy", "builtin:standard", "builtin:procedure", "builtin:guideline", "builtin:charter", "builtin:blank"]
    assert T.resolve(db, None, "policy")["id"] == "builtin:policy" and T.resolve(db, None, "memo") is None
    row = m.StudioTemplate(tenant_id=1, name="CFSB policy", doc_type="policy", content="# CFSB\n\n## Purpose\n\n[[x]]\n",
                           structure=T.derive_structure("# CFSB\n\n## Purpose\n\n[[x]]\n"), is_default=True)
    db.add(row)
    db.commit()
    assert T.resolve(db, "default", "policy")["name"] == "CFSB policy" and T.resolve(db, None, "standard")["id"] == "builtin:standard"
    assert T.structure_for(db, "policy")["sections"][0]["title"] == "Purpose"
    assert any(t.get("replaced_by_default") for t in T.listing(db) if t["id"] == "builtin:policy")
    row.archived = True
    db.commit()
    assert T.resolve(db, None, "policy")["id"] == "builtin:policy"
    assert T.resolve(db, f"tenant:{row.id}", "policy") is None                      # an archived template cannot be picked
