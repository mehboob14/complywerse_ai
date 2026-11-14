"use client";

import { useMemo, useState } from "react";
import { Headset, Search } from "lucide-react";
import { Avatar, Chip, AVAIL_CHIP, PageHeader, RefreshBtn, Table, Empty, ErrorBanner, Loading, useHd } from "../_ui";

export default function AgentsPage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/agents");
  const [q, setQ] = useState("");
  const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return agents.filter((a) => !s || [a.agent_name, a.email, a.name].some((v) => (v || "").toLowerCase().includes(s)));
  }, [agents, q]);

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={Headset} title="Agents" subtitle={`${agents.length} support agent${agents.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…"
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="agents" /> : rows.length === 0 ? <Empty icon={Headset} title="No agents found" hint={q ? "Try a different search." : undefined} /> : (
        <Table head={["Agent", "Email", "Team", "Availability", "Status"]}>
          {rows.map((a) => {
            const active = a.is_active !== false && a.is_active !== 0;
            return (
              <tr key={a.name} className="hover:bg-slate-50">
                <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar name={a.agent_name || a.name} size={32} /><span className="font-medium text-[var(--color-text)]">{a.agent_name || a.name}</span></div></td>
                <td className="px-4 py-2.5 text-slate-600">{a.email || a.name || "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{Array.isArray(a.teams) && a.teams.length ? a.teams.join(", ") : "—"}</td>
                <td className="px-4 py-2.5"><Chip value={a.availability || "Unavailable"} map={AVAIL_CHIP} /></td>
                <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} />{active ? "Active" : "Inactive"}</span></td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
