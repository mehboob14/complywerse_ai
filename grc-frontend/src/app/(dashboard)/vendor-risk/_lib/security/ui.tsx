'use client';

// Shapes and small pieces shared by the Security ratings page and a supplier's
// Outside-in tab. Status colour is a three-step ramp (good, warning, critical)
// validated for colour-vision separation; a grade letter or a number always
// sits beside it, so colour never carries the meaning alone.

import { useId, useState } from 'react';
import { clsx } from 'clsx';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Waiver {
  id: number; finding_key: string; host: string | null; reason: string; expires_on: string; by: string | null;
  created_at: string; state: 'active' | 'expired' | 'revoked'; days_left: number;
}
export interface Finding {
  key: string; category: string; category_label: string; severity: Severity; title: string; detail: string | null;
  host: string; points: number; cvss?: number | null; waiver: Waiver | null;
}
export interface Host {
  fqdn: string; ip: string | null; live: boolean; status_code: number | null; title: string | null; server: string | null;
  https: boolean; tls_issuer: string | null; tls_version: string | null; tls_expires: string | null; cdn_waf: string | null;
  ports: number[];
}
export interface Point { at: string; score: number; grade?: string | null }
export interface VendorView {
  vendor: { id: number; name: string; tier: string | null; website: string | null };
  domains: string[]; extra_domains: string[]; enabled: boolean; shodan: boolean; running: boolean;
  latest: null | {
    id: number; at: string; domains: string[]; hosts: Host[]; findings: Finding[]; score: number | null;
    grade: string | null; categories: Record<string, number> | null; scanned_score: number | null; note: string | null;
    technologies: Array<{ name: string; category: string; versions: string[]; hosts: string[]; evidence: string | null }>;
  };
  failed: { at: string; error: string | null } | null;
  history: Point[]; ratings: Record<string, Point[]>; waivers: Waiver[];
  categories: Record<string, string>; points: Record<Severity, number>; every_days: Record<string, number>;
  grades?: Record<string, number>; category_cap?: number;
}
export interface PortfolioRow {
  vendor: { id: number; name: string; tier: string | null }; domains: string[]; score: number | null; grade: string | null;
  change: number | null; scanned_at: string | null; serious: number; waived: number; ratings: Record<string, Point>;
}
export interface Portfolio {
  items: PortfolioRow[]; grades: Record<string, number>; average: number | null; unscanned: number; no_domain: number;
  expiring_waivers: Array<Waiver & { vendor: { id: number; name: string } }>; enabled: boolean; shodan: boolean;
  every_days: Record<string, number>; grade_bands?: Record<string, number>;
}

/** "every 7 days" in words: a week, a month, a quarter... */
export const everyDays = (d: number) =>
  d === 1 ? 'daily' : d === 7 ? 'weekly' : d === 30 ? 'monthly' : d === 90 ? 'quarterly' : d === 180 ? 'twice a year'
    : d === 365 ? 'yearly' : `every ${d} days`;

export const SCAN_PROVIDER = 'Outside-in scan';
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_CLS: Record<Severity, string> = {
  critical: 'border-rose-600 bg-rose-600 text-white',
  high: 'border-rose-200 bg-rose-50 text-rose-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

type Tone = 'good' | 'warning' | 'critical';
export const gradeTone = (grade?: string | null): Tone =>
  grade === 'A' || grade === 'B' ? 'good' : grade === 'C' ? 'warning' : 'critical';
export const scoreTone = (score: number): Tone => (score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical');
const FILL: Record<Tone, string> = { good: 'bg-emerald-600', warning: 'bg-amber-600', critical: 'bg-rose-600' };
const TRACK: Record<Tone, string> = { good: 'bg-emerald-100', warning: 'bg-amber-100', critical: 'bg-rose-100' };
const CHIP: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
};

export function GradeBadge({ grade, size = 'sm' }: { grade: string | null | undefined; size?: 'sm' | 'lg' }) {
  if (!grade) return <span className="text-xs text-slate-400">Not rated</span>;
  if (size === 'lg') {
    return (
      <span className={clsx('inline-flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold text-white', FILL[gradeTone(grade)])}
        aria-label={`Grade ${grade}`}>{grade}</span>
    );
  }
  return (
    <span className={clsx('inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border px-1 text-xs font-semibold', CHIP[gradeTone(grade)])}
      aria-label={`Grade ${grade}`}>{grade}</span>
  );
}

/** A 0–100 value against a same-hue track; the number sits beside it in ink. */
export function Meter({ label, value }: { label: string; value: number }) {
  const tone = scoreTone(value);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium tabular-nums text-slate-800">{value}</span>
      </div>
      <div className={clsx('h-1.5 rounded-full', TRACK[tone])} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
        <div className={clsx('h-1.5 rounded-full', FILL[tone])} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/** Score over time: a recessive line, the latest point in the accent, a crosshair
 *  readout on hover or focus. The same values are listed elsewhere on the page. */
export function Sparkline({ points, width = 160, height = 40, label }: { points: Point[]; width?: number; height?: number; label: string }) {
  const [at, setAt] = useState<number | null>(null);
  const id = useId();
  if (points.length < 2) return null;
  const pad = 5;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + ((100 - v) * (height - 2 * pad)) / 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const shown = at ?? last;
  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    setAt(Math.max(0, Math.min(last, Math.round(ratio * last))));
  };
  return (
    <div className="relative inline-block">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t`} tabIndex={0}
        className="overflow-visible rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setAt(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setAt(Math.max(0, (at ?? last) - 1));
          if (e.key === 'ArrowRight') setAt(Math.min(last, (at ?? last) + 1));
        }} onBlur={() => setAt(null)}>
        <title id={`${id}-t`}>{`${label}: ${points.map((p) => `${fmt(p.at)} ${p.score}`).join(', ')}`}</title>
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="#e2e8f0" strokeWidth={1} />
        <path d={path} fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {at !== null && <line x1={x(at)} x2={x(at)} y1={pad / 2} y2={height - pad / 2} stroke="#cbd5e1" strokeWidth={1} />}
        <circle cx={x(shown)} cy={y(points[shown].score)} r={4} fill="currentColor" stroke="#ffffff" strokeWidth={2}
          className="text-primary-600" />
      </svg>
      {at !== null && (
        <div className="pointer-events-none absolute -top-9 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: Math.min(Math.max(0, x(at) - 40), width - 80) }}>
          <b className="font-semibold">{points[at].score}</b> <span className="text-slate-300">{fmt(points[at].at)}</span>
        </div>
      )}
    </div>
  );
}
