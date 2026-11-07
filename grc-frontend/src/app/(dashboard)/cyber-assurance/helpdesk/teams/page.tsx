"use client";

import { useMemo, useState } from "react";
import { Users, Search } from "lucide-react";
import { Avatar, PageHeader, RefreshBtn, Empty, ErrorBanner, Loading, useHd } from "../_ui";

export default function TeamsPage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/teams");
  const [q, setQ] = useState("");
  const teams: any[] = Array.isArray(data?.teams) ? data.teams : [];
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return teams.filter((t) => !s || (t.team_name || t.name || "").toLowerCase().includes(s));
  }, [teams, q]);

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={Users} title="Teams" subtitle={`${teams.length} team${teams.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams…"
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="teams" /> : rows.length === 0 ? <Empty icon={Users} title="No teams found" hint={q ? "Try a different search." : undefined} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => {
            const members: any[] = Array.isArray(t.members) ? t.members : [];
            return (
              <div key={t.name} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--color-text)]">{t.team_name || t.name}</h3>
                  {t.assignment_rule && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{t.assignment_rule}</span>}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {members.slice(0, 5).map((m, i) => (
                      <span key={m.name || i} className="rounded-full ring-2 ring-white"><Avatar name={m.full_name || m.name} size={28} /></span>
                    ))}
                    {members.length > 5 && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white">+{members.length - 5}</span>}
                    {members.length === 0 && <span className="text-xs text-slate-400">No members</span>}
                  </div>
                  <span className="text-xs text-slate-500">{members.length} member{members.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
