'use client';

/**
 * The grouped List of the Workspace: the parts of it that are not a document row, and the items the explorer's table draws for it. A group is a header row across the whole table (a tick
 * box for its documents, an arrow, its name, how many documents, how many reviews are overdue, how many people have acknowledged) with its documents under it, "Show N more" at the end of
 * a long one; on a phone a group is a card of its own with the documents under it as cards. The document rows are the table's own (RecordTable draws them, one level under the header),
 * so ticks, the keyboard cursor, the details and the bulk bar work as in every other layout. Which groups there are and what they count is libraryGroups.ts; this only draws it.
 * A document with several frameworks has ONE full row (in the first of them: a row's id is never on the page twice); the other frameworks list it as a slim line that says where its row is.
 * Written on the design-system tokens, 12px at the least.
 */
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button, Checkbox } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import type { RecordItem } from '@/components/records/RecordTable';
import { tickState } from '@/components/records/explorerModel';
import { formatCount } from '@/lib/format';
import { openness, type Fold } from './docTree';
import { ShowMoreCard, ShowMoreRow } from './FolderRows';
import type { GovDoc } from './lib';
import { recordRows } from './libraryItems';
import { FIRST_SHOWN, showMoreStep } from './libraryFolders';
import { groupAria, groupNote, groupTrees, groupsLine, planGroups, type DocGroup } from './libraryGroups';
import type { GroupKey } from './libraryModel';
import { drawnRows, type DrawnRow } from './libraryTableLogic';
import { STEP } from './Versions';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const fmt = formatCount;

// ─── A group's header ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a group's header says: the arrow, its name, how many documents, a red "N overdue", "Acknowledged 80%" where some document asked people, and (not under Owner) how many have no owner. */
function GroupBody({ group, open, by }: { group: DocGroup<GovDoc>; open: boolean; by: GroupKey }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const a = group.acknowledged;
  return (
    <>
      {/* the arrow and the name stay together: on a phone a long name is cut, it never leaves the arrow on a line of its own */}
      <span className="flex min-w-0 max-w-full items-center gap-2">
        <Chevron className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} aria-hidden />
        <span dir="auto" className={`min-w-0 truncate text-ds-body font-[600] ${group.none ? 'text-ds-fg-muted' : 'text-ds-fg'}`} title={group.title ?? group.label}>{group.label}</span>
      </span>
      <span className="rounded-full bg-ds-border px-[6px] text-ds-label tabular-nums text-ds-fg-body">{fmt(group.count)}</span>
      {group.overdue > 0 && (
        <span className="whitespace-nowrap rounded-full border border-ds-danger-border bg-ds-danger-soft px-2 text-ds-label text-ds-danger" title="Reviews that are past their date">
          {fmt(group.overdue)} overdue
        </span>
      )}
      {a && (
        <span className="whitespace-nowrap text-ds-label text-ds-fg-muted" title={`${fmt(a.done)} of ${fmt(a.total)} people have acknowledged, over ${fmt(a.documents)} ${a.documents === 1 ? 'document' : 'documents'}`}>
          Acknowledged <span className="font-[600] tabular-nums text-ds-fg-body">{a.pct}%</span>
        </span>
      )}
      {by !== 'owner' && group.withoutOwner > 0 && (
        <span className="whitespace-nowrap text-ds-label text-ds-fg-muted">{fmt(group.withoutOwner)} without an owner</span>
      )}
    </>
  );
}

/** A tick box with a target of its own that is not a click on the row behind it (the folder's own, for a group's documents). */
function GroupTick({ label, state, onChange }: { label: string; state: ReturnType<typeof tickState>; onChange: () => void }) {
  return (
    <label data-no-peek className="-m-[8px] grid h-ds-control min-w-[var(--ds-control-h)] shrink-0 cursor-pointer place-items-center">
      <Checkbox aria-label={label} checked={state === 'all'} indeterminate={state === 'some'} onChange={onChange} />
    </label>
  );
}

/**
 * One row across the whole table: a tick box for the group's documents, then the header. A click anywhere on the row opens or closes it; the arrow, name and figures are one real button (Tab
 * reaches it, Enter and Space open it) that says what it is and whether it is open. Pinned to the left edge, so it stays in view when the table has scrolled sideways; on a narrow screen it wraps.
 */
