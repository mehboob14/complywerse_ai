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
const LABEL_STYLE = 'WvLabel';             // the run of a list number or bullet that `numbers` wrote in
const CONTINUE = '_wvContinue';            // a bookmark opening a section that goes on on the same page (a continuous break)
const NO_HEADER = '_wvNoHeader';           // ...a section whose first page has no header / no footer (titlePg, none given)
const NO_FOOTER = '_wvNoFooter';
const HEAD_ROWS = '_wvHead';               // ...a table whose first rows repeat on each page (+ how many)
const PAGE_START = '_wvPageStart';         // ...a section that numbers its pages its own way (+ start_format)
const SECTION = '_wvSect';                 // ...the first block of a section (+ its index)
const PART = '_wvPart_';                   // ...a header or footer part (+ its file name)
const TEMPLATE = '_wvTemplate';            // ...a page drawn only to have a header or footer to copy
const ANCHOR = '_wvAnchor';                // ...a picture Word places itself (+ the index of its placement)
const EXACT_ROW = '_wvExact';              // ...a table row of exact height
const WHOLE_ROW = '_wvWhole';              // ...a table row Word does not break over two pages
const GOES_ON = '_wvGoesOn';               // ...the first part of a paragraph split over two pages
const FLOW = '_wvFlow_';                   // ...how a paragraph may break over pages (+ n keep with next, l keep lines, w widows)
const SPLIT_AT = 'wv-split';               // a recorded page break inside a paragraph's text, where `splitParagraphs` splits it
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const EMU = 9525;                          // EMUs (DrawingML) to CSS pixels
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
  /** each section's headers and footers by kind (default, first, even: the part's file name) and its different first page */
  sections: SectionParts[];
  /** different headers and footers on even pages (Word's setting for the whole document) */
  evenAndOdd: boolean;
  /** how Word places each floating picture */
  anchors: Anchor[];
  /** whether Word laid the file out and recorded its page breaks (then a page only a little too long is Word's) */
  saved: boolean;
}

export interface SectionParts {
  titlePg: boolean;
  header: Record<string, string>;
  footer: Record<string, string>;
}

/** Where a floating picture goes (offsets in CSS pixels): from what frame, aligned in it or at an offset. */
export interface Placement { from: string; align: string | null; offset: number }

