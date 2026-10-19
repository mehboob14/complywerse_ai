/**
 * docx-preview draws a Word file close to Word, not as Word. What it draws differently is put right here, so a document reads
 * on the platform as it does in Word, from the first page to the last. Checked against Word's own PDFs: a 59-page bank manual
 * gives Word's 59 pages, each starting where Word's does, with Word's numbering, contents, fonts, tables, header and footer.
 *
 * Before it is drawn (`prepareDocx`, on the file's XML; each step says what docx-preview did):
 * - Fonts: the Latin ("ascii") font, never the East Asian one; the default paragraph style for unstyled paragraphs; styles
 *   in an order docx-preview inherits through.
 * - Lists: numbers worked out as Word numbers and written in as text with their tab; numbering taken off takes its indent.
 * - Tables of contents in plain text; automatic text white on dark shading; contextual spacing; empty lines as tall as Word's.
 * - Tables placed and padded as Word places them; header rows marked to repeat.
 * - Pages: Word's recorded page breaks made real, page breaks at a paragraph's start moved before it, sections that go on on
 *   the same page, headers and footers carried on to later sections and left off a different first page, page numbers marked.
 * - Fields, content controls and other containers emptied so what they show is drawn; VML text boxes and rules drawn.
 * - Tabs marked, with their paragraph's stops (style, list level, its own).
 *
 * After it is drawn (`finishLayout`, at full size, before the page is scaled to fit): font stand-ins, Word's line heights, tabs
 * and leaders, text boxes and shapes placed from Word's frames, sections joined, header rows repeated, the space before at a
 * page's top left out, overlong pages split where their content reaches the foot, and each page's own number.
 */
import JSZip from 'jszip';
import { lineRatio } from '../../lib/fontLines.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const VML = 'urn:schemas-microsoft-com:vml';
const OFFICE = 'urn:schemas-microsoft-com:office:office';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const TAB = '\uE000';                      // a tab, until it is laid out
const PTAB_CENTER = '\uE003';              // an absolute-position tab (w:ptab) to the centre / right of the column
const PTAB_RIGHT = '\uE004';
const PAGE = '\uE001';                     // this page's number
const PAGES = '\uE002';                    // the number of pages
const MARK = '_wvTabs';                    // a bookmark opening a paragraph with tabs: MARK + the index of its stops
const BREAK_STYLE = 'WvPageBreak';         // the paragraph that carries a page break Word recorded (drawn as nothing)
const CONTINUE = '_wvContinue';            // a bookmark opening a section that goes on on the same page (a continuous break)
const NO_HEADER = '_wvNoHeader';           // ...a section whose first page has no header / no footer (titlePg, none given)
const NO_FOOTER = '_wvNoFooter';
const HEAD_ROWS = '_wvHead';               // ...a table whose first rows repeat on each page (+ how many)
const PAGE_START = '_wvPageStart';         // ...a section that numbers its pages its own way (+ start_format)
const PT = 0.75;                           // CSS pixels to points
const DARK = 0.18;                         // a shading darker than this (relative luminance) turns automatic text white

export interface TabStop {
  /** points from the start of the column (the page margin, or the cell's edge) */
  pos: number;
  /** "num": the stop a list number's tab goes to; a left stop that a nearer layer's own list stop replaces */
  kind: 'left' | 'right' | 'center' | 'decimal' | 'bar' | 'clear' | 'num';
  leader: string;
}

export interface Prepared {
  file: Blob;
  /** the tab stops of each paragraph that has tabs, by the index in its bookmark */
  stops: TabStop[][];
  /** Word's default tab stop interval, in points */
  defaultTab: number;
  /** each font of the file and the fonts that stand in for it when it is not installed, by its kind (Word's substitution) */
  fonts: Record<string, string>;
  /** the Word version the file was made for (12: Word 2007, 15: Word 2013 and later) */
  compat: number;
}

// ── what Word does, as plain functions ─────────────────────────────────────────
const KINDS: Record<string, TabStop['kind']> = {
  left: 'left', start: 'left', num: 'num', right: 'right', end: 'right', center: 'center', decimal: 'decimal', bar: 'bar', clear: 'clear',
};

/** The stops of a paragraph from its layers, outermost first (styles from base to derived, list level, the paragraph's own):
 * a later layer adds stops and clears the ones it names, and its list stop replaces the list stop before it (a list level's
 * 1.25" over its style's 1", where the number's tab goes in Word). */
export function mergeStops(layers: TabStop[][]): TabStop[] {
  const at = new Map<number, TabStop>();
  for (const layer of layers) {
    if (layer.some((t) => t.kind === 'num')) for (const [pos, t] of Array.from(at)) if (t.kind === 'num') at.delete(pos);
    for (const t of layer) {
      if (t.kind === 'clear') at.delete(t.pos);
      else at.set(t.pos, t);
    }
  }
  return Array.from(at.values()).sort((a, b) => a.pos - b.pos);
}

/** Where a tab at `x` goes: the first stop after it, the hanging indent while the text is left of it, else the next default
 * stop. Default stops fall every interval from the margin, and Word drops those before its last custom stop and before the
 * hanging indent (so a number's tab reaches the indent however the list is indented). */
export function nextStop(x: number, stops: TabStop[], defaultTab: number, hangingIndent: number | null): TabStop {
  const near = 0.5;
  const custom = stops.filter((s) => s.kind !== 'bar' && s.kind !== 'clear');
  const options = custom.filter((s) => s.pos > x + near);
  const indent = hangingIndent != null && hangingIndent > x + near ? hangingIndent : null;
  if (indent != null) options.push({ pos: indent, kind: 'left', leader: 'none' });
  const step = defaultTab > 0 ? defaultTab : 36;
  const from = Math.max(x + near, custom.length ? custom[custom.length - 1].pos : 0, indent ?? 0);
  options.push({ pos: (Math.floor(from / step + 1e-6) + 1) * step, kind: 'left', leader: 'none' });
  return options.reduce((a, b) => (b.pos < a.pos ? b : a));
}

/** The width of a tab at `x` going to `stop`; `after` is the width of the text after it up to the next tab, `toDecimal` the
 * width of that text up to its decimal point. Text that does not fit before a right or centre stop runs on past it. */
export function tabWidth(stop: TabStop, x: number, after: number, toDecimal: number): number {
  const w = stop.kind === 'right' ? stop.pos - x - after
    : stop.kind === 'center' ? stop.pos - x - after / 2
      : stop.kind === 'decimal' ? stop.pos - x - toDecimal
        : stop.pos - x;
  return Math.max(0, w);
}

const LEADERS: Record<string, string> = { dot: '.', middleDot: '·', hyphen: '-', underscore: '_', heavy: '_' };

/** The leader drawn across a tab `width` wide, with a little room at each end as Word leaves. */
export function leaderText(leader: string, width: number, charWidth: number): string {
  const ch = LEADERS[leader];
  if (!ch || !(charWidth > 0)) return '';
  const n = Math.floor(width / charWidth) - 1;
  return n > 0 ? ch.repeat(n) : '';
}

// ── reading the XML ────────────────────────────────────────────────────────────
const isW = (el: Element | null | undefined, name: string): boolean => !!el && el.namespaceURI === W && el.localName === name;
const kids = (el: Element | null | undefined, name: string): Element[] => (el ? Array.from(el.children).filter((c) => isW(c, name)) : []);
const kid = (el: Element | null | undefined, name: string): Element | null => {
  for (let c = el?.firstElementChild ?? null; c; c = c.nextElementSibling) if (isW(c, name)) return c;
  return null;
};
const val = (el: Element | null | undefined, name = 'val'): string | null => (el ? el.getAttributeNS(W, name) : null);
const isOn = (el: Element | null): boolean => !!el && !/^(0|false|off)$/i.test(val(el) ?? '');
const all = (root: Document | Element, name: string): Element[] => Array.from(root.getElementsByTagNameNS(W, name));
const nearest = (el: Element, name: string): Element | null => {
  for (let p = el.parentElement; p; p = p.parentElement) if (isW(p, name)) return p;
  return null;
};
const points = (twips: string | null): number | null => (twips != null && /^-?\d+(\.\d+)?$/.test(twips) ? Number(twips) / 20 : null);
const make = (doc: Document, name: string, attrs: Record<string, string> = {}): Element => {
  const el = doc.createElementNS(W, `w:${name}`);
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(W, `w:${k}`, v);
  return el;
};

interface Styles {
  /** a style and the styles it is based on, base first */
  chain: (id: string | null) => Element[];
  /** a paragraph property of a style as Word resolves it: the style's own, else the nearest style it is based on that sets it */
  prop: (id: string | null, name: string) => Element | null;
  /** the text colour a paragraph style sets (not "auto"), if any */
  colour: (id: string | null) => string | null;
  defaultPara: string | null;
  /** the ids of the character styles Word names "Hyperlink" */
  hyperlink: Set<string>;
}