export function GroupHeadRow({ group, by, open, colSpan, tick, onToggle }: {
  group: DocGroup<GovDoc>;
  by: GroupKey;
  open: boolean;
  colSpan: number;
  /** the tick box for the group's documents, or a spacer of the same width; null: the table has no tick boxes */
  tick: ReactNode;
  onToggle: () => void;
}) {
  // data-folder-row: the explorer's "skip the filters" link lands on the first of these or on the first record
  return (
    <tr
      data-folder-row={group.key}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-no-peek], input, label')) onToggle(); }}
      className="group/folder min-h-[44px] cursor-pointer"
    >
      <td colSpan={colSpan} className="border-b border-ds-border bg-ds-surface-subtle px-[12px] align-middle text-ds-body group-hover/folder:bg-ds-surface-hover [&&]:!py-[6px]">
        <div className="sticky left-[12px] flex w-full items-center gap-2">
          {tick}
          <div className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              aria-expanded={open}
              aria-label={groupAria(group)}
              className={`flex min-h-ds-control min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control py-[2px] text-left ${FOCUS}`}
            >
              <GroupBody group={group} open={open} by={by} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** The phone's group: a card-wide header. The same header, a tick box beside it, and one button that opens and closes it. */
export function GroupHeadCard({ group, by, open, tick, onToggle }: { group: DocGroup<GovDoc>; by: GroupKey; open: boolean; tick: ReactNode; onToggle: () => void }) {
  return (
    <li data-folder-row={group.key} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[6px]">
      <div className="flex items-center gap-2">
        {tick}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={groupAria(group)}
          className={`flex min-h-ds-control min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control text-left ${FOCUS}`}
        >
          <GroupBody group={group} open={open} by={by} />
        </button>
      </div>
    </li>
  );
}

// ─── A document that is in the group but has its row under an earlier one ────────────────────────────────────────────────

function AlsoText({ doc, home }: { doc: GovDoc; home: string }) {
  return (
    <>
      <span dir="auto" className="min-w-0 truncate text-ds-body text-ds-fg-body" title={doc.title}>{doc.title}</span>
      <span className="shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted">Also in {home}</span>
    </>
  );
}

/** A slim line: the title (it opens the document) and where the document's own row is. Only a framework grouping has them: a document of two frameworks is counted in both. */
export function AlsoRow({ doc, home, colSpan, onOpen }: { doc: GovDoc; home: string; colSpan: number; onOpen: (doc: GovDoc) => void }) {
  return (
    <tr data-also-row={doc.id} onClick={() => onOpen(doc)} className="cursor-pointer hover:bg-ds-surface-hover">
      <td colSpan={colSpan} className="border-b border-ds-border bg-ds-surface px-[12px] align-middle text-ds-body [&&]:!py-[3px]">
        <div className="sticky left-[12px] flex w-full min-w-0 items-center" style={{ paddingLeft: STEP + 30 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(doc); }} className={`flex min-h-ds-control min-w-0 flex-1 items-center gap-[10px] rounded-ds-control text-left ${FOCUS}`}>
            <AlsoText doc={doc} home={home} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function AlsoCard({ doc, home, onOpen }: { doc: GovDoc; home: string; onOpen: (doc: GovDoc) => void }) {
  return (
    <li className="rounded-ds-card border border-ds-border bg-ds-surface" style={{ marginLeft: 12 }}>
      <button type="button" onClick={() => onOpen(doc)} className={`flex min-h-ds-control w-full min-w-0 flex-col items-start gap-[2px] rounded-ds-card px-[8px] py-[6px] text-left ${FOCUS}`}>
        <AlsoText doc={doc} home={home} />
      </button>
    </li>
  );
}

// ─── The strip above the table ───────────────────────────────────────────────────────────────────────────────────────────

/** Expand all / Collapse all, and the counts: "6 groups · 128 documents", with the (i) that says what the figures on a group's line are. */
export function GroupsToolbar({ by, allOpen, onToggleAll, groups, documents, loaded, total }: {
  by: GroupKey;
  allOpen: boolean;
  onToggleAll: () => void;
  groups: number;
  /** each document once, however many groups count it */
  documents: number;
  loaded: number;
  total: number | null | undefined;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-[12px]">
      <Button size="sm" variant="ghost" onClick={onToggleAll} leftIcon={allOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </Button>
      <span className="flex items-center gap-1 text-ds-label tabular-nums text-ds-fg-muted">
        <span role="status">{groupsLine({ groups, documents, loaded, total })}</span>
        <InfoTip label="About groups" align="end" text={groupNote(by)} />
      </span>
    </div>
  );
}

// ─── The items ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GroupedItemsInput {
  groups: readonly DocGroup<GovDoc>[];
  by: GroupKey;
  isOpen: (g: DocGroup<GovDoc>) => boolean;
  /** how many more than the first ones the person asked for in each group (group key -> n) */
  extra: Record<string, number>;
  /** which documents under documents are open (the page's own, docTree.Fold) and whether a search or filter is on */
  fold: Fold;
  filtering: boolean;
  toggleRow: (id: number, open: boolean) => void;
  selected: ReadonlySet<number>;
  /** the group's documents were ticked or unticked as a whole */
  onTick: (ids: number[]) => void;
  selectable: boolean;
  onFlip: (g: DocGroup<GovDoc>) => void;
  onMore: (g: DocGroup<GovDoc>, step: number) => void;
  onFewer: (g: DocGroup<GovDoc>) => void;
  /** the title of a slim line was pressed: the same as a row's */
  onOpen: (doc: GovDoc) => void;
}

/** The grouped List as the table's items: a group's header, then (open) its documents and "Show N more"; `rows` are the document rows drawn (the keyboard cursor walks them). */
export function groupedItems(i: GroupedItemsInput): { items: RecordItem<GovDoc>[]; rows: DrawnRow<GovDoc>[] } {
  const trees = groupTrees(i.groups);
  const plan = planGroups<GovDoc, DrawnRow<GovDoc>>(i.groups, trees, {
    isOpen: i.isOpen,
    extra: i.extra,
    rowsOf: (g, top) => {
      const at = trees.get(g.key)?.at ?? new Map();
      return drawnRows(top, at, (id) => openness(i.fold, id, (at.get(id)?.children.length ?? 0) > 0, i.filtering));
    },
  });
  const items: RecordItem<GovDoc>[] = [];
  const drawn: DrawnRow<GovDoc>[] = [];
  for (const p of plan) {
    const g = p.group;
    if (p.kind === 'group') {
      const ids = g.docs.map((d) => d.id);
      const tick = !i.selectable ? null : (
        <GroupTick label={`Select ${ids.length === 1 ? '1 document' : `all ${ids.length} documents`} in ${g.label}`} state={tickState(i.selected, ids)} onChange={() => i.onTick(ids)} />
      );
      items.push({
        kind: 'group',
        id: g.key,
        table: (columns) => <GroupHeadRow group={g} by={i.by} open={p.open} colSpan={columns} tick={tick} onToggle={() => i.onFlip(g)} />,
        card: <GroupHeadCard group={g} by={i.by} open={p.open} tick={tick} onToggle={() => i.onFlip(g)} />,
      });
      continue;
    }
    drawn.push(...p.rows);
    items.push(...recordRows(p.rows, 1, i.toggleRow));
    p.also.forEach(({ doc, home }) => {
      items.push({ kind: 'more', id: `also-${g.key}-${doc.id}`, table: (columns) => <AlsoRow doc={doc} home={home} colSpan={columns} onOpen={i.onOpen} />, card: <AlsoCard doc={doc} home={home} onOpen={i.onOpen} /> });
    });
    if (p.tree.top.length + p.tree.also.length > FIRST_SHOWN) {       // a group with more than the first few: "Show N more", and once every one is listed "Show fewer"
      const step = showMoreStep(p.remaining);
      const props = { indent: STEP, hidden: p.remaining, step, onMore: () => i.onMore(g, step), onFewer: () => i.onFewer(g), folder: g.label };
      items.push({ kind: 'more', id: `more-${g.key}`, table: (columns) => <ShowMoreRow colSpan={columns} {...props} />, card: <ShowMoreCard {...props} /> });
    }
  }
  return { items, rows: drawn };
}
