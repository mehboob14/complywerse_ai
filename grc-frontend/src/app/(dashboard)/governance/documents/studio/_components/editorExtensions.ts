/**
 * Tiptap pieces of the studio editor: tables that stay Markdown tables, placeholder highlighting, and marks the screens
 * put on the text (spelling and structure issues, the blocks a pending AI change would touch).
 *
 * The document is stored as Markdown. A table can only be written as a Markdown (pipe) table when its first row is made of
 * header cells, the others of plain cells, no cell spans and every cell holds one paragraph; otherwise tiptap-markdown falls
 * back to raw HTML, which the server would treat as text. So the cells here cannot be built any other way.
 */
import { Extension } from '@tiptap/core';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { placeholderSpans } from '@/lib/studio/text';
import type { BlockLook, PageLook } from '@/lib/studio/api';
import { lineRatio } from '@/lib/fontLines';
import { blockStyle } from './wordLook';

const NO_SPANS = {
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
};

const cellKeys = {
  // a new line inside a cell is a line break, not a second paragraph (a cell holds one paragraph). A keymap is the whole editor's,
  // so outside a table Enter is left to the editor: a new paragraph
  Enter: ({ editor }: { editor: { isActive: (name: string) => boolean; commands: { setHardBreak: () => boolean } } }) =>
    (editor.isActive('tableCell') || editor.isActive('tableHeader')) && editor.commands.setHardBreak(),
};

export const StudioCell = TableCell.extend({
  content: 'paragraph',
  addAttributes() {
    return NO_SPANS;
  },
  addKeyboardShortcuts() {
    return cellKeys;
  },
});

export const StudioHeaderCell = TableHeader.extend({
  content: 'paragraph',
  addAttributes() {
    return NO_SPANS;
  },
  addKeyboardShortcuts() {
    return cellKeys;
  },
});

export const StudioRow = TableRow;

const headerKey = new PluginKey('studioTableHeader');

export const StudioTable = Table.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: headerKey,
        // the first row is the header row and no other row is: whatever an edit or a paste did, put it right
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return true;
            node.forEach((row, rowOffset, rowIndex) => {
              row.forEach((cell, cellOffset) => {
                const want = rowIndex === 0 ? 'tableHeader' : 'tableCell';
                if (cell.type.name !== want) {
                  tr.setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, state.schema.nodes[want], cell.attrs);
                  changed = true;
                }
              });
            });
            return false;
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});

// ── placeholders ─────────────────────────────────────────────────────────────
/** Every placeholder that must be filled in, in document order. */
export function placeholderRanges(doc: PMNode): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of placeholderSpans(node.text)) out.push({ from: pos + s.start, to: pos + s.end });
  });
  return out.sort((a, b) => a.from - b.from);
}

export const Placeholders = Extension.create({
  name: 'studioPlaceholders',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('studioPlaceholders'),
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, placeholderRanges(state.doc).map((r) => Decoration.inline(r.from, r.to, { class: 'studio-ph' })));
          },
        },
      }),
    ];
  },
});

// ── marks put on the text by the screens ─────────────────────────────────────
export interface DocMark {
  from: number;
  to: number;
  className: string;
  title?: string;
  /** a whole block (node decoration) instead of a run of text */
  block?: boolean;
}

export const marksKey = new PluginKey<DecorationSet>('studioMarks');

