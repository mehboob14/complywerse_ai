// What the document cards of the Summary draw, without React (_summary.test.ts): the bars of the status, the slices of the types and of the review dates, the three
// request bars and the severity of the "Needs attention" tile. Every figure is the server's (GET /governance/document-overview, scoped to the department the person
// picked); a figure the library can list opens the library on it (the server gives its address, _model.ts figureHref). Nothing here counts a document twice: a
// measure is drawn once on the Summary (sections.ts lists what each card shows, and its test keeps the list honest).
import { foldTail, type Slice } from '../../../../../components/overview/charts/chartModel.ts';
import { STATUS } from '../../../../../components/overview/charts/palette.ts';
import { OTHER_STATUS_COLOR, STATUS_COLOR, TYPE_COLORS } from './_chart.ts';
import { figureHref, flow, issueRows, lapsed, requestRows, reviewRows, type Overview, type RequestKind, type Tone } from './_model.ts';

export interface StatusBarRow { key: string; label: string; value: number; color: string; href?: string }

/** The five steps of the approval flow (a step nobody is at says 0) and then the states outside it that some document is in (expired, an exception applied, a review required). */
export function statusBarRows(d: Pick<Overview, 'by_status' | 'links'>): StatusBarRow[] {
  return [...flow(d), ...lapsed(d).filter((s) => s.count > 0)].map((s) => ({
    key: s.status, label: s.label, value: s.count, color: STATUS_COLOR[s.status] ?? OTHER_STATUS_COLOR, ...(s.href ? { href: s.href } : {}),
  }));
}

/** The kinds of document as the slices of a donut: the five biggest, the rest folded into Other; a kind opens the library on it. */
export const typeSlices = (d: Pick<Overview, 'by_type' | 'links'>): Slice[] =>
  foldTail(d.by_type.filter((t) => t.count > 0).map((t, i) => ({ key: t.key, label: t.label, value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length], ...(figureHref(d, t.key) ? { href: figureHref(d, t.key) as string } : {}) })), 5);

const REVIEW_COLOR: Record<string, string> = { overdue: STATUS.bad, due_soon: STATUS.warn, unscheduled: STATUS.neutral, up_to_date: STATUS.good };

/** Where the next review date of each published or approved document stands, as slices in status colours (a state is never a categorical hue). */
export const reviewSlices = (d: Pick<Overview, 'reviews' | 'links'>): Slice[] =>
  reviewRows(d).map((r) => ({ key: r.key, label: r.label, value: r.count, color: REVIEW_COLOR[r.key], ...(r.href ? { href: r.href } : {}) }));

export interface RequestBar { kind: RequestKind; label: string; pending: number; parts: Slice[] }

/** One bar for each kind of request: the ones late, the ones due within 7 days and the rest (one for each person asked, so a number can be larger than the documents it opens). */
export function requestBars(d: Pick<Overview, 'requests' | 'links'>): RequestBar[] {
  return requestRows(d).map((r) => ({
    kind: r.kind, label: r.label, pending: r.pending,
    parts: [
      { key: 'overdue', label: 'Overdue', value: r.overdue, color: STATUS.bad, ...(r.overdueHref ? { href: r.overdueHref } : {}) },
      { key: 'soon', label: 'Due in 7 days', value: r.dueSoon, color: STATUS.warn },
      { key: 'later', label: 'Later', value: Math.max(0, r.pending - r.overdue - r.dueSoon), color: STATUS.pending, ...(r.pendingHref ? { href: r.pendingHref } : {}) },
    ],
  }));
}

/** Nobody has been asked anything in this scope. */
export const noRequests = (bars: readonly RequestBar[]): boolean => bars.every((b) => b.pending === 0);

const TONE_COLOR: Partial<Record<Tone, string>> = { danger: STATUS.bad, warning: STATUS.warn };

/** The severity under the "Needs attention" tile: how much of what is wrong is urgent (stuck, late, expired) and how much is to follow up (on hold, no owner, an exception).
 *  The kinds are counted as the Issues list counts them (a document can be in several), so the bar is shares, and the figure above it is the documents counted once. */
export function severity(d: Pick<Overview, 'issues' | 'links'>): { documents: number; parts: Slice[] } {
  const rows = issueRows(d);
  const sumOf = (tone: Tone) => rows.filter((r) => r.tone === tone).reduce((n, r) => n + r.count, 0);
  return {
    documents: d.issues.documents,
    parts: [
      { key: 'urgent', label: 'Urgent', value: sumOf('danger'), color: TONE_COLOR.danger as string },
      { key: 'follow', label: 'To follow up', value: sumOf('warning'), color: TONE_COLOR.warning as string },
    ],
  };
}
