'use client';

// Trends: how the platform's headline numbers move over time.
// Backend: /reporting/trends/* (grc/routers/reporting_router.py) reads daily snapshots from
// grc_metric_snapshot, adds period-over-period change and a red/amber/green status against each
// metric's target, and lets a user tune targets or capture a snapshot on demand.
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertCircle, Camera, Loader2, RotateCcw, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { useToast } from '@/cyber-assurance/components/ui';
import {
  apiErrorMessage, trendsApi,
  type TrendBreakdown, type TrendCard, type TrendPoint, type TrendStatus, type TrendUnit,
} from '@/cyber-assurance/lib/reportingExtrasApi';
import { ACCENT, Chip, EmptyBlock, PanelShell, btnGhost, btnPrimary, fmtDate, inputCls } from './shared';

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

// ComplyVerse is cyber-only: the metric catalog is shared with GRC, so hide the GRC-only modules
// (their snapshots are meaningless here). Edit this set to show more.
const GRC_ONLY_MODULES = new Set(['risk', 'compliance', 'controls', 'evidence', 'vendors', 'governance']);

const STATUS_CHIP: Record<TrendStatus, { label: string; tone: 'ok' | 'warn' | 'bad' } | null> = {
  ok: { label: 'On target', tone: 'ok' },
  warn: { label: 'Watch', tone: 'warn' },
  critical: { label: 'Off target', tone: 'bad' },
  none: null,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#B91C1C',
  high: '#EA580C',
  medium: '#CA8A04',
  low: '#047857',
  info: '#64748B',
};
const PALETTE = ['#7C3AED', '#0E7490', '#B45309', '#BE185D', '#4D7C0F', '#334155'];

function fmtValue(v: number | null | undefined, unit: TrendUnit): string {
  if (v == null || Number.isNaN(v)) return '-';
  const r1 = Math.round(v * 10) / 10;
  switch (unit) {
    case 'count':
      return Math.round(v).toLocaleString();
    case 'pct':
      return `${r1.toLocaleString()}%`;
    case 'days':
      return `${r1.toLocaleString()} d`;
    default:
      return r1.toLocaleString();
  }
}

const hasData = (c: TrendCard) => c.points.some((p) => p.value != null);
const labelizeKey = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function targetText(c: TrendCard): string | null {
  if (c.target == null || c.direction === 'neutral') return null;
  return `Target ${c.direction === 'down_good' ? '≤' : '≥'} ${fmtValue(c.target, c.unit)}`;
}

// ── tiny charts ─────────────────────────────────────────────────────────────────────────

type Pt = { date: string; value: number };
const clean = (pts: TrendPoint[]): Pt[] => pts.filter((p): p is Pt => p.value != null);
const ts = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

