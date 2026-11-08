'use client';

// The incident register (Issue & Incident Management > Incidents): the Facet explorer over every incident (read whole, newest first), with a board by status and a details drawer.
// Report, edit, delete, import, the four kinds of link and the AI analysis are what they were; what changed is what the person sees: counts that are true (open, investigating and
// resolved-this-month come from the incidents themselves), words for every severity and status, a failed save that says so, and a form that cannot erase an incident's links.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, ChipList, ClampedText, EmptyState, ErrorState, Fact, FactList, Menu, PersonChip, StatusPill, useConfirm, useNotify, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import type { BulkActionDef } from '@/components/records/BulkBar';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { UNASSIGNED, formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatImpact, incidentTiles } from '@/lib/erm/incident';
import { incidentStatus, severity } from '@/lib/statuses/monitoring';
import { ImportDialog } from '@/components/records/ImportDialog';
import { IncidentAnalysis } from './IncidentAnalysis';
import { IncidentForm } from './IncidentForm';
import { INCIDENT_SCHEMA, incidentDef, linked, type IncidentRow } from './incidentModel';
import { useCurrentUserId } from '@/components/records/lookups';
import { OwnerCell } from '@/components/records/cells';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';

const KEY = ['erm-incidents', 'all'] as const;
const DASH = ['erm-incident-dashboard'] as const;
const MUTED = 'text-ds-fg-muted';
const LIMIT = 5000;
const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;

const SeverityPill = ({ i }: { i: IncidentRow }) => <StatusPill size="sm" {...statusPill(severity, i.severity)} />;
const StatePill = ({ i }: { i: IncidentRow }) => <StatusPill size="sm" {...statusPill(incidentStatus, i.status)} />;

