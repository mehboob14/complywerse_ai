"use client";

/**
 * Help Desk analytics widgets, drawn in the ComplyVerse Performance-dashboard visual
 * language: the same card shell, tokens, KPI tiles, stacked-bar breakdowns and
 * empty/loading states as (dashboard)/dashboard. We reuse that page's `kit`
 * (the product design system) rather than re-inventing one, and recharts (real
 * on the client, mocked on the server — see next.config.js) only for the one
 * genuinely time-series widget: the created-vs-resolved trend.
 */
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Star } from "lucide-react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CARD_SHADOW, Card, Eyebrow, SEV, T, alpha, nfmt, pctOf, type Tone } from "../dashboard/_components/kit";
import { BarList, PartLegend, StackBar, type BarRow, type Part } from "../dashboard/_components/charts";
import { Avatar } from "./_ui";

/* ---------- tokens shared with the breakdowns ---------- */
export const ACCENT = T.base;
// Categorical palette for non-ordinal breakdowns (team / type), CVD-spaced.
const CAT = ["#005B96", "#0E7490", "#7C3AED", "#B45309", "#047857", "#BE123C", "#2563EB", "#64748B"];
// Priority maps onto the severity scale; status onto Open/Resolved/Paused tones.
const PRIORITY_TONE: Record<string, Tone> = {
  urgent: SEV.critical, high: SEV.high, medium: SEV.medium, low: SEV.low,
};
const STATUS_TONE: Record<string, Tone> = {
  open: { label: "Open", c: "#2563EB", ink: "#1D4ED8", bg: "#E9F0FE" },
  resolved: { label: "Resolved", c: "#047857", ink: "#047857", bg: "#E7F5EE" },
  paused: { label: "Paused", c: "#B45309", ink: "#92400E", bg: "#FEF4E4" },
  closed: { label: "Closed", c: "#64748B", ink: "#475569", bg: "#F1F5F9" },
};
const toneFor = (name: string, i: number, map?: Record<string, Tone>): string =>
  map?.[name.toLowerCase()]?.c ?? CAT[i % CAT.length];

/* ---------- formatters ---------- */
/** Hours → "45m" / "3.2h" / "1.4d". */
export const fmtH = (h: number | null | undefined) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
export const fmtD = (d: number | null | undefined) => (d == null ? "—" : `${d.toFixed(d < 10 ? 1 : 0)}d`);

/* ---------- KPI tile (delta-aware), matching the exec dashboard's Kpi ---------- */
export type DeltaInfo = { delta: number | null; suffix?: string; negativeIsBetter?: boolean; caption?: string };
export function Kpi({ icon, label, value, sub, href, delta }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; href?: string; delta?: DeltaInfo | null;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[11.5px] font-medium text-[#64748B]">
        <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]" style={{ background: alpha(T.base, 0.08), color: T.base }}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
      <span className="mt-1.5 flex items-end justify-between gap-2">
        <span className="text-[22px] font-semibold leading-[1.1] text-[#0F172A]">{value}</span>
        {delta && <DeltaBadge {...delta} />}
      </span>
      {sub && <span className="mt-1 text-[11.5px] leading-[1.4] text-[#64748B]">{sub}</span>}
    </>
  );
  const cls = `group relative flex min-w-0 flex-col rounded-[12px] border border-[#E2E5EC] bg-white px-3 py-2.5 ${CARD_SHADOW}`;
  return href
    ? <Link href={href} className={`${cls} transition hover:-translate-y-px hover:border-[#C7D2E4] hover:shadow-[0_8px_22px_rgba(16,24,40,.12)]`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** Period-over-period change. `negativeIsBetter` flips the colour (fewer tickets / faster = good). */
export function DeltaBadge({ delta, suffix = "%", negativeIsBetter, caption }: DeltaInfo) {
  if (delta == null) return <span className="text-[10.5px] font-medium text-[#94A3B8]" title={caption}>new</span>;
  const flat = Math.abs(delta) < 0.05;
  const good = flat ? null : negativeIsBetter ? delta < 0 : delta > 0;
  const color = good == null ? "#64748B" : good ? T.success : T.danger;
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums" style={{ color }} title={caption}>
      <Icon size={13} aria-hidden />{Math.abs(delta)}{suffix.trim()}
    </span>
  );
}