function readStyles(doc: Document | null): Styles {
  const ids = new Map<string, Element>();
  const hyperlink = new Set<string>(['Hyperlink']);
  let defaultPara: string | null = null;
  for (const s of doc ? all(doc, 'style') : []) {
    const id = val(s, 'styleId');
    if (!id) continue;
    ids.set(id, s);
    if (defaultPara == null && val(s, 'type') === 'paragraph' && /^(1|true|on)$/i.test(val(s, 'default') ?? '')) defaultPara = id;
    if (/^hyperlink$/i.test(val(kid(s, 'name')) ?? '')) hyperlink.add(id);
  }
  const chains = new Map<string, Element[]>();
  const chain = (id: string | null): Element[] => {
    const key = id ?? defaultPara ?? '';
    let out = chains.get(key);
    if (!out) {
      out = [];
      const seen = new Set<string>();
      for (let cur: string | null = key; cur && !seen.has(cur); cur = val(kid(ids.get(cur), 'basedOn'))) {
        seen.add(cur);
        const s = ids.get(cur);
        if (!s) break;
        out.unshift(s);
      }
      chains.set(key, out);
    }
    return out;
  };
  const props = new Map<string, Element | null>();
  const prop = (id: string | null, name: string): Element | null => {
    const key = `${id ?? defaultPara ?? ''}\n${name}`;
    if (!props.has(key)) {
      const styles = chain(id);
      let found: Element | null = null;
      for (let i = styles.length - 1; i >= 0 && !found; i--) found = kid(kid(styles[i], 'pPr'), name);
      props.set(key, found);
    }
    return props.get(key) ?? null;
  };
  const colour = (id: string | null): string | null => {
    const styles = chain(id);
    for (let i = styles.length - 1; i >= 0; i--) {
      const c = val(kid(kid(styles[i], 'rPr'), 'color'));
      if (c) return c.toLowerCase() === 'auto' ? null : c;
    }
    return null;
  };
  return { chain, prop, colour, defaultPara, hyperlink };
}

const styleOf = (p: Element, st: Styles): string | null => val(kid(kid(p, 'pPr'), 'pStyle')) ?? st.defaultPara;

/** A paragraph property as Word resolves it: the paragraph's own, else its style's. */
const inherited = (p: Element, st: Styles, name: string): Element | null => kid(kid(p, 'pPr'), name) ?? st.prop(styleOf(p, st), name);

interface Lists {
  /** a list instance's level: its own override, else its abstract list's (following a numbering style's link) */
  level: (numId: string, ilvl: number) => Element | null;
  /** the number a level counts from (the instance's start override first) */
  start: (numId: string, ilvl: number) => number;
  /** the abstract list an instance counts in: instances of one abstract list share their counters */
  abstractOf: (numId: string) => string | null;
  overrides: (numId: string) => Element[];
}

function readNumbering(doc: Document | null, st: Styles): Lists {
  const abstracts = new Map<string, Element>();
  const nums = new Map<string, Element>();
  for (const a of doc ? all(doc, 'abstractNum') : []) abstracts.set(val(a, 'abstractNumId') ?? '', a);
  for (const n of doc ? all(doc, 'num') : []) nums.set(val(n, 'numId') ?? '', n);
  const abstractOf = (numId: string): string | null => val(kid(nums.get(numId), 'abstractNumId'));
  const definition = (numId: string, depth = 0): Element | null => {
    const a = abstracts.get(abstractOf(numId) ?? '') ?? null;
    const link = val(kid(a, 'numStyleLink'));
    const linked = link && depth < 4 ? val(kid(st.prop(link, 'numPr'), 'numId')) : null;
    return linked && linked !== numId ? definition(linked, depth + 1) : a;
  };
  const overrides = (numId: string) => kids(nums.get(numId), 'lvlOverride');
  const override = (numId: string, ilvl: number) => overrides(numId).find((o) => Number(val(o, 'ilvl')) === ilvl) ?? null;
  const level = (numId: string, ilvl: number) =>
    kid(override(numId, ilvl), 'lvl') ?? kids(definition(numId), 'lvl').find((l) => Number(val(l, 'ilvl')) === ilvl) ?? null;
  const start = (numId: string, ilvl: number) => {
    const v = val(kid(override(numId, ilvl), 'startOverride')) ?? val(kid(level(numId, ilvl), 'start'));
    return v != null && /^\d+$/.test(v) ? Number(v) : 1;
  };
  return { level, start, abstractOf, overrides };
}

/** The list a paragraph is in and its level: each from its own numPr, else from its style's. */
function numberingOf(p: Element, st: Styles): { numId: string; ilvl: number } | null {
  const own = kid(kid(p, 'pPr'), 'numPr');
  const styled = st.prop(styleOf(p, st), 'numPr');
  const numId = val(kid(own, 'numId')) ?? val(kid(styled, 'numId'));
  if (!numId || numId === '0') return null;
  return { numId, ilvl: Number(val(kid(own, 'ilvl')) ?? val(kid(styled, 'ilvl')) ?? 0) || 0 };
}

function listLevel(p: Element, st: Styles, lists: Lists): Element | null {
  const n = numberingOf(p, st);
  return n ? lists.level(n.numId, n.ilvl) : null;
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const ARABIC_ALPHA = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي';
const ARABIC_ABJAD = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';

/** A list number written in a level's format, as Word writes it. */
export function formatNumber(n: number, format: string | null): string {
  const roman = () => {
    let out = '';
    let rest = n;
    for (const [value, sym] of ROMAN) while (rest >= value) { out += sym; rest -= value; }
    return out;
  };
  const letter = () => (n > 0 ? String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1) : '');
  switch (format) {
    case 'none': case 'bullet': return '';
    case 'upperRoman': return roman().toUpperCase();
    case 'lowerRoman': return roman();
    case 'upperLetter': return letter().toUpperCase();
    case 'lowerLetter': return letter();
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'ordinal': return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
    case 'hindiNumbers': return String(n).replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    case 'arabicAlpha': return ARABIC_ALPHA[(n - 1) % ARABIC_ALPHA.length] ?? String(n);
    case 'arabicAbjad': return ARABIC_ABJAD[(n - 1) % ARABIC_ABJAD.length] ?? String(n);
    default: return String(n);
  }
}

// a bullet in a symbol font, as the character it shows (the studio's editor shows the same ones)
const GLYPHS: Record<string, string> = {
  '\uF0B7': '•', '\uF0A7': '▪', '\uF0D8': '➢', '\uF076': '❖', '\uF0FC': '✓', '\uF0A8': '□',
  '\uF06E': '■', '\uF0E0': '➢', '§': '▪', '\uF06C': '•', '\uF0FB': '✗', '\uF0FE': '☑',
  '\uF0E8': '➔', '\uF0F0': '⇨', '\uF09F': '•', '\uF071': '❑',
};

const stopsOf = (pPr: Element | null): TabStop[] => kids(kid(pPr, 'tabs'), 'tab').map((t) => ({
  pos: points(val(t, 'pos')) ?? 0,
  kind: KINDS[val(t) ?? 'left'] ?? 'left',
  leader: val(t, 'leader') ?? 'none',
}));

// ── the changes ────────────────────────────────────────────────────────────────
function latinFonts(doc: Document): void {
  for (const f of all(doc, 'rFonts')) {
    f.removeAttributeNS(W, 'eastAsia');
    f.removeAttributeNS(W, 'eastAsiaTheme');
    const theme = val(f, 'asciiTheme');
    if (theme) {                                         // a theme font named takes the place of the ascii font
      f.removeAttributeNS(W, 'ascii');
      f.setAttributeNS(W, 'w:asciiTheme', theme.replace(/Ascii$/, 'HAnsi'));    // the names docx-preview knows
    }
  }
}

function plainContents(doc: Document, st: Styles): void {
  for (const link of all(doc, 'hyperlink')) {
    if (!/^_Toc/.test(val(link, 'anchor') ?? '')) continue;
    for (const rs of all(link, 'rStyle')) if (st.hyperlink.has(val(rs) ?? '')) rs.remove();
  }
}

/** A list with no level named is at level 1 (ilvl 0); docx-preview drew no number or bullet for it ("docx-num-4-undefined"). */
function listLevels(doc: Document, st: Styles): void {
  for (const numPr of all(doc, 'numPr')) {
    if (kid(numPr, 'ilvl')) continue;
    const p = isW(numPr.parentElement?.parentElement, 'p') ? numPr.parentElement!.parentElement! : null;
    const fromStyle = p ? val(kid(st.prop(styleOf(p, st), 'numPr'), 'ilvl')) : null;
    numPr.insertBefore(make(doc, 'ilvl', { val: fromStyle ?? '0' }), numPr.firstChild);
  }
}

/** Word writes text in the automatic colour white on a dark shading (a table's black header row); docx-preview drew it black. */
function autoColourOnDark(doc: Document, st: Styles): void {
  const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const dark = (fill: string | null) => {
    if (!fill || !/^[0-9a-f]{6}$/i.test(fill)) return false;
    const n = parseInt(fill, 16);
    return 0.2126 * linear(n >> 16) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255) < DARK;   // black, navy: yes; red: no
  };
  const shaded = [...all(doc, 'tc').filter((tc) => dark(val(kid(kid(tc, 'tcPr'), 'shd'), 'fill'))),
    ...all(doc, 'p').filter((p) => dark(val(kid(kid(p, 'pPr'), 'shd'), 'fill')))];
  for (const scope of shaded) for (const r of all(scope, 'r')) {
    const p = nearest(r, 'p');
    let rPr = kid(r, 'rPr');
    const own = val(kid(rPr, 'color'));
    if ((own && own.toLowerCase() !== 'auto') || kid(rPr, 'rStyle') || (p && st.colour(styleOf(p, st)))) continue;    // a colour of its own
    if (!rPr) r.insertBefore(rPr = make(doc, 'rPr'), r.firstChild);
    kid(rPr, 'color')?.remove();
    rPr.appendChild(make(doc, 'color', { val: 'FFFFFF' }));
  }
}

