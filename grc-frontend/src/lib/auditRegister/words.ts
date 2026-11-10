// The sentences of the Issue Register that say what a request did or found, apart from React (`words.test.ts`): the check of an uploaded workbook, what an import created, what the reminders
// are about, what re-linking linked, how a date is sent. The server's numbers are said as they are; nothing here counts anything itself.
import { formatCount, formatDate } from '../format.ts';
import { findingSource } from '../statuses/auditRegister.ts';

export interface WorkbookPreview {
  file_name: string;
  as_of: string | null;
  rows: number;
  sheet_counts: Record<string, number>;
  by_source: Record<string, number>;
  unmatched_owners: Array<{ name: string; rows: number }>;
  warnings: string[];
}
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  unmatched_owners: string[];
  warnings: string[];
  as_of: string | null;
  linked?: Record<string, number>;
}

const plural = (n: number, one: string, other: string): string => `${formatCount(n)} ${n === 1 ? one : other}`;

/** "212 findings ready to import: 80 Regulator, 40 CFSB Audit-EY ..." */
export function readyLine(p: Pick<WorkbookPreview, 'rows' | 'by_source'>): string {
  const parts = Object.entries(p.by_source).filter(([, n]) => n > 0).map(([s, n]) => `${formatCount(n)} ${findingSource.label(s)}`);
  return `${plural(p.rows, 'finding is', 'findings are')} ready to import${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}

/** What the workbook's sheets hold: "Regulatory 80 · IA-EY Issue 40". */
export const sheetsLine = (sheets: Record<string, number>): string => Object.entries(sheets).map(([name, n]) => `${name.trim()} ${formatCount(n)}`).join(' · ');

/** The owners the workbook names that match nobody: said with the first few, and how many more. */
export function unmatchedLine(names: ReadonlyArray<string>, show = 4): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, show).join(', ');
  const more = names.length > show ? `, and ${formatCount(names.length - show)} more` : '';
  return `${plural(names.length, 'owner name matches', 'owner names match')} nobody and will be left unassigned: ${shown}${more}. You can map them afterwards under Queues.`;
}

/** "12 created, 3 updated, 1 skipped, as of 20 Sep 2026." */
export function resultLine(r: Pick<ImportResult, 'created' | 'updated' | 'skipped' | 'as_of'>): string {
  const parts = [`${formatCount(r.created)} created`, `${formatCount(r.updated)} updated`];
  if (r.skipped) parts.push(`${formatCount(r.skipped)} skipped`);
  return `${parts.join(', ')}${r.as_of ? `, as of ${formatDate(r.as_of, { calendar: true })}` : ''}.`;
}

/** What the import also added elsewhere: MRAs to Statutory Audit, self-identified events to Incidents. null when it added none. */
export function alsoAddedLine(linked: Record<string, number> | undefined): string | null {
  const observations = linked?.observations ?? 0;
  const incidents = linked?.incidents ?? 0;
  const parts = [
    observations ? `${plural(observations, 'MRA', 'MRAs')} to Statutory Audit` : '',
    incidents ? `${plural(incidents, 'self-identified event', 'self-identified events')} to Incidents` : '',
  ].filter(Boolean);
  return parts.length ? `Also added: ${parts.join(' and ')}.` : null;
}

/** The answer of Re-link: what it linked, or that there was nothing new. */
export function relinkLine(linked: Record<string, number> | undefined): string {
  const l = linked ?? {};
  const made = [
    l.assets ? plural(l.assets, 'asset', 'assets') : '',
    l.vulnerabilities ? plural(l.vulnerabilities, 'vulnerability', 'vulnerabilities') : '',
    l.vendors ? plural(l.vendors, 'vendor', 'vendors') : '',
    l.observations ? `${plural(l.observations, 'MRA', 'MRAs')} to Statutory Audit` : '',
    l.incidents ? `${plural(l.incidents, 'event', 'events')} to Incidents` : '',
    l.business_units ? plural(l.business_units, 'business unit link', 'business unit links') : '',
  ].filter(Boolean);
  return made.length ? `Linked ${made.join(', ')}.` : 'Nothing new to link.';
}

export interface ReminderItem { issue_id: number; reference: string | null; title: string; due: string | null; past_due: number; kind: string; waited?: number }
export interface ReminderPreview {
  due_soon: number; past_due: number; delayed: number; not_started: number; validation_waiting: number; owners: number; escalated: number; email: boolean; items: ReminderItem[];
}

/** Why one finding is on the list: "12 days past due". */
export function reminderReason(i: ReminderItem): string {
  switch (i.kind) {
    case 'past_due': return `${plural(i.past_due, 'day', 'days')} past due`;
    case 'delayed': return 'validation needs more from the owner';
    case 'not_started': return 'not started yet';
    case 'validation_waiting': return `waiting on validation for ${plural(i.waited ?? 0, 'day', 'days')}, told to Audit Services`;
    default: return i.due ? `due ${formatDate(i.due, { calendar: true })}` : 'coming due';
  }
}

/** "3 coming due, 2 past due"; "Nothing is due today" when there is none. */
export function reminderSummary(p: ReminderPreview): string {
  const parts = ([[p.due_soon, 'coming due'], [p.past_due, 'past due'], [p.delayed, 'delayed'], [p.not_started, 'not started'], [p.validation_waiting, 'waiting on validation']] as Array<[number, string]>)
    .filter(([n]) => n > 0).map(([n, label]) => `${formatCount(n)} ${label}`);
  return parts.length ? parts.join(', ') : 'Nothing is due today';
}

/** What a sent reminder did: "Reminded 4 owners about 9 findings; 1 escalated to Audit Services." */
export function remindedLine(p: ReminderPreview): string {
  const about = p.due_soon + p.past_due + p.delayed + p.not_started;
  return `Reminded ${plural(p.owners, 'owner', 'owners')} about ${plural(about, 'finding', 'findings')}`
    + (p.escalated ? `; ${formatCount(p.escalated)} escalated to Audit Services` : '')
    + (p.validation_waiting ? `; ${plural(p.validation_waiting, 'waiting validation', 'waiting validations')} flagged` : '') + '.';
}

/** Today as the YYYY-MM-DD the server takes for a date the person means as "today": the viewer's own day, never the UTC one (a late-evening click is not tomorrow). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A workbook name without its extension, for "Audit register: CFSB Template". */
export const workbookName = (file: string | null | undefined): string => String(file ?? '').replace(/\.(xlsb|xlsx|xlsm)$/i, '').trim();
