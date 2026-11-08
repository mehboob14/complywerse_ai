'use client';

/**
 * The details of one task over the register's list (the Facet explorer's drawer): the kit's SidePanel, one scrolling body. The list row holds the facts (people, due, approval, counts, the
 * source and the titles of the records it is linked to); the description is read when the panel opens (one request, the task's own page shares it). The primary button is the next step for
 * THIS person (Start, Send for review, Approve ...; taskRecord.nextStep) with "Open task" beside it; a menu moves the task to any status the workflow allows. Previous / next walk the list
 * as it is shown. A document request offers the person's own step in the document instead of a status.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, ClampedText, ErrorState, Fact, FactList, IconButton, Menu, SidePanel, Skeleton, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { criticalTasksApi } from '@/lib/api';
import { EMPTY, formatDate, formatDateTime } from '@/lib/format';
import { plainDescription, requestLine, taskButtons } from '@/lib/documentTasks';
import { KIND_LABEL, kindOf, nextStep, sourceLink, waitingFor, type LinkedRecord, type RegisterTask } from '../taskRecord';
import { SlaPill } from '../_ui';
import { retryRead } from '../_queries';
import { APPROVAL_LABEL, approvalValue } from './taskFacets';
import { DueCell, PeopleList, PriorityCell, StatusCell, moveItems, subline, type RowEnv } from './TaskRows';

export interface TaskDrawerProps {
  /** the list row of the task whose details are open; null = closed */
  row: RegisterTask | null;
  env: RowEnv;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** a step is being saved (the buttons wait) */
  busy: boolean;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

const REPEATS: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter' };
const repeatsText = (t: RegisterTask): string | null => {
  if (!t.recurrence_pattern) return null;
  const unit = REPEATS[t.recurrence_pattern] ?? t.recurrence_pattern;
  const n = t.recurrence_interval && t.recurrence_interval > 1 ? t.recurrence_interval : 1;
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
};

function Linked({ link }: { link: LinkedRecord }) {
  const word: Record<LinkedRecord['kind'], string> = { risk: 'Risk', control: 'Control', vulnerability: 'Vulnerability', framework: 'Framework', requirement: 'Requirement', issue: 'Issue' };
  return (
    <li className="flex items-start justify-between gap-[12px] border-b border-ds-border py-[2px] last:border-b-0">
      <span className="shrink-0 text-ds-label text-ds-fg-muted">{word[link.kind]}</span>
      <span className="min-w-0 text-right">
        {link.title && link.href
          ? <TitleLink href={link.href} title={link.title} lines={2} tone="text" size="body" />
          : <span className="text-ds-body text-ds-fg-muted">{link.title ?? 'No longer there'}</span>}
      </span>
    </li>
  );
}

export function TaskDrawer({ row, env, onClose, onStep, hasPrev, hasNext, busy }: TaskDrawerProps) {
  const id = row?.id ?? null;
  const q = useQuery({
    queryKey: ['critical-task', id],
    queryFn: async () => (await criticalTasksApi.get(id as number)).data as { description?: string | null },
    enabled: id != null,
    retry: retryRead,
  });
  const full = q.data && id != null ? q.data : null;
  const step = row ? nextStep(row, env.me) : null;
  const waiting = row ? waitingFor(row, env.me) : null;
  const source = row ? sourceLink(row) : null;
  const kind = row ? kindOf(row) : 'task';
  const more = row ? moveItems(row, env).filter((m) => m.key !== 'step') : [];
  const buttons = row && kind === 'document' ? taskButtons(row.document_request, env.me) : [];
  const repeats = row ? repeatsText(row) : null;
  const sub = row ? subline(row) : '';
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title}>{row?.title}</span>}
      subtitle={sub || undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label="Previous task" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next task" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.length > 0 && <Menu label="Move to" items={more} />}
        </>
      )}
      footer={row && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {step && <Button variant="primary" loading={busy} onClick={() => env.onStep(row, step)}>{step.label}</Button>}
          {buttons.filter((b) => b.primary).map((b) => <Button key={b.label} variant="primary" onClick={() => env.onGo(b.href)}>{b.label}</Button>)}
          <Button variant={step || buttons.some((b) => b.primary) ? 'secondary' : 'primary'} onClick={() => env.onOpen(row.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open task</Button>
        </div>
      )}
    >
      {row && (
        <div key={row.id} data-task-detail={row.id}>
          <div className="mb-[16px] flex flex-wrap items-center gap-[8px]">
            <StatusCell task={row} />
            <PriorityCell task={row} />
            {(row.sla_status === 'Breached' || row.sla_status === 'At Risk') && <SlaPill word={row.sla_status} />}
          </div>
          {waiting && <p className="mb-[16px] text-ds-body text-ds-fg-muted">{waiting}</p>}
          {kind === 'document' && row.document_request && <p className="mb-[16px] text-ds-body text-ds-fg-muted">{requestLine(row.document_request)}</p>}

          <FactList min={150}>
            <Fact label="Owner" empty="Unassigned">{row.assigned_owner || (row.assignees ?? []).length ? <PeopleList task={row} /> : null}</Fact>
            <Fact label="Reviewer" empty="Not set">{row.reviewer?.display_name}</Fact>
            <Fact label="Due" empty="Not set">{row.due_date ? <DueCell task={row} now={env.now} /> : null}</Fact>
            <Fact label="Category">{row.category}</Fact>
            <Fact label="Source">{source ? (source.href ? <TitleLink href={source.href} title={source.label} lines={1} tone="text" size="body" /> : source.label) : row.source || KIND_LABEL[kind]}</Fact>
            <Fact label="Created by">{row.created_by?.display_name ? `${row.created_by.display_name}${row.created_at ? `, ${formatDate(row.created_at)}` : ''}` : row.created_at ? formatDate(row.created_at) : null}</Fact>
            {row.approval_required && <Fact label="Approval">{APPROVAL_LABEL[approvalValue(row) as keyof typeof APPROVAL_LABEL]}</Fact>}
            {repeats && <Fact label="Repeats">{repeats}</Fact>}
            <Fact label="Sub-tasks">{row.sub_task_total ? `${row.sub_task_done ?? 0} of ${row.sub_task_total} done` : null}</Fact>
            <Fact label="Comments">{row.comment_count ? String(row.comment_count) : null}</Fact>
            <Fact label="Last changed">{row.updated_at ? formatDateTime(row.updated_at) : EMPTY}</Fact>
          </FactList>

          {q.isPending && <div className="mt-[20px]"><Skeleton className="h-[14px] w-[60%]" /><Skeleton className="mt-[8px] h-[14px] w-[90%]" /><Skeleton className="mt-[8px] h-[14px] w-[75%]" /></div>}
          {q.isError && !full && (
            <ErrorState compact className="mt-[16px]" title="Couldn't load the description" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
          )}
          {full && <Section title="Description"><ClampedText text={plainDescription(full.description)} lines={5} /></Section>}

          {row.links && row.links.length > 0 && (
            <Section title="Linked to"><ul className="m-0 list-none p-0">{row.links.map((l) => <Linked key={`${l.kind}-${l.id}`} link={l} />)}</ul></Section>
          )}
        </div>
      )}
    </SidePanel>
  );
}
