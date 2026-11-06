// What the Findings register works out from its address and its rows: the scope switch and the filters the address names (and the
// address a change makes), the query the server is asked, and what a row says (due countdown, who, where it came from). Pure, so
// `node --test` runs findingsModel.test.ts against it. Names in the address: scope (without it: open), severity, domain,
// overdue, page. The fields Verity's register adds (owner, blocking, source, accepted until) come from the findings register
// endpoint's additive keys (contract C6); a server that does not send them yet gives a row with "—", not a broken page.

import { fmt } from '../_ui/fmt.ts';
import type { ParamPatch } from '../_ui/urlParams.ts';
import { DOMAIN_KEYS } from './tprmShared.ts';

export const PAGE_SIZE = 25;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export type Scope = 'open' | 'accepted' | 'closed' | 'all';
export const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export const asScope = (value: string | null | undefined): Scope => (SCOPES.some((s) => s.value === value) ? (value as Scope) : 'open');

export interface Filters { scope: Scope; severity: string | null; domain: string | null; overdue: boolean; page: number }

interface Reader { get(key: string): string | null }

export function readFilters(p: Reader): Filters {
  const severity = (p.get('severity') ?? '').trim().toLowerCase();
  const domain = (p.get('domain') ?? '').trim();
  const page = Number.parseInt(p.get('page') ?? '', 10);
  return {
    scope: asScope(p.get('scope')),
    severity: (SEVERITIES as readonly string[]).includes(severity) ? severity : null,
    domain: DOMAIN_KEYS.includes(domain) ? domain : null,
    overdue: p.get('overdue') === '1',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** A change of scope or filter writes the address and returns to page 1; Open is the default, so it is not written. */
export function filterPatch(change: Partial<Omit<Filters, 'page'>>): ParamPatch {
  const out: ParamPatch = { page: null };
  if ('scope' in change) out.scope = change.scope && change.scope !== 'open' ? change.scope : null;
  if ('severity' in change) out.severity = change.severity || null;
  if ('domain' in change) out.domain = change.domain || null;
  if ('overdue' in change) out.overdue = change.overdue ? '1' : null;
  return out;
}

/** "Clear filters": the three filters and the page; the scope is a view, it stays. */
export const CLEAR_FILTERS: ParamPatch = filterPatch({ severity: null, domain: null, overdue: false });

export const hasFilters = (f: Filters): boolean => !!(f.severity || f.domain || f.overdue);

export function listParams(f: Filters): Record<string, string | number | boolean | undefined> {
  return {
    scope: f.scope,
    severity: f.severity ?? undefined,
    domain: f.domain ?? undefined,
    overdue_only: f.overdue ? true : undefined,
    skip: (f.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
}

export const isOpen = (status?: string | null): boolean => status === 'open' || status === 'in_remediation';

/** "3 findings blocking approval"; null when none do (or the server does not say). */
export function blockingLine(total?: number | null): string | null {
  return typeof total === 'number' && total > 0 ? `${total.toLocaleString('en-US')} ${total === 1 ? 'finding' : 'findings'} blocking approval` : null;
}

export interface DueView { text: string; title: string; late: boolean }

/** The remediation due cell: a countdown ("in 9 days", "12 days ago"), the date on hover, and red only while the finding is
 *  still open and late (the server's overdue flag, else the date itself). */
export function dueView(f: { due_date?: string | null; status: string; overdue?: boolean }, today: Date = new Date()): DueView {
  if (!f.due_date) return { text: '—', title: '', late: false };
  const text = fmt.countdown(f.due_date, today);
  const past = text.endsWith(' ago');
  return { text, title: fmt.date(f.due_date), late: isOpen(f.status) && (typeof f.overdue === 'boolean' ? f.overdue : past) };
}

/** "until 5 Mar 2026" under an accepted finding's status. */
export const acceptedLine = (f: { status: string; accepted_until?: string | null }): string | null =>
  f.status === 'accepted' && f.accepted_until ? `until ${fmt.date(f.accepted_until)}` : null;

const SOURCES: Record<string, string> = {
  assessment: 'Assessment', manual: 'Manual', sla_breach: 'SLA breach', signal: 'Signal', document_review: 'Document review', offboarding: 'Offboarding',
};
export const sourceLabel = (source?: string | null): string | null => (source ? SOURCES[source] ?? fmt.status(source) : null);

export const rowHref = (f: { vendor_id: number; id: number }): string => `/vendor-risk/vendors/${f.vendor_id}?tab=findings&finding=${f.id}`;
export const vendorHref = (f: { vendor_id: number }): string => `/vendor-risk/vendors/${f.vendor_id}?tab=findings`;

/** What an empty list says: nothing at all in this view, or nothing matching the filters. */
export function emptyCopy(scope: Scope, filtered: boolean): { title: string; hint: string } {
  if (filtered) return { title: 'No findings match these filters', hint: 'Adjust or clear the filters.' };
  if (scope === 'open') return { title: 'No open findings', hint: 'Raised from questionnaire scoring and document reviews.' };
  return { title: 'Nothing in this state', hint: 'Try another view.' };
}
