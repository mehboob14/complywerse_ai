'use client';

// The Board view: the documents of the scope as cards in a column for each status, type or department, the most urgent first (stuck, late, on hold, without an owner),
// each card with where its attestation stands. The Board lives only here: the library has no board layout. The grouping is in the address (?group=). A column lists its
// first cards; "Show all" and the column's title open the library on it. The board is read-only and has its own request (docs/_BoardPanel.tsx).
import { SectionCard, SegmentedControl } from '@/components/ui/ds';
import { BoardPanel, type useBoard } from './docs/_BoardPanel';
import { GROUPS, type GroupId } from './docs/_views';
import { link } from './parts';

export function BoardView({ query, group, onGroup }: { query: ReturnType<typeof useBoard>; group: GroupId; onGroup: (next: GroupId) => void }) {
  return (
    <SectionCard
      id="board"
      title="Board"
      info="The documents as cards in a column for each status, type or department, the most urgent first: stuck, late, on hold, without an owner. By status, Needs attention holds the documents outside the flow: expired, under an exception, or with a review required. Each card says where its attestation stands. Open a card for the document, a column for all of its documents in the library."
      actions={(
        <>
          <span className="text-ds-label text-ds-fg-muted">Group by</span>
          <SegmentedControl label="Group the board by" name="overview-group" options={GROUPS.map((g) => ({ value: g.id, label: g.label }))} value={group} onChange={onGroup} />
        </>
      )}
    >
      <BoardPanel query={query} link={link} />
    </SectionCard>
  );
}