/* ---------- categorical breakdown as an on-brand 100% stacked bar + legend ---------- */
export function Breakdown({ title, sub, data, kind, href }: {
  title: string; sub?: string; data: Record<string, number> | null | undefined;
  kind?: "priority" | "status" | "cat"; href?: string;
}) {
  const map = kind === "priority" ? PRIORITY_TONE : kind === "status" ? STATUS_TONE : undefined;
  const parts: Part[] = useMemo(() => Object.entries(data || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n], i) => ({ key: name, label: map?.[name.toLowerCase()]?.label ?? name, n, c: toneFor(name, i, map) })),
    [data, map]);
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <Card title={title} sub={sub} href={href} cta="View tickets" ctaIcon>
      {parts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] bg-[#F6F7FB] py-8 text-center text-[11.5px] text-[#94A3B8]">No tickets in this window</div>
      ) : (
        <div className="flex flex-1 flex-col">
          <StackBar parts={parts} label={title} height={14} />
          <div className="mt-3 flex-1"><PartLegend parts={parts} total={total} cols={1} fill /></div>
        </div>
      )}
    </Card>
  );
}

/* ---------- created vs resolved trend (+ optional SLA-fulfilled line) ---------- */
export type TrendRow = { date: string; created: number; resolved: number };
export function TrendChart({ data, slaByDate }: { data: TrendRow[]; slaByDate?: Record<string, number | null> }) {
  const hasSla = slaByDate && Object.values(slaByDate).some((v) => v != null);
  const rows = data.map((r) => ({ ...r, sla: slaByDate?.[r.date] ?? null }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: hasSla ? 6 : 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="hdCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ACCENT} stopOpacity={0.28} /><stop offset="95%" stopColor={ACCENT} stopOpacity={0} /></linearGradient>
            <linearGradient id="hdResolved" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.success} stopOpacity={0.28} /><stop offset="95%" stopColor={T.success} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.faint }} tickFormatter={(d: string) => d.slice(5)} interval={4} tickLine={false} axisLine={{ stroke: "#E2E5EC" }} />
          <YAxis yAxisId="l" tick={{ fontSize: 10, fill: T.faint }} allowDecimals={false} tickLine={false} axisLine={false} width={34} />
          {hasSla && <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: T.faint }} tickLine={false} axisLine={false} width={34} />}
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E2E5EC", fontSize: 12, boxShadow: "0 6px 20px rgba(15,23,42,.12)" }} />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} iconType="plainline" />
          <Area yAxisId="l" type="monotone" dataKey="created" name="Created" stroke={ACCENT} fill="url(#hdCreated)" strokeWidth={2} />
          <Area yAxisId="l" type="monotone" dataKey="resolved" name="Resolved" stroke={T.success} fill="url(#hdResolved)" strokeWidth={2} />
          {hasSla && <Line yAxisId="r" type="monotone" dataKey="sla" name="SLA fulfilled %" stroke="#7C3AED" strokeWidth={2} dot={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- feedback: average as a 5-star gauge ---------- */
export function StarRating({ value, size = 18 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="relative inline-flex" role="img" aria-label={`${value.toFixed(1)} out of 5`}>
      <span className="flex" style={{ color: "#E2E5EC" }}>{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={size} fill="currentColor" strokeWidth={0} />)}</span>
      <span className="absolute inset-0 flex overflow-hidden" style={{ width: `${pct}%`, color: "#F59E0B" }}>
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={size} fill="currentColor" strokeWidth={0} className="shrink-0" />)}
      </span>
    </span>
  );
}

/* ---------- tenant-wide SLA health, derived from the ticket list ---------- */
const isOpenStatus = (s?: string) => !/resolved|closed|cancelled/i.test(s || "");
export function slaBuckets(tickets: any[], now = Date.now()) {
  const soon = now + 24 * 3600 * 1000;
  let breached = 0, atRisk = 0, fulfilled = 0, onTrack = 0;
  for (const t of tickets) {
    if (t.agreement_status === "Failed") { breached++; continue; }
    if (t.agreement_status === "Fulfilled") { fulfilled++; continue; }
    if (!isOpenStatus(t.status)) continue; // resolved w/o verdict → ignore
    const due = [t.response_by, t.resolution_by]
      .map((d) => (d ? new Date(d).getTime() : NaN))
      .filter((ms) => !Number.isNaN(ms));
    if (due.some((ms) => ms <= soon)) atRisk++; else onTrack++;
  }
  return { breached, atRisk, fulfilled, onTrack };
}

