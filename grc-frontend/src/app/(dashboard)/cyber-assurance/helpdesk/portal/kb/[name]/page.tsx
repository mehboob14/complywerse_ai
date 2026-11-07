"use client";

/**
 * Requester portal — single Knowledge Base article (read).
 *
 * Reads the requester-safe GET /helpdesk/portal/kb/{name} (gated
 * helpdesk:requests:view_own; get_article's non-agent gate means a requester
 * only ever reads a Published article's body — Draft/Archived -> 403, cross-tenant
 * -> 404). Body is author-written HTML from the same tenant, rendered with prose.
 */
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen } from "lucide-react";
import { ErrorBanner, Loading, useHd } from "../../../_ui";

const fmtDate = (v?: string | null) =>
  v && !isNaN(new Date(v).getTime()) ? new Date(v).toLocaleDateString() : null;

export default function PortalKbArticle() {
  const params = useParams();
  const name = decodeURIComponent(String(params.name));
  const { data: a, loading, error } = useHd<any>(`/helpdesk/portal/kb/${encodeURIComponent(name)}`);

  if (loading) return <div className="p-6"><Loading what="the article" /></div>;
  if (!a || error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href="/cyber-assurance/helpdesk/portal/kb" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> Knowledge Base
        </Link>
        {error ? <ErrorBanner msg={error} /> : <div className="mt-10 text-center text-slate-500">We couldn't find that article.</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 text-[#0F172A]">
      <Link href="/cyber-assurance/helpdesk/portal/kb" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
        <ArrowLeft size={13} /> Knowledge Base
      </Link>
      <div>
        {a.category_name && (
          <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#005B96]">
            <BookOpen size={13} /> {a.category_name}
          </div>
        )}
        <h1 className="text-xl font-semibold text-[#0F172A]">{a.title || `Article ${name}`}</h1>
        {fmtDate(a.modified) && <p className="mt-1 text-xs text-slate-400">Updated {fmtDate(a.modified)}</p>}
      </div>
      <article className="prose prose-sm max-w-none rounded-2xl border border-[#EEF1F5] bg-white p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.content || "_No content yet._"}</ReactMarkdown>
      </article>
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-[#F9FAFC] p-4">
        <span className="text-sm text-slate-600">Didn't solve it?</span>
        <Link href="/cyber-assurance/helpdesk/portal/report" className="text-sm font-medium text-[#005B96] hover:underline">Report an issue</Link>
      </div>
    </div>
  );
}
