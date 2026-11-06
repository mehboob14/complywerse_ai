'use client';

// The table primitives and RegisterTable: rows, sortable columns, row activation, priority columns, loading, failed and empty; and the logic
// behind them with its answers computed live. At 768 px and wider a register is a table; below that the same rows are cards.
import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Button, EmptyState, Menu, PersonChip, RegisterTable, RowHeaderCell, Select, StatusPill, Table, TableFrame, TBody, Td, Th, THead, Tr,
  ariaSort, nextSort, priorityClass, rowCountText, sortRows, type RegisterColumn, type SortState, type SortValue,
} from '@/components/ui';
import { formatCount, formatDate, formatDateTime, statusLabel } from '@/lib/format';
import { parseUtc } from '@/lib/serverTime';
import { documentStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { GuideSection, MONO, Spec, Specimen } from './Guide';
import { DOCUMENTS, type Doc } from './fixtures';

const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[12px]';

/** What each sortable column holds, for sortRows. */
function valueOf(d: Doc, key: string): SortValue {
  switch (key) {
    case 'title': return d.title;
    case 'owner': return d.owner;
    case 'reviewDue': return d.reviewDue;
    case 'updated': return parseUtc(d.updated);
    case 'open': return d.open;
    default: return null;
  }
}

const COLUMNS: RegisterColumn<Doc>[] = [
  { key: 'title', header: 'Document', isRowHeader: true, sortable: true, cell: (d) => <span className="line-clamp-2 font-medium text-ds-fg" title={d.title}>{d.title}</span> },
  { key: 'status', header: 'Status', card: 'meta', cell: (d) => <StatusPill size="sm" {...statusPill(documentStatus, d.status)} /> },
  { key: 'priority', header: 'Priority', priority: 2, cell: (d) => <StatusPill size="sm" {...statusPill(priorityStatus, d.priority)} /> },
  { key: 'owner', header: 'Owner', priority: 2, sortable: true, card: 'meta', cell: (d) => <PersonChip name={d.owner} size={20} /> },
  { key: 'reviewDue', header: 'Review due', priority: 3, sortable: true, card: 'meta', cell: (d) => formatDate(d.reviewDue) },
  { key: 'updated', header: 'Updated', priority: 3, sortable: true, firstDir: 'desc', cell: (d) => formatDateTime(d.updated) },
  { key: 'open', header: 'Open items', priority: 3, align: 'right', sortable: true, firstDir: 'desc', cell: (d) => formatCount(d.open) },
];

/** For hideHeader: the caption and the cells already make the columns plain, and a width sits on the cells. */
const QUIET_COLUMNS: RegisterColumn<Doc>[] = [
  { key: 'title', header: 'Document', isRowHeader: true, width: 'w-[55%]', cell: (d) => <span className="line-clamp-2 font-medium text-ds-fg" title={d.title}>{d.title}</span> },
  { key: 'status', header: 'Status', card: 'meta', cell: (d) => <StatusPill size="sm" {...statusPill(documentStatus, d.status)} /> },
  { key: 'owner', header: 'Owner', card: 'meta', cell: (d) => <PersonChip name={d.owner} size={20} /> },
];

function PrimitivesDemo() {
  const [sort, setSort] = useState<SortState>({ key: 'title', dir: 'asc' });
  const [chosen, setChosen] = useState<number | null>(null);
  const rows = sortRows(DOCUMENTS, sort, valueOf);
  return (
    <div className="space-y-[8px]">
      <TableFrame aria-label="Documents, built from the table primitives" maxHeight="max-h-[300px]">
        <Table caption="Documents, built from the table primitives">
          <THead>
            <Tr>
              <Th sticky sortKey="title" sort={sort} onSortChange={setSort}>Document</Th>
              <Th sticky priority={2}>Owner</Th>
              <Th sticky sortKey="updated" sort={sort} onSortChange={setSort} firstDir="desc" align="right">Updated</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((d) => (
              <Tr key={d.id} selected={chosen === d.id} onActivate={() => setChosen(d.id)}>
                <RowHeaderCell>{d.title}</RowHeaderCell>
                <Td priority={2}><PersonChip name={d.owner} size={20} /></Td>
                <Td align="right">{formatDateTime(d.updated)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableFrame>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">
        Click a header to sort (it says so with aria-sort), click or press Enter on a row to choose it. Chosen: {chosen === null ? 'none' : DOCUMENTS.find((d) => d.id === chosen)?.title}. The frame scrolls and is a tab stop; the header stays in view.
      </p>
    </div>
  );
}

function RegisterDemo() {
  const [sort, setSort] = useState<SortState>({ key: 'updated', dir: 'desc' });
  const [chosen, setChosen] = useState<number | null>(2);
  const rows = sortRows(DOCUMENTS, sort, valueOf);
  return (
    <RegisterTable
      caption="Documents"
      columns={COLUMNS}
      rows={rows}
      getRowId={(d) => d.id}
      sort={sort}
      onSortChange={setSort}
      onRowActivate={(d) => setChosen(d.id)}
      selectedId={chosen}
      cardTitle={(d) => d.title}
      stickyHead
      maxHeight="max-h-[420px]"
      footer={<p className="text-ds-label text-ds-fg-muted">{rowCountText({ shown: rows.length, total: 312, noun: 'document' })}</p>}
    />
  );
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'];

/** An inline control and a row menu: the table has a Select and an Actions column, the card has the value as a pill (`cardCell`) and the menu at its top right (`cardActions`). */
function InlineDemo() {
  const rows = DOCUMENTS.slice(0, 4);
  const [priorities, setPriorities] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((d) => [d.id, d.priority])));
  const [last, setLast] = useState('nothing yet');
  const menu = (d: Doc) => (
    <Menu
      iconOnly
      label={`Actions for ${d.title}`}
      items={[
        { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setLast(`Edit “${d.title}”`) },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => setLast(`Delete “${d.title}”`) },
      ]}
    />
  );
  const columns: RegisterColumn<Doc>[] = [
    { key: 'title', header: 'Document', isRowHeader: true, cell: (d) => <span className="line-clamp-2 font-medium text-ds-fg" title={d.title}>{d.title}</span> },
    {
      key: 'priority',
      header: 'Priority',
      card: 'meta',
      cell: (d) => (
        <Select aria-label={`Priority of ${d.title}`} value={priorities[d.id]} onChange={(e) => setPriorities({ ...priorities, [d.id]: e.target.value })} className="w-[130px]">
          {PRIORITIES.map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}
        </Select>
      ),
      cardCell: (d) => <StatusPill size="sm" {...statusPill(priorityStatus, priorities[d.id])} />,
    },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (d) => <PersonChip name={d.owner} size={20} /> },
    { key: 'actions', header: 'Actions', align: 'right', card: 'hide', cell: menu },
  ];
  return (
    <div className="space-y-[8px]">
      <RegisterTable
        caption="Documents with an inline priority and row actions"
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        cardTitle={(d) => d.title}
        cardActions={menu}
        onRowActivate={(d) => setLast(`Opened “${d.title}”`)}
      />
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite" data-guide-last="inline">Last: {last}. Below 768 px the Select is a pill (it exists once) and the menu is at the top right of the card; a press on the menu or the Select does not open the row.</p>
    </div>
  );
}

function FailedDemo() {
  const [phase, setPhase] = useState<'failed' | 'loading' | 'ok'>('failed');
  const tries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const retry = () => {
    setPhase('loading');
    tries.current += 1;
    timer.current = setTimeout(() => setPhase(tries.current >= 2 ? 'ok' : 'failed'), 600);       // the simulated server answers on the second try
  };
  return (
    <div className="space-y-[8px]">
      <RegisterTable
        caption="Documents (failed demo)"
        columns={COLUMNS}
        rows={phase === 'ok' ? DOCUMENTS.slice(0, 3) : []}
        getRowId={(d) => d.id}
        loading={phase === 'loading'}
        loadingRows={3}
        error={phase === 'failed' ? { message: "Couldn't load the documents. The server didn't answer.", onRetry: retry } : null}
        cardTitle={(d) => d.title}
      />
      {phase === 'ok' && <Button size="sm" onClick={() => { tries.current = 0; setPhase('failed'); }}>Reset the demo</Button>}
    </div>
  );
}

const show = (v: unknown): string => (v === undefined ? 'undefined' : JSON.stringify(v));

const LOGIC: Array<[string, unknown]> = [
  ["nextSort(null, 'title')", nextSort(null, 'title')],
  ["nextSort({ key: 'title', dir: 'asc' }, 'title')", nextSort({ key: 'title', dir: 'asc' }, 'title')],
  ["nextSort({ key: 'title', dir: 'desc' }, 'title')", nextSort({ key: 'title', dir: 'desc' }, 'title')],
  ["nextSort({ key: 'title', dir: 'desc' }, 'title', 'asc-desc')", nextSort({ key: 'title', dir: 'desc' }, 'title', 'asc-desc')],
  ["nextSort(null, 'updated', 'asc-desc-none', 'desc')", nextSort(null, 'updated', 'asc-desc-none', 'desc')],
  ["ariaSort('title', { key: 'title', dir: 'asc' }, true)", ariaSort('title', { key: 'title', dir: 'asc' }, true)],
  ["ariaSort('owner', { key: 'title', dir: 'asc' }, true)", ariaSort('owner', { key: 'title', dir: 'asc' }, true)],
  ["ariaSort('actions', null, false)", ariaSort('actions', null, false)],
  ["sortRows(['Item 10', 'Item 2', null, 'item 1'], asc)", sortRows(['Item 10', 'Item 2', null, 'item 1'], { key: 'x', dir: 'asc' }, (v) => v)],
  ["sortRows([3, null, 10, 2], desc)", sortRows([3, null, 10, 2], { key: 'x', dir: 'desc' }, (v) => v)],
  ['priorityClass(1)', priorityClass(1)],
  ['priorityClass(2)', priorityClass(2)],
  ['priorityClass(3)', priorityClass(3)],
  ["rowCountText({ shown: 25, total: 312, noun: 'document' })", rowCountText({ shown: 25, total: 312, noun: 'document' })],
  ["rowCountText({ shown: 1, total: 1, noun: 'document' })", rowCountText({ shown: 1, total: 1, noun: 'document' })],
  ["rowCountText({ shown: 3, total: 3, noun: 'policy', plural: 'policies' })", rowCountText({ shown: 3, total: 3, noun: 'policy', plural: 'policies' })],
  ["rowCountText({ shown: 0, total: null, noun: 'document' })", rowCountText({ shown: 0, total: null, noun: 'document' })],
  ["rowCountText({ shown: 0, total: 0, noun: 'document', failed: true })", rowCountText({ shown: 0, total: 0, noun: 'document', failed: true })],
];

function LogicTable() {
  return (
    <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border">
      <Table caption="The table logic, with its answers" className="min-w-[620px]">
        <THead><Tr><Th>Call</Th><Th>Answer</Th></Tr></THead>
        <TBody>
          {LOGIC.map(([call, answer]) => (
            <Tr key={call}>
              <RowHeaderCell className="min-w-[280px]"><code className={MONO}>{call}</code></RowHeaderCell>
              <Td><code className={`${MONO} text-ds-fg-body`}>{show(answer)}</code></Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export function TablesSection() {
  return (
    <GuideSection id="tables" title="Tables" lead="A register is a table from 768 px and cards below it: both are drawn and CSS shows one, so resize the window to see the other (the accessibility probe checks 390 px). Columns marked 2 and 3 drop out as the window narrows.">
      <Spec name="Table primitives">
        <Specimen label="Sortable headers, a chosen row, a sticky header in a scrolling frame, a column that gives way (Owner, below 768 px)"><PrimitivesDemo /></Specimen>
      </Spec>
      <Spec name="RegisterTable">
        <Specimen label="Rows: sortable columns (Document, Owner, Review due, Updated, Open items), priority 1, 2 and 3 columns, a row that opens, a chosen row, a sticky header, a count that says the list is cut">
          <RegisterDemo />
        </Specimen>
        <Specimen label="Loading: the header and skeleton rows; no count, no zero"><RegisterTable caption="Documents (loading demo)" columns={COLUMNS} rows={[]} getRowId={(d) => d.id} loading loadingRows={3} cardTitle={(d) => d.title} /></Specimen>
        <Specimen label="Failed: the message and Retry in place of the rows, never an empty table (Retry fails once more, then works)"><FailedDemo /></Specimen>
        <Specimen label="Empty, first use: the page's own empty state"><RegisterTable caption="Documents (empty demo)" columns={COLUMNS} rows={[]} getRowId={(d) => d.id} cardTitle={(d) => d.title} empty={<EmptyState bare kind="firstUse" title="No documents yet" description="Documents you add appear here." action={<Button variant="primary">Add a document</Button>} />} /></Specimen>
        <Specimen label="Empty, nothing matches: say so and clear the filters"><RegisterTable caption="Documents (no matches demo)" columns={COLUMNS} rows={[]} getRowId={(d) => d.id} cardTitle={(d) => d.title} empty={<EmptyState bare kind="noMatches" title="No documents match" description="Try another search." onClearFilters={() => undefined} />} /></Specimen>
        <Specimen label="hideHeader: the header row is read out and not drawn (the caption and the cells make the columns plain); the width moves to the cells">
          <RegisterTable caption="Documents, header read out and not drawn" hideHeader columns={QUIET_COLUMNS} rows={DOCUMENTS.slice(0, 3)} getRowId={(d) => d.id} cardTitle={(d) => d.title} />
        </Specimen>
        <Specimen label="cardCell and cardActions: an inline Select in the table is a pill on the card (not drawn twice), and the row's menu sits at the top right of each card">
          <InlineDemo />
        </Specimen>
        <Specimen label="No empty state given: the register's own plain line"><RegisterTable caption="Documents (plain empty demo)" columns={COLUMNS} rows={[]} getRowId={(d) => d.id} cardTitle={(d) => d.title} /></Specimen>
      </Spec>
      <Spec name="Table logic"><LogicTable /></Spec>
    </GuideSection>
  );
}
