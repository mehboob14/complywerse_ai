import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
} from 'docx';
import * as XLSX from 'xlsx';

// ─── Format resolution ────────────────────────────────────────────────────────

export type DownloadFormat = 'docx' | 'xlsx' | 'txt';

export function resolveDownloadFormat(
  format: string | null,
  artifactType: string,
): DownloadFormat {
  if (!format) return 'docx';
  const f = format.toUpperCase();
  const first = f.split(/[/,\s]/)[0].trim();

  // Register/Plan tables with spreadsheet-first format → xlsx
  if (
    first === 'XLSX' ||
    (first === '' && f.includes('XLSX') && ['Register', 'Plan'].includes(artifactType))
  ) return 'xlsx';

  // EML, raw logs, and similar plain-text containers
  if (['LOGS', 'CONFIGS', 'CONSOLE', 'EML', 'TXT'].includes(first)) return 'txt';

  // Everything else (DOCX, PDF, PPTX, Form, Dashboard, ...) → Word.
  // PDF is intentionally rendered as DOCX since we don't bundle a PDF
  // engine client-side; the user can convert to PDF from Word.
  return 'docx';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
}

// ─── Inline markdown → TextRun[] ─────────────────────────────────────────────

function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Courier New', size: 18 }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '' })];
}

// ─── Markdown table → docx Table ─────────────────────────────────────────────

function parseDocxTable(tableLines: string[]): Table {
  const dataLines = tableLines.filter(
    (l) => !l.trim().match(/^\|[-| :]+\|$/)
  );

  const rows = dataLines.map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, rowIndex) =>
      new TableRow({
        tableHeader: rowIndex === 0,
        children: cells.map((cell) =>
          new TableCell({
            shading:
              rowIndex === 0
                ? { type: ShadingType.SOLID, color: 'E2E8F0', fill: 'E2E8F0' }
                : undefined,
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              left:   { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              right:  { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: inlineRuns(cell),
                ...(rowIndex === 0 ? {} : {}),
              }),
            ],
          })
        ),
      })
    ),
  });
}

// ─── Markdown → docx block list ──────────────────────────────────────────────

function markdownToBlocks(markdown: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table block
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(parseDocxTable(tableLines));
      blocks.push(new Paragraph({ text: '' })); // spacing after table
      continue;
    }

    // Heading levels
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    const h4 = line.match(/^#### (.+)/);

    if (h1) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(h1[1]) }));
    } else if (h2) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(h2[1]) }));
    } else if (h3) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(h3[1]) }));
    } else if (h4) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: inlineRuns(h4[1]) }));

    // Bullet list item
    } else if (line.match(/^[-*] (.+)/)) {
      const text = line.replace(/^[-*] /, '');
      blocks.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineRuns(text),
        })
      );

    // Numbered list item
    } else if (line.match(/^\d+\. (.+)/)) {
      const text = line.replace(/^\d+\. /, '');
      blocks.push(
        new Paragraph({
          numbering: { reference: 'default-numbering', level: 0 },
          children: inlineRuns(text),
        })
      );

    // Horizontal rule
    } else if (line.match(/^---+$/)) {
      blocks.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' } },
          text: '',
        })
      );

    // Blockquote
    } else if (line.startsWith('> ')) {
      blocks.push(
        new Paragraph({
          indent: { left: 720 },
          children: [new TextRun({ text: line.slice(2), italics: true, color: '64748B' })],
        })
      );

    // Empty line → spacer
    } else if (line.trim() === '') {
      blocks.push(new Paragraph({ text: '' }));

    // Regular paragraph
    } else {
      blocks.push(new Paragraph({ children: inlineRuns(line) }));
    }

    i++;
  }

  return blocks;
}

// ─── DOCX download ────────────────────────────────────────────────────────────

export async function downloadAsDocx(filename: string, content: string): Promise<void> {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal' as const,
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          basedOn: 'Normal',
          run: { font: 'Calibri', size: 22 },
          paragraph: { spacing: { after: 120 } },
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: markdownToBlocks(content),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${safeFilename(filename)}.docx`);
}

// ─── XLSX download ────────────────────────────────────────────────────────────

export function downloadAsXlsx(filename: string, content: string): void {
  const wb = XLSX.utils.book_new();

  // Extract all markdown table blocks
  const tableBlockRegex = /(\|.+(?:\r?\n|$))+/g;
  const tableBlocks: string[][] = [];
  let match: RegExpExecArray | null;

  while ((match = tableBlockRegex.exec(content)) !== null) {
    const block = match[0].trim().split('\n');
    const rows = block
      .filter((l) => !l.trim().match(/^\|[-| :]+\|$/))
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
      );
    if (rows.length > 0) tableBlocks.push(rows);
  }

  if (tableBlocks.length > 0) {
    tableBlocks.forEach((rows, idx) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      // Bold the header row
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
      }
      XLSX.utils.book_append_sheet(wb, ws, idx === 0 ? 'Data' : `Sheet${idx + 1}`);
    });
  } else {
    // No tables found: put plain text lines into column A
    const textRows = content
      .split('\n')
      .map((l) => [l.replace(/^#+\s*/, '').replace(/\*\*/g, '')]);
    const ws = XLSX.utils.aoa_to_sheet(textRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Content');
  }

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `${safeFilename(filename)}.xlsx`);
}

// ─── TXT download ─────────────────────────────────────────────────────────────

export function downloadAsTxt(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, `${safeFilename(filename)}.txt`);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function downloadAsFormat(
  filename: string,
  content: string,
  format: string | null,
  artifactType: string,
): Promise<void> {
  const fmt = resolveDownloadFormat(format, artifactType);
  if (fmt === 'xlsx') {
    downloadAsXlsx(filename, content);
  } else if (fmt === 'txt') {
    downloadAsTxt(filename, content);
  } else {
    await downloadAsDocx(filename, content);
  }
}
