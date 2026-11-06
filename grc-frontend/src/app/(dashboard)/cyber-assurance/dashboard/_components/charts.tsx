'use client';

/**
 * Hand-rolled charts (recharts is mocked in this repo). Thin marks, 4px rounded data
 * ends, 2px surface gaps, hairline grid, text in text tokens, and every value also
 * reachable without hover (legends / direct labels / table view).
 */
import { useState, type ReactNode } from 'react';
import { BAND, SEV, SEV_ORDER, T, alpha, day, fmtDay, nfmt, pctOf, share, type Sev } from './kit';

/* ---------- semicircle gauge, 0-100 (risk: higher = worse) ---------- */
export function Gauge({ value, color, label, width = 212 }: { value: number | null; color: string; label: string; width?: number }) {
  const sw = 14, m = 4;
  const rb = width / 2 - m - 1.5;          // thin band-zone ring
  const r = rb - 5 - sw / 2;               // main track
  const cx = width / 2, cy = rb + 1.5 + m, h = cy + sw / 2 + 16;
  const pt = (v: number, rad: number) => {
    const a = Math.PI * (1 - v / 100);
    return `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy - rad * Math.sin(a)).toFixed(2)}`;
  };
  const arc = (a: number, b: number, rad: number) => `M ${pt(a, rad)} A ${rad} ${rad} 0 0 1 ${pt(b, rad)}`;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const zones: [number, number, string][] = [[0, 24.6, BAND.contained.c], [25.4, 49.6, BAND.watch.c], [50.4, 74.6, BAND.elevated.c], [75.4, 100, BAND.severe.c]];
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={label} className="block h-auto max-w-full">
      {zones.map(([a, b, c]) => <path key={a} d={arc(a, b, rb)} stroke={c} strokeWidth={3} fill="none" />)}
      <path d={arc(0, 100, r)} stroke={T.track} strokeWidth={sw} fill="none" strokeLinecap="round" />
      {v != null && v > 0 && <path d={arc(0, v, r)} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />}
      <text x={cx - r} y={h - 2} textAnchor="middle" fontSize="10" fill={T.faint}>0</text>
      <text x={cx + r} y={h - 2} textAnchor="middle" fontSize="10" fill={T.faint}>100</text>
    </svg>
  );
}

/* ---------- 100% stacked horizontal bar (2px surface gaps, tiny parts stay visible) ---------- */
export type Part = { key: string; label: string; n: number; c: string };
export function StackBar({ parts, label, height = 12 }: { parts: Part[]; label: string; height?: number }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const shown = parts.filter((p) => p.n > 0);
  return (
    <div role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.n}`).join(', ') || 'none'}`}
      className="flex w-full overflow-hidden rounded-[6px]" style={{ height, gap: 2, background: total ? undefined : T.track }}>
      {shown.map((p) => (
        <span key={p.key} title={`${p.label}: ${nfmt(p.n)} (${pctOf(p.n, total)}%)`}
          style={{ flex: `${p.n} 1 0px`, minWidth: 4, background: p.c }} />
      ))}
    </div>
  );
}

