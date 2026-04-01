from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "posts.md"
OUTPUT_PATH = ROOT / "posts_export.xlsx"


def clean_markdown(text: str) -> str:
    text = text.replace("\u2014", "-")
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    return " ".join(text.strip().split())


def split_section(content: str, heading: str) -> str:
    pattern = re.compile(rf"^##\s+{re.escape(heading)}\s*$", re.MULTILINE)
    match = pattern.search(content)
    if not match:
        raise ValueError(f"Section not found: {heading}")

    start = match.end()
    next_heading = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(content)
    return content[start:end].strip()


def parse_markdown_table(section: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        if set(stripped.replace("|", "").replace("-", "").replace(" ", "")) == set():
            continue
        parts = [clean_markdown(cell) for cell in stripped.strip("|").split("|")]
        rows.append(parts)
    if not rows:
        raise ValueError("No markdown table rows found")
    return rows


def parse_linkedin_plan(section: str) -> list[list[str]]:
    pattern = re.compile(
        r"^###\s+Day\s+(\d+)\s+(?:-|—)\s+(.+?)\s*$\n\n"
        r"\*\*Hook\*\*:\s*(.+?)\n\n"
        r"(.*?)(?=\n---\n\n###\s+Day\s+\d+\s+(?:-|—)|\Z)",
        re.MULTILINE | re.DOTALL,
    )

    rows: list[list[str]] = [["Day", "Topic", "Hook", "Body", "Hashtags"]]
    for match in pattern.finditer(section.strip()):
        day, topic, hook, body_block = match.groups()
        paragraphs = [clean_markdown(part) for part in body_block.strip().split("\n\n") if part.strip()]
        hashtags = ""
        if paragraphs and paragraphs[-1].startswith("#"):
            hashtags = paragraphs.pop()
        body = "\n\n".join(paragraphs)
        rows.append([day, clean_markdown(topic), clean_markdown(hook), body, hashtags])

    if len(rows) == 1:
        raise ValueError("No LinkedIn day entries found")
    return rows


def column_letter(index: int) -> str:
    letters = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


class SharedStrings:
    def __init__(self) -> None:
        self.index_by_value: dict[str, int] = {}
        self.values: list[str] = []

    def add(self, value: str) -> int:
        if value not in self.index_by_value:
            self.index_by_value[value] = len(self.values)
            self.values.append(value)
        return self.index_by_value[value]


def build_sheet_xml(rows: list[list[str]], shared_strings: SharedStrings) -> str:
    max_columns = max(len(row) for row in rows)
    widths: list[int] = []
    for col_idx in range(max_columns):
        max_len = max((len(row[col_idx]) if col_idx < len(row) else 0) for row in rows)
        widths.append(min(max(max_len + 4, 12), 60))

    cols_xml = "".join(
        f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>'
        for idx, width in enumerate(widths, start=1)
    )

    row_xml_parts: list[str] = []
    for row_idx, row in enumerate(rows, start=1):
        cell_xml_parts: list[str] = []
        for col_idx, value in enumerate(row, start=1):
            cell_ref = f"{column_letter(col_idx)}{row_idx}"
            style_id = 1 if row_idx == 1 else 2
            if row_idx != 1 and col_idx == 1 and value.isdigit():
                cell_xml_parts.append(
                    f'<c r="{cell_ref}" s="3"><v>{escape(value)}</v></c>'
                )
                continue

            shared_index = shared_strings.add(value)
            cell_xml_parts.append(
                f'<c r="{cell_ref}" t="s" s="{style_id}"><v>{shared_index}</v></c>'
            )
        row_xml_parts.append(f'<row r="{row_idx}">{"".join(cell_xml_parts)}</row>')

    last_ref = f"{column_letter(max_columns)}{len(rows)}"
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="A1:{last_ref}"/>'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="18"/>'
        f'<cols>{cols_xml}</cols>'
        f'<sheetData>{"".join(row_xml_parts)}</sheetData>'
        f'<autoFilter ref="A1:{last_ref}"/>'
        '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        '</worksheet>'
    )