export interface Anchor {
  h: Placement;
  v: Placement;
  /** Word's wrapping: None, Square, Tight, Through, TopAndBottom; and on which sides text may go */
  wrap: string;
  side: string;
  behind: boolean;
  /** Word's stacking order: a higher one is drawn over a lower one */
  z: number;
  /** the space kept clear around it (top, bottom, left, right) and its size, in CSS pixels */
  dist: number[];
  width: number;
  height: number;
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
  /** the document's default paragraph properties (docDefaults) */
  defaults: Element | null;
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
  const defaults = doc ? kid(all(doc, 'pPrDefault')[0] ?? null, 'pPr') : null;
  return { chain, prop, colour, defaultPara, hyperlink, defaults };
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

// What a character of a symbol font draws, as Unicode (the studio's editor uses the same tables): Symbol's characters by its
// encoding from 0x20 and from 0xA0, and Wingdings' bullets and signs. The same code is a different sign in each font (0xE0 is
// Symbol's lozenge and Wingdings' arrow): a table that ignored the font turned a Symbol lozenge into an arrow.
const SYMBOL_LOW = ' !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼';
const SYMBOL_HIGH = '€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪ 〉∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭';
const WINGDINGS: Record<number, string> = {
  0x21: '✏', 0x22: '✂', 0x28: '☎', 0x2A: '✉', 0x36: '⌛', 0x3E: '✇', 0x3F: '✍', 0x41: '✌', 0x45: '☜', 0x46: '☞', 0x47: '☝',
  0x48: '☟', 0x4A: '☺', 0x4C: '☹', 0x4E: '☠', 0x51: '✈', 0x52: '☼', 0x54: '❄', 0x56: '✞', 0x58: '✠', 0x59: '✡', 0x5A: '☪',
  0x5B: '☯', 0x5D: '☸', 0x6C: '●', 0x6D: '❍', 0x6E: '■', 0x6F: '□', 0x71: '❑', 0x72: '❒', 0x73: '⬧', 0x74: '⧫', 0x75: '◆',
  0x76: '❖', 0x77: '⬥', 0x78: '⌧', 0x7A: '⌘', 0x7B: '❀', 0x7C: '✿', 0x7D: '❝', 0x7E: '❞', 0x9E: '·', 0x9F: '•', 0xA0: '▪',
  0xA1: '○', 0xA4: '◉', 0xA5: '◎', 0xA7: '▪', 0xA8: '◻', 0xAA: '✦', 0xAB: '★', 0xAC: '✶', 0xAD: '✴', 0xAE: '✹', 0xAF: '✵',
  0xB2: '⟡', 0xD8: '➢', 0xE0: '→', 0xE8: '➔', 0xEF: '⇦', 0xF0: '⇨', 0xF1: '⇧', 0xF2: '⇩', 0xF3: '⬄', 0xFA: '▫', 0xFB: '✗',
  0xFC: '✓', 0xFD: '☒', 0xFE: '☑',
};

// a private-range bullet whose font is not named: the usual bullets of either font
const COMMON: Record<number, string> = {
  0xB7: '•', 0xA7: '▪', 0xD8: '➢', 0xFC: '✓', 0x76: '❖', 0x6E: '■', 0x71: '❑', 0xA8: '◻', 0x6C: '●', 0x9F: '•', 0xE8: '➔',
  0xF0: '⇨', 0xFB: '✗', 0xFE: '☑',
};

/** The Unicode twin of a character set in a symbol font (its code in the font's private range F0xx, or as 00xx), or null: in
 * Symbol by its encoding, in Wingdings by the table; a private-range character in any other font is the usual bullet of that
 * code, else read as Symbol's. */
export function symbolTwin(font: string, ch: string): string | null {
  const cp = ch.codePointAt(0) ?? 0;
  const code = cp >= 0xF000 && cp <= 0xF0FF ? cp - 0xF000 : cp;
  if (code > 0xFF) return null;
  const face = font.trim().toLowerCase();
  if (face === 'wingdings') return WINGDINGS[code] ?? null;
  if (face !== 'symbol' && (cp < 0xF000 || /dings/.test(face))) return null;
  if (face !== 'symbol' && COMMON[code]) return COMMON[code];
  const twin = code >= 0x20 && code <= 0x7E ? SYMBOL_LOW[code - 0x20] : code >= 0xA0 && code <= 0xFE ? SYMBOL_HIGH[code - 0xA0] : undefined;
  return twin && twin !== ' ' ? twin : null;
}

const drawable = new Map<string, boolean>();

/** Whether this computer draws `ch` in `font` itself (Windows has Symbol and Wingdings): then it is shown in that font, Word's
 * own glyph. Measured once: the font draws it when its width is the same whatever follows the font in the list, and is not
 * the fallback's. */
function canDraw(font: string, ch: string): boolean {
  const key = `${font}\n${ch}`;
  let ok = drawable.get(key);
  if (ok == null) {
    ok = false;
    const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) {
      const name = font.replace(/"/g, '');
      const width = (stack: string) => { ctx.font = `40px ${stack}`; return ctx.measureText(ch).width; };
      const own = width(`"${name}", monospace`);
      ok = own > 0 && own === width(`"${name}", serif`) && own !== width('monospace');
    }
    drawable.set(key, ok);
  }
  return ok;
}

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

/**
 * Tracked changes as Word's final view shows them (No Markup, the file as it reads once they are accepted): deleted and
 * moved-away text left out, inserted and moved-in text kept, the old formatting a change remembers dropped, a deleted row
 * left out, and a paragraph whose mark was deleted joined to the next one, which keeps its own look (docx-preview kept such
 * a paragraph as a line of its own: an empty line in a draft where Word shows none).
 */
function acceptChanges(doc: Document): void {
  const inMark = (el: Element) => isW(el.parentElement, 'rPr') || isW(el.parentElement, 'trPr');
  for (const name of ['del', 'moveFrom']) for (const el of all(doc, name)) if (!inMark(el)) el.remove();
  for (const name of ['ins', 'moveTo']) for (const el of all(doc, name)) {
    if (inMark(el)) el.remove();                                       // an inserted mark or row stays as it is
    else el.replaceWith(...Array.from(el.childNodes));
  }
  for (const name of ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'numberingChange',
    'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) for (const el of all(doc, name)) el.remove();
  for (const tr of all(doc, 'tr')) if (kid(kid(tr, 'trPr'), 'del')) tr.remove();
  for (const p of all(doc, 'p')) {
    const marks = [kid(kid(kid(p, 'pPr'), 'rPr'), 'del'), kid(kid(kid(p, 'pPr'), 'rPr'), 'moveFrom')].filter(Boolean) as Element[];
    if (!marks.length) continue;
    marks.forEach((m) => m.remove());
    const next = p.nextElementSibling;
    if (!next || !isW(next, 'p') || kid(kid(p, 'pPr'), 'sectPr')) continue;
    const own = kid(next, 'pPr');
    const at = own ? own.nextSibling : next.firstChild;               // after the next paragraph's properties, before its text
    for (const c of Array.from(p.childNodes)) if (!(c.nodeType === 1 && isW(c as Element, 'pPr'))) next.insertBefore(c, at);
    p.remove();
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

/** How Word may break each paragraph of the body over pages, for `paginate`: kept with the next one, its lines kept together,
 * and widow and orphan control (at least two lines at the foot and at the top of a page), each from the paragraph, its style
 * or the document's defaults. Marked only where one of them is on. The paragraphs of a table's cells too, for a row broken
 * over pages (`rowBreak`): their lines kept together, and widow control in a file for Word 2013 and later (Word moved a row
 * whose two lines would have been split there; a Word 2010 file's cell gave one line to each page). */
function flowMarks(doc: Document, st: Styles, compat: number): void {
  const body = all(doc, 'body')[0];
  const cells = body ? kids(body, 'tbl').flatMap((t) => kids(t, 'tr')).flatMap((r) => kids(r, 'tc')).flatMap((c) => kids(c, 'p')) : [];
  for (const p of body ? [...kids(body, 'p'), ...cells] : []) {
    const inCell = isW(p.parentElement, 'tc');
    const setting = (name: string) => inherited(p, st, name) ?? kid(st.defaults, name);
    const widows = setting('widowControl');                    // on unless the file turns it off, as Word has it
    const flags = `${!inCell && isOn(setting('keepNext')) ? 'n' : ''}${isOn(setting('keepLines')) ? 'l' : ''}${(!widows || isOn(widows)) && (!inCell || compat >= 15) ? 'w' : ''}`;
    if (flags) p.insertBefore(make(doc, 'bookmarkStart', { id: '989992', name: `${FLOW}${flags}` }), kid(p, 'pPr')?.nextSibling ?? p.firstChild);
  }
}

/** In a table, a paragraph's own style sets what it sets over the table style, as Word resolves them (document defaults, then
 * the table style, then the paragraph's style, then its own formatting); docx-preview's sheet let the table style win, so a
 * platform-made table stood in single lines where Word sets Normal's 1.15 (four pages too few in 36). The style's spacing and
 * alignment are written onto such paragraphs, under what they set themselves, a setting's related attributes together (before
 * or beforeLines; line with its rule). Not its indents: a list level's indent ranks above the style's, and a paragraph whose
 * numbering is taken off is set at the margin (`numberingRemoved`). */
const SETTINGS: Record<string, string[][]> = {
  spacing: [['before', 'beforeLines', 'beforeAutospacing'], ['after', 'afterLines', 'afterAutospacing'], ['line', 'lineRule']],
  jc: [['val']],
};
function tableParagraphs(doc: Document, st: Styles): void {
  for (const p of all(doc, 'p')) {
    if (!nearest(p, 'tc')) continue;
    const chain = st.chain(styleOf(p, st));
    for (const [name, groups] of Object.entries(SETTINGS)) {
      const set = chain.map((s) => kid(kid(s, 'pPr'), name)).filter(Boolean) as Element[];      // base first
      if (!set.length) continue;
      let pPr = kid(p, 'pPr');
      if (!pPr) p.insertBefore(pPr = make(doc, 'pPr'), p.firstChild);
      let own = kid(pPr, name);
      if (!own) pPr.appendChild(own = make(doc, name));
      for (const styled of set.reverse()) {                                   // the nearest style first
        for (const group of groups) {
          if (group.some((a) => own!.hasAttributeNS(W, a))) continue;
          for (const a of group) if (styled.hasAttributeNS(W, a)) own.setAttributeNS(W, `w:${a}`, styled.getAttributeNS(W, a)!);
        }
      }
    }
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

/**
 * Tables sized as Word sizes them. A double border is three times its line's width (two lines and the gap between them), a
 * triple five times, as Word draws them (docx-preview drew one thin line). A table keeps the column widths Word saved with it
 * (its grid), as Word shows them, where the browser shared the width out by the cells' text; a table in a cell or text box fits
 * itself in. Rows of exact height are marked for `rowHeights`, and they and rows kept whole for `paginate`.
 */
function tableLayout(doc: Document): void {
  for (const b of Array.from(doc.getElementsByTagNameNS(W, '*'))) {
    const kind = b.getAttributeNS(W, 'val');
    const sz = b.getAttributeNS(W, 'sz');
    const border = b.localName === 'bdr' || /Borders$|^pBdr$/.test(b.parentElement?.localName ?? '');
    if (border && (kind === 'double' || kind === 'triple') && sz && /^\d+$/.test(sz)) b.setAttributeNS(W, 'w:sz', String(Number(sz) * (kind === 'double' ? 3 : 5)));
  }
  for (const tr of all(doc, 'tr')) {
    const p = all(tr, 'p')[0];
    const floating = !!kid(kid(nearest(tr, 'tbl'), 'tblPr'), 'tblpPr');       // a floating table's rows go to the next page whole
    const marks = [[val(kid(kid(tr, 'trPr'), 'trHeight'), 'hRule') === 'exact', EXACT_ROW, '989997'],
      [floating || isOn(kid(kid(tr, 'trPr'), 'cantSplit')), WHOLE_ROW, '989996']] as const;
    for (const [on, name, id] of marks) if (on && p) p.insertBefore(make(doc, 'bookmarkStart', { id, name }), kid(p, 'pPr')?.nextSibling ?? p.firstChild);
  }
  for (const tbl of all(doc, 'tbl')) {
    if (nearest(tbl, 'tc') || nearest(tbl, 'txbxContent')) continue;
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => Number(val(c, 'w')));
    if (!cols.length || cols.some((w) => !(w > 0))) continue;
    let tblPr = kid(tbl, 'tblPr');
    if (!tblPr) tbl.insertBefore(tblPr = make(doc, 'tblPr'), tbl.firstChild);
    kid(tblPr, 'tblLayout')?.remove();
    tblPr.appendChild(make(doc, 'tblLayout', { type: 'fixed', val: 'fixed' }));     // docx-preview reads "val", Word writes "type"
    if (val(kid(tblPr, 'tblW'), 'type') === 'pct') continue;              // a share of the page: the browser shares it out
    kid(tblPr, 'tblW')?.remove();
    tblPr.appendChild(make(doc, 'tblW', { w: String(cols.reduce((a, b) => a + b, 0)), type: 'dxa' }));
  }
}

/** Floating pictures (`wp:anchor`), noted with how Word places them for `anchors`: docx-preview set them in the line, one under
 * the other, where Word lays a newer diagram over the older one at the same place. Pictures in table cells stay in the cell. */
function anchorMarks(doc: Document, out: Anchor[]): void {
  const child = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) ?? null : null);
  const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr)) || 0;
  for (const a of Array.from(doc.getElementsByTagNameNS(WP, 'anchor'))) {
    let skip = false;
    for (let e = a.parentElement; e && !skip; e = e.parentElement) skip = (e.namespaceURI === MC && e.localName === 'Choice') || isW(e, 'tc') || isW(e, 'txbxContent');
    let at: Element | null = nearest(a, 'r');
    while (at?.parentElement && !isW(at.parentElement, 'p')) at = at.parentElement;   // the run, or the link it is in
    if (skip || !at?.parentElement) continue;
    const place = (name: string, from: string): Placement => {
      const el = child(a, name);
      const offset = Number(child(el, 'posOffset')?.textContent) || 0;
      return { from: el?.getAttribute('relativeFrom') ?? from, align: child(el, 'align')?.textContent?.trim() || null, offset: offset / EMU };
    };
    const simple = /^(1|true|on)$/i.test(a.getAttribute('simplePos') ?? '');
    const pos = child(a, 'simplePos');
    const wrap = Array.from(a.children).find((c) => c.namespaceURI === WP && /^wrap/.test(c.localName));
    out.push({
      h: simple ? { from: 'page', align: null, offset: num(pos, 'x') / EMU } : place('positionH', 'column'),
      v: simple ? { from: 'page', align: null, offset: num(pos, 'y') / EMU } : place('positionV', 'paragraph'),
      wrap: wrap ? wrap.localName.slice(4) : 'None',
      side: wrap?.getAttribute('wrapText') ?? 'bothSides',
      behind: /^(1|true|on)$/i.test(a.getAttribute('behindDoc') ?? ''),
      z: num(a, 'relativeHeight'),
      dist: ['distT', 'distB', 'distL', 'distR'].map((d) => num(a, d) / EMU),
      width: num(child(a, 'extent'), 'cx') / EMU,
      height: num(child(a, 'extent'), 'cy') / EMU,
    });
    at.before(make(doc, 'bookmarkStart', { id: String(980000 + out.length), name: `${ANCHOR}${out.length - 1}` }));
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
    // a bullet in a symbol font is drawn in that font where the computer has it (Word's own glyph), else as its Unicode twin;
    // any other bullet keeps its own font (Courier New's "o")
    const fonts = kid(kid(lvl, 'rPr'), 'rFonts');
    const face = (val(fonts, 'ascii') ?? val(fonts, 'hAnsi') ?? '').trim();
    const symbols = /^[\uF000-\uF0FF]/.test(text) || /^(symbol|wingdings( [23])?|webdings)$/i.test(face);
    const glyph = format === 'bullet' && symbols && !(face && canDraw(face, text)) ? symbolTwin(face, text) ?? undefined : undefined;
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
      if (!kid(rPr, 'rStyle')) rPr.prepend(make(doc, 'rStyle', { val: LABEL_STYLE }));      // known to `paragraphs` as the number
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
 * where Word does); docx-preview made it 1em of the style's size. So is one that holds only pictures and shapes Word floats
 * (they take no room in the line). A run holding a zero-width space carries the mark's look. */
function emptyLines(doc: Document): void {
  const floats = (el: Element) => (isW(el, 'drawing') ? el.getElementsByTagNameNS(WP, 'anchor').length > 0
    : Array.from(el.getElementsByTagNameNS(VML, '*')).some((s) => /position:\s*absolute/i.test(s.getAttribute('style') ?? '')));
  // a run of spaces with nothing drawn on them (no underline, strike, highlight, shading or border: a form's blank line keeps
  // its spaces)
  const plain = (r: Element | null) => !['u', 'strike', 'dstrike', 'highlight', 'shd', 'bdr'].some((n) => {
    const k = kid(kid(r, 'rPr'), n);
    return !!k && !(n === 'u' && val(k) === 'none') && isOn(k);
  });
  const blank = (r: Element) => Array.from(r.children).every((c) => isW(c, 'rPr') || isW(c, 'tab')
    || (isW(c, 't') && !/[^\s\u00a0\u2002-\u200b\u3000]/.test(c.textContent ?? '')));
  for (const p of all(doc, 'p')) {
    // a line of spaces and tabs only is as high as its paragraph mark in Word (an 18 pt space over an 11 pt mark: an 11 pt
    // line), so its runs are left out and the paragraph is an empty one; not where a tab draws a leader
    const runs = all(p, 'r');
    const leaders = kids(kid(kid(p, 'pPr'), 'tabs'), 'tab').some((t) => (val(t, 'leader') ?? 'none') !== 'none');
    if (runs.length && !leaders && runs.every((r) => blank(r) && plain(r))) for (const r of runs) r.remove();     // an empty run still props the line up
    if (all(p, 't').some((t) => t.textContent) || ['tab', 'ptab', 'br', 'sym', 'object'].some((n) => all(p, n).length)
      || [...all(p, 'drawing'), ...all(p, 'pict')].some((d) => !floats(d))) continue;
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

/** The paragraph that carries a page break the file recorded (drawn as nothing). */
function breakerParagraph(doc: Document): Element {
  const p = make(doc, 'p');
  p.appendChild(make(doc, 'pPr')).appendChild(make(doc, 'pStyle', { val: BREAK_STYLE }));
  p.appendChild(make(doc, 'r')).appendChild(make(doc, 'br', { type: 'page' }));
  return p;
}

function pageBreaksAsSaved(doc: Document, st: Styles): void {
  const body = all(doc, 'body')[0];
  if (!body) return;
  const breaker = () => breakerParagraph(doc);
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
    } else if (ahead.shown && isW(block, 'p') && shownAfter(doc, block, mark)) {
      mark.setAttribute(SPLIT_AT, '1');                              // split over two pages in Word: `splitParagraphs` splits it
      continue;
    } else if (ahead.shown) breakAfter(block);
    else breakBefore(block);
    mark.remove();
  }
}

/**
 * A paragraph Word broke over two pages (a page break it recorded after some of its text) is split there, as Word shows it:
 * the first part ends its page, with no space after it and its last line justified like the others; the rest starts the next
 * page, with no space before it, no first-line indent and no number. docx-preview kept it whole on the first page, so the
 * next page started a paragraph too late. Run after `numbers`, so the first part keeps the number.
 */
function splitParagraphs(doc: Document): void {
  for (const mark of all(doc, 'lastRenderedPageBreak').filter((m) => m.getAttribute(SPLIT_AT) === '1')) {
    const p = nearest(mark, 'p');
    const run = nearest(mark, 'r');
    if (!p?.lastChild || !p.parentElement) { mark.remove(); continue; }
    const range = doc.createRange();
    range.setStartBefore(mark);
    range.setEndAfter(p.lastChild);
    const rest = range.extractContents();
    mark.remove();                                                      // a later break in the rest splits the rest in turn
    const firstRun = (n: Node): Element | null => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType !== 1) continue;
        if (isW(c as Element, 'r')) return c as Element;
        const r = firstRun(c);
        if (r) return r;
      }
      return null;
    };
    const first = firstRun(rest);                                       // the broken run's second half keeps the run's look
    const look = kid(run, 'rPr');
    if (first && look && !kid(first, 'rPr')) first.insertBefore(look.cloneNode(true), first.firstChild);
    const next = make(doc, 'p');
    const own = kid(p, 'pPr');
    if (own) {
      const pPr = next.appendChild(own.cloneNode(true)) as Element;
      kid(own, 'sectPr')?.remove();                                     // a section break ends the paragraph: its second part
      setSpacing(doc, next, 'before');
      let ind = kid(pPr, 'ind');
      if (!ind) pPr.appendChild(ind = make(doc, 'ind'));
      ind.removeAttributeNS(W, 'hanging');
      ind.setAttributeNS(W, 'w:firstLine', '0');
    } else next.appendChild(make(doc, 'pPr')).appendChild(make(doc, 'ind', { firstLine: '0' }));
    next.appendChild(rest);
    setSpacing(doc, p, 'after');
    p.insertBefore(make(doc, 'bookmarkStart', { id: '989993', name: GOES_ON }), kid(p, 'pPr')?.nextSibling ?? p.firstChild);
    p.after(breakerParagraph(doc), next);
  }
}

