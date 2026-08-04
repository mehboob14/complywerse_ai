"""Generate the Asset Discovery implementation-plan PDF with ReportLab."""
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "ASSET_DISCOVERY_IMPLEMENTATION_PLAN.md"
OUTPUT = HERE / "ComplyVerse_Asset_Discovery_Implementation_Plan.pdf"


def inline(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r"<font name='Courier'>\1</font>", text)
    return text


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=25, leading=30, textColor=colors.HexColor("#0f766e"),
    alignment=TA_CENTER, spaceAfter=10 * mm,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontSize=13, leading=18,
    textColor=colors.HexColor("#334155"), alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="DocH1", parent=styles["Heading1"], fontSize=17, leading=21,
    textColor=colors.HexColor("#0f766e"), spaceBefore=7 * mm, spaceAfter=3 * mm,
))
styles.add(ParagraphStyle(
    name="DocH2", parent=styles["Heading2"], fontSize=13, leading=16,
    textColor=colors.HexColor("#0f172a"), spaceBefore=4 * mm, spaceAfter=2 * mm,
))
styles.add(ParagraphStyle(
    name="DocH3", parent=styles["Heading3"], fontSize=11, leading=14,
    textColor=colors.HexColor("#334155"), spaceBefore=3 * mm, spaceAfter=1.5 * mm,
))
styles.add(ParagraphStyle(
    name="DocBody", parent=styles["BodyText"], fontSize=9.2, leading=13.2,
    textColor=colors.HexColor("#1e293b"), spaceAfter=2.2 * mm,
))
styles.add(ParagraphStyle(
    name="DocCode", parent=styles["Code"], fontName="Courier", fontSize=7.8,
    leading=10.5, leftIndent=4 * mm, rightIndent=4 * mm,
    borderColor=colors.HexColor("#cbd5e1"), borderWidth=0.5,
    borderPadding=3 * mm, backColor=colors.HexColor("#f8fafc"),
    spaceBefore=2 * mm, spaceAfter=3 * mm,
))
styles.add(ParagraphStyle(
    name="DocSmall", parent=styles["BodyText"], fontSize=7.5, leading=9.5,
    textColor=colors.HexColor("#334155"),
))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#cbd5e1"))
    canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(18 * mm, 9 * mm, "ComplyVerse Asset Discovery & Intelligence — Implementation Plan")
    canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def table_from(lines):
    rows = []
    for line in lines:
        values = [v.strip() for v in line.strip().strip("|").split("|")]
        rows.append(values)
    if len(rows) > 1 and all(re.fullmatch(r":?-{3,}:?", x) for x in rows[1]):
        rows.pop(1)
    data = [[Paragraph(inline(cell), styles["DocSmall"]) for cell in row] for row in rows]
    col_count = max(len(row) for row in data)
    width = (A4[0] - 36 * mm) / col_count
    table = Table(data, colWidths=[width] * col_count, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ccfbf1")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#134e4a")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def build_story(markdown: str):
    lines = markdown.splitlines()
    story = []
    i = 0
    first_title = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            story.append(Paragraph("<br/>".join(inline(x).replace(" ", "&nbsp;") for x in block), styles["DocCode"]))
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and lines[i + 1].startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append(lines[i])
                i += 1
            story.extend([Spacer(1, 1.5 * mm), table_from(block), Spacer(1, 3 * mm)])
            continue
        if line.startswith("# "):
            if first_title:
                story.append(Spacer(1, 34 * mm))
                story.append(Paragraph(inline(line[2:]), styles["CoverTitle"]))
                first_title = False
            else:
                story.append(Paragraph(inline(line[2:]), styles["DocH1"]))
            i += 1
            continue
        if line.startswith("## "):
            title = line[3:]
            if title == "Product and Implementation Plan":
                story.append(Paragraph(title, styles["CoverSub"]))
                story.append(Spacer(1, 18 * mm))
            else:
                if title == "1. Executive summary":
                    story.append(PageBreak())
                story.append(Paragraph(inline(title), styles["DocH1"]))
            i += 1
            continue
        if line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), styles["DocH2"]))
            i += 1
            continue
        if line.startswith("#### "):
            story.append(Paragraph(inline(line[5:]), styles["DocH3"]))
            i += 1
            continue
        if re.match(r"^[-*] ", line):
            items = []
            while i < len(lines) and re.match(r"^[-*] ", lines[i]):
                items.append(ListItem(Paragraph(inline(lines[i][2:]), styles["DocBody"]), leftIndent=12))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", leftIndent=15, bulletFontSize=6, spaceAfter=2 * mm))
            continue
        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                content = re.sub(r"^\d+\. ", "", lines[i])
                items.append(ListItem(Paragraph(inline(content), styles["DocBody"]), leftIndent=14))
                i += 1
            story.append(ListFlowable(items, bulletType="1", leftIndent=18, spaceAfter=2 * mm))
            continue
        paragraph = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |[-*] |\d+\. |```|\|)", lines[i]):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(" ".join(paragraph)), styles["DocBody"]))
    return story


def main():
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4,
        rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=17 * mm, bottomMargin=20 * mm,
        title="ComplyVerse Asset Discovery & Intelligence — Implementation Plan",
        author="ComplyVerse",
        subject="Product and technical implementation blueprint",
    )
    doc.build(build_story(SOURCE.read_text(encoding="utf-8")), onFirstPage=footer, onLaterPages=footer)
    print(OUTPUT)


if __name__ == "__main__":
    main()
