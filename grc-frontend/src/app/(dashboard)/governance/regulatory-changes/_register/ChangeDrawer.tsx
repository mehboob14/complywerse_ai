'use client';

/**
 * The details of one change over the register's list (the Facet explorer's drawer): the kit's SidePanel, one scrolling body, built from the row the list already holds (no request). The status,
 * the priority, the facts, what the change waits for as links that open the right tab of the change (already filtered), and the summary of what the circular says. Open change stays in view;
 * previous / next walk the list as it is shown.
 */
import { ArrowUpRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button, ClampedText, Fact, FactList, IconButton, Menu, SidePanel, StatusPill, TitleLink, type MenuItem } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { changeStatus } from '@/lib/statuses/regulatory';
import { attentionOf, isOpen, regulatorName, taskShare } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';
import { changeHref } from '../_overview/overviewModel';
import { OwnerCell } from '../_parts/shared';

export interface ChangeDrawerProps {
  /** the row whose details are open; null = closed */
  row: ChangeRow | null;
  onClose: () => void;
  onOpenChange: (id: number) => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  canDelete: boolean;
  onDelete: (row: ChangeRow) => void;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

const WHERE: Record<string, { tab: string; extra: Record<string, string | number>; verb: string }> = {
  reading: { tab: 'overview', extra: {}, verb: 'Open the change' },
  late: { tab: 'tasks', extra: { late: 1 }, verb: 'See the late tasks' },
  check: { tab: 'obligations', extra: { check: 1 }, verb: 'Check them' },
  suggestions: { tab: 'obligations', extra: { control: 'review' }, verb: 'Decide on them' },
  no_tasks: { tab: 'tasks', extra: {}, verb: 'Add a task' },
};

export function ChangeDrawer({ row, onClose, onOpenChange, onStep, hasPrev, hasNext, canDelete, onDelete }: ChangeDrawerProps) {
  const id = row?.id ?? null;
  const more: MenuItem[] = row ? [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => onDelete(row) }] : [];
  const share = row ? taskShare(row) : null;
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title}>{row?.title}</span>}
      subtitle={row ? [regulatorName(row.source), row.reference_number].filter(Boolean).join(' · ') : undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label="Previous change" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next change" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
        </>
      )}
      footer={row && <Button variant="primary" onClick={() => onOpenChange(row.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open change</Button>}
    >
      {row && (
        <div key={row.id} data-change-detail={row.id}>
          <div className="mb-[16px] flex flex-wrap items-center gap-[8px]">
            <StatusPill {...statusPill(changeStatus, row.status)} />
            <StatusPill size="sm" {...statusPill(priority, row.priority)} />
          </div>

          <FactList min={150}>
            <Fact label="Takes effect" empty="Not set">{row.effective_date ? formatDate(row.effective_date, { calendar: true }) : null}</Fact>
            <Fact label="Published">{row.publication_date ? formatDate(row.publication_date, { calendar: true }) : null}</Fact>
            <Fact label="Owner" empty="Unassigned">{row.assignee_name ? <OwnerCell change={row} /> : null}</Fact>
            <Fact label="Recorded">{formatDate(row.created_at)}</Fact>
            <Fact label="Obligations">{row.obligation_count != null ? `${row.obligation_count} · ${row.met_count ?? 0} met by a control` : null}</Fact>
            <Fact label="Tasks">{share && share.total > 0 ? `${share.done} of ${share.total} done${(row.late_task_count ?? 0) > 0 ? `, ${row.late_task_count} late` : ''}` : 'None yet'}</Fact>
          </FactList>

          {isOpen(row.status) && attentionOf(row).length > 0 && (
            <section className="mt-[20px] border-t border-ds-border pt-[16px]">
              <h3 className="!text-ds-body !font-[600] !text-ds-fg">Waiting for someone</h3>
              <ul className="m-0 mt-[4px] list-none p-0">
                {attentionOf(row).map((a) => {
                  const where = WHERE[a.key];
                  return (
                    <li key={a.key} className="flex flex-wrap items-center justify-between gap-x-[8px] border-b border-ds-border py-[2px] last:border-b-0">
                      <span className={`text-ds-body font-[600] ${a.tone === 'danger' ? 'text-ds-danger' : a.tone === 'warning' ? 'text-ds-warning' : 'text-ds-fg'}`}>{a.label}</span>
                      <TitleLink href={changeHref(row.id, where.tab, where.extra)} title={where.verb} lines={1} tone="text" size="body" />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="mt-[20px] border-t border-ds-border pt-[16px]">
            <h3 className="!text-ds-body !font-[600] !text-ds-fg">What the circular says</h3>
            <div className="mt-[8px]"><ClampedText text={row.description} lines={6} /></div>
          </section>
        </div>
      )}
    </SidePanel>
  );
}