/**
 * Sections as Word lays them out. A section that names no header or footer of a kind has its previous section's (docx-preview
 * showed none). A section with a different first page (titlePg) and no first-page header shows none there (docx-preview showed
 * the usual one, on a cover page). A section that starts with a continuous break goes on on the same page (a glossary set in two
 * columns under its heading), where docx-preview started a page for every section. The first paragraph of such sections is
 * marked for `finishLayout`, and of every section, with its headers and footers by kind returned for `headersAndFooters`.
 * docx-preview draws only the header and footer of its own pages, so each part is drawn once more on a page of its own at the
 * start, to be copied from (and then taken away).
 */
function sections(doc: Document, rels: Map<string, string>): SectionParts[] {
  const body = all(doc, 'body')[0];
  if (!body) return [];
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
    mark(start, `${SECTION}${i}`);
  });
  const partOf = (r: Element | undefined) => (r ? rels.get(r.getAttributeNS(REL, 'id') ?? '') : undefined);
  const out = found.map(({ sect }) => {
    const byKind = (kind: string) => Object.fromEntries(['default', 'first', 'even'].flatMap((t) => { const p = partOf(ref(sect, kind, t)); return p ? [[t, p]] : []; }));
    return { titlePg: isOn(kid(sect, 'titlePg')), header: byKind('headerReference'), footer: byKind('footerReference') };
  });
  // each part on a page of its own before the document, in the page size and margins of the first section that shows it
  const drawn = new Set<string>();
  const pages: Element[] = [];
  found.forEach(({ sect }) => {
    for (const kind of ['headerReference', 'footerReference']) for (const r of kids(sect, kind)) {
      const part = partOf(r);
      if (!part || drawn.has(part)) continue;
      drawn.add(part);
      const page = make(doc, 'p');
      const props = page.appendChild(make(doc, 'pPr')).appendChild(make(doc, 'sectPr'));
      const own = r.cloneNode(true) as Element;
      own.setAttributeNS(W, 'w:type', 'default');
      props.appendChild(own);
      for (const name of ['pgSz', 'pgMar', 'cols', 'docGrid']) { const k = kid(sect, name); if (k) props.appendChild(k.cloneNode(true)); }
      page.appendChild(make(doc, 'bookmarkStart', { id: '989996', name: TEMPLATE }));
      pages.push(page);
    }
  });
  const firstBlock = Array.from(body.children).find((c) => !isW(c, 'sectPr')) ?? kid(body, 'sectPr');
  for (const page of pages) body.insertBefore(page, firstBlock);
  return out;
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
  // the document's parts by relationship (header1.xml...), and whether even pages have headers and footers of their own
  const relsDoc = await read('word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  for (const r of relsDoc ? Array.from(relsDoc.getElementsByTagName('Relationship')) : []) rels.set(r.getAttribute('Id') ?? '', (r.getAttribute('Target') ?? '').split('/').pop() ?? '');
  const evenAndOdd = isOn(settings ? all(settings, 'evenAndOddHeaders')[0] ?? null : null);
  let parts: SectionParts[] = [];
  let saved = false;
  const anchors: Anchor[] = [];
  for (const path of Object.keys(zip.files).filter((p) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))) {
    const doc = await read(path);
    if (!doc) continue;
    acceptChanges(doc);                                // first: the rest sees the text Word's final view shows
    latinFonts(doc);
    plainContents(doc, st);
    defaultStyle(doc, st);
    tableParagraphs(doc, st);
    numberingRemoved(doc, st);
    listLevels(doc, st);
    autoColourOnDark(doc, st);
    tables(doc, compat, cellMargin);
    defaultTableStyle(doc, val(tableStyle, 'styleId'));
    tableLayout(doc);
    contextualSpacing(doc, st);
    if (path === 'word/document.xml') {
      saved = all(doc, 'lastRenderedPageBreak').length > 0;
      pageBreaksAsSaved(doc, st);
      parts = sections(doc, rels);
      numbers(doc, st, lists);                         // after the page breaks: a number is shown text to them
      splitParagraphs(doc);
      flowMarks(doc, st, compat);
    }
    if (/header|footer/.test(path)) {
      pageFields(doc);
      const p = all(doc, 'p')[0];                      // which part a page's header or footer shows
      if (p) p.insertBefore(make(doc, 'bookmarkStart', { id: '989995', name: `${PART}${path.split('/').pop()}` }), kid(p, 'pPr')?.nextSibling ?? p.firstChild);
    }
    unwrap(doc);
    anchorMarks(doc, anchors);
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
      tableLayout(doc);                                // a table style's double borders
      baseStylesFirst(doc);
      // a paragraph style and its character style are a pair only for Word's menus: docx-preview gave each the other's look (a
      // heading of 16 pt the 14 pt its "Heading 1 Char" still had from the template it was made from)
      for (const link of all(doc, 'link')) link.remove();
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
  return { file: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), stops, defaultTab, fonts, compat, sections: parts, evenAndOdd, anchors, saved };
}

