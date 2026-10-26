'use client';

/**
 * The studio's document editor: a rich-text editor over Markdown (the platform's storage format). Headings, lists, bold,
 * italic, underline, links, quotes, code and real tables; placeholders that must be filled in are highlighted; the browser's
 * own spell check marks misspellings. `value` + `version` push a new document in (an accepted AI change, a restored
 * revision); `onChange` reports the person's own edits as Markdown.
 *
 * The document is a page of Word on a grey desk, the same in Edit, in View and while Comply Agent writes: a Word file edited
 * in place looks as its file sets it (`setLayout`: its page, and each block's font, size, colour, spacing, numbers and
 * indents), any other document as the platform's Word export sets it (wordLook.ts).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Markdown } from 'tiptap-markdown';
import {
  Bold as BoldIcon,
  Code,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import {
  Marks, Placeholders, StudioCell, StudioHeaderCell, StudioRow, StudioTable, WordLayout, blockRanges, findTextRange, headingLevels, marksKey, placeholderRanges,
  wordLayoutKey, type DocMark, type WordLayoutMeta,
} from './editorExtensions';
import { lineRatio } from '@/lib/fontLines';
import { oneTitle, sheetStyle } from './wordLook';
import type { BlockLook, PageLook } from '@/lib/studio/api';

export type EditorMode = 'edit' | 'view' | 'source';

export interface StudioEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  setMarks: (marks: DocMark[]) => void;
  /** a Word file's own numbers, indents, body-text clauses and typography, one look per block, and its page (see `WordLayout`) */
  setLayout: (looks: BlockLook[], page?: PageLook | null) => void;
  blockRanges: () => { from: number; to: number }[];
  /** where `quote` is (inside the given block when there is one); null when it is not found */
  rangeOf: (quote: string, block?: number | null) => { from: number; to: number } | null;
  goToBlock: (index: number) => void;
  findAndSelect: (quote: string, block?: number | null) => boolean;
  nextPlaceholder: () => boolean;
  focus: () => void;
}

interface Props {
  value: string;
  /** change this to push `value` into the editor (the editor otherwise keeps what the person typed) */
  version: number;
  mode: EditorMode;
  onChange: (markdown: string) => void;
}

