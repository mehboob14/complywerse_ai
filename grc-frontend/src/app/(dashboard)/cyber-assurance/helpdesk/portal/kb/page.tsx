"use client";

/**
 * Requester portal — "Help / Knowledge Base".
 *
 * Self-help article browser for end users. Reads the requester-safe endpoint
 * GET /helpdesk/portal/kb (gated helpdesk:requests:view_own) — NOT the agent
 * /helpdesk/articles endpoint, which needs helpdesk:tickets:view.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, FileText, Search, MessageSquareText } from "lucide-react";
import { ErrorBanner, Empty, Loading, PageHeader, RefreshBtn, timeAgo, useHd } from "../../_ui";
import { Btn } from "../../_admin";

// Requesters only see finished articles — hide drafts / archived ones.
const hiddenRe = /draft|archiv/i;

export default function PortalKnowledgeBase() {
  const { data, loading, error, reload } = useHd<{ articles: any[] }>("/helpdesk/portal/kb");
  const [q, setQ] = useState("");

  const articles: any[] = useMemo(
    () => (Array.isArray(data?.articles) ? data!.articles : []).filter((a) => !hiddenRe.test(a.status || "")),
    [data],
  );

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const m = new Map<string, any[]>();
    articles
      .filter((a) => !s || [a.title, a.category].some((v) => (v || "").toLowerCase().includes(s)))
      .forEach((a) => {
        const c = a.category || "General";
        m.set(c, (m.get(c) || []).concat([a]));
      });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [articles, q]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 text-[#0F172A]">
      <PageHeader
        icon={BookOpen}
        title="Help / Knowledge Base"
        subtitle="Find answers yourself, or raise a request if you can't."
        actions={
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search help articles…"
                className="w-64 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[#005B96]"
              />
            </div>
            <RefreshBtn onClick={reload} loading={loading} />
          </>
        }
      />

      {error && <ErrorBanner msg={error} />}

      {loading ? (
        <Loading what="help articles" />
      ) : groups.length === 0 ? (
        <Empty
          icon={BookOpen}
          title={q ? "No matching articles" : "No help articles yet"}
          hint={q ? "Try a different search, or raise a request." : "Nothing published yet — use “Report an issue” and we'll help."}
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <section key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#0F172A]">{cat}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((a) => (
                  <Link
                    key={a.name}
                    href={`/cyber-assurance/helpdesk/portal/kb/${encodeURIComponent(a.name)}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[#005B96] hover:shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <FileText size={18} className="mt-0.5 shrink-0 text-[#005B96]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#0F172A]">{a.title || a.name}</div>
                        <div className="mt-1 text-xs text-slate-500">Updated {timeAgo(a.modified)}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-[#F9FAFC] p-4">
        <span className="text-sm text-slate-600">Can't find what you need?</span>
        <Link href="/cyber-assurance/helpdesk/portal/report">
          <Btn variant="primary" icon={<MessageSquareText size={14} />}>Report an issue</Btn>
        </Link>
      </div>
    </div>
  );
}
