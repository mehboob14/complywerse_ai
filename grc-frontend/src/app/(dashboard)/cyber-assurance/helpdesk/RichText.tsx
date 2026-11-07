"use client";

// Small rich-text reply composer (TipTap — already a dependency). Produces HTML.
// Controlled via `value`; the parent remounts it with a new `key` to re-seed
// content (canned-reply insert / clear-after-send), so typing never remounts.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import { Bold, Italic, List, ListOrdered, Link2 } from "lucide-react";

export function isEmptyHtml(html: string): boolean {
  return !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function RichComposer({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, LinkExt.configure({ openOnClick: false })],
    content: value || "",
    immediatelyRender: false, // app-router SSR safety
    editorProps: { attributes: { class: "prose prose-sm max-w-none min-h-[88px] px-3 py-2 focus:outline-none" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;

  const Btn = ({ on, active, label, children }: { on: () => void; active: boolean; label: string; children: React.ReactNode }) => (
    <button type="button" title={label} aria-label={label}
      onMouseDown={(e) => { e.preventDefault(); on(); }}
      className={`rounded p-1.5 ${active ? "bg-slate-200 text-slate-800" : "text-slate-500 hover:bg-slate-100"}`}>{children}</button>
  );
  const toggleLink = () => {
    if (editor.isActive("link")) { editor.chain().focus().unsetLink().run(); return; }
    const url = window.prompt("Link URL");
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rounded-lg border border-slate-200 focus-within:border-[var(--color-base)]">
      <div className="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1">
        <Btn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></Btn>
        <Btn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></Btn>
        <Btn label="Bullet list" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></Btn>
        <Btn label="Numbered list" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></Btn>
        <Btn label="Link" active={editor.isActive("link")} on={toggleLink}><Link2 size={14} /></Btn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
