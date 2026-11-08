'use client';

/**
 * The details of one assessment over the home's list: the kit's SidePanel. Everything comes from the row the list already holds (no request): the stage, who leads it, the framework or
 * the period, the progress in words, who approved it and when, and the first words of its description. "Open assessment" goes to the workspace; a framework assessment someone has questions
 * in also offers "My questions". Previous / next walk the list as it is shown.
 */
import { ArrowUpRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button, ClampedText, Fact, FactList, IconButton, Menu, PersonChip, ProgressBar, SidePanel, type MenuItem } from '@/components/ui/ds';
import { EMPTY, formatDate } from '@/lib/format';
import { StatusCell, subline } from './AssessmentRows';
import { hrefOf, keyOf, progressOf, progressWords, type AssessmentRow } from './assessmentModel';

export interface AssessmentDrawerProps {
  row: AssessmentRow | null;
  onClose: () => void;
  onOpenRow: (row: AssessmentRow, query?: string) => void;
  canWrite: boolean;
  onDelete: (row: AssessmentRow) => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (key: number | null) => (): HTMLElement | null => {
  if (key == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${key}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

export function AssessmentDrawer({ row, onClose, onOpenRow, canWrite, onDelete, onStep, hasPrev, hasNext }: AssessmentDrawerProps) {
  const more: MenuItem[] = row ? [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canWrite, onSelect: () => onDelete(row) }] : [];
  const p = row ? progressOf(row) : null;
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.name}>{row?.name}</span>}
      subtitle={row ? subline(row) : undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(row ? keyOf(row) : null)}
      actions={row && (
        <>
          <IconButton label="Previous assessment" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next assessment" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
        </>
      )}
      footer={row && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" onClick={() => onOpenRow(row)} rightIcon={<ArrowUpRight aria-hidden />}>Open assessment</Button>
          {row.kind === 'framework' && row.mine_items > 0 && <Button onClick={() => onOpenRow(row, 'mine=1')}>My questions ({row.mine_items})</Button>}
        </div>
      )}
    >
      {row && (
        <div key={keyOf(row)} data-assessment-detail={hrefOf(row)}>
          <div className="mb-[16px] flex flex-wrap items-center gap-[8px]">
            <StatusCell row={row} />
            {row.blocked_items > 0 && <span className="text-ds-body font-[600] text-ds-danger">{row.blocked_items} blocked {row.blocked_items === 1 ? 'question' : 'questions'}</span>}
          </div>

          {p && (
            <div className="mb-[16px]">
              <ProgressBar value={p.pct} label={`${row.name}: ${progressWords(row)}`} valueText={progressWords(row)} tone={p.pct === 100 ? 'success' : 'primary'} />
            </div>
          )}

          <FactList min={150}>
            <Fact label={row.kind === 'framework' ? 'Created by' : 'Lead assessor'} empty="Unassigned">{row.owner_name ? <PersonChip name={row.owner_name} /> : null}</Fact>
            <Fact label="Framework">{row.framework_name}</Fact>
            {row.kind === 'manual' && <Fact label="Business unit">{row.business_unit_name}</Fact>}
            {row.kind === 'manual' && <Fact label="Period">{row.period_start || row.period_end ? `${formatDate(row.period_start)} to ${formatDate(row.period_end)}` : null}</Fact>}
            {row.kind === 'manual' && <Fact label="Approved by">{row.approver_name ? `${row.approver_name}${row.approved_at ? `, ${formatDate(row.approved_at)}` : ''}` : null}</Fact>}
            <Fact label="Created">{formatDate(row.created_at)}</Fact>
            <Fact label="Last changed">{formatDate(row.updated_at)}</Fact>
          </FactList>

          <section className="mt-[20px] border-t border-ds-border pt-[16px]">
            <h3 className="!text-ds-body !font-[600] !text-ds-fg">Description</h3>
            <div className="mt-[8px]">{row.description_preview ? <ClampedText text={row.description_preview} lines={5} /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>}</div>
          </section>
        </div>
      )}
    </SidePanel>
  );
}
