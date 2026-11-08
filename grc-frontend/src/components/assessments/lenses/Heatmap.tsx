'use client';

// The 5 x 5 likelihood by impact grid of the DPIA lens and the NCA risk registers: the risks that sit in each cell are counted in it, the band of the cell is a colour AND a word
// in the legend and in the cell's name for a screen reader (never colour alone). One component for both, so the two never drift apart.
import { TONE } from '@/lib/status';
import { BAND_LABEL, BANDS_ORDER, heatGrid, type Band, type HeatPoint } from './riskModel';

const BAND_TONE: Record<Exclude<Band, 'none'>, keyof typeof TONE> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'success' };

export function Heatmap({ points, label, impactLabel = 'Impact' }: { points: readonly HeatPoint[]; label: string; impactLabel?: string }) {
  const grid = heatGrid(points);
  const placed = grid.flat().reduce((n, c) => n + c.ids.length, 0);
  return (
    <figure className="m-0 inline-block" aria-label={`${label}: ${placed} placed on the grid`}>
      <figcaption className="mb-[6px] text-ds-label text-ds-fg-muted">{label}</figcaption>
      <div className="flex gap-[6px]">
        <div className="flex flex-col justify-between py-[2px] text-ds-label tabular-nums text-ds-fg-muted" aria-hidden>
          {[5, 4, 3, 2, 1].map((l) => <span key={l} className="grid h-[36px] place-items-center">{l}</span>)}
        </div>
        <div>
          <div className="grid grid-cols-5 gap-[2px]">
            {grid.flat().map((c) => {
              const tone = c.band === 'none' ? 'neutral' : BAND_TONE[c.band];
              const t = TONE[tone];
              const n = c.ids.length;
              return (
                <div
                  key={`${c.l}-${c.i}`} role="img" aria-label={`Likelihood ${c.l}, ${impactLabel.toLowerCase()} ${c.i}, ${BAND_LABEL[c.band]}: ${n === 0 ? 'none' : c.ids.join(', ')}`}
                  className="grid h-[36px] w-[40px] place-items-center rounded-ds-control border text-ds-label font-[600] tabular-nums sm:w-[44px]"
                  style={{ background: t.tint, borderColor: t.border, color: t.text }}
                >
                  {n > 0 ? n : ''}
                </div>
              );
            })}
          </div>
          <div className="mt-[2px] grid grid-cols-5 gap-[2px] text-center text-ds-label tabular-nums text-ds-fg-muted" aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => <span key={i}>{i}</span>)}
          </div>
          <div className="mt-[2px] flex justify-between text-ds-label text-ds-fg-muted" aria-hidden><span>Likelihood up</span><span>{impactLabel} across</span></div>
        </div>
      </div>
      <ul className="mt-[8px] flex flex-wrap gap-x-[12px] gap-y-[4px]">
        {BANDS_ORDER.map((b) => (
          <li key={b} className="flex items-center gap-[6px] text-ds-label text-ds-fg-body"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px]" style={{ background: TONE[BAND_TONE[b as Exclude<Band, 'none'>]].dot }} />{BAND_LABEL[b]}</li>
        ))}
      </ul>
    </figure>
  );
}
