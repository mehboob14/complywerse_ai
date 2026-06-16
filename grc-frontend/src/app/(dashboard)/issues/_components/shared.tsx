'use client';

// Shared chips + helpers used across the Issues UI. Kept in one file so the
// individual route components stay focused on layout.

import {
  AlertTriangle, Bug, Building2, Calendar, ClipboardList, FileText,
  Megaphone, Settings, Shield, Users,
} from 'lucide-react';

export const SEVERITY_TONE: Record<string, { chip: string; dot: string }> = {
  critical:      { chip: 'border-rose-200 bg-rose-50 text-rose-700',         dot: 'bg-rose-500' },
  high:          { chip: 'border-orange-200 bg-orange-50 text-orange-700',   dot: 'bg-orange-500' },
  medium:        { chip: 'border-amber-200 bg-amber-50 text-amber-700',      dot: 'bg-amber-500' },
  low:           { chip: 'border-blue-200 bg-blue-50 text-blue-700',         dot: 'bg-blue-500' },
  informational: { chip: 'border-slate-200 bg-slate-100 text-slate-600',     dot: 'bg-slate-400' },
};

export const STATE_TONE: Record<string, { chip: string; label: string }> = {
  new:             { chip: 'border-slate-200 bg-slate-50 text-slate-700',   label: 'New' },
  triage:          { chip: 'border-violet-200 bg-violet-50 text-violet-700',label: 'Triage' },
  in_progress:     { chip: 'border-blue-200 bg-blue-50 text-blue-700',      label: 'In Progress' },
  resolution:      { chip: 'border-cyan-200 bg-cyan-50 text-cyan-700',      label: 'Resolution' },
  closure_review:  { chip: 'border-amber-200 bg-amber-50 text-amber-700',   label: 'Closure Review' },
  closed:          { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Closed' },
  cancelled:       { chip: 'border-slate-200 bg-slate-100 text-slate-500',  label: 'Cancelled' },
};

export const SOURCE_ICONS: Record<string, React.ElementType> = {
  manual: ClipboardList,
  vulnerability: Bug,
  risk: AlertTriangle,
  control_test: Shield,
  audit: FileText,
  vendor_review: Building2,
  incident_report: Megaphone,
  asset: Settings,
};

export const ISSUE_TYPES = [
  { value: 'incident', label: 'Incident' },
  { value: 'audit_finding', label: 'Audit Finding' },
  { value: 'non_conformance', label: 'Non-Conformance' },
  { value: 'vendor_breach', label: 'Vendor Breach' },
  { value: 'process_gap', label: 'Process Gap' },
  { value: 'capa', label: 'CAPA' },
  { value: 'other', label: 'Other' },
];

export const CATEGORIES = [
  { value: 'security', label: 'Security' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'operations', label: 'Operations' },
  { value: 'contract', label: 'Contract' },
  { value: 'data', label: 'Data' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'safety', label: 'Safety' },
];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export const IMPACTS = ['high', 'medium', 'low'] as const;
export const URGENCIES = ['high', 'medium', 'low'] as const;

export function SeverityChip({ severity }: { severity?: string | null }) {
  const tone = SEVERITY_TONE[(severity || 'medium').toLowerCase()] || SEVERITY_TONE.medium;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold uppercase ${tone.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {severity || '—'}
    </span>
  );
}

export function StateChip({ state }: { state?: string | null }) {
  const tone = STATE_TONE[(state || 'new')] || STATE_TONE.new;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase ${tone.chip}`}>
      {tone.label}
    </span>
  );
}

export function SourceChip({ sourceType }: { sourceType?: string | null }) {
  const Icon = SOURCE_ICONS[(sourceType || 'manual')] || ClipboardList;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium uppercase text-slate-600">
      <Icon className="h-2.5 w-2.5" />
      {sourceType ? sourceType.replace(/_/g, ' ') : 'manual'}
    </span>
  );
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysFromNow(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
