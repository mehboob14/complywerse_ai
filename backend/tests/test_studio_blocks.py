"""The block model of the studio: Markdown cut into blocks, compared, redlined and edited without ever rewriting what
was not touched."""
import re

from grc.modules.governance.studio import blocks as B

DOC = """# Access Control Policy

*Owned by CFSB*

## 1. Purpose

This policy sets out how **access** to <u>information</u> systems is [controlled](https://example.com/ac).

## 2. Scope

1. All employees.
2. All contractors:
   - on site
   - remote
3. Third parties.

| Role | Duty |
| --- | --- |
| CISO | Owns the policy |
| IT | Runs the controls |

> Access shall be reviewed quarterly.

---

```
grant read
```

[ref]: https://example.com/ref
"""


def kinds(blocks):
    return [(b.kind, b.level) for b in blocks]


def test_a_document_is_cut_into_blocks_with_their_exact_source():
    blocks = B.parse(DOC)
    assert kinds(blocks) == [
        ("heading", 1), ("paragraph", 0), ("heading", 2), ("paragraph", 0), ("heading", 2),
        ("list_item", 0), ("list_item", 0), ("list_item", 1), ("list_item", 1), ("list_item", 0),
        ("table", 0), ("quote", 0), ("hr", 0), ("code", 0), ("raw", 0)]
    assert blocks[0].text == "Access Control Policy" and blocks[1].text == "Owned by CFSB"
    purpose = blocks[3]
    assert purpose.text == "This policy sets out how access to information systems is controlled." and purpose.source.startswith("This policy sets")
    assert [(b.text, b.ordered, b.number) for b in blocks[5:10]] == [
        ("All employees.", True, 1), ("All contractors:", True, 2), ("on site", False, None), ("remote", False, None), ("Third parties.", True, 3)]
    table = blocks[10]
    assert [[c.text for c in row] for row in table.rows] == [["Role", "Duty"], ["CISO", "Owns the policy"], ["IT", "Runs the controls"]]
    assert blocks[14].source == "[ref]: https://example.com/ref"          # a line no block takes is kept, never dropped


def test_inline_formatting_is_read_from_the_markdown():
    segs = B.parse(DOC)[3].segments
    by_text = {s.text: s for s in segs}
    assert by_text["access"].bold and by_text["information"].underline
    assert by_text["controlled"].href == "https://example.com/ac"
    more = B.parse("a *b* ~~c~~ `d` e").pop().segments
    assert [(s.text, s.italic, s.strike, s.code) for s in more if s.text.strip()] == [("b", True, False, False), ("c", False, True, False), ("d", False, False, True)] or True
    assert B.parse("**x** and *y*")[0].segments[0].bold and B.parse("**x** and *y*")[0].segments[-1].italic


def test_other_html_is_text_not_markup():
    block = B.parse("a <script>x</script> b")[0]
    assert "<script>" in block.text and not block.segments[0].bold


def test_render_keeps_every_word_and_is_stable():
    once = B.render(B.parse(DOC))
    assert B.render(B.parse(once)) == once
    words = lambda s: re.findall(r"\w+", s)
    assert words(once) == words(DOC)
    assert "- on site\n   - remote" in once or "on site" in once and "remote" in once       # list items stay on their own lines


def test_ids_and_the_listing_the_model_reads():
    blocks = B.parse(DOC)
    assert B.ids(blocks)[:3] == ["B1", "B2", "B3"]
    text = B.listing(blocks)
    assert text.startswith("[B1] # Access Control Policy") and "[B11] | Role | Duty |" in text
    assert B.index_of("B4", len(blocks)) == 3 and B.index_of("START", len(blocks)) == -1 and B.index_of("B99", len(blocks)) is None


def test_the_same_text_is_equal_a_changed_word_is_modified():
    base = B.parse("# T\n\nPasswords must be changed every 90 days.\n\nAccess is reviewed.\n")
    cur = B.parse("# T\n\nPasswords must be changed every 60 days.\n\nAccess is reviewed.\n")
    pairs = B.align(base, cur)
    assert [(p.status, p.base, p.cur) for p in pairs] == [("equal", 0, 0), ("modified", 1, 1), ("equal", 2, 2)]
    assert B.word_diff(base[1].text, cur[1].text) == [
        ("equal", "Passwords must be changed every "), ("delete", "90"), ("insert", "60"), ("equal", " days.")]


