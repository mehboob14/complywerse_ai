'use client';

// The Queue tab: what waits on this journey, as three lists with their true counts: files to review, scope requests waiting, and the requirements nobody has asked
// about (where the routine ones can be auto-approved, behind a question that says the same person is asking and approving). A row opens its decision sheet; the
// requirements themselves are in Frameworks, one link away, not copied here. The list that was asked is the one drawn: while another is loading the table says so
// instead of showing rows of the wrong kind under the wrong columns.
import type { UseQueryResult } from '@tanstack/react-query';
import { Button, DebouncedSearch, EmptyState, Pager, RegisterTable, SegmentedControl } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import {
  frameworksHref, openKey, queueChips, type FileItem, type QueueKind, type QueuePayload, type ScopeItem, type UntouchedItem,
} from '@/lib/auditorPortal/portalModel';
import { fileColumns, scopeColumns, untouchedColumns } from './columns';
import { useUntouchedActions } from './useUntouchedActions';

export interface QueueTabProps {
  journeyId: number;
  queue: UseQueryResult<QueuePayload>;
  kind: QueueKind;
  q: string;
  page: number;
  pageSize: number;
  /** the address: a change of list, search, page or open sheet */
  set: (patch: { kind?: QueueKind; q?: string; page?: number; open?: string }) => void;
  /** "Open Decisions" in the all-clear of the files list */
  onShowDecisions: () => void;
}

const NOUN = {
  files: { one: 'file', other: 'files' },
  scope: { one: 'scope request', other: 'scope requests' },
  untouched: { one: 'requirement', other: 'requirements' },
} as const;

function emptyFor(kind: QueueKind, searching: boolean, data: QueuePayload, clear: () => void, toDecisions: () => void) {
  if (searching) return <EmptyState kind="noMatches" title="Nothing matches that search" onClearFilters={clear} bare />;
  const decided = kind === 'files' ? data.counts.files.approved + data.counts.files.rejected : data.counts.scope.approved + data.counts.scope.rejected;
  if (kind === 'files') {
    return (
      <EmptyState
        kind="firstUse"
        title={decided > 0 ? 'Every file has been decided' : 'No files have been sent for review'}
        description={decided > 0 ? `${formatCount(decided)} decided so far. They are listed under Decisions.` : 'When someone sends a file for a requirement, it waits here.'}
        action={decided > 0 ? <Button onClick={toDecisions}>Open Decisions</Button> : undefined}
        bare
      />
    );
  }
  if (kind === 'scope') {
    return <EmptyState kind="firstUse" title="No scope requests are waiting" description="When someone asks to put a requirement in or out of scope, it waits here for a decision." bare />;
  }
  return <EmptyState kind="firstUse" title="Every requirement has a scope request" description="Nothing is left that nobody has asked about." bare />;
}

export function QueueTab({ journeyId, queue, kind, q, page, pageSize, set, onShowDecisions }: QueueTabProps) {
  const data = queue.data;
  const ready = data && data.kind === kind && !queue.isPlaceholderData ? data : undefined;
  const chips = queueChips(data?.counts);
  const { askAutoApprove, busyId, confirmDialog } = useUntouchedActions(journeyId);
  const open = (item: FileItem | ScopeItem) => set({ open: openKey(item.type, item.id) });
  const failed = queue.isError && !ready ? { message: errorMessage(queue.error), onRetry: () => { void queue.refetch(); } } : null;
  const searching = q.trim().length > 0;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px]">
        <SegmentedControl
          label="List"
          name="queue-kind"
          value={kind}
          onChange={(next) => set({ kind: next, page: 1, open: '' })}
          options={chips.map((c) => ({ value: c.kind, label: `${c.label} ${formatCount(c.count)}` }))}
        />
        <DebouncedSearch
          className="w-full sm:w-[280px]"
          label="Search this list"
          placeholder={kind === 'files' ? 'Search files and requirements' : 'Search requirements'}
          value={q}
          loading={queue.isFetching && !queue.isPending}
          onSearch={(next) => set({ q: next, page: 1 })}
        />
      </div>

      {kind === 'files' && (
        <RegisterTable<FileItem>
          caption="Files to review"
          columns={fileColumns(open)}
          rows={ready ? (ready.items as FileItem[]) : []}
          getRowId={(r) => r.id}
          onRowActivate={open}
          loading={!ready && !failed}
          error={failed}
          empty={ready ? emptyFor('files', searching, ready, () => set({ q: '', page: 1 }), onShowDecisions) : undefined}
          cardTitle={(r) => <span className="break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.file_name || 'A file'}</span>}
          footer={ready && ready.total > 0 ? <Pager page={page} pageSize={pageSize} total={ready.total} onPage={(p) => set({ page: p })} noun={NOUN.files} /> : undefined}
        />
      )}

      {kind === 'scope' && (
        <RegisterTable<ScopeItem>
          caption="Scope requests waiting for a decision"
          columns={scopeColumns(open)}
          rows={ready ? (ready.items as ScopeItem[]) : []}
          getRowId={(r) => r.id}
          onRowActivate={open}
          loading={!ready && !failed}
          error={failed}
          empty={ready ? emptyFor('scope', searching, ready, () => set({ q: '', page: 1 }), () => undefined) : undefined}
          cardTitle={(r) => <span className="break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.control?.ref ? `${r.control.ref} ${r.control.title ?? ''}`.trim() : r.control?.title || 'A requirement'}</span>}
          footer={ready && ready.total > 0 ? <Pager page={page} pageSize={pageSize} total={ready.total} onPage={(p) => set({ page: p })} noun={NOUN.scope} /> : undefined}
        />
      )}

      {kind === 'untouched' && (
        <>
          <p className="text-ds-body text-ds-fg-muted">
            Requirements nobody has asked about stay as they are. A routine one can be auto-approved; a critical one needs a request that someone else decides, made in Frameworks.
          </p>
          <RegisterTable<UntouchedItem>
            caption="Requirements with no scope request"
            columns={untouchedColumns(askAutoApprove, busyId, (item) => frameworksHref(journeyId, 'controls', item.control.implementation_id))}
            rows={ready ? (ready.items as UntouchedItem[]) : []}
            getRowId={(r) => r.id}
            loading={!ready && !failed}
            error={failed}
            empty={ready ? emptyFor('untouched', searching, ready, () => set({ q: '', page: 1 }), () => undefined) : undefined}
            cardTitle={(r) => <span className="break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.control.ref ? `${r.control.ref} ${r.control.title ?? ''}`.trim() : r.control.title || 'A requirement'}</span>}
            footer={ready && ready.total > 0 ? <Pager page={page} pageSize={pageSize} total={ready.total} onPage={(p) => set({ page: p })} noun={NOUN.untouched} /> : undefined}
          />
        </>
      )}
      {confirmDialog}
    </div>
  );
}
