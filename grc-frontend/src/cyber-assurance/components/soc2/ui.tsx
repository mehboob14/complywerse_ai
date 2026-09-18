// Shared SOC 2 presentational primitives — reused by the controls library table
// and the control-detail page so a code/criterion/status renders identically on
// both. Modelled on the Verity reference (trust-service chips = categorical
// colour, status pills = lifecycle), rendered in this platform's design system.

export const TRUST_SERVICES = [
  'Security', 'Availability', 'Confidentiality', 'Processing Integrity', 'Privacy',
] as const;
export type TrustService = (typeof TRUST_SERVICES)[number];

// Solid-fill categorical chips: the colour says *which* Trust Services Category,
// never a status or severity. Five distinct hues, white text (legible on any row).
const TSC_COLOR: Record<TrustService, string> = {
  Security: '#0f766e', // teal-700
  Availability: '#7c3aed', // violet-600
  Confidentiality: '#2563eb', // blue-600
  'Processing Integrity': '#d97706', // amber-600
  Privacy: '#9a3412', // orange-800
};
const TSC_SHORT: Record<TrustService, string> = {
  Security: 'Security',
  Availability: 'Availability',
  Confidentiality: 'Confidential.',
  'Processing Integrity': 'Proc. Integrity',
  Privacy: 'Privacy',
};

/** A SOC 2 criterion code maps to one category by prefix. Order: CC/PI before C/P. */
export function trustServiceFor(code: string): TrustService | null {
  if (code.startsWith('CC')) return 'Security';
  if (code.startsWith('PI')) return 'Processing Integrity';
  if (code.startsWith('A')) return 'Availability';
  if (code.startsWith('C')) return 'Confidentiality';
  if (code.startsWith('P')) return 'Privacy';
  return null;
}
export function trustServicesForCriteria(criteria: string[]): TrustService[] {
  const found = new Set<TrustService>();
  for (const c of criteria) {
    const t = trustServiceFor(c);
    if (t) found.add(t);
  }
  return TRUST_SERVICES.filter((t) => found.has(t));
}

export function TrustServiceChip({ tsc }: { tsc: TrustService }) {
  return (
    <span
      style={{ backgroundColor: TSC_COLOR[tsc] }}
      className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
      title={tsc}
    >
      {TSC_SHORT[tsc]}
    </span>
  );
}

/** A criterion code chip (neutral) as it appears in the Criteria column. */
export function CriterionChip({ code }: { code: string }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {code}
    </span>
  );
}

/** The control/criterion code chip (accent), used in headers and links. */
export function CodeChip({ code, className = '' }: { code: string; className?: string }) {
  return (
    <span className={`inline-flex rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary-700 ${className}`}>
      {code}
    </span>
  );
}

/** Sub-type taxonomy chip (Automated / Hybrid / Manual). */
export function SubTypeChip({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {value}
    </span>
  );
}

// Control status is derived from its automated checks' latest runs (passed/…),
// or "manual" when a control has no automated test (governance controls).
export const CONTROL_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  passed: { label: 'Passing', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  failed: { label: 'Failing', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  partial: { label: 'Partial', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  error: { label: 'Error', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  // Deliberately not rose: neither of these says the control is failing. One says
  // the result is too old to rely on, the other that we could not look at all.
  expired: { label: 'Expired', cls: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  collection_failed: { label: 'Not collected', cls: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  running: { label: 'Running', cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  not_run: { label: 'Not run', cls: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  manual: { label: 'Manual', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

export function ControlStatusPill({ status, inline = false }: { status: string; inline?: boolean }) {
  const s = CONTROL_STATUS[status] || CONTROL_STATUS.not_run;
  if (inline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
        <span className={`size-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// Types shared across the SOC 2 pages (mirror the /automation/soc2 API shapes).
export interface LinkedCheck {
  plugin_key: string;
  id: number | null;
  title: string | null;
  severity: string | null;
  seeded: boolean;
  source?: string;
  last_run: { status: string; started_at?: string | null; result_summary?: string | null } | null;
}
export interface Soc2Control {
  control_id: string;
  title: string;
  description: string;
  guidance?: string | null;
  sub_type?: string | null;
  category: string;
  domain?: string;
  importance?: string;
  criteria?: string[];
  checks_count: number;
  overall_status: string;
  checks: LinkedCheck[];
}
export interface Soc2Criterion {
  code: string;
  name: string;
  description?: string | null;
  category: string;
  requirement_key: string;
  trust_services_category?: string | null; // SOC 2 only; absent for ISO/GDPR
  is_always_in_scope: boolean;
}

// The automation frameworks whose control libraries share one check engine.
export const AUTOMATION_FRAMEWORKS = [
  { key: 'soc2', label: 'SOC 2', short: 'SOC2' },
  { key: 'iso27001', label: 'ISO 27001', short: 'ISO' },
  { key: 'gdpr', label: 'GDPR', short: 'GDPR' },
] as const;
export type AutomationFrameworkKey = (typeof AUTOMATION_FRAMEWORKS)[number]['key'];

// Solid framework badge (categorical colour per framework) for the common library.
const FRAMEWORK_COLOR: Record<string, string> = {
  soc2: '#0f766e', iso27001: '#2563eb', gdpr: '#7c3aed',
};
const FRAMEWORK_LABEL: Record<string, { short: string; label: string }> = {
  soc2: { short: 'SOC 2', label: 'SOC 2' },
  iso27001: { short: 'ISO 27001', label: 'ISO/IEC 27001:2022' },
  gdpr: { short: 'GDPR', label: 'GDPR' },
};
// Any framework slug the SCF crosswalk resolves to gets a stable colour, so a
// newly seeded framework is visually distinct without touching this file.
const BADGE_PALETTE = [
  '#0f766e', '#2563eb', '#7c3aed', '#b45309', '#be123c', '#0369a1',
  '#4d7c0f', '#9333ea', '#c2410c', '#0891b2', '#a16207', '#7e22ce',
];
function paletteFor(fw: string): string {
  let h = 0;
  for (let i = 0; i < fw.length; i++) h = (h * 31 + fw.charCodeAt(i)) >>> 0;
  return BADGE_PALETTE[h % BADGE_PALETTE.length];
}
function prettyFw(fw: string): string {
  return fw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FrameworkBadge({ fw, label }: { fw: string; label?: string }) {
  const m = FRAMEWORK_LABEL[fw] || { short: label || prettyFw(fw), label: label || prettyFw(fw) };
  return (
    <span
      style={{ backgroundColor: FRAMEWORK_COLOR[fw] || paletteFor(fw) }}
      className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
      title={m.label}
    >
      {m.short}
    </span>
  );
}

// Common control library shapes (mirror /automation/common/controls).
export interface FrameworkReq { code: string; name: string; text?: string }
export interface CommonControl {
  control_id: string;
  canonical_key: string;
  title: string;
  description: string;
  guidance?: string | null;
  category: string;
  domain?: string;
  importance?: string;
  sub_type?: string | null;
  frameworks: string[];
  // framework slug -> the requirements this control discharges there
  requirements: Record<string, FrameworkReq[]>;
  requirement_count: number;
  checks_count: number;
  overall_status: string;
  checks: LinkedCheck[];
}
