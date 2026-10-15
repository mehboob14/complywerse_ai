"""A Word file's own hierarchy in the studio: the numbers Word puts in front of paragraphs (which are not in their text), the
indents, clauses numbered through a heading style that look like body text, and lists that start deep under a heading -
which must still read back block for block, so the file stays edited in place."""
import io

from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt

from grc.modules.governance.studio import blocks as B
from grc.modules.governance.studio import docx_io as D
from grc.modules.governance.studio import word_layout as L

from test_studio_files import DOCX, upload
from test_studio_flow import answer, last_body, reply, world          # noqa: F401  (world is a fixture)


def _abstract(aid: int, levels: str) -> None:
    return parse_xml(f'<w:abstractNum {nsdecls("w")} w:abstractNumId="{aid}"><w:multiLevelType w:val="multilevel"/>{levels}</w:abstractNum>')


def _lvl(i: int, fmt: str, text: str, left: int, hanging: int) -> str:
    return (f'<w:lvl w:ilvl="{i}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/>'
            f'<w:pPr><w:ind w:left="{left}" w:hanging="{hanging}"/></w:pPr></w:lvl>')


def _numbered(d, text, num, ilvl=0, style=None, *, plain=False, ind=None):
    p = d.add_paragraph(style=style)
    r = p.add_run(text)
    if plain:                                                   # a clause in a heading style that looks like body text
        r.bold, r.font.size = False, Pt(10)
    ppr = p._p.get_or_add_pPr()
    if num is not None:
        ppr.append(parse_xml(f'<w:numPr {nsdecls("w")}><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr>'))
    if ind:
        ppr.append(parse_xml(f'<w:ind {nsdecls("w")} {ind}/>'))
    return p


def manual(path: str) -> str:
    """A procedure manual built the way the bank's is: Roman document-control items, headings numbered 1. / 1.1. / 1.1.1. by
    one multilevel list, clauses in a heading style typed as body text, a bullet list starting at Word's third level under a
    clause, a Roman list started again, and an indented note."""
    d = Document()
    numbering = d.part.numbering_part.element
    numbering.insert(0, _abstract(90, "".join(_lvl(i, "decimal", "".join(f"%{k + 1}." for k in range(i + 1)), 720 + 720 * i, 720) for i in range(3))))
    numbering.insert(1, _abstract(91, "".join(_lvl(i, "bullet", "", 720 * (i + 1), 360) for i in range(3))))
    numbering.insert(2, _abstract(92, _lvl(0, "upperRoman", "%1.", 1080, 720)))
    heads, bullets, roman = numbering.add_num(90).numId, numbering.add_num(91).numId, numbering.add_num(92).numId
    again = numbering.add_num(92)
    again.add_lvlOverride(ilvl=0).add_startOverride(1)
    _numbered(d, "Document Control", roman, style="List Paragraph")
    _numbered(d, "Revision History", roman, style="List Paragraph")
    _numbered(d, "ACCEPTABLE USE PROCEDURE", heads, 0, "Heading 1")
    _numbered(d, "Purpose", heads, 1, "Heading 2")
    _numbered(d, "All staff protect the information they use.", heads, 2, "Heading 3", plain=True)
    _numbered(d, "Passwords follow these rules:", heads, 2, "Heading 3", plain=True)
    _numbered(d, "Passwords are at least eight characters", bullets, 2)
    _numbered(d, "Passwords are changed every ninety days", bullets, 2)
    _numbered(d, "PASSWORD PROCEDURE", heads, 0, "Heading 1")
    _numbered(d, "Scope", heads, 1, "Heading 2")
    _numbered(d, "Annexes", again.numId, style="List Paragraph")
    _numbered(d, "An indented note.", None, ind='w:left="720" w:firstLine="360"')
    d.save(path)
    return path


