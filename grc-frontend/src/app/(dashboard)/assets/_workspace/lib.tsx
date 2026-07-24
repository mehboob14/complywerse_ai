'use client';

/**
 * Shared cell primitives for the Assets workspace (Register / Workbench views).
 * One source of truth for asset-type pills, criticality/status pills, the CIA
 * 5-segment meter, owner avatars, lifecycle dots, the letter tile and staleness
 * formatting — so every view renders identically.
 *
 * Design charter: single teal brand (primary-*), semantic pills as light
 * bg-{tone}-50 text-{tone}-700 pairs, hairline borders, no gradients.
 * The C/I/A severity segments use the ONE sanctioned red→amber→green severity
 * scale (critical rose · high orange · medium amber · low emerald).
 */

import type { ITAsset } from '@/types';

// ─── Asset type pill ─────────────────────────────────────────────────────────
// Categorical marker only — slate base with a teal accent for the primary
// "application" bucket. No rainbow coding (charter §4.12).
export const ASSET_TYPE_LABEL: Record<string, string> = {
  application: 'Application',
  infrastructure: 'Infrastructure',
  data: 'Data',
  cloud: 'Cloud',
  third_party: 'Third-party',
};

export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABEL[type] || type.replace(/_/g, ' ');
}

export function AssetTypePill({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {assetTypeLabel(type)}
    </span>
  );
}

// ─── Criticality pill ────────────────────────────────────────────────────────
// The sanctioned severity band: critical=rose · high=orange · medium=amber · low=emerald.
type Criticality = 'critical' | 'high' | 'medium' | 'low' | string;

const CRITICALITY_PILL: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700',
  high: 'bg-orange-50 text-orange-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-emerald-50 text-emerald-700',
};