/** A paragraph with no style named has the document's default paragraph style (Normal). docx-preview gave its text the
 * document defaults instead (Calibri 11 where Normal says Arial 10). In a table, what the table's style sets still wins: its
 * rules come later in docx-preview's sheet. */
function defaultStyle(doc: Document, st: Styles): void {
  if (!st.defaultPara) return;
  for (const p of all(doc, 'p')) {
    if (kid(kid(p, 'pPr'), 'pStyle')) continue;
    let pPr = kid(p, 'pPr');
    if (!pPr) p.insertBefore(pPr = make(doc, 'pPr'), p.firstChild);
    pPr.insertBefore(make(doc, 'pStyle', { val: st.defaultPara }), pPr.firstChild);
  }
}

/** A table with no style named has the document's default table style, with its cell margins (0.08" left and right in Word's
 * own); docx-preview set its text against the cell borders. */
function defaultTableStyle(doc: Document, id: string | null): void {
  if (!id) return;
  for (const tbl of all(doc, 'tbl')) {
    let tblPr = kid(tbl, 'tblPr');
    if (kid(tblPr, 'tblStyle')) continue;
    if (!tblPr) tbl.insertBefore(tblPr = make(doc, 'tblPr'), tbl.firstChild);
    tblPr.insertBefore(make(doc, 'tblStyle', { val: id }), tblPr.firstChild);
  }
}

/**
 * Tables placed as Word places them. A row's alignment (trPr/jc) places the row, it does not centre its text as docx-preview
 * made it. A table's indent (tblInd), which docx-preview ignored, is measured to the text of the first cell in files made for
 * Word 2010 and before (so the table's border sits one cell margin left of it, and of the page margin when there is no indent),
 * to the border in later files.
 */
function tables(doc: Document, compat: number, cellMargin: number): void {
  for (const jc of all(doc, 'jc')) if (isW(jc.parentElement, 'trPr') || isW(jc.parentElement, 'tblPrEx')) jc.remove();
  for (const tbl of all(doc, 'tbl')) {
    let tblPr = kid(tbl, 'tblPr');
    const jc = val(kid(tblPr, 'jc'));
    if (jc === 'center' || jc === 'right' || jc === 'end' || kid(tblPr, 'tblpPr')) continue;            // centred, or floating
    let ind = kid(tblPr, 'tblInd');
    const indent = ind && (val(ind, 'type') ?? 'dxa') === 'dxa' ? Number(val(ind, 'w')) || 0 : 0;
    const own = val(kid(kid(tblPr, 'tblCellMar'), 'left') ?? kid(kid(tblPr, 'tblCellMar'), 'start'), 'w');
    const left = indent - (compat < 15 ? (own != null && Number.isFinite(Number(own)) ? Number(own) : cellMargin) : 0);
    if (!left) continue;
    if (!tblPr) tbl.insertBefore(tblPr = make(doc, 'tblPr'), tbl.firstChild);
    if (!ind) tblPr.appendChild(ind = make(doc, 'tblInd', { w: '0', type: 'dxa' }));
    ind.setAttributeNS(W, 'w:left', String(left));                                   // what docx-preview reads
  }
}

/** A page break at the start of a paragraph's text is a break before it. docx-preview split the paragraph there and left an
 * empty copy on the page before, numbered like it (a list counted one too many: "II. Document Control" where Word shows "I.").
 * A paragraph that holds only the break keeps it: the page ends after it, as in Word. */
function breaksAtStart(doc: Document, breakBefore: (block: Element) => void): void {
  for (const br of all(doc, 'br')) {
    if (val(br, 'type') !== 'page') continue;
    const p = nearest(br, 'p');
    if (!p || !isW(p.parentElement, 'body') || before(doc, p, br).shown || !shownAfter(doc, p, br)) continue;
    br.remove();
    breakBefore(p);
  }
}

/** Numbering taken off a paragraph (numId 0) takes the list's indent with it: Word sets such a paragraph at the margin, not
 * at the indent its numbered style gives (table cells in the bullet style, squeezed into a sliver). */
function numberingRemoved(doc: Document, st: Styles): void {
  for (const p of all(doc, 'p')) {
    const pPr = kid(p, 'pPr');
    if (val(kid(kid(pPr, 'numPr'), 'numId')) !== '0' || kid(pPr, 'ind')) continue;
    const styled = val(kid(st.prop(styleOf(p, st), 'numPr'), 'numId'));
    if (styled && styled !== '0') pPr!.appendChild(make(doc, 'ind', { left: '0', firstLine: '0' }));
  }
}

/**
 * List numbers worked out as Word numbers (the studio's editor does the same, in word_layout.labels): counters per abstract
 * list, in document order; a deeper level restarts after a higher one; a level not reached yet shows its start ("2.4.1.1"
 * where docx-preview's CSS counters wrote "2.4.0.3"); an instance's start override restarts its list; legal numbering. Each
 * number is written into its paragraph as text, with the tab after it, so the tab goes where Word's goes; the paragraph keeps
 * its list's indent and tab stops and leaves the list, so docx-preview adds no number of its own.
 */
