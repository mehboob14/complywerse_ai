'use client';

// ─────────────────────────────────────────────────────────────────────────────
// RichTextEditor — user-friendly WYSIWYG for governance document content.
//
//  • Loads the document's existing **markdown** and renders it as formatted text
//    (headings, bold, lists, quotes…) — the user never sees `#`, `**`, `---`.
//  • Serializes back to **markdown** on every change, so storage format is
//    UNCHANGED and everything downstream (parser, AI, react-markdown viewer)
//    keeps working exactly as before. This is a drop-in for the old <textarea>:
//    same `value` (markdown string) in, same markdown string out via onChange.
//  • SSR-safe (immediatelyRender:false) and degrades to a plain textarea before
//    the editor mounts, so it can never block the modal.
//  • "Markdown" toggle reveals the raw source for power users / as a safety net.
// ─────────────────────────────────────────────────────────────────────────────

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useState } from 'react';
import {
  Bold as BoldIcon, Italic as ItalicIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code, Link as LinkIcon, Undo2, Redo2, Minus, Eye, Pencil,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 240 }: RichTextEditorProps) {
  const [mode, setMode] = useState<'rich' | 'markdown'>('rich');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true }),
    ],
    content: value || '',
    editorProps: {
      attributes: { class: 'ProseMirror-rte', style: `min-height:${minHeight}px` },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  // Re-sync when the value is replaced externally (AI draft, template pick, edit
  // load) — but never clobber the user mid-type (only when the editor is idle).
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if ((value || '') !== current && !editor.isFocused) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // Before the editor mounts (or if it failed), fall back to a plain textarea so
  // editing always works.
  if (!editor) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900"
        placeholder={placeholder}
      />
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const Btn = ({ onClick, active, title, children, disabled }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean;
  }) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 ${active ? 'bg-indigo-100 text-indigo-700' : ''}`}
    >
      {children}
    </button>
  );

  return (
    <div className="rte-editor rounded-lg border border-gray-300 bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-1.5 py-1">
        {mode === 'rich' && (
          <>
            <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><BoldIcon className="h-4 w-4" /></Btn>
            <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><ItalicIcon className="h-4 w-4" /></Btn>
            <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
            <span className="mx-1 h-5 w-px bg-gray-200" />
            <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Btn>
            <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Btn>
            <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></Btn>
            <span className="mx-1 h-5 w-px bg-gray-200" />
            <Btn title="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
            <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
            <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Btn>
            <Btn title="Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="h-4 w-4" /></Btn>
            <Btn title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Btn>
            <Btn title="Link" active={editor.isActive('link')} onClick={setLink}><LinkIcon className="h-4 w-4" /></Btn>
            <span className="mx-1 h-5 w-px bg-gray-200" />
            <Btn title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></Btn>
            <Btn title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></Btn>
          </>
        )}
        {mode === 'markdown' && (
          <span className="px-1.5 text-[11px] font-medium text-gray-400">Raw markdown source</span>
        )}
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'rich' ? 'markdown' : 'rich'))}
          className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100"
          title={mode === 'rich' ? 'Show raw markdown' : 'Back to formatted editor'}
        >
          {mode === 'rich' ? <><Eye className="h-3.5 w-3.5" /> Markdown</> : <><Pencil className="h-3.5 w-3.5" /> Formatted</>}
        </button>
      </div>

      {/* Editor body */}
      {mode === 'rich' ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight }}
          className="w-full resize-y px-3 py-2 font-mono text-xs text-slate-800 focus:outline-none"
          placeholder={placeholder}
        />
      )}

      {/* Scoped content styling (Tailwind preflight strips heading/list defaults,
          so we restore them only inside the editor). */}
      <style>{`
        .rte-editor .ProseMirror-rte { outline: none; padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #0f172a; line-height: 1.55; }
        .rte-editor .ProseMirror-rte:focus { outline: none; }
        .rte-editor .ProseMirror-rte h1 { font-size: 1.4rem; font-weight: 700; margin: 0.6em 0 0.3em; }
        .rte-editor .ProseMirror-rte h2 { font-size: 1.2rem; font-weight: 700; margin: 0.5em 0 0.3em; }
        .rte-editor .ProseMirror-rte h3 { font-size: 1.05rem; font-weight: 600; margin: 0.4em 0 0.2em; }
        .rte-editor .ProseMirror-rte p { margin: 0.3em 0; }
        .rte-editor .ProseMirror-rte ul { list-style: disc; padding-left: 1.4em; margin: 0.3em 0; }
        .rte-editor .ProseMirror-rte ol { list-style: decimal; padding-left: 1.4em; margin: 0.3em 0; }
        .rte-editor .ProseMirror-rte li { margin: 0.15em 0; }
        .rte-editor .ProseMirror-rte blockquote { border-left: 3px solid #e5e7eb; padding-left: 0.8em; color: #4b5563; margin: 0.4em 0; }
        .rte-editor .ProseMirror-rte code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 0.25em; font-size: 0.85em; }
        .rte-editor .ProseMirror-rte hr { border: none; border-top: 1px solid #e5e7eb; margin: 0.8em 0; }
        .rte-editor .ProseMirror-rte a { color: #4f46e5; text-decoration: underline; }
        .rte-editor .ProseMirror-rte:first-child { margin-top: 0; }
      `}</style>
    </div>
  );
}
