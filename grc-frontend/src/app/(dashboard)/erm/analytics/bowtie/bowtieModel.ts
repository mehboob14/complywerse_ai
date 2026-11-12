// The bow-tie's rules (wave 4), the same as the server's (erm/routers/advanced_analytics.py): a linked control sits on
// the side its own type says (preventive before the event, detective or corrective after it, untyped apart), and a
// cause with no preventive control or a consequence with no mitigating control is a gap.

export type BowTieSide = 'preventive' | 'mitigating' | 'unclassified';

/** One control linked to the risk (the one risk–control link). */
export interface LinkedControl {
  link_id: number;
  id?: number;
  control_id?: number;
  name: string;
  code?: string | null;
  kind?: string | null; // internal | library | framework
  control_type?: string | null; // preventive | detective | corrective, null when not set
  effectiveness?: string | null; // effective | partially_effective | ineffective | not assessed
  last_tested_at?: string | null;
  next_test_due?: string | null;
}

/** A saved cause or consequence. No control_link_ids means every control on its side of the bow-tie. */
export interface BowTieItem {
  id: number;
  side: 'cause' | 'consequence';
  title: string;
  impact_category?: string | null;
  control_link_ids?: number[];
  source?: string | null;
  gap?: boolean;
  gap_action_id?: number | null;
  gap_action_open?: boolean;
}

export const IMPACT_CATEGORY_LABELS: Record<string, string> = {
  financial: 'Financial',
  regulatory: 'Regulatory',
  reputational: 'Reputational',
  customer: 'Customer',
  operational: 'Operational',
};

const SOURCE_LABELS: Record<string, string> = {
  loss_event: 'From a loss event',
  risk_cause: 'From the risk record',
  risk_consequence: 'From the risk record',
};

const KIND_LABELS: Record<string, string> = { internal: 'Internal', library: 'Library', framework: 'Framework' };

const NEEDS: Record<BowTieItem['side'], BowTieSide> = { cause: 'preventive', consequence: 'mitigating' };

export function sideFor(controlType?: string | null): BowTieSide {
  const t = (controlType || '').toLowerCase();
  if (t === 'preventive') return 'preventive';
  if (t === 'detective' || t === 'corrective') return 'mitigating';
  return 'unclassified';
}

export function placeControls(controls: LinkedControl[]): Record<BowTieSide, LinkedControl[]> {
  const out: Record<BowTieSide, LinkedControl[]> = { preventive: [], mitigating: [], unclassified: [] };
  for (const c of controls) out[sideFor(c.control_type)].push(c);
  return out;
}

/** The controls on this cause's or consequence's line: those placed on it, else every control on its side. */
export function itemControls(item: BowTieItem, controls: LinkedControl[]): LinkedControl[] {
  const linked = new Map(controls.map((c) => [c.link_id, c]));
  const placed = (item.control_link_ids || []).map((id) => linked.get(id)).filter((c): c is LinkedControl => !!c);
  return placed.length ? placed : placeControls(controls)[NEEDS[item.side]];
}

export function hasGap(item: BowTieItem, controls: LinkedControl[]): boolean {
  return !itemControls(item, controls).some((c) => sideFor(c.control_type) === NEEDS[item.side]);
}

export function gapText(item: BowTieItem): string {
  return item.side === 'cause' ? 'No preventive control' : 'No mitigating control';
}

export function effectivenessLabel(value?: string | null): string {
  if (value === 'effective') return 'Effective';
  if (value === 'partially_effective') return 'Partly effective';
  if (value === 'ineffective') return 'Not effective';
  return 'Not assessed';
}

export function effectivenessTone(value?: string | null): string {
  if (value === 'effective') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value === 'partially_effective') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (value === 'ineffective') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export function kindLabel(kind?: string | null): string {
  return (kind && KIND_LABELS[kind]) || 'Control';
}

export function sourceLabel(source?: string | null): string {
  return (source && SOURCE_LABELS[source]) || '';
}

export function controlTypeLabel(controlType?: string | null): string {
  const t = (controlType || '').toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Type not set';
}