export function SlaPanel({ tickets, pct, href }: { tickets: any[]; pct: number | null; href?: string }) {
  const b = useMemo(() => slaBuckets(tickets), [tickets]);
  const total = b.breached + b.atRisk + b.fulfilled + b.onTrack;
  const parts: Part[] = [
    { key: "breached", label: "Breached", n: b.breached, c: T.danger },
    { key: "atRisk", label: "At risk (≤24h)", n: b.atRisk, c: "#B45309" },
    { key: "onTrack", label: "On track", n: b.onTrack, c: T.base },
    { key: "fulfilled", label: "Met SLA", n: b.fulfilled, c: T.success },
  ];
  return (
    <Card title="SLA health" sub="Across all tickets · fulfilled vs breached vs at risk" href={href} cta="View tickets" ctaIcon>
      <div className="mb-3 flex items-end gap-3">
        <div>
          <p className="m-0 text-[28px] font-semibold leading-none text-[#0F172A]">{pct == null ? "—" : `${Math.round(pct)}%`}</p>
          <p className="m-0 mt-1 text-[11px] text-[#64748B]">resolved within SLA</p>
        </div>
        <div className="ml-auto flex gap-4 text-right">
          <div><p className="m-0 text-[18px] font-semibold leading-none" style={{ color: T.danger }}>{nfmt(b.breached)}</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">breached</p></div>
          <div><p className="m-0 text-[18px] font-semibold leading-none" style={{ color: "#B45309" }}>{nfmt(b.atRisk)}</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">at risk</p></div>
        </div>
      </div>
      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] bg-[#F6F7FB] py-6 text-center text-[11.5px] text-[#94A3B8]">No SLA data yet</div>
      ) : (
        <div className="flex flex-1 flex-col">
          <StackBar parts={parts.filter((p) => p.n > 0)} label="SLA status" height={14} />
          <div className="mt-3 flex-1"><PartLegend parts={parts} total={total} cols={2} fill /></div>
        </div>
      )}
    </Card>
  );
}

