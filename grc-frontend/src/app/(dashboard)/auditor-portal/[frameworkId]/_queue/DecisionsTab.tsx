'use client';

// The Decisions tab: what was decided on this journey, files and scope requests together, newest first, with who decided, when, and the note that came with it.
// It reads the decided records themselves (every approval and every turn-down leaves its reviewer, its time and its note on the record, whichever route saved it),
// so it is complete and is the same whether the decision was taken here or in Frameworks. A decided file can be opened and decided again; a decided scope request is
// read-only here (the platform decides a request once).
import type { UseQueryResult } from '@tanstack/react-query';
import { DebouncedSearch, EmptyState, Pager, RegisterTable, SegmentedControl } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { openKey, type DecisionResult, type FileItem, type QueuePayload, type ScopeItem } from '@/lib/auditorPortal/portalModel';
import { decidedColumns } from './columns';

export interface DecisionsTabProps {
  queue: UseQueryResult<QueuePayload>;
  result: DecisionResult;
  q: string;
  page: number;
  pageSize: number;
  set: (patch: { result?: DecisionResult; q?: string; page?: number; open?: string }) => void;
}

const RESULTS: ReadonlyArray<{ value: DecisionResult; label: string }> = [{ value: 'all', label: 'All' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Turned down' }];

export function DecisionsTab({ queue, result, q, page, pageSize, set }: DecisionsTabProps) {
  const data = queue.data;
  const ready = data && data.kind === 'decided' && !queue.isPlaceholderData ? data : undefined;
  const open = (item: FileItem | ScopeItem | { type: string; id: number }) => set({ open: openKey(item.type as 'file' | 'scope', item.id) });
  const failed = queue.isError && !ready ? { message: errorMessage(queue.error), onRetry: () => { void queue.refetch(); } } : null;
  const searching = q.trim().length > 0;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px]">
        <SegmentedControl label="Show decisions" name="decision-result" value={result} onChange={(next) => set({ result: next, page: 1 })} options={RESULTS.slice()} />
        <DebouncedSearch className="w-full sm:w-[280px]" label="Search decisions" placeholder="Search files and requirements" value={q} loading={queue.isFetching && !queue.isPending} onSearch={(next) => set({ q: next, page: 1 })} />
      </div>
      <RegisterTable<FileItem | ScopeItem>
        caption="Decisions taken on this journey"
        columns={decidedColumns(open)}
        rows={ready ? (ready.items as Array<FileItem | ScopeItem>) : []}
        getRowId={(r) => `${r.type}-${r.id}`}
        onRowActivate={open}
        loading={!ready && !failed}
        error={failed}
        empty={searching || result !== 'all'
          ? <EmptyState kind="noMatches" title="No decision matches" onClearFilters={() => set({ q: '', result: 'all', page: 1 })} bare />
          : <EmptyState kind="firstUse" title="Nothing has been decided yet" description="Approvals and turn-downs of files and scope requests are listed here with who decided and when." bare />}
        cardTitle={(r) => <span className="break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.type === 'file' ? r.file_name || 'A file' : r.control?.title || 'A requirement'}</span>}
        footer={ready && ready.total > 0 ? <Pager page={page} pageSize={pageSize} total={ready.total} onPage={(p) => set({ page: p })} noun={{ one: 'decision', other: 'decisions' }} /> : undefined}
      />
    </div>
  );
}
