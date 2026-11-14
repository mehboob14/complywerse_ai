"use client";

// ComplyVerse Help Desk — rich ticket list (table + board), modelled on Frappe's agent
// desk but in ComplyVerse's React/brand. Engine (Frappe) stays hidden behind the API.
// Data: GET /vuln-management/helpdesk/tickets.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LifeBuoy, RefreshCw, AlertCircle, LayoutGrid, Rows3, Search, Clock,
} from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";

interface Ticket {
  ticket_id: string | null;
  status: string;
  raw_status: string | null;
  finding_id: number;
  vuln_id: string | null;
  title: string | null;
  severity: string | null;
  cve_id: string | null;
  affected_host: string | null;
  connection: string | null;
  pushed_at: string | null;
  resolved_at: string | null;
  push_error: string | null;
}

const STATUS_META: Record<string, { label: string; dot: string; chip: string }> = {
  new:         { label: "New",         dot: "bg-blue-500",   chip: "bg-blue-50 text-blue-700" },
  in_progress: { label: "In Progress", dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700" },
  on_hold:     { label: "On Hold",     dot: "bg-amber-500",  chip: "bg-amber-50 text-amber-700" },
  resolved:    { label: "Resolved",    dot: "bg-emerald-500",chip: "bg-emerald-50 text-emerald-700" },
  closed:      { label: "Closed",      dot: "bg-slate-400",  chip: "bg-slate-100 text-slate-600" },
  cancelled:   { label: "Cancelled",   dot: "bg-rose-400",   chip: "bg-rose-50 text-rose-600" },
};
const COLUMNS = ["new", "in_progress", "on_hold", "resolved", "closed"];
const SEV_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-sky-100 text-sky-700",
  info: "bg-slate-100 text-slate-600",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function HelpDeskPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "board">("table");
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get("/vuln-management/helpdesk/tickets");
      setTickets(res.data.tickets || []);
      setSummary(res.data.summary || {});
    } catch {
      setError("Couldn't load tickets — the ticket engine or a connector may not be configured yet.");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => tickets.filter((t) => {
    if (filter !== "all" && t.status !== filter) return false;
    if (q) {
      const s = q.toLowerCase();
      return [t.title, t.vuln_id, t.cve_id, t.affected_host, t.ticket_id]
        .some((v) => (v || "").toLowerCase().includes(s));
    }
    return true;
  }), [tickets, filter, q]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-base)]/10 text-[var(--color-base)]">
            <LifeBuoy size={22} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text)]">Help Desk</h1>
            <p className="text-sm text-slate-500">Remediation tickets across your estate</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
            <button onClick={() => setView("table")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${view === "table" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}><Rows3 size={15} /> List</button>
            <button onClick={() => setView("board")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${view === "board" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}><LayoutGrid size={15} /> Board</button>
          </div>
          <button onClick={load} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setFilter("all")} className={`rounded-full px-3 py-1 text-sm ${filter === "all" ? "bg-[var(--color-base)] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            All <span className="opacity-70">{tickets.length}</span>
          </button>
          {COLUMNS.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${filter === s ? "bg-[var(--color-base)] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].dot}`} />
              {STATUS_META[s].label} <span className="opacity-70">{summary[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets…"
            className="w-56 rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:border-[var(--color-base)] focus:outline-none" />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400">Loading tickets…</div>
      ) : filtered.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <LifeBuoy size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">No tickets here</p>
          <p className="mt-1 text-sm text-slate-400">Open a finding and choose “Push to ITSM” to create a ticket.</p>
        </div>
      ) : view === "table" ? (
        /* ─── Rich table ─── */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Subject</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">CVE</th>
                <th className="px-4 py-2.5 font-medium">Host</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => {
                const sm = STATUS_META[t.status] || STATUS_META.new;
                return (
                  <tr key={`${t.finding_id}-${t.ticket_id}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/cyber-assurance/helpdesk/${encodeURIComponent(t.ticket_id || String(t.finding_id))}?f=${t.finding_id}`} className="font-mono text-xs text-[var(--color-base)] hover:underline">
                        {t.ticket_id || `#${t.finding_id}`}
                      </Link>
                    </td>
                    <td className="max-w-[320px] px-4 py-2.5">
                      <span className="line-clamp-1 text-slate-800">{t.title || t.vuln_id || `Finding ${t.finding_id}`}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {t.severity && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_CHIP[t.severity] || SEV_CHIP.info}`}>{t.severity}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{t.cve_id || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{t.affected_host || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${sm.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} />{sm.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400"><span className="inline-flex items-center gap-1"><Clock size={12} />{timeAgo(t.pushed_at)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ─── Board ─── */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const sm = STATUS_META[col];
            const colT = tickets.filter((t) => t.status === col);
            return (
              <div key={col} className="rounded-xl bg-slate-50/70 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><span className={`h-2 w-2 rounded-full ${sm.dot}`} />{sm.label}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{colT.length}</span>
                </div>
                <div className="space-y-2">
                  {colT.map((t) => (
                    <Link key={`${t.finding_id}-${t.ticket_id}`} href={`/cyber-assurance/helpdesk/${encodeURIComponent(t.ticket_id || String(t.finding_id))}?f=${t.finding_id}`}
                      className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-[var(--color-base)]/40">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs text-slate-400">{t.ticket_id || `#${t.finding_id}`}</span>
                        {t.severity && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_CHIP[t.severity] || SEV_CHIP.info}`}>{t.severity}</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-slate-800">{t.title || t.vuln_id || `Finding ${t.finding_id}`}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                        {t.cve_id && <span className="rounded bg-slate-100 px-1.5 py-0.5">{t.cve_id}</span>}
                        {t.affected_host && <span className="rounded bg-slate-100 px-1.5 py-0.5">{t.affected_host}</span>}
                      </div>
                    </Link>
                  ))}
                  {colT.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-300">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