/* ---------- period selector (7 / 30 / 90 days) ---------- */
export type Period = 7 | 30 | 90;
export const PERIODS: { days: Period; label: string; stat: string }[] = [
  { days: 7, label: "7 days", stat: "last week" },
  { days: 30, label: "30 days", stat: "last month" },
  { days: 90, label: "90 days", stat: "last 3 months" },
];
/** from/to the window endpoints the backend expects (UTC calendar days). */
export function periodRange(days: Period): { from_date: string; to_date: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from_date: iso(from), to_date: iso(to) };
}
export function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-[9px] border border-[#E2E5EC] bg-white p-0.5">
      {PERIODS.map((p) => (
        <button key={p.days} type="button" role="radio" aria-checked={value === p.days} onClick={() => onChange(p.days)}
          className={`rounded-[7px] px-2.5 py-1 text-[12px] font-semibold transition ${value === p.days ? "bg-[#005B96] text-white" : "text-[#334155] hover:bg-[#F6F7FB]"}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- executive summary bar (open / overdue / unassigned) ---------- */
const isOpenS = (s?: string) => !/resolved|closed|cancelled/i.test(s || "");
export function execStats(tickets: any[], now = Date.now()) {
  let open = 0, overdue = 0, unassigned = 0;
  for (const t of tickets) {
    if (!isOpenS(t.status)) continue;
    open++;
    const res = t.resolution_by ? new Date(t.resolution_by).getTime() : NaN;
    if (t.agreement_status === "Failed" || (!Number.isNaN(res) && res < now)) overdue++;
    if (!t.agent) unassigned++;
  }
  return { open, overdue, unassigned, total: tickets.length };
}
export function ExecSummaryBar({ tickets, slaPct, periodLabel, updatedLabel }: {
  tickets: any[]; slaPct: number | null; periodLabel: string; updatedLabel?: string;
}) {
  const s = useMemo(() => execStats(tickets), [tickets]);
  const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-[#0F172A]">{children}</b>;
  return (
    <section aria-label="Executive summary"
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[14px] border border-[#E2E5EC] bg-white px-4 py-3 ${CARD_SHADOW}`}
      style={{ borderLeft: `3px solid ${T.base}` }}>
      <div className="min-w-0 flex-1 basis-[260px]">
        <Eyebrow>Service desk · last {periodLabel}</Eyebrow>
        <p className="m-0 mt-0.5 text-[13.5px] leading-[1.5] text-[#0F172A]" aria-live="polite">
          {s.total === 0 ? "No tickets in this tenant yet — new tickets will appear here as they come in." : (
            <><B>{nfmt(s.open)}</B> {s.open === 1 ? "ticket is" : "tickets are"} open
              {s.overdue > 0 ? <>, <span style={{ color: T.danger }}><B>{nfmt(s.overdue)}</B> overdue</span></> : ", none overdue"}
              {s.unassigned > 0 ? <>, <span style={{ color: T.warning }}><B>{nfmt(s.unassigned)}</B> unassigned</span></> : ""}
              {slaPct != null ? <>. SLA compliance <B>{Math.round(slaPct)}%</B>.</> : "."}</>
          )}
        </p>
      </div>
      {updatedLabel && <span className="text-[11.5px] text-[#64748B]">{updatedLabel}</span>}
    </section>
  );
}

/* ---------- SLA-compliance dial (green = high; the mirror of the exec risk gauge) ---------- */
export function ComplianceGauge({ value, size = 200 }: { value: number | null; size?: number }) {
  const sw = 16, m = 6;
  const r = size / 2 - m - sw / 2;
  const cx = size / 2, cy = r + sw / 2 + m, h = cy + 10;
  const pt = (v: number, rad: number) => {
    const a = Math.PI * (1 - v / 100);
    return `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy - rad * Math.sin(a)).toFixed(2)}`;
  };
  const arc = (a: number, b: number, rad: number) => `M ${pt(a, rad)} A ${rad} ${rad} 0 0 1 ${pt(b, rad)}`;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const col = v == null ? T.faint : v >= 90 ? T.success : v >= 75 ? T.base : v >= 50 ? "#B45309" : T.danger;
  const band = v == null ? "No data" : v >= 90 ? "Excellent" : v >= 75 ? "Healthy" : v >= 50 ? "At risk" : "Breaching";
  return (
    <div className="relative inline-block max-w-full">
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img"
        aria-label={`SLA compliance ${v == null ? "not available" : `${Math.round(v)} percent`} — ${band}`} className="block h-auto max-w-full">
        <path d={arc(0, 100, r)} stroke={T.track} strokeWidth={sw} fill="none" strokeLinecap="round" />
        {v != null && v > 0 && <path d={arc(0, v, r)} stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />}
        <text x={cx - r} y={h - 1} textAnchor="middle" fontSize="10" fill={T.faint}>0</text>
        <text x={cx + r} y={h - 1} textAnchor="middle" fontSize="10" fill={T.faint}>100</text>
      </svg>
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: cy - 42 }}>
        <span className="text-[30px] font-semibold leading-none text-[#0F172A]">{v == null ? "—" : `${Math.round(v)}%`}</span>
        <span className="mt-1 text-[11px] font-semibold" style={{ color: col }}>{band}</span>
      </div>
    </div>
  );
}

/* ---------- backlog aging: OPEN tickets by days since created ---------- */
const AGE_BUCKETS: { key: string; label: string; lo: number; hi: number; c: string }[] = [
  { key: "d0", label: "< 1 day", lo: 0, hi: 1, c: T.success },
  { key: "d1", label: "1–3 days", lo: 1, hi: 3, c: T.base },
  { key: "d3", label: "3–7 days", lo: 3, hi: 7, c: "#B45309" },
  { key: "d7", label: "7–14 days", lo: 7, hi: 14, c: SEV.high.c },
  { key: "d14", label: "14+ days", lo: 14, hi: Infinity, c: SEV.critical.c },
];
export function agingRows(tickets: any[], now = Date.now()): { rows: BarRow[]; open: number; oldest: number } {
  const counts: Record<string, number> = {};
  let open = 0, oldest = 0;
  for (const t of tickets) {
    if (!isOpenS(t.status)) continue;
    const ms = t.created ? new Date(t.created).getTime() : NaN;
    if (Number.isNaN(ms)) continue;
    open++;
    const days = (now - ms) / 86400000;
    if (days > oldest) oldest = days;
    const b = AGE_BUCKETS.find((x) => days >= x.lo && days < x.hi) || AGE_BUCKETS[AGE_BUCKETS.length - 1];
    counts[b.key] = (counts[b.key] || 0) + 1;
  }
  const rows: BarRow[] = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, n: counts[b.key] || 0, c: b.c }));
  return { rows, open, oldest: Math.floor(oldest) };
}
export function BacklogAging({ tickets, href }: { tickets: any[]; href?: string }) {
  const { rows, open, oldest } = useMemo(() => agingRows(tickets), [tickets]);
  return (
    <Card title="Backlog aging" sub="Open tickets by time since created" href={href} cta="View tickets" ctaIcon>
      {open === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] bg-[#F6F7FB] py-8 text-center text-[11.5px] text-[#94A3B8]">No open tickets</div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-3 flex items-end gap-3">
            <div><p className="m-0 text-[28px] font-semibold leading-none text-[#0F172A]">{nfmt(open)}</p><p className="m-0 mt-1 text-[11px] text-[#64748B]">open in backlog</p></div>
            <div className="ml-auto text-right"><p className="m-0 text-[18px] font-semibold leading-none text-[#0F172A]">{oldest}d</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">oldest open</p></div>
          </div>
          <div className="flex-1"><BarList rows={rows} fill /></div>
        </div>
      )}
    </Card>
  );
}

