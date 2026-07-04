'use client';

/**
 * Shared scoring visuals for module dashboards (governance, committees, ERM…).
 * One design language everywhere: score bands (strong/fair/weak), the ScoreRing,
 * the SectionGraphCard (radial rings, one per metric), the MetricRow, and the
 * SectionDetailModal popup. Every number rendered here comes from a backend
 * metric payload {score, weight, numerator, denominator, formula} — these
 * components never compute domain math.
 */
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  Tooltip as RTooltip,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { AnimatedModal } from '@/components/ui/AnimatedModal';

export type OverviewMetric = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  numerator: number;
  denominator: number;
  formula: string;
  inverse?: boolean;
  target: number;
};

export type OverviewSection = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  metrics: OverviewMetric[];
  counts: Record<string, unknown>;
};

export function scoreTone(score: number | null | undefined): string {
  if (score == null) return 'text-slate-400';
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-rose-600';
}

const SCORE_BANDS = [
  { min: 80, hex: '#059669', soft: '#d1fae5', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'strong' },
  { min: 60, hex: '#d97706', soft: '#fef3c7', pill: 'bg-amber-50 text-amber-700 border-amber-200', label: 'fair' },
  { min: 0, hex: '#e11d48', soft: '#ffe4e6', pill: 'bg-rose-50 text-rose-700 border-rose-200', label: 'weak' },
];
const NULL_BAND = { min: 0, hex: '#94a3b8', soft: '#f1f5f9', pill: 'bg-slate-50 text-slate-500 border-slate-200', label: 'no data' };

export function scoreBand(score: number | null | undefined) {
  if (score == null) return NULL_BAND;
  return SCORE_BANDS.find((b) => score >= b.min) ?? NULL_BAND;
}

export function ScoreRing({ score, size = 64 }: { score: number | null; size?: number }) {
  const band = scoreBand(score);
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={band.soft} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={band.hex} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-sm font-bold"
        style={{ color: band.hex }}
      >
        {score == null ? '—' : Math.round(score)}
      </span>
    </div>
  );
}

export function MetricRow({ metric }: { metric: OverviewMetric }) {
  const band = scoreBand(metric.score);
  const pct = metric.score == null ? 0 : Math.max(0, Math.min(100, metric.score));
  return (
    <div className="px-4 py-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-slate-800">{metric.label}</span>
          <span className="flex-shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            w&nbsp;{Math.round(metric.weight * 100)}%
          </span>
        </span>
        <span className="flex flex-shrink-0 items-baseline gap-2">
          {metric.denominator > 0 && (
            <span className="text-[11px] tabular-nums text-slate-400">
              {metric.numerator}/{metric.denominator}
            </span>
          )}
          <span className={`text-sm font-bold tabular-nums ${scoreTone(metric.score)}`}>
            {metric.score == null ? 'n/a' : `${Math.round(metric.score)}%`}
          </span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: metric.score == null ? '#e2e8f0' : band.hex }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-slate-400">= {metric.formula}</p>
    </div>
  );
}

