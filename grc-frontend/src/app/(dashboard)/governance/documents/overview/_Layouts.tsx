'use client';

// What each view of At a glance puts on the page. The Summary is the first and the default, a mix of all of them: the six figures, the graphs, the table of departments,
// a strip of the board, then the lists (by status and stage, waiting on people, reviews, issues). The Graph view is the graphs alone, the Board view the board alone
// (grouped by status, type or department); the table is _DepartmentTable.tsx. Which rows and numbers each graph and column shows is _chart.ts and _matrix.ts (tested).
import { Button, SectionCard, SegmentedControl } from '@/components/ui/ds';
import { BoardPanel } from './_BoardPanel';
import { CARDS_BOARD, CARDS_SUMMARY } from './_board';
import { StackChart, StatusChart, TypeChart } from './_Charts';
import { MatrixCard } from './_DepartmentTable';
import { CARDS, ByStatus, IssuesCard, ReviewsCard, Waiting } from './_Sections';
import { Tiles } from './_Tiles';
import { departmentStack, waitingStack } from './_chart';
import { hasDepartmentTable, type Overview } from './_model';
import { DEFAULT_GROUP, GROUPS, viewHref, type GroupId } from './_views';
import type { MeasureId } from './_matrix';

/** What the department graphs say each bar holds: with the whole organisation each department and everything under it, else the scope's own documents and each department under it. */
const within = (data: Pick<Overview, 'scope'>): string =>
  (data.scope.whole_organisation ? 'Each department with everything under it' : 'What is filed in it, and each department under it');

export function Summary({ data, measure, onMeasure }: { data: Overview; measure: MeasureId; onMeasure: (next: MeasureId) => void }) {
  const byDepartment = hasDepartmentTable(data);
  return (
    <>
      <Tiles data={data} />
      <div className="grid gap-[16px] lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {byDepartment
            ? <StackChart title="Documents by department" note={`By status. ${within(data)}`} stack={departmentStack(data, 'status')} open={(dept) => viewHref(dept, 'summary', DEFAULT_GROUP, measure)} />
            : <StatusChart data={data} />}
        </div>
        <TypeChart data={data} />
      </div>
      {byDepartment && <MatrixCard data={data} measure={measure} onMeasure={onMeasure} view="summary" group={DEFAULT_GROUP} />}
      <SectionCard
        id="board"
        title="Board"
        info="The documents as cards in a column for each status, the most urgent first: stuck, late, on hold, without an owner. Open a card for the document, a column for all of its documents."
        actions={<Button href={viewHref(data.scope.value, 'board')}>Open the board</Button>}
      >
        <BoardPanel dept={data.scope.value} group="status" per={CARDS_SUMMARY} compact />
      </SectionCard>
      <ByStatus data={data} />
      <Waiting data={data} />
      <div className={CARDS}>
        <ReviewsCard data={data} />
        <IssuesCard data={data} />
      </div>
    </>
  );
}

export function GraphView({ data }: { data: Overview }) {
  const byDepartment = hasDepartmentTable(data);
  const open = (dept: string) => viewHref(dept, 'graph');
  return (
    <div className="grid gap-[16px] lg:grid-cols-2">
      {byDepartment && <StackChart title="Documents by department and status" note={within(data)} stack={departmentStack(data, 'status')} open={open} />}
      {byDepartment && <StackChart title="Documents by department and type" note={within(data)} stack={departmentStack(data, 'type')} open={open} />}
      {byDepartment && <StackChart title="Waiting on people by department" note="Reviews, approvals and acknowledgements asked and not answered" stack={waitingStack(data)} open={open} />}
      <StatusChart data={data} />
      <TypeChart data={data} />
    </div>
  );
}

export function BoardView({ data, group, onGroup }: { data: Overview; group: GroupId; onGroup: (next: GroupId) => void }) {
  return (
    <SectionCard
      id="board"
      title="Board"
      info="The documents as cards in a column for each status, type or department, the most urgent first: stuck, late, on hold, without an owner. A column lists its first cards; open the column for all of them in the library."
      actions={(
        <>
          <span className="text-ds-label text-ds-fg-muted">Group by</span>
          <SegmentedControl label="Group the board by" name="overview-group" options={GROUPS.map((g) => ({ value: g.id, label: g.label }))} value={group} onChange={onGroup} />
        </>
      )}
    >
      <BoardPanel dept={data.scope.value} group={group} per={CARDS_BOARD} />
    </SectionCard>
  );
}
