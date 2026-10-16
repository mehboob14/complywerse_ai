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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { placeholderSpans } from '@/lib/studio/text';
import type { BlockLook } from '@/lib/studio/api';

const NO_SPANS = {
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
};

const cellKeys = {
  // a new line inside a cell is a line break, not a second paragraph (a cell holds one paragraph)
  Enter: ({ editor }: { editor: { commands: { setHardBreak: () => boolean } } }) => editor.commands.setHardBreak(),
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

// ── a Word file's own numbers and indents ────────────────────────────────────
export const wordLayoutKey = new PluginKey<{ set: DecorationSet; on: boolean }>('studioWordLayout');

/**
 * What Word shows for each block of a Word file edited in place and its text does not hold: the number in front of it
 * ("1.3.1.1.", "II.", a bullet), its indent, and clauses numbered through a heading style that look like body text. Node
 * decorations, so the numbers are not text and cannot be typed over; they move with the blocks as the person types, and the
 * page sends a new layout after each save. A layout for another number of blocks than the editor holds is not used.
 */
export const WordLayout = Extension.create({
  name: 'studioWordLayout',
  addProseMirrorPlugins() {
    return [
      new Plugin<{ set: DecorationSet; on: boolean }>({
        key: wordLayoutKey,
        state: {
          init: () => ({ set: DecorationSet.empty, on: false }),
          apply(tr, old) {
            const looks = tr.getMeta(wordLayoutKey) as BlockLook[] | undefined;
            if (!looks) return { set: old.set.map(tr.mapping, tr.doc), on: old.on };
            const ranges = blockRanges(tr.doc);
            if (!looks.length || ranges.length !== looks.length) return { set: DecorationSet.empty, on: false };
            const decorations: Decoration[] = [];
            ranges.forEach((r, i) => {
              const l = looks[i];
              if (!l || !(l.label || l.left || l.hang || l.body || l.locked)) return;
              const attrs: Record<string, string> = { class: `studio-wl${l.body ? ' studio-wl-body' : ''}${l.locked ? ' studio-wl-locked' : ''}` };
              if (l.locked) {                                       // Word makes or draws it: shown as it is, changed in Word
                attrs.contenteditable = 'false';
                attrs.title = 'Word makes this part itself (its table of contents, a text box or a diagram), so it is changed in Word, not here';
              }
              if (l.label) attrs['data-num'] = l.label;
              if (l.left || l.hang) attrs.style = `padding-left:${l.left ?? 0}pt;text-indent:${-(l.hang ?? 0)}pt;--hang:${Math.max(0, l.hang ?? 0)}pt`;
              decorations.push(Decoration.node(r.from, r.to, attrs));
            });
            return { set: DecorationSet.create(tr.doc, decorations), on: true };
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
export function blockRanges(doc: PMNode): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const list = (node: PMNode, pos: number) => {
    node.forEach((item, offset) => {
      const itemPos = pos + 1 + offset;
      item.forEach((child, childOffset) => {
        const childPos = itemPos + 1 + childOffset;
        if (child.type.name === 'bulletList' || child.type.name === 'orderedList') list(child, childPos);
        else out.push({ from: childPos, to: childPos + child.nodeSize });
      });
    });
  };
  doc.forEach((node, offset) => {
    const name = node.type.name;
    if (name === 'bulletList' || name === 'orderedList') list(node, offset);
    else out.push({ from: offset, to: offset + node.nodeSize });
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