function Sparkline({ points }: { points: TrendPoint[] }) {
  const vals = clean(points);
  const W = 240;
  const H = 44;
  const pad = 4;
  if (vals.length === 0) return <div className="h-11" />;
  const lo = Math.min(...vals.map((p) => p.value));
  const hi = Math.max(...vals.map((p) => p.value));
  const span = hi - lo || 1;
  const t0 = ts(vals[0].date);
  const t1 = ts(vals[vals.length - 1].date);
  const x = (d: string) => (t1 === t0 ? W / 2 : pad + ((ts(d) - t0) / (t1 - t0)) * (W - 2 * pad));
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const last = vals[vals.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Trend sparkline">
      {vals.length > 1 && (
        <polyline
          points={vals.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          fill="none"
          style={{ stroke: 'var(--color-base)' }}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle cx={x(last.date)} cy={y(last.value)} r={3.5} style={{ fill: 'var(--color-base)' }} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

interface Series {
  key: string;
  label: string;
  color: string;
  width?: number;
  points: TrendPoint[];
}

function LineChart({
  series,
  unit,
  target,
  height = 230,
}: {
  series: Series[];
  unit: TrendUnit;
  target?: number | null;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const L = 50;
  const R = 18;
  const T = 14;
  const B = 28;

  const prepared = useMemo(
    () => series.map((s) => ({ ...s, pts: clean(s.points) })).filter((s) => s.pts.length > 0),
    [series],
  );
  const dates = useMemo(
    () => Array.from(new Set(prepared.flatMap((s) => s.pts.map((p) => p.date)))).sort(),
    [prepared],
  );
  if (prepared.length === 0 || dates.length === 0) return null;

  const allVals = prepared.flatMap((s) => s.pts.map((p) => p.value));
  let lo = Math.min(...allVals, ...(target != null ? [target] : []));
  let hi = Math.max(...allVals, ...(target != null ? [target] : []));
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const padY = (hi - lo) * 0.08;
  lo -= padY;
  hi += padY;
  if (unit !== 'score' && lo < 0 && Math.min(...allVals) >= 0) lo = 0; // counts / pct / days never dip below zero
  const t0 = ts(dates[0]);
  const t1 = ts(dates[dates.length - 1]);
  const x = (d: string) => (t1 === t0 ? (L + W - R) / 2 : L + ((ts(d) - t0) / (t1 - t0)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    dates.forEach((d, i) => {
      const dd = Math.abs(x(d) - px);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setHover(best);
  };

  const hd = hover != null ? dates[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Trend chart"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--color-border)' }} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} style={{ fill: 'var(--color-muted)' }}>
              {fmtValue(t, unit)}
            </text>
          </g>
        ))}
        <text x={L} y={H - 8} fontSize={11} textAnchor="start" style={{ fill: 'var(--color-muted)' }}>
          {fmtDate(dates[0])}
        </text>
        <text x={W - R} y={H - 8} fontSize={11} textAnchor="end" style={{ fill: 'var(--color-muted)' }}>
          {fmtDate(dates[dates.length - 1])}
        </text>

        {target != null && (
          <g>
            <line
              x1={L}
              x2={W - R}
              y1={y(target)}
              y2={y(target)}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              style={{ stroke: 'var(--color-success)' }}
            />
            <text x={W - R - 2} y={y(target) - 5} textAnchor="end" fontSize={11} style={{ fill: 'var(--color-success)' }}>
              Target {fmtValue(target, unit)}
            </text>
          </g>
        )}

        {prepared.map((s) => (
          <g key={s.key}>
            {s.pts.length > 1 && (
              <polyline
                points={s.pts.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {s.pts.length <= 40 &&
              s.pts.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={2.6} fill={s.color} />)}
          </g>
        ))}

        {hd && (
          <g>
            <line x1={x(hd)} x2={x(hd)} y1={T} y2={H - B} style={{ stroke: 'var(--color-muted)' }} strokeWidth={1} strokeDasharray="3 3" />
            {prepared.map((s) => {
              const p = s.pts.find((q) => q.date === hd);
              return p ? <circle key={s.key} cx={x(hd)} cy={y(p.value)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={1.5} /> : null;
            })}
          </g>
        )}
      </svg>

      {hd && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(x(hd) / W) * 100}%`,
            transform: x(hd) / W > 0.7 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <div className="mb-0.5 font-semibold text-[var(--color-text)]">{fmtDate(hd)}</div>
          {prepared.map((s) => {
            const p = s.pts.find((q) => q.date === hd);
            return p ? (
              <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-[var(--color-text)]">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}: <span className="font-medium">{fmtValue(p.value, unit)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}

      {prepared.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
          {prepared.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── one metric ──────────────────────────────────────────────────────────────────────────

function Delta({ card }: { card: TrendCard }) {
  const d = card.delta_abs;
  if (d == null) return <span className="text-xs text-[var(--color-muted)]">No earlier point yet</span>;
  if (d === 0) return <span className="text-xs text-[var(--color-muted)]">No change</span>;
  const up = d > 0;
  const good = card.direction === 'neutral' ? null : (card.direction === 'up_good') === up;
  const color = good == null ? 'var(--color-muted)' : good ? 'var(--color-success)' : 'var(--color-danger)';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium"
      style={{ color }}
      title="Change since about 30 days earlier (or since the first recorded point)"
    >
      <Icon size={13} />
      {up ? '+' : ''}
      {fmtValue(d, card.unit)}
      {card.delta_pct != null ? ` (${up ? '+' : ''}${card.delta_pct}%)` : ''}
      <span className="font-normal text-[var(--color-muted)]">vs previous</span>
    </span>
  );
}

function MetricCard({ card, open, onToggle }: { card: TrendCard; open: boolean; onToggle: () => void }) {
  const chip = STATUS_CHIP[card.status];
  const tt = targetText(card);
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="flex flex-col rounded-xl border bg-[var(--color-surface)] p-3.5 text-left transition-shadow hover:shadow-md"
      style={{ borderColor: open ? ACCENT : 'var(--color-border)', boxShadow: open ? '0 0 0 1px var(--color-base)' : undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--color-muted)]">{card.label}</span>
        {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text)]">
        {fmtValue(card.current, card.unit)}
      </div>
      <div className="mt-0.5">
        <Delta card={card} />
      </div>
      <div className="mt-2">
        <Sparkline points={card.points} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span>{tt ?? 'No target set'}</span>
        <span>{card.as_of ? `As of ${fmtDate(card.as_of)}` : ''}</span>
      </div>
    </button>
  );
}

function TargetEditor({ card }: { card: TrendCard }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState(card.target == null ? '' : String(card.target));
  const [warn, setWarn] = useState(card.warn == null ? '' : String(card.warn));
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const invalid = [target, warn].some((s) => s.trim() !== '' && Number.isNaN(Number(s)));
  const refresh = () => qc.invalidateQueries({ queryKey: ['trends-overview'] });

  const save = useMutation({
    mutationFn: () =>
      trendsApi.setTarget({ metric: card.key, target: num(target), warn: num(warn), critical: card.critical }),
    onSuccess: () => {
      toast({ title: 'Target saved', message: card.label, type: 'success' });
      refresh();
    },
    onError: (e) => toast({ title: 'Could not save the target', message: apiErrorMessage(e), type: 'error' }),
  });
  const reset = useMutation({
    mutationFn: () => trendsApi.resetTarget(card.key),
    onSuccess: () => {
      toast({ title: 'Target reset to the default', message: card.label, type: 'success' });
      refresh();
    },
    onError: (e) => toast({ title: 'Could not reset the target', message: apiErrorMessage(e), type: 'error' }),
  });

  if (card.direction === 'neutral') {
    return (
      <p className="text-[13px] text-[var(--color-muted)]">
        This is an informational metric — it has no target, so it is not graded red / amber / green.
      </p>
    );
  }
  const better = card.direction === 'down_good' ? 'at or below' : 'at or above';
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Target</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={`${inputCls} w-28`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Watch limit</span>
          <input value={warn} onChange={(e) => setWarn(e.target.value)} inputMode="decimal" className={`${inputCls} w-28`} />
        </label>
        <button onClick={() => save.mutate()} disabled={invalid || save.isPending} className={btnPrimary} style={{ background: ACCENT }}>
          {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />} Save target
        </button>
        <button onClick={() => reset.mutate()} disabled={reset.isPending} className={btnGhost}>
          {reset.isPending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Use default
        </button>
      </div>
      <p className="mt-2 text-[12px] text-[var(--color-muted)]">
        On target when {better} the target; Watch when it is past the target but {better} the watch limit; Off target beyond that.
      </p>
    </div>
  );
}

function MetricDetail({ card, days }: { card: TrendCard; days: number }) {
  const { data: breakdown, isLoading } = useQuery({
    queryKey: ['trends-breakdown', card.key, days],
    queryFn: async () => (await trendsApi.breakdown(card.key, days)).data as TrendBreakdown,
    enabled: !!card.dimension,
  });

  const series: Series[] = useMemo(() => {
    const base: Series = { key: '__total', label: card.dimension ? 'Total' : card.label, color: 'var(--color-base)', width: 2.5, points: card.points };
    const slices = (breakdown?.series ?? []).map((s, i) => ({
      key: s.key,
      label: labelizeKey(s.key),
      color: SEVERITY_COLOR[s.key.toLowerCase()] ?? PALETTE[i % PALETTE.length],
      width: 1.8,
      points: s.points,
    }));
    return [base, ...slices];
  }, [card, breakdown]);

  const nPoints = clean(card.points).length;
  return (
    <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        {/* flex-1 min-w-0: without min-width:0 this flex item shrinks to its
            longest word in a narrow card, wrapping the definition one word per
            line. flex-1 lets it take the row's width so the text wraps normally. */}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{card.label}</h3>
          <p className="mt-0.5 max-w-2xl text-[13px] text-[var(--color-muted)]">{card.definition}</p>
        </div>
        <span className="text-xs text-[var(--color-muted)]">
          {nPoints} data point{nPoints === 1 ? '' : 's'} in this range
        </span>
      </div>

      {nPoints < 2 ? (
        <p className="rounded-lg bg-[var(--color-subtle)] px-3 py-3 text-[13px] text-[var(--color-muted)]">
          Only {nPoints} snapshot so far, so there is no line to draw yet. History builds with each daily snapshot.
        </p>
      ) : (
        <LineChart series={series} unit={card.unit} target={card.direction === 'neutral' ? null : card.target} />
      )}
      {card.dimension && isLoading && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Loader2 size={12} className="animate-spin" /> Loading the {card.dimension} breakdown…
        </div>
      )}

      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <TargetEditor key={`${card.key}:${card.target}:${card.warn}`} card={card} />
      </div>
    </div>
  );
}

// ── the panel ───────────────────────────────────────────────────────────────────────────

export default function TrendsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [days, setDays] = useState(180);
  const [moduleKey, setModuleKey] = useState('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['trends-overview', days],
    queryFn: async () => (await trendsApi.overview(days)).data,
  });

  const snapshot = useMutation({
    mutationFn: () => trendsApi.captureSnapshot(),
    onSuccess: (res) => {
      toast({
        title: 'Snapshot captured',
        message: `${res.data.written} metric value${res.data.written === 1 ? '' : 's'} recorded for ${res.data.as_of}.`,
        type: 'success',
      });
      qc.invalidateQueries({ queryKey: ['trends-overview'] });
      qc.invalidateQueries({ queryKey: ['trends-breakdown'] });
    },
    onError: (e) => toast({ title: 'Could not capture a snapshot', message: apiErrorMessage(e), type: 'error' }),
  });

  const visible = useMemo(
    () => (data?.cards ?? []).filter((c) => !GRC_ONLY_MODULES.has(c.module) && hasData(c)),
    [data],
  );
  const modules = useMemo(() => {
    const seen = new Map<string, string>();
    visible.forEach((c) => seen.set(c.module, c.module_label));
    return Array.from(seen, ([key, label]) => ({ key, label }));
  }, [visible]);
  const shown = moduleKey === 'all' ? visible : visible.filter((c) => c.module === moduleKey);
  const groups = modules
    .map((m) => ({ ...m, cards: shown.filter((c) => c.module === m.key) }))
    .filter((g) => g.cards.length > 0);

  const captureBtn = (primary: boolean) => (
    <button
      onClick={() => snapshot.mutate()}
      disabled={snapshot.isPending}
      className={primary ? btnPrimary : btnGhost}
      style={primary ? { background: ACCENT } : undefined}
      title="Record today's values now instead of waiting for the daily snapshot"
    >
      {snapshot.isPending ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} Capture snapshot now
    </button>
  );

  return (
    <PanelShell
      icon={Activity}
      title="Trends"
      description="How vulnerabilities and assets are moving, with change since the previous reading and status against each target. Click a metric for the full chart and to set its target."
      actions={
        <>
          <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)]">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className="px-3 py-1.5 text-sm font-medium"
                style={days === r.days ? { background: ACCENT, color: 'var(--color-on-base)' } : { color: 'var(--color-muted)' }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {visible.length > 0 && captureBtn(false)}
        </>
      }
    >
      {isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 size={15} className="animate-spin" /> Loading trends…
        </div>
      ) : isError ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} /> {apiErrorMessage(error, 'Could not load trends.')}
        </div>
      ) : visible.length === 0 ? (
        <EmptyBlock icon={Activity} title="No trend history yet">
          Trends are drawn from daily snapshots of your numbers. Capture the first one now and the history grows from there.
          <div className="mt-3">{captureBtn(true)}</div>
        </EmptyBlock>
      ) : (
        <div className="mt-4 space-y-5">
          {modules.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {[{ key: 'all', label: 'All' }, ...modules].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setModuleKey(m.key)}
                  className="rounded-full border px-3 py-1 text-xs font-medium"
                  style={
                    moduleKey === m.key
                      ? { background: ACCENT, color: 'var(--color-on-base)', borderColor: ACCENT }
                      : { borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{g.label}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.cards.map((c) => (
                  <MetricCard key={c.key} card={c} open={openKey === c.key} onToggle={() => setOpenKey(openKey === c.key ? null : c.key)} />
                ))}
              </div>
              {g.cards.some((c) => c.key === openKey) && (
                <MetricDetail card={g.cards.find((c) => c.key === openKey)!} days={days} />
              )}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}
