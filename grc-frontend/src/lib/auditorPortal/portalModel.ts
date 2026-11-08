// The Auditor Portal's pages, apart from React so `node --test src/lib/auditorPortal/portalModel.test.ts` can pin them: what the front door counts and in
// what order it lists the journeys, where each count and each row opens, the state of the journey page kept in its address (and the three old tab names that
// still arrive from bookmarks), the chips of the queue, the figures of the Summary, and the links into the Frameworks workspace (the queue never copies its tabs).
// The payloads are the server's: GET /auditor-portal/work and GET /auditor-portal/{id}/review-queue (backend/grc/modules/auditor_portal/routers).
import { oneOf, integer, text } from '../addressState.ts';
import { journeyNumbers, pct, readinessBand, type JourneyNumbers, type JourneyProgressPayload, type ReadinessBand } from '../journeyModel.ts';
import { formatCount } from '../format.ts';

// ── the payloads ─────────────────────────────────────────────────────────────

export interface FileCounts { pending: number; approved: number; rejected: number; total: number }
export interface ScopeCounts { pending: number; approved: number; rejected: number; total: number }

export interface JourneyCard {
  id: number;
  name: string;
  status: string | null;
  framework: string | null;
  version: string | null;
  files: FileCounts;
  scope: ScopeCounts;
  controls_total: number;
  no_request: number;
}

export interface WorkRowPayload {
  kind: 'file' | 'scope';
  id: number;
  journey_id: number;
  journey: string | null;
  title: string | null;
  context: string | null;
  since: string | null;
  by: string | null;
}

export interface WorkPayload {
  counters: { files_to_review: number; scope_to_decide: number };
  journeys: JourneyCard[];
  journeys_total: number;
  rows: WorkRowPayload[];
  rows_total: number;
}

export interface QueueCounts {
  files: FileCounts;
  scope: ScopeCounts & { in_scope: number; out_of_scope: number };
  untouched: number;
  untouched_manual: number;
  decided: number;
}

export interface QueueControl { id: number; implementation_id: number | null; ref: string | null; title: string | null; requirement: string | null; is_critical: boolean }

export interface FileItem {
  type: 'file'; id: number; file_name: string | null; file_size: number | null; mime_type: string | null; status: string; uploaded_at: string | null;
  uploaded_by: string | null; library_evidence_id: number | null; ai_confidence: number | null; ai_notes: string | null;
  reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null; control: QueueControl | null;
}
export interface ScopeItem {
  type: 'scope'; id: number; status: string; is_applicable: boolean; justification: string | null; requested_by: string | null; requested_at: string | null;
  reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null; control: QueueControl | null;
}
export interface UntouchedItem { type: 'untouched'; id: number; can_auto_approve: boolean; control: QueueControl }
export type QueueItem = FileItem | ScopeItem | UntouchedItem;

export interface QueuePayload {
  framework: { id: number; name: string; version: string | null };
  journey: { id: number; name: string; status: string | null } | null;
  counts: QueueCounts;
  kind: 'files' | 'scope' | 'untouched' | 'decided';
  status: string | null;
  q: string | null;
  skip: number;
  limit: number;
  total: number;
  items: QueueItem[];
}

// ── the front door ───────────────────────────────────────────────────────────

/** What waits on a journey: files nobody has decided plus scope requests nobody has decided. */
export const waitingOf = (card: Pick<JourneyCard, 'files' | 'scope'>): number => card.files.pending + card.scope.pending;

const active = (status: string | null | undefined): boolean => !['completed', 'cancelled'].includes(String(status ?? '').trim().toLowerCase());

/** The journeys with the most waiting first, then the ones still running before the finished, then by name: the person's day starts at the top. */
export function orderJourneys(cards: readonly JourneyCard[]): JourneyCard[] {
  return cards.slice().sort((a, b) =>
    waitingOf(b) - waitingOf(a) || Number(active(b.status)) - Number(active(a.status)) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id);
}

/** The journeys whose name or framework holds the search (case and spacing ignored). */
export function matchJourneys(cards: readonly JourneyCard[], term: string): JourneyCard[] {
  const wanted = term.trim().toLowerCase();
  if (!wanted) return cards.slice();
  return cards.filter((c) => `${c.name} ${c.framework ?? ''}`.toLowerCase().includes(wanted));
}

