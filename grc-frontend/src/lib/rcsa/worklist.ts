// The Worklist (Risk Management > RCSA) apart from React (worklist.test.ts): the shape of GET /rcsa/my-work, the counters of the band with the filter each one
// opens, and one row of the list as the props of the kit's WorkRow. The server counts (true totals, not the rows it sent); this file only words and routes them.
import type { Tone } from '../status.ts';

export interface WorkRow {
  kind: 'complete' | 'returned' | 'review' | 'finding';
  key: string;
  assessment_id: number;
  finding_id?: number;
  campaign_id: number | null;
  campaign_name: string | null;
  business_unit_name?: string | null;
  title?: string;
  severity?: string;
  status: string;
  due_date: string | null;
  overdue: boolean;
  progress?: number | null;
  assessor_name?: string | null;
  submitted_at?: string | null;
  tier?: number;
  total_tiers?: number;
  return_comment?: string | null;
}

export interface WorkCampaign {
  id: number; name: string; status: string; period: string | null; due_date: string | null;
  units: number; approved: number; waiting_review: number; late: number;
}

export interface MyWork {
  counts: { to_complete: number; returned: number; to_review: number; findings_owned: number; overdue: number; open_findings: number; late_units: number; actions: number };
  rows: WorkRow[];
  total: number;
  campaigns: WorkCampaign[];
  campaigns_total: number;
  roles: { manage: boolean; review: boolean; assess: boolean };
}

export type Show = 'all' | 'complete' | 'returned' | 'review' | 'overdue' | 'findings';
export const SHOWS: readonly Show[] = ['all', 'complete', 'returned', 'review', 'overdue', 'findings'];

export interface Counter { key: string; label: string; value: number; tone: Tone; show?: Show; href?: string }

/** The band's counters for this person. Each opens the rows it counts (`show`) or the page that lists them (`href`). Ones that cannot concern the person are left out:
 *  no review counter for somebody nobody sends work to, no unit counters for somebody with no unit and none to fix. */
export function countersOf(work: MyWork): Counter[] {
  const { counts, roles } = work;
  const out: Counter[] = [];
  if (roles.assess || counts.to_complete > 0) out.push({ key: 'complete', label: 'To complete', value: counts.to_complete, tone: 'progress', show: 'complete' });
  if (roles.assess || counts.returned > 0) out.push({ key: 'returned', label: 'Sent back', value: counts.returned, tone: 'warning', show: 'returned' });
  if (roles.review) out.push({ key: 'review', label: 'To review', value: counts.to_review, tone: 'pending', show: 'review' });
  if (roles.assess || counts.overdue > 0) out.push({ key: 'overdue', label: 'Overdue', value: counts.overdue, tone: 'danger', show: 'overdue' });
  if (counts.findings_owned > 0) out.push({ key: 'owned', label: 'Findings I own', value: counts.findings_owned, tone: 'warning', show: 'findings' });
  if (roles.manage) out.push({ key: 'late', label: 'Late units', value: counts.late_units, tone: 'danger', href: '/erm/rcsa/campaigns?show=late' });
  out.push({ key: 'findings', label: 'Open findings', value: counts.open_findings, tone: 'warning', href: '/erm/rcsa/findings?status=open,in_progress' });
  return out;
}

/** The rows a counter's filter shows. `all` is every row the server sent. */
export function rowsFor(rows: readonly WorkRow[], show: Show): WorkRow[] {
  switch (show) {
    case 'complete': return rows.filter((r) => r.kind === 'complete');
    case 'returned': return rows.filter((r) => r.kind === 'returned');
    case 'review': return rows.filter((r) => r.kind === 'review');
    case 'findings': return rows.filter((r) => r.kind === 'finding');
    case 'overdue': return rows.filter((r) => r.overdue);
    default: return rows.slice();
  }
}

/** The true size of what a filter shows: the server's counts, not the length of the rows it sent (which stop at its limit). */
export function totalFor(work: MyWork, show: Show): number {
  const c = work.counts;
  switch (show) {
    case 'complete': return c.to_complete;
    case 'returned': return c.returned;
    case 'review': return c.to_review;
    case 'findings': return c.findings_owned;
    case 'overdue': return c.overdue;
    default: return c.actions;
  }
}

export interface RowView {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  href: string;
  context: string;
  due: string | null;
  action: { label: string; href: string };
}

const unitTitle = (r: WorkRow) => [r.business_unit_name || 'Unit', r.campaign_name].filter(Boolean).join(' · ');

export function rowView(r: WorkRow): RowView {
  const unit = `/erm/rcsa/assessments/${r.assessment_id}`;
  switch (r.kind) {
    case 'returned':
      return {
        key: r.key, kind: { label: 'Sent back', tone: 'warning' }, title: unitTitle(r), href: unit, due: r.due_date,
        context: r.return_comment ? `Reviewer: ${r.return_comment}` : 'The reviewer asked for changes',
        action: { label: 'Fix', href: unit },
      };
    case 'review': {
      const step = r.total_tiers && r.total_tiers > 1 ? ` · step ${Math.max(r.tier ?? 1, 1)} of ${r.total_tiers}` : '';
      return {
        key: r.key, kind: { label: 'To review', tone: 'pending' }, title: unitTitle(r), href: unit, due: r.due_date,
        context: `${r.assessor_name ? `Submitted by ${r.assessor_name}` : 'Submitted'}${step}`,
        action: { label: 'Review', href: unit },
      };
    }
    case 'finding':
      return {
        key: r.key, kind: { label: 'Finding', tone: 'warning' }, title: r.title || 'Finding', href: `/erm/rcsa/findings?open=${r.finding_id}`, due: r.due_date,
        context: [r.severity ? `${r.severity[0].toUpperCase()}${r.severity.slice(1)} severity` : '', r.campaign_name].filter(Boolean).join(' · '),
        action: { label: 'Open', href: `/erm/rcsa/findings?open=${r.finding_id}` },
      };
    default: {
      const started = r.status === 'in_progress';
      return {
        key: r.key, kind: { label: 'To complete', tone: 'progress' }, title: unitTitle(r), href: unit, due: r.due_date,
        context: started ? `${r.progress ?? 0}% of the required questions answered` : 'Not started',
        action: { label: started ? 'Continue' : 'Start', href: unit },
      };
    }
  }
}

/** The sentence under the title when the person has nothing to do. */
export function allClear(work: MyWork): string {
  if (work.roles.manage) return 'Nothing is waiting for you. Campaigns you run are below.';
  return work.roles.assess || work.roles.review ? 'You are all caught up. New units, reviews and findings appear here.' : 'Nothing is assigned to you in RCSA yet.';
}