function numbers(doc: Document, st: Styles, lists: Lists): void {
  const counters = new Map<string, Map<number, number>>();
  const started = new Set<string>();
  for (const p of all(doc, 'p')) {
    const n = numberingOf(p, st);
    const lvl = n && lists.level(n.numId, n.ilvl);
    if (!n || !lvl) continue;
    const { numId, ilvl } = n;
    const key = lists.abstractOf(numId) ?? `num:${numId}`;
    if (!counters.has(key)) counters.set(key, new Map());
    const levels = counters.get(key)!;
    if (!started.has(numId)) {                                               // an instance that starts its list again
      started.add(numId);
      for (const o of lists.overrides(numId)) {
        if (!kid(o, 'startOverride')) continue;
        const from = Number(val(o, 'ilvl')) || 0;
        for (const k of Array.from(levels.keys())) if (k >= from) levels.delete(k);
      }
    }
    levels.set(ilvl, (levels.get(ilvl) ?? lists.start(numId, ilvl) - 1) + 1);
    for (const k of Array.from(levels.keys())) if (k > ilvl) levels.delete(k);
    const format = val(kid(lvl, 'numFmt'));
    const text = val(kid(lvl, 'lvlText')) ?? '';
    const legal = isOn(kid(lvl, 'isLgl'));
    // a symbol font's bullet as its Unicode twin (shown on any computer), when the level is set in a symbol font or the character
    // is in its private range; any other bullet keeps its own font (Courier New's "o")
    const symbols = /^[-]/.test(text) || /wingdings|symbol|webdings/i.test(val(kid(kid(lvl, 'rPr'), 'rFonts'), 'ascii') ?? '');
    const glyph = format === 'bullet' && symbols ? GLYPHS[text] : undefined;
    const label = format === 'bullet' ? glyph ?? text : text.replace(/%([1-9])/g, (_m, d: string) => {
      const k = Number(d) - 1;
      if (k > ilvl) return '';
      return formatNumber(levels.get(k) ?? lists.start(numId, k), legal ? 'decimal' : val(kid(lists.level(numId, k), 'numFmt')));
    });
    const suffix = val(kid(lvl, 'suff')) ?? 'tab';
    // the number's run: the list level's look over the paragraph mark's, as Word draws it (and not underlined with an underlined
    // heading, as Word shows it)
    const mark = kid(kid(p, 'pPr'), 'rPr');
    const run = (content: Element) => {
      const r = make(doc, 'r');
      const rPr = (mark?.cloneNode(true) as Element | undefined) ?? make(doc, 'rPr');
      for (const c of Array.from(rPr.children)) if (/^(ins|del|moveFrom|moveTo|rPrChange)$/.test(c.localName)) c.remove();
      for (const c of Array.from(kid(lvl, 'rPr')?.children ?? [])) {
        Array.from(rPr.children).find((x) => x.localName === c.localName)?.remove();
        rPr.appendChild(c.cloneNode(true));
      }
      if (glyph) kid(rPr, 'rFonts')?.remove();
      if (!kid(rPr, 'u')) rPr.appendChild(make(doc, 'u', { val: 'none' }));
      r.append(rPr, content);
      return r;
    };
    const t = doc.createElementNS(W, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = label + (suffix === 'space' ? ' ' : '');
    let pPr = kid(p, 'pPr');
    if (!pPr) p.insertBefore(pPr = make(doc, 'pPr'), p.firstChild);
    pPr.after(...[run(t), ...(suffix === 'tab' ? [run(make(doc, 'tab'))] : [])]);
    // the indent: each part from the paragraph, else its list level, else its style (as word_layout.indent)
    const places = [kid(pPr, 'ind'), kid(kid(lvl, 'pPr'), 'ind'), ...st.chain(styleOf(p, st)).slice().reverse().map((s) => kid(kid(s, 'pPr'), 'ind'))];
    let left: string | null = null;
    let first: [string, string] | null = null;
    for (const ind of places) {
      if (!ind) continue;
      left ??= val(ind, 'left') ?? val(ind, 'start');
      if (!first) first = val(ind, 'hanging') != null ? ['hanging', val(ind, 'hanging')!] : val(ind, 'firstLine') != null ? ['firstLine', val(ind, 'firstLine')!] : null;
    }
    const own = kid(pPr, 'ind');
    const ind = make(doc, 'ind', { left: left ?? '0', ...(first ? { [first[0]]: first[1] } : { firstLine: '0' }) });
    for (const side of ['right', 'end']) if (val(own, side) != null) ind.setAttributeNS(W, `w:${side}`, val(own, side)!);
    own?.remove();
    pPr.appendChild(ind);
    // its tab stops (the list level's, before its own) and no number from docx-preview
    const levelTabs = kids(kid(kid(lvl, 'pPr'), 'tabs'), 'tab');
    if (levelTabs.length) {
      let tabs = kid(pPr, 'tabs');
      if (!tabs) pPr.appendChild(tabs = make(doc, 'tabs'));
      tabs.prepend(...levelTabs.map((x) => x.cloneNode(true)));
    }
    let numPr = kid(pPr, 'numPr');
    if (!numPr) pPr.appendChild(numPr = make(doc, 'numPr'));
    numPr.replaceChildren(make(doc, 'numId', { val: '0' }));
  }
}

/** An empty paragraph is one line of its paragraph mark's font high, as in Word (a cover's blank lines in 14 pt place its title
 * where Word does); docx-preview made it 1em of the style's size. A run holding a zero-width space carries the mark's look. */
function emptyLines(doc: Document): void {
  for (const p of all(doc, 'p')) {
    if (all(p, 't').some((t) => t.textContent) || ['drawing', 'pict', 'tab', 'ptab', 'br', 'sym', 'object'].some((n) => all(p, n).length)) continue;
    const mark = kid(kid(p, 'pPr'), 'rPr');
    const r = make(doc, 'r');
    if (mark) {
      const rPr = mark.cloneNode(true) as Element;
      for (const c of Array.from(rPr.children)) if (/^(ins|del|moveFrom|moveTo|rPrChange)$/.test(c.localName)) c.remove();
      r.appendChild(rPr);
    }
    const t = doc.createElementNS(W, 'w:t');
    t.textContent = '​';
    r.appendChild(t);
    p.appendChild(r);
  }
}

function setSpacing(doc: Document, p: Element, side: 'before' | 'after'): void {
  let pPr = kid(p, 'pPr');
  if (!pPr) p.insertBefore(pPr = make(doc, 'pPr'), p.firstChild);
  let sp = kid(pPr, 'spacing');
  if (!sp) pPr.appendChild(sp = make(doc, 'spacing'));
  sp.setAttributeNS(W, `w:${side}`, '0');
  sp.removeAttributeNS(W, `${side}Autospacing`);
}

function contextualSpacing(doc: Document, st: Styles): void {
  for (const p of all(doc, 'p')) {
    if (!isOn(inherited(p, st, 'contextualSpacing'))) continue;
    const style = styleOf(p, st);
    const same = (q: Element | null) => isW(q, 'p') && styleOf(q as Element, st) === style;
    if (same(p.previousElementSibling)) setSpacing(doc, p, 'before');
    if (same(p.nextElementSibling)) setSpacing(doc, p, 'after');
  }
}

const shows = (n: Element): boolean => (isW(n, 't') && !!(n.textContent ?? '').trim()) || isW(n, 'drawing') || isW(n, 'pict') || isW(n, 'tab');

/** What comes in `scope` before `marker`: whether anything is shown (text, a picture, a tab), and whether a page break comes
 * after the last thing shown (then the page already ends there). */
function before(doc: Document, scope: Element, marker: Element): { shown: boolean; broken: boolean } {
  const walk = doc.createTreeWalker(scope, 1 /* elements */);
  let shown = false;
  let broken = false;
  for (let n = walk.nextNode() as Element | null; n && n !== marker; n = walk.nextNode() as Element | null) {
    if (isW(n, 'br') && val(n, 'type') === 'page') broken = true;
    else if (shows(n)) [shown, broken] = [true, false];
  }
  return { shown, broken };
}

/** Whether the page ends after this block of the body (a page break at its end, or a section break). */
function endsPage(doc: Document, el: Element | null): boolean {
  if (!el) return true;
  if (!isW(el, 'p')) return false;
  if (kid(kid(el, 'pPr'), 'sectPr')) return true;
  const breaks = all(el, 'br').filter((b) => val(b, 'type') === 'page');
  return breaks.length > 0 && !shownAfter(doc, el, breaks[breaks.length - 1]);
}

function shownAfter(doc: Document, scope: Element, marker: Element): boolean {
  const walk = doc.createTreeWalker(scope, 1);
  let past = false;
  for (let n = walk.nextNode() as Element | null; n; n = walk.nextNode() as Element | null) {
    if (n === marker) past = true;
    else if (past && shows(n)) return true;
  }
  return false;
}

const startsPage = (p: Element, st: Styles): boolean => isW(p, 'p') && isOn(inherited(p, st, 'pageBreakBefore'));

const blockBefore = (el: Element): Element | null => {
  let e = el.previousElementSibling;
  while (e && !isW(e, 'p') && !isW(e, 'tbl') && !isW(e, 'sdt')) e = e.previousElementSibling;
  return e;
};

function pageBreaksAsSaved(doc: Document, st: Styles): void {
  const body = all(doc, 'body')[0];
  if (!body) return;
  const breaker = () => {
    const p = make(doc, 'p');
    const pPr = p.appendChild(make(doc, 'pPr'));
    pPr.appendChild(make(doc, 'pStyle', { val: BREAK_STYLE }));
    p.appendChild(make(doc, 'r')).appendChild(make(doc, 'br', { type: 'page' }));
    return p;
  };
  const breakBefore = (block: Element) => {
    if (!endsPage(doc, blockBefore(block)) && !startsPage(block, st)) block.before(breaker());
  };
  const breakAfter = (block: Element) => { if (!endsPage(doc, block)) block.after(breaker()); };
  breaksAtStart(doc, breakBefore);
  // in a section set in columns, Word records where a column ended the same way: those are not page breaks
  const columned = new Set<Element>();
  const columns = (sect: Element | null) => Number(val(kid(sect, 'cols'), 'num')) || 1;
  let cols = columns(kid(body, 'sectPr'));
  for (const block of Array.from(body.children).reverse()) {
    const sect = isW(block, 'p') ? kid(kid(block, 'pPr'), 'sectPr') : null;
    if (sect) cols = columns(sect);
    if (cols > 1) columned.add(block);
  }
  for (const mark of all(doc, 'lastRenderedPageBreak')) {
    let block: Element = mark;
    while (block.parentElement && block.parentElement !== body) block = block.parentElement;
    const ahead = block.parentElement === body && !columned.has(block) ? before(doc, block, mark) : null;
    if (!ahead || ahead.broken || nearest(mark, 'txbxContent')) { mark.remove(); continue; }    // a page break of its own already ends it
    if (isW(block, 'tbl')) {
      const rows = kids(block, 'tr');
      const row = rows.find((r) => r.contains(mark));
      const at = row ? rows.indexOf(row) + (before(doc, row, mark).shown ? 1 : 0) : rows.length;
      if (at <= 0) breakBefore(block);
      else if (at >= rows.length) breakAfter(block);
      else {                                              // the rest of the table goes on the next page
        const rest = block.cloneNode(false) as Element;
        for (const c of Array.from(block.children)) if (!isW(c, 'tr')) rest.appendChild(c.cloneNode(true));
        for (let i = 0; i < at && isOn(kid(kid(rows[i], 'trPr'), 'tblHeader')); i++) rest.appendChild(rows[i].cloneNode(true));
        for (const tc of kids(rows[at], 'tc')) {           // a cell merged down from the first part starts its own merge
          const merge = kid(kid(tc, 'tcPr'), 'vMerge');
          if (merge && (val(merge) ?? 'continue') === 'continue') merge.setAttributeNS(W, 'w:val', 'restart');
        }
        for (const r of rows.slice(at)) rest.appendChild(r);
        block.after(breaker(), rest);
      }
    } else if (ahead.shown) breakAfter(block);                       // split over two pages in Word: whole on the first here
    else breakBefore(block);
    mark.remove();
  }
}

/**
 * Sections as Word lays them out. A section that names no header or footer of a kind has its previous section's (docx-preview
 * showed none). A section with a different first page (titlePg) and no first-page header shows none there (docx-preview showed
 * the usual one, on a cover page). A section that starts with a continuous break goes on on the same page (a glossary set in two
 * columns under its heading), where docx-preview started a page for every section. The first paragraph of such sections is
 * marked for `finishLayout`.
 */
function sections(doc: Document): void {
  const body = all(doc, 'body')[0];
  if (!body) return;
  const found: { sect: Element; first: Element | null }[] = [];
  let first: Element | null = null;                                         // the first block of the section being read
  for (const block of Array.from(body.children)) {
    if (isW(block, 'sectPr')) {
      found.push({ sect: block, first });
      break;
    }
    const shown = isW(block, 'tbl') || isW(block, 'sdt') || (isW(block, 'p') && val(kid(kid(block, 'pPr'), 'pStyle')) !== BREAK_STYLE);
    if (!first && shown) first = block;
    const sect = isW(block, 'p') ? kid(kid(block, 'pPr'), 'sectPr') : null;
    if (sect) {
      found.push({ sect, first });
      first = null;
    }
  }
  const mark = (block: Element | null, name: string) => {
    const p = block && (isW(block, 'p') ? block : all(block, 'p')[0]);
    if (!p) return;
    const pPr = kid(p, 'pPr');
    p.insertBefore(make(doc, 'bookmarkStart', { id: '989999', name }), pPr ? pPr.nextSibling : p.firstChild);
  };
  const ref = (sect: Element, kind: string, type: string) => kids(sect, kind).find((r) => (val(r, 'type') ?? 'default') === type);
  found.forEach(({ sect, first: start }, i) => {
    if (i > 0) {
      for (const kind of ['headerReference', 'footerReference']) for (const type of ['default', 'first', 'even']) {
        const inherited = !ref(sect, kind, type) && ref(found[i - 1].sect, kind, type);
        if (inherited) sect.insertBefore(inherited.cloneNode(true), sect.firstChild);
      }
      if (val(kid(sect, 'type')) === 'continuous') mark(start, CONTINUE);
    }
    if (kid(sect, 'titlePg') && isOn(kid(sect, 'titlePg'))) {
      if (!ref(sect, 'headerReference', 'first')) mark(start, NO_HEADER);
      if (!ref(sect, 'footerReference', 'first')) mark(start, NO_FOOTER);
    }
    const numbering = kid(sect, 'pgNumType');                              // its pages numbered from (a cover as page 0), and how
    if (val(numbering, 'start') != null || val(numbering, 'fmt')) mark(start, `${PAGE_START}${val(numbering, 'start') ?? ''}_${val(numbering, 'fmt') ?? ''}`);
  });
}

/** A table's header rows (tblHeader) are marked, so they can repeat at the top of each page and column as in Word. */
function headerRows(doc: Document): void {
  for (const tbl of all(doc, 'tbl')) {
    const rows = kids(tbl, 'tr');
    let n = 0;
    while (n < rows.length && isOn(kid(kid(rows[n], 'trPr'), 'tblHeader'))) n++;
    const p = n && n < rows.length ? all(rows[0], 'p')[0] : null;
    if (!p) continue;
    const pPr = kid(p, 'pPr');
    p.insertBefore(make(doc, 'bookmarkStart', { id: '989998', name: `${HEAD_ROWS}${n}` }), pPr ? pPr.nextSibling : p.firstChild);
  }
}

/** Containers docx-preview does not read everywhere, emptied into their parents so what they hold is shown: a simple field's
 * result (the cover's title from the document's properties), custom XML, bidirectional runs and content controls (a cell's or a
 * row's, with the "Click here to add a date" a template shows in them); inside a link, insertions and smart tags (deleted text
 * inside a link is not shown, as in Word's final view). */
function unwrap(doc: Document): void {
  const empty = (el: Element) => {
    for (const c of Array.from(el.children)) if (!/Pr$/.test(c.localName) && c.localName !== 'fldData') el.before(c);
    el.remove();
  };
  for (const name of ['fldSimple', 'customXml', 'dir', 'bdo']) for (const el of all(doc, name)) empty(el);
  for (const el of all(doc, 'sdt')) {
    const content = kid(el, 'sdtContent');
    if (content) el.before(...Array.from(content.children));
    el.remove();
  }
  for (const link of all(doc, 'hyperlink')) {
    for (const el of all(link, 'del')) el.remove();
    for (const name of ['ins', 'smartTag']) for (const el of all(link, name)) empty(el);
  }
}

/** Styles in an order where each comes after the style it is based on: docx-preview passes over them once, in file order, so
 * a style listed before its base lost what the base takes from its own base (a bullet style lost Normal's Arial). */
function baseStylesFirst(doc: Document): void {
  const root = doc.documentElement;
  const styles = kids(root, 'style');
  const byId = new Map(styles.map((s) => [val(s, 'styleId') ?? '', s]));
  const placed = new Set<Element>();
  const place = (s: Element) => {
    if (placed.has(s)) return;
    placed.add(s);
    const base = byId.get(val(kid(s, 'basedOn')) ?? '');
    if (base) place(base);
    root.appendChild(s);
  };
  styles.forEach(place);
}

function pageFields(doc: Document): void {
  const kind = (instr: string) => (/^\s*PAGE\b/i.test(instr) ? PAGE : /^\s*(NUMPAGES|SECTIONPAGES)\b/i.test(instr) ? PAGES : null);
  const show = (texts: Element[], k: string) => texts.forEach((t, i) => { t.textContent = i === 0 ? k : ''; });
  for (const f of all(doc, 'fldSimple')) {
    const k = kind(val(f, 'instr') ?? '');
    if (k) show(all(f, 't'), k);
  }
  for (const p of all(doc, 'p')) {
    const open: { instr: string; result: Element[]; shown: boolean }[] = [];
    for (const r of all(p, 'r')) for (const c of Array.from(r.children)) {
      const top = open[open.length - 1];
      if (isW(c, 'fldChar')) {
        const type = val(c, 'fldCharType');
        if (type === 'begin') open.push({ instr: '', result: [], shown: false });
        else if (type === 'separate' && top) top.shown = true;
        else if (type === 'end' && top) {
          open.pop();
          const k = kind(top.instr);
          if (k) show(top.result, k);
        }
      } else if (top && !top.shown && isW(c, 'instrText')) top.instr += c.textContent ?? '';
      else if (top && top.shown && isW(c, 't')) top.result.push(c);
    }
  }
}

const LENGTH = /^\s*(-?\d*\.?\d+)\s*(pt|px|in|cm|mm|emu)?\s*$/i;
const toPoints = (v: string | null): number | null => {
  const m = v ? LENGTH.exec(v) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return ({ px: n * PT, in: n * 72, cm: n * 72 / 2.54, mm: n * 72 / 25.4, emu: n / 12700 } as Record<string, number>)[(m[2] ?? 'pt').toLowerCase()] ?? n;
};

const vml = (el: Element, name: string): Element | undefined => Array.from(el.children).find((c) => c.namespaceURI === VML && c.localName === name);
const off = (v: string | null | undefined) => /^(f|false)$/i.test(v ?? '');

/**
 * VML shapes (Word's own drawing, and the copy of every newer shape it writes for older readers), as Word draws them. A colour
 * with a theme index ("#373e49 [3204]") is not a CSS colour: the index goes. A text box gets its outline, fill and inner margin
 * (docx-preview drew none: a red-outlined guidance box showed as loose text), and is marked for `shapes` to set as a box that
 * grows with its text when Word's does. A line (a connector or line shape) is drawn as a border: docx-preview drew nothing.
 */
function vmlShapes(doc: Document): void {
  for (const el of Array.from(doc.getElementsByTagNameNS(VML, '*'))) for (const name of ['fillcolor', 'strokecolor', 'color', 'color2']) {
    const v = el.getAttribute(name);
    if (v && /\[\d+\]/.test(v)) el.setAttribute(name, v.replace(/\s*\[\d+\]/g, '').trim());
  }
  for (const box of Array.from(doc.getElementsByTagNameNS(VML, 'textbox'))) {
    const s = box.parentElement;
    if (!s || s.namespaceURI !== VML) continue;
    const stroke = vml(s, 'stroke');
    const fill = vml(s, 'fill');
    const line = off(s.getAttribute('stroked')) || off(stroke?.getAttribute('on')) ? 'none'
      : `${toPoints(s.getAttribute('strokeweight') ?? stroke?.getAttribute('weight') ?? null) ?? 0.75}pt solid ${(s.getAttribute('strokecolor') ?? stroke?.getAttribute('color') ?? 'black').trim().split(/\s+/)[0]}`;
    const background = off(s.getAttribute('filled')) || off(fill?.getAttribute('on')) ? 'transparent'
      : (s.getAttribute('fillcolor') ?? fill?.getAttribute('color') ?? 'white').trim().split(/\s+/)[0];
    const inset = (box.getAttribute('inset') ?? '').split(',');
    const pad = [7.2, 3.6, 7.2, 3.6].map((d, i) => `${toPoints(inset[i]?.trim() || null) ?? d}pt`);       // Word's 0.1" and 0.05"
    const fit = /mso-fit-shape-to-text:\s*t/i.test(box.getAttribute('style') ?? '') ? 'fit' : 'fixed';
    const style = (s.getAttribute('style') ?? '').replace(/;\s*$/, '');
    s.setAttribute('style', `${style};border:${line};background:${background};padding:${pad[1]} ${pad[2]} ${pad[3]} ${pad[0]};box-sizing:border-box;--wv-box:${fit}`);
  }
  vmlLines(doc);
}

function vmlLines(doc: Document): void {
  const types = new Map<string, Element>();
  for (const t of Array.from(doc.getElementsByTagNameNS(VML, 'shapetype'))) types.set(t.getAttribute('id') ?? '', t);
  for (const s of Array.from(doc.getElementsByTagNameNS(VML, 'shape'))) {
    const type = types.get((s.getAttribute('type') ?? '').replace(/^#/, ''));
    const spt = s.getAttributeNS(OFFICE, 'spt') ?? type?.getAttributeNS(OFFICE, 'spt');
    const path = (s.getAttribute('path') ?? type?.getAttribute('path') ?? '').replace(/\s/g, '');
    if (!(spt === '20' || spt === '32' || path === 'm,l21600,21600e') || /^(f|false)$/i.test(s.getAttribute('stroked') ?? '')) continue;
    const style = s.getAttribute('style') ?? '';
    const size = (name: string) => toPoints(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style)?.[1] ?? null);
    const stroke = Array.from(s.children).find((c) => c.namespaceURI === VML && c.localName === 'stroke');
    const color = (s.getAttribute('strokecolor') ?? stroke?.getAttribute('color') ?? 'black').trim().split(/\s+/)[0];
    const weight = toPoints(s.getAttribute('strokeweight') ?? stroke?.getAttribute('weight') ?? null) ?? 0.75;
    const [w, h] = [size('width'), size('height')];
    const side = h != null && h < 1 ? 'top' : w != null && w < 1 ? 'left' : null;
    if (side) s.setAttribute('style', `${style.replace(/;\s*$/, '')};border-${side}:${weight}pt solid ${color}`);
  }
}

function markTabs(doc: Document, st: Styles, lists: Lists, out: TabStop[][]): void {
  const paragraphs = new Set<Element>();
  const swap = (el: Element, ch: string) => {
    const t = doc.createElementNS(W, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = ch;
    el.replaceWith(t);
  };
  for (const t of all(doc, 'tab')) {
    if (!isW(t.parentElement, 'r')) continue;              // a w:tab in w:tabs is a tab stop, not a tab
    const p = nearest(t, 'p');
    swap(t, TAB);
    if (p) paragraphs.add(p);
  }
  for (const t of all(doc, 'ptab')) {
    if (!isW(t.parentElement, 'r')) continue;
    const align = val(t, 'alignment');
    swap(t, align === 'center' ? PTAB_CENTER : align === 'right' ? PTAB_RIGHT : TAB);
  }
  for (const p of Array.from(paragraphs)) {
    const layers = st.chain(styleOf(p, st)).map((s) => stopsOf(kid(s, 'pPr')));
    out.push(mergeStops([...layers, stopsOf(kid(listLevel(p, st, lists), 'pPr')), stopsOf(kid(p, 'pPr'))]));
    const mark = make(doc, 'bookmarkStart', { id: String(990000 + out.length), name: `${MARK}${out.length - 1}` });
    const pPr = kid(p, 'pPr');
    p.insertBefore(mark, pPr ? pPr.nextSibling : p.firstChild);
  }
}

/** The file with what docx-preview draws differently from Word put right (see the top of this file). */
export async function prepareDocx(file: Blob): Promise<Prepared> {
  const zip = await JSZip.loadAsync(file);
  const read = async (path: string): Promise<Document | null> => {
    const entry = zip.file(path);
    if (!entry) return null;
    const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  };
  const write = (path: string, doc: Document) => zip.file(path, new XMLSerializer().serializeToString(doc));
  const [stylesDoc, numberingDoc, settings] = await Promise.all([read('word/styles.xml'), read('word/numbering.xml'), read('word/settings.xml')]);
  const st = readStyles(stylesDoc);
  const lists = readNumbering(numberingDoc, st);
  const stops: TabStop[][] = [];
  // the Word version the file was made for (no setting: Word 2007) and the default table's cell margin (Word's is 0.08")
  const compat = Number(val((settings ? all(settings, 'compatSetting') : []).find((c) => val(c, 'name') === 'compatibilityMode'))) || 12;
  const tableStyle = (stylesDoc ? all(stylesDoc, 'style') : []).find((s) => val(s, 'type') === 'table' && /^(1|true|on)$/i.test(val(s, 'default') ?? ''));
  const cellMargin = Number(val(kid(kid(kid(tableStyle, 'tblPr'), 'tblCellMar'), 'left'), 'w') ?? 108) || 0;
  for (const doc of [stylesDoc, numberingDoc]) if (doc) latinFonts(doc);           // first: list numbers copy their fonts
  for (const path of Object.keys(zip.files).filter((p) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))) {
    const doc = await read(path);
    if (!doc) continue;
    latinFonts(doc);
    plainContents(doc, st);
    defaultStyle(doc, st);
    numberingRemoved(doc, st);
    listLevels(doc, st);
    autoColourOnDark(doc, st);
    tables(doc, compat, cellMargin);
    defaultTableStyle(doc, val(tableStyle, 'styleId'));
    contextualSpacing(doc, st);
    if (path === 'word/document.xml') {
      pageBreaksAsSaved(doc, st);
      sections(doc);
      numbers(doc, st, lists);                         // after the page breaks: a number is shown text to them
    }
    if (/header|footer/.test(path)) pageFields(doc);
    unwrap(doc);
    vmlShapes(doc);
    headerRows(doc);
    emptyLines(doc);                                   // last: a blank line's space is shown text to the page breaks
    markTabs(doc, st, lists, stops);
    write(path, doc);
  }
  for (const [path, doc] of [['word/styles.xml', stylesDoc], ['word/numbering.xml', numberingDoc]] as const) {
    if (!doc) continue;
    if (doc === stylesDoc) {
      listLevels(doc, st);
      baseStylesFirst(doc);
    }
    write(path, doc);
  }
  const defaultTab = points(val(settings ? all(settings, 'defaultTabStop')[0] : null)) ?? 36;
  const fontTable = await read('word/fontTable.xml');
  const fonts: Record<string, string> = {};
  for (const f of fontTable ? all(fontTable, 'font') : []) {
    const stand = STAND_INS[val(kid(f, 'family')) ?? ''];
    if (stand && val(f, 'name')) fonts[val(f, 'name')!] = stand;
  }
  return { file: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), stops, defaultTab, fonts, compat };
}

const STAND_INS: Record<string, string> = { swiss: 'Arial, sans-serif', roman: '"Times New Roman", serif', modern: '"Courier New", monospace', script: 'cursive' };

/** A font the computer does not have is set in a font of its kind, as Word substitutes it (a sans-serif corporate font in Arial),
 * not in the browser's default serif. */
function fontStandIns(styles: HTMLElement, body: HTMLElement, fonts: Record<string, string>): void {
  const generic = /(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i;
  const first = (list: string) => list.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const more = (list: string) => (generic.test(list) || !fonts[first(list)] ? list : `${list}, ${fonts[first(list)]}`);
  for (const s of Array.from(styles.querySelectorAll('style'))) {
    const css = s.textContent ?? '';
    const done = css
      .replace(/(--docx-[\w-]+-font):\s*([^;}]+)/g, (_m, name: string, font: string) => `${name}: "${font.trim().replace(/"/g, '')}", ${fonts[font.trim()] ?? 'sans-serif'}`)
      .replace(/font-family:\s*([^;}]+)/g, (_m, list: string) => `font-family: ${more(list.trim())}`);
    if (done !== css) s.textContent = done;
  }
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('[style*="font-family"]'))) {
    if (el.style.fontFamily) el.style.fontFamily = more(el.style.fontFamily);
  }
}

