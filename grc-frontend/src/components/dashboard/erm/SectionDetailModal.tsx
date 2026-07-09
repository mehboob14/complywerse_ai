'use client';

import { useEffect, useState } from 'react';
import { X, SlidersHorizontal, Check, RotateCcw, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import type { ModulePerformance, Section } from './types';
import { BAND_COLOR, BAND_LABEL, bandColor, bandOf } from './scoring';
import DraggableWeightBar from './DraggableWeightBar';

interface Row {
  label: string;
  weightChip: string;
  count: string;
  score: number | null;
  formula: string;
}

interface ModalModel {
  title: string;
  subtitle: string;
  score: number;
  color: string;
  grade: string;
  rows: Row[];
  equation: string;
}

/** The card is the graph; this popup is the math. Centered over the dimmed,
 *  blurred page — closes on backdrop click, the X, or Escape. */
export default function SectionDetailModal({
  open,
  onClose,
  section,
  module,
}: {
  open: boolean;
  onClose: () => void;
  section: Section | null;
  module: { perf: ModulePerformance; sections: Section[] } | null;
}) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { setEditing(false); setPreview(null); }, [open, section?.key]);

  if (!open) return null;

  const model = section ? sectionModel(section) : module ? moduleModel(module) : null;
  if (!model) return null;
  // metric-weight editing is only offered on a section (which has editable metrics with keys)
  const canEdit = Boolean(section && section.metrics.some((m) => m.key));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-[540px] max-w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center gap-4 border-b border-slate-100 p-5">
          <ScoreRing
            score={editing && preview != null ? preview : model.score}
            color={editing && preview != null ? bandColor(preview) : model.color}
          />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-slate-900">{model.title}</div>
            <div className="mt-0.5 text-[11.5px] text-slate-400">{model.subtitle}</div>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: `${model.color}14`, color: model.color }}
          >
            {model.grade}
          </span>
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
            >
              <SlidersHorizontal className="h-3 w-3" /> Adjust
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editing && section ? (
          <MetricEditor section={section} onSaved={onClose} onCancel={() => { setEditing(false); setPreview(null); }} onPreview={setPreview} />
        ) : (
        <>
        <div className="px-5 pb-3.5 pt-2">
          {model.rows.map((r) => {
            const color = bandColor(r.score);
            return (
              <div key={r.label} className="border-b border-slate-50 py-3 last:border-b-0">
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{r.label}</span>
                  <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    {r.weightChip}
                  </span>
                  <span className="min-w-[42px] text-right text-[11px] tabular-nums text-slate-400">{r.count}</span>
                  <span className="min-w-[40px] text-right text-[13px] font-bold" style={{ color }}>
                    {r.score == null ? 'n/a' : `${Math.round(r.score)}%`}
                  </span>
                </div>
                <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${r.score == null ? 0 : Math.round(r.score)}%`, backgroundColor: color }}
                  />
                </div>
                <div className="text-[10.5px] leading-snug text-slate-400">{r.formula}</div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 p-5 text-[11px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">Score = </span>
          {model.equation}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

/** Drag-to-rebalance the metric weights inside a section, saved per-tenant. */
function MetricEditor({ section, onSaved, onCancel, onPreview }: { section: Section; onSaved: () => void; onCancel: () => void; onPreview: (s: number | null) => void }) {
  const qc = useQueryClient();
  const metrics = section.metrics.filter((m) => m.key);
  const [weights, setWeights] = useState<number[]>(() => {
    const w = metrics.map((m) => m.weight);
    const s = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => x / s);
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['erm-sections-overview'] });
  const save = useMutation({
    mutationFn: async () => {
      const mw = Object.fromEntries(metrics.map((m, i) => [m.key as string, weights[i]]));
      return apiClient.put('/erm/dashboard/scorecard-config', { metric_weights: { [section.key]: mw } });
    },
    onSuccess: () => { invalidate(); onSaved(); },
  });
  const reset = useMutation({
    mutationFn: async () => apiClient.delete(`/erm/dashboard/scorecard-config?section=${encodeURIComponent(section.key)}`),
    onSuccess: () => { invalidate(); onSaved(); },
  });

  const total = weights.reduce((a, b) => a + b, 0) || 1;

  // Nudge one metric up/down and rebalance the rest proportionally (stays 100%).
  const adjust = (index: number, delta: number) => {
    setWeights((w) => {
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      const cur = w.map((x) => x / tot);
      const target = Math.max(0.02, Math.min(0.98, cur[index] + delta));
      const actual = target - cur[index];
      const otherSum = cur.reduce((a, b, i) => (i === index ? a : a + b), 0);
      if (otherSum <= 0) return w;
      const scale = (otherSum - actual) / otherSum;
      const next = cur.map((x, i) => (i === index ? target : Math.max(0.005, x * scale)));
      const s = next.reduce((a, b) => a + b, 0);
      return next.map((x) => x / s);
    });
  };

  // Live section-score preview from the edited weights (before saving).
  const previewScore = (() => {
    const scored = metrics.map((m, i) => ({ s: m.score, w: weights[i] })).filter((x) => x.s != null);
    const tw = scored.reduce((a, x) => a + x.w, 0);
    return tw ? Math.round(scored.reduce((a, x) => a + (x.s as number) * x.w, 0) / tw) : null;
  })();
  useEffect(() => { onPreview(previewScore); }, [previewScore, onPreview]);

  return (
    <div className="px-5 pb-4 pt-2">
      <p className="mb-2 text-[11px] text-slate-500">
        Use <b>+ / −</b> (or drag the bar) to rebalance — always totals 100%. The score ring above updates
        {previewScore != null ? <> live · now <b style={{ color: bandColor(previewScore) }}>{previewScore}%</b></> : ' live'}.
      </p>
      <DraggableWeightBar items={metrics.map((m) => ({ key: m.key, label: m.label, score: m.score }))} weights={weights} onChange={setWeights} />

      <div className="mt-3 space-y-1">
        {metrics.map((m, i) => (
          <div key={m.key} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: bandColor(m.score) }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{m.label}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => adjust(i, -0.05)}
                className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[13px] leading-none text-slate-500 hover:bg-slate-100">−</button>
              <span className="w-10 text-center tabular-nums font-semibold text-slate-700">{Math.round((weights[i] / total) * 100)}%</span>
              <button type="button" onClick={() => adjust(i, 0.05)}
                className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[13px] leading-none text-slate-500 hover:bg-slate-100">+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
        <button type="button" onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50">
          <X className="h-3 w-3" /> Cancel
        </button>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
        </button>
      </div>
    </div>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <div className="relative h-[58px] w-[58px] flex-shrink-0">
      <svg width={58} height={58} viewBox="0 0 58 58" className="-rotate-90">
        <circle cx={29} cy={29} r={r} fill="none" stroke="#eef1f2" strokeWidth={5} />
        <circle cx={29} cy={29} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[15px] font-bold" style={{ color }}>
        {Math.round(score)}
      </div>
    </div>
  );
}

function sectionModel(s: Section): ModalModel {
  const band = bandOf(s.score);
  const rows: Row[] = s.metrics.map((m) => ({
    label: m.label,
    weightChip: `w ${Math.round(m.weight * 100)}%`,
    count: m.count,
    score: m.score,
    formula: m.formula,
  }));
  const equation =
    s.metrics
      .filter((m) => m.score != null)
      .map((m) => `${Math.round(m.score as number)}×${Math.round(m.weight * 100)}%`)
      .join(' + ') + ` = ${Math.round(s.score ?? 0)}`;
  return {
    title: s.label,
    subtitle: `${Math.round(s.weight * 100)}% of module score`,
    score: s.score ?? 0,
    color: BAND_COLOR[band],
    grade: BAND_LABEL[band],
    rows,
    equation,
  };
}

function moduleModel({ perf, sections }: { perf: ModulePerformance; sections: Section[] }): ModalModel {
  const rows: Row[] = sections.map((s) => ({
    label: s.label,
    weightChip: `w ${Math.round(s.weight * 100)}%`,
    count: '',
    score: s.score,
    formula: `contributes ${(((s.score ?? 0) * s.weight)).toFixed(1)} pts to the module score`,
  }));
  const liveWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const equation =
    '( ' +
    sections.map((s) => `${Math.round(s.score ?? 0)}×${Math.round(s.weight * 100)}%`).join(' + ') +
    ` ) ÷ ${Math.round(liveWeight * 100)}% live weight = ${perf.score}` +
    ` — the ${perf.upcomingSections} arriving sections re-normalize the rest`;
  return {
    title: 'Module Performance',
    subtitle: `Weighted across ${sections.length} live sections · ${perf.upcomingSections} arriving`,
    score: perf.score,
    color: bandColor(perf.score),
    grade: perf.grade.toUpperCase(),
    rows,
    equation,
  };
}
