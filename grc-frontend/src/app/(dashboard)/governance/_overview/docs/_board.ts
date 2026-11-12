// The Board of the Governance Overview as data, without React (_board.test.ts): what the server answers (GET /governance/document-overview/board, documents_overview.py
// `board`), the words of a card's flags, and where a column, a card and "show all" open. The board is read-only: a card opens the document in the library's drawer.
import { formatCount } from '../../../../../lib/format.ts';
import { documentStatus, type Tone as PillTone } from '../../../../../lib/status.ts';
import { libraryHref, openHref, type Scope, type Tone } from './_model.ts';
import { viewHref, type GroupId } from './_views.ts';

export interface BoardCard {
  id: number;
  title: string;
  code: string | null;
  doc_type: string;
  type_label: string;
  status: string;
  version: string | null;
  department_id: number | null;
  department: string | null;
  owner: string | null;
  next_review: string | null;
  /** what is wrong with it, worst first: stuck, on_hold, late_approvals, late_acknowledgements, no_owner, overdue_review */
  flags: string[];
  /** where the attestation (the request to acknowledge) stands; absent from an older server, and then the card says nothing about it */
  attestation?: Attestation | null;
}

/** none: no attestation was requested for the document; not_started: requested, nobody has acknowledged; in_progress: some have (`done` of `total`); complete: everyone has. */
export type AttestationState = 'none' | 'not_started' | 'in_progress' | 'complete';
export interface Attestation { state: AttestationState; done: number | null; total: number | null }

export interface BoardColumn {
  key: string;
  label: string;
  /** the status, the type, or the department's `?dept=` value */
  value: string;
  /** the true number of documents in the column; `cards` are the most urgent ones, `more` is how many are not listed */
  count: number;
  cards: BoardCard[];
  more: number;
  /** the last column of the status grouping, "Needs attention" (value `attention`): the statuses it holds (expired, an exception applied, a review required ...); each card's own `status` says which */
  statuses?: string[];
  /** by department: the department, and whether the column is what is filed in the scope's own department itself */
  department_id?: number | null;
  own?: boolean;
}

export interface BoardAnswer { scope: Scope; group: GroupId; per: number; as_of: string; total: number; columns: BoardColumn[] }

export const BOARD_ENDPOINT = '/governance/document-overview/board';
export const EXPORT_ENDPOINT = '/governance/document-overview/export';
/** Cards a column lists on the Board. */
export const CARDS_BOARD = 12;

/** The request parameters of a board: the scope ("" asks for the server's own default), the grouping and how many cards a column lists. */
export const boardParams = (dept: string, group: GroupId, per: number): Record<string, string | number> => ({ ...(dept.trim() ? { department_id: dept.trim() } : {}), group, per });

export interface FlagWord { label: string; tone: Tone }
export const FLAGS: Readonly<Record<string, FlagWord>> = {
  stuck: { label: 'Stuck', tone: 'danger' },
  on_hold: { label: 'On hold', tone: 'warning' },
  late_approvals: { label: 'Late approval', tone: 'danger' },
  late_acknowledgements: { label: 'Late acknowledgement', tone: 'warning' },
  no_owner: { label: 'No owner', tone: 'warning' },
  overdue_review: { label: 'Review overdue', tone: 'danger' },
};

/** A card's flags as words, in the server's order; a flag this page does not know is said as it is, never dropped. */
export const flagWords = (card: Pick<BoardCard, 'flags'>): Array<FlagWord & { key: string }> =>
  card.flags.map((key) => ({ key, ...(FLAGS[key] ?? { label: key.replace(/_/g, ' '), tone: 'default' as Tone }) }));

/** The value of the status grouping's last column: documents that are in none of the five steps and not archived. */
export const ATTENTION_VALUE = 'attention';
/** The column that holds the documents outside the flow. */
export const isAttention = (col: Pick<BoardColumn, 'value'>, group: GroupId): boolean => group === 'status' && col.value === ATTENTION_VALUE;

