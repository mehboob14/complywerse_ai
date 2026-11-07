'use client';

// The KRI register (Risk Management > KRIs): the Facet explorer over every KRI the KRI report holds, in one request. A KRI's state is lib/erm/kri.ts, the same rule as the Overview's
// red KRIs and the KRI triggers tool; its definition and thresholds are edited in the finished metric form (governance/_metrics/MetricForm) with the linked risk (when it is
// created: the server takes the link at creation only) and the owner added to it. The page keeps what the old page did - create, edit, measure, delete, upload an Excel
// register - and every write says how it went, with Retry where repeating is safe. A failed or refused list is never an empty register.
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, Hand, Pencil, PencilLine, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, ClampedText, EmptyState, Combobox, Fact, FactList, FormField, Menu, PersonChip, ReadOnlyNote, StatusPill, useConfirm, useNotify, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import type { BulkActionDef } from '@/components/records/BulkBar';
import { Trash2 as TrashIcon } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, NOT_SET, UNASSIGNED, formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { kriStatus } from '@/lib/statuses/monitoring';
import { describeTrend, formatMetricValue, isDue, type MetricOption, type Template } from '../../governance/_metrics/metricModel';
import { MeasureDialog } from '../../governance/_metrics/MeasureDialog';
import { MetricForm, type Feed } from '../../governance/_metrics/MetricForm';
import { Sparkline } from '../../governance/_metrics/Sparkline';
import { ImportDialog } from './ImportDialog';
import { OwnerCell } from './cells';
import { RecordDetail, RegisterFrame } from './RegisterFrame';
import { ThresholdBar } from './ThresholdBar';
import { KRI_SCHEMA, KRI_NONE, kriDef, stateOfRow, type KriRow } from './kriModel';
import { personOptions, riskOptions, useCurrentUserId, useLeanRisks, useTenantUsers } from './lookups';

type Report = { kris: KriRow[]; summary: { total: number } };
const KEY = ['metric-report', 'kri'] as const;
const OTHER_KEYS = [['erm-kris'], ['erm-kri-alerts']] as const;
const retryLoad = (failures: number, error: unknown): boolean => canRetry(error) && failures < 3;
const MUTED = 'text-ds-fg-muted';

function SourceText({ k }: { k: KriRow }) {
  const Icon = k.is_live ? Zap : Hand;
  return (
    <span className={`inline-flex items-center gap-[6px] text-ds-body ${MUTED}`}>
      <Icon aria-hidden size={14} className="shrink-0" />
      <span className="min-w-0 break-words">{k.is_live ? k.module_label || 'Live' : 'Manual'}</span>
    </span>
  );
}

function DueText({ k }: { k: KriRow }) {
  if (k.is_live) return <span className={`text-ds-body ${MUTED}`}>{EMPTY}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <span className={`whitespace-nowrap text-ds-body ${k.next_due_date ? 'text-ds-fg-body' : MUTED}`}>{k.next_due_date ? formatDate(k.next_due_date, { calendar: true }) : NOT_SET}</span>
      {isDue(k.next_due_date, k.is_live) && <StatusPill size="sm" tone="danger" label="Due" />}
    </span>
  );
}

const ValueText = ({ k }: { k: KriRow }) => <span className="whitespace-nowrap font-[600] tabular-nums text-ds-fg">{formatMetricValue(k.current_value, k.unit)}</span>;
const StatePill = ({ k }: { k: KriRow }) => <StatusPill size="sm" {...statusPill(kriStatus, stateOfRow(k))} />;