const STAND_INS: Record<string, string> = { swiss: 'Arial, sans-serif', roman: '"Times New Roman", serif', modern: '"Courier New", monospace', script: 'cursive' };

/** The size Word sets text in: a whole number of dots at 600 dpi (10.5 pt is set as 10.56 pt, 11 pt as 11.04 pt, 10 pt as 9.96
 * pt; every size in Word's PDFs of fifteen files is one of these). In the file's own size a 10.5 pt line came out 0.5%
 * narrower than Word's, and broke a word later. */
export function wordSize(pt: number): number {
  return Math.round(pt * 600 / 72) * 72 / 600;
}

function fontSizes(styles: HTMLElement, body: HTMLElement): void {
  const sized = (css: string) => css.replace(/font-size:\s*(\d*\.?\d+)pt/g, (_m, v: string) => `font-size: ${+wordSize(Number(v)).toFixed(3)}pt`);
  for (const s of Array.from(styles.querySelectorAll('style'))) {
    const css = s.textContent ?? '';
    const done = sized(css);
    if (done !== css) s.textContent = done;
  }
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('[style*="font-size"]'))) {
    const m = /^(\d*\.?\d+)pt$/.exec(el.style.fontSize);
    if (m) el.style.fontSize = `${+wordSize(Number(m[1])).toFixed(3)}pt`;
  }
}

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
    const spans = Array.from(p.querySelectorAll('span'));
    const label = `docx_${LABEL_STYLE.toLowerCase()}`;                      // the text, not its list number or bullet
    const text = getComputedStyle(spans.find((s) => s.textContent?.trim() && !s.classList.contains(label)) ?? spans.find((s) => s.textContent) ?? p);
    const own = getComputedStyle(p);
    return {
      family: text.fontFamily,
      // ...and its text's font: Word sets a line by the fonts on it, while the browser also counts the paragraph's own font,
      // which docx-preview leaves as the page's (a sans-serif's taller lines under Times New Roman text: a page in eleven)
      ownFamily: own.fontFamily !== text.fontFamily ? text.fontFamily : null,
      // a line is as tall as its text: the paragraph takes its text's size, or its style's larger size would set every line's
      // height (table text in 8 pt in a 10 pt style stood a third taller than in Word)
      size: Math.abs(parseFloat(text.fontSize) - parseFloat(own.fontSize)) > 0.5 ? text.fontSize : null,
      hang: p.className.includes('-num-') ? -parseFloat(own.textIndent) || 0 : 0,
      empty: !p.textContent && !p.querySelector('img, svg, canvas, table'),
      // exact line spacing (docx-preview gives such a paragraph a minimum height of its line): every line is that high in Word,
      // a bullet's taller font (Symbol's) included, where the browser let it stretch the line
      labels: parseFloat(own.minHeight) > 0 && own.minHeight === own.lineHeight ? Array.from(p.children).filter((c) => c.classList.contains(label)) as HTMLElement[] : [],
      // the first part of a paragraph split over two pages: its last line is not the paragraph's, and is justified like the rest
      goesOn: own.textAlign === 'justify' && !!p.querySelector(`:scope > span[id="${GOES_ON}"]`),
    };
  });
  // ...and its height from the size the file names, not the size Word sets the letters in (`fontSizes`): 10.5 pt text is set as
  // 10.56 pt, yet its lines are as tall as 10.5 pt lines (sizes are whole half points, so the named one is the nearest half)
  const named = (px: string) => { const pt = parseFloat(px) * PT; return pt > 0 ? Math.round(pt * 2) / 2 / pt : 1; };
  const lines = looks.map((l, i) => lineRatio(l.family) * named(l.size ?? getComputedStyle(all[i]).fontSize));
  all.forEach((p, i) => {
    p.style.setProperty('--wv-lh', lines[i].toFixed(4));
    if (looks[i].size) p.style.fontSize = looks[i].size!;
    if (looks[i].ownFamily) p.style.fontFamily = looks[i].ownFamily!;
    for (const l of looks[i].labels) l.style.lineHeight = '0';
    if (looks[i].goesOn) p.style.textAlignLast = 'justify';
    if (looks[i].empty) p.classList.add('wv-empty');                      // an empty paragraph is a line high, as in Word
    if (looks[i].hang > 0) {
      p.classList.add('wv-hang');
      p.style.setProperty('--wv-hang', `${looks[i].hang}px`);
    }
  });
}

