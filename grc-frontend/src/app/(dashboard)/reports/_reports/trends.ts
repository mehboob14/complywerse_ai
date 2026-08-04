// Trends data layer — talks to the backend snapshot history (/reporting/trends/*)
// and carries the pure formatting / delta / RAG helpers the Trends view renders
// through. Kept free of React so the helpers can be unit-tested in isolation.

import apiClient from '@/lib/api';

export type Unit = 'pct' | 'score' | 'count' | 'days';
export type Direction = 'up_good' | 'down_good' | 'neutral';
export type Rag = 'ok' | 'warn' | 'critical' | 'none';

export interface TrendPoint { date: string; value: number | null }

/** A metric's card in the overview / its detail — the backend returns this shape. */
export interface TrendCard {
  key: string;
  label: string;
  module: string;
  module_label: string;
  unit: Unit;
  direction: Direction;
  dimension: string | null;
  definition: string;
  target: number | null;
  warn: number | null;
  critical: number | null;
  current: number | null;
  previous: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  status: Rag;
  as_of: string | null;
  points: TrendPoint[];
  dimension_value?: string;
}

export interface OverviewResp { days: number; cards: TrendCard[] }
export interface CatalogModule { key: string; label: string }
export interface CatalogResp { modules: CatalogModule[]; metrics: TrendCard[] }
export interface BreakdownSeries { key: string; points: TrendPoint[] }
export interface BreakdownResp {
  metric: string; dimension: string | null; label: string; unit: Unit; series: BreakdownSeries[];
}

export interface TargetBody {
  metric: string;
  dimension?: string;
  dimension_value?: string;
  target: number | null;
  warn: number | null;
  critical: number | null;
}

export const trendsApi = {
  overview: (days = 180) =>
    apiClient.get('/reporting/trends/overview', { params: { days } }).then((r) => r.data as OverviewResp),
  catalog: () =>
    apiClient.get('/reporting/trends/catalog').then((r) => r.data as CatalogResp),
  series: (metric: string, days = 180, dimension = 'overall', dimension_value = 'all') =>
    apiClient.get('/reporting/trends/series', { params: { metric, days, dimension, dimension_value } })
      .then((r) => r.data as TrendCard),
  breakdown: (metric: string, days = 180) =>
    apiClient.get('/reporting/trends/breakdown', { params: { metric, days } })
      .then((r) => r.data as BreakdownResp),
  setTarget: (body: TargetBody) =>
    apiClient.put('/reporting/trends/targets', body).then((r) => r.data),
  resetTarget: (metric: string, dimension = 'overall', dimension_value = 'all') =>
    apiClient.delete('/reporting/trends/targets', { params: { metric, dimension, dimension_value } }).then((r) => r.data),
  snapshot: () =>
    apiClient.post('/reporting/trends/snapshot').then((r) => r.data as { written: number; as_of: string }),
};

// ── Pure helpers ──────────────────────────────────────────────────────────────
export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Display string for a value in its unit. */
export function formatValue(v: number | null | undefined, unit: Unit): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (unit === 'pct') return `${round1(v)}%`;
  if (unit === 'score') return `${round1(v)}`;
  if (unit === 'days') return `${round1(v)}d`;
  return Math.round(v).toLocaleString();
}

/** Short unit tag shown after a value / on an axis. */
export function unitTag(unit: Unit): string {
  return unit === 'pct' ? '%' : unit === 'score' ? '/100' : unit === 'days' ? ' days' : '';
}

export const RAG_COLOR: Record<Rag, string> = {
  ok: '#059669', warn: '#d97706', critical: '#dc2626', none: '#94a3b8',
};
export const RAG_LABEL: Record<Rag, string> = {
  ok: 'On target', warn: 'Watch', critical: 'Off target', none: 'No target',
};

export interface DeltaView {
  arrow: 'up' | 'down' | 'flat';
  text: string;
  good: boolean | null;   // is this movement good? null = neutral metric / no change
  color: string;
}

const GOOD = '#059669';
const BAD = '#e11d48';
const NEUTRAL = '#64748b';

/** How to render a card's period-over-period change: arrow, label and whether the
 *  movement is good (direction-aware, so a drop in open vulns reads green). */
export function deltaView(card: Pick<TrendCard, 'delta_abs' | 'previous' | 'direction' | 'unit'>): DeltaView {
  const d = card.delta_abs;
  if (d == null || card.previous == null) return { arrow: 'flat', text: '—', good: null, color: NEUTRAL };
  const arrow: DeltaView['arrow'] = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  let good: boolean | null = null;
  if (d !== 0) {
    if (card.direction === 'up_good') good = d > 0;
    else if (card.direction === 'down_good') good = d < 0;
  }
  const suffix = card.unit === 'pct' ? 'pp' : '';   // percentage-point change reads clearer than "%"
  const mag = card.unit === 'count' ? Math.abs(Math.round(d)).toLocaleString() : `${Math.abs(round1(d))}${suffix}`;
  const text = d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${mag}`;
  const color = good == null ? NEUTRAL : good ? GOOD : BAD;
  return { arrow, text, good, color };
}

/** True when a metric has enough history to draw a line (≥2 real points). */
export function hasSeries(points: TrendPoint[] | undefined): boolean {
  return !!points && points.filter((p) => p.value != null).length >= 2;
}

/** Total real data points across a set of cards — 0 means "nothing captured yet". */
export function totalPoints(cards: TrendCard[]): number {
  return cards.reduce((n, c) => n + (c.points ? c.points.filter((p) => p.value != null).length : 0), 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Jul 3' style short date for an ISO 'yyyy-mm-dd'. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = iso.slice(0, 10).split('-');
  return p.length < 3 ? '' : `${MONTHS[+p[1] - 1] || ''} ${+p[2]}`;
}

export const RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '6m' },
  { days: 365, label: '1y' },
];