def build_shared_strings_xml(strings: list[str]) -> str:
    items = "".join(f"<si><t>{escape(value)}</t></si>" for value in strings)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(strings)}" uniqueCount="{len(strings)}">{items}</sst>'
    )


def build_styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="2">'
        '<border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border>'
        '<left style="thin"><color auto="1"/></left>'
        '<right style="thin"><color auto="1"/></right>'
        '<top style="thin"><color auto="1"/></top>'
        '<bottom style="thin"><color auto="1"/></bottom>'
        '<diagonal/>'
        '</border>'
        '</borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="4">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>'
        '</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )


def build_workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{idx}" r:id="rId{idx}"/>'
        for idx, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="22000" windowHeight="12000"/></bookViews>'
        f'<sheets>{sheets}</sheets>'
        '</workbook>'
    )


def build_workbook_rels_xml(sheet_count: int) -> str:
    relationships = []
    for idx in range(1, sheet_count + 1):
        relationships.append(
            f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        )
    relationships.append(
        f'<Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    relationships.append(
        f'<Relationship Id="rId{sheet_count + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(relationships)}'
        '</Relationships>'
    )


def build_root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )


def build_content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for idx in range(1, sheet_count + 1):
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'{"".join(overrides)}'
        '</Types>'
    )


def build_core_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:creator>GitHub Copilot</dc:creator>'
        '<cp:lastModifiedBy>GitHub Copilot</cp:lastModifiedBy>'
        '<dc:title>Posts Export</dc:title>'
        '</cp:coreProperties>'
    )


def build_app_xml(sheet_names: list[str]) -> str:
    titles = "".join(f'<vt:lpstr>{escape(name)}</vt:lpstr>' for name in sheet_names)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        '<Application>Microsoft Excel</Application>'
        f'<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>{len(sheet_names)}</vt:i4></vt:variant></vt:vector></HeadingPairs>'
        f'<TitlesOfParts><vt:vector size="{len(sheet_names)}" baseType="lpstr">{titles}</vt:vector></TitlesOfParts>'
        '</Properties>'
    )


def write_workbook(sheets: list[tuple[str, list[list[str]]]], output_path: Path) -> None:
    shared_strings = SharedStrings()
    sheet_xml_map: list[str] = []
    sheet_names = [name for name, _ in sheets]

    for _, rows in sheets:
        sheet_xml_map.append(build_sheet_xml(rows, shared_strings))

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", build_content_types_xml(len(sheets)))
        workbook.writestr("_rels/.rels", build_root_rels_xml())
        workbook.writestr("docProps/core.xml", build_core_xml())
        workbook.writestr("docProps/app.xml", build_app_xml(sheet_names))
        workbook.writestr("xl/workbook.xml", build_workbook_xml(sheet_names))
        workbook.writestr("xl/_rels/workbook.xml.rels", build_workbook_rels_xml(len(sheets)))
        workbook.writestr("xl/styles.xml", build_styles_xml())
        workbook.writestr("xl/sharedStrings.xml", build_shared_strings_xml(shared_strings.values))
        for idx, xml in enumerate(sheet_xml_map, start=1):
            workbook.writestr(f"xl/worksheets/sheet{idx}.xml", xml)


def main() -> None:
    content = SOURCE_PATH.read_text(encoding="utf-8")
    part_1 = split_section(content, "Part 1: Real-World GRC Problems Solved by ComplyVerse")
    part_2 = split_section(content, "Part 2: 30-Day LinkedIn Content Plan")

    use_case_rows = parse_markdown_table(part_1)
    linkedin_rows = parse_linkedin_plan(part_2)

    write_workbook(
        [
            ("Use Cases", use_case_rows),
            ("LinkedIn Plan", linkedin_rows),
        ],
        OUTPUT_PATH,
    )

    print(f"Created workbook: {OUTPUT_PATH}")
    print(f"Use cases: {len(use_case_rows) - 1}")
    print(f"LinkedIn posts: {len(linkedin_rows) - 1}")


if __name__ == "__main__":
    main()