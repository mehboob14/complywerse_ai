'use client';

// Exceptions > By document: the units as folders, indented by their depth like the library's Folders view (GET /policy-exceptions/by-document lists them in tree
// order), with the documents that have exceptions raised for each unit and, under each document, its exceptions. A unit's header says what it counts (the units
// under it included); a document says its kind and code; an exception says its status, priority and expiry, and "Decide" or "Implement" when it waits for the
// person. A press on an exception opens its details (the page's drawer). A document the person may not open is named "A document you cannot open", exceptions
// about no document are under "No document", and exceptions raised for no unit are under "No unit". A closed unit hides the units under it (_logic.visibleUnits).
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileText, Folder, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { exceptionStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { Button, EmptyState, ErrorState, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { countsSummary, dayText, documentGroupName, visibleUnits } from './_logic';
import { TypeChip, WaitingChip } from './_chips';
import type { ByDocumentAnswer, DocumentException, DocumentGroup } from './_types';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const STEP = 20;

/** One exception of a document: its title opens it. */
function ExceptionLine({ e, indent, onOpen }: { e: DocumentException; indent: number; onOpen: (id: number) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(e.id)}
        style={{ paddingLeft: indent }}
        className={clsx('flex min-h-[44px] w-full flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border py-[6px] pr-[12px] text-left hover:bg-ds-surface-hover', FOCUS)}
      >
        <span className="min-w-0 flex-1 basis-[14rem] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{e.title}</span>
        <StatusPill size="sm" {...statusPill(exceptionStatus, e.status)} />
        {e.priority && <StatusPill size="sm" {...statusPill(priorityStatus, e.priority)} />}
        {e.expiry_date && <span className="whitespace-nowrap text-ds-label tabular-nums text-ds-fg-muted"><span className="sr-only">Expires </span>{dayText(e.expiry_date)}</span>}
        <WaitingChip kind={e.waiting_kind} />
      </button>
    </li>
  );
}

/** A document that has exceptions: its title, kind and code, what it counts, and its exceptions under it. */
function DocumentBlock({ doc, depth, onOpen }: { doc: DocumentGroup; depth: number; onOpen: (id: number) => void }) {
  const name = documentGroupName(doc);                                    // a document the person may not open still has its kind; the exceptions about none have neither
  const indent = 12 + depth * STEP;
  return (
    <li className="border-t border-ds-border">
      <div style={{ paddingLeft: indent }} className="flex min-h-[40px] flex-wrap items-center gap-x-[8px] gap-y-[2px] py-[6px] pr-[12px]">
        <FileText aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
        <span className={clsx('min-w-0 break-words text-ds-body font-[600]', doc.title === null ? 'text-ds-fg-muted' : 'text-ds-fg')}>{name}</span>
        <TypeChip type={doc.doc_type} />
        {doc.code && <span className="text-ds-label text-ds-fg-muted">{doc.code}</span>}
        <span className="text-ds-label text-ds-fg-muted">{countsSummary(doc.counts)}</span>
      </div>
      <ul role="list" aria-label={`Exceptions about ${name}`}>
        {doc.exceptions.map((e) => <ExceptionLine key={e.id} e={e} indent={indent + STEP} onOpen={onOpen} />)}
      </ul>
    </li>
  );
}

/** A unit folder's header: open or closed, its name, and what it counts. Closing it hides its documents and the units under it. */
function FolderHead({ name, depth, open, inactive, summary, controls, onToggle, muted = false }: {
  name: string; depth: number; open: boolean; inactive?: boolean; summary: string; controls: string; onToggle: () => void; muted?: boolean;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = open ? FolderOpen : Folder;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      style={{ paddingLeft: 12 + depth * STEP }}
      className={clsx('flex min-h-[44px] w-full flex-wrap items-center gap-x-[8px] gap-y-[2px] bg-ds-surface-subtle py-[6px] pr-[12px] text-left hover:bg-ds-surface-hover', FOCUS)}
    >
      <Chevron aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
      <Icon aria-hidden strokeWidth={1.75} className="h-[18px] w-[18px] shrink-0 text-ds-primary-text" />
      <span className={clsx('min-w-0 break-words text-ds-body font-[600]', muted || inactive ? 'text-ds-fg-muted' : 'text-ds-fg')}>{name}</span>
      {inactive && <span className="text-ds-label text-ds-fg-muted">Inactive</span>}
      <span className="text-ds-label text-ds-fg-muted">{summary}</span>
    </button>
  );
}

export function DocumentTree({ query, onOpen }: {
  query: { data?: ByDocumentAnswer; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  /** an exception was pressed: open its details */
  onOpen: (exceptionId: number) => void;
}) {
  const base = useId();
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const [noUnitClosed, setNoUnitClosed] = useState(false);
  const answer = query.data;

  if (query.isLoading) return <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonRows rows={6} label="Loading the exceptions by document" /></div>;
  if (query.isError && !answer) {
    return <ErrorState title="Couldn't load the exceptions" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  }
  if (!answer || (answer.units.length === 0 && answer.no_unit.length === 0)) return <EmptyState kind="firstUse" title="No exceptions yet" />;

  const ids = answer.units.map((u) => u.department_id);
  const allClosed = ids.length > 0 && ids.every((id) => closed.has(id)) && (answer.no_unit.length === 0 || noUnitClosed);
  const toggleAll = () => { setClosed(allClosed ? new Set() : new Set(ids)); setNoUnitClosed(!allClosed); };
  const toggle = (id: number) => setClosed((c) => { const next = new Set(c); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const noUnitCounts = answer.no_unit.reduce((sum, d) => sum + d.counts.total, 0);

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex justify-end">
        <Button size="sm" leftIcon={allClosed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />} onClick={toggleAll}>{allClosed ? 'Expand all' : 'Collapse all'}</Button>
      </div>
      <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
        <ul role="list" aria-label="Exceptions by document">
          {visibleUnits(answer.units, closed).map((u) => {
            const open = !closed.has(u.department_id);
            const panel = `${base}-u${u.department_id}`;
            return (
              <li key={u.department_id} className="border-t border-ds-border first:border-t-0">
                <FolderHead name={u.name} depth={Math.min(u.depth, 3)} open={open} inactive={!u.is_active} summary={countsSummary(u.counts)} controls={panel} onToggle={() => toggle(u.department_id)} />
                <ul id={panel} role="list" hidden={!open} aria-label={`Documents of ${u.name}`}>
                  {u.documents.map((d, i) => <DocumentBlock key={`${d.document_id ?? 'x'}-${i}`} doc={d} depth={Math.min(u.depth, 3) + 1} onOpen={onOpen} />)}
                </ul>
              </li>
            );
          })}
          {answer.no_unit.length > 0 && (
            <li className="border-t border-ds-border first:border-t-0">
              <FolderHead name="No unit" depth={0} open={!noUnitClosed} muted summary={`${noUnitCounts} ${noUnitCounts === 1 ? 'exception' : 'exceptions'}`} controls={`${base}-none`} onToggle={() => setNoUnitClosed((c) => !c)} />
              <ul id={`${base}-none`} role="list" hidden={noUnitClosed} aria-label="Documents with no unit">
                {answer.no_unit.map((d, i) => <DocumentBlock key={`${d.document_id ?? 'x'}-${i}`} doc={d} depth={1} onOpen={onOpen} />)}
              </ul>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
