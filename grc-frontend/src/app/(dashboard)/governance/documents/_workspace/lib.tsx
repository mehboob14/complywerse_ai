'use client';

/**
 * Shared primitives for the Governance Documents workspace (Tree / Register / Board views).
 * One source of truth for lifecycle mapping, review-status coloring, framework-name
 * resolution, owner avatars and doc-type tiles — so every view renders identically.
 *
 * Design charter: single teal brand (primary-*), category tints (blue/amber/cyan/slate)
 * only as incidental doc-type/framework markers, no gradients, hairline borders.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';

// ─── Shared document types ───────────────────────────────────────────────────
export interface GovDoc {
  id: number;
  tenant_id: number;
  document_code: string | null;
  title: string;
  description: string | null;
  content: string | null;
  doc_type: string;
  doc_sub_type: string | null;
  classification: string;
  parent_document_id: number | null;
  current_version: string;
  status: string;
  owner_id: number | null;
  owner_name: string | null;
  author_id: number | null;
  author_name: string | null;
  department_id: number | null;
  effective_date: string | null;
  expiry_date: string | null;
  review_cycle_months: number;
  next_review_date: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: number | null;
  regulatory_scope: string[];
  framework_ids: number[];
  applicable_framework_ids?: number[];
  tags: string[];
  approved_by: number | null;
  approved_at: string | null;
  published_by: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  has_file: boolean;
  policy_statement_count?: number;
}

export interface GovDocNode extends GovDoc {
  children?: GovDocNode[];
}

// ─── Lifecycle stages ────────────────────────────────────────────────────────
// Ordered approval workflow. Terminal states (expired/archived/exception_applied)
// are handled separately as neutral.
export const STAGE_ORDER = ['draft', 'pending_review', 'pending_approval', 'approved', 'published'] as const;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In Review',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  published: 'Published',
  expired: 'Expired',
  archived: 'Archived',
  exception_applied: 'Exception',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status.replace(/_/g, ' ');
}

/** Tone for the status dot / text. */
export function statusTone(status: string): 'draft' | 'progress' | 'pending' | 'approved' | 'published' | 'terminal' {
  switch (status) {
    case 'draft': return 'draft';
    case 'pending_review': return 'progress';
    case 'pending_approval': return 'pending';
    case 'approved': return 'approved';
    case 'published': return 'published';
    default: return 'terminal';
  }
}

const STATUS_DOT: Record<ReturnType<typeof statusTone>, string> = {
  draft: 'bg-slate-400',
  progress: 'bg-amber-500',
  pending: 'bg-amber-500',
  approved: 'bg-blue-500',
  published: 'bg-emerald-500',
  terminal: 'bg-slate-400',
};

const STATUS_TEXT: Record<ReturnType<typeof statusTone>, string> = {
  draft: 'text-slate-600',
  progress: 'text-amber-700',
  pending: 'text-amber-700',
  approved: 'text-blue-700',
  published: 'text-emerald-700',
  terminal: 'text-slate-500',
};

/** Inline status: colored dot + label (used in list rows + table cells). */
export function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  const tone = statusTone(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${STATUS_TEXT[tone]} ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[tone]}`} />
      {statusLabel(status)}
    </span>
  );
}

/** The 5-step lifecycle dot indicator + stage label (Register LIFECYCLE column). */
export function LifecycleDots({ status, showLabel = true }: { status: string; showLabel?: boolean }) {
  const idx = STAGE_ORDER.indexOf(status as (typeof STAGE_ORDER)[number]);
  const terminal = idx === -1; // expired / archived / exception
  const tone = statusTone(status);
  // color of the "current" (last filled) dot
  const currentDot =
    tone === 'progress' || tone === 'pending' ? 'bg-amber-500'
    : tone === 'approved' ? 'bg-blue-500'
    : tone === 'published' ? 'bg-emerald-500'
    : 'bg-slate-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" aria-hidden>
        {STAGE_ORDER.map((_, i) => {
          let cls = 'bg-slate-200';
          if (!terminal) {
            if (i < idx) cls = 'bg-primary-500';
            else if (i === idx) cls = currentDot;
          }
          return <span key={i} className={`h-1.5 w-4 rounded-full ${cls}`} />;
        })}
      </div>
      {showLabel && (
        <span className={`text-sm font-medium ${STATUS_TEXT[tone]}`}>{statusLabel(status)}</span>
      )}
    </div>
  );
}

// ─── Review status (next_review_date → relative label + tone) ────────────────
export interface ReviewInfo {
  label: string;
  tone: 'danger' | 'warning' | 'success' | 'muted';
  days: number | null;
}

export function reviewInfo(nextReviewDate: string | null | undefined): ReviewInfo {
  if (!nextReviewDate) return { label: '—', tone: 'muted', days: null };
  const now = new Date();
  const due = new Date(nextReviewDate);
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) {
    const over = Math.abs(days);
    return { label: over < 60 ? `Overdue ${over}d` : `Overdue ${Math.round(over / 30)} mo`, tone: 'danger', days };
  }
  if (days <= 30) return { label: `in ${days}d`, tone: 'warning', days };
  if (days <= 45) return { label: `in ${days}d`, tone: 'success', days };
  return { label: `in ${Math.round(days / 30)} mo`, tone: 'success', days };
}

const REVIEW_DOT: Record<ReviewInfo['tone'], string> = {
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  success: 'bg-emerald-500',
  muted: 'bg-slate-300',
};
const REVIEW_TEXT: Record<ReviewInfo['tone'], string> = {
  danger: 'text-rose-600',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
  muted: 'text-slate-400',
};

export function ReviewStatus({ date, className = '' }: { date: string | null | undefined; className?: string }) {
  const info = reviewInfo(date);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${REVIEW_TEXT[info.tone]} ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${REVIEW_DOT[info.tone]}`} />
      {info.label}
    </span>
  );
}