export default function IncidentRegister({ label }: { label: string }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:incidents:create');
  const canDelete = hasPermission('erm:incidents:delete');
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<IncidentRow | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [analysing, setAnalysing] = useState<IncidentRow | null>(null);
  const me = useCurrentUserId();
  const def = useMemo(() => incidentDef(me), [me]);

  const list = useQuery({ queryKey: KEY, queryFn: async () => (await ermApi.incidents.getAll({ limit: LIMIT } as never)).data as IncidentRow[], retry: retryLoad });
  const dash = useQuery({ queryKey: DASH, queryFn: async () => (await ermApi.incidents.getDashboard()).data, retry: retryLoad });
  const rows = list.data ?? [];
  const tiles = useMemo(() => incidentTiles(dash.data, rows), [dash.data, rows]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: DASH }); void qc.invalidateQueries({ queryKey: ['erm-incidents'] }); };

  const stale = [KEY as unknown as unknown[], DASH as unknown as unknown[], ['erm-incidents'], ['erm-incident-links']];
  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await ermApi.incidents.create(payload as never)).data,
    success: 'Incident reported', failure: "Couldn't report the incident", retryable: false, invalidate: stale, onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; payload: Record<string, unknown> }) => (await ermApi.incidents.update(v.id, v.payload as never)).data,
    success: 'Incident saved', failure: "Couldn't save the incident", retryable: false, invalidate: stale, onSuccess: () => setEditing(undefined),
  });
  const remove = useReportedMutation({
    mutationFn: async (i: IncidentRow) => (await ermApi.incidents.delete(i.id)).data,
    success: 'Incident deleted', failure: "Couldn't delete the incident", invalidate: [KEY as unknown as unknown[], DASH as unknown as unknown[], ['erm-incidents']],
  });

  const askDelete = async (i: IncidentRow, closeDetail?: () => void) => {
    const yes = await confirm({ title: 'Delete this incident?', message: `“${truncate(i.title, 80).text}” and its links to risks, assets, vulnerabilities and evidence will be deleted. This can't be undone.`, confirmLabel: 'Delete incident', tone: 'danger' });
    if (yes) { remove.mutate(i); closeDetail?.(); }
  };
  const bulkDelete = async (ids: number[], clear: () => void) => {
    const yes = await confirm({ title: `Delete ${formatCount(ids.length)} incidents?`, message: 'They and their links will be deleted. This can\'t be undone.', confirmLabel: `Delete ${formatCount(ids.length)} incidents`, tone: 'danger' });
    if (!yes) return;
    let failed = 0;
    for (const id of ids) {
      try { await ermApi.incidents.delete(id); } catch { failed += 1; }
    }
    refresh();
    if (failed === 0) notify.success(`${formatCount(ids.length)} incidents deleted`);
    else notify.error(`${formatCount(failed)} of ${formatCount(ids.length)} could not be deleted. The others are gone.`, { title: 'Some incidents were not deleted' });
    clear();
  };

  const menuFor = (i: IncidentRow, closeDetail?: () => void): MenuItem[] => [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(i) },
    { key: 'analyse', label: 'AI analysis', icon: Sparkles, onSelect: () => setAnalysing(i) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void askDelete(i, closeDetail); } },
  ];

  const columns: RecordColumn<IncidentRow>[] = [
    {
      key: 'title', header: 'Incident', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{row.record.risk_title || 'Not linked to a risk'}</span>
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', sortKey: 'severity', fit: { px: 104 }, cell: (row) => <SeverityPill i={row.record} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 140 }, cell: (row) => <StatePill i={row.record} /> },
    { key: 'date', header: 'Date', sortKey: 'date', firstDir: 'desc', fit: { px: 116 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(row.record.incident_date, { calendar: true })}</span> },
    { key: 'assignee', header: 'Assignee', sortKey: 'assignee', fit: { px: 96, dropRank: 3, wide: { px: 168, titleMin: 400 } }, cell: (row, look) => <OwnerCell name={row.record.assignee_name} wide={look.wide} /> },
    { key: 'impact', header: 'Impact', sortKey: 'impact', firstDir: 'desc', fit: { px: 112, dropRank: 2 }, cell: (row) => <span className={`whitespace-nowrap tabular-nums text-ds-body ${row.record.financial_impact == null ? MUTED : 'text-ds-fg-body'}`}>{formatImpact(row.record.financial_impact)}</span> },
    { key: 'linked', header: 'Links', sortKey: 'linked', firstDir: 'desc', fit: { px: 72, dropRank: 1 }, cell: (row) => <span className={`tabular-nums text-ds-body ${MUTED}`}>{formatCount(linked(row.record))}</span> },
  ];
  const card = (row: RecordRow<IncidentRow>) => {
    const i = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{i.title}</span>
        <span className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={i} /><StatePill i={i} /></span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[formatDate(i.incident_date, { calendar: true }), i.assignee_name || UNASSIGNED].join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (i: IncidentRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{i.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={i} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[formatDate(i.incident_date, { calendar: true }), i.assignee_name || UNASSIGNED].join(' · ')}</span>
    </>
  );

  const meta = list.data
    ? [`${formatCount(dash.data?.total_incidents ?? rows.length)} incidents`, `${formatCount(tiles.open)} open`, `impact ${formatImpact(tiles.totalImpact)}`].join(' · ')
    : undefined;
  const head = () => (
    <PageHeader
      variant="page"
      title={label}
      info="Risk events that happened. Open counts incidents not yet resolved or closed; the impact is the sum of the financial impact recorded."
      meta={meta}
      actions={canCreate ? (
        <>
          <Button leftIcon={<Upload aria-hidden />} onClick={() => setImporting(true)}>Import</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Report incident</Button>
        </>
      ) : undefined}
    />
  );
  const bulk = canDelete ? (ids: number[], clear: () => void) => ({
    actions: [{ id: 'delete', label: 'Delete', icon: Trash2, danger: true, onRun: () => { void bulkDelete(ids, clear); } } as BulkActionDef],
  }) : undefined;

  return (
    <>
      <RegisterFrame
        def={def}
        schema={INCIDENT_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); void dash.refetch(); }}
        serverTotal={dash.data?.total_incidents}
        head={head}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(i) => i.title}
        rowActions={(i) => <Menu iconOnly label={`Actions for ${truncate(i.title, 60).text}`} items={menuFor(i)} />}
        rowLabel={(i) => `Select ${truncate(i.title, 60).text}`}
        bulk={bulk}
        searchLabel="Search incidents by title, risk, assignee, tag or description"
        noAccess={{ title: 'You don\'t have access to the incidents', reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState bare kind="firstUse" title="No incidents recorded" description={canCreate ? 'Report one, or import a file of them.' : 'No incidents have been recorded yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>Report incident</Button> : undefined} />
        )}
        detail={(open, nav) => (
          <RecordDetail
            id={open?.id ?? null}
            nav={nav}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.title}>{open?.title}</span>}
            subtitle={open ? `${formatDate(open.incident_date, { calendar: true })}${open.risk_title ? ` · ${open.risk_title}` : ''}` : undefined}
            actions={open ? <Menu label="More actions" iconOnly items={menuFor(open, nav.onClose).filter((m) => m.key === 'delete')} /> : undefined}
            footer={open ? (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(open)}>Edit</Button>
                <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setAnalysing(open)}>AI analysis</Button>
              </div>
            ) : undefined}
          >
            {open && <IncidentDetail i={open} />}
          </RecordDetail>
        )}
      />
      {editing !== undefined && (
        <IncidentForm key={editing?.id ?? 'new'} incident={editing} saving={create.isPending || update.isPending} onClose={() => setEditing(undefined)} onSubmit={(payload) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate(payload))} />
      )}
      {importing && (
        <ImportDialog
          title="Import incidents" noun="incidents" accept=".csv,.xlsx,.xls" extensions={/\.(csv|xlsx|xls)$/i} onClose={() => setImporting(false)} onAdded={refresh}
          template={async () => { await ermApi.incidents.downloadTemplate(); }}
          run={async (file) => {
            const r = (await ermApi.incidents.importIncidents(file)).data;
            const errors = r.errors ?? [];
            return { message: r.message || `${r.imported} of ${r.total_rows} incidents imported`, added: r.imported ?? 0, errors: errors.slice(0, 8), moreErrors: Math.max(0, (r.total_errors ?? errors.length) - 8) };
          }}
        />
      )}
      <IncidentAnalysis incident={analysing} onClose={() => setAnalysing(null)} />
      {confirmDialog}
    </>
  );
}