export const Marks = Extension.create({
  name: 'studioMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: marksKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(marksKey) as DocMark[] | undefined;
            if (meta) {
              const size = tr.doc.content.size;
              return DecorationSet.create(
                tr.doc,
                meta
                  .filter((m) => m.from >= 0 && m.to <= size && m.to > m.from)
                  .map((m) =>
                    m.block
                      ? Decoration.node(m.from, m.to, { class: m.className })
                      : Decoration.inline(m.from, m.to, { class: m.className, ...(m.title ? { title: m.title } : {}) }),
                  ),
              );
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return marksKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ── a Word file's own numbers, indents and typography ────────────────────────
export interface WordLayoutState { set: DecorationSet; on: boolean; page: PageLook | null }
export interface WordLayoutMeta { looks: BlockLook[]; page?: PageLook | null }

export const wordLayoutKey = new PluginKey<WordLayoutState>('studioWordLayout');

/** The kind of block a look was made for: a paragraph, a heading of its level, a table. */
const blockKind = (node: PMNode | null | undefined): string => (node ? `${node.type.name}${node.attrs.level ?? ''}` : '');

function lookAttrs(l: BlockLook, numbered: boolean): Record<string, string> {
  const attrs: Record<string, string> = { class: `studio-wl${l.body ? ' studio-wl-body' : ''}${l.locked ? ' studio-wl-locked' : ''}` };
  if (l.locked) {                                       // Word makes or draws it: shown as it is, changed in Word
    attrs.contenteditable = 'false';
    attrs.title = 'Word makes this part itself (its table of contents, a text box or a diagram), so it is changed in Word, not here';
  }
  if (l.label && (numbered || !/[A-Za-z0-9]/.test(l.label))) attrs['data-num'] = l.label;   // a bullet repeats; a number waits for the layout
  const style = blockStyle(l, lineRatio);
  if (style) attrs.style = style;
  return attrs;
}

const lookOn = (from: number, node: PMNode, look: BlockLook, numbered = true): Decoration =>
  Decoration.node(from, from + node.nodeSize, lookAttrs(look, numbered), { look, kind: blockKind(node) });

/**
 * The looks after an edit. Each stays on its block while the block is still the kind it was made for (a paragraph made a
 * heading in the toolbar has a heading's look until the next layout). As in Word, a block split in two (Enter) keeps its look
 * on both halves - the number only on the first, the next layout numbers the rest - and two blocks joined keep the first one's.
 */
function carryLooks(set: DecorationSet, tr: Transaction): DecorationSet {
  const ranges = blockRanges(tr.doc);
  const index = new Map(ranges.map((r, i) => [r.from, i]));
  const before = set.find();
  const mapped = set.map(tr.mapping, tr.doc);
  const now = mapped.find();
  const fits = (d: Decoration) => {
    const r = ranges[index.get(d.from) ?? -1];
    return !!r && r.to === d.to && blockKind(r.node) === d.spec.kind;
  };
  if (now.length === before.length && now.every(fits)) return mapped;          // typing inside blocks: nothing moved
  const taken = new Set<number>();
  const out: Decoration[] = [];
  for (const d of before) {
    const from = tr.mapping.mapResult(d.from, 1);
    const to = tr.mapping.mapResult(d.to, -1);
    let i = from.deleted ? undefined : index.get(from.pos);
    for (let first = true; i !== undefined && i < ranges.length; i += 1, first = false) {
      const r = ranges[i];
      if (!first && (to.deleted || r.to > to.pos)) break;                       // past the pieces of the block it was on
      if (taken.has(r.from) || blockKind(r.node) !== d.spec.kind) continue;
      taken.add(r.from);
      out.push(lookOn(r.from, r.node, d.spec.look as BlockLook, first));
    }
  }
  return DecorationSet.create(tr.doc, out);
}

/**
 * What Word shows for each block of a Word file edited in place and its text does not hold: the number in front of it
 * ("1.3.1.1.", "II.", a bullet), its indent, its font, size, colour, alignment and spacing (so a heading looks as Word shows
 * it, not as the editor would), and clauses numbered through a heading style that look like body text. Node decorations, so
 * the numbers are not text and cannot be typed over; they move with the blocks as the person types (`carryLooks`), and the
 * page sends a new layout after each save. A layout for another number of blocks than the editor holds is not used: the one
 * before stays (a paragraph typed since has the page's normal look until the next one). The page (`page`: its width, margins
 * and normal text) is kept with the layout it came with.
 */
export const WordLayout = Extension.create({
  name: 'studioWordLayout',
  addProseMirrorPlugins() {
    return [
      new Plugin<WordLayoutState>({
        key: wordLayoutKey,
        state: {
          init: () => ({ set: DecorationSet.empty, on: false, page: null }),
          apply(tr, old) {
            const kept = tr.docChanged && old.on ? { ...old, set: carryLooks(old.set, tr) } : old;
            const meta = tr.getMeta(wordLayoutKey) as WordLayoutMeta | undefined;
            if (!meta) return kept;
            const { looks } = meta;
            if (!looks.length) return { set: DecorationSet.empty, on: false, page: null };   // not (or no longer) laid out as a Word file
            const ranges = blockRanges(tr.doc);
            if (ranges.length !== looks.length) return kept;
            const decorations: Decoration[] = [];
            ranges.forEach((r, i) => {
              if (looks[i] && Object.keys(looks[i]).length) decorations.push(lookOn(r.from, r.node, looks[i]));
            });
            return { set: DecorationSet.create(tr.doc, decorations), on: true, page: meta.page ?? null };
          },
        },
        props: {
          decorations: (state) => wordLayoutKey.getState(state)?.set ?? DecorationSet.empty,
          // lists take Word's own numbers and indents instead of the editor's
          attributes: (state): Record<string, string> => (wordLayoutKey.getState(state)?.on ? { class: 'studio-word' } : {}),
        },
      }),
    ];
  },
});

// ── where the server's blocks are in the document ────────────────────────────
/**
 * The position range of each block the server sees, in the server's order: a heading, a paragraph, each list item, a table,
 * a quote, a code block, a rule. (Used to point at a block from a check, or to mark what an AI change would touch.)
 */
export function blockRanges(doc: PMNode): { from: number; to: number; node: PMNode }[] {
  const out: { from: number; to: number; node: PMNode }[] = [];
  const list = (node: PMNode, pos: number) => {
    node.forEach((item, offset) => {
      const itemPos = pos + 1 + offset;
      item.forEach((child, childOffset) => {
        const childPos = itemPos + 1 + childOffset;
        if (child.type.name === 'bulletList' || child.type.name === 'orderedList') list(child, childPos);
        else out.push({ from: childPos, to: childPos + child.nodeSize, node: child });
      });
    });
  };
  doc.forEach((node, offset) => {
    const name = node.type.name;
    if (name === 'bulletList' || name === 'orderedList') list(node, offset);
    else out.push({ from: offset, to: offset + node.nodeSize, node });
  });
  return out;
}

/** The levels of the document's headings, in order. */
export function headingLevels(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'heading') out.push(node.attrs.level as number);
    return !node.isTextblock;
  });
  return out;
}

/** The first place `text` occurs inside the block range (or anywhere when no range is given); positions are exact. */
export function findTextRange(doc: PMNode, text: string, within?: { from: number; to: number }): { from: number; to: number } | null {
  const needle = text.replace(/\n/g, '￼');
  if (!needle.trim()) return null;
  let found: { from: number; to: number } | null = null;
  const lo = within?.from ?? 0;
  const hi = within?.to ?? doc.content.size;
  doc.nodesBetween(lo, hi, (node, pos) => {
    if (found || !node.isTextblock) return !found;
    const hay = node.textBetween(0, node.content.size, '\n', '￼');
    const at = hay.indexOf(needle);
    if (at >= 0) found = { from: pos + 1 + at, to: pos + 1 + at + needle.length };
    return false;
  });
  return found;
}
