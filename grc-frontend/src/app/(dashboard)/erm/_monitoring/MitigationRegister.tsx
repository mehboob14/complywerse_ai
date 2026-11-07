'use client';

// The mitigation-action register (Risk Management > Mitigation Actions): the Facet explorer over EVERY action of the tenant, read in one request (the page used to ask for each
// of the newest 100 risks in turn and showed none of the older ones). Add, edit, complete and delete are what they were, on the same URLs the workflow events read; completing
// now saves the achieved reduction (it used to be sent where the server does not read it, so the Overview's "Treatment effectiveness" could never fill). Overdue is a chip derived
// by the Overview's rule; a due date left blank stays blank.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Link2, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { AnimatedModal, PageHeader } from '@/components/ui';
import {
  Button, ClampedText, Combobox, EmptyState, ErrorState, Fact, FactList, FormField, Menu, PersonChip, StatusPill, TextInput, useConfirm, useNotify, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { BulkActionDef } from '@/components/records/BulkBar';
import { ermApi, evidenceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, UNASSIGNED, formatCount, formatDate, formatRelative, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { actionTiles, isOpenAction, isOverdueAction, parseReduction, reductionWords, shownStatus } from '@/lib/erm/mitigation';
import { mitigationStatus, severity, treatmentType } from '@/lib/statuses/monitoring';
import { ActionForm } from './ActionForm';
import { ACTION_SCHEMA, actionDef, type ActionRow } from './mitigationModel';
import { useCurrentUserId } from './lookups';
import { RecordDetail, RegisterFrame } from './RegisterFrame';

type Listed = { items: ActionRow[]; total: number };
const KEY = ['erm-mitigation-actions', 'all'] as const;
const MUTED = 'text-ds-fg-muted';
const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;
const STALE = [KEY as unknown as unknown[], ['erm-all-mitigation-actions'], ['erm-mitigation-actions-overdue'], ['mitigation-action-evidence']];

const StatePill = ({ a }: { a: ActionRow }) => <StatusPill size="sm" {...statusPill(mitigationStatus, shownStatus(a))} />;
const PriorityPill = ({ a }: { a: ActionRow }) => <StatusPill size="sm" {...statusPill(severity, a.priority)} />;

function DueText({ a }: { a: ActionRow }) {
  if (!a.due_date) return <span className={`text-ds-body ${MUTED}`}>Not set</span>;
  const late = isOverdueAction(a);
  return (
    <span className="flex flex-col">
      <span className={`whitespace-nowrap text-ds-body ${late ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>{formatDate(a.due_date, { calendar: true })}</span>
      {isOpenAction(a) && <span className={`whitespace-nowrap text-ds-label ${late ? 'text-ds-danger' : MUTED}`}>{formatRelative(a.due_date, new Date(), { calendar: true })}</span>}
    </span>
  );
}

export default function MitigationRegister({ label }: { label: string }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:mitigation_actions:create');
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<ActionRow | null | undefined>(undefined);
  const [completing, setCompleting] = useState<ActionRow | null>(null);
  const me = useCurrentUserId();
  const def = useMemo(() => actionDef(me), [me]);

  const list = useQuery({ queryKey: KEY, queryFn: async () => (await ermApi.mitigationActions.listAll({ limit: 5000 })).data as Listed, retry: retryLoad });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const tiles = useMemo(() => actionTiles(rows), [rows]);

  const create = useReportedMutation({
    mutationFn: async (v: { risk: number; payload: Record<string, unknown> }) => (await ermApi.mitigationActions.create(v.risk, v.payload as never)).data,
    success: 'Action added', failure: "Couldn't add the action", retryable: false, invalidate: STALE, onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; payload: Record<string, unknown> }) => (await ermApi.mitigationActions.update(v.id, v.payload as never)).data,
    success: 'Action saved', failure: "Couldn't save the action", retryable: false, invalidate: STALE, onSuccess: () => setEditing(undefined),
  });
  const complete = useReportedMutation({
    mutationFn: async (v: { id: number; reduction?: number }) => (await ermApi.mitigationActions.complete(v.id, v.reduction)).data,
    success: 'Action completed', failure: "Couldn't complete the action", retryable: false, invalidate: STALE, onSuccess: () => setCompleting(null),
  });
  const remove = useReportedMutation({
    mutationFn: async (a: ActionRow) => (await ermApi.mitigationActions.delete(a.id)).data,
    success: 'Action deleted', failure: "Couldn't delete the action", invalidate: STALE,
  });

  const askDelete = async (a: ActionRow, closeDetail?: () => void) => {
    const yes = await confirm({ title: 'Delete this action?', message: `“${truncate(a.title, 80).text}” will be deleted. This can't be undone.`, confirmLabel: 'Delete action', tone: 'danger' });
    if (yes) { remove.mutate(a); closeDetail?.(); }
  };
  const bulkDelete = async (ids: number[], clear: () => void) => {
    const yes = await confirm({ title: `Delete ${formatCount(ids.length)} actions?`, message: 'They will be deleted. This can\'t be undone.', confirmLabel: `Delete ${formatCount(ids.length)} actions`, tone: 'danger' });
    if (!yes) return;
    let failed = 0;
    for (const id of ids) {
      try { await ermApi.mitigationActions.delete(id); } catch { failed += 1; }
    }
    STALE.forEach((k) => { void qc.invalidateQueries({ queryKey: k }); });
    if (failed === 0) notify.success(`${formatCount(ids.length)} actions deleted`);
    else notify.error(`${formatCount(failed)} of ${formatCount(ids.length)} could not be deleted. The others are gone.`, { title: 'Some actions were not deleted' });
    clear();
  };

  const menuFor = (a: ActionRow, closeDetail?: () => void): MenuItem[] => [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(a) },
    { key: 'complete', label: 'Mark complete', icon: CheckCircle2, hidden: a.status === 'completed' || a.status === 'cancelled', onSelect: () => setCompleting(a) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(a, closeDetail); } },
  ];

  const columns: RecordColumn<ActionRow>[] = [
    {
      key: 'title', header: 'Action', sortKey: 'title',
      cell: (row) => (
        <RowLead row={row}>
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <span className={`block truncate text-ds-label ${MUTED}`} title={row.record.risk_title ?? undefined}>{row.record.risk_title || `Risk ${row.record.risk_id}`}</span>
        </RowLead>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 116 }, cell: (row) => <StatePill a={row.record} /> },
    { key: 'due', header: 'Due', sortKey: 'due', fit: { px: 124 }, cell: (row) => <DueText a={row.record} /> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', fit: { px: 96, dropRank: 2 }, cell: (row) => <PriorityPill a={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 72, dropRank: 3, wide: { px: 168, titleMin: 360 } }, cell: (row, look) => <PersonChip name={row.record.owner_name} className={look.wide ? undefined : '[&>span:last-child]:sr-only'} /> },
    { key: 'reduction', header: 'Reduction', fit: { px: 120, dropRank: 1 }, cell: (row) => <span className={`whitespace-nowrap text-ds-body ${MUTED}`}>{reductionWords(row.record)}</span> },
  ];
  const card = (row: RecordRow<ActionRow>) => {
    const a = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{a.title}</span>
        <span className="flex flex-wrap items-center gap-[8px]"><StatePill a={a} /><PriorityPill a={a} /></span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[a.risk_title || `Risk ${a.risk_id}`, a.due_date ? `due ${formatDate(a.due_date, { calendar: true })}` : 'no due date', a.owner_name || UNASSIGNED].join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (a: ActionRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]">{isOverdueAction(a) && <StatePill a={a} />}<PriorityPill a={a} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[a.risk_title || `Risk ${a.risk_id}`, a.due_date ? formatDate(a.due_date, { calendar: true }) : 'no date'].join(' · ')}</span>
    </>
  );

  const head = () => (
    <PageHeader
      variant="page"
      title={label}
      info="What is being done to treat each risk. Overdue means still to do and past its date; the Overview counts the same ones."
      meta={list.data ? `${formatCount(list.data.total)} actions · ${formatCount(tiles.open)} to do · ${formatCount(tiles.overdue)} overdue · ${formatCount(tiles.completedThisMonth)} completed this month` : undefined}
      actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Add action</Button> : undefined}
    />
  );
  const bulk = (ids: number[], clear: () => void) => ({ actions: [{ id: 'delete', label: 'Delete', icon: Trash2, danger: true, onRun: () => { void bulkDelete(ids, clear); } } as BulkActionDef] });

  return (
    <>
      <RegisterFrame
        def={def}
        schema={ACTION_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        serverTotal={list.data?.total}
        head={head}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(a) => a.title}
        rowActions={(a) => <Menu iconOnly label={`Actions for ${truncate(a.title, 60).text}`} items={menuFor(a)} />}
        rowLabel={(a) => `Select ${truncate(a.title, 60).text}`}
        bulk={bulk}
        searchLabel="Search actions by title, risk, owner or notes"
        noAccess={{ title: 'You don\'t have access to the mitigation actions', reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState bare kind="firstUse" title="No mitigation actions yet" description={canCreate ? 'Add the first action to treat a risk.' : 'No actions have been recorded yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Add action</Button> : undefined} />
        )}
        detail={(open, nav) => (
          <RecordDetail
            id={open?.id ?? null}
            nav={nav}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.title}>{open?.title}</span>}
            subtitle={open ? open.risk_title || `Risk ${open.risk_id}` : undefined}
            actions={open ? <Menu label="More actions" iconOnly items={menuFor(open, nav.onClose).filter((m) => m.key === 'delete')} /> : undefined}
            footer={open ? (
              <div className="flex flex-wrap items-center gap-[8px]">
                {open.status !== 'completed' && open.status !== 'cancelled' && <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} onClick={() => setCompleting(open)}>Mark complete</Button>}
                <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(open)}>Edit</Button>
              </div>
            ) : undefined}
          >
            {open && <ActionDetail a={open} />}
          </RecordDetail>
        )}
      />
      {editing !== undefined && (
        <ActionForm
          key={editing?.id ?? 'new'} action={editing} saving={create.isPending || update.isPending} onClose={() => setEditing(undefined)}
          onSubmit={(risk, payload) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate({ risk, payload }))}
        />
      )}
      {completing && <CompleteDialog action={completing} saving={complete.isPending} onClose={() => setCompleting(null)} onSubmit={(reduction) => complete.mutate({ id: completing.id, reduction })} />}
      {confirmDialog}
    </>
  );
}