/**
 * Justified text breaks into lines as Word's does. In a file made for Word 2013 and later, Word fits one more word on a
 * justified line by narrowing its spaces, down to about three quarters of their width (measured in Word's PDFs of eleven
 * files: never below 0.748); the browser only widens them, so a line ended a word early and a paragraph could take a line
 * more. The spaces are narrowed by that much for the line breaks, and justification widens them again on every line but the
 * last, whose spaces are given back their width where it still fits (as Word sets a last line). Paragraphs with tabs keep
 * their spaces: their stops set them.
 */
function justification(body: HTMLElement, compat: number): void {
  if (compat < 15) return;
  const widths = new Map<string, number>();
  const space = (cs: CSSStyleDeclaration) => {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let w = widths.get(font);
    if (w == null) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = font;
      w = ctx ? ctx.measureText(' ').width : 0;
      widths.set(font, w);
    }
    return w;
  };
  const tabbed = /[]/;
  const plans = Array.from(body.querySelectorAll<HTMLElement>('p')).flatMap((p) => {
    const cs = getComputedStyle(p);
    if (cs.textAlign !== 'justify' || tabbed.test(p.textContent ?? '')) return [];
    const text = Array.from(p.querySelectorAll('span')).find((s) => s.textContent?.trim()) ?? p;
    const w = space(getComputedStyle(text));
    return w > 0 ? [{ p, shrink: 0.255 * w }] : [];
  });
  for (const { p, shrink } of plans) p.style.wordSpacing = `${-shrink}px`;
  // the last line: its spaces back to their width when the line still fits with them (read every paragraph, then change them)
  const lasts = plans.flatMap(({ p, shrink }) => {
    if (p.style.textAlignLast === 'justify') return [];
    const texts: Text[] = [];
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) if (n.data) texts.push(n);
    if (!texts.length) return [];
    const range = document.createRange();
    const rectOf = (n: Text, i: number) => { range.setStart(n, i); range.setEnd(n, i + 1); return range.getBoundingClientRect(); };
    const lastText = texts[texts.length - 1];
    const lastTop = rectOf(lastText, lastText.data.length - 1).top;
    // the first character on the last line: back from the end, a text at a time, then within the text
    let start: { node: Text; offset: number } | null = null;
    for (let t = texts.length - 1; t >= 0 && !start; t--) {
      const n = texts[t];
      if (rectOf(n, 0).top >= lastTop - 1) { if (t === 0) start = { node: n, offset: 0 }; continue; }
      let lo = 0;
      let hi = n.data.length - 1;                                        // lo is above the last line, hi on it
      if (rectOf(n, hi).top < lastTop - 1) { start = { node: texts[t + 1], offset: 0 }; break; }
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rectOf(n, mid).top >= lastTop - 1) hi = mid; else lo = mid; }
      start = { node: n, offset: hi };
    }
    if (!start) return [];
    range.setStart(start.node, start.offset);
    range.setEnd(lastText, lastText.data.length);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (!rects.length) return [];
    const used = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
    const spaces = (range.toString().trim().match(/ /g) ?? []).length;
    const pr = p.getBoundingClientRect();
    const room = pr.right - (parseFloat(getComputedStyle(p).paddingRight) || 0) - Math.min(...rects.map((r) => r.left));
    return used + spaces * shrink <= room - 0.5 ? [{ p, start, end: lastText }] : [];
  });
  for (const { start, end } of lasts) {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end, end.data.length);
    const last = document.createElement('wv-line');                    // not a span: docx-preview gives every span its own font
    last.style.wordSpacing = '0';
    last.append(range.extractContents());
    range.insertNode(last);                                              // where it was: what follows the text stays after it
  }
}

const cssPx = (v: string) => { const m = /^(-?\d*\.?\d+)(pt|px)$/.exec(v.trim()); return m ? Number(m[1]) / (m[2] === 'pt' ? PT : 1) : 0; };

/** A cell's top and bottom borders as wide as the file makes them, in px: the browser draws a border in whole device pixels (a
 * 0.5 pt line is 1 px at 100 %, 0.67 px in Word). Read from the rules of its table's style and its own style. */
function fileBorders(body: HTMLElement): (td: HTMLElement) => [number, number] {
  const sheets = Array.from((body.getRootNode() as Document | ShadowRoot).styleSheets ?? []);
  const rules = sheets.flatMap((s) => { try { return Array.from(s.cssRules); } catch { return []; } })
    .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && /border/.test(r.style.cssText));
  const width = (w: string, s: string) => (!s || /none|hidden/.test(s) ? 0 : w === 'thin' ? 1 : w === 'thick' ? 5 : !w || w === 'medium' ? 3 : cssPx(w));
  const known = new Map<string, [number, number]>();
  return (td) => {
    const key = `${td.closest('table')?.className}|${td.parentElement?.className}|${td.className}|${td.getAttribute('style')}`;
    let found = known.get(key);
    if (!found) {
      const side = (name: 'Top' | 'Bottom') => {
        let [w, s] = ['', ''];
        for (const r of rules) {
          let on = false;
          try { on = td.matches(r.selectorText); } catch { /* a rule for a pseudo-element */ }
          if (on) [w, s] = [r.style[`border${name}Width`] || w, r.style[`border${name}Style`] || s];
        }
        return width(td.style[`border${name}Width`] || w, td.style[`border${name}Style`] || s);
      };
      known.set(key, found = [side('Top'), side('Bottom')]);
    }
    return found;
  };
}

/** Rows as tall as Word makes them (measured against Word's own PDFs): a row of at least a height is that height plus its cells'
 * top and bottom margins and its border; one of exact height is its height plus the bottom margin. The browser put the margins
 * and borders inside the height: up to 7 px less a row, a page less in a long table. Borders count as wide as Word draws them:
 * where the browser draws them wider or thinner (in whole pixels), a row gives the difference back above its cells' content (a
 * third of a pixel a row at 100 %, a row of a long table on every page). A cell's text is as wide as its column less its
 * margins, as in Word: the browser also took half of each side border out of it (a word that fits Word's line went to the next). */
function rowHeights(body: HTMLElement): void {
  const borders = fileBorders(body);
  const plans: [HTMLElement, number, HTMLElement[], number][] = [];
  const sides: [HTMLElement, number, number][] = [];
  for (const tr of Array.from(body.querySelectorAll<HTMLElement>('tr'))) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD') as HTMLElement[];
    if (!cells.length) continue;
    const set = cssPx(tr.style.height);
    const looks = cells.map((c) => getComputedStyle(c));
    const most = (side: 'paddingTop' | 'paddingBottom' | 'borderTopWidth' | 'borderBottomWidth') => Math.max(0, ...looks.map((cs) => parseFloat(cs[side]) || 0));
    looks.forEach((cs, i) => {
      const [left, right] = [parseFloat(cs.borderLeftWidth) || 0, parseFloat(cs.borderRightWidth) || 0];
      if (left || right) sides.push([cells[i], Math.max(0, (parseFloat(cs.paddingLeft) || 0) - left / 2), Math.max(0, (parseFloat(cs.paddingRight) || 0) - right / 2)]);
    });
    const file = cells.map(borders);
    const word = (Math.max(0, ...file.map((b) => b[0])) + Math.max(0, ...file.map((b) => b[1]))) / 2;
    const first = tr.querySelector('p');
    const exact = !!first && first.closest('tr') === tr && !!first.querySelector(`:scope > span[id="${EXACT_ROW}"]`);
    const extra = exact ? 0 : (most('borderTopWidth') + most('borderBottomWidth')) / 2 - word;
    const tops = Math.abs(extra) > 0.01 ? cells.map((c) => c.firstElementChild as HTMLElement | null).filter((c): c is HTMLElement => !!c) : [];
    plans.push([tr, !set ? 0 : exact ? set + most('paddingBottom') : set + most('paddingTop') + most('paddingBottom') + word, tops, extra]);
  }
  const margins = plans.map(([, , tops]) => tops.map((c) => parseFloat(getComputedStyle(c).marginTop) || 0));
  plans.forEach(([tr, h, tops, extra], i) => {
    if (h) tr.style.height = `${h.toFixed(2)}px`;
    tops.forEach((c, j) => { c.style.marginTop = `${(margins[i][j] - extra).toFixed(3)}px`; });
  });
  for (const [td, left, right] of sides) Object.assign(td.style, { paddingLeft: `${left.toFixed(3)}px`, paddingRight: `${right.toFixed(3)}px` });
}

