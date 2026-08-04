// CSV / Excel / Word export for a report (respects current columns, order,
// filters & sort). PDF is not here — it goes through /reports/print, which uses
// the browser's own print-to-PDF for real vector text (see that route).
import * as XLSX from 'xlsx';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, PageNumber,
  Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { ColumnDef, Row } from './types';
import { displayText, rawValue } from './grid-utils';

function toAOA(cols: ColumnDef[], rows: Row[]): (string | number)[][] {
  const header = cols.map((c) => c.label);
  const body = rows.map((r) =>
    cols.map((c) => {
      const raw = rawValue(c, r);
      if (c.type === 'number' && raw != null && raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
      return displayText(c, r);
    }),
  );
  return [header, ...body];
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function exportCSV(name: string, cols: ColumnDef[], rows: Row[]) {
  const ws = XLSX.utils.aoa_to_sheet(toAOA(cols, rows));
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export function exportExcel(name: string, cols: ColumnDef[], rows: Row[]) {
  const ws = XLSX.utils.aoa_to_sheet(toAOA(cols, rows));
  ws['!cols'] = cols.map((c) => ({ wch: Math.min(60, Math.max(10, Math.round((c.width || 120) / 7))) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Math.max(0, cols.length - 1) } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name || 'Report', []));
  XLSX.writeFile(wb, `${name}.xlsx`);
}

/** Excel forbids []:*?/\ in sheet names, caps them at 31 chars, and requires
 *  uniqueness — violate any of these and the workbook opens corrupt. */
function sheetName(raw: string, taken: string[]): string {
  let base = (raw || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base;
  let n = 2;
  while (taken.includes(out)) { const suffix = ` (${n++})`; out = base.slice(0, 31 - suffix.length) + suffix; }
  taken.push(out);
  return out;
}

/** A sheet is either column-driven (a data table) or a raw grid (key/value meta). */
export type SheetSpec =
  | { name: string; cols: ColumnDef[]; rows: Row[] }
  | { name: string; aoa: (string | number)[][] };

/** Multi-sheet workbook — e.g. the report itself plus how it was defined, so a
 *  recipient can see which filters produced the numbers. */
export function exportExcelMulti(name: string, sheets: SheetSpec[]) {
  const wb = XLSX.utils.book_new();
  const taken: string[] = [];
  for (const s of sheets) {
    const isAoa = 'aoa' in s;
    const ws = XLSX.utils.aoa_to_sheet(isAoa ? s.aoa : toAOA(s.cols, s.rows));
    if (isAoa) {
      ws['!cols'] = [{ wch: 22 }, { wch: 70 }];
    } else {
      ws['!cols'] = s.cols.map((c) => ({ wch: Math.min(60, Math.max(10, Math.round((c.width || 120) / 7))) }));
      if (s.rows.length && s.cols.length) {
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length, c: s.cols.length - 1 } }) };
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name, taken));
  }
  XLSX.writeFile(wb, `${name}.xlsx`);
}

export interface DocMeta {
  title: string;
  subtitle?: string;
  facts?: { label: string; value: string }[];
}

const INK = { head: 'F1F5F9', border: 'E2E8F0', muted: '64748B' };

/** Word export — a real .docx with a running header and true page numbers
 *  (Word can do what CSS paged-media can't in Chrome). */
export async function exportWord(name: string, meta: DocMeta, cols: ColumnDef[], rows: Row[]) {
  const aoa = toAOA(cols, rows);
  const header = (aoa[0] || []).map(String);
  const body = aoa.slice(1);

  const cell = (text: string, opts: { head?: boolean; num?: boolean } = {}) =>
    new TableCell({
      shading: opts.head ? { fill: INK.head } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({
        alignment: opts.num ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: !!opts.head, size: 16 })],
      })],
    });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
      left: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
      right: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: INK.border },
    },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h) => cell(h, { head: true })) }),
      ...body.map((r) => new TableRow({
        children: r.map((v, i) => cell(String(v ?? ''), { num: cols[i]?.type === 'number' })),
      })),
    ],
  });

  const facts = (meta.facts || []).map((f) => new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${f.label}: `, bold: true, size: 18, color: INK.muted }),
      new TextRun({ text: f.value, size: 18, color: INK.muted }),
    ],
  }));

  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: meta.title, size: 16, color: INK.muted })] })] }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: INK.muted })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 80 }, children: [new TextRun({ text: meta.title, bold: true })] }),
        ...(meta.subtitle ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: meta.subtitle, size: 20, color: INK.muted })] })] : []),
        ...facts,
        new Paragraph({ text: '' }),
        table,
      ],
    }],
  });

  download(await Packer.toBlob(doc), `${name}.docx`);
}