/** Markdown as the server expects it: a placeholder is written as it was typed, and blocks are one blank line apart. */
export function cleanMarkdown(md: string): string {
  return `${md
    .replace(/\\\[\\\[([^\n]{1,200}?)\\\]\\\]/g, '[[$1]]')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

const read = (editor: Editor): string => cleanMarkdown(editor.storage.markdown.getMarkdown());

/**
 * Replace the document without reporting it as an edit, with the cursor back at the start (not wherever the old text ended).
 * Returns the Markdown the editor now writes for it. `quiet` is on while this runs: the editor tidies what it was given in a
 * follow-up step (table header cells), and that must not count as the person typing.
 */
function load(editor: Editor, markdown: string, quiet: { current: boolean }): string {
  quiet.current = true;
  try {
    editor.commands.setContent(markdown || '', false);
    editor.commands.setTextSelection(1);
    return read(editor);
  } finally {
    quiet.current = false;
  }
}

function Btn({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'bg-[#d6f3ec] text-[#0f766e]' : 'text-[#3f4b58] hover:bg-[#eef1f4]'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-[#d5dbe1]" aria-hidden />;
}

function TextBtn({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-1 text-[11px] font-medium text-[#3f4b58] hover:bg-[#eef1f4] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address', previous || 'https://');
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const level = ([1, 2, 3, 4, 5, 6] as const).find((l) => editor.isActive('heading', { level: l }));
  const inTable = editor.isActive('table');
  const inHeader = editor.isActive('tableHeader');
  return (
    <div className="border-b border-[#d5dbe1] bg-[#fff]">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1" role="toolbar" aria-label="Formatting">
        <Btn title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></Btn>
        <Btn title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></Btn>
        <Sep />
        <select
          aria-label="Paragraph style"
          value={level ? String(level) : 'p'}
          onChange={(e) => {
            const v = e.target.value;
            const chain = editor.chain().focus();
            if (v === 'p') chain.setParagraph().run();
            else chain.setHeading({ level: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }}
          className="rounded border border-[#d5dbe1] bg-white px-1.5 py-1 text-xs text-[#26323d]"
        >
          <option value="p">Paragraph</option>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l}>{`Heading ${l}`}</option>)}
        </select>
        <Sep />
        <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><BoldIcon className="h-4 w-4" /></Btn>
        <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><ItalicIcon className="h-4 w-4" /></Btn>
        <Btn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Btn>
        <Btn title="Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="h-4 w-4" /></Btn>
        <Btn title="Link" active={editor.isActive('link')} onClick={setLink}><LinkIcon className="h-4 w-4" /></Btn>
        <Btn title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Btn>
        <Btn title="Insert a table" disabled={inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /></Btn>
      </div>
      {inTable && (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-[#e1e6eb] bg-[#f6f9f8] px-2 py-1" role="toolbar" aria-label="Table">
          <span className="mr-1 text-xs font-semibold text-[#586472]">Table</span>
          <TextBtn title="Add a row below" onClick={() => editor.chain().focus().addRowAfter().run()}>Row below</TextBtn>
          <TextBtn title="Delete this row (the header row stays)" disabled={inHeader} onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</TextBtn>
          <Sep />
          <TextBtn title="Add a column on the left" onClick={() => editor.chain().focus().addColumnBefore().run()}>Column left</TextBtn>
          <TextBtn title="Add a column on the right" onClick={() => editor.chain().focus().addColumnAfter().run()}>Column right</TextBtn>
          <TextBtn title="Delete this column" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</TextBtn>
          <Sep />
          <TextBtn title="Delete the whole table" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</TextBtn>
        </div>
      )}
    </div>
  );
}

// The document's own rules carry three classes, so the dashboard's typography for bare p/td/th/h1-h3 and its table rules
// (11.5 px text, cell padding, striped rows; globals.css) never reach the page. `.studio-word` is on while a Word file's layout
// is (each block then also carries its own look inline); without it the page is the platform export's (exporters._style_doc).
const S = '.studio-editor .studio-sheet .studio-prose';
const T = '.studio-editor .studio-sheet.studio-one-title .studio-prose';
const W = '.studio-editor .studio-sheet .studio-prose.studio-word';
const SHEET_CSS = `
  .studio-desk { background: #e8ecf0; padding: 20px 12px; }
  .studio-sheet { box-sizing: border-box; margin: 0 auto; max-width: 100%; min-height: 100%; background: #fff; box-shadow: 0 1px 4px rgba(15, 23, 42, .18); }
  ${S} { outline: none; min-height: 50vh; font-family: var(--doc-font); font-size: var(--doc-size); line-height: var(--doc-line); color: var(--doc-color); text-align: var(--doc-align); font-weight: 400; font-style: normal; letter-spacing: normal; tab-size: 36pt; }
  ${S} p { margin: var(--doc-before) 0 var(--doc-after); font-size: inherit; font-weight: inherit; color: inherit; }
  ${S} :is(h1, h2, h3, h4, h5, h6) { font-family: inherit; font-weight: 700; color: inherit; letter-spacing: normal; line-height: inherit; text-transform: none; margin: 0 0 6pt; }
  ${S} h1, ${T} h2 { font-size: 16pt; margin-top: 16pt; font-style: normal; }
  ${S} h2, ${T} h3 { font-size: 13pt; margin-top: 12pt; font-style: normal; }
  ${S} h3, ${T} h4 { font-size: 11.5pt; margin-top: 10pt; font-style: normal; }
  ${S} :is(h4, h5, h6), ${T} :is(h5, h6) { font-size: 10.5pt; margin-top: 8pt; font-style: italic; }
  ${T} h1 { font-size: 24pt; margin-top: 0; line-height: 1; font-style: normal; }
  ${S} ul { list-style: disc; padding-left: 0.25in; margin: 0 0 3pt; }
  ${S} ul ul { list-style-type: circle; }
  ${S} ul ul ul { list-style-type: square; }
  ${S} ol { list-style: decimal; padding-left: 0.25in; margin: 0 0 3pt; }
  ${S} li { margin: 0; }
  ${S} li > p { margin: 0; }
  ${S} li > :is(ul, ol) { margin: 3pt 0; }
  ${S} blockquote { margin: 0 0 6pt calc(0.8cm - 10.25pt); padding-left: 8pt; border-left: 2.25pt solid #808080; color: #404040; font-style: italic; }
  ${S} blockquote p { margin: 0; }
  ${S} code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; }
  ${S} pre { font-family: Consolas, "Courier New", monospace; font-size: 9pt; margin: 0; white-space: pre-wrap; }
  ${S} pre code { font-size: inherit; }
  ${S} hr { border: none; border-top: 0.75pt solid #808080; margin: 13pt 0 6pt; }
  ${S} a { color: #0563C1; text-decoration: underline; cursor: pointer; }
  ${S} table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0 0 16pt; }
  ${S} tr { background: transparent; }
  ${S} :is(th, td) { border: 0.5pt solid #000; padding: 0 5.4pt; vertical-align: top; text-align: left; word-break: break-word; font-size: inherit; color: inherit; background: transparent; }
  ${S} th { background: var(--head-fill, #F2F2F2); color: var(--head-ink, inherit); font-weight: 700; }
  ${S} :is(td, th) > p { margin: 0 0 2pt; }
  ${W} :is(h1, h2, h3, h4, h5, h6) { font-size: inherit; font-style: normal; line-height: inherit; margin: var(--doc-before) 0 var(--doc-after); }
  ${W} .studio-wl-body { font-weight: 400; }
  ${W} :is(ul, ol) { list-style: none; padding-left: 0; margin: 0; }
  ${W} li > p { margin: var(--doc-before) 0 var(--doc-after); }
  ${W} table { margin: 0; }
  ${W} th { font-weight: 400; background: var(--head-fill, transparent); }
  ${W} :is(td, th) > p { margin: 0; }
  ${S} :is(td, th).selectedCell { background: #cfe9e4; }
  .studio-prose .studio-ph { background: #fff2a8; box-shadow: 0 0 0 1px #f0d54a; border-radius: 2px; }
  .studio-prose .studio-issue-error { text-decoration: underline wavy #dc2626; text-underline-offset: 3px; }
  .studio-prose .studio-issue-warning { text-decoration: underline wavy #d97706; text-underline-offset: 3px; }
  .studio-prose .studio-issue-info { text-decoration: underline dotted #2563eb; text-underline-offset: 3px; }
  .studio-prose .studio-pending { background: #e6f4f1; box-shadow: -4px 0 0 #1ed4b0; }
  .studio-prose .studio-focus { background: #fff7d6; }
  .studio-prose .studio-focus-block { background: #fffbeb; box-shadow: -5px 0 0 #f59e0b, 0 0 0 1px #fcd34d; border-radius: 4px; animation: studio-focus-in 1.6s ease-out 1; }
  .studio-prose .studio-focus-text { background: #fde68a; box-shadow: 0 0 0 2px #fde68a; border-radius: 2px; }
  @keyframes studio-focus-in { 0% { background: #fde68a; } 100% { background: #fffbeb; } }
  @media (prefers-reduced-motion: reduce) { .studio-prose .studio-focus-block { animation: none; } }
  .studio-prose .studio-wl[data-num]::before { content: attr(data-num); display: inline-block; min-width: var(--label, var(--hang, 0)); padding-right: 0.5em; box-sizing: border-box; text-indent: 0; }
  .studio-prose .studio-wl-locked { background: #f1f5f6; border-left: 3px solid #b8c7cc; padding-left: 0.5em; padding-right: 0.5em; cursor: default; white-space: pre-wrap; tab-size: 4; }
  .studio-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #9aa5b1; pointer-events: none; float: left; height: 0; }
`;

const StudioEditor = forwardRef<StudioEditorHandle, Props>(function StudioEditor({ value, version, mode, onChange }, ref) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [source, setSource] = useState(value);
  const [, force] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  // The Markdown the editor last reported or was last given. The editor writes Markdown its own way (and tidies tables), so
  // loading a document can "change" it without the person typing: only a real difference from this is an edit.
  const baseline = useRef<string | null>(null);
  const quiet = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: mode === 'edit',
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false }),
      StudioTable.configure({ resizable: false }),
      StudioRow,
      StudioHeaderCell,
      StudioCell,
      Placeholders,
      Marks,
      WordLayout,
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false, transformPastedText: true, transformCopiedText: false }),
    ],
    content: value || '',
    editorProps: { attributes: { class: 'studio-prose', spellcheck: 'true', 'aria-label': 'Document' } },
    onCreate: ({ editor: e }) => { baseline.current = read(e); },
    onUpdate: ({ editor: e }) => {
      if (quiet.current) return;
      const md = read(e);
      if (md === baseline.current) return;
      baseline.current = md;
      onChangeRef.current(md);
    },
    onTransaction: () => force((n) => n + 1),                        // keep the toolbar's active states current
  });

  // a new document pushed in from outside (an accepted change, a restored revision, a fix)
  const shown = useRef(version);
  useEffect(() => {
    if (!editor || shown.current === version) return;
    shown.current = version;
    const top = scroller.current?.scrollTop ?? 0;
    baseline.current = load(editor, value, quiet);
    setSource(value);
    requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = top; });
  }, [editor, version, value]);

  useEffect(() => {
    editor?.setEditable(mode === 'edit', false);                  // (false: switching to View must not count as an edit)
  }, [editor, mode]);

  // a layout that came before the editor was ready is put on when it is; the last one is put on again when the text is reloaded
  // from the Markdown view (a reload takes the old one off the blocks)
  const pendingLayout = useRef<WordLayoutMeta | null>(null);
  const lastLayout = useRef<WordLayoutMeta | null>(null);
  const putLayout = useCallback((looks: BlockLook[], page?: PageLook | null) => {
    const meta: WordLayoutMeta = { looks, page };
    lastLayout.current = meta;
    if (!editor) { pendingLayout.current = meta; return; }
    pendingLayout.current = null;
    editor.view.dispatch(editor.state.tr.setMeta(wordLayoutKey, meta).setMeta('addToHistory', false));
  }, [editor]);
  useEffect(() => { if (editor && pendingLayout.current) putLayout(pendingLayout.current.looks, pendingLayout.current.page); }, [editor, putLayout]);

  // Source <-> editor: leaving the source view puts what was typed there into the editor
  const previousMode = useRef<EditorMode>(mode);
  useEffect(() => {
    if (!editor) return;
    if (previousMode.current === 'source' && mode !== 'source') {
      baseline.current = load(editor, source, quiet);
      if (lastLayout.current) putLayout(lastLayout.current.looks, lastLayout.current.page);
    }
    if (previousMode.current !== 'source' && mode === 'source') setSource(read(editor));
    previousMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editor]);

  const scrollTo = useCallback((pos: number) => {
    if (!editor) return;
    try {
      const node = editor.view.domAtPos(Math.min(pos, editor.state.doc.content.size)).node;
      const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      /* the position is not in the DOM yet */
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => (mode === 'source' ? source : editor ? read(editor) : value),
    setMarkdown: (md) => {
      if (!editor) return;
      baseline.current = load(editor, md, quiet);
      setSource(md);
    },
    setMarks: (marks) => {
      if (editor) editor.view.dispatch(editor.state.tr.setMeta(marksKey, marks).setMeta('addToHistory', false));
    },
    setLayout: putLayout,
    blockRanges: () => (editor ? blockRanges(editor.state.doc) : []),
    rangeOf: (quote, block) => {
      if (!editor) return null;
      const within = block != null ? blockRanges(editor.state.doc)[block] : undefined;
      return findTextRange(editor.state.doc, quote, within) ?? null;
    },
    goToBlock: (index) => {
      if (!editor) return;
      const r = blockRanges(editor.state.doc)[index];
      if (!r) return;
      editor.chain().setTextSelection(Math.min(r.from + 1, editor.state.doc.content.size)).run();
      scrollTo(r.from + 1);
    },
    findAndSelect: (quote, block) => {
      if (!editor) return false;
      const within = block != null ? blockRanges(editor.state.doc)[block] : undefined;
      const range = findTextRange(editor.state.doc, quote, within) ?? (within ? findTextRange(editor.state.doc, quote) : null);
      if (!range) {
        if (within) scrollTo(within.from + 1);
        return false;
      }
      editor.chain().setTextSelection(range).run();
      scrollTo(range.from);
      return true;
    },
    nextPlaceholder: () => {
      if (!editor) return false;
      const all = placeholderRanges(editor.state.doc);
      if (!all.length) return false;
      const at = editor.state.selection.to;
      const next = all.find((r) => r.from >= at) ?? all[0];
      editor.chain().setTextSelection(next).run();
      scrollTo(next.from);
      return true;
    },
    focus: () => editor?.commands.focus(),
  }), [editor, mode, source, value, scrollTo, putLayout]);

  // the Word file's page and look while its layout is on, else the export's (a lone first # is then the Title)
  const layout = editor ? wordLayoutKey.getState(editor.state) : undefined;
  const word = !!layout?.on;
  const titled = !word && !!editor && oneTitle(headingLevels(editor.state.doc));

  return (
    <div className="studio-editor flex h-full min-h-0 flex-col">
      {mode === 'edit' && editor && <Toolbar editor={editor} />}
      <div ref={scroller} className="studio-desk min-h-0 flex-1 overflow-y-auto">
        {mode === 'source' ? (
          <textarea
            aria-label="Markdown source"
            value={source}
            onChange={(e) => { setSource(e.target.value); onChange(cleanMarkdown(e.target.value)); }}
            spellCheck={false}
            className="mx-auto block min-h-[60vh] w-full max-w-[860px] resize-y rounded-lg border border-[#c5ccd3] bg-white p-4 font-mono text-xs leading-relaxed text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]"
          />
        ) : (
          <div className={`studio-sheet${titled ? ' studio-one-title' : ''}`} style={sheetStyle(word ? layout?.page : null, lineRatio) as React.CSSProperties}>
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
      <style>{SHEET_CSS}</style>
    </div>
  );
});

export default StudioEditor;
