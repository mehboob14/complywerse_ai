'use client';

// Trends — cross-module time-series over the snapshot history layer.
//
// A board of per-module KPI cards (current value, period delta, sparkline and a
// RAG status vs target); clicking one opens a detail drawer with the full trend,
// target/threshold reference lines, a dimensional breakdown (e.g. vulns by
// severity, completion by framework), the metric definition and a target editor.
// Data + pure helpers live in ./trends; this file is presentation only.

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Camera, ChevronRight, Loader2, Minus, RotateCcw,
  Target as TargetIcon, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import { INK, SERIES } from './vizPalette';
import {
  deltaView, formatValue, hasSeries, RAG_COLOR, RAG_LABEL, RANGES, round1,
  shortDate, totalPoints, trendsApi, unitTag,
  type BreakdownResp, type OverviewResp, type Rag, type TrendCard, type TrendPoint, type Unit,
} from './trends';

const BRAND = SERIES[0]; // validated brand teal

// ── small presentational bits ────────────────────────────────────────────────
function RagDot({ status, size = 8 }: { status: Rag; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: RAG_COLOR[status] }} title={RAG_LABEL[status]} />;
}

function DeltaBadge({ card }: { card: TrendCard }) {
  const d = deltaView(card);
  const Icon = d.arrow === 'up' ? TrendingUp : d.arrow === 'down' ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums" style={{ color: d.color }} title="vs ~30 days earlier">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} /> {d.text}
    </span>
  );
}

/** Unit-aware sparkline (counts aren't clamped to 0–100 the way % is). */
function Spark({ points, target, width = 132, height = 38 }: { points: TrendPoint[]; target: number | null; width?: number; height?: number }) {
  const pts = points.filter((p) => p.value != null) as { date: string; value: number }[];
  if (pts.length < 2) return <div className="flex h-[38px] items-center text-[10px] text-slate-300">collecting…</div>;
  const ys = pts.map((p) => p.value);
  const refs = target != null ? [...ys, target] : ys;
  let lo = Math.min(...refs), hi = Math.max(...refs);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.14; lo -= pad; hi += pad;
  const x = (i: number) => (width * i) / (pts.length - 1);
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" className="overflow-visible">
      <path d={area} fill={BRAND} fillOpacity={0.08} />
      {target != null && <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 2" />}
      <path d={line} fill="none" stroke={BRAND} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].value)} r={2.3} fill={BRAND} />
    </svg>
  );
}

function TrendCardTile({ card, onOpen }: { card: TrendCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 text-left transition-shadow hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium leading-tight text-slate-600">{card.label}</span>
        <RagDot status={card.status} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[22px] font-bold tabular-nums text-slate-900">{formatValue(card.current, card.unit)}</span>
        <DeltaBadge card={card} />
      </div>
      <div className="mt-2">
        <Spark points={card.points} target={card.target} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
        <span>{card.as_of ? `as of ${shortDate(card.as_of)}` : 'no data yet'}</span>
        {card.target != null && <span>target {formatValue(card.target, card.unit)}</span>}
      </div>
    </button>
  );
}

// ── y-domain + tooltip helpers for the big charts ─────────────────────────────
function yDomain(values: number[], unit: Unit, extra: (number | null)[] = []): [number, number] {
  const all = [...values, ...extra.filter((v): v is number => v != null)];
  if (!all.length) return [0, unit === 'pct' || unit === 'score' ? 100 : 1];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.15;
  lo -= pad; hi += pad;
  if (unit === 'pct' || unit === 'score') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
  else { lo = Math.min(0, lo); }
  return [Math.floor(lo), Math.ceil(hi)];
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <div className="mb-0.5 font-medium text-slate-500">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 tabular-nums text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b>{formatValue(p.value, unit)}</b>
        </div>
      ))}
    </div>
  );
}