export function SectionGraphCard({ section, onOpen }: { section: OverviewSection; onOpen: () => void }) {
  const band = scoreBand(section.score);
  const rings = section.metrics
    .filter((m) => m.score != null)
    .map((m) => ({
      name: m.label,
      value: Math.round(m.score as number),
      fill: scoreBand(m.score).hex,
    }));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-800">{section.label}</h3>
          <p className="mt-0.5 text-[10px] text-slate-400">{Math.round(section.weight * 100)}% of module score</p>
        </div>
        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${band.pill}`}>
          {band.label}
        </span>
      </div>
      <div className="relative h-[180px]">
        {rings.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            {/* Uniform ring geometry across all cards: fixed pitch/thickness so a
                2-metric card and a 6-metric card read identically; the hole just
                grows when there are fewer rings. */}
            <RadialBarChart
              innerRadius={Math.max(30, 86 - rings.length * Math.min(13, (86 - 30) / rings.length))}
              outerRadius={86}
              data={rings}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
              <RadialBar
                dataKey="value"
                background={{ fill: '#f1f5f9' }}
                cornerRadius={6}
                angleAxisId={0}
                barSize={Math.min(9, (86 - 30) / rings.length - 2)}
              />
              <RTooltip
                contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
                wrapperStyle={{ zIndex: 20 }}
                offset={24}
                formatter={(value) => `${value}%`}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">No data yet</div>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color: band.hex }}>
            {section.score == null ? '—' : Math.round(section.score)}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-slate-400">score</span>
        </div>
      </div>
      <p className="mt-1 text-center text-[10px] text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
        click for details
      </p>
    </button>
  );
}

export function SectionDetailModal({
  section,
  onClose,
}: {
  section: OverviewSection | null;
  onClose: () => void;
}) {
  return (
    <AnimatedModal
      isOpen={section != null}
      onClose={onClose}
      size="lg"
      title={section?.label}
      subtitle={section ? `${Math.round(section.weight * 100)}% of the module performance score` : undefined}
    >
      {section && (
        <div className="p-5">
          <div className="mb-4 flex items-center gap-4 rounded-xl bg-slate-50 p-4">
            <ScoreRing score={section.score} size={72} />
            <div className="min-w-0">
              <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${scoreBand(section.score).pill}`}>
                {scoreBand(section.score).label}
              </span>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Weighted mean of the {section.metrics.length} metrics below — each row shows
                its weight, count, and the exact formula behind the number.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {section.metrics.map((m) => (
              <MetricRow key={m.key} metric={m} />
            ))}
          </div>

          {section.score != null && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
              <p className="text-[11px] leading-5 text-slate-600">
                <span className="font-semibold text-slate-700">Section score</span>{' = '}
                {section.metrics
                  .filter((m) => m.score != null)
                  .map((m) => `${Math.round(m.score as number)}×${Math.round(m.weight * 100)}%`)
                  .join(' + ')}
                {' = '}
                <span className="font-bold text-slate-800">{Math.round(section.score)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </AnimatedModal>
  );
}

/** The original static section card — plain metric rows, no chart. Used where a
 *  module hasn't had its graphical pass yet (or a simpler look is wanted). */
export function SectionStaticCard({ section, onOpen }: { section: OverviewSection; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-slate-300 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{section.label}</h3>
          <p className="text-[10px] text-slate-400">{Math.round(section.weight * 100)}% of module score</p>
        </div>
        <span className={`text-lg font-bold ${scoreTone(section.score)}`}>
          {section.score == null ? '—' : `${Math.round(section.score)}%`}
        </span>
      </div>
      <div className="space-y-1.5">
        {section.metrics.map((m) => (
          <div
            key={m.key}
            className="flex items-center justify-between gap-2 text-xs"
            title={`${m.formula} — ${Math.round(m.weight * 100)}% of section score`}
          >
            <span className="truncate text-slate-600">{m.label}</span>
            <span className="flex flex-shrink-0 items-baseline gap-1.5">
              <span className="text-[10px] text-slate-400">
                {m.denominator ? `${m.numerator}/${m.denominator}` : '—'}
              </span>
              <span className={`font-semibold ${scoreTone(m.score)}`}>
                {m.score == null ? 'n/a' : `${Math.round(m.score)}%`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </button>
  );
}

/** ERM chart family: one vertical column per metric against a dashed 85 target
 *  line. Deliberately a different visual language than the governance radial
 *  rings — every module gets its own chart family. */
export function SectionColumnsCard({ section, onOpen }: { section: OverviewSection; onOpen: () => void }) {
  const band = scoreBand(section.score);
  const data = section.metrics
    .filter((m) => m.score != null)
    .map((m) => ({
      name: m.label,
      value: Math.round(m.score as number),
      fill: scoreBand(m.score).hex,
    }));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-800">{section.label}</h3>
          <p className="mt-0.5 text-[10px] text-slate-400">{Math.round(section.weight * 100)}% of module score</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-2xl font-bold leading-none" style={{ color: band.hex }}>
            {section.score == null ? '—' : Math.round(section.score)}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${band.pill}`}>
            {band.label}
          </span>
        </div>
      </div>
      <div className="h-[150px]">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
              <XAxis dataKey="name" hide />
              <YAxis hide domain={[0, 100]} />
              <ReferenceLine y={85} stroke="#10b981" strokeDasharray="4 4" />
              <RTooltip
                contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
                wrapperStyle={{ zIndex: 20 }}
                formatter={(value) => `${value}%`}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} background={{ fill: '#f1f5f9', radius: 4 }}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">No data yet</div>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
        click for details
      </p>
    </button>
  );
}
