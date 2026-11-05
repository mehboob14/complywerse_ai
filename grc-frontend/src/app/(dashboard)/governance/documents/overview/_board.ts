// The Board of At a glance as data, without React (_board.test.ts): what the server answers (GET /governance/document-overview/board, documents_overview.py
// `board`), the words of a card's flags, and where a column, a card and "show all" open. The board is read-only: a card opens the document in the library's drawer.
import { documentStatus } from '../../../../../lib/status.ts';
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
}

export interface BoardColumn {
  key: string;
  label: string;
  /** the status, the type, or the department's `?dept=` value */
  value: string;
  /** the true number of documents in the column; `cards` are the most urgent ones, `more` is how many are not listed */
  count: number;
  cards: BoardCard[];
  more: number;
  /** by department: the department, and whether the column is what is filed in the scope's own department itself */
  department_id?: number | null;
  own?: boolean;
}

export interface BoardAnswer { scope: Scope; group: GroupId; per: number; as_of: string; total: number; columns: BoardColumn[] }

export const BOARD_ENDPOINT = '/governance/document-overview/board';
export const EXPORT_ENDPOINT = '/governance/document-overview/export';
/** Cards a column lists on the Summary's strip, and on the Board. */
export const CARDS_SUMMARY = 3;
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

/** The title of a column: a status in the interface's own words, anything else as the server named it. */
export const columnTitle = (col: Pick<BoardColumn, 'label' | 'value'>, group: GroupId): string => (group === 'status' ? documentStatus.label(col.value) : col.label);

/** The library on what a column holds (everything of that status or type in the scope); by department, the department's own board, and none for the scope's own documents
 *  (the library would add the departments under it). A document with no type has no address. */
export function columnHref(answer: Pick<BoardAnswer, 'scope' | 'group'>, col: Pick<BoardColumn, 'value' | 'own'>): string | null {
  const dept = answer.scope.value;
  if (answer.group === 'status') return libraryHref({ ...(dept ? { dept } : {}), status: col.value });
  if (answer.group === 'type') return col.value ? libraryHref({ ...(dept ? { dept } : {}), type: col.value }) : null;
  return col.own ? null : viewHref(col.value, 'board', 'status');
}

/** "Show all N": the library on the whole column, where the library can say it; by department, the library on that department and everything under it. */
export function showAllHref(answer: Pick<BoardAnswer, 'scope' | 'group'>, col: Pick<BoardColumn, 'value' | 'own'>): string | null {
  if (answer.group === 'department') return col.own ? null : libraryHref({ dept: col.value });
  return columnHref(answer, col);
}

/** A card opens its document in the library's drawer. */
export const cardHref = (card: Pick<BoardCard, 'id'>): string => openHref(card.id);

/** The line under a card's title: its kind, version and department ("Policy · v2.0 · Support"), without what its column already says. */
export const cardMeta = (card: Pick<BoardCard, 'type_label' | 'version' | 'department'>, group?: GroupId): string =>
  [group !== 'type' && card.type_label && card.type_label !== '—' ? card.type_label : '', card.version ? `v${card.version}` : '', group !== 'department' ? card.department ?? '' : ''].filter(Boolean).join(' · ');

/** "3 documents · 2 with something wrong" for a column's screen-reader name and its tooltip. */
export const columnNote = (col: Pick<BoardColumn, 'count' | 'cards' | 'more'>): string => {
  const flagged = col.cards.filter((c) => c.flags.length > 0).length;
  return `${col.count} ${col.count === 1 ? 'document' : 'documents'}${flagged ? `, ${flagged}${col.more > 0 ? ' or more' : ''} with something wrong` : ''}`;
};
