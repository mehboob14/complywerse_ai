// The rules of the Audit packages tab, apart from React so `node --test` can pin them (packagesModel.test.ts): the counts by status, what a filter keeps, which steps a package is
// in a state to take (the server's own rules: only a draft takes or loses evidence, finalize needs at least one file, legal hold stops a delete), the order of a package's files and
// how a file moves one place, and what the New package form sends. The server decides every rule; this file only says in words what it will refuse, before the person asks.
import { formatDate } from '../../../../lib/format.ts';

export interface PackageRow {
  id: number;
  name: string;
  description: string | null;
  framework_id: number | null;
  framework_name: string | null;
  audit_period_start: string | null;
  audit_period_end: string | null;
  status: string;
  created_by: number | null;
  creator_name: string | null;
  created_at: string | null;
  finalized_at: string | null;
  exported_at: string | null;
  retention_until: string | null;
  is_legal_hold: boolean;
  evidence_count: number;
}

export interface PackageItem {
  id: number;
  evidence_id: number;
  sequence: number;
  notes: string | null;
  added_at: string | null;
  evidence: { id: number; name: string; evidence_type: string | null; status: string; file_name: string | null; collection_date: string | null } | null;
}

export interface PackageLog { id: number; user_name: string | null; action: string; accessed_at: string | null }
export interface PackageDetail extends PackageRow { evidence_items: PackageItem[] }

// ── the list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const STATUS_TABS = ['all', 'draft', 'finalized', 'exported'] as const;
export type StatusTab = (typeof STATUS_TABS)[number];
export const TAB_LABEL: Record<StatusTab, string> = { all: 'All', draft: 'Draft', finalized: 'Finalized', exported: 'Exported' };

/** How many packages are in each status tab ("All" is every package, an archived one included: the tab for it is not offered, but it is counted and listed). */
export function tabCounts(rows: readonly PackageRow[]): Record<StatusTab, number> {
  const out: Record<StatusTab, number> = { all: rows.length, draft: 0, finalized: 0, exported: 0 };
  rows.forEach((r) => { if (r.status in out && r.status !== 'all') out[r.status as StatusTab] += 1; });
  return out;
}

export interface PackageFilter { status: StatusTab; hold: boolean; q: string }
export const NO_PACKAGE_FILTER: PackageFilter = { status: 'all', hold: false, q: '' };

/** The packages in a status tab, on legal hold only when asked, whose name or framework holds every word of the search. Newest first, as the server sends them. */
export function filterPackages(rows: readonly PackageRow[], f: PackageFilter): PackageRow[] {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.hold && !r.is_legal_hold) return false;
    const text = `${r.name} ${r.framework_name ?? ''} ${r.creator_name ?? ''}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}

/** "1 Jan 2026 to 31 Dec 2026", or the one end that is set, or "Not set" (the person can set it). */
export function periodText(start: string | null, end: string | null): string {
  if (!start && !end) return 'Not set';
  if (start && end) return `${formatDate(start, { calendar: true })} to ${formatDate(end, { calendar: true })}`;
  return start ? `From ${formatDate(start, { calendar: true })}` : `Until ${formatDate(end, { calendar: true })}`;
}

// ── what a package can take ──────────────────────────────────────────────────────────────────────────────────────────────
export interface PackageSteps {
  /** evidence can be added, removed and reordered (only a draft) */
  editable: boolean;
  finalize: { allowed: boolean; why: string | null };
  /** a finalized package is exported; an exported one may be exported again */
  exportable: boolean;
  downloadable: boolean;
  remove: { allowed: boolean; why: string | null };
}

export function stepsOf(p: Pick<PackageRow, 'status' | 'evidence_count' | 'is_legal_hold'>): PackageSteps {
  const draft = p.status === 'draft';
  return {
    editable: draft,
    finalize: draft ? (p.evidence_count > 0 ? { allowed: true, why: null } : { allowed: false, why: 'Add evidence before finalizing this package.' }) : { allowed: false, why: 'Only a draft can be finalized.' },
    exportable: p.status === 'finalized' || p.status === 'exported',
    downloadable: p.status === 'exported',
    remove: p.is_legal_hold ? { allowed: false, why: 'This package is on legal hold.' } : draft ? { allowed: true, why: null } : { allowed: false, why: 'Only a draft package can be deleted.' },
  };
}

// ── the files of a package ───────────────────────────────────────────────────────────────────────────────────────────────
/** The files in the order they are printed in the package. */
export const inOrder = (items: readonly PackageItem[]): PackageItem[] => items.slice().sort((a, b) => a.sequence - b.sequence || a.id - b.id);

/** Moving a file one place up or down is a swap with its neighbour: the server sets one file's position at a time, so the two files trade positions (two writes). Setting only
 *  the moved file to its neighbour's number left both at the same number, and the order did not change. null at either end. */
export function swapPlan(items: readonly PackageItem[], index: number, dir: -1 | 1): Array<{ itemId: number; newSequence: number }> | null {
  const list = inOrder(items);
  const other = index + dir;
  if (index < 0 || index >= list.length || other < 0 || other >= list.length) return null;
  const a = list[index];
  const b = list[other];
  // two files at the same number (older data): give the moved one a number on the right side of its neighbour
  const same = a.sequence === b.sequence;
  return same
    ? [{ itemId: a.id, newSequence: b.sequence + dir }, { itemId: b.id, newSequence: b.sequence }]
    : [{ itemId: a.id, newSequence: b.sequence }, { itemId: b.id, newSequence: a.sequence }];
}

// ── the New package form ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface CreateForm { name: string; description: string; framework_id: string; audit_period_start: string; audit_period_end: string }
export const EMPTY_FORM: CreateForm = { name: '', description: '', framework_id: '', audit_period_start: '', audit_period_end: '' };
export const NAME_MAX = 255;

/** What is wrong with the form before it is sent (nothing: an empty object). */
export function problems(form: CreateForm): { name?: string; period?: string } {
  const out: { name?: string; period?: string } = {};
  if (!form.name.trim()) out.name = 'Enter a name.';
  else if (form.name.trim().length > NAME_MAX) out.name = `Use ${NAME_MAX} characters or fewer.`;
  if (form.audit_period_start && form.audit_period_end && form.audit_period_end < form.audit_period_start) out.period = 'The period cannot end before it starts.';
  return out;
}

/** Exactly what the form always sent: the name, the description (null when empty), and the framework and the two days only when chosen. */
export function createPayload(form: CreateForm): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: form.name.trim(), description: form.description.trim() || null };
  if (form.framework_id) payload.framework_id = parseInt(form.framework_id, 10);
  if (form.audit_period_start) payload.audit_period_start = form.audit_period_start;
  if (form.audit_period_end) payload.audit_period_end = form.audit_period_end;
  return payload;
}

/** The downloaded file's name. */
export const downloadName = (p: Pick<PackageRow, 'id' | 'name'>): string => `audit-package-${p.id}-${p.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export'}.zip`;