/**
 * Floating pictures where Word puts them: measured from the frame Word measures them from (the margin, the page, a margin's
 * strip, the paragraph's top above its space before), aligned in it or at its offset, a later one over an earlier one, behind
 * the text when set so. Text keeps clear of them as Word wraps it: beside a picture where an inch or more is left on a side
 * (on the wider side), else above and below it, held off by an invisible float. In headers and footers, and where Word wraps
 * no text, a picture only takes its place.
 */
function anchors(body: HTMLElement, list: Anchor[]): void {
  const found = Array.from(body.querySelectorAll<HTMLElement>(`span[id^="${ANCHOR}"]`)).flatMap((mark) => {
    const a = list[Number(mark.id.slice(ANCHOR.length))];
    const p = mark.closest('p') as HTMLElement | null;
    const page = mark.closest('section.docx') as HTMLElement | null;
    if (!a || !p || !page) return [];
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);          // the picture docx-preview drew after the mark
    walk.currentNode = mark;
    let el: HTMLElement | null = null;
    for (let n = walk.nextNode() as HTMLElement | null; n && !el; n = walk.nextNode() as HTMLElement | null) {
      if (n.id?.startsWith(ANCHOR)) break;
      if (n.tagName === 'DIV' && n.querySelector('img, svg')) el = n;
    }
    return el ? [{ a, p, page, el }] : [];
  });
  const plans = found.map(({ a, p, page, el }) => {                             // read everything, then move them
    const pr = page.getBoundingClientRect();
    const cs = getComputedStyle(page);
    const [ml, mr, mt, mb] = [cs.paddingLeft, cs.paddingRight, cs.paddingTop, cs.paddingBottom].map((v) => parseFloat(v) || 0);
    const height = parseFloat(cs.minHeight) || pr.height;
    const box = p.getBoundingClientRect();
    const pTop = box.top - pr.top;
    const before = parseFloat(getComputedStyle(p).marginTop) || 0;
    const at = (pl: Placement, size: number, f0: number, f1: number) =>
      (pl.align === 'center' ? (f0 + f1 - size) / 2 : pl.align && /right|bottom|outside/.test(pl.align) ? f1 - size : pl.align ? f0 : f0 + pl.offset);
    const hf = a.h.from;
    const [h0, h1] = hf === 'page' ? [0, pr.width] : /^(left|inside)Margin$/.test(hf) ? [0, ml] : /^(right|outside)Margin$/.test(hf) ? [pr.width - mr, pr.width] : [ml, pr.width - mr];
    const vf = a.v.from;
    const [v0, v1] = vf === 'page' ? [0, height] : vf === 'margin' ? [mt, height - mb] : vf === 'topMargin' ? [0, mt] : vf === 'bottomMargin' ? [height - mb, height] : [pTop - before, pTop - before];
    return {
      a, p, el, x: at(a.h, a.width, h0, h1), y: at(a.v, a.height, v0, v1), pLeft: box.left - pr.left, pRight: box.right - pr.left, pTop, ml,
      colRight: pr.width - mr, fromParagraph: !['page', 'margin', 'topMargin', 'bottomMargin'].includes(vf), inPart: !!p.closest('header, footer'),
    };
  });
  const order = [...plans].sort((m, n) => m.a.z - n.a.z);
  const byParagraph = new Map<HTMLElement, typeof plans>();
  for (const s of plans) byParagraph.set(s.p, [...(byParagraph.get(s.p) ?? []), s]);
  for (const [p, group] of Array.from(byParagraph)) {
    const inP = group.some((s) => s.fromParagraph);              // the paragraph is their frame when one is measured from it
    if (inP) p.style.position = 'relative';
    for (const s of group) {
      const st = s.el.style;
      Object.assign(st, { position: 'absolute', display: 'block', float: 'none', margin: '0', textAlign: '', width: `${s.a.width}px`, height: `${s.a.height}px` });
      st.left = `${s.x - (inP ? s.pLeft : 0)}px`;
      st.top = `${s.y - (inP ? s.pTop : 0)}px`;
      st.zIndex = s.a.behind ? '-1' : String(1 + order.indexOf(s));
    }
    // the paragraph keeps its own line (its mark) when the pictures were all it held
    const others = Array.from(p.querySelectorAll('img, svg')).some((g) => !group.some((s) => s.el.contains(g)));
    if (!others && !p.textContent?.replace(/[​\s]/g, '')) p.classList.add('wv-empty');
    // the space Word keeps clear around each, overlapping ones as one (a diagram pasted over another)
    const boxes: { l: number; t: number; r: number; b: number; wrap: string; side: string }[] = [];
    for (const s of group) {
      if (s.inPart || s.a.behind || s.a.wrap === 'None') continue;
      const bx = { l: s.x - s.a.dist[2], t: s.y - s.a.dist[0], r: s.x + s.a.width + s.a.dist[3], b: s.y + s.a.height + s.a.dist[1], wrap: s.a.wrap, side: s.a.side };
      const hit = boxes.find((o) => bx.l < o.r && o.l < bx.r && bx.t < o.b && o.t < bx.b);
      if (hit) Object.assign(hit, { l: Math.min(hit.l, bx.l), t: Math.min(hit.t, bx.t), r: Math.max(hit.r, bx.r), b: Math.max(hit.b, bx.b), wrap: hit.wrap === 'TopAndBottom' ? hit.wrap : bx.wrap });
      else boxes.push(bx);
    }
    const g = group[0];
    for (const bx of boxes) {
      const reach = bx.b - g.pTop;                               // from the paragraph's first line down to the picture's foot
      if (reach <= 0) continue;
      const dy = Math.max(0, bx.t - g.pTop);
      const [left, right] = [bx.l - g.ml, g.colRight - bx.r];
      const f = document.createElement('span');
      f.className = 'wv-float';
      Object.assign(f.style, { height: `${reach}px`, shapeOutside: dy ? `inset(${dy}px 0 0 0)` : '' });
      if (bx.wrap === 'TopAndBottom' || Math.max(left, right) < 96) {
        Object.assign(f.style, { float: 'left', width: `${g.colRight - g.ml}px`, marginLeft: `${g.ml - g.pLeft}px` });
      } else if (bx.side === 'left' || (bx.side !== 'right' && left >= right)) {
        Object.assign(f.style, { float: 'right', width: `${bx.r - bx.l}px`, marginRight: `${g.pRight - bx.r}px` });
      } else {
        Object.assign(f.style, { float: 'left', width: `${bx.r - bx.l}px`, marginLeft: `${bx.l - g.pLeft}px` });
      }
      p.prepend(f);
    }
  }
}

/** The headers and footers `sections` drew on pages of their own, by part, and those pages taken out. */
function takeTemplates(body: HTMLElement): Map<string, HTMLElement> {
  const parts = new Map<string, HTMLElement>();
  for (const mark of Array.from(body.querySelectorAll(`span[id="${TEMPLATE}"]`))) {
    const page = mark.closest('section.docx');
    if (!page) continue;
    for (const el of Array.from(page.children)) {
      const id = el.tagName === 'HEADER' || el.tagName === 'FOOTER' ? el.querySelector(`span[id^="${PART}"]`)?.id.slice(PART.length) : undefined;
      if (id && !parts.has(id)) parts.set(id, el as HTMLElement);
    }
    page.remove();
  }
  return parts;
}

/**
 * Each page's header and footer as Word chooses them: from the section the page starts in, its first page's own when the
 * section has a different first page, else on even-numbered pages the even ones when the document has them, else its usual
 * ones; blank where the section has none of that kind. docx-preview chose them before pages were split and joined: a footer
 * meant for even pages showed on the odd ones.
 */