/** Legend rows for a StackBar: key · label · count · share. `fill` spreads the rows over the card height. */
export function PartLegend({ parts, total, cols = 1, fill }: { parts: (Part & { hint?: string })[]; total: number; cols?: number; fill?: boolean }) {
  return (
    <ul className={`m-0 grid list-none gap-x-5 gap-y-1.5 p-0 ${fill ? 'flex-1 content-between' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {parts.map((p) => (
        <li key={p.key} className="flex min-w-0 items-center gap-2 text-[12px]">
          <i aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px]" style={{ background: p.c }} />
          <span className="min-w-0 truncate text-[#334155]">{p.label}{p.hint && <span className="text-[#94A3B8]"> · {p.hint}</span>}</span>
          <b className="ml-auto font-semibold tabular-nums text-[#0F172A]">{nfmt(p.n)}</b>
          <span className="w-[34px] text-right text-[11px] tabular-nums text-[#94A3B8]">{share(p.n, total)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- labelled horizontal bars, optional target tick ----------
   The track never drops below 40px: under width pressure the label truncates (full text
   in the tooltip) instead of the bar collapsing to a sliver. `stacked` puts the label +
   value above a full-width bar (narrow cards). A not-measured row stays ONE line at any
   width: dashed empty track + muted "—", reason in the tooltip and the a11y label.
   `fill` spreads the rows over the card height. */
export type BarRow = { key: string; label: ReactNode; n: number | null; c?: string; value?: string; title?: string };
export function BarList({ rows, max, target, color = T.base, labelWidth = 132, missing = 'Not measured yet', stacked, fill }: {
  rows: BarRow[]; max?: number; target?: number; color?: string; labelWidth?: number; missing?: string; stacked?: boolean; fill?: boolean;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.n ?? 0));
  // sizing differs by mode: flex-1 in a row; w-full when stacked (flex-1 in the stacked
  // row's column axis would zero the 8px height)
  const track = (r: BarRow, size: string) => (r.n == null ? (
    <span role="img" aria-label={missing} className={`block h-[8px] shrink-0 rounded-[4px] border border-dashed border-[#CBD5E1] ${size}`} />
  ) : (
    <span className={`relative block h-[8px] shrink-0 rounded-[4px] bg-[#EEF1F5] ${size}`}>
      <i className="absolute inset-y-0 left-0 block rounded-r-[4px]" style={{ width: `${Math.min(100, (r.n / top) * 100)}%`, minWidth: r.n > 0 ? 3 : 0, background: r.c ?? color }} />
      {target != null && <i aria-hidden className="absolute -bottom-[3px] -top-[3px] block w-[2px] rounded-[1px] bg-[#0F172A] opacity-50" style={{ left: `calc(${Math.min(100, (target / top) * 100)}% - 1px)` }} />}
    </span>
  ));
  const value = (r: BarRow, cls = '') => (
    <b className={`shrink-0 text-right tabular-nums ${r.n == null ? 'font-medium text-[#94A3B8]' : 'font-semibold text-[#0F172A]'} ${cls}`}>{r.n == null ? '—' : (r.value ?? nfmt(r.n))}</b>
  );
  return (
    <ul className={`m-0 flex list-none flex-col p-0 ${stacked ? 'gap-3' : 'gap-[9px]'} ${fill ? 'flex-1 justify-between' : ''}`}>
      {rows.map((r) => {
        const tip = [r.title ?? (typeof r.label === 'string' ? r.label : null), r.n == null ? missing : null].filter(Boolean).join(' — ') || undefined;
        return stacked ? (
          <li key={r.key} className="flex flex-col gap-1.5 text-[12px]" title={tip}>
            <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-[#334155]">{r.label}</span>{value(r)}</span>
            {track(r, 'w-full')}
          </li>
        ) : (
          <li key={r.key} className="flex items-center gap-2.5 text-[12px]" title={tip}>
            <span className="min-w-0 truncate text-[#334155]" style={{ flex: `0 1 ${labelWidth}px` }}>{r.label}</span>
            {track(r, 'min-w-[40px] flex-1')}
            {value(r, 'w-[46px]')}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- weekly flow: new findings up, resolved down, one shared scale ---------- */
export type Week = { from: string; to: string; added: number; resolved: number };
export const NEW_C = T.base, RES_C = T.success; // validated pair: CVD ΔE 14.9, normal 15.5
export const niceCeil = (v: number) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
const range = (w: Week) => `${fmtDay(day(w.from))} – ${fmtDay(day(w.to))}`;

export function FlowChart({ weeks }: { weeks: Week[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const top = niceCeil(Math.max(1, ...weeks.map((w) => Math.max(w.added, w.resolved))));
  const peak = weeks.reduce((b, w, i) => (w.added > weeks[b].added ? i : b), 0);
  const HALF = 66;
  const hw = hi == null ? null : weeks[hi];
  return (
    <div className="pt-[14px]">
      <div className="flex">
        <div aria-hidden className="relative w-[34px] shrink-0 text-[10px] tabular-nums text-[#94A3B8]" style={{ height: HALF * 2 }}>
          <span className="absolute right-[7px] top-0 -translate-y-1/2">{nfmt(top)}</span>
          <span className="absolute right-[7px] top-1/2 -translate-y-1/2">0</span>
          <span className="absolute bottom-0 right-[7px] translate-y-1/2">{nfmt(top)}</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: HALF * 2 }}>
          <i aria-hidden className="absolute inset-x-0 top-0 h-px bg-[#EEF1F5]" />
          <i aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-[#CBD5E1]" />
          <i aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-[#EEF1F5]" />
          <div className="absolute inset-0 flex gap-[3px]">
            {weeks.map((w, i) => (
              <div key={w.from} tabIndex={0} role="img" aria-label={`${range(w)}: ${w.added} new, ${w.resolved} resolved`}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(i)} onBlur={() => setHi(null)}
                className="relative flex h-full min-w-0 flex-1 flex-col items-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#005B96]"
                style={{ background: hi === i ? 'rgba(0,91,150,.06)' : undefined }}>
                <div className="flex w-full flex-1 items-end justify-center">
                  <i className="block w-[70%] max-w-[22px] rounded-t-[4px]" style={{ height: `${(w.added / top) * 100}%`, minHeight: w.added ? 2 : 0, background: NEW_C }} />
                </div>
                <div className="flex w-full flex-1 items-start justify-center">
                  <i className="block w-[70%] max-w-[22px] rounded-b-[4px]" style={{ height: `${(w.resolved / top) * 100}%`, minHeight: w.resolved ? 2 : 0, background: RES_C }} />
                </div>
                {i === peak && w.added > 0 && (
                  <span aria-hidden className="absolute whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-[#0F172A]" style={{ bottom: `calc(50% + ${(w.added / top) * 50}% + 3px)` }}>{nfmt(w.added)}</span>
                )}
              </div>
            ))}
          </div>
          {hw && hi != null && (
            <div role="tooltip" className="pointer-events-none absolute top-[-6px] z-10 w-max rounded-[10px] border border-[#E2E5EC] bg-white px-3 py-2 text-[11.5px] shadow-[0_6px_20px_rgba(15,23,42,.12)]"
              style={{ left: `${((hi + 0.5) / weeks.length) * 100}%`, transform: `translateX(${hi < 2 ? '-10%' : hi > weeks.length - 3 ? '-90%' : '-50%'})` }}>
              <div className="mb-1 text-[11px] text-[#64748B]">{range(hw)}</div>
              <div className="flex items-center gap-2"><i className="inline-block h-[2px] w-3" style={{ background: NEW_C }} /><b className="tabular-nums text-[#0F172A]">{nfmt(hw.added)}</b><span className="text-[#64748B]">new</span></div>
              <div className="flex items-center gap-2"><i className="inline-block h-[2px] w-3" style={{ background: RES_C }} /><b className="tabular-nums text-[#0F172A]">{nfmt(hw.resolved)}</b><span className="text-[#64748B]">resolved</span></div>
            </div>
          )}
        </div>
      </div>
      <div aria-hidden className="ml-[34px] mt-1.5 flex gap-[3px] text-[10px] text-[#94A3B8]">
        {weeks.map((w, i) => <span key={w.from} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % 2 === 0 || i === weeks.length - 1 ? fmtDay(day(w.from)) : ''}</span>)}
      </div>
      <details className="mt-2 text-[11.5px] text-[#64748B]">
        <summary className="cursor-pointer select-none font-medium text-[#005B96]">View as table</summary>
        {/* capped + scrolls, so opening it can't blow up the hero row's height */}
        <div className="mt-2 max-h-[168px] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead><tr>{['Week', 'New', 'Resolved', 'Net'].map((h, i) => <th key={h} scope="col" style={{ ...thS, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.from}>
                <td style={tdS}>{range(w)}</td>
                <td style={{ ...tdS, textAlign: 'right' }}>{nfmt(w.added)}</td>
                <td style={{ ...tdS, textAlign: 'right' }}>{nfmt(w.resolved)}</td>
                <td style={{ ...tdS, textAlign: 'right' }}>{w.added - w.resolved > 0 ? '+' : ''}{nfmt(w.added - w.resolved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </div>
  );
}

const thS: React.CSSProperties = { padding: '5px 8px', fontSize: 10.5, fontWeight: 600, color: T.muted, background: T.subtle, borderBottom: `1px solid ${T.border}`, textTransform: 'uppercase', letterSpacing: '.04em' };
const tdS: React.CSSProperties = { padding: '5px 8px', fontSize: 11.5, color: T.text, borderBottom: '1px solid #F1F3F7', fontVariantNumeric: 'tabular-nums' };

/* ---------- severity × age matrix (open findings, days since first detection) ----------
   table-fixed + colgroup: the table is exactly its card's width (never wider) — the
   severity and Total columns hold fixed widths and the four day buckets share the rest,
   with compact "0–7 … 90+" headers (full label in the tooltip). Fits a ~220px body.
   h-full lets the rows grow when the tile is stretched to its row's height. */
export function AgeMatrix({ data, ages }: { data: Record<string, Record<string, number>>; ages: string[] }) {
  const cell = (s: Sev, a: string) => data?.[s]?.[a] ?? 0;
  const max = Math.max(1, ...SEV_ORDER.flatMap((s) => ages.map((a) => cell(s, a))));
  const head: React.CSSProperties = { padding: '0 1px 4px', fontSize: 10, fontWeight: 600, color: T.muted, background: 'transparent', border: 0, textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'bottom' };
  const num: React.CSSProperties = { padding: '5px 1px', fontSize: 12, fontVariantNumeric: 'tabular-nums', border: 0 };
  return (
    <table className="h-full w-full table-fixed" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
      <caption className="sr-only">Open findings by severity and days since first detected</caption>
      <colgroup>
        <col style={{ width: 68 }} />
        {ages.map((a) => <col key={a} />)}
        <col style={{ width: 38 }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" style={{ ...head, textAlign: 'left' }}>Severity</th>
          {ages.map((a) => <th key={a} scope="col" style={head} title={a}>{a.replace(' days', '').replace('-', '–')}</th>)}
          <th scope="col" style={{ ...head, textAlign: 'right', paddingRight: 2 }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {SEV_ORDER.map((s) => {
          const row = ages.map((a) => cell(s, a));
          return (
            <tr key={s}>
              <th scope="row" style={{ padding: 0, fontSize: 12, fontWeight: 500, color: T.ink2, textAlign: 'left', whiteSpace: 'nowrap', background: 'transparent', border: 0 }}>
                <span className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px]" style={{ background: SEV[s].c }} />{SEV[s].label}</span>
              </th>
              {row.map((n, i) => (
                <td key={ages[i]} title={`${SEV[s].label}, ${ages[i]}: ${n}`}
                  style={{ ...num, borderRadius: 6, textAlign: 'center', fontWeight: n ? 600 : 400,
                    background: n ? alpha(SEV[s].c, 0.1 + 0.18 * (n / max)) : T.subtle, color: n ? SEV[s].ink : T.faint }}>
                  {n ? nfmt(n) : '·'}
                </td>
              ))}
              <td style={{ ...num, paddingRight: 2, textAlign: 'right', fontWeight: 600, color: T.text, background: 'transparent' }}>{nfmt(row.reduce((x, y) => x + y, 0))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- sparkline (single series, no legend needed) ---------- */
export function Sparkline({ points, label, width = 132, height = 30 }: { points: number[]; label: string; width?: number; height?: number }) {
  const lo = Math.min(...points), hiV = Math.max(...points), span = hiV - lo || 1;
  const xy = points.map((p, i) => [(i / Math.max(1, points.length - 1)) * (width - 6) + 3, height - 3 - ((p - lo) / span) * (height - 6)]);
  const [ex, ey] = xy[xy.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={T.base} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ex} cy={ey} r={4} fill={T.base} stroke="#fff" strokeWidth={2} />
    </svg>
  );
}