/* ---------- agent leaderboard (derived from the ticket list) ---------- */
type AgentStat = { agent: string; handled: number; open: number; resolved: number; slaMet: number; slaFailed: number; csatSum: number; csatN: number };
export function agentLeaderboard(tickets: any[]): AgentStat[] {
  const by: Record<string, AgentStat> = {};
  for (const t of tickets) {
    const a = t.agent;
    if (!a) continue;
    const s = (by[a] = by[a] || { agent: a, handled: 0, open: 0, resolved: 0, slaMet: 0, slaFailed: 0, csatSum: 0, csatN: 0 });
    s.handled++;
    if (isOpenS(t.status)) s.open++; else s.resolved++;
    if (t.agreement_status === "Fulfilled") s.slaMet++;
    else if (t.agreement_status === "Failed") s.slaFailed++;
    if (t.feedback_rating && t.feedback_rating > 0) { s.csatSum += t.feedback_rating * 5; s.csatN++; }
  }
  return Object.values(by).sort((a, b) => b.handled - a.handled);
}
export function AgentLeaderboard({ tickets, href }: { tickets: any[]; href?: string }) {
  const rows = useMemo(() => agentLeaderboard(tickets).slice(0, 8), [tickets]);
  return (
    <Card title="Agent leaderboard" sub="Busiest agents · load, SLA & CSAT" href={href} cta="Agents" ctaIcon>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] bg-[#F6F7FB] py-8 text-center text-[11.5px] text-[#94A3B8]">No assigned tickets yet</div>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[.04em] text-[#94A3B8]">
              <th className="py-1 text-left font-semibold">Agent</th>
              <th className="py-1 text-right font-semibold" title="Tickets handled">Load</th>
              <th className="py-1 text-right font-semibold" title="Currently open">Open</th>
              <th className="py-1 text-right font-semibold" title="SLA met vs breached">SLA</th>
              <th className="py-1 text-right font-semibold" title="Avg CSAT /5">CSAT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const slaTot = s.slaMet + s.slaFailed;
              const slaPct = slaTot ? Math.round((s.slaMet / slaTot) * 100) : null;
              const csat = s.csatN ? s.csatSum / s.csatN : null;
              return (
                <tr key={s.agent} className="border-t border-[#F1F3F7]">
                  <td className="py-1.5 pr-2"><span className="flex min-w-0 items-center gap-2"><Avatar name={s.agent} size={22} /><span className="min-w-0 truncate text-[#0F172A]" title={s.agent}>{s.agent.split("@")[0]}</span></span></td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-[#0F172A]">{nfmt(s.handled)}</td>
                  <td className="py-1.5 text-right tabular-nums text-[#334155]">{nfmt(s.open)}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: slaPct == null ? T.faint : slaPct >= 90 ? T.success : slaPct >= 60 ? T.warning : T.danger }}>{slaPct == null ? "—" : `${slaPct}%`}</td>
                  <td className="py-1.5 text-right tabular-nums text-[#334155]">{csat == null ? "—" : csat.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ---------- CSAT distribution: 1–5 star histogram (tenant-wide) ---------- */
const STAR_C: Record<number, string> = { 5: T.success, 4: "#10B981", 3: SEV.medium.c, 2: SEV.high.c, 1: SEV.critical.c };
export type FeedbackDist = { data: Record<string, number>; average: number; total: number };
export function CsatDistribution({ fb, href }: { fb: FeedbackDist | null; href?: string }) {
  const dist = fb?.data || {};
  const total = fb?.total ?? 0;
  const rows: BarRow[] = [5, 4, 3, 2, 1].map((star) => {
    const n = Number(dist[String(star)] ?? dist[star as any] ?? 0);
    return { key: String(star), label: <span className="inline-flex items-center gap-1 tabular-nums">{star}<Star size={11} fill={STAR_C[star]} strokeWidth={0} /></span>, n, c: STAR_C[star], title: `${star}-star · ${n} (${pctOf(n, total)}%)` };
  });
  return (
    <Card title="Customer satisfaction" sub="CSAT rating distribution · all rated tickets" href={href} cta="View tickets" ctaIcon>
      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-[12px] bg-[#F6F7FB] py-8 text-center">
          <Star size={18} className="text-[#CBD5E1]" />
          <p className="m-0 text-[12.5px] font-semibold text-[#0F172A]">No feedback yet</p>
          <p className="m-0 text-[11.5px] text-[#94A3B8]">Ratings appear once resolved tickets are rated.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-3 flex items-center gap-3">
            <p className="m-0 text-[28px] font-semibold leading-none text-[#0F172A]">{fb?.average?.toFixed(1)}<span className="text-[15px] font-medium text-[#94A3B8]">/5</span></p>
            <StarRating value={fb?.average ?? 0} size={18} />
            <span className="ml-auto text-[11px] text-[#64748B]">{nfmt(total)} rated</span>
          </div>
          <div className="flex-1"><BarList rows={rows} labelWidth={44} fill /></div>
        </div>
      )}
    </Card>
  );
}

/* ---------- SLA-breach trend (tenant-wide Failed-SLA over time) ---------- */
export type ViolationSeries = { data: { date: string; count: number }[]; total: number; percentage_change: number | null };
export function BreachTrend({ series, periodLabel, href }: { series: ViolationSeries | null; periodLabel: string; href?: string }) {
  const data = series?.data || [];
  const total = series?.total ?? 0;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card title="SLA breaches over time" sub={`Tickets that missed SLA · last ${periodLabel}`} href={href} cta="View tickets" ctaIcon>
      <div className="mb-3 flex items-center gap-2">
        <p className="m-0 text-[28px] font-semibold leading-none" style={{ color: total ? T.danger : "#0F172A" }}>{nfmt(total)}</p>
        <p className="m-0 text-[11px] text-[#64748B]">breached</p>
        {series?.percentage_change != null && <span className="ml-auto"><DeltaBadge delta={series.percentage_change} suffix="%" negativeIsBetter caption={`vs prior ${periodLabel}`} /></span>}
      </div>
      {data.length === 0 || total === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] bg-[#F6F7FB] py-6 text-center text-[11.5px] text-[#94A3B8]">No SLA breaches in this window</div>
      ) : (
        <div className="flex flex-1 items-end gap-[3px] pt-2" role="img" aria-label={`SLA breaches per bucket, ${data.map((d) => `${d.date}: ${d.count}`).join(", ")}`} style={{ minHeight: 96 }}>
          {data.map((d) => (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${d.count} breached`}>
              <span className="text-[10px] font-semibold tabular-nums text-[#64748B]">{d.count || ""}</span>
              <i className="block w-full max-w-[26px] rounded-t-[4px]" style={{ height: `${Math.max(d.count ? 3 : 0, (d.count / max) * 80)}px`, background: d.count ? SEV.critical.c : "transparent" }} />
              <span className="w-full truncate text-center text-[9px] text-[#94A3B8]">{d.date.length > 7 ? d.date.slice(5) : d.date}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- at-risk tickets (open, SLA breached or due within 24h) ---------- */
export function atRiskTickets(tickets: any[], now = Date.now()): any[] {
  const soon = now + 24 * 3600 * 1000;
  return tickets.filter((t) => {
    if (!isOpenS(t.status)) return false;
    if (t.agreement_status === "Failed") return true;
    return [t.response_by, t.resolution_by].some((d) => {
      const ms = d ? new Date(d).getTime() : NaN;
      return !Number.isNaN(ms) && ms <= soon;
    });
  }).sort((a, b) => {
    const da = Math.min(...[a.response_by, a.resolution_by].map((d) => (d ? new Date(d).getTime() : Infinity)));
    const db = Math.min(...[b.response_by, b.resolution_by].map((d) => (d ? new Date(d).getTime() : Infinity)));
    return da - db;
  });
}