def test_a_list_that_starts_deep_under_a_heading_reads_back_and_stays_edited_in_place(tmp_path):
    path = manual(str(tmp_path / "manual.docx"))
    imp = D.import_docx(path, twin=True)
    assert imp.native is not None                                                  # it used to read back as code: no editing in place
    assert "Passwords follow these rules:\n\n- Passwords are at least eight characters\n- Passwords are changed every ninety days\n" in imp.markdown
    md = imp.markdown.replace("- Passwords are changed every ninety days", "- Passwords are changed every ninety days\n- Passwords are never shared")
    data, _ = D.export_in_place(path, md)
    p = next(p for p in Document(io.BytesIO(data)).paragraphs if p.text == "Passwords are never shared")
    num_pr = p._p.pPr.find(qn("w:numPr"))
    assert num_pr.find(qn("w:ilvl")).get(qn("w:val")) == "2"                        # Word's level of the items beside it, not the first
    looks = L.for_blocks(data, md)
    assert looks[B.parse(md).index(next(b for b in B.parse(md) if b.text == "Passwords are never shared"))] == {"label": "▪", "left": 108.0, "hang": 18.0}


def test_each_block_gets_the_number_indent_and_look_word_gives_it(tmp_path):
    path = manual(str(tmp_path / "manual.docx"))
    md = D.import_docx(path, twin=True).markdown
    data, _ = D.export_in_place(path, md)
    looks = L.for_blocks(data, md + "\n---\n")                                    # a rule has no paragraph in Word: it gets nothing
    assert [x.get("label") for x in looks] == ["I.", "II.", "1.", "1.1.", "1.1.1.", "1.1.2.", "▪", "▪", "2.", "2.1.", "I.", None, None]
    assert [bool(x.get("body")) for x in looks][2:6] == [False, False, True, True]  # the clauses look like text, the headings do not
    assert looks[4]["left"] == 108.0 and looks[4]["hang"] == 36.0                    # the list level's indent (third level)
    assert looks[11] == {"left": 36.0, "hang": -18.0} and looks[12] == {}            # a first-line indent; the rule


def test_the_studio_serves_the_layout_of_a_word_file_and_the_pdf_a_text_was_read_from(world, tmp_path):
    s = upload(world, manual(str(tmp_path / "manual.docx")), name="manual.docx", kind=DOCX)
    layout = world.http.get(world.api(f"/sessions/{s['id']}/layout")).json()
    assert layout["revision"] == s["revision"] and [x.get("label") for x in layout["blocks"]][:4] == ["I.", "II.", "1.", "1.1."]
    assert world.http.get(world.api(f"/sessions/{s['id']}/source-file")).status_code == 404       # a Word file is shown as Word draws it
    from grc.modules.governance.studio import exporters

    pdf_path = tmp_path / "policy.pdf"
    pdf_path.write_bytes(exporters.to_pdf("# Policy\n\nThe bank protects information.\n", title="Policy"))
    p = upload(world, str(pdf_path), name="policy.pdf", kind="application/pdf")
    got = world.http.get(world.api(f"/sessions/{p['id']}/source-file"))
    assert got.status_code == 200 and got.headers["content-type"] == "application/pdf" and got.content == pdf_path.read_bytes()
    assert world.http.get(world.api(f"/sessions/{p['id']}/layout")).json()["blocks"] == []


def test_comply_agent_reads_the_numbers_word_shows_and_is_told_not_to_type_them(world, tmp_path):
    s = upload(world, manual(str(tmp_path / "manual.docx")), name="manual.docx", kind=DOCX)
    world.respond(lambda body: reply(answer([], "Clause 1.1.1 asks staff to protect the information they use.")))
    out = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "What does clause 1.1.1 say?"}).json()
    assert world.http.get(world.api(f"/sessions/{s['id']}/messages/{out['id']}")).json()["status"] == "done"
    prompt = last_body(world)["messages"][-1]["content"]
    assert "[B1 · I.] 1. Document Control" in prompt and "[B5 · 1.1.1.] ### All staff protect the information they use." in prompt
    assert "[B7] - Passwords are at least eight characters" in prompt               # a bullet: the Markdown shows it already
    assert "never write it into the text" in prompt
