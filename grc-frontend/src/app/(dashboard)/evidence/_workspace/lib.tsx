'use client';

/**
 * Shared primitives for the Evidence workspace (Workbench / Register / Pipeline /
 * Snapshot / Performance views + the split detail). One source of truth for status,
 * type, owner, expiry, quality and framework rendering — mirrors the governance
 * documents/_workspace/lib.tsx patterns, adapted to evidence semantics.
 *
 * Charter: single teal brand (primary-*), category tints only as type/status markers,
 * no gradients, hairline borders.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { frameworksApi } from '@/lib/api';
import {
  FileText, Image as ImageIcon, ShieldCheck, ClipboardList, FileSpreadsheet, Settings,
  Eye, AlertTriangle, AlertCircle, Edit2, FileCheck,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface EvidenceItem {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploaded_at: string | null;
  status: string;
  ocr_status: string;
  ocr_processed_at: string | null;
  evidence_type: string | null;
  collection_date: string | null;
  validity_period_days: number | null;
  expiry_date: string | null;
  is_stale: boolean;
  source_system: string | null;
  content_summary: string | null;
  quality_score: number | null;
  submitted_by: number | null;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: number | null;
  approved_at: string | null;
  control_mappings_count?: number;
  // Additive (backend #1/#2) — optional so the UI works pre-restart.
  owner_id?: number | null;
  owner_name?: string | null;
  department?: string | null;
  committee_id?: number | null;
  committee_name?: string | null;
  risk_links_count?: number;
  asset_links_count?: number;
  incident_links_count?: number;
  policy_links_count?: number;
}

export interface EvidenceSummary {
  total_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  stale_count: number;
  expiring_soon_count: number;
  pending_review_count: number;
  by_month?: Array<{ month: string; uploaded: number; approved: number }>;
}

// ─── Status ──────────────────────────────────────────────────────────────────
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  archived: 'Archived',
};
export function statusLabel(s: string): string {
  return STATUS_LABEL[s] || s.replace(/_/g, ' ');
}
export type StatusTone = 'draft' | 'pending' | 'approved' | 'rejected' | 'expired' | 'archived';
export function statusTone(s: string): StatusTone {
  if (s === 'draft') return 'draft';
  if (s === 'pending_review') return 'pending';
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  if (s === 'expired') return 'expired';
  return 'archived';
}
const STATUS_DOT: Record<StatusTone, string> = {
  draft: 'bg-slate-400', pending: 'bg-amber-500', approved: 'bg-emerald-500',
  rejected: 'bg-rose-500', expired: 'bg-orange-500', archived: 'bg-slate-400',
};
const STATUS_TEXT: Record<StatusTone, string> = {
  draft: 'text-slate-600', pending: 'text-amber-700', approved: 'text-emerald-700',
  rejected: 'text-rose-600', expired: 'text-orange-700', archived: 'text-slate-500',
};
const STATUS_PILL: Record<StatusTone, string> = {
  draft: 'bg-slate-100 text-slate-600', pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-600',
  expired: 'bg-orange-50 text-orange-700', archived: 'bg-slate-100 text-slate-500',
};

export function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  const t = statusTone(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${STATUS_TEXT[t]} ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[t]}`} />
      {statusLabel(status)}
    </span>
  );
}
export function StatusPill({ status }: { status: string }) {
  const t = statusTone(status);
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[t]}`}>{statusLabel(status)}</span>;
}

// ─── Type icon / letter ──────────────────────────────────────────────────────
export const TYPE_ICONS: Record<string, typeof FileText> = {
  screenshot: ImageIcon, document: FileText, certificate: ShieldCheck, audit_report: ClipboardList,
  log: FileSpreadsheet, policy: FileText, procedure: ClipboardList, configuration: Settings,
  attestation: ShieldCheck, training_record: ClipboardList, access_review: Eye,
  vulnerability_scan: AlertTriangle, penetration_test: ShieldCheck, backup_log: FileSpreadsheet,
  change_record: Edit2, incident_report: AlertCircle, other: FileCheck,
};
export function getTypeIcon(t: string | null) {
  return TYPE_ICONS[t || 'other'] || FileCheck;
}
export function typeLabel(t: string | null): string {
  if (!t) return 'Other';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Owner initials avatar (letter tile from evidence name) ──────────────────
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// Deterministic category tint from a key (owner name) — a sanctioned "incidental
// category tint" per the charter (a per-person marker, not brand meaning).
const AVATAR_TINTS = [
  'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700', 'bg-cyan-100 text-cyan-700', 'bg-rose-100 text-rose-700',
  'bg-primary-100 text-primary-700',
];
export function avatarTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
export function InitialsAvatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs';
  if (!name) return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-400 ${dim}`} title="Unassigned">?</span>;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarTint(name)} ${dim}`} title={name}>{initialsOf(name)}</span>;
}
export function OwnerChip({ name }: { name: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      <InitialsAvatar name={name} />
      <span className="truncate">{name || <span className="text-slate-400">Unassigned</span>}</span>
    </span>
  );
}
/** Owner display for an evidence item: prefer owner_name (backend #1), fall back to uploader. */
export function ownerOf(e: Pick<EvidenceItem, 'owner_name' | 'uploader_name'>): string | null {
  return e.owner_name || e.uploader_name || null;
}