// ── after drawing ──────────────────────────────────────────────────────────────
/**
 * Paragraphs as Word sets them. Word's single line is as tall as the font makes it (CSS "normal"), not one em, and its line
 * spacing is a multiple of that. A list number sits in the hanging indent and the text starts at the indent, where Word's tab
 * after the number puts it.
 */
function paragraphs(styles: HTMLElement, body: HTMLElement): void {
  for (const s of Array.from(styles.querySelectorAll('style'))) {
    const css = s.textContent ?? '';
    const scaled = css.replace(/line-height:\s*(\d*\.?\d+)\s*;/g, 'line-height: calc($1 * var(--wv-lh, 1));');
    if (scaled !== css) s.textContent = scaled;
  }
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('[style*="line-height"]'))) {
    if (/^\d*\.?\d+$/.test(el.style.lineHeight)) el.style.lineHeight = `calc(${el.style.lineHeight} * var(--wv-lh, 1))`;
  }
  const all = Array.from(body.querySelectorAll<HTMLElement>('p'));       // read them all, then change them all
  const looks = all.map((p) => {
    const text = getComputedStyle(Array.from(p.querySelectorAll('span')).find((s) => s.textContent?.trim()) ?? p);
    const own = getComputedStyle(p);
    return {
      family: text.fontFamily,
      // a line is as tall as its text: the paragraph takes its text's size, or its style's larger size would set every line's
      // height (table text in 8 pt in a 10 pt style stood a third taller than in Word)
      size: Math.abs(parseFloat(text.fontSize) - parseFloat(own.fontSize)) > 0.5 ? text.fontSize : null,
      hang: p.className.includes('-num-') ? -parseFloat(own.textIndent) || 0 : 0,
      empty: !p.textContent && !p.querySelector('img, svg, canvas, table'),
    };
  });
  const lines = looks.map((l) => lineRatio(l.family));
  all.forEach((p, i) => {
    p.style.setProperty('--wv-lh', lines[i].toFixed(3));
    if (looks[i].size) p.style.fontSize = looks[i].size!;
    if (looks[i].empty) p.classList.add('wv-empty');                      // an empty paragraph is a line high, as in Word
    if (looks[i].hang > 0) {
      p.classList.add('wv-hang');
      p.style.setProperty('--wv-hang', `${looks[i].hang}px`);
    }
  });
}

