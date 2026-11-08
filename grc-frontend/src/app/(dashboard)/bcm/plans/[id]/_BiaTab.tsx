'use client';

// The "Business impact analysis" tab of a plan: a master-detail. The processes of the plan are a list on the left (the most critical first; each with its criticality and whether it has a recovery
// strategy), the open process is its panel on the right (BiaPanel: risk, assets, dependencies, strategies, Edit, Delete). It replaces the drawer that opened over the page for each process, so
// 10 to 40 processes are worked through without leaving the plan. The open process is in the address (?process=12); with none asked for, the first is open. On a phone it is a list, then a
// process with a way back. Choosing another process while the open one holds typing that would be lost asks first. Add process needs `bcm:bia:create`; the rest are the panel's.
import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, Plus } from 'lucide-react';
import { severity } from '@/lib/statuses/bcm';
import { Button, EmptyState, StatusPill, useAddressState, useConfirm } from '@/components/ui/ds';
import { integer } from '@/lib/addressState';
import { Pill } from '../../_bcm-ui';
import { masterDetail, orderedProcesses } from '../../_record/recordModel';
import { biaCompleteness, fmtHours, plural, type Bia } from '../../bcmModel';
import { BiaForm } from './_BiaForm';
import { BiaPanel } from './_BiaPanel';

const SCHEMA = { process: integer(0, { min: 1 }) };

function ProcessButton({ b, open, onPick }: { b: Bia; open: boolean; onPick: () => void }) {
  const done = biaCompleteness(b);
  return (
    <button
      type="button"
      aria-current={open ? 'true' : undefined}
      onClick={onPick}
      className={clsx(
        'flex w-full min-h-ds-control flex-col gap-[4px] rounded-ds-control border px-[10px] py-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring',
        open ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface hover:bg-ds-surface-hover',
      )}
    >
      <span dir="auto" title={b.process_name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{b.process_name}</span>
      <span className="flex flex-wrap items-center gap-x-[6px] gap-y-[4px]">
        <Pill registry={severity} word={b.criticality_rating} />
        {!done.complete && <StatusPill size="sm" tone="warning" label="Needs strategy" />}
        <span className="text-ds-label text-ds-fg-muted">{`RTO ${fmtHours(b.rto_hours)}`}</span>
      </span>
    </button>
  );
}

export function BiaTab({ planId, bia, canAdd, canEdit, canDelete, narrow }: { planId: number; bia: Bia[]; canAdd: boolean; canEdit: boolean; canDelete: boolean; narrow: boolean }) {
  const [address, setAddress] = useAddressState(SCHEMA);
  const { confirm, confirmDialog } = useConfirm();
  const dirty = useRef(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Bia | null>(null);

  const view = masterDetail(narrow, bia, address.process ? String(address.process) : null);
  const ordered = orderedProcesses(bia);

  const pick = async (id: number | null) => {
    if (dirty.current && !(await confirm({ title: 'Discard changes?', message: 'This process has changes you have not sent. Choosing another one throws them away.', confirmLabel: 'Discard', tone: 'danger' }))) return;
    dirty.current = false;
    setAddress({ process: id ?? 0 });
  };

  if (bia.length === 0) {
    return (
      <>
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            bare kind="firstUse" title="No business impact analysis yet"
            description={canAdd ? 'Add the critical processes this plan protects: how long each may be down, how much work may be lost, and how it will be recovered.' : 'No process has been added to this plan yet.'}
            action={canAdd ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add process</Button> : undefined}
          />
        </div>
        {adding && <BiaForm planId={planId} onClose={() => setAdding(false)} onSaved={(id) => setAddress({ process: id })} />}
      </>
    );
  }

  return (
    <>
      <div className={clsx(narrow ? 'flex flex-col gap-[12px]' : 'grid items-start gap-[16px] md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]')}>
        {view.list && (
          <section aria-label="Processes" className="flex min-w-0 flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px] px-[2px]">
              <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{plural(bia.length, 'process', 'processes')}</h3>
              {canAdd && <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add process</Button>}
            </div>
            <ul className="m-0 flex max-h-[70vh] list-none flex-col gap-[6px] overflow-y-auto p-0">
              {ordered.map((b) => (
                <li key={b.id}><ProcessButton b={b} open={view.panel?.id === b.id} onPick={() => { void pick(b.id); }} /></li>
              ))}
            </ul>
          </section>
        )}
        {view.panel && (
          <div className="flex min-w-0 flex-col gap-[8px]">
            {narrow && <Button variant="link" className="self-start" leftIcon={<ArrowLeft aria-hidden />} onClick={() => { void pick(null); }}>All processes</Button>}
            <BiaPanel
              key={view.panel.id}
              bia={view.panel}
              planId={planId}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={() => setEditing(view.panel)}
              onDeleted={() => { dirty.current = false; setAddress({ process: 0 }); }}
              onDirty={(d) => { dirty.current = d; }}
            />
          </div>
        )}
      </div>
      {adding && <BiaForm planId={planId} onClose={() => setAdding(false)} onSaved={(id) => setAddress({ process: id })} />}
      {editing && <BiaForm planId={planId} bia={editing} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </>
  );
}