// ─── Doc-type tile (letter square) ───────────────────────────────────────────
// Category tints are sanctioned for doc-type markers (not brand meaning).
export const DOC_TYPE_STYLE: Record<string, { letter: string; tile: string; label: string }> = {
  policy: { letter: 'P', tile: 'bg-primary-50 text-primary-700', label: 'Policy' },
  standard: { letter: 'S', tile: 'bg-blue-50 text-blue-700', label: 'Standard' },
  procedure: { letter: 'P', tile: 'bg-amber-50 text-amber-700', label: 'Procedure' },
  guideline: { letter: 'G', tile: 'bg-violet-50 text-violet-700', label: 'Guideline' },
  charter: { letter: 'C', tile: 'bg-slate-100 text-slate-600', label: 'Charter' },
  framework: { letter: 'F', tile: 'bg-cyan-50 text-cyan-700', label: 'Framework' },
};

export function docTypeStyle(docType: string) {
  return DOC_TYPE_STYLE[docType] || { letter: (docType[0] || '?').toUpperCase(), tile: 'bg-slate-100 text-slate-600', label: docType };
}

export function DocTypeTile({ docType, size = 'md' }: { docType: string; size?: 'sm' | 'md' }) {
  const s = docTypeStyle(docType);
  const dim = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold ${dim} ${s.tile}`}>
      {s.letter}
    </span>
  );
}

/** Type pill (TYPE column). */
export function TypePill({ docType }: { docType: string }) {
  const s = docTypeStyle(docType);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.tile}`}>
      {s.label}
    </span>
  );
}

// ─── Owner initials avatar ───────────────────────────────────────────────────
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic category tint from a key (framework code / owner name) — a sanctioned
// "incidental category tint" per the charter (a marker, not brand meaning).
const CATEGORY_TINTS = [
  { soft: 'bg-blue-50 text-blue-700', avatar: 'bg-blue-100 text-blue-700' },
  { soft: 'bg-emerald-50 text-emerald-700', avatar: 'bg-emerald-100 text-emerald-700' },
  { soft: 'bg-violet-50 text-violet-700', avatar: 'bg-violet-100 text-violet-700' },
  { soft: 'bg-amber-50 text-amber-700', avatar: 'bg-amber-100 text-amber-700' },
  { soft: 'bg-cyan-50 text-cyan-700', avatar: 'bg-cyan-100 text-cyan-700' },
  { soft: 'bg-rose-50 text-rose-700', avatar: 'bg-rose-100 text-rose-700' },
  { soft: 'bg-primary-50 text-primary-700', avatar: 'bg-primary-100 text-primary-700' },
];
export function categoryTint(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_TINTS[h % CATEGORY_TINTS.length];
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
  const tint = categoryTint(name);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tint.avatar} ${dim}`} title={name}>
      {initialsOf(name)}
    </span>
  );
}

/** Owner chip: avatar + name (or Unassigned). */
export function OwnerChip({ name }: { name: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      <InitialsAvatar name={name} />
      <span className="truncate">{name || <span className="text-slate-400">Unassigned</span>}</span>
    </span>
  );
}

// ─── Framework id → name resolution + pills ──────────────────────────────────
/**
 * Cached lookup of framework id -> short label. A document's framework_ids /
 * applicable_framework_ids are UploadedFramework ids (grc_uploaded_frameworks),
 * NOT Framework-catalog ids — so resolve against the uploaded-frameworks list
 * (GET /framework-upload/upload), else pills show a raw "#11" fallback.
 */
export function useFrameworkNames() {
  const { data } = useQuery({
    queryKey: ['uploaded-frameworks-name-map'],
    queryFn: async () => {
      const res = await apiClient.get('/framework-upload/upload', { params: { limit: 1000 } });
      const d = res.data as unknown;
      return (Array.isArray(d) ? d : ((d as { items?: unknown[]; frameworks?: unknown[] })?.items ?? (d as { frameworks?: unknown[] })?.frameworks ?? [])) as Array<{ id: string | number; name: string; short_code?: string | null }>;
    },
    staleTime: 10 * 60 * 1000,
  });
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of (data as Array<{ id: string | number; name: string; short_code?: string | null }>) || []) {
      m[String(f.id)] = (f.short_code || f.name || '').trim() || `#${f.id}`;
    }
    return m;
  }, [data]);
  return nameMap;
}

export function FrameworkPills({
  ids,
  nameMap,
  max = 3,
}: {
  ids: number[] | null | undefined;
  nameMap: Record<string, string>;
  max?: number;
}) {
  const list = (ids || []).map((id) => nameMap[String(id)] || `#${id}`);
  if (list.length === 0) return <span className="text-slate-300">—</span>;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((label, i) => {
        const t = categoryTint(label);
        return (
          <span key={i} className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${t.soft}`}>
            {label}
          </span>
        );
      })}
      {rest > 0 && <span className="text-[11px] font-medium text-slate-400">+{rest}</span>}
    </span>
  );
}

/** Attestation coverage — plain colored % (matches the Register ATTEST column). */
export function AttestCell({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-slate-300">—</span>;
  const text = pct >= 90 ? 'text-emerald-700' : pct >= 70 ? 'text-amber-700' : 'text-rose-600';
  return <span className={`text-sm font-semibold ${text}`}>{Math.round(pct)}%</span>;
}

// ─── Small util: version display ─────────────────────────────────────────────
export function verLabel(v: string | null | undefined): string {
  if (!v) return '—';
  return v.startsWith('v') ? v : `v${v}`;
}
