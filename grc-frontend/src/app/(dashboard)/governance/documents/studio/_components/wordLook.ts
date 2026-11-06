/**
 * How the studio editor draws a document: as a page of Word. A Word file edited in place looks as its file sets it (the
 * server reads each block's look and the page from the file, `GET /sessions/{id}/layout`); any other document looks as the
 * platform's own Word export sets it (`exporters._style_doc`: A4, Calibri 10.5 pt, Heading 1-4). Pure, so it is tested
 * (wordLook.test.ts).
 */
import type { BlockLook, PageLook } from '@/lib/studio/api';

/** The export's page and normal text: A4 with 2.2 cm at the sides and 2.6 cm at the top; Calibri 10.5 pt, 1.15 lines, 6 pt after. */
const EXPORT_PAGE = { width: 595.3, left: 62.35, right: 62.35, top: 73.7 };
const EXPORT_NORMAL: BlockLook = { font: 'Calibri', size: 10.5, line: 1.15, after: 6 };

// fonts with the same widths for machines that do not have Word's own (so lines break where they do in Word)
const TWINS: Record<string, string> = { calibri: 'Carlito, Arial', cambria: 'Caladea', arial: 'Arimo', 'times new roman': 'Tinos' };
const SERIF = /times|cambria|georgia|garamond|book antiqua|palatino|roman|serif/i;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const LINE = /^\d+(\.\d+)?pt$/;

/** A font as CSS: its name, then a font of the same widths where one is known, then a generic family. */
export function fontStack(name: string): string {
  const clean = name.replace(/["\\]/g, '').trim();
  const twin = TWINS[clean.toLowerCase()];
  return [`"${clean}"`, ...(twin ? [twin] : []), SERIF.test(clean) ? 'serif' : 'sans-serif'].join(', ');
}

const colour = (v: string | undefined, fallback: string): string => (v && HEX.test(v) ? v : fallback);

/** How tall one line of a font is, as a share of its size (`lib/fontLines.lineRatio` in the browser; 1 in tests). */
export type LineRatio = (fontList: string) => number;
const noRatio: LineRatio = () => 1;

/** Word's line spacing as CSS: a multiple of the font's own single line (as the View draws it), points as they are. */
const lineHeight = (v: number | string | undefined, font: string, ratio: LineRatio): string =>
  typeof v === 'number' ? String(+(v * ratio(font)).toFixed(3)) : v && LINE.test(v) ? v : 'normal';

/** Text on a header row's fill: white on a dark fill (black, navy), as Word draws automatic text there; none on a light or a
 *  bright one (Word keeps black text on red; the same rule as the View's). */
export function headInk(fill: string): string | null {
  if (!HEX.test(fill)) return null;
  const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(fill.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18 ? '#FFFFFF' : null;
}

/**
 * The inline style a block's look puts on it (a node decoration, so it wins over the editor's own styles). A paragraph's
 * typography comes whole (it always has a font): what it leaves out is Word's default - not bold, black, no space before or
 * after, single lines - never the editor's heading look. A table has only its text size and the fill of its first row.
 */
export function blockStyle(l: BlockLook, ratio: LineRatio = noRatio): string {
  const css: string[] = [];
  if (l.left || l.hang) css.push(`padding-left:${l.left ?? 0}pt`, `text-indent:${-(l.hang ?? 0)}pt`, `--hang:${Math.max(0, l.hang ?? 0)}pt`);
  // the number's room up to the list stop its tab goes to, when that comes before the indent ("1.3.1." then text at 0.5")
  if (l.label && l.tab != null) css.push(`--label:${Math.max(0, l.tab - ((l.left ?? 0) - (l.hang ?? 0)))}pt`);
  if (l.right) css.push(`padding-right:${l.right}pt`);
  if (l.font) {
    css.push(
      `font-family:${fontStack(l.font)}`,
      `font-size:${l.size ?? 10}pt`,
      `font-weight:${l.bold ? 700 : 400}`,
      `font-style:${l.italic ? 'italic' : 'normal'}`,
      `text-decoration:${l.underline ? 'underline' : 'none'}`,
      `text-transform:${l.caps ? 'uppercase' : 'none'}`,
      `color:${colour(l.color, '#000')}`,
      `text-align:${l.align ?? 'left'}`,
      `margin-top:${l.before ?? 0}pt`,
      `margin-bottom:${l.after ?? 0}pt`,
      `line-height:${lineHeight(l.line, fontStack(l.font), ratio)}`,
    );
  } else if (l.size) css.push(`font-size:${l.size}pt`);
  if (l.head_fill && HEX.test(l.head_fill)) {
    css.push(`--head-fill:${l.head_fill}`);
    const ink = headInk(l.head_fill);
    if (ink) css.push(`--head-ink:${ink}`);
  }
  return css.join(';');
}

/**
 * The sheet: its width and margins and the document's normal text (for text with no look of its own: a new paragraph until
 * the next layout, and every block of a document that is not a Word file). The file's page when there is one, else the
 * export's. A pane narrower than the page shrinks the margins in proportion (the editor is never zoomed: ProseMirror places
 * the cursor by the page's real size).
 */
export function sheetStyle(page?: PageLook | null, ratio: LineRatio = noRatio): Record<string, string> {
  const file = !!page?.width;
  const width = page?.width || EXPORT_PAGE.width;
  const side = (v: number | undefined, fallback: number) => {
    const pt = file && v != null ? v : fallback;
    return `min(${pt}pt, ${((pt / width) * 100).toFixed(3)}%)`;
  };
  const top = side(page?.top, EXPORT_PAGE.top);
  const n: BlockLook = file ? page?.normal ?? {} : EXPORT_NORMAL;
  const font = fontStack(n.font ?? (file ? 'Times New Roman' : 'Calibri'));
  return {
    width: `${width}pt`,
    padding: `${top} ${side(page?.right, EXPORT_PAGE.right)} ${top} ${side(page?.left, EXPORT_PAGE.left)}`,
    '--doc-font': font,
    '--doc-size': `${n.size ?? 10}pt`,
    '--doc-line': lineHeight(n.line, font, ratio),
    '--doc-color': colour(n.color, '#000'),
    '--doc-align': n.align ?? 'left',
    '--doc-before': `${n.before ?? 0}pt`,
    '--doc-after': `${n.after ?? 0}pt`,
  };
}

/** The export's rule (exporters.to_docx `one_title`): a document whose only level-1 heading is its first heading has it as its
 *  Title, and its other headings move up a level (## is Heading 1). */
export function oneTitle(levels: number[]): boolean {
  return levels.length > 0 && levels[0] === 1 && levels.filter((l) => l === 1).length === 1;
}