/** How much of a journey's files has been decided, as a whole percent; null when it has no files (nothing to decide is not 0%). */
export function decidedShare(card: Pick<JourneyCard, 'files'>): number | null {
  const { approved, rejected, total } = card.files;
  return total > 0 ? Math.round(((approved + rejected) / total) * 100) : null;
}

export type QueueKind = 'files' | 'scope' | 'untouched';
export type PortalTab = 'queue' | 'decisions' | 'summary';

/** The journey page, optionally at a tab, a list and an open row. */
export function journeyHref(id: number, to: { tab?: PortalTab; kind?: QueueKind; open?: string } = {}): string {
  const query = new URLSearchParams();
  if (to.tab && to.tab !== 'queue') query.set('tab', to.tab);
  if (to.kind && to.kind !== 'files') query.set('kind', to.kind);
  if (to.open) query.set('open', to.open);
  const s = query.toString();
  return `/auditor-portal/${id}${s ? `?${s}` : ''}`;
}

/** Where a count opens: the queue of the one journey that has such work waiting, else the list of journeys below the counts (an anchor). */
export function counterTarget(kind: 'files' | 'scope', cards: readonly JourneyCard[]): string {
  const holders = cards.filter((c) => (kind === 'files' ? c.files.pending : c.scope.pending) > 0);
  return holders.length === 1 ? journeyHref(holders[0].id, { kind: kind === 'files' ? 'files' : 'scope' }) : '#journeys';
}

/** Where a row of "Do now" opens: its journey's queue, at the list it belongs to, with the item's sheet open. */
export const rowHref = (row: Pick<WorkRowPayload, 'journey_id' | 'kind' | 'id'>): string =>
  journeyHref(row.journey_id, { kind: row.kind === 'file' ? 'files' : 'scope', open: openKey(row.kind, row.id) });

// ── the observations counter ─────────────────────────────────────────────────

export interface ObservationMeta { counts_by_status?: Record<string, number> | null; status_levels?: Array<{ key: string; terminal?: boolean }> | null }

/** Observations whose status is not a final one in the tenant's own Statutory Audit settings (closed and cancelled by default); null when the answer carries no counts. */
export function openObservations(meta: ObservationMeta | null | undefined): number | null {
  const counts = meta?.counts_by_status;
  if (!counts || typeof counts !== 'object') return null;
  const final: Record<string, true> = {};
  (meta?.status_levels ?? []).forEach((l) => { if (l.terminal) final[l.key] = true; });
  return Object.keys(counts).reduce((sum, key) => (final[key] ? sum : sum + (Number(counts[key]) || 0)), 0);
}

// ── the journey page's address ───────────────────────────────────────────────

export const TABS: readonly PortalTab[] = ['queue', 'decisions', 'summary'];
export const KINDS: readonly QueueKind[] = ['files', 'scope', 'untouched'];
export const RESULTS = ['all', 'approved', 'rejected'] as const;
export type DecisionResult = (typeof RESULTS)[number];

/** The state of the journey page that lives in the address: ?tab= ?kind= ?q= ?result= ?page= ?open= . Defined once, outside any component. */
export const ADDRESS = {
  tab: oneOf(TABS, 'queue'),
  kind: oneOf(KINDS, 'files'),
  q: text(),
  result: oneOf(RESULTS, 'all'),
  page: integer(1, { min: 1 }),
  open: text(),
};

/** The three tabs the page had before (overview, controls, evidence) and where each lives now; null when the address needs no change. */
export function upgradeLegacyAddress(search: string): string | null {
  const query = new URLSearchParams(search);
  const tab = (query.get('tab') ?? '').trim().toLowerCase();
  const map: Record<string, { tab?: PortalTab; kind?: QueueKind }> = {
    overview: { tab: 'summary' }, controls: { tab: 'queue', kind: 'scope' }, evidence: { tab: 'queue', kind: 'files' },
  };
  if (!Object.prototype.hasOwnProperty.call(map, tab)) return null;
  const to = map[tab];
  query.delete('tab');
  if (to.tab && to.tab !== 'queue') query.set('tab', to.tab);
  if (to.kind && to.kind !== 'files' && !query.get('kind')) query.set('kind', to.kind);
  return query.toString();
}

/** The sheet that is open, as the address keeps it: "file-12", "scope-9", "untouched-4". */
export const openKey = (type: 'file' | 'scope' | 'untouched', id: number): string => `${type}-${id}`;

