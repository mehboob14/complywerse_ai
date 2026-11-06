// The Board view of the library: the documents that match, in columns by where they stand in the life cycle. Read-only: a status changes only through the workflow, so there is no
// drag and a card is something to open. Pure (no React), so `node --test` checks it (libraryBoard.test.ts).
import { groupBoard, type BoardColumn, type BoardColumnDef } from '../../../../../components/records/explorerModel.ts';
import { STAGE_ORDER, statusLabel } from './libraryModel.ts';

export interface DocBoardColumn { id: string; label: string; statuses: string[] }

const STEPS: DocBoardColumn[] = [
  { id: 'draft', label: 'Draft', statuses: ['draft'] },
  { id: 'review', label: 'In review', statuses: ['pending_review'] },
  { id: 'approval', label: 'In approval', statuses: ['pending_approval'] },
  { id: 'approved', label: 'Approved', statuses: ['approved'] },
  { id: 'published', label: 'Published', statuses: ['published'] },
];
const STEP_STATUSES: readonly string[] = STAGE_ORDER;

/** The columns: the five steps of the life cycle, then "Needs attention" for everything else that is not archived (expired, an exception applied, a review required, and any
 *  status the library does not know), so every document that matches is in one column and the counts add up. The Archived list has the one column it is. */
export function boardColumns(archivedList: boolean, otherStatuses: readonly string[] = []): DocBoardColumn[] {
  if (archivedList) return [{ id: 'archived', label: 'Archived', statuses: ['archived'] }];
  const attention = Array.from(new Set(['expired', 'exception_applied', 'review_required', ...otherStatuses.filter((s) => !STEP_STATUSES.includes(s) && s !== 'archived')]));
  return [...STEPS, { id: 'attention', label: 'Needs attention', statuses: attention }];
}

export function groupDocuments<D extends { status: string }>(docs: readonly D[], archivedList: boolean): BoardColumn<D>[] {
  const columns = boardColumns(archivedList);
  const last = columns.length - 1;
  const defs: BoardColumnDef<D>[] = columns.map((c, i) => ({
    id: c.id,
    label: c.label,
    test: i === last && !archivedList ? (d) => !STEP_STATUSES.includes(d.status) && d.status !== 'archived' : (d) => c.statuses.includes(d.status),
  }));
  return groupBoard(docs, defs);
}

/** The Status filter "Show all" on a column sets: the statuses the column holds (the ones documents are really in, for "Needs attention"). */
export function statusesOfColumn(column: string, docs: readonly { status: string }[]): string[] {
  if (column === 'archived') return ['archived'];
  const step = STEPS.find((c) => c.id === column);
  if (step) return step.statuses.slice();
  const present = new Set(docs.map((d) => d.status));
  return Array.from(present).filter((s) => !STEP_STATUSES.includes(s) && s !== 'archived').sort();
}

export const columnTitle = (statuses: readonly string[]): string => statuses.map(statusLabel).join(', ');