/** Sections as `sections` marked them: one that goes on on the same page is put back on the page before it, and a first page
 * with no header or footer of its own shows none. */
function sectionPages(body: HTMLElement): void {
  for (const mark of Array.from(body.querySelectorAll(`span[id="${CONTINUE}"]`))) {
    const page = mark.closest('section.docx');
    const before = page?.previousElementSibling;
    const last = before ? (Array.from(before.children).filter((c) => c.tagName === 'ARTICLE').pop() as HTMLElement | undefined) : null;
    if (!page || !last) continue;
    last.style.marginBottom = '0';                                           // only the last part pushes the footer down
    last.after(...Array.from(page.children).filter((c) => c.tagName !== 'HEADER' && c.tagName !== 'FOOTER'));
    page.remove();
  }
  for (const [name, tag] of [[NO_HEADER, 'header'], [NO_FOOTER, 'footer']]) {
    for (const mark of Array.from(body.querySelectorAll(`span[id="${name}"]`))) {
      const part = mark.closest('section.docx')?.querySelector(`:scope > ${tag}`);
      if (part) part.replaceChildren();                                      // its space stays, as Word keeps the margins
    }
  }
}

/** Header rows go into the table's head, which the browser repeats at the top of each column; `paginate` repeats it on each page. */
function tableHeads(body: HTMLElement): void {
  for (const mark of Array.from(body.querySelectorAll(`span[id^="${HEAD_ROWS}"]`))) {
    const table = mark.closest('table');
    const n = Number(mark.id.slice(HEAD_ROWS.length));
    const rows = table ? Array.from(table.children).filter((c) => c.tagName === 'TR') : [];
    if (!table || !n || rows.length <= n || table.querySelector(':scope > thead')) continue;
    const head = document.createElement('thead');
    head.append(...rows.slice(0, n));
    table.insertBefore(head, rows[n]);
  }
}

