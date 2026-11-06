'use client';

/**
 * The items the explorer's table draws, made from the library's rules: the rows of a page of the tree (a document with the documents under it that are open), and the Folders view's
 * lines (a folder's header, its own documents, "Show N more", the folders inside it). The rules are the library's own (docTree.ts, libraryTableLogic.drawnRows, libraryFolders.planFolders);
 * this only turns them into RecordTable's items, with the caret's words, the folder's tick box and its ids.
 */
import { Checkbox } from '@/components/ui/ds';
import type { RecordItem, RecordRow } from '@/components/records/RecordTable';
import { tickState, toggleAll } from '@/components/records/explorerModel';
import { FolderHeadCard, FolderHeadRow, ShowMoreCard, ShowMoreRow } from './FolderRows';
import type { GovDoc } from './lib';
import {
  FIRST_SHOWN, folderIsOpen, matchedIds, planFolders, showMoreStep, shownLimit, type FoldView, type FolderNode, type PlanItem,
} from './libraryFolders';
import type { DrawnRow } from './libraryTableLogic';
import { STEP } from './Versions';

export const caretLabel = (doc: { title: string }, open: boolean, count: number): string =>
  `${open ? 'Hide' : 'Show'} the ${count} ${count === 1 ? 'document' : 'documents'} under ${doc.title}`;

/** The drawn rows of the tree (libraryTableLogic.drawnRows) as the table's rows. `lift`: levels to add (a folder's documents sit one level under it). */
export function recordRows(rows: readonly DrawnRow<GovDoc>[], lift: number, toggle: (id: number, open: boolean) => void): RecordRow<GovDoc>[] {
  return rows.map((r) => ({
    kind: 'row' as const,
    id: r.doc.id,
    record: r.doc,
    depth: r.depth + lift,
    context: !r.match,
    nested: r.childCount > 0 ? { count: r.childCount, open: r.open != null, label: caretLabel(r.doc, r.open != null, r.childCount), onToggle: () => toggle(r.doc.id, r.open != null) } : undefined,
  }));
}

/** A tick box with a target of its own that is not a click on the row behind it. */
function FolderTick({ label, state, onChange }: { label: string; state: ReturnType<typeof tickState>; onChange: () => void }) {
  return (
    <label data-no-peek className="-m-[8px] grid h-ds-control min-w-[var(--ds-control-h)] shrink-0 cursor-pointer place-items-center">
      <Checkbox aria-label={label} checked={state === 'all'} indeterminate={state === 'some'} onChange={onChange} />
    </label>
  );
}

export interface FolderItemsInput {
  folders: readonly FolderNode<GovDoc>[];
  view: FoldView;
  /** how many more than the first ones the person asked for in each folder */
  extra: Record<string, number>;
  /** the table's rows for the first `limit` top-level documents of a folder */
  rowsOf: (node: FolderNode<GovDoc>, limit: number) => DrawnRow<GovDoc>[];
  toggleRow: (id: number, open: boolean) => void;
  selected: ReadonlySet<number>;
  /** the folder's matching documents were ticked or unticked as a whole */
  onTick: (ids: number[]) => void;
  selectable: boolean;
  onFlip: (key: string) => void;
  onMore: (node: FolderNode<GovDoc>, step: number) => void;
  onFewer: (node: FolderNode<GovDoc>) => void;
  uid: string;
}

/** The Folders view as the table's items: a folder's header, then (open) its own documents with "Show N more", then the folders inside it. */
export function folderItems(i: FolderItemsInput): { items: RecordItem<GovDoc>[]; rows: DrawnRow<GovDoc>[] } {
  const plan: PlanItem<GovDoc>[] = planFolders(i.folders, {
    isOpen: (n) => folderIsOpen(i.view, n.key),
    limit: (n) => shownLimit(i.extra[n.key]),
    rowsOf: i.rowsOf,
  });
  const headId = (n: FolderNode<GovDoc>) => `${i.uid}-folder-${n.key}`;
  const docsId = (n: FolderNode<GovDoc>) => `${i.uid}-docs-${n.key}`;
  const cardHeadId = (n: FolderNode<GovDoc>) => `${i.uid}-cfolder-${n.key}`;
  const cardDocsId = (n: FolderNode<GovDoc>) => `${i.uid}-cdocs-${n.key}`;
  const items: RecordItem<GovDoc>[] = [];
  const drawn: DrawnRow<GovDoc>[] = [];
  plan.forEach((p) => {
    if (p.kind === 'folder') {
      const node = p.node;
      const mine = matchedIds(node);
      const tick = !i.selectable ? null : mine.length === 0 ? <span className="w-[16px] shrink-0" aria-hidden /> : (
        <FolderTick
          label={`Select ${mine.length === 1 ? '1 document' : `all ${mine.length} documents`} in ${node.name}`}
          state={tickState(i.selected, mine)}
          onChange={() => i.onTick(mine)}
        />
      );
      items.push({
        kind: 'group',
        id: node.key,
        table: (columns) => (
          <FolderHeadRow node={node} open={p.open} colSpan={columns} tick={tick} headId={headId(node)} controls={[...(node.top.length > 0 ? [docsId(node)] : []), ...node.folders.map(headId)]} onToggle={() => i.onFlip(node.key)} />
        ),
        card: <FolderHeadCard node={node} open={p.open} tick={tick} headId={cardHeadId(node)} controls={[...(node.top.length > 0 ? [cardDocsId(node)] : []), ...node.folders.map(cardHeadId)]} onToggle={() => i.onFlip(node.key)} />,
      });
      return;
    }
    const node = p.node;
    drawn.push(...p.rows);
    items.push(...recordRows(p.rows, node.depth + 1, i.toggleRow));
    if (node.top.length > FIRST_SHOWN) {                    // a folder with more documents than the first few: "Show N more", and once every one is listed "Show fewer"
      const step = showMoreStep(p.remaining);
      const props = {
        indent: (node.depth + 1) * STEP,
        hidden: p.remaining,
        step,
        onMore: () => i.onMore(node, step),
        onFewer: () => i.onFewer(node),
        folder: node.name,
      };
      items.push({ kind: 'more', id: node.key, table: (columns) => <ShowMoreRow colSpan={columns} {...props} />, card: <ShowMoreCard {...props} /> });
    }
  });
  return { items, rows: drawn };
}

export { toggleAll };
