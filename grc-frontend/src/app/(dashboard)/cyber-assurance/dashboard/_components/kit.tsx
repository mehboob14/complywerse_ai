'use client';

/**
 * Shared bits for the Performance (executive) dashboard: product tokens, status
 * scales, formatters and the card / pill / empty-state primitives.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

/* Product tokens — grc-frontend/styles/tokens.css */
export const T = {
  base: '#005B96', strong: '#014A81', subtle: '#F6F7FB', border: '#E2E5EC',
  text: '#0F172A', ink2: '#334155', muted: '#64748B', faint: '#94A3B8', track: '#EEF1F5',
  success: '#047857', warning: '#B45309', danger: '#B91C1C',
};
export const FONT = "var(--font-poppins), 'Poppins', system-ui, sans-serif";

/* Status scales. Mark colours (`c`) pass the dataviz palette validator for adjacent-pair
   CVD + normal-vision separation (critical red-800 · high orange-600 · medium amber-500);
   text always uses `ink` on the `bg` tint (AA). Every coloured mark ships with its label. */
export type Tone = { label: string; c: string; ink: string; bg: string; desc?: string };
export type Sev = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEV_ORDER: Sev[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SEV: Record<Sev, Tone> = {
  critical: { label: 'Critical', c: '#991B1B', ink: '#991B1B', bg: '#FDECEC' },
  high: { label: 'High', c: '#EA580C', ink: '#9A3412', bg: '#FFF1E7' },
  medium: { label: 'Medium', c: '#F59E0B', ink: '#92400E', bg: '#FEF4E4' },
  low: { label: 'Low', c: '#2563EB', ink: '#1D4ED8', bg: '#E9F0FE' },
  info: { label: 'Info', c: '#94A3B8', ink: '#475569', bg: '#F1F5F9' },
};

export type Band = 'severe' | 'elevated' | 'watch' | 'contained' | 'unknown';
export const BAND_ORDER: Band[] = ['severe', 'elevated', 'watch', 'contained'];
// Labels + blurbs mirror risk_posture/service.py RISK_BANDS.
export const BAND: Record<Band, Tone> = {
  severe: { ...SEV.critical, label: 'Severe', desc: 'Immediate action' },
  elevated: { ...SEV.high, label: 'Elevated', desc: 'Remediate soon' },
  watch: { ...SEV.medium, label: 'Watch', desc: 'Watch list' },
  contained: { label: 'Contained', c: '#047857', ink: '#047857', bg: '#E7F5EE', desc: 'Healthy posture' },
  unknown: { ...SEV.info, label: 'Unscored', desc: 'Not scored yet' },
};
/** Same cut-offs as the risk-posture service (_band_for). Score is 0-100, higher = worse. */
export const bandOf = (s?: number | null): Band =>
  s == null ? 'unknown' : s >= 75 ? 'severe' : s >= 50 ? 'elevated' : s >= 25 ? 'watch' : 'contained';
export const toBand = (label?: string | null, score?: number | null): Band =>
  label && label in BAND ? (label as Band) : bandOf(score);

export const GRADE: Record<string, Tone> = {
  A: { label: 'A', c: '#047857', ink: '#047857', bg: '#E7F5EE' },
  B: { label: 'B', c: '#10B981', ink: '#047857', bg: '#E7F5EE' },
  C: { ...SEV.medium, label: 'C' },
  D: { ...SEV.high, label: 'D' },
  F: { ...SEV.critical, label: 'F' },
};

/* ---------- formatters ---------- */
export const nfmt = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString());
export const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
/** Share label that never shows a real, non-zero part as "0%". */
export const share = (n: number, d: number) => (!d ? '' : n > 0 && pctOf(n, d) === 0 ? '<1%' : `${pctOf(n, d)}%`);
export const plural = (n: number, one: string, many = `${one}s`) => `${nfmt(n)} ${n === 1 ? one : many}`;
/** Server datetimes are naive UTC (datetime.utcnow) — pin them to UTC before showing local time. */
export const utc = (s?: string | null) => (s ? new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`) : null);
/** 'YYYY-MM-DD' buckets are calendar days — build them as local dates so no timezone shifts the day. */
export const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
export const fmtWhen = (d: Date | null) =>
  d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ---------- primitives ---------- */
/** The one subtle card shadow used by every surface on the page. */
export const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,.06),0_4px_14px_rgba(16,24,40,.08)]';
export const cardCls = `flex min-w-0 flex-col rounded-[14px] border border-[#E2E5EC] bg-white p-[18px] ${CARD_SHADOW}`;
const linkCls = 'inline-flex shrink-0 items-center gap-1 rounded-md text-[12px] font-semibold text-[#005B96] hover:text-[#014A81] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005B96]';
const iconLinkCls = 'grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-[#005B96] hover:bg-[#F6F7FB] hover:text-[#014A81] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005B96]';

/**
 * Cards sit in equal-height grid rows, so the body is a flex column that fills the card:
 * lists/charts distribute into it and empty / loading / error states centre in it — no
 * stretched white bottom, no hole beside a short card. `busy` dims the body while its
 * data refetches. `ctaIcon` = arrow-only link for narrow tiles (label kept as aria/tooltip).
 * Title/sub sizes carry `!` because `.compact-density main h2` (globals.css) outranks utilities.
 */
export function Card({ title, sub, href, cta = 'Open', ctaIcon, aside, busy, className = '', children }: {
  title: string; sub?: ReactNode; href?: string; cta?: string; ctaIcon?: boolean; aside?: ReactNode; busy?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section className={`${cardCls} ${className}`} aria-label={title} aria-busy={busy || undefined}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-semibold text-[#0F172A] !text-[13.5px] !leading-[1.3]">{title}</h2>
          {sub && <p className="m-0 mt-0.5 text-[11.5px] leading-[1.45] text-[#64748B]">{sub}</p>}
        </div>
        {aside}
        {href && (ctaIcon
          ? <Link href={href} className={iconLinkCls} aria-label={cta} title={cta}><ArrowRight size={14} aria-hidden /></Link>
          : <Link href={href} className={linkCls}>{cta}<ArrowRight size={13} aria-hidden /></Link>)}
      </div>
      <div className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${busy ? 'opacity-50' : ''}`}>{children}</div>
    </section>
  );
}

export const Eyebrow = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`m-0 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#64748B] ${className}`}>{children}</p>
);

export function Pill({ tone, children, dot = true }: { tone: Tone; children?: ReactNode; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-[11px] font-semibold leading-[1.5]" style={{ background: tone.bg, color: tone.ink }}>
      {dot && <i aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.c }} />}
      {children ?? tone.label}
    </span>
  );
}

/** Legend key — a rect, mirroring the bar marks it names. */
export const Key = ({ c }: { c: string }) => <i aria-hidden className="inline-block h-[9px] w-[9px] shrink-0 rounded-[2px]" style={{ background: c }} />;

export const Skel = ({ h = 12, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) => (
  <span aria-hidden className={`block animate-pulse rounded-[6px] bg-[#EEF1F5] ${className}`} style={{ height: h, width: w }} />
);

export function Loading({ rows = 4, note }: { rows?: number; note?: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2.5" role="status" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => <Skel key={i} h={i ? 12 : 22} w={i ? `${92 - i * 11}%` : '45%'} />)}
      {note && <p className="m-0 mt-1 text-[11.5px] text-[#64748B]">{note}</p>}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Empty({ icon, title, body, href, cta, compact }: {
  icon?: ReactNode; title: string; body?: ReactNode; href?: string; cta?: string; compact?: boolean;
}) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-[12px] bg-[#F6F7FB] px-4 text-center ${compact ? 'py-[14px]' : 'py-[24px]'}`}>
      {icon && <span aria-hidden className="mb-1 grid h-9 w-9 place-items-center rounded-full bg-white text-[#64748B] shadow-[0_1px_2px_rgba(16,24,40,.06)]">{icon}</span>}
      <p className="m-0 text-[12.5px] font-semibold text-[#0F172A]">{title}</p>
      {body && <p className="m-0 max-w-[360px] text-[11.5px] leading-[1.5] text-[#64748B]">{body}</p>}
      {href && cta && <Link href={href} className={`${linkCls} mt-1.5`}>{cta}<ArrowRight size={13} aria-hidden /></Link>}
    </div>
  );
}

export const Unavailable = ({ what, href }: { what: string; href?: string }) => (
  <Empty compact title={`${what} didn't load`} body="That service didn't respond — the rest of the dashboard is unaffected." href={href} cta="Open the module" />
);

/** Small labelled figure used inside cards. */
export function Figure({ label, value, sub, className = '' }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="m-0 truncate text-[11px] font-medium text-[#64748B]">{label}</p>
      <p className="m-0 mt-0.5 text-[20px] font-semibold leading-[1.15] text-[#0F172A]">{value}</p>
      {sub && <p className="m-0 mt-0.5 text-[11px] leading-[1.4] text-[#64748B]">{sub}</p>}
    </div>
  );
}
