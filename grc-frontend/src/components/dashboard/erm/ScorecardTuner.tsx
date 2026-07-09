'use client';

/**
 * Draggable weight editor for the ERM module scorecard. The "weighted
 * contribution by section" bar becomes draggable — grab a boundary between two
 * sections to shift weight from one to the other (always totals 100%). Plus an
 * editable target. Save persists per-tenant (PUT /erm/dashboard/scorecard-config)
 * and the module score recomputes; Reset restores the built-in defaults.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, X, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { bandColor } from './scoring';

type CfgSection = { key: string; label: string; default_weight: number; weight: number };
type Cfg = { module: string; sections: CfgSection[]; target: number; default_target: number; customized: boolean };

const SHORT: Record<string, string> = {
  register: 'Register', assessments: 'Assess', rcsa: 'RCSA', controls: 'Controls', vendor_risk: 'Vendor',
  kris: 'KRIs', appetite: 'Appetite', mitigation: 'Mitig.', reviews: 'Reviews', incidents: 'Inc.',
};
const MIN = 0.02; // a section can't drop below 2%

export default function ScorecardTuner({ scoreByKey, onClose }: { scoreByKey: Record<string, number | null | undefined>; onClose: () => void }) {
  const qc = useQueryClient();
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ i: number; startX: number; base: number[] } | null>(null);
  const [secs, setSecs] = useState<CfgSection[]>([]);
  const [weights, setWeights] = useState<number[]>([]); // parallel to secs, sums to 1
  const [target, setTarget] = useState(85);

  const { data: cfg, isLoading } = useQuery<Cfg>({
    queryKey: ['erm-scorecard-config'],
    queryFn: async () => (await apiClient.get('/erm/dashboard/scorecard-config')).data,
    staleTime: 0,
  });

  useEffect(() => {
    if (!cfg?.sections?.length) return;
    setSecs(cfg.sections);
    const w = cfg.sections.map((s) => s.weight);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    setWeights(w.map((x) => x / sum));
    setTarget(cfg.target);
  }, [cfg]);

  // window-level drag so the pointer can leave the handle
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
      setWeights(next);
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const body = { weights: Object.fromEntries(secs.map((s, i) => [s.key, weights[i]])), target };
      return (await apiClient.put('/erm/dashboard/scorecard-config', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['erm-sections-overview'] });
      qc.invalidateQueries({ queryKey: ['erm-scorecard-config'] });
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: async () => (await apiClient.delete('/erm/dashboard/scorecard-config')).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['erm-sections-overview'] });
      qc.invalidateQueries({ queryKey: ['erm-scorecard-config'] });
      onClose();
    },
  });

  if (isLoading || !weights.length) {
    return <div className="flex h-[30px] items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;
  }

  const changed = secs.some((s, i) => Math.abs(weights[i] - s.weight) > 0.001) || target !== cfg?.target;

  // Nudge one section up/down and rebalance the rest proportionally (stays 100%).
  const adjust = (index: number, delta: number) => {
    const tot = weights.reduce((a, b) => a + b, 0) || 1;
    const cur = weights.map((x) => x / tot);
    const targetW = Math.max(0.02, Math.min(0.98, cur[index] + delta));
    const actual = targetW - cur[index];
    const otherSum = cur.reduce((a, b, i) => (i === index ? a : a + b), 0);
    if (otherSum <= 0) return;
    const scale = (otherSum - actual) / otherSum;
    const next = cur.map((x, i) => (i === index ? targetW : Math.max(0.005, x * scale)));
    const s = next.reduce((a, b) => a + b, 0);
    setWeights(next.map((x) => x / s));
  };

  // Live module-score preview from the edited section weights (before saving).
  const previewScore = (() => {
    const scored = secs.map((s, i) => ({ sc: scoreByKey[s.key], w: weights[i] })).filter((x) => x.sc != null);
    const tw = scored.reduce((a, x) => a + x.w, 0);
    return tw ? Math.round(scored.reduce((a, x) => a + ((x.sc as number) * x.w), 0) / tw) : null;
  })();

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div ref={barRef} className="relative flex h-[30px] select-none rounded-md">
        {secs.map((s, i) => (
          <div
            key={s.key}
            className="relative flex items-center justify-center overflow-hidden text-[9.5px] font-semibold text-white"
            style={{ width: `${weights[i] * 100}%`, backgroundColor: bandColor(scoreByKey[s.key]) }}
            title={`${s.label} · ${Math.round(weights[i] * 100)}% weight`}
          >
            {weights[i] >= 0.06 ? `${SHORT[s.key] ?? s.label.split(' ')[0]} ${Math.round(weights[i] * 100)}%` : ''}
            {i < secs.length - 1 && (
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
        ))}
      </div>

      {/* Per-section +/- steppers — no need to grab the thin divider */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
        {secs.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ backgroundColor: bandColor(scoreByKey[s.key]) }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{SHORT[s.key] ?? s.label}</span>
            <button type="button" onClick={() => adjust(i, -0.05)}
              className="flex h-4 w-4 items-center justify-center rounded border border-slate-200 text-[12px] leading-none text-slate-500 hover:bg-slate-100">−</button>
            <span className="w-8 text-center tabular-nums font-semibold text-slate-700">{Math.round(weights[i] * 100)}%</span>
            <button type="button" onClick={() => adjust(i, 0.05)}
              className="flex h-4 w-4 items-center justify-center rounded border border-slate-200 text-[12px] leading-none text-slate-500 hover:bg-slate-100">+</button>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Target
          <input
            type="number" min={0} max={100} value={target}
            onChange={(e) => setTarget(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums"
          />
        </label>
        <span className="text-[10px] text-slate-400">drag or use +/− · totals 100%</span>
        {previewScore != null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
            module score → <b style={{ color: bandColor(previewScore) }}>{previewScore}</b>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <button type="button" onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50">
            <X className="h-3 w-3" /> Cancel
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={!changed || save.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