export default function KriRegister({ label, tabs }: { label: string; tabs?: ReactNode }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canCreate = hasPermission('erm:kris:create');
  const canEdit = hasPermission('erm:kris:edit');
  const canDelete = hasPermission('erm:kris:delete');
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<KriRow | null | undefined>(undefined);          // undefined: the form is shut; null: a new KRI
  const [measuring, setMeasuring] = useState<KriRow | null>(null);
  const [uploading, setUploading] = useState(false);

  const report = useQuery({
    queryKey: KEY,
    queryFn: async () => (await ermApi.kris.report(90, 'kri')).data as Report,
    retry: retryLoad,
  });
  const rows = useMemo(() => (report.data?.kris ?? []).slice().sort((a, b) => a.id - b.id), [report.data]);
  const people = useTenantUsers();
  const me = useCurrentUserId();
  const def = useMemo(() => kriDef(me), [me]);

  const formOpen = editing !== undefined;
  const optionsQuery = useQuery({ queryKey: ['kri-metric-options'], queryFn: async () => (await ermApi.kris.metricOptions()).data as { metrics: MetricOption[] }, retry: retryLoad, enabled: formOpen });
  const templatesQuery = useQuery({ queryKey: ['kri-templates'], queryFn: async () => (await ermApi.kris.templates()).data as { templates: Template[] }, retry: retryLoad, enabled: formOpen });
  const risks = useLeanRisks(formOpen && editing === null);
  const feed = <T,>(q: { data?: unknown; isError: boolean; error: unknown; refetch: () => unknown }, items: T[]): Feed<T> => ({
    items, state: q.data ? 'ready' : q.isError ? 'error' : 'loading', error: q.error, retry: () => { void q.refetch(); },
  });
  const options: Feed<MetricOption> = feed(optionsQuery, optionsQuery.data?.metrics ?? []);
  const templates: Feed<Template> = feed(templatesQuery, (templatesQuery.data?.templates ?? []).filter((t) => t.kind === 'kri'));

  const refresh = [KEY as unknown as unknown[], ...OTHER_KEYS.map((k) => k as unknown as unknown[])];
  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await ermApi.kris.create(payload as never)).data,
    success: 'KRI created', failure: "Couldn't create the KRI", retryable: false, invalidate: refresh,
    onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => (await ermApi.kris.update(id, payload as never)).data,
    success: 'KRI saved', failure: "Couldn't save the KRI", invalidate: refresh,
    onSuccess: () => setEditing(undefined),
  });
  const measure = useReportedMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Parameters<typeof ermApi.kris.measure>[1] }) => (await ermApi.kris.measure(id, payload)).data,
    success: 'Measurement recorded', failure: "Couldn't record the measurement", retryable: false, invalidate: refresh,
    onSuccess: () => setMeasuring(null),
  });
  const remove = useReportedMutation({
    mutationFn: async (k: KriRow) => (await ermApi.kris.delete(k.id)).data,
    success: 'KRI deleted', failure: "Couldn't delete the KRI", invalidate: refresh,
  });

  const askDelete = async (k: KriRow, closeDetail?: () => void) => {
    const yes = await confirm({
      title: 'Delete this KRI?',
      message: `“${truncate(k.name, 80).text}” and its measurement history will be deleted. This can't be undone.`,
      confirmLabel: 'Delete KRI', tone: 'danger',
    });
    if (yes) { remove.mutate(k); closeDetail?.(); }
  };
  const bulkDelete = async (ids: number[], clear: () => void) => {
    const yes = await confirm({
      title: `Delete ${formatCount(ids.length)} KRIs?`, message: 'They and their measurement history will be deleted. This can\'t be undone.',
      confirmLabel: `Delete ${formatCount(ids.length)} KRIs`, tone: 'danger',
    });
    if (!yes) return;
    let failed = 0;
    for (const id of ids) {
      try { await ermApi.kris.delete(id); } catch { failed += 1; }
    }
    refresh.forEach((k) => { void qc.invalidateQueries({ queryKey: k }); });
    if (failed === 0) notify.success(`${formatCount(ids.length)} KRIs deleted`);
    else notify.error(`${formatCount(failed)} of ${formatCount(ids.length)} could not be deleted. The others are gone.`, { title: 'Some KRIs were not deleted' });
    clear();
  };

  const menuFor = (k: KriRow, closeDetail?: () => void): MenuItem[] => [
    { key: 'measure', label: 'Record measurement', icon: PencilLine, hidden: k.is_live, onSelect: () => setMeasuring(k) },
    { key: 'edit', label: 'Edit', icon: Pencil, hidden: !canEdit, onSelect: () => setEditing(k) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void askDelete(k, closeDetail); } },
  ];
  const rowActions = (k: KriRow) => <Menu iconOnly label={`Actions for ${truncate(k.name, 60).text}`} items={menuFor(k)} />;

  const columns: RecordColumn<KriRow>[] = [
    {
      key: 'name', header: 'KRI', sortKey: 'name',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.name}>{row.record.name}</span>
          <span className={`block truncate text-ds-label ${MUTED}`} title={row.record.risk_title ?? undefined}>{row.record.risk_title || 'Not linked to a risk'}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 112 }, cell: (row) => <StatePill k={row.record} /> },
    { key: 'value', header: 'Value', sortKey: 'value', firstDir: 'desc', fit: { px: 88 }, cell: (row) => <ValueText k={row.record} /> },
    { key: 'due', header: 'Next due', sortKey: 'due', fit: { px: 136 }, cell: (row) => <DueText k={row.record} /> },
    { key: 'trend', header: 'Trend', fit: { px: 140, dropRank: 1 }, cell: (row) => <Sparkline points={row.record.history} unit={row.record.unit} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 96, dropRank: 3, wide: { px: 168, titleMin: 400 } }, cell: (row, look) => <OwnerCell name={row.record.owner_name} wide={look.wide} /> },
    { key: 'source', header: 'Source', fit: { px: 110, dropRank: 2 }, cell: (row) => <SourceText k={row.record} /> },
  ];

  const card = (row: RecordRow<KriRow>) => {
    const k = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{k.name}</span>
        <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]"><StatePill k={k} /><ValueText k={k} /><DueText k={k} /></span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[k.risk_title || 'Not linked to a risk', k.owner_name || UNASSIGNED].join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (k: KriRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{k.name}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><StatePill k={k} /><ValueText k={k} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{k.owner_name || UNASSIGNED}</span>
    </>
  );

  const head = () => (
    <div className="flex min-w-0 flex-col gap-[8px]">
      <PageHeader
        variant="page"
        title={label}
        info="Key risk indicators: early-warning signals of exposure, rated against thresholds. Off target is past the amber threshold; the Overview counts the same ones."
        actions={(
          <>
            {canCreate && <Button leftIcon={<Upload aria-hidden />} onClick={() => setUploading(true)}>Upload</Button>}
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Add KRI</Button>}
            {!canCreate && !canEdit && !permsLoading && (
              <ReadOnlyNote>View only<InfoTip text="Only people who may create or edit KRIs can change them." label="Why KRIs are view only" /></ReadOnlyNote>
            )}
          </>
        )}
      />
      {tabs}
    </div>
  );

  const bulk = canDelete ? (ids: number[], clear: () => void) => ({
    actions: [{ id: 'delete', label: 'Delete', icon: TrashIcon, danger: true, onRun: () => { void bulkDelete(ids, clear); } } as BulkActionDef],
  }) : undefined;

  return (
    <>
      <RegisterFrame
        def={def}
        schema={KRI_SCHEMA}
        label={label}
        rows={rows}
        loading={report.isLoading}
        error={report.isError && !report.data ? report.error : undefined}
        refreshError={report.isError && report.data ? report.error : undefined}
        onRetry={() => { void report.refetch(); }}
        serverTotal={report.data?.summary?.total}
        head={head}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(k) => k.name}
        rowActions={rowActions}
        rowLabel={(k) => `Select ${truncate(k.name, 60).text}`}
        bulk={bulk}
        searchLabel="Search KRIs by name, category, linked risk, owner or source"
        noAccess={{ title: 'You don\'t have access to the KRIs', reason: errorMessage(report.error) }}
        emptyFirst={(
          <EmptyState bare kind="firstUse" title="No KRIs yet" description={canCreate ? 'Start from a template, or build your own.' : 'No KRIs have been set up yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Add KRI</Button> : undefined} />
        )}
        detail={(open, nav) => (
          <RecordDetail
            id={open?.id ?? null}
            nav={nav}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.name}>{open?.name}</span>}
            subtitle={open ? [open.category, open.is_live ? open.module_label || 'Live' : 'Entered by hand'].filter(Boolean).join(' · ') : undefined}
            actions={open ? <Menu label="More actions" iconOnly items={menuFor(open, nav.onClose).filter((m) => m.key !== 'measure')} /> : undefined}
            footer={open && !open.is_live ? <Button variant="primary" leftIcon={<PencilLine aria-hidden />} onClick={() => setMeasuring(open)}>Record measurement</Button> : undefined}
          >
            {open && <KriDetail k={open} />}
          </RecordDetail>
        )}
      />

      {formOpen && (
        <KriForm
          key={editing?.id ?? 'new'} kri={editing ?? null} options={options} templates={templates} people={personOptions(people.data)} peopleFailed={people.isError} risks={riskOptions(risks.data?.items)}
          risksFailed={risks.isError} saving={create.isPending || update.isPending}
          onSubmit={(payload) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate(payload))} onClose={() => setEditing(undefined)}
        />
      )}
      {measuring && (
        <MeasureDialog key={measuring.id} metric={measuring} saving={measure.isPending} onSubmit={(payload) => measure.mutate({ id: measuring.id, payload })} onClose={() => setMeasuring(null)} />
      )}
      {uploading && (
        <ImportDialog
          title="Upload KRIs" noun="KRIs" accept=".xlsx,.xls" extensions={/\.(xlsx|xls)$/i} onClose={() => setUploading(false)}
          onAdded={() => refresh.forEach((k) => { void qc.invalidateQueries({ queryKey: k }); })}
          run={async (file) => {
            const r = (await ermApi.kris.upload(file)).data;
            const lines = r.errors ?? [];
            return { message: r.message || `${r.created} KRIs added, ${r.skipped} skipped`, added: r.created ?? 0, errors: lines.slice(0, 8), moreErrors: Math.max(0, lines.length - 8) };
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}

/** The create / edit form: the finished metric form with the linked risk (a new KRI only) and the owner. */
function KriForm({ kri, options, templates, people, peopleFailed, risks, risksFailed, saving, onSubmit, onClose }: {
  kri: KriRow | null;
  options: Feed<MetricOption>;
  templates: Feed<Template>;
  people: Array<{ value: string; label: string; description?: string }>;
  peopleFailed: boolean;
  risks: Array<{ value: string; label: string; description?: string }>;
  risksFailed: boolean;
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState<string | null>(kri?.owner_id ? String(kri.owner_id) : null);
  const [risk, setRisk] = useState<string | null>(null);
  const ownerChanged = (kri?.owner_id ? String(kri.owner_id) : null) !== owner;
  const lead = (
    <>
      {kri === null ? (
        <FormField label="Linked risk" optional info="The risk this KRI watches. It can be set now and not changed later.">
          <Combobox label="Linked risk" options={risks} value={risk} onChange={setRisk} clearable placeholder={risksFailed ? 'The risks could not be loaded' : 'Not linked to a risk'} disabled={risksFailed} />
        </FormField>
      ) : (
        <Fact label="Linked risk">{kri.risk_title}</Fact>
      )}
      <FormField label="Owner" optional info="Who answers for this KRI.">
        <Combobox label="Owner" options={people} value={owner} onChange={setOwner} clearable placeholder={peopleFailed ? 'The people could not be loaded' : 'Unassigned'} disabled={peopleFailed} />
      </FormField>
    </>
  );
  return (
    <MetricForm
      kind="kri" metric={kri} options={options} templates={templates} saving={saving} onClose={onClose}
      lead={lead} leadDirty={risk !== null || ownerChanged}
      onSubmit={(payload) => onSubmit({
        ...payload,
        ...(kri === null && risk ? { risk_id: Number(risk) } : {}),
        ...(kri === null ? { owner_id: owner ? Number(owner) : null } : ownerChanged ? { owner_id: owner ? Number(owner) : null } : {}),
      })}
    />
  );
}

function KriDetail({ k }: { k: KriRow }) {
  const state = stateOfRow(k);
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <StatePill k={k} />
        <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatMetricValue(k.current_value, k.unit)}</span>
        {k.target != null && <span className={`text-ds-body ${MUTED}`}>{`target ${formatMetricValue(k.target, k.unit)}`}</span>}
      </div>
      <ThresholdBar kri={k} unit={k.unit} />
      <div>
        <p className="mb-[4px] text-ds-label text-ds-fg-muted">Trend</p>
        <Sparkline points={k.history} unit={k.unit} />
        <p className="mt-[4px] text-ds-label text-ds-fg-muted">{describeTrend(k.history, k.unit)}</p>
      </div>
      <FactList min={150}>
        <Fact label="Linked risk">{k.risk_id ? <Link href={`/erm/risks/${k.risk_id}`} className="inline-flex items-center gap-[4px] text-ds-primary-text underline-offset-2 hover:underline">{k.risk_title || `Risk ${k.risk_id}`}<ArrowUpRight aria-hidden size={14} /></Link> : <span className={MUTED}>Not linked to a risk</span>}</Fact>
        <Fact label="Owner"><PersonChip name={k.owner_name} /></Fact>
        <Fact label="Category" empty={NOT_SET}>{k.category}</Fact>
        <Fact label="Frequency">{k.frequency ? k.frequency.charAt(0).toUpperCase() + k.frequency.slice(1) : null}</Fact>
        <Fact label="Next due"><DueText k={k} /></Fact>
        <Fact label="Last measured">{k.last_measured_at ? formatDate(k.last_measured_at) : null}</Fact>
        <Fact label="Source"><SourceText k={k} /></Fact>
        <Fact label="Rating">{kriStatus.label(state)}</Fact>
      </FactList>
      {k.formula && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Definition</p><ClampedText text={k.formula} lines={4} /></div>}
      {k.description && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Description</p><ClampedText text={k.description} lines={4} /></div>}
    </div>
  );
}

export { KRI_NONE };
