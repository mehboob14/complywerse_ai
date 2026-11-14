"use client";

// Shared bits for the Help Desk agent-desk pages (chips, avatar, header, empty
// state, defensive fetch hook). Private file: not a route.
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { sanitizeHtml } from "./_sanitize";

export const STATUS_CHIP: Record<string, string> = {
  open: "bg-blue-50 text-blue-700", replied: "bg-indigo-50 text-indigo-700",
  paused: "bg-amber-50 text-amber-700", resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600", published: "bg-emerald-50 text-emerald-700",
  draft: "bg-amber-50 text-amber-700", archived: "bg-slate-100 text-slate-600",
  new: "bg-blue-50 text-blue-700", in_progress: "bg-indigo-50 text-indigo-700",
  on_hold: "bg-amber-50 text-amber-700", cancelled: "bg-rose-50 text-rose-600",
};
export const STATUS_BAR: Record<string, string> = {
  open: "bg-blue-500", replied: "bg-indigo-500", paused: "bg-amber-500",
  resolved: "bg-emerald-500", closed: "bg-slate-400",
};
export const PRIORITY_CHIP: Record<string, string> = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-sky-100 text-sky-700",
};
export const AVAIL_CHIP: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700", away: "bg-amber-50 text-amber-700",
  unavailable: "bg-slate-100 text-slate-500",
};

const key = (s?: string | null) => (s || "").toLowerCase().replace(/\s+/g, "_");

export function Chip({ value, map = STATUS_CHIP }: { value?: string | null; map?: Record<string, string> }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[key(value)] || "bg-slate-100 text-slate-600"}`}>{value}</span>;
}

/**
 * Parse an API timestamp as UTC. The backend emits naive UTC ISO strings with
 * no zone (e.g. "2026-10-19T09:12:03.123"); `new Date()` would read those as the
 * browser's LOCAL time, so a just-now sync shows hours off. Append "Z" when the
 * string carries no explicit zone (no trailing Z and no ±hh:mm offset).
 */
export function utcDate(iso?: string | null): Date {
  if (!iso) return new Date(NaN);
  const s = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return new Date(s);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const t = utcDate(iso).getTime();
  if (isNaN(t)) return "—";
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const AV_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];
export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  const n = (name || "?").trim();
  const initials = n.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
  const color = AV_COLORS[n.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color}`}>{initials}</span>
  );
}

export function PageHeader({ icon: Icon, title, subtitle, actions }: {
  icon: LucideIcon; title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-base)]/10 text-[var(--color-base)]">
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function RefreshBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
      <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
    </button>
  );
}

export function Empty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <Icon size={28} className="mx-auto mb-3 text-slate-300" />
      <p className="font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertCircle size={16} /> {msg}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        {/* !important beats the global `.governance-light thead th` rule
            (bg var(--color-subtle), grey text) that otherwise greys this out. */}
        <thead className="text-left text-xs uppercase tracking-wide">
          <tr>{head.map((h) => <th key={h} className="!bg-[#005B96] px-4 py-2.5 !font-semibold !text-white">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/** GET a helpdesk endpoint; never throws. */
export function useHd<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get(path);
      setData((res.data ?? null) as T | null);
    } catch (e: any) {
      setData(null);
      const code = e?.response?.status;
      setError(
        code === 401 || code === 403
          ? "You don't have permission to view this. Ask an administrator to grant access."
          : "Couldn't load this data — the Help Desk engine may not be connected yet.",
      );
    } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export const Loading = ({ what }: { what: string }) => <div className="py-20 text-center text-slate-400">Loading {what}…</div>;

/** SLA indicator: countdown to a due date, red when breached. */
export function slaState(due?: string | null, done?: boolean): { label: string; cls: string } {
  if (!due) return { label: "—", cls: "text-slate-300" };
  const t = utcDate(due).getTime();
  if (isNaN(t)) return { label: "—", cls: "text-slate-300" };
  if (done) return { label: "Met", cls: "text-emerald-600" };
  const m = Math.round((t - Date.now()) / 60000);
  const a = Math.abs(m);
  const span = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h` : `${Math.floor(a / 1440)}d`;
  if (m < 0) return { label: `Overdue ${span}`, cls: "text-red-600" };
  return { label: `in ${span}`, cls: m < 120 ? "text-amber-600" : "text-slate-500" };
}

export function SlaBadge({ due, done }: { due?: string | null; done?: boolean }) {
  const s = slaState(due, done);
  return <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

/** Properties-panel row: label above, editable-looking control below. */
export function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">{label}</div>
      <div className="flex min-h-[32px] items-center rounded-md border border-slate-200 bg-slate-50/60 px-2.5 text-sm text-slate-700">{children}</div>
    </div>
  );
}

/** Timeline bubble: sent (agent) vs received (customer) vs internal note. */
export function TimelineItem({ m }: { m: { type?: string; sender?: string; content?: string; date?: string } }) {
  // Activity events render as a compact system line, not a bubble.
  if (/activity/i.test(m.type || "")) {
    return (
      <div className="flex items-center gap-2 pl-11 text-xs text-slate-400">
        <span className="h-1 w-1 rounded-full bg-slate-300" />
        <span className="break-words">{m.content || "Activity"}</span>
        <span className="ml-auto shrink-0" title={m.date || ""}>{timeAgo(m.date)}</span>
      </div>
    );
  }
  const internal = /comment|note/i.test(m.type || "");
  const sent = /sent/i.test(m.type || "");
  const d = m.date && !isNaN(utcDate(m.date).getTime()) ? utcDate(m.date).toLocaleString() : "";
  const box = internal ? "border-amber-200 bg-amber-50" : sent ? "border-indigo-100 bg-indigo-50/60" : "border-slate-200 bg-white";
  return (
    <div className="flex gap-3">
      <Avatar name={m.sender} size={32} />
      <div className={`min-w-0 flex-1 rounded-xl border p-3 ${box}`}>
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-800">{m.sender || "Unknown"}</span>
          <span className={`rounded px-1.5 text-[10px] font-semibold uppercase ${internal ? "bg-amber-100 text-amber-700" : sent ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
            {internal ? "Internal note" : sent ? "Reply" : "Customer"}
          </span>
          <span className="ml-auto text-slate-400" title={d}>{timeAgo(m.date)}</span>
        </div>
        <div className="prose prose-sm max-w-none break-words text-slate-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.content || "") }} />
      </div>
    </div>
  );
}
