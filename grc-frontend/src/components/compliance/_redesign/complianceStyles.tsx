'use client';

import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import type { ComplianceStatus, Priority, AssessmentStatus } from './types';

/**
 * Status / priority style maps + small presentational helpers for the
 * Compliance Assessments module. These mirror STATUS_STYLES / PRIORITY_STYLES
 * already used in AssessmentInlinePanel.tsx — reuse this single source of truth.
 *
 * Brand: teal --color-base #1ed4b0 (fills get near-black text; teal *text* uses
 * teal-700 #0f766e because #1ed4b0 fails contrast as text). AI accent = purple.
 */

export const STATUS_STYLES: Record<
  ComplianceStatus,
  { label: string; bg: string; text: string; border: string; dot: string; bar: string; icon: LucideIcon }
> = {
  complied:           { label: 'Complied',     bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500', icon: CheckCircle },
  partially_complied: { label: 'Partial',      bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500',   bar: 'bg-amber-500',   icon: AlertTriangle },
  not_complied:       { label: 'Not Complied', bg: 'bg-rose-100',    text: 'text-rose-800',    border: 'border-rose-200',    dot: 'bg-rose-500',    bar: 'bg-rose-500',    icon: XCircle },
  in_progress:        { label: 'In Progress',  bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200',    dot: 'bg-blue-500',    bar: 'bg-blue-500',    icon: Clock },
  na:                 { label: 'N/A',          bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-200',    dot: 'bg-gray-400',    bar: 'bg-gray-300',    icon: Minus },
};

export const PRIORITY_STYLES: Record<
  Priority,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  critical: { label: 'Critical', bg: 'bg-rose-100',    text: 'text-rose-800',    border: 'border-rose-200',    dot: 'bg-rose-500' },
  high:     { label: 'High',     bg: 'bg-orange-100',  text: 'text-orange-800',  border: 'border-orange-200',  dot: 'bg-orange-500' },
  medium:   { label: 'Medium',   bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  low:      { label: 'Low',      bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
};

export const ASSESSMENT_STATUS_STYLES: Record<
  AssessmentStatus,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  draft:       { label: 'Draft',       bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-200',    dot: 'bg-gray-400' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200',    dot: 'bg-blue-500' },
  in_review:   { label: 'In Review',   bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  completed:   { label: 'Completed',   bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
};

/** ring / progress color by score */
export function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#f43f5e';
}
export function riskColor(r?: string | null): string {
  if (r === 'High') return '#9f1239';
  if (r === 'Medium') return '#92400e';
  return '#065f46';
}

export function StatusBadge({ status }: { status: ComplianceStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.in_progress;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text} ${s.border}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority || !PRIORITY_STYLES[priority]) return <span className="text-xs text-slate-400">—</span>;
  const p = PRIORITY_STYLES[priority];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${p.bg} ${p.text} ${p.border}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

export function AssessmentStatusBadge({ status }: { status: AssessmentStatus }) {
  const s = ASSESSMENT_STATUS_STYLES[status] ?? ASSESSMENT_STATUS_STYLES.in_progress;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text} ${s.border}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** SVG compliance ring. size in px, stroke thickness in px. */
export function ComplianceRing({
  score,
  size = 78,
  stroke = 8,
  caption = 'complied',
}: {
  score: number;
  size?: number;
  stroke?: number;
  caption?: string;
}) {
  const r = (size - stroke) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const c = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#eef2f6" strokeWidth={stroke} />
        <circle
          cx={c} cy={c} r={r} fill="none" stroke={scoreColor(score)} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold leading-none text-slate-900" style={{ fontSize: size * 0.24 }}>{score}%</span>
        <span className="mt-0.5 text-slate-400" style={{ fontSize: size * 0.12 }}>{caption}</span>
      </div>
    </div>
  );
}

/** stacked status-mix bar */
export function StatusMixBar({
  counts,
  className = 'h-[7px]',
}: {
  counts: { complied: number; partial: number; not_complied: number; in_progress: number; na: number };
  className?: string;
}) {
  const order: { key: ComplianceStatus; v: number }[] = [
    { key: 'complied', v: counts.complied },
    { key: 'partially_complied', v: counts.partial },
    { key: 'in_progress', v: counts.in_progress },
    { key: 'not_complied', v: counts.not_complied },
    { key: 'na', v: counts.na },
  ];
  const total = Math.max(1, order.reduce((a, b) => a + b.v, 0));
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      {order.filter((o) => o.v > 0).map((o) => (
        <div key={o.key} className={STATUS_STYLES[o.key].bar} style={{ width: `${(o.v / total) * 100}%` }} />
      ))}
    </div>
  );
}