/** Square letter tile from the evidence NAME first letter (matches the PDF rows). */
export function EvidenceLetterTile({ name, evidenceType, size = 'md' }: { name: string; evidenceType?: string | null; size?: 'sm' | 'md' }) {
  const letter = (name?.trim()?.[0] || '?').toUpperCase();
  const dim = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base';
  // Expired/near-expiry cue is handled by rows; tile stays brand-neutral teal.
  void evidenceType;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-primary-50 font-bold text-primary-700 ${dim}`}>{letter}</span>;
}

// ─── Expiry / validity ───────────────────────────────────────────────────────
export interface ExpiryInfo { label: string; tone: 'danger' | 'warning' | 'success' | 'muted'; days: number | null; }
export function expiryInfo(expiry: string | null | undefined): ExpiryInfo {
  if (!expiry) return { label: 'No expiry', tone: 'muted', days: null };
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `Expired ${Math.abs(days)}d`, tone: 'danger', days };
  if (days <= 30) return { label: `${days}d left`, tone: 'warning', days };
  return { label: `${days}d left`, tone: 'success', days };
}
const EXP_DOT: Record<ExpiryInfo['tone'], string> = { danger: 'bg-rose-500', warning: 'bg-amber-500', success: 'bg-emerald-500', muted: 'bg-slate-300' };
const EXP_TEXT: Record<ExpiryInfo['tone'], string> = { danger: 'text-rose-600', warning: 'text-amber-700', success: 'text-emerald-700', muted: 'text-slate-400' };
export function ExpiryStatus({ expiry, showDot = true, className = '' }: { expiry: string | null | undefined; showDot?: boolean; className?: string }) {
  const info = expiryInfo(expiry);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${EXP_TEXT[info.tone]} ${className}`}>
      {showDot && <span className={`h-2 w-2 shrink-0 rounded-full ${EXP_DOT[info.tone]}`} />}
      {info.label}
    </span>
  );
}

// ─── Quality score ───────────────────────────────────────────────────────────
/** Normalise a score that may be 0-1 or 0-100 into a 0-100 int (or null). */
export function normPct(v: number | null | undefined): number | null {
  if (v == null) return null;
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}
export function qualityTextColor(pct: number | null): string {
  if (pct == null) return 'text-slate-400';
  if (pct >= 80) return 'text-emerald-700';
  if (pct >= 60) return 'text-amber-700';
  if (pct >= 40) return 'text-orange-700';
  return 'text-rose-600';
}
export function qualityBarColor(pct: number | null): string {
  if (pct == null) return 'bg-slate-300';
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-500';
  if (pct >= 40) return 'bg-orange-500';
  return 'bg-rose-500';
}
export function QualityBar({ pct, width = 'w-14' }: { pct: number | null; width?: string }) {
  if (pct == null) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-1.5 ${width} overflow-hidden rounded-full bg-slate-100`}>
        <span className={`block h-full rounded-full ${qualityBarColor(pct)}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <span className={`text-xs font-semibold ${qualityTextColor(pct)}`}>{pct}%</span>
    </span>
  );
}

// ─── Framework pills (Linked / Suggested) ────────────────────────────────────
export function useFrameworkNames() {
  const { data } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => (await frameworksApi.getAll()).data,
    staleTime: 10 * 60 * 1000,
  });
  return useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of (data as Array<{ id: string | number; name: string; short_code?: string | null }>) || []) {
      m[String(f.id)] = (f.short_code || f.name || '').trim() || `#${f.id}`;
    }
    return m;
  }, [data]);
}

export interface FrameworkTag { name: string; count: number; linked: boolean; }
export function FrameworkTagPill({ tag }: { tag: FrameworkTag }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
      {tag.name}
      <span className="text-[10px] font-normal text-slate-500">{tag.count} · {tag.linked ? 'Linked' : 'Suggested'}</span>
    </span>
  );
}

/** Simple id→name framework pills for list rows (from framework ids). */
export function FrameworkPills({ ids, nameMap, max = 2 }: { ids: number[] | null | undefined; nameMap: Record<string, string>; max?: number }) {
  const list = (ids || []).map((id) => nameMap[String(id)] || `#${id}`);
  if (!list.length) return <span className="text-slate-300">—</span>;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((l, i) => <span key={i} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{l}</span>)}
      {rest > 0 && <span className="text-[11px] font-medium text-slate-400">+{rest}</span>}
    </span>
  );
}

// ─── Applicable-frameworks derivation (from detail assessment data) ──────────
/** Merge linked-control frameworks + clause-mapping frameworks + AI free-text into a
 *  deduped Linked/Suggested tag list — same logic the detail AssessmentTab uses. */
export function deriveApplicableFrameworks(
  byFramework: Array<{ framework_name: string; controls?: unknown[] }> | undefined,
  clauseFrameworkNames: string[] | undefined,
  aiFrameworks: string[] | undefined,
): FrameworkTag[] {
  const linked = new Map<string, number>();
  for (const f of byFramework || []) {
    if (f.framework_name) linked.set(f.framework_name, (f.controls?.length ?? 0));
  }
  const suggested = new Map<string, number>();
  for (const n of clauseFrameworkNames || []) if (n && !linked.has(n)) suggested.set(n, (suggested.get(n) || 0) + 1);
  for (const raw of aiFrameworks || []) {
    const n = (raw || '').split(':')[0].trim();
    if (n && !linked.has(n) && !suggested.has(n)) suggested.set(n, 1);
  }
  const out: FrameworkTag[] = [];
  Array.from(linked.entries()).forEach(([name, count]) => out.push({ name, count: count || 1, linked: true }));
  Array.from(suggested.entries()).forEach(([name, count]) => out.push({ name, count, linked: false }));
  return out;
}

// ─── date fmt ────────────────────────────────────────────────────────────────
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}
export function fmtDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  catch { return '—'; }
}
