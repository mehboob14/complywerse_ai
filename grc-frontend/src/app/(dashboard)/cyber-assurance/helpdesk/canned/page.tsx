"use client";

import { useMemo, useState } from "react";
import { MessageSquareText, Search } from "lucide-react";
import { Avatar, PageHeader, RefreshBtn, Empty, ErrorBanner, Loading, useHd } from "../_ui";

const strip = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export default function CannedResponsesPage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/canned-responses");
  const [q, setQ] = useState("");
  const items: any[] = Array.isArray(data?.responses) ? data.responses : [];
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return items.filter((r) => !s || [r.title, r.owner, r.response, r.message].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [items, q]);

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={MessageSquareText} title="Canned Responses" subtitle={`${items.length} response${items.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search responses…"
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="canned responses" /> : rows.length === 0 ? <Empty icon={MessageSquareText} title="No canned responses" hint={q ? "Try a different search." : undefined} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const preview = strip(String(r.response || r.message || ""));
            return (
              <div key={r.name} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-[var(--color-text)]">{r.title || r.name}</h3>
                {preview && <p className="mt-1 line-clamp-3 text-sm text-slate-500">{preview}</p>}
                <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-slate-500">
                  <Avatar name={r.owner} size={20} /> {r.owner || "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
