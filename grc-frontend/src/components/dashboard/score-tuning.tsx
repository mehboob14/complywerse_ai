'use client';

/**
 * Per-tenant weight tuning for the shared-kit module scorecards
 * (Governance · Compliance · IT Assets — same engine as ERM/Risk). Two editors
 * in one visual language:
 *   • SectionWeightTuner — rebalance how much each SECTION counts toward the
 *     module score, plus the target line.
 *   • MetricWeightEditor — rebalance the METRIC weights inside one section.
 * Both give a draggable 100%-bar, +/- steppers, and a LIVE weighted-score
 * preview before you save. Persists to `${configBase}/scorecard-config`
 * (PUT {weights|metric_weights, target}; DELETE resets to defaults).
 *
 * Only the WEIGHTS are editable here — the measured facts behind every metric
 * (its numerator/denominator) come from the system and never change.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, X, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import type { OverviewSection } from './score-kit';

const MIN = 0.02;

// Local band colour (mirrors score-kit SCORE_BANDS) — kept here so this module
// has no runtime dependency back on score-kit (avoids an import cycle).
function hex(score?: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 80) return '#059669';
  if (score >= 60) return '#d97706';
  return '#e11d48';
}

// Proportionally rebalance so the weights always total 1 after nudging `index`.
function rebalance(weights: number[], index: number, delta: number): number[] {
  const tot = weights.reduce((a, b) => a + b, 0) || 1;
  const cur = weights.map((x) => x / tot);
  const target = Math.max(MIN, Math.min(0.98, cur[index] + delta));
  const otherSum = cur.reduce((a, b, i) => (i === index ? a : a + b), 0);
  if (otherSum <= 0) return weights;
  const scale = (otherSum - (target - cur[index])) / otherSum;
  const next = cur.map((x, i) => (i === index ? target : Math.max(0.005, x * scale)));
  const s = next.reduce((a, b) => a + b, 0);
  return next.map((x) => x / s);
}

function weightedPreview(scores: (number | null | undefined)[], weights: number[]): number | null {
  const scored = scores.map((s, i) => ({ s, w: weights[i] })).filter((x) => x.s != null);
  const tw = scored.reduce((a, x) => a + x.w, 0);
  return tw ? Math.round(scored.reduce((a, x) => a + (x.s as number) * x.w, 0) / tw) : null;
}

/** A horizontal 100% bar whose dividers you drag to shift weight between
 *  adjacent segments (none drops below MIN). */
