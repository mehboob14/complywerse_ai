// Committee packs (Risk Management wave 3-J): the shapes GET /erm/reports/packs returns and the rules the page draws from them.
import type { Tone } from '@/lib/status';

export type PackStatus = 'draft' | 'ready' | 'frozen';
export type PackCell = string | number | null;

export interface PackSection {
  key: string;
  title: string;
  columns: string[];
  rows: PackCell[][];
}

export interface CommitteePack {
  id: number;
  title: string;
  status: PackStatus;
  committee_id: number | null;
  committee_name: string | null;
  meeting_id: number | null;
  meeting_title: string | null;
  meeting_date: string | null;
  built_at: string | null;
  prepared_by: number | null;
  prepared_by_name: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  can_freeze: boolean;
  summary?: string | null;
  sections?: PackSection[];
  commentary?: Record<string, string>;
}

export const PACK_STATUS: Record<PackStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft pack', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'pending' },
  frozen: { label: 'Frozen', tone: 'success' },
};

export type PackAction = 'edit' | 'ready' | 'freeze' | 'export';

/** What the person may do with the pack: edit the commentary until it is frozen, mark a draft ready, approve and freeze (the
 *  server says who: never the preparer), export once frozen. */
export function packActions(pack: Pick<CommitteePack, 'status' | 'can_freeze'>, canEdit: boolean): PackAction[] {
  if (pack.status === 'frozen') return ['export'];
  const out: PackAction[] = canEdit ? ['edit'] : [];
  if (canEdit && pack.status === 'draft') out.push('ready');
  if (pack.can_freeze) out.push('freeze');
  return out;
}

export interface PackGroup { committee: string; packs: CommitteePack[] }

/** Packs by committee (named committees first, alphabetically; packs with none last), newest first in each. */
export function groupByCommittee(packs: CommitteePack[]): PackGroup[] {
  const NONE = 'No committee';
  const groups = new Map<string, CommitteePack[]>();
  for (const p of packs) {
    const key = p.committee_name || NONE;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const when = (p: CommitteePack) => p.meeting_date || p.built_at || '';
  return Array.from(groups, ([committee, list]) => ({ committee, packs: [...list].sort((a, b) => when(b).localeCompare(when(a))) }))
    .sort((a, b) => (a.committee === NONE ? 1 : b.committee === NONE ? -1 : a.committee.localeCompare(b.committee)));
}

/** A cell as the pack shows it: money with two decimals in the loss section, a score as it is, a blank as a dash. */
export function formatCell(value: PackCell, money: boolean): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'number') {
    return money ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
  }
  return value;
}

export const MONEY_SECTIONS = new Set(['losses', 'scenarios']);

/** The commentary fields the person changed, to send as one merge. */
export function changedCommentary(saved: Record<string, string>, draft: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(draft).filter(([key, text]) => text !== (saved[key] ?? '')));
}
