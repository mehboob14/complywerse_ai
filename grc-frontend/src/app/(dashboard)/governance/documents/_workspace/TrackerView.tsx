'use client';

// The Tracker layout of the Documents library: the documents by where they are in the life cycle the platform runs (Draft, In review, In approval, Approved, Published) and by what needs attention
// (Changes requested, Changes proposed, Review overdue, Expired, Exception applied, Archived). Built for a library of hundreds or thousands: every group is CLOSED with its count and the one line
// of what holds it up; opening a group lists its documents as compact lines, 25 a page ("Show more"); opening a document draws its whole workflow, asked of the server only then. There is no
// "open every document": groups can be opened one at a time or all together, documents one at a time. The rules are libraryTracker.ts (groups, counts, the line of a group) and tracker/*.ts (the
// compact line, the detail), all tested; the requests are tracker/useTrackerData.ts (the sets of the whole library in one answer, the lines of a page, a document's detail when it is opened).
// The view keeps the library's filters, search and sort: it is given the documents that match, in the order the person chose.
//   <TrackerView docs={filteredDocs} lookups={lookups} now={now} people={peopleOf(inbox)} activeId={openId} onOpen={(d) => setOpenId(d.id)} hrefOf={docHref} />
import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Notice, SkeletonRows } from '@/components/ui/ds';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import type { GovDoc } from './lib';
import { HowItWorksButton } from './HowItWorks';
import type { Lookups } from './libraryModel';
import { buildGroups, setsOf, type DocPeople, type GroupId, type TrackerContext } from './libraryTracker';
import { TrackerGroup } from './tracker/TrackerGroup';
import type { RowEnv } from './tracker/TrackerRow';
import { useTrackerSets } from './tracker/useTrackerData';

/** Below this width of the view's own box a line is three lines instead of columns. */
const NARROW_BELOW = 720;

export interface TrackerViewProps {
  /** the documents that match, in the order the person chose: a group keeps it (the person's own first) */
  docs: readonly GovDoc[];
  lookups: Lookups;
  /** the instant every rule is read at */
  now: Date;
  /** what the inbox says about each document (libraryTracker.peopleOf); without it no line names a person it does not know */
  people?: ReadonlyMap<number, DocPeople>;
  activeId?: number | null;
  /** the quick look of a document (the details open over the list) */
  onOpen: (doc: GovDoc) => void;
  /** where a document's page is (a modified click opens it in a new tab) */
  hrefOf?: (id: number) => string;
  label?: string;
}

const pageOf = (id: number) => `/governance/documents/${id}`;

export function TrackerView({ docs, lookups, now, people, activeId = null, onOpen, hrefOf = pageOf, label = 'Documents by step' }: TrackerViewProps) {
  const box = useRef<HTMLElement>(null);
  const width = useContainerWidth(box);
  const narrow = width != null && width < NARROW_BELOW;
  const sets = useTrackerSets();
  const waiting = sets.isPending;
  const known = useMemo(() => (sets.data ? setsOf(sets.data) : undefined), [sets.data]);
  const ctx: TrackerContext = useMemo(() => ({ lookups, now, people, sets: known }), [lookups, now, people, known]);
  const groups = useMemo(() => (waiting ? [] : buildGroups(docs, ctx)), [waiting, docs, ctx]);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<GroupId>>(() => new Set());
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(() => new Set());
  const toggleGroup = useCallback((id: GroupId) => setOpenGroups((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleRow = useCallback((id: number) => setOpenRows((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const all = groups.length > 0 && groups.every((g) => openGroups.has(g.def.id));
  const env: RowEnv = useMemo(() => ({ lookups, ctx, narrow, activeId, onOpen, hrefOf }), [lookups, ctx, narrow, activeId, onOpen, hrefOf]);

  return (
    <section ref={box} aria-label={label} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-b border-ds-border px-[12px] py-[6px]">
        <span role="status" className="text-ds-label text-ds-fg-muted">
          {waiting ? 'Sorting' : `${formatCount(docs.length)} ${docs.length === 1 ? 'document' : 'documents'} in ${formatCount(groups.length)} ${groups.length === 1 ? 'group' : 'groups'}`}
        </span>
        <span className="flex flex-wrap items-center gap-[4px]">
          {groups.length > 1 && <Button variant="ghost" size="sm" onClick={() => setOpenGroups(all ? new Set() : new Set(groups.map((g) => g.def.id)))}>{all ? 'Close all groups' : 'Open all groups'}</Button>}
          <HowItWorksButton />
        </span>
      </div>
      {sets.isError && !sets.data && (
        <div className="border-b border-ds-border p-[8px]">
          <Notice tone="warning" title="Holds and proposed changes could not be loaded" action={<Button onClick={() => { void sets.refetch(); }}>Retry</Button>}>
            {`${errorMessage(sets.error)} Documents sent back for changes, or waiting for a proposed change, are shown under their step for now.`}
          </Notice>
        </div>
      )}
      {waiting ? (
        <div aria-busy="true" className="p-[12px]"><SkeletonRows rows={5} columns={3} label="Sorting the documents" /></div>
      ) : (
        <ul aria-label="Groups" className="m-0 list-none p-0">
          {groups.map((g) => <TrackerGroup key={g.def.id} group={g} open={openGroups.has(g.def.id)} onToggle={toggleGroup} env={env} openRows={openRows} onToggleRow={toggleRow} />)}
        </ul>
      )}
    </section>
  );
}