export function DraggableWeightBar({
  items,
  weights,
  onChange,
  height = 30,
}: {
  items: { key?: string; label: string; score?: number | null }[];
  weights: number[];
  onChange: (w: number[]) => void;
  height?: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ i: number; startX: number; base: number[] } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current, bar = barRef.current;
      if (!d || !bar) return;
      const w = bar.getBoundingClientRect().width || 1;
      let delta = (e.clientX - d.startX) / w;
      const left = d.base[d.i], right = d.base[d.i + 1];
      delta = Math.max(-(left - MIN), Math.min(right - MIN, delta));
      const next = [...d.base];
      next[d.i] = left + delta;
      next[d.i + 1] = right - delta;
      onChange(next);
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [onChange]);

  const total = weights.reduce((a, b) => a + b, 0) || 1;

  return (
    <div ref={barRef} className="relative flex select-none overflow-hidden rounded-md" style={{ height }}>
      {items.map((it, i) => {
        const pct = (weights[i] / total) * 100;
        return (
          <div
            key={it.key ?? i}
            className="relative flex items-center justify-center overflow-hidden text-[9.5px] font-semibold text-white"
            style={{ width: `${pct}%`, backgroundColor: hex(it.score) }}
            title={`${it.label} · ${Math.round(pct)}%`}
          >
            {pct >= 7 ? `${Math.round(pct)}%` : ''}
            {i < items.length - 1 && (
              <div
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); dragRef.current = { i, startX: e.clientX, base: [...weights] }; }}
                className="absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
                style={{ touchAction: 'none' }}
                title="Drag to shift weight"
              >
                <div className="h-full w-[2px] rounded bg-white/80 shadow" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stepper({
  label, score, pct, onMinus, onPlus,
}: { label: string; score: number | null | undefined; pct: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: hex(score) }} />
      <span className="min-w-0 flex-1 truncate text-slate-600">{label}</span>
      <button type="button" onClick={onMinus}
        className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[13px] leading-none text-slate-500 hover:bg-slate-100">−</button>
      <span className="w-10 text-center tabular-nums font-semibold text-slate-700">{Math.round(pct)}%</span>
      <button type="button" onClick={onPlus}
        className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[13px] leading-none text-slate-500 hover:bg-slate-100">+</button>
    </div>
  );
}

function TunerButtons({
  onReset, resetting, onCancel, onSave, saving, saveDisabled,
}: { onReset: () => void; resetting: boolean; onCancel: () => void; onSave: () => void; saving: boolean; saveDisabled?: boolean }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" onClick={onReset} disabled={resetting}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
        <RotateCcw className="h-3 w-3" /> Reset
      </button>
      <button type="button" onClick={onCancel}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50">
        <X className="h-3 w-3" /> Cancel
      </button>
      <button type="button" onClick={onSave} disabled={saving || saveDisabled}
        className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
      </button>
    </div>
  );
}

/** Rebalance the SECTION weights of a module (+ the target line). Sections come
 *  from the live card so the starting point always matches what's on screen. */
/** SectionWeightTuner rendered inside a centered popup/modal overlay. */
export function SectionWeightTunerModal(props: {
  sections: OverviewSection[];
  configBase: string;
  invalidateKey: unknown[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={props.onClose} />
      <div className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" style={{ maxHeight: '85vh' }}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Adjust section weights</h3>
        <SectionWeightTuner {...props} />
      </div>
    </div>
  );
}

export function SectionWeightTuner({
  sections,
  configBase,
  invalidateKey,
  onClose,
}: {
  sections: OverviewSection[];
  configBase: string;
  invalidateKey: unknown[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [weights, setWeights] = useState<number[]>(() => {
    const w = sections.map((s) => s.weight);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => x / sum);
  });
  const [target, setTarget] = useState(85);

  const { data: cfg } = useQuery<{ target?: number }>({
    queryKey: [...invalidateKey, 'scorecard-config'],
    queryFn: async () => (await apiClient.get(`${configBase}/scorecard-config`)).data,
    staleTime: 0,
  });
  useEffect(() => { if (cfg?.target != null) setTarget(cfg.target); }, [cfg]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: invalidateKey });
    qc.invalidateQueries({ queryKey: [...invalidateKey, 'scorecard-config'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const weightsMap = Object.fromEntries(sections.map((s, i) => [s.key, weights[i]]));
      return apiClient.put(`${configBase}/scorecard-config`, { weights: weightsMap, target });
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  const reset = useMutation({
    mutationFn: async () => apiClient.delete(`${configBase}/scorecard-config`),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const preview = weightedPreview(sections.map((s) => s.score), weights);

  return (
    <div>
      <p className="mb-2 text-[11px] leading-4 text-slate-500">
        Rebalance how much each section counts toward the module score — always totals 100%.
        {preview != null ? <> Module score → <b style={{ color: hex(preview) }}>{preview}</b>.</> : null}{' '}
        The section scores themselves never change.
      </p>
      <DraggableWeightBar items={sections.map((s) => ({ key: s.key, label: s.label, score: s.score }))} weights={weights} onChange={setWeights} />
      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {sections.map((s, i) => (
          <Stepper key={s.key} label={s.label} score={s.score} pct={(weights[i] / total) * 100}
            onMinus={() => setWeights((w) => rebalance(w, i, -0.05))}
            onPlus={() => setWeights((w) => rebalance(w, i, 0.05))} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Target
          <input type="number" min={0} max={100} value={target}
            onChange={(e) => setTarget(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums" />
        </label>
        <TunerButtons onReset={() => reset.mutate()} resetting={reset.isPending}
          onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} />
      </div>
    </div>
  );
}

/** Rebalance the METRIC weights inside one section. Reports a live section-score
 *  preview via onPreview so the caller can animate the section's score ring. */
export function MetricWeightEditor({
  section,
  configBase,
  invalidateKey,
  onSaved,
  onCancel,
  onPreview,
}: {
  section: OverviewSection;
  configBase: string;
  invalidateKey: unknown[];
  onSaved: () => void;
  onCancel: () => void;
  onPreview: (s: number | null) => void;
}) {
  const qc = useQueryClient();
  const metrics = section.metrics.filter((m) => m.key);
  const [weights, setWeights] = useState<number[]>(() => {
    const w = metrics.map((m) => m.weight);
    const s = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => x / s);
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: invalidateKey });
  const save = useMutation({
    mutationFn: async () => {
      const mw = Object.fromEntries(metrics.map((m, i) => [m.key as string, weights[i]]));
      return apiClient.put(`${configBase}/scorecard-config`, { metric_weights: { [section.key]: mw } });
    },
    onSuccess: () => { invalidate(); onSaved(); },
  });
  const reset = useMutation({
    mutationFn: async () => apiClient.delete(`${configBase}/scorecard-config?section=${encodeURIComponent(section.key)}`),
    onSuccess: () => { invalidate(); onSaved(); },
  });

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const preview = weightedPreview(metrics.map((m) => m.score), weights);
  useEffect(() => { onPreview(preview); }, [preview, onPreview]);

  return (
    <div className="pt-1">
      <p className="mb-2 text-[11px] leading-4 text-slate-500">
        Use <b>+ / −</b> (or drag the bar) to rebalance the metric weights — always totals 100%. The score ring above updates
        {preview != null ? <> live · now <b style={{ color: hex(preview) }}>{preview}%</b></> : ' live'}. The measured numbers never change.
      </p>
      <DraggableWeightBar items={metrics.map((m) => ({ key: m.key, label: m.label, score: m.score }))} weights={weights} onChange={setWeights} />
      <div className="mt-3 space-y-1">
        {metrics.map((m, i) => (
          <Stepper key={m.key} label={m.label} score={m.score} pct={(weights[i] / total) * 100}
            onMinus={() => setWeights((w) => rebalance(w, i, -0.05))}
            onPlus={() => setWeights((w) => rebalance(w, i, 0.05))} />
        ))}
      </div>
      <div className="mt-4 flex items-center">
        <TunerButtons onReset={() => reset.mutate()} resetting={reset.isPending}
          onCancel={onCancel} onSave={() => save.mutate()} saving={save.isPending} />
      </div>
    </div>
  );
}
