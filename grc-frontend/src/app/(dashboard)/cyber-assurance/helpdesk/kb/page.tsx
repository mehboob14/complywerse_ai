"use client";

/**
 * Agent Console — Knowledge Base (list + authoring).
 *
 * Agents with helpdesk:kb:author can create/edit articles here (the list used to
 * be read-only — there was no authoring UI, so KB could only be filled via the
 * API). Content is Markdown (stored as-is, rendered with react-markdown on the
 * detail pages), so the editor is a Markdown textarea with a live preview — NOT
 * the HTML RichComposer used for ticket replies.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Search, FileText, Eye, ThumbsUp, ThumbsDown, Pencil } from "lucide-react";
import { Chip, PageHeader, RefreshBtn, Empty, ErrorBanner, Loading, timeAgo, useHd } from "../_ui";
import { Modal, Field, Input, Textarea, Select, Btn, NewBtn, hdCall } from "../_admin";
import { apiClient } from "@/cyber-assurance/lib/api";

const STATUSES = ["Draft", "Published", "Archived"];

type Cat = { id: string; name: string };

function ComposeModal({ articleId, categories, onClose, onSaved }: {
  articleId: string | null; // null = new article
  categories: Cat[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!articleId;
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("Draft");
  const [content, setContent] = useState("");
  const [cats, setCats] = useState<Cat[]>(categories);
  const [newCat, setNewCat] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const res = await apiClient.get(`/helpdesk/articles/${encodeURIComponent(articleId!)}`);
        const a = res.data || {};
        setTitle(a.title || "");
        setContent(a.content || "");
        setStatus(a.status || "Draft");
        setCategoryId(a.category_id ? String(a.category_id) : "");
      } catch {
        setErr("Couldn't load the article to edit.");
      } finally {
        setLoading(false);
      }
    })();
  }, [editing, articleId]);

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", "/helpdesk/kb/categories", { title: name });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn't create the category."); return; }
    const id = String(r.data?.category || "");
    setCats((c) => [...c, { id, name }]);
    setCategoryId(id);
    setNewCat("");
  };

  const save = async () => {
    if (!title.trim()) { setErr("Give the article a title."); return; }
    if (status === "Published" && !content.trim()) { setErr("Published articles need content."); return; }
    setBusy(true); setErr(null);
    const body: any = { title: title.trim(), status, content };
    if (categoryId) body.category_id = Number(categoryId);
    const r = editing
      ? await hdCall("put", `/helpdesk/articles/${encodeURIComponent(articleId!)}`, body)
      : await hdCall("post", "/helpdesk/articles", body);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn't save the article."); return; }
    onSaved();
  };

  return (
    <Modal open wide onClose={() => !busy && onClose()} title={editing ? "Edit article" : "New article"}
      footer={<>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} busy={busy} disabled={loading}>{editing ? "Save" : "Create"}</Btn>
      </>}>
      {loading ? <Loading what="the article" /> : (
        <div className="flex flex-col gap-4">
          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How to reset your password" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="Optional">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(no category)</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="New category" hint="Creates it and selects it above">
                <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Category name" />
              </Field>
            </div>
            <Btn variant="ghost" onClick={addCategory} disabled={busy || !newCat.trim()}>Add</Btn>
          </div>
          <Field label="Content" hint="Markdown supported — headings (##), **bold**, lists, links.">
            <div className="mb-1 flex justify-end">
              <button type="button" onClick={() => setPreview((p) => !p)} className="text-xs font-medium text-[var(--color-base)] hover:underline">
                {preview ? "Edit" : "Preview"}
              </button>
            </div>
            {preview ? (
              <div className="prose prose-sm max-w-none min-h-[220px] rounded-lg border border-slate-200 bg-white p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || "_Nothing to preview yet._"}</ReactMarkdown>
              </div>
            ) : (
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12}
                placeholder={"## Symptom\nWhat the user sees.\n\n## Cause\nWhy it happens.\n\n## Resolution\nStep-by-step fix."} />
            )}
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default function KnowledgeBasePage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/articles");
  const catsRes = useHd<any>("/helpdesk/kb/categories");
  const [q, setQ] = useState("");
  const [compose, setCompose] = useState<{ id: string | null } | null>(null);

  const articles: any[] = Array.isArray(data?.articles) ? data.articles : [];
  const categories: Cat[] = useMemo(
    () => (Array.isArray(catsRes.data?.categories) ? catsRes.data.categories : [])
      .map((c: any) => ({ id: String(c.name), name: c.category_name })),
    [catsRes.data],
  );

  const groups = useMemo(() => {
    const s = q.toLowerCase();
    const m = new Map<string, any[]>();
    articles.filter((a) => !s || [a.title, a.category, a.author].some((v) => (v || "").toLowerCase().includes(s)))
      .forEach((a) => { const c = a.category || "Uncategorized"; m.set(c, [...(m.get(c) || []), a]); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [articles, q]);

  const onSaved = () => { setCompose(null); reload(); catsRes.reload(); };

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={BookOpen} title="Knowledge Base" subtitle={`${articles.length} article${articles.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…"
              className="w-72 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
          <NewBtn label="New article" onClick={() => setCompose({ id: null })} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="articles" /> : groups.length === 0 ? (
        <Empty icon={BookOpen} title="No articles yet" hint={q ? "Try a different search." : 'Use "New article" to write your first one.'} />
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <section key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--color-text)]">{cat}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => (
                  <div key={a.name} className="relative rounded-xl border border-slate-200 bg-white transition hover:border-[var(--color-base)] hover:shadow-sm">
                    <Link href={`/cyber-assurance/helpdesk/kb/${encodeURIComponent(a.name)}`} className="block p-4">
                      <div className="flex items-start gap-3">
                        <FileText size={18} className="mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate pr-8 font-medium text-[var(--color-text)]">{a.title || a.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{a.author || "Unknown author"} · updated {timeAgo(a.modified)}</div>
                          <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1"><Eye size={12} />{a.views ?? 0}</span>
                            {(a.helpful > 0 || a.not_helpful > 0) && <>
                              <span className="inline-flex items-center gap-1 text-emerald-600"><ThumbsUp size={12} />{a.helpful}</span>
                              <span className="inline-flex items-center gap-1 text-slate-400"><ThumbsDown size={12} />{a.not_helpful}</span>
                            </>}
                            <Chip value={a.status || "Draft"} />
                          </div>
                        </div>
                      </div>
                    </Link>
                    <button type="button" onClick={() => setCompose({ id: String(a.name) })} title="Edit article"
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[var(--color-base)]">
                      <Pencil size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {compose && <ComposeModal articleId={compose.id} categories={categories} onClose={() => setCompose(null)} onSaved={onSaved} />}
    </div>
  );
}
