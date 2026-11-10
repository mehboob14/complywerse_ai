// The Issue Register's Queues, apart from React (`queuesModel.test.ts`): the three lists a person works through, each with its number. They are built from rows the page already holds
// (the register, read whole) and the extension requests, so the tab's badge, the section counts and the lists can never disagree.
//   Validation   findings the owner submitted, waiting for Audit Services (longest waiting first)
//   Extensions   requests the Audit Committee has not decided (oldest first), then approved ones whose regulator still has to be told
//   Owner names  names the workbook gave that match no person (the most findings first): one pick each maps them
import { daysSince, hasOwnerToMap, isAwaiting, referenceOf, type RegisterRow } from './registerDef.ts';

export interface ExtensionLine {
  id: number;
  issue_id: number;
  status: string;
  reference: string | null;
  title: string | null;
  source: string | null;
  previous_date: string | null;
  requested_date: string;
  reason: string;
  decision_notes: string | null;
  decided_on: string | null;
  regulator_notified_on: string | null;
  needs_regulator_notice: boolean;
  requested_by: string | null;
  created_at: string | null;
  meeting: { id: number; title: string; scheduled_date: string | null } | null;
}

export interface ValidationItem { row: RegisterRow; waitedDays: number | null }
/** The findings waiting for Audit Services, the longest waiting first (a finding with no known date after those that have one, by number). */
export function validationQueue(rows: readonly RegisterRow[], today: Date): ValidationItem[] {
  return rows.filter(isAwaiting)
    .map((row) => ({ row, waitedDays: daysSince(row.waiting_since, today) }))
    .sort((a, b) => (b.waitedDays ?? -1) - (a.waitedDays ?? -1) || String(referenceOf(a.row) ?? '').localeCompare(String(referenceOf(b.row) ?? ''), 'en', { numeric: true }) || a.row.issue_id - b.row.issue_id);
}

export interface ExtensionQueue {
  /** waiting for the committee, oldest request first */
  waiting: ExtensionLine[];
  /** approved on a regulator's finding and the regulator has not been told yet */
  toNotify: ExtensionLine[];
  /** decided, newest first (what the old Extensions view listed besides the open ones) */
  decided: ExtensionLine[];
}
const stamp = (x: ExtensionLine): string => x.created_at || '';
export function extensionQueue(lines: readonly ExtensionLine[]): ExtensionQueue {
  const waiting = lines.filter((x) => x.status === 'requested').sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.id - b.id);
  const toNotify = lines.filter((x) => x.needs_regulator_notice).sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.id - b.id);
  const decided = lines.filter((x) => x.status !== 'requested' && !x.needs_regulator_notice).sort((a, b) => stamp(b).localeCompare(stamp(a)) || b.id - a.id);
  return { waiting, toNotify, decided };
}

export interface OwnerToMap { name: string; findings: number }
/** The owner names the workbook gave that match no person, with how many findings each holds (the most first, then A to Z). Findings that were deleted are not in the list the server sends. */
export function ownersToMap(rows: readonly RegisterRow[]): OwnerToMap[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => { if (hasOwnerToMap(r)) { const name = (r.owner as string).trim(); counts.set(name, (counts.get(name) ?? 0) + 1); } });
  return Array.from(counts.entries()).map(([name, findings]) => ({ name, findings })).sort((a, b) => b.findings - a.findings || a.name.localeCompare(b.name));
}

export interface QueueCounts { validation: number; extensions: number; owners: number; total: number }
/** What the Queues tab's badge adds up: findings to validate + requests the committee has not decided + names to map. */
export function queueCounts(rows: readonly RegisterRow[], extensions?: readonly ExtensionLine[]): QueueCounts {
  const validation = rows.filter(isAwaiting).length;
  // before the requests are read, the rows' own flag says how many findings have one waiting
  const extensionsWaiting = extensions ? extensions.filter((x) => x.status === 'requested').length : rows.filter((r) => r.extension_requested === true && r.status !== 'CD').length;
  const owners = ownersToMap(rows).length;
  return { validation, extensions: extensionsWaiting, owners, total: validation + extensionsWaiting + owners };
}

/** "waiting 4 days" or "submitted today"; null (nothing said) when the server has no date for it. */
export function waitedWords(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return 'submitted today';
  return `waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}
