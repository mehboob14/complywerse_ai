"use client";

/**
 * Agent Console — single Knowledge Base article (read).
 *
 * Reads GET /helpdesk/articles/{name} (gated helpdesk:tickets:view). Agents may
 * read Draft/Archived as well as Published. Body is author-written HTML from the
 * same tenant, rendered with prose.
 */
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen, Eye } from "lucide-react";
import { Chip, ErrorBanner, Loading, useHd } from "../../_ui";

const fmtDate = (v?: string | null) =>
  v && !isNaN(new Date(v).getTime()) ? new Date(v).toLocaleDateString() : null;

export default function KbArticle() {
  const params = useParams();
  const name = decodeURIComponent(String(params.name));
  const { data: a, loading, error } = useHd<any>(`/helpdesk/articles/${encodeURIComponent(name)}`);

  if (loading) return <div className="p-6"><Loading what="the article" /></div>;
  if (!a || error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href="/cyber-assurance/helpdesk/kb" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> Knowledge Base
        </Link>
        {error ? <ErrorBanner msg={error} /> : <div className="mt-10 text-center text-slate-500">Article not found.</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6 text-[var(--color-text)]">
      <Link href="/cyber-assurance/helpdesk/kb" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
        <ArrowLeft size={13} /> Knowledge Base
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          {a.category_name && (
            <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-base)]">
              <BookOpen size={13} /> {a.category_name}
            </div>
          )}
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{a.title || `Article ${name}`}</h1>
          <p className="mt-1 text-xs text-slate-400">
            {a.author || "Unknown author"}
            {fmtDate(a.modified) ? ` · updated ${fmtDate(a.modified)}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><Eye size={12} />{a.views ?? 0}</span>
          </div>
        </div>
        <Chip value={a.status || "Draft"} />
      </div>
      <article className="prose prose-sm max-w-none rounded-2xl border border-slate-200 bg-white p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.content || "_No content yet._"}</ReactMarkdown>
      </article>
    </div>
  );
}