function headersAndFooters(body: HTMLElement, prepared: Prepared, parts: Map<string, HTMLElement>): void {
  if (!parts.size || !prepared.sections?.length) return;
  let sect = 0;
  let n = 0;
  for (const page of Array.from(body.querySelectorAll<HTMLElement>('section.docx'))) {
    const article = page.querySelector(':scope > article');
    const marks = Array.from(article?.querySelectorAll(`span[id^="${SECTION}"]`) ?? []);
    const startsHere = marks.find((m) => article?.firstElementChild?.contains(m));
    if (startsHere) sect = Number(startsHere.id.slice(SECTION.length));
    const restart = page.querySelector(`article span[id^="${PAGE_START}"]`);       // its number, as pageNumbers counts it
    const start = restart ? restart.id.slice(PAGE_START.length).split('_')[0] : '';
    n = start ? Number(start) : n + 1;
    const s = prepared.sections[sect];
    const kind = startsHere && s?.titlePg ? 'first' : prepared.evenAndOdd && n % 2 === 0 ? 'even' : 'default';
    for (const [tag, list] of [['HEADER', s?.header], ['FOOTER', s?.footer]] as const) {
      if (!list) continue;
      const part = list[kind];
      const from = part ? parts.get(part) : undefined;
      if (part && !from) continue;                                                    // not drawn: as docx-preview drew it
      const own = Array.from(page.children).find((c) => c.tagName === tag);
      if (own) own.replaceChildren(...(from ? Array.from(from.cloneNode(true).childNodes) : []));
      else if (from) {
        const copy = from.cloneNode(true) as HTMLElement;
        if (tag === 'HEADER') page.prepend(copy);
        else page.append(copy);
      }
    }
    if (marks.length) sect = Number(marks[marks.length - 1].id.slice(SECTION.length));   // one begun further down goes on
  }
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

/** A table in text set in columns runs on from one column into the next, as in Word and Chrome; Firefox keeps a table whole in
 * one column (a glossary in two columns stood in one, twice the page's height). Where the browser kept it whole it is cut by its
 * rows into one table for each column, of about the same height, its header rows at the top of each. Not a table with merged rows. */
function columnTables(body: HTMLElement): void {
  for (const article of Array.from(body.querySelectorAll<HTMLElement>('section.docx > article'))) {
    const cols = parseInt(getComputedStyle(article).columnCount, 10) || 1;
    if (cols < 2) continue;
    for (const table of Array.from(article.children).filter((c) => c.tagName === 'TABLE') as HTMLElement[]) {
      const rows = Array.from(table.querySelectorAll<HTMLElement>(':scope > tr, :scope > tbody > tr'));
      if (rows.length < 2 || table.getClientRects().length > 1 || table.querySelector('td[rowspan]:not([rowspan="1"])')) continue;
      const heights = rows.map((tr) => tr.getBoundingClientRect().height);
      const total = heights.reduce((a, b) => a + b, 0);
      const cuts: number[] = [];                              // the row each next table starts with
      let sum = 0;
      heights.forEach((h, i) => { if (i && cuts.length < cols - 1 && sum + h / 2 > (total / cols) * (cuts.length + 1)) cuts.push(i); sum += h; });
      let last = table;
      cuts.forEach((from, k) => {
        const part = table.cloneNode(false) as HTMLElement;
        for (const keep of Array.from(table.querySelectorAll(':scope > colgroup, :scope > thead'))) part.appendChild(keep.cloneNode(true));
        part.append(...rows.slice(from, cuts[k + 1] ?? rows.length));
        last.after(part);
        last = part;
      });
    }
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

/** How Word may break a paragraph over pages (`flowMarks`): n kept with the next, l its lines kept together, w widow control. */
const flowOf = (el: Element): string => (el.tagName === 'P' ? Array.from(el.children).find((c) => c.id.startsWith(FLOW))?.id.slice(FLOW.length) ?? '' : '');
const keptWithNext = (el: Element): boolean => el.tagName === 'P' && (flowOf(el).includes('n') || /heading|title/i.test(el.className));

/** The text of a paragraph in reading order, without what floats out of it (a picture Word places itself, a shape). */
function textsOf(p: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (n.data && !n.parentElement?.closest('[style*="absolute"], .wv-float')) out.push(n);
  }
  return out;
}

/** A paragraph's lines as the browser set them, top to bottom: the top and bottom of each line, the space of its line height
 * around its text included (what has to fit above the foot of the page, as in Word). */
function linesOf(p: HTMLElement): { top: number; bottom: number }[] {
  const range = document.createRange();
  const rects: DOMRect[] = [];
  for (const t of textsOf(p)) {
    range.selectNodeContents(t);
    rects.push(...Array.from(range.getClientRects()).filter((r) => r.height > 0));
  }
  const lines: { top: number; bottom: number }[] = [];
  for (const r of rects.sort((x, y) => x.top - y.top)) {
    const line = lines.find((l) => r.top < l.bottom - 2 && r.bottom > l.top + 2);
    if (line) [line.top, line.bottom] = [Math.min(line.top, r.top), Math.max(line.bottom, r.bottom)];
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  const height = parseFloat(getComputedStyle(p).lineHeight);
  for (const l of height ? lines : []) {
    const more = (height - (l.bottom - l.top)) / 2;
    if (more > 0) [l.top, l.bottom] = [l.top - more, l.bottom + more];
  }
  return lines;
}

/** Where the line starting at `top` begins in a paragraph's text. */
function lineStart(p: HTMLElement, top: number): { node: Text; offset: number } | null {
  const range = document.createRange();
  const topOf = (n: Text, i: number) => { range.setStart(n, i); range.setEnd(n, i + 1); return range.getBoundingClientRect().top; };
  for (const n of textsOf(p)) {
    if (topOf(n, n.data.length - 1) < top - 1) continue;                   // all of it above that line
    let [lo, hi] = [-1, n.data.length - 1];                                 // lo above the line (or before the text), hi on it
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (topOf(n, mid) >= top - 1) hi = mid; else lo = mid; }
    return { node: n, offset: hi };
  }
  return null;
}

/** A paragraph split before `at`: the rest goes on as the same paragraph, without the space before it, a first-line indent or
 * its number; the first part ends without its space after, its last line justified like the others. */
function splitParagraph(p: HTMLElement, at: { node: Text; offset: number }): HTMLElement {
  const range = document.createRange();
  range.setStart(at.node, at.offset);
  range.setEnd(p, p.childNodes.length);
  const rest = p.cloneNode(false) as HTMLElement;
  rest.append(range.extractContents());
  for (const c of Array.from(rest.classList)) if (c === 'wv-hang' || c.startsWith('docx-num-')) rest.classList.remove(c);
  Object.assign(rest.style, { textIndent: '0', marginTop: '0' });
  p.style.marginBottom = '0';
  if (getComputedStyle(p).textAlign === 'justify') p.style.textAlignLast = 'justify';
  p.after(rest);
  return rest;
}

/** Where Word breaks a table row that reaches past `limit` over two pages: in each cell, the first child that goes on (and the
 * line it goes on from, where a paragraph is broken: whole where its lines are kept together, two lines on each page where it
 * has widow control, `flowMarks`). Null where Word moves the row whole: a row kept whole or of exact height, one with nothing
 * that fits or nothing that does not, one in a table with merged rows. */
type RowCut = { child: number; at: { node: Text; offset: number } | null }[];
function rowBreak(tr: HTMLElement, limit: number): RowCut | null {
  const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD') as HTMLElement[];
  if (!cells.length || tr.querySelector(`span[id="${EXACT_ROW}"], span[id="${WHOLE_ROW}"]`) || tr.closest('table')?.querySelector('td[rowspan]:not([rowspan="1"])')) return null;
  const cut = cells.map((td) => {
    const kids = Array.from(td.children) as HTMLElement[];
    const room = limit - (parseFloat(getComputedStyle(td).paddingBottom) || 0);
    const i = kids.findIndex((k) => k.getBoundingClientRect().bottom > room);
    if (i < 0) return { child: kids.length, at: null };
    const lines = kids[i].tagName === 'P' ? linesOf(kids[i]) : [];
    let fit = lines.filter((l) => l.bottom <= room).length;
    if (lines.length && fit === lines.length) return { child: i + 1, at: null };
    const flow = flowOf(kids[i]);
    if (flow.includes('l')) fit = 0;
    else if (flow.includes('w')) {
      if (lines.length - fit < 2) fit = lines.length - 2;
      if (fit < 2) fit = 0;
    }
    return { child: i, at: fit > 0 ? lineStart(kids[i], lines[fit].top) : null };
  });
  const stays = cut.some((c) => c.child > 0 || c.at);
  const goes = cut.some((c, i) => c.child < cells[i].children.length);
  return stays && goes ? cut : null;
}

/** The row broken where `rowBreak` found: what goes on, in a row of its own with the same cells; both rows as tall as what is in
 * them, the space after the last paragraph at the foot running into the margin as Word lets it. */
function breakRow(tr: HTMLElement, cut: RowCut): HTMLElement {
  const rest = tr.cloneNode(false) as HTMLElement;
  const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD') as HTMLElement[];
  cells.forEach((td, i) => {
    const { child, at } = cut[i];
    const kids = Array.from(td.children) as HTMLElement[];
    const cell = rest.appendChild(td.cloneNode(false)) as HTMLElement;
    cell.append(...(at ? [splitParagraph(kids[child], at), ...kids.slice(child + 1)] : kids.slice(child)));
    const last = td.lastElementChild as HTMLElement | null;
    if (last) last.style.marginBottom = '0';
  });
  tr.style.height = rest.style.height = '';
  return rest;
}

/**
 * A page whose content runs past its foot is split where the content reaches the foot, as Word would: between blocks, a
 * heading kept with what follows it, a table between rows, a paragraph between lines (with at least two lines on each page
 * where its widow control says so, and whole where its lines are kept together). Word records no page break inside a table
 * of contents or on an empty line, and none at all in a file it did not lay out itself. In a file Word laid out, a page only
 * a little too long is left alone: Word fitted it, and the browser's lines are a little taller or shorter than Word's
 * (`slack`, a share of the page's text height).
 */
export function paginate(body: HTMLElement, slack = 0.1): void {
  for (let round = 0; round < 400; round++) {
    const plans: { page: HTMLElement; article: HTMLElement; blocks: HTMLElement[]; from: number; rows: HTMLElement[]; split: { tr: HTMLElement; cut: RowCut } | null; at: { node: Text; offset: number } | null }[] = [];
    for (const page of Array.from(body.querySelectorAll<HTMLElement>('section.docx'))) {    // read every page, then change them
      const article = Array.from(page.children).filter((c) => c.tagName === 'ARTICLE').pop() as HTMLElement | undefined;
      const blocks = article ? (Array.from(article.children) as HTMLElement[]) : [];
      const height = parseFloat(getComputedStyle(page).minHeight) || 0;
      // text set in columns is measured as one long column: it is not split
      if (!article || blocks.length === 0 || !height || (parseInt(getComputedStyle(article).columnCount, 10) || 1) > 1) continue;
      const box = page.getBoundingClientRect();
      // the text ends at the bottom margin, or higher where footnotes or a tall footer come up into the page (both keep their
      // place: where they would be on a page of its own height)
      const below = article.nextElementSibling;
      const margin = box.top + height - (parseFloat(getComputedStyle(page).paddingBottom) || 0);
      const foot = below ? Math.min(margin, below.getBoundingClientRect().top - (box.height - height)) : margin;
      const top = article.getBoundingClientRect().top;
      // a block reaches as far down as the pictures that float from it
      const bottoms = blocks.map((b) => Math.max(b.getBoundingClientRect().bottom, ...Array.from(b.querySelectorAll('.wv-float')).map((f) => f.getBoundingClientRect().bottom)));
      if (Math.max(...bottoms) - foot <= Math.max(0.5, slack * (foot - top))) continue;
      let from = bottoms.findIndex((b) => b > foot + 0.5);
      if (from < 0) continue;
      let rows: HTMLElement[] = [];
      let split: { tr: HTMLElement; cut: RowCut } | null = null;          // a row broken over the pages
      let at: { node: Text; offset: number } | null = null;
      if (blocks[from].tagName === 'TABLE') {
        const trs = Array.from(blocks[from].querySelectorAll<HTMLElement>(':scope > tr, :scope > tbody > tr'));
        // a row fits with the border under it, as Word counts it (the table's own bottom shows how far that border reaches)
        const under = trs.length ? bottoms[from] - trs[trs.length - 1].getBoundingClientRect().bottom : 0;
        const fit = trs.findIndex((tr) => tr.getBoundingClientRect().bottom + under > foot + 0.5);
        const cut = fit >= 0 ? rowBreak(trs[fit], foot + 0.5 - under) : null;
        if (cut) [split, rows] = [{ tr: trs[fit], cut }, trs.slice(fit + 1)];
        else if (fit > 0) rows = trs.slice(fit);
      } else if (blocks[from].tagName === 'P' && !flowOf(blocks[from]).includes('l')) {
        const lines = linesOf(blocks[from]);
        let fit = lines.filter((l) => l.bottom <= foot + 0.5).length;
        if (flowOf(blocks[from]).includes('w')) {                            // two lines at the foot and two at the top
          if (lines.length - fit < 2) fit = lines.length - 2;
          if (fit < 2) fit = 0;
        }
        if (fit > 0 && fit < lines.length) at = lineStart(blocks[from], lines[fit].top);
      }
      if (!rows.length && !split && !at) {
        while (from > 0 && keptWithNext(blocks[from - 1])) from--;
        if (from === 0) from = 1;                                            // taller than a page on its own: it stays
        if (from >= blocks.length) continue;
      }
      plans.push({ page, article, blocks, from, rows, split, at });
    }
    if (!plans.length) return;
    for (const { page, article, blocks, from, rows, split, at } of plans) {
      const next = page.cloneNode(false) as HTMLElement;
      let content: HTMLElement | null = null;
      for (const c of Array.from(page.children)) {
        if (c.tagName === 'HEADER' || c.tagName === 'FOOTER') next.appendChild(c.cloneNode(true));
        else if (c === article) content = next.appendChild(article.cloneNode(false) as HTMLElement);
      }
      if (!content) continue;
      if (rows.length || split) {
        const table = blocks[from];
        const rest = table.cloneNode(false) as HTMLElement;
        for (const keep of Array.from(table.querySelectorAll(':scope > colgroup, :scope > thead'))) rest.appendChild(keep.cloneNode(true));   // header rows repeat
        if (split) rest.appendChild(breakRow(split.tr, split.cut));
        for (const tr of rows) rest.appendChild(tr);
        content.appendChild(rest);
      }
      const moved = at ? [splitParagraph(blocks[from], at), ...blocks.slice(from + 1)] : blocks.slice(rows.length || split ? from + 1 : from);
      for (const b of moved) content.appendChild(b);
      if (!rows.length && !split && !at && moved[0]?.tagName === 'P') moved[0].style.marginTop = '0';     // Word's own page break: no space before
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
  fontSizes(styles, body);                                       // ...and in Word's sizes
  paragraphs(styles, body);
  rowHeights(body);
  justification(body, prepared.compat);
  layOutTabs(body, prepared);
  shapes(body);
  anchors(body, prepared.anchors ?? []);
  const parts = takeTemplates(body);                             // before pages are counted, joined or split
  sectionPages(body);
  tableHeads(body);
  columnTables(body);
  pageTops(body, prepared.compat);
  paginate(body, slack ?? (prepared.saved ? 0.1 : 0));            // a file Word never laid out breaks at the foot
  pageFeet(body);
  headersAndFooters(body, prepared, parts);
  pageNumbers(body);
}

/** The space after a page's last line runs into the bottom margin in Word; counted, it made a full page a little too long. */
function pageFeet(body: HTMLElement): void {
  const lasts = Array.from(body.querySelectorAll<HTMLElement>('section.docx')).map((page) => {
    const article = Array.from(page.children).filter((c) => c.tagName === 'ARTICLE').pop();
    return (Array.from(article?.children ?? []) as HTMLElement[]).reverse().find((b) => getComputedStyle(b).display !== 'none');
  });
  for (const b of lasts) if (b) b.style.marginBottom = '0';
}

/** CSS for what `finishLayout` adds. */
export const FIDELITY_CSS = `
  .docx p.docx_${BREAK_STYLE.toLowerCase()} { display: none; }
  .docx .wv-tab { display: inline-block; height: 1em; min-height: 0; text-indent: 0; text-align: center; white-space: pre; letter-spacing: 0; overflow: visible;
    font: inherit; }                         /* its run's font (docx-preview gives every span the document's), its leader's too */
  .docx p.wv-hang::before { display: inline-block; min-width: var(--wv-hang); text-indent: 0; }
  .docx p.wv-empty::after { content: "\\200b"; }
  .docx p { min-height: 0; }                /* Word lets a line be lower than its font (a footer's spacer of 0.7 pt) */
  .docx span[id]:empty { font-size: 0; line-height: 0; }   /* a bookmark takes no room (a heading's took its style's 14 pt) */
  .docx .wv-float { pointer-events: none; }
  section.docx > footer { display: flex; flex-direction: column; justify-content: flex-end; }   /* Word sets it up from its foot */
  section.docx { isolation: isolate; }      /* a shape "behind text" is behind the text, not behind the page */
`;