function BigTrend({ card }: { card: TrendCard }) {
  const data = card.points.map((p) => ({ date: shortDate(p.date), value: p.value }));
  const vals = card.points.filter((p) => p.value != null).map((p) => p.value as number);
  const dom = yDomain(vals, card.unit, [card.target, card.warn]);
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={INK.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: INK.muted }} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={24} />
        <YAxis domain={dom} tick={{ fontSize: 10, fill: INK.muted }} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={(p: any) => <ChartTip {...p} unit={card.unit} />} />
        {card.warn != null && <ReferenceLine y={card.warn} stroke="#f1c99a" strokeDasharray="2 3" strokeWidth={1} />}
        {card.target != null && (
          <ReferenceLine y={card.target} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1.2}
            label={{ value: `target ${formatValue(card.target, card.unit)}`, position: 'insideTopRight', fontSize: 9.5, fill: '#94a3b8' }} />
        )}
        <Line type="monotone" dataKey="value" name={card.label} stroke={BRAND} strokeWidth={2.2}
          dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BreakdownChart({ data, unit }: { data: BreakdownResp; unit: Unit }) {
  // Merge parallel series into one date-keyed table for recharts.
  const { rows, keys } = useMemo(() => {
    const byDate = new Map<string, any>();
    const ks: string[] = [];
    for (const s of data.series) {
      ks.push(s.key);
      for (const p of s.points) {
        if (p.value == null) continue;
        const d = p.date.slice(0, 10);
        if (!byDate.has(d)) byDate.set(d, { date: d });
        byDate.get(d)[s.key] = p.value;
      }
    }
    const rws = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, date: shortDate(r.date) }));
    return { rows: rws, keys: ks.slice(0, 8) };
  }, [data]);
  if (!rows.length) return <p className="py-6 text-center text-xs text-slate-400">No breakdown history yet.</p>;
  const stack = unit === 'count';
  const ChartEl = stack ? AreaChart : LineChart;
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ChartEl data={rows} margin={{ top: 8, right: 18, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: INK.muted }} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: INK.muted }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={(p: any) => <ChartTip {...p} unit={unit} />} />
          {keys.map((k, i) => stack ? (
            <Area key={k} type="monotone" dataKey={k} name={k} stackId="1" stroke={SERIES[i % 8]} fill={SERIES[i % 8]} fillOpacity={0.22} strokeWidth={1.6} isAnimationActive={false} />
          ) : (
            <Line key={k} type="monotone" dataKey={k} name={k} stroke={SERIES[i % 8]} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
          ))}
        </ChartEl>
      </ResponsiveContainer>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {keys.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1 text-[11px] capitalize text-slate-600">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[i % 8] }} /> {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function TargetEditor({ card, onSaved }: { card: TrendCard; onSaved: () => void }) {
  const [target, setTarget] = useState<string>(card.target != null ? String(card.target) : '');
  const [warn, setWarn] = useState<string>(card.warn != null ? String(card.warn) : '');
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = async () => {
    setBusy(true);
    try { await trendsApi.setTarget({ metric: card.key, target: num(target), warn: num(warn), critical: card.critical }); onSaved(); }
    finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { await trendsApi.resetTarget(card.key); onSaved(); } finally { setBusy(false); } };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <TargetIcon className="h-3.5 w-3.5" /> Target &amp; thresholds
      </p>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="text-[11px] text-slate-500">
          Target
          <input type="number" value={target} onChange={(e) => setTarget(e.target.value)}
            className="mt-0.5 block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" placeholder="—" />
        </label>
        <label className="text-[11px] text-slate-500">
          Warn at
          <input type="number" value={warn} onChange={(e) => setWarn(e.target.value)}
            className="mt-0.5 block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" placeholder="—" />
        </label>
        <span className="text-[11px] text-slate-400">{unitTag(card.unit) || 'value'} · {card.direction === 'down_good' ? 'lower is better' : card.direction === 'up_good' ? 'higher is better' : 'no direction'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={reset} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100" title="Reset to default">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-3 py-1 text-[11px] font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrendDetail({ metricKey, days, onClose, onChanged }: { metricKey: string; days: number; onClose: () => void; onChanged: () => void }) {
  const [range, setRange] = useState(days);
  const detail = useQuery({ queryKey: ['trends', 'series', metricKey, range], queryFn: () => trendsApi.series(metricKey, range) });
  const card = detail.data;
  const breakdown = useQuery({
    queryKey: ['trends', 'breakdown', metricKey, range],
    queryFn: () => trendsApi.breakdown(metricKey, range),
    enabled: !!card?.dimension,
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-auto bg-white shadow-2xl">
        {!card ? (
          <div className="flex flex-1 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-700">{card.module_label}</p>
                <h2 className="mt-0.5 flex items-center gap-2 text-lg font-bold text-slate-900">{card.label}</h2>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-5 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div>
                  <span className="text-3xl font-bold tabular-nums text-slate-900">{formatValue(card.current, card.unit)}</span>
                  <span className="ml-1 text-sm text-slate-400">{unitTag(card.unit)}</span>
                </div>
                <DeltaBadge card={card} />
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: `${RAG_COLOR[card.status]}18`, color: RAG_COLOR[card.status] }}>
                  <RagDot status={card.status} /> {RAG_LABEL[card.status]}
                </span>
                <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-200">
                  {RANGES.map((r) => (
                    <button key={r.days} onClick={() => setRange(r.days)}
                      className={`px-2.5 py-1 text-[11px] font-semibold ${range === r.days ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}>{r.label}</button>
                  ))}
                </div>
              </div>

              {hasSeries(card.points) ? (
                <div className="rounded-xl border border-slate-200 p-2"><BigTrend card={card} /></div>
              ) : (
                <div className="flex h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
                  <Activity className="h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">Not enough history yet</p>
                  <p className="max-w-xs text-xs text-slate-400">Trends need at least two daily snapshots. This metric’s current value is {formatValue(card.current, card.unit)}.</p>
                </div>
              )}

              {card.dimension && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">By {card.dimension}</p>
                  <div className="rounded-xl border border-slate-200 p-2">
                    {breakdown.isLoading ? <div className="flex h-[200px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
                      : breakdown.data ? <BreakdownChart data={breakdown.data} unit={card.unit} />
                      : <p className="py-6 text-center text-xs text-slate-400">No breakdown available.</p>}
                  </div>
                </div>
              )}

              {card.definition && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">{card.definition}</p>
              )}

              <TargetEditor card={card} onSaved={() => { detail.refetch(); onChanged(); }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── the view ──────────────────────────────────────────────────────────────────
export default function TrendsView() {
  const qc = useQueryClient();
  const [days, setDays] = useState(180);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const { data, isLoading, isError } = useQuery<OverviewResp>({
    queryKey: ['trends', 'overview', days],
    queryFn: () => trendsApi.overview(days),
  });

  const cards = data?.cards ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; cards: TrendCard[] }>();
    for (const c of cards) {
      if (!m.has(c.module)) m.set(c.module, { label: c.module_label, cards: [] });
      m.get(c.module)!.cards.push(c);
    }
    return Array.from(m.values());
  }, [cards]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['trends'] });
  const capture = async () => { setCapturing(true); try { await trendsApi.snapshot(); await invalidate(); } finally { setCapturing(false); } };

  const empty = !isLoading && cards.length > 0 && totalPoints(cards) === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-slate-500">
          Board-level trends across every module — captured daily.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            {RANGES.map((r) => (
              <button key={r.days} onClick={() => setDays(r.days)}
                className={`px-2.5 py-1.5 text-xs font-semibold ${days === r.days ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}>{r.label}</button>
            ))}
          </div>
          <button onClick={capture} disabled={capturing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Capture today’s values now (otherwise captured automatically each night)">
            {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Capture snapshot
          </button>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
            Couldn’t load trends. The reporting backend may need a restart to expose the trends endpoints.
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Activity className="h-9 w-9 text-slate-300" />
            <h3 className="mt-3 text-base font-semibold text-slate-800">No history captured yet</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Trends build up from a daily snapshot of each module’s key numbers. Capture the first point now, and the lines fill in from there.
            </p>
            <button onClick={capture} disabled={capturing}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Capture first snapshot
            </button>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            {groups.map((g) => (
              <section key={g.label}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">{g.label}</h3>
                  <span className="text-xs text-slate-400">{g.cards.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.cards.map((c) => <TrendCardTile key={c.key} card={c} onOpen={() => setOpenKey(c.key)} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {openKey && <TrendDetail metricKey={openKey} days={days} onClose={() => setOpenKey(null)} onChanged={invalidate} />}
    </div>
  );
}