const CRITICALITY_SEG: Record<string, string> = {
  critical: 'bg-rose-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

export function criticalityTone(criticality: Criticality): string {
  return CRITICALITY_PILL[criticality] || 'bg-slate-100 text-slate-600';
}

export function AssetCriticalityPill({ criticality }: { criticality: Criticality }) {
  const label = criticality ? criticality.charAt(0).toUpperCase() + criticality.slice(1) : '—';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${criticalityTone(criticality)}`}>
      {label}
    </span>
  );
}
// Alias to match the charter naming.
export { AssetCriticalityPill as CriticalityPill };

// ─── Status pill ─────────────────────────────────────────────────────────────
const STATUS_PILL: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-amber-50 text-amber-700',
  decommissioned: 'bg-slate-100 text-slate-600',
};

export function AssetStatusPill({ status }: { status: string }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[status] || 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

// ─── CIA meter (5-segment C/I/A bars) ────────────────────────────────────────
// Segment fill color follows the highest of the three ratings so the meter
// reads as a severity gauge, not decoration.
function segTone(value: number): string {
  if (value >= 5) return CRITICALITY_SEG.critical;
  if (value >= 4) return CRITICALITY_SEG.high;
  if (value >= 3) return CRITICALITY_SEG.medium;
  if (value >= 1) return CRITICALITY_SEG.low;
  return 'bg-slate-200';
}

/** A single 5-segment bar for one rating dimension. */
function CiaBar({ value, label }: { value: number; label: string }) {
  const v = value || 0;
  const tone = segTone(v);
  return (
    <span className="inline-flex gap-0.5" title={`${label}: ${v}/5`} aria-label={`${label} ${v} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-3.5 w-2 rounded-sm ${i <= v ? tone : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

/**
 * CIA meter — three stacked/inline 5-segment bars for Confidentiality,
 * Integrity, Availability. `stacked` renders them vertically (detail preview);
 * default is a single compact bar keyed off the max rating for dense rows.
 */
export function CiaMeter({
  c,
  i,
  a,
  variant = 'row',
}: {
  c?: number;
  i?: number;
  a?: number;
  variant?: 'row' | 'stacked';
}) {
  const cv = c || 0;
  const iv = i || 0;
  const av = a || 0;

  if (variant === 'stacked') {
    return (
      <div className="flex flex-col gap-1">
        <CiaBar value={cv} label="Confidentiality" />
        <CiaBar value={iv} label="Integrity" />
        <CiaBar value={av} label="Availability" />
      </div>
    );
  }

  // Compact row variant — one bar keyed to the highest dimension, matching the
  // mockup's single 5-segment strip in the CIA column.
  const max = Math.max(cv, iv, av);
  const tone = segTone(max);
  return (
    <span className="inline-flex gap-0.5" title={`C ${cv} · I ${iv} · A ${av}`} aria-label={`CIA C ${cv} I ${iv} A ${av}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-3.5 w-2 rounded-sm ${n <= max ? tone : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

// ─── Owner initials avatar (cloned from governance documents lib) ────────────
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic category tint from a key (owner name) — a sanctioned
// "incidental category tint" per the charter (a marker, not brand meaning).
const AVATAR_TINTS = [
  { soft: 'bg-blue-50 text-blue-700', avatar: 'bg-blue-100 text-blue-700' },
  { soft: 'bg-emerald-50 text-emerald-700', avatar: 'bg-emerald-100 text-emerald-700' },
  { soft: 'bg-violet-50 text-violet-700', avatar: 'bg-violet-100 text-violet-700' },
  { soft: 'bg-amber-50 text-amber-700', avatar: 'bg-amber-100 text-amber-700' },
  { soft: 'bg-cyan-50 text-cyan-700', avatar: 'bg-cyan-100 text-cyan-700' },
  { soft: 'bg-rose-50 text-rose-700', avatar: 'bg-rose-100 text-rose-700' },
  { soft: 'bg-primary-50 text-primary-700', avatar: 'bg-primary-100 text-primary-700' },
];

export function avatarTint(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function InitialsAvatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs';
  if (!name) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-400 ${dim}`} title="Unassigned">
        ?
      </span>
    );
  }
  const tint = avatarTint(name);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tint.avatar} ${dim}`} title={name}>
      {initialsOf(name)}
    </span>
  );
}

/** Owner cell: avatar + name (or Unassigned). */
export function OwnerCell({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      <InitialsAvatar name={name} size={size} />
      <span className="truncate">{name || <span className="text-slate-400">Unassigned</span>}</span>
    </span>
  );
}

// ─── Lifecycle dots ──────────────────────────────────────────────────────────
// Ordered operational lifecycle. Filled dots up to the current stage in teal;
// the current dot tinted by state (retired/decommissioned → slate terminal).
export const LIFECYCLE_ORDER = ['planned', 'active', 'maintenance', 'decommissioned', 'retired'] as const;

export const LIFECYCLE_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  maintenance: 'Maintenance',
  decommissioned: 'Decommissioned',
  retired: 'Retired',
};

export function lifecycleLabel(state: string | null | undefined): string {
  const s = (state || 'active').toLowerCase();
  return LIFECYCLE_LABEL[s] || s.replace(/_/g, ' ');
}

export function LifecycleDots({ state, showLabel = false }: { state?: string | null; showLabel?: boolean }) {
  const s = (state || 'active').toLowerCase();
  const idx = LIFECYCLE_ORDER.indexOf(s as (typeof LIFECYCLE_ORDER)[number]);
  const terminal = s === 'decommissioned' || s === 'retired';
  const currentDot = terminal ? 'bg-slate-400' : 'bg-primary-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" aria-hidden>
        {LIFECYCLE_ORDER.map((_, i) => {
          let cls = 'bg-slate-200';
          if (idx >= 0) {
            if (i < idx) cls = 'bg-primary-500';
            else if (i === idx) cls = currentDot;
          }
          return <span key={i} className={`h-1.5 w-4 rounded-full ${cls}`} />;
        })}
      </div>
      {showLabel && <span className="text-sm text-slate-600">{lifecycleLabel(s)}</span>}
    </div>
  );
}

// ─── Asset letter tile ───────────────────────────────────────────────────────
export function AssetLetterTile({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim =
    size === 'lg' ? 'h-10 w-10 text-base rounded-[10px]'
    : size === 'sm' ? 'h-7 w-7 text-xs rounded-lg'
    : 'h-8 w-8 text-sm rounded-lg';
  // First alphanumeric char — skips brackets/symbols so "[DEMO] Asset 03" → "D".
  const letter = (name?.match(/[a-z0-9]/i)?.[0] || '?').toUpperCase();
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border border-slate-200 bg-slate-100 font-bold text-slate-500 ${dim}`}
      title={name}
      aria-label={`Asset ${name}`}
    >
      {letter}
    </span>
  );
}

// ─── Staleness (last_seen_at → relative label, rose if > 30d) ────────────────
export function fmtLastSeen(lastSeenAt: string | null | undefined): { label: string; stale: boolean } {
  if (!lastSeenAt) return { label: 'Never', stale: true };
  const then = new Date(lastSeenAt).getTime();
  if (Number.isNaN(then)) return { label: '—', stale: false };
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60_000);
  const days = ms / 86_400_000;
  let label: string;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins}m ago`;
  else if (mins < 60 * 24) label = `${Math.floor(mins / 60)}h ago`;
  else {
    const d = Math.floor(days);
    label = d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
  }
  return { label, stale: days > 30 };
}

export function LastSeenCell({ lastSeenAt }: { lastSeenAt: string | null | undefined }) {
  const { label, stale } = fmtLastSeen(lastSeenAt);
  return <span className={stale ? 'font-semibold text-rose-600' : 'text-slate-600'}>{label}</span>;
}

// ─── Display-name helper (mirrors the page's auto-name resolution) ───────────
/** Auto-generated Nessus / IP-only names are replaced with host or location. */
export function assetDisplayName(asset: Pick<ITAsset, 'name' | 'ip_address' | 'host_name' | 'location'>): string {
  const isAutoName = asset.name === asset.ip_address || asset.name?.startsWith('Nessus-Host-');
  if (isAutoName) {
    const locationName = asset.location ? asset.location.split(',')[0].trim() : '';
    return asset.host_name || locationName || asset.name;
  }
  return asset.name;
}