/** A list number has its paragraph's look (the style's font, size, weight; not its underline), as Word draws it, its list
 * level's look over it: docx-preview gave a heading's "4.3." the body text's size and weight. */
function numberLooks(styles: HTMLElement): void {
  const css = Array.from(styles.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  const rules: string[] = [];
  for (const m of Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    const style = m[1].split(',').map((s) => s.trim()).map((s) => /^p\.(docx_[\w-]+) span$/.exec(s)?.[1]).find(Boolean);
    const decls = m[2].split(';').map((d) => d.trim()).filter((d) => d && !/^(min-height|text-decoration)/.test(d));
    if (style && decls.length) rules.push(`:where(p.${style})::before { ${decls.join('; ')} }`);
  }
  if (!rules.length) return;
  const el = document.createElement('style');
  el.textContent = rules.join('\n');
  styles.prepend(el);
}

/**
 * Shapes placed as Word places them. A text box becomes a box of its own (docx-preview drew it inside an SVG, clipped and with no
 * outline), growing with its text when Word's does. Then each shape is measured from what Word measures it from: the margin or
 * the column (docx-preview's left:0 was the page's edge), the page, the top margin, or its paragraph's top, above the space
 * before it (the rule under a letterhead sat a few points low, through the footer's text); centred and right-aligned shapes are
 * set in that frame.
 */
function shapes(body: HTMLElement): void {
  const boxes: HTMLElement[] = [];
  for (const svg of Array.from(body.querySelectorAll<SVGElement>('svg'))) {
    const style = svg.getAttribute('style') ?? '';
    const content = /--wv-box/.test(style) ? svg.querySelector('foreignObject') : null;
    if (!content) continue;
    const box = document.createElement('div');
    box.setAttribute('style', style);
    box.dataset.vml = style;                     // the browser drops Word's own placement properties once the style is changed
    if (/--wv-box:\s*fit/.test(style)) {                                     // Word grows it with its text
      box.style.minHeight = box.style.height;
      box.style.height = 'auto';
    } else {
      box.style.overflow = 'hidden';                                         // Word cuts off what does not fit
      boxes.push(box);
    }
    box.append(...Array.from(content.childNodes));
    svg.replaceWith(box);
  }
  // ...but not text Word fitted in it: the browser's lines can be a little taller, so a box is made tall enough for its last
  // written line (blank lines after it stay cut off, as in Word)
  const needs = boxes.map((box) => {
    const last = Array.from(box.querySelectorAll('p')).reverse().find((p) => p.textContent?.replace(/​/g, '').trim());
    if (!last) return 0;
    const look = getComputedStyle(box);
    const need = last.getBoundingClientRect().bottom - box.getBoundingClientRect().top + (parseFloat(look.paddingBottom) || 0) + (parseFloat(look.borderBottomWidth) || 0);
    return need > box.offsetHeight + 0.5 ? need : 0;
  });
  boxes.forEach((box, i) => { if (needs[i]) box.style.height = `${needs[i]}px`; });
  const of = (style: string, name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\w-]+)`).exec(style)?.[1];
  const placed = Array.from(body.querySelectorAll<HTMLElement>('p svg, p div')).filter((el) => el.style.position === 'absolute');
  const plans = placed.map((el) => {                                         // read everything, then move them
    const style = el.dataset.vml ?? el.getAttribute('style') ?? '';
    const page = el.closest('section.docx') as HTMLElement | null;
    const look = page ? getComputedStyle(page) : null;
    const p = el.closest('p');
    return {
      el, style,
      h: of(style, 'mso-position-horizontal-relative') ?? 'text', align: of(style, 'mso-position-horizontal') ?? 'absolute',
      v: of(style, 'mso-position-vertical-relative') ?? 'text', valign: of(style, 'mso-position-vertical') ?? 'absolute',
      page: page ? page.getBoundingClientRect() : null, box: el.getBoundingClientRect(),
      left: parseFloat(look?.paddingLeft ?? '') || 0, right: parseFloat(look?.paddingRight ?? '') || 0, top: parseFloat(look?.paddingTop ?? '') || 0,
      before: p ? parseFloat(getComputedStyle(p).marginTop) || 0 : 0,
    };
  });
  for (const s of plans) {
    if (!s.page) continue;
    const fromPage = s.h === 'page';
    const frame = fromPage ? [0, s.page.width] : [s.left, s.page.width - s.right];
    if (s.align === 'center' || s.align === 'right' || s.align === 'left') {
      const x = s.align === 'center' ? (frame[0] + frame[1] - s.box.width) / 2 : s.align === 'right' ? frame[1] - s.box.width : frame[0];
      s.el.style.left = `${x}px`;
      s.el.style.marginLeft = '0';
    } else if (!s.el.closest('td')) {                // from its frame, not from wherever its anchor sits in the line
      s.el.style.left = `calc(${s.el.style.left || '0px'} + ${fromPage ? 0 : s.left}px)`;
    }
    if (s.v === 'page' || s.v === 'margin') {
      const origin = s.v === 'page' ? 0 : s.top;
      const span = s.v === 'page' ? s.page.height : s.page.height - s.top - (parseFloat(getComputedStyle(s.el.closest('section.docx')!).paddingBottom) || 0);
      const y = s.valign === 'center' ? origin + (span - s.box.height) / 2 : s.valign === 'bottom' ? origin + span - s.box.height : s.valign === 'top' ? origin : null;
      s.el.style.top = y != null ? `${y}px` : `calc(${origin}px + ${s.el.style.marginTop || '0px'})`;
      s.el.style.marginTop = '0';
    } else if (s.before) {
      s.el.style.marginTop = `calc(${s.el.style.marginTop || '0px'} - ${s.before}px)`;
    }
  }
}

/** Word leaves out a paragraph's space before at the top of a page: one it started itself, and in a file made for Word 2013 and
 * later also one after a page break typed in (a heading's 18 pt above it at the top of a chapter's page). */
function pageTops(body: HTMLElement, compat: number): void {
  const pages = Array.from(body.querySelectorAll<HTMLElement>('section.docx'));
  pages.forEach((page, i) => {
    const last = i > 0 ? pages[i - 1].querySelector(':scope > article:last-of-type')?.lastElementChild : null;
    const first = page.querySelector(':scope > article')?.firstElementChild as HTMLElement | null | undefined;
    const ownBreak = !!last?.classList.contains(`docx_${BREAK_STYLE.toLowerCase()}`);
    if (i > 0 && (ownBreak || compat >= 15) && first?.tagName === 'P') first.style.marginTop = '0';
  });
}

const keptWithNext = (el: Element): boolean => el.tagName === 'P' && /heading|title/i.test(el.className);

/**
 * A page whose content runs well past its foot is split where the content reaches the foot, as Word would: between blocks, a
 * heading kept with what follows it, a table between rows. Word records no page break inside a table of contents or on an
 * empty line, and none at all in a file it did not lay out itself. A page only a little too long is left alone: Word fitted
 * it, and the browser's lines are a little taller or shorter than Word's (`slack`, a share of the page's text height).
 */
export function paginate(body: HTMLElement, slack = 0.1): void {
  for (let round = 0; round < 200; round++) {
    const plans: { page: HTMLElement; article: HTMLElement; blocks: HTMLElement[]; from: number; rows: HTMLElement[] }[] = [];
    for (const page of Array.from(body.querySelectorAll<HTMLElement>('section.docx'))) {    // read every page, then change them
      const article = Array.from(page.children).filter((c) => c.tagName === 'ARTICLE').pop() as HTMLElement | undefined;
      const blocks = article ? (Array.from(article.children) as HTMLElement[]) : [];
      const height = parseFloat(getComputedStyle(page).minHeight) || 0;
      // text set in columns is measured as one long column: it is not split
      if (!article || blocks.length === 0 || !height || (parseInt(getComputedStyle(article).columnCount, 10) || 1) > 1) continue;
      const box = page.getBoundingClientRect();
      const below = article.nextElementSibling;                              // footnotes and the footer keep their place
      const foot = box.top + height - (below ? box.bottom - below.getBoundingClientRect().top : parseFloat(getComputedStyle(page).paddingBottom) || 0);
      const top = article.getBoundingClientRect().top;
      const bottoms = blocks.map((b) => b.getBoundingClientRect().bottom);
      if (Math.max(...bottoms) - foot <= slack * (foot - top)) continue;
      let from = bottoms.findIndex((b) => b > foot + 0.5);
      if (from < 0) continue;
      let rows: HTMLElement[] = [];
      if (blocks[from].tagName === 'TABLE') {
        const trs = Array.from(blocks[from].querySelectorAll<HTMLElement>(':scope > tr, :scope > tbody > tr'));
        const fit = trs.findIndex((tr) => tr.getBoundingClientRect().bottom > foot + 0.5);
        if (fit > 0) rows = trs.slice(fit);
      }
      if (!rows.length) {
        while (from > 0 && keptWithNext(blocks[from - 1])) from--;
        if (from === 0) from = 1;                                            // taller than a page on its own: it stays
        if (from >= blocks.length) continue;
      }
      plans.push({ page, article, blocks, from, rows });
    }
    if (!plans.length) return;
    for (const { page, article, blocks, from, rows } of plans) {
      const next = page.cloneNode(false) as HTMLElement;
      let content: HTMLElement | null = null;
      for (const c of Array.from(page.children)) {
        if (c.tagName === 'HEADER' || c.tagName === 'FOOTER') next.appendChild(c.cloneNode(true));
        else if (c === article) content = next.appendChild(article.cloneNode(false) as HTMLElement);
      }
      if (!content) continue;
      if (rows.length) {
        const table = blocks[from];
        const rest = table.cloneNode(false) as HTMLElement;
        for (const keep of Array.from(table.querySelectorAll(':scope > colgroup, :scope > thead'))) rest.appendChild(keep.cloneNode(true));   // header rows repeat
        for (const tr of rows) rest.appendChild(tr);
        content.appendChild(rest);
      }
      const moved = blocks.slice(rows.length ? from + 1 : from);
      for (const b of moved) content.appendChild(b);
      if (!rows.length && moved[0]?.tagName === 'P') moved[0].style.marginTop = '0';     // Word's own page break: no space before
      page.after(next);
    }
  }
}

/** Each page's own number (a section may start its pages again, as page 0 for a cover, or count them in roman numerals); the
 * number of pages is all of them, as Word counts them. */
function pageNumbers(body: HTMLElement): void {
  const pages = Array.from(body.querySelectorAll<HTMLElement>('section.docx'));
  let n = 0;
  let format: string | null = null;
  for (const page of pages) {
    const restart = page.querySelector(`article span[id^="${PAGE_START}"]`);
    const [start, fmt] = restart ? restart.id.slice(PAGE_START.length).split('_') : [];
    n = start ? Number(start) : n + 1;
    format = fmt || (restart ? null : format);
    const walk = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode() as Text | null; t; t = walk.nextNode() as Text | null) {
      if (t.data.includes(PAGE) || t.data.includes(PAGES)) t.data = t.data.split(PAGE).join(formatNumber(n, format)).split(PAGES).join(String(pages.length));
    }
  }
}

interface TabSpan { span: HTMLElement; ptab: string | null }

function layOutTabs(body: HTMLElement, prepared: Prepared): void {
  const texts: Text[] = [];
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) if (/[\uE000\uE003\uE004]/.test(n.data)) texts.push(n);
  const byParagraph = new Map<HTMLElement, TabSpan[]>();
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    const spans: TabSpan[] = [];
    for (const piece of t.data.split(/([\uE000\uE003\uE004])/)) {
      if (!piece) continue;
      if (piece === TAB || piece === PTAB_CENTER || piece === PTAB_RIGHT) {
        const span = document.createElement('span');
        span.className = 'wv-tab';
        frag.appendChild(span);
        spans.push({ span, ptab: piece === TAB ? null : piece });
      } else frag.appendChild(document.createTextNode(piece));
    }
    const p = t.parentElement?.closest('p') as HTMLElement | null;
    const run = t.parentElement;
    t.replaceWith(frag);
    if (p) byParagraph.set(p, [...(byParagraph.get(p) ?? []), ...spans]);
    // a run that holds only tabs does not make its line taller (Word sets a contents line by its text, not by the tab's font)
    if (run && run !== p && Array.from(run.childNodes).every((n) => (n as Element).classList?.contains('wv-tab') || !(n.textContent ?? '').trim())) {
      run.style.lineHeight = '0';
    }
  }
  if (!byParagraph.size) return;

  const paragraphs = Array.from(byParagraph.keys());
  const stopsOfP = paragraphs.map((p) => {
    const mark = Array.from(p.children).find((c) => c.id.startsWith(MARK));
    return mark ? prepared.stops[Number(mark.id.slice(MARK.length))] ?? [] : [];
  });
  // measured as Word measures them, from the left: a centred or right-aligned paragraph is set left while its tabs are laid out
  const looks = paragraphs.map((p) => getComputedStyle(p));
  const rtl = looks.map((cs) => cs.direction === 'rtl');
  const aligned = paragraphs.map((p, i) => (!rtl[i] && looks[i].textAlign !== 'left' && looks[i].textAlign !== 'start' ? p.style.textAlign : null));
  paragraphs.forEach((p, i) => { if (aligned[i] !== null) p.style.textAlign = 'left'; });
  const margins = looks.map((cs) => parseFloat(cs.marginLeft) || 0);
  const hanging = looks.map((cs) => (parseFloat(cs.textIndent) || 0) < 0);

  const widths = new Map<string, number>();
  const charWidth = (span: HTMLElement, ch: string) => {
    const cs = getComputedStyle(span);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let w = widths.get(font + ch);
    if (w == null) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = font;
      w = ctx ? ctx.measureText(ch).width * PT : 0;
      widths.set(font + ch, w);
    }
    return w;
  };

  const most = Math.max(...paragraphs.map((p) => byParagraph.get(p)!.length));
  for (let k = 0; k < most; k++) {
    const plan: { span: HTMLElement; width: number; leader: string; line: boolean }[] = [];
    paragraphs.forEach((p, i) => {                                   // read everything first, then write: one layout per round
      const tabs = byParagraph.get(p)!;
      const tab = tabs[k];
      if (!tab) return;
      if (rtl[i]) { plan.push({ span: tab.span, width: 24, leader: 'none', line: false }); return; }
      const pr = p.getBoundingClientRect();
      const left = pr.left - margins[i];
      const sr = tab.span.getBoundingClientRect();
      const x = (sr.left - left) * PT;
      const column = (pr.width + margins[i] + (parseFloat(looks[i].marginRight) || 0)) * PT;
      const stop: TabStop = tab.ptab === PTAB_CENTER ? { pos: column / 2, kind: 'center', leader: 'none' }
        : tab.ptab === PTAB_RIGHT ? { pos: column, kind: 'right', leader: 'none' }
          : nextStop(x, stopsOfP[i], prepared.defaultTab, hanging[i] ? margins[i] * PT : null);
      let after = 0;
      let toDecimal = 0;
      if (stop.kind === 'right' || stop.kind === 'center' || stop.kind === 'decimal') {
        const range = document.createRange();
        range.setStartAfter(tab.span);
        if (tabs[k + 1]) range.setEndBefore(tabs[k + 1].span);
        else range.setEnd(p, p.childNodes.length);
        const line = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.top < sr.bottom && r.bottom > sr.bottom - 1);
        if (line.length) after = (Math.max(...line.map((r) => r.right)) - Math.min(...line.map((r) => r.left))) * PT;
        toDecimal = after;
        if (stop.kind === 'decimal') {
          const text = range.toString();
          const dot = text.indexOf('.');
          if (dot >= 0) toDecimal = after * (dot / Math.max(1, text.length));
        }
      }
      const run = tab.span.parentElement;
      plan.push({
        span: tab.span,
        width: tabWidth(stop, x, after, toDecimal),
        leader: stop.leader,
        line: !!run && getComputedStyle(run).textDecorationLine.includes('underline'),
      });
    });
    for (const t of plan) {
      t.span.style.width = `${t.width.toFixed(2)}pt`;
      const ch = LEADERS[t.leader];
      if (ch) t.span.textContent = leaderText(t.leader, t.width, charWidth(t.span, ch));
      if (t.line) t.span.style.borderBottom = '1px solid currentColor';
    }
  }
  paragraphs.forEach((p, i) => { if (aligned[i] !== null) p.style.textAlign = aligned[i] ?? ''; });
  for (const p of paragraphs) for (const t of byParagraph.get(p)!) t.span.style.height = 'auto';
}

/** After docx-preview has drawn the prepared file, at full size: lines, list numbers, tabs and page numbers as Word sets them. */
export function finishLayout(body: HTMLElement, styles: HTMLElement, prepared: Prepared, slack?: number): void {
  numberLooks(styles);
  fontStandIns(styles, body, prepared.fonts);                    // first: the line heights below are measured in these fonts
  paragraphs(styles, body);
  layOutTabs(body, prepared);
  shapes(body);
  sectionPages(body);
  tableHeads(body);
  pageTops(body, prepared.compat);
  paginate(body, slack);
  pageNumbers(body);
}

/** CSS for what `finishLayout` adds. */
export const FIDELITY_CSS = `
  .docx p.docx_${BREAK_STYLE.toLowerCase()} { display: none; }
  .docx .wv-tab { display: inline-block; height: 1em; min-height: 0; text-indent: 0; text-align: center; white-space: pre; letter-spacing: 0; overflow: visible; }
  .docx p.wv-hang::before { display: inline-block; min-width: var(--wv-hang); text-indent: 0; }
  .docx p.wv-empty::after { content: "\\200b"; }
  section.docx > footer { display: flex; flex-direction: column; justify-content: flex-end; }   /* Word sets it up from its foot */
  section.docx { isolation: isolate; }      /* a shape "behind text" is behind the text, not behind the page */
`;