export function parseOpen(value: string | null | undefined): { type: 'file' | 'scope' | 'untouched'; id: number } | null {
  const m = /^(file|scope|untouched)-(\d{1,9})$/.exec((value ?? '').trim());
  return m ? { type: m[1] as 'file' | 'scope' | 'untouched', id: Number(m[2]) } : null;
}

// ── the queue ────────────────────────────────────────────────────────────────

export interface QueueChip { kind: QueueKind; label: string; count: number }

/** The three lists of the queue with their true counts: files to review, scope requests waiting, requirements nobody has asked about. */
export function queueChips(counts: QueueCounts | null | undefined): QueueChip[] {
  return [
    { kind: 'files', label: 'Files to review', count: counts?.files.pending ?? 0 },
    { kind: 'scope', label: 'Scope requests', count: counts?.scope.pending ?? 0 },
    { kind: 'untouched', label: 'No request yet', count: counts?.untouched ?? 0 },
  ];
}

/** What waits in the queue in total (the Queue tab's badge): files to review plus scope requests waiting. The requirements nobody asked about wait for no one. */
export const waitingTotal = (counts: QueueCounts | null | undefined): number => (counts ? counts.files.pending + counts.scope.pending : 0);

/** The sentence under a scope request: what it asks. The requirement stays as it is until a reviewer approves. */
export function scopeAsk(item: Pick<ScopeItem, 'is_applicable'>): string {
  return item.is_applicable ? 'Asks to put it in scope' : 'Asks to put it out of scope';
}

/** The requirement as one line: "A.8.2 Privileged access rights"; the title alone, the reference alone, or "A requirement" when neither is recorded. */
export function controlLine(control: Pick<QueueControl, 'ref' | 'title'> | null | undefined): string {
  const line = [control?.ref, control?.title].filter((x) => x && String(x).trim()).join(' ');
  return line || 'A requirement';
}

/** The size of a file in the units a person reads ("2.0 KB"); the dash when it is not recorded. */
export function fileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Page 2 of 5" arithmetic: the rows to skip for a page, and the last page for a total. */
export const skipFor = (page: number, size: number): number => Math.max(0, (Math.max(1, page) - 1) * size);
export const lastPage = (total: number, size: number): number => Math.max(1, Math.ceil(total / Math.max(1, size)));

// ── the Frameworks workspace: link, do not copy ─────────────────────────────

export type FrameworksTab = 'controls' | 'scope' | 'artifacts' | 'activity';

/** A tab of the journey's page in Frameworks (the journey id is the same id), optionally opened on one requirement (the journey's own row id for it). */
export function frameworksHref(journeyId: number, tab?: FrameworksTab, requirement?: number | null): string {
  const query = new URLSearchParams();
  if (tab) query.set('tab', tab);
  if (requirement) { query.set('tab', 'controls'); query.set('req', String(requirement)); }
  const s = query.toString();
  return `/frameworks/${journeyId}${s ? `?${s}` : ''}`;
}

// ── the Summary ──────────────────────────────────────────────────────────────

export interface SummaryFigures {
  /** the journey's own numbers (the Frameworks page reads the same), or null while the journey has not answered */
  journey: JourneyNumbers | null;
  band: ReadinessBand | null;
  /** approved files over all files, a whole percent; null with no files */
  filesApproved: number | null;
  filesTotal: number;
  /** requests decided over all requests; null with none */
  scopeDecided: number | null;
  scopeTotal: number;
  waiting: number;
  noRequest: number;
}

export function summaryFigures(counts: QueueCounts | null | undefined, progress: JourneyProgressPayload | null | undefined): SummaryFigures {
  const journey = journeyNumbers(progress);
  const files = counts?.files ?? { pending: 0, approved: 0, rejected: 0, total: 0 };
  const scope = counts?.scope ?? { pending: 0, approved: 0, rejected: 0, total: 0, in_scope: 0, out_of_scope: 0 };
  return {
    journey,
    band: journey ? readinessBand(journey.readyPct) : null,
    filesApproved: files.total > 0 ? Math.round(pct(files.approved, files.total)) : null,
    filesTotal: files.total,
    scopeDecided: scope.total > 0 ? Math.round(pct(scope.approved + scope.rejected, scope.total)) : null,
    scopeTotal: scope.total,
    waiting: files.pending + scope.pending,
    noRequest: counts?.untouched ?? 0,
  };
}

/** "12 files" / "1 file": a count with its noun, the count written the platform's way. */
export const noun = (n: number, one: string, other: string): string => `${formatCount(n)} ${n === 1 ? one : other}`;