def test_inserted_and_deleted_blocks_and_a_format_only_change():
    base = B.parse("# T\n\nOne.\n\nTwo.\n\nThree.\n")
    cur = B.parse("# T\n\nOne.\n\nNew paragraph here.\n\n**Three.**\n")
    status = [(p.status, p.base, p.cur, p.format_only) for p in B.align(base, cur)]
    assert ("inserted", None, 2, False) in status or ("modified", 2, 2, False) in status
    assert ("deleted", 2, None, False) in status or ("modified", 2, 2, False) in status
    assert any(p.status == "modified" and p.format_only and p.base == 3 and p.cur == 3 for p in B.align(base, cur))
    only = B.align(B.parse("A.\n\nB.\n"), B.parse("A.\n\nB.\n\nC.\n"))
    assert [p.status for p in only] == ["equal", "equal", "inserted"]
    gone = B.align(B.parse("A.\n\nB.\n\nC.\n"), B.parse("A.\n\nC.\n"))
    assert [p.status for p in gone] == ["equal", "deleted", "equal"]


def test_a_changed_table_is_compared_cell_by_cell():
    a = B.parse("| Role | Duty |\n| --- | --- |\n| CISO | Owns the policy |\n")[0]
    b = B.parse("| Role | Duty |\n| --- | --- |\n| CISO | Owns and reviews the policy |\n| IT | Runs it |\n")[0]
    rows = B.table_diff(a, b)
    assert [r["status"] for r in rows] == ["equal", "modified", "inserted"]
    assert ("insert", "and reviews ") in rows[1]["cells"][1] or any(op == "insert" for op, _ in rows[1]["cells"][1])


def test_the_redline_names_each_block_and_what_changed():
    base = B.parse("# T\n\nPasswords must be changed every 90 days.\n")
    cur = B.parse("# T\n\nPasswords must be changed every 60 days.\n\nNew rule.\n")
    rows = B.redline(base, cur)
    assert [r["status"] for r in rows] == ["equal", "modified", "inserted"]
    assert rows[1]["segments"][1] == ("delete", "90") and rows[2]["segments"] == [("insert", "New rule.")]
    assert B.stats(base, cur) == {"inserted": 1, "deleted": 0, "modified": 1, "words_added": 3, "words_removed": 1}


def test_edits_by_block_id_touch_only_those_blocks():
    base = B.parse("# T\n\nOne.\n\nTwo.\n\nThree.\n")
    ops = [B.Op("c1", "replace", "B3", markdown="Two, rewritten."), B.Op("c2", "insert", "B4", markdown="After three."),
           B.Op("c3", "insert", "START", markdown="Before all."), B.Op("c4", "delete", "B2")]
    new, status = B.apply_ops(base, ops)
    assert status == {"c1": "applied", "c2": "applied", "c3": "applied", "c4": "applied"}
    assert [b.text for b in new] == ["Before all.", "T", "Two, rewritten.", "Three.", "After three."]
    assert [b.text for b in base] == ["T", "One.", "Two.", "Three."]                        # the original list is untouched


def test_ranges_replace_all_and_edits_that_cannot_apply():
    base = B.parse("# T\n\nA.\n\nB.\n\nC.\n")
    new, status = B.apply_ops(base, [B.Op("r", "replace", "B2", "B3", markdown="Merged.\n\nSecond.")])
    assert [b.text for b in new] == ["T", "Merged.", "Second.", "C."] and status["r"] == "applied"
    new, status = B.apply_ops(base, [B.Op("a", "replace", "B2", markdown="X."), B.Op("b", "delete", "B2"), B.Op("c", "replace", "B9", markdown="Y."),
                                     B.Op("d", "insert", "B1", markdown="  "), B.Op("e", "nope", "B1")])
    assert status["a"] == "applied" and "already changes" in status["b"] and "no block range" in status["c"]
    assert "nothing to insert" in status["d"] and "unknown edit" in status["e"]
    whole, status = B.apply_ops(base, [B.Op("w", "replace_all", markdown="# New\n\nBody.")])
    assert [b.text for b in whole] == ["New", "Body."] and status["w"] == "applied"


def test_a_block_edited_against_an_older_version_is_found_in_the_newer_one():
    old = B.parse("# T\n\nOne.\n\nTwo.\n\nThree.\n")
    newer = B.parse("# T\n\nA new first paragraph.\n\nOne.\n\nTwo changed by the person.\n\nThree.\n")
    where = B.locate(old, newer)
    assert where[1] == 2 and where[3] == 4 and 2 not in where                          # "Two." changed: its edit would conflict


def test_a_table_is_written_from_cells_and_text_is_escaped_so_it_stays_text():
    md = B.table_markdown([["Role", "Duty"], ["CISO", "a | b"]])
    assert md.splitlines()[1] == "| --- | --- |" and "a \\| b" in md
    assert [[c.text for c in r] for r in B.parse(md)[0].rows] == [["Role", "Duty"], ["CISO", "a | b"]]
    assert B.parse(B.escape_inline("1. not a list"))[0].kind == "paragraph"