function IncidentDetail({ i }: { i: IncidentRow }) {
  const links = useQuery({ queryKey: ['erm-incident-links', i.id], queryFn: async () => (await ermApi.incidents.getLinks(i.id)).data, retry: 1, enabled: linked(i) > 0 });
  const names = links.data;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={i} /><StatePill i={i} /></div>
      <FactList min={150}>
        <Fact label="Date">{formatDate(i.incident_date, { calendar: true })}</Fact>
        <Fact label="Assigned to"><PersonChip name={i.assignee_name} /></Fact>
        <Fact label="Financial impact">{i.financial_impact != null ? formatImpact(i.financial_impact) : null}</Fact>
        <Fact label="Resolved">{i.resolved_at ? formatDate(i.resolved_at) : null}</Fact>
        <Fact label="Risk">{i.risk_id ? <Link href={`/erm/risks/${i.risk_id}`} className="inline-flex items-center gap-[4px] text-ds-primary-text underline-offset-2 hover:underline min-h-ds-control">{i.risk_title || `Risk ${i.risk_id}`}<ArrowUpRight aria-hidden size={14} /></Link> : null}</Fact>
        <Fact label="Tags"><ChipList items={i.tags} label="tags" shown={3} /></Fact>
      </FactList>
      {i.description && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">What happened</p><ClampedText text={i.description} lines={5} /></div>}
      {i.root_cause && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Root cause</p><ClampedText text={i.root_cause} lines={4} /></div>}
      {i.corrective_actions && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Corrective actions</p><ClampedText text={i.corrective_actions} lines={4} /></div>}
      {i.operational_impact && <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Operational impact</p><ClampedText text={i.operational_impact} lines={4} /></div>}
      {linked(i) > 0 && (
        <div>
          <p className="mb-[6px] text-ds-label text-ds-fg-muted">Linked records</p>
          {links.isError && <ErrorState compact title="Couldn't read the links" onRetry={() => { void links.refetch(); }} />}
          {links.isLoading && <p role="status" className="text-ds-label text-ds-fg-muted">Reading the links…</p>}
          {names && (
            <FactList min={170}>
              <Fact label="Risks"><ChipList items={names.risks.map((r) => ({ label: r.title || `Risk ${r.risk_id}`, href: `/erm/risks/${r.risk_id}` }))} label="risks" shown={2} /></Fact>
              <Fact label="Assets"><ChipList items={names.assets.map((a) => a.name || `Asset ${a.asset_id}`)} label="assets" shown={2} /></Fact>
              <Fact label="Vulnerabilities"><ChipList items={names.vulnerabilities.map((v) => v.title || v.cve_id || `Vulnerability ${v.vulnerability_id}`)} label="vulnerabilities" shown={2} /></Fact>
              <Fact label="Evidence"><ChipList items={names.evidence.map((e) => e.name || `Evidence ${e.evidence_id}`)} label="evidence" shown={2} /></Fact>
            </FactList>
          )}
        </div>
      )}
    </div>
  );
}
