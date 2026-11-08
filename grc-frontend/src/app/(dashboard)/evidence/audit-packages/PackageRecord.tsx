'use client';

/**
 * One audit package, opened over the list (the kit's SidePanel): its status and legal hold in the head, the one thing to do next in the foot (Finalize, Export, Download), and three tabs:
 * Contents (the files in the order they are printed, moved a place at a time or removed while the package is a draft, with Add evidence), Details (who made it and when, its period,
 * its retention) and Access log (who exported or downloaded it, and when). A package that is not a draft shows its files read-only, and says why a step cannot be taken instead of
 * hiding it. Which steps are possible is packagesModel.stepsOf; the server decides in the end.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileCheck2, Lock, PackageCheck, Plus, Trash2, Unlock } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, Fact, FactList, IconButton, Menu, PersonChip, SidePanel, SkeletonRows, StatusPill, TabPanel, Tabs, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { evidenceStatus, packageLog, packageStatus } from '@/lib/statuses/evidence';
import { typeLabel } from '../_workspace/evidenceModel';
import { inOrder, periodText, stepsOf, swapPlan, type PackageRow } from './packagesModel';
import { usePackage, usePackageLog, type usePackageActions } from './packagesActions';

type Actions = ReturnType<typeof usePackageActions>;
type TabKey = 'contents' | 'details' | 'log';
const MUTED = 'text-ds-fg-muted';

const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const row = Array.from(document.querySelectorAll<HTMLElement>(`[data-row-id="${id}"]`)).find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

export function PackageStatus({ p }: { p: Pick<PackageRow, 'status' | 'is_legal_hold'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[4px]">
      <StatusPill size="sm" {...statusPill(packageStatus, p.status)} />
      {p.is_legal_hold && <StatusPill size="sm" tone="warning" label="Legal hold" />}
    </span>
  );
}

export function PackageRecord({ row, actions, canAdd, onAdd, onClose }: { row: PackageRow | null; actions: Actions; canAdd: boolean; onAdd: () => void; onClose: () => void }) {
  const id = row?.id ?? null;
  const [tab, setTab] = useState<TabKey>('contents');
  const detailQ = usePackage(id);
  const logQ = usePackageLog(id, tab === 'log');
  const detail = detailQ.data && detailQ.data.id === id ? detailQ.data : null;
  const p: PackageRow | null = detail ?? row;
  const steps = p ? stepsOf(p) : null;
  const items = detail ? inOrder(detail.evidence_items) : [];
  const b = actions.busy;

  const more: MenuItem[] = p && steps ? [
    { key: 'hold', label: p.is_legal_hold ? 'Remove legal hold' : 'Put on legal hold', icon: p.is_legal_hold ? Unlock : Lock, onSelect: () => actions.askHold(p) },
    { key: 'delete', label: 'Delete package', icon: Trash2, danger: true, disabled: !steps.remove.allowed, reason: steps.remove.why ?? undefined, onSelect: () => actions.askDelete(p) },
  ] : [];

  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={p?.name}>{p?.name}</span>}
      subtitle={p ? (p.framework_name ?? 'No framework') : undefined}
      dockFrom={Infinity}
      width="lg"
      restoreFocus={rowOf(id)}
      actions={p && <Menu label="More actions" iconOnly items={more} />}
      footer={p && steps && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {p.status === 'draft' && (
            <Button
              variant="primary" leftIcon={<FileCheck2 aria-hidden />} loading={b.finalize === p.id} disabled={!steps.finalize.allowed}
              title={steps.finalize.why ?? undefined} onClick={() => actions.askFinalize(p)}
            >
              Finalize
            </Button>
          )}
          {steps.exportable && (
            <Button variant={p.status === 'finalized' ? 'primary' : 'secondary'} leftIcon={<PackageCheck aria-hidden />} loading={b.export === p.id} onClick={() => actions.exportIt(p)}>
              {p.status === 'exported' ? 'Export again' : 'Export'}
            </Button>
          )}
          {steps.downloadable && <Button variant="primary" leftIcon={<Download aria-hidden />} loading={b.download === p.id} onClick={() => actions.download(p)}>Download</Button>}
          {p.status === 'draft' && !steps.finalize.allowed && steps.finalize.why && <span className={`text-ds-label ${MUTED}`}>{steps.finalize.why}</span>}
        </div>
      )}
    >
      {p && (
        <div key={p.id}>
          <div className="mb-[12px]"><PackageStatus p={p} /></div>
          <Tabs
            ariaLabel="Audit package"
            value={tab}
            onChange={setTab}
            tabs={[{ key: 'contents', label: 'Contents', count: detail ? detail.evidence_items.length : p.evidence_count }, { key: 'details', label: 'Details' }, { key: 'log', label: 'Access log' }]}
          >
            <div className="pt-[16px]">
              <TabPanel tabKey="contents">
                {detailQ.isLoading ? <SkeletonRows rows={5} columns={2} label="Loading the files" /> : detailQ.isError && !detail ? (
                  <ErrorState compact title="Couldn't load the package" message={errorMessage(detailQ.error)} onRetry={canRetry(detailQ.error) ? () => { void detailQ.refetch(); } : undefined} />
                ) : (
                  <div className="flex flex-col gap-[12px]">
                    {steps?.editable && canAdd && <div><Button leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add evidence</Button></div>}
                    {items.length === 0 ? (
                      <EmptyState bare kind="firstUse" title="No files yet" description={steps?.editable ? 'Add the approved files this package should hold.' : 'This package holds no files.'} />
                    ) : (
                      <ol className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
                        {items.map((it, i) => {
                          const e = it.evidence;
                          const file = e?.name ?? 'A file that is no longer in the library';
                          return (
                            <li key={it.id} className="flex items-start gap-[8px] py-[8px]">
                              <span className={`w-[24px] shrink-0 pt-[2px] text-right text-ds-label tabular-nums ${MUTED}`}>{i + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span dir="auto" className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{e ? file : <span className={MUTED}>{file}</span>}</span>
                                {e && (
                                  <span className="mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                                    <span className={`text-ds-label ${MUTED}`}>{[typeLabel(e.evidence_type), e.file_name].filter(Boolean).join(' · ')}</span>
                                    <StatusPill size="sm" {...statusPill(evidenceStatus, e.status)} />
                                  </span>
                                )}
                              </span>
                              {steps?.editable && (
                                <span className="flex shrink-0 items-center">
                                  <IconButton label={`Move ${file} up`} aria-disabled={i === 0 || undefined} onClick={() => { const plan = swapPlan(items, i, -1); if (plan) actions.move(p.id, plan); }}><ArrowUp aria-hidden /></IconButton>
                                  <IconButton label={`Move ${file} down`} aria-disabled={i === items.length - 1 || undefined} onClick={() => { const plan = swapPlan(items, i, 1); if (plan) actions.move(p.id, plan); }}><ArrowDown aria-hidden /></IconButton>
                                  <IconButton label={`Remove ${file} from the package`} onClick={() => actions.askRemoveItem(p.id, it.id, file)}><Trash2 aria-hidden /></IconButton>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </TabPanel>
              <TabPanel tabKey="details" lazy>
                <FactList min={180}>
                  <Fact label="Status"><PackageStatus p={p} /></Fact>
                  <Fact label="Framework" empty="Not set">{p.framework_name}</Fact>
                  <Fact label="Audit period" empty="Not set">{p.audit_period_start || p.audit_period_end ? periodText(p.audit_period_start, p.audit_period_end) : null}</Fact>
                  <Fact label="Files">{formatCount(detail ? detail.evidence_items.length : p.evidence_count)}</Fact>
                  <Fact label="Created by">{p.creator_name ? <PersonChip name={p.creator_name} /> : null}</Fact>
                  <Fact label="Created">{formatDateTime(p.created_at)}</Fact>
                  <Fact label="Finalized">{p.finalized_at ? formatDateTime(p.finalized_at) : null}</Fact>
                  <Fact label="Exported">{p.exported_at ? formatDateTime(p.exported_at) : null}</Fact>
                  <Fact label="Keep until" empty="Not set">{p.retention_until ? formatDate(p.retention_until, { calendar: true }) : null}</Fact>
                </FactList>
                {p.description && <p className="mt-[16px] whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{p.description}</p>}
              </TabPanel>
              <TabPanel tabKey="log" lazy>
                {logQ.isLoading ? <SkeletonRows rows={4} columns={2} label="Loading the access log" /> : logQ.isError && !logQ.data ? (
                  <ErrorState compact title="Couldn't load the access log" message={errorMessage(logQ.error)} onRetry={canRetry(logQ.error) ? () => { void logQ.refetch(); } : undefined} />
                ) : (logQ.data?.items ?? []).length === 0 ? (
                  <EmptyState bare kind="firstUse" title="No activity yet" description="Exports, downloads and legal hold changes are recorded here." />
                ) : (
                  <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
                    {(logQ.data?.items ?? []).map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] py-[8px]">
                        <StatusPill size="sm" {...statusPill(packageLog, l.action)} />
                        <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg">{l.user_name ?? 'Someone no longer here'}</span>
                        <span className={`shrink-0 text-ds-label ${MUTED}`}>{formatDateTime(l.accessed_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabPanel>
            </div>
          </Tabs>
        </div>
      )}
    </SidePanel>
  );
}