function CompleteDialog({ action, saving, onSubmit, onClose }: { action: ActionRow; saving: boolean; onSubmit: (reduction?: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(action.expected_residual_reduction != null ? String(action.expected_residual_reduction) : '');
  const parsed = parseReduction(value);
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title="Mark this action complete"
      subtitle={truncate(action.title, 80).text}
      dirty={value !== (action.expected_residual_reduction != null ? String(action.expected_residual_reduction) : '')}
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={parsed === undefined} onClick={() => onSubmit(parsed === null ? undefined : parsed)}>Mark complete</Button></div>}
    >
      <div className="px-[20px] py-[16px]">
        <FormField label="Reduction achieved" optional error={parsed === undefined ? 'Enter a number from 0 to 100.' : undefined} hint="How much of the residual risk this action removed. It feeds the Overview's treatment effectiveness.">
          <TextInput type="number" inputMode="decimal" min={0} max={100} step="any" unit="%" value={value} onChange={(e) => setValue(e.target.value)} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}

function ActionDetail({ a }: { a: ActionRow }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canLink = hasPermission('erm:mitigation_actions:edit');
  const { confirm, confirmDialog } = useConfirm();
  const [pick, setPick] = useState<string | null>(null);
  const linked = useQuery({ queryKey: ['mitigation-action-evidence', a.id], queryFn: async () => (await ermApi.mitigationActions.getEvidence(a.id)).data, retry: 1 });
  const all = useQuery({
    queryKey: ['evidence-list-for-mitigation-link'], enabled: canLink,
    queryFn: async () => { const r = await evidenceApi.getAll(); return (Array.isArray(r.data) ? r.data : []) as unknown as Array<{ id: number; title?: string; evidence_type?: string }>; },
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['mitigation-action-evidence', a.id] }); void qc.invalidateQueries({ queryKey: KEY }); };
  const link = useReportedMutation({
    mutationFn: async (evidenceId: number) => (await ermApi.mitigationActions.linkEvidence(a.id, { evidence_id: evidenceId })).data,
    success: 'Evidence linked', failure: "Couldn't link the evidence", onSuccess: () => { setPick(null); refresh(); },
  });
  const unlink = useReportedMutation({
    mutationFn: async (linkId: number) => (await ermApi.mitigationActions.unlinkEvidence(a.id, linkId)).data,
    success: 'Evidence unlinked', failure: "Couldn't unlink the evidence", onSuccess: refresh,
  });
  const askUnlink = async (linkId: number, name: string) => {
    if (await confirm({ title: 'Unlink this evidence?', message: `“${truncate(name, 80).text}” stays in Evidence; it is only taken off this action.`, confirmLabel: 'Unlink', tone: 'danger' })) unlink.mutate(linkId);
  };
  const options = (all.data ?? []).filter((e) => !(linked.data ?? []).some((l) => l.evidence_id === e.id)).map((e) => ({ value: String(e.id), label: e.title || `Evidence ${e.id}`, description: e.evidence_type }));
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><StatePill a={a} /><PriorityPill a={a} /><StatusPill size="sm" {...statusPill(treatmentType, a.action_type)} /></div>
      <FactList min={150}>
        <Fact label="Risk">{<Link href={`/erm/risks/${a.risk_id}`} className="inline-flex items-center gap-[4px] text-ds-primary-text underline-offset-2 hover:underline">{a.risk_title || `Risk ${a.risk_id}`}<ArrowUpRight aria-hidden size={14} /></Link>}</Fact>
        <Fact label="Owner"><PersonChip name={a.owner_name} /></Fact>
        <Fact label="Due" empty="Not set">{a.due_date ? <DueText a={a} /> : null}</Fact>
        <Fact label="Completed">{a.completed_at ? formatDate(a.completed_at) : null}</Fact>
        <Fact label="Reduction">{reductionWords(a) === EMPTY ? null : reductionWords(a)}</Fact>
      </FactList>
      {a.description && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">What it involves</p><ClampedText text={a.description} lines={5} /></div>}
      {a.notes && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Notes</p><ClampedText text={a.notes} lines={4} /></div>}
      <section aria-label="Evidence">
        <p className="mb-[6px] text-ds-label text-ds-fg-muted">Evidence</p>
        {linked.isError && <ErrorState compact title="Couldn't read the evidence" message={errorMessage(linked.error)} onRetry={() => { void linked.refetch(); }} />}
        {linked.isLoading && <p role="status" className="text-ds-label text-ds-fg-muted">Reading the evidence…</p>}
        {linked.data && linked.data.length === 0 && <p className={`text-ds-body ${MUTED}`}>Nothing is attached to this action.</p>}
        {linked.data && linked.data.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {linked.data.map((l) => (
              <li key={l.id} className="flex items-center gap-[8px] rounded-ds-control border border-ds-border px-[10px] py-[4px]">
                <Link2 aria-hidden size={14} className="shrink-0 text-ds-fg-muted" />
                <span className="min-w-0 flex-1 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{l.title}</span>
                {canLink && <Button size="sm" variant="ghost" leftIcon={<Unlink aria-hidden />} onClick={() => { void askUnlink(l.id, l.title); }}>Unlink</Button>}
              </li>
            ))}
          </ul>
        )}
        {canLink && (
          <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
            <div className="min-w-[200px] flex-1">
              {all.isError ? <ErrorState compact title="Couldn't load the evidence list" onRetry={() => { void all.refetch(); }} /> : (
                <Combobox label="Link evidence" options={options} value={pick} onChange={setPick} clearable placeholder={all.isLoading ? 'Loading evidence…' : 'Choose evidence to link'} />
              )}
            </div>
            <Button disabled={!pick} loading={link.isPending} onClick={() => { if (pick) link.mutate(Number(pick)); }}>Link</Button>
          </div>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
