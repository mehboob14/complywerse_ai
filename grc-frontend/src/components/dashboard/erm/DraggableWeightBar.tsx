'use client';

/**
 * A horizontal weight bar whose dividers you drag to shift weight between
 * adjacent segments (always totals 100%, none drops below MIN). Reused for both
 * section weights (module card) and metric weights (section popup).
 */
import { useEffect, useRef } from 'react';
import { bandColor } from './scoring';

const MIN = 0.02;

export default function DraggableWeightBar({
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
    <div ref={barRef} className="relative flex select-none rounded-md" style={{ height }}>
      {items.map((it, i) => {
        const pct = (weights[i] / total) * 100;
        return (
          <div
            key={it.key ?? i}
            className="relative flex items-center justify-center overflow-hidden text-[9.5px] font-semibold text-white"
            style={{ width: `${pct}%`, backgroundColor: bandColor(it.score) }}
            title={`${it.label} · ${Math.round(pct)}%`}
          >
            {pct >= 6 ? `${Math.round(pct)}%` : ''}
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