/** The title of a column: a status in the interface's own words, anything else (a type, a department, "Needs attention") as the server named it. */
export const columnTitle = (col: Pick<BoardColumn, 'label' | 'value'>, group: GroupId): string => (group === 'status' && col.value !== ATTENTION_VALUE ? documentStatus.label(col.value) : col.label);

/** The library on what a column holds (everything of that status or type in the scope); by department, the department's own board, and none for the scope's own documents
 *  (the library would add the departments under it). A document with no type has no address. */
export function columnHref(answer: Pick<BoardAnswer, 'scope' | 'group'>, col: Pick<BoardColumn, 'value' | 'own' | 'statuses'>): string | null {
  const dept = answer.scope.value;
  if (answer.group === 'status') {
    // "Needs attention" opens the statuses it holds (the library takes a list); one that holds none opens nothing
    if (col.value === ATTENTION_VALUE) return col.statuses && col.statuses.length > 0 ? libraryHref({ ...(dept ? { dept } : {}), status: col.statuses.join(',') }) : null;
    return libraryHref({ ...(dept ? { dept } : {}), status: col.value });
  }
  if (answer.group === 'type') return col.value ? libraryHref({ ...(dept ? { dept } : {}), type: col.value }) : null;
  return col.own ? null : viewHref(col.value, 'board', 'status');
}

/** "Show all N": the library on the whole column, where the library can say it; by department, the library on that department and everything under it. */
export function showAllHref(answer: Pick<BoardAnswer, 'scope' | 'group'>, col: Pick<BoardColumn, 'value' | 'own' | 'statuses'>): string | null {
  if (answer.group === 'department') return col.own ? null : libraryHref({ dept: col.value });
  return columnHref(answer, col);
}

/** A card opens its document in the library's drawer. */
export const cardHref = (card: Pick<BoardCard, 'id'>): string => openHref(card.id);

/** The words under a card's flags that say where its attestation stands, and the tone they take: "No attestation" (neutral), "Attestation not started" (warning),
 *  "Attestation: 4 of 12 acknowledged" (progress), "Everyone acknowledged" (success). Null when the server did not say (an older one) or said something this page does
 *  not know: a card never carries a line that might be wrong. */
export function attestationLine(card: Pick<BoardCard, 'attestation'>): { label: string; tone: PillTone } | null {
  const a = card.attestation;
  if (!a || typeof a !== 'object') return null;
  switch (a.state) {
    case 'none': return { label: 'No attestation', tone: 'neutral' };
    case 'not_started': return { label: 'Attestation not started', tone: 'warning' };
    case 'complete': return { label: 'Everyone acknowledged', tone: 'success' };
    case 'in_progress': {
      const ok = Number.isFinite(a.done) && Number.isFinite(a.total) && (a.total as number) > 0;
      return { label: ok ? `Attestation: ${formatCount(a.done as number)} of ${formatCount(a.total as number)} acknowledged` : 'Attestation started', tone: 'progress' };
    }
    default: return null;
  }
}

/** The line under a card's title: its kind, version and department ("Policy · v2.0 · Support"), without what its column already says. */
export const cardMeta = (card: Pick<BoardCard, 'type_label' | 'version' | 'department'>, group?: GroupId): string =>
  [group !== 'type' && card.type_label && card.type_label !== '—' ? card.type_label : '', card.version ? `v${card.version}` : '', group !== 'department' ? card.department ?? '' : ''].filter(Boolean).join(' · ');

/** "3 documents · 2 with something wrong" for a column's screen-reader name and its tooltip. */
export const columnNote = (col: Pick<BoardColumn, 'count' | 'cards' | 'more'>): string => {
  const flagged = col.cards.filter((c) => c.flags.length > 0).length;
  return `${col.count} ${col.count === 1 ? 'document' : 'documents'}${flagged ? `, ${flagged}${col.more > 0 ? ' or more' : ''} with something wrong` : ''}`;
};
