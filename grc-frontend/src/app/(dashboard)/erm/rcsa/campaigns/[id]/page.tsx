'use client';

export const dynamic = 'force-dynamic';

// RCSA > a campaign: the risk team's workspace for one round of self-assessment. The head says where it stands (status, questionnaire, the two days) and holds the actions the server
// really supports (start, close, delete, change the details, add units); a band of figures says how far it is (approved, waiting for review, not finished, open findings, the average
// residual); then three tabs — Units (the table every chaser needs: who has not started, who is waiting for review, each row opening its unit), Findings, and Setup. The old page's
// "Send reminders" and "Export results" called routes that do not exist and are gone: nothing is emailed by the platform, and the units export is a CSV made here from the rows shown.
// Request: the campaign's detail (units with progress and scores); the findings tab and the pickers load only when used, each with its own states.
import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Pencil, Play, Plus } from 'lucide-react';
import { rcsaApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, FilterChips, Menu, Notice, PersonChip, ProgressBar, RegisterTable, SectionCard, SkeletonRows, StatTile, StatusPill, TabPanel, Tabs, TitleLink, sortRows, useTabParam,
  type FilterChip, type MenuItem, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { assessmentStatus, campaignStatus, findingSeverity, findingStatus } from '@/lib/statuses/rcsa';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { dueWords, isLate, sortUnits, unassigned, unfinished, type CampaignRow, type UnitRow } from '@/lib/rcsa/campaignsModel';
import { controlText, percent, progressTone, riskText } from '@/lib/rcsa/scores';
import { KEYS, fetchAll, useRcsaRights } from '../../_parts/rcsaData';
import { useCampaignActions } from '../_parts/useCampaignActions';
import { AddUnitsSheet, EditCampaignSheet } from './_parts/CampaignSheets';

interface Detail {
  id: number; tenant_id: number; name: string; description: string | null; template_id: number; template_name: string | null; created_by_name: string | null; status_counts: Record<string, number>;
  status: string; period: string | null; start_date: string | null; end_date: string | null; progress: number; assigned_units: number; completed_units: number; pending_assessments: number;
  assessments: UnitRow[]; total_findings: number; avg_risk_score: number | null; avg_control_score: number | null;
}
interface Finding { id: number; title: string; severity: string; status: string; campaign_id: number | null; business_unit_name: string | null; remediation_owner_name: string | null; remediation_due_date: string | null }

const TABS = ['units', 'findings', 'setup'] as const;
const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'notstarted', label: 'Not started', test: (u: UnitRow) => u.status === 'not_started' },
  { key: 'working', label: 'In progress', test: (u: UnitRow) => u.status === 'in_progress' || u.status === 'requires_changes' },
  { key: 'review', label: 'Waiting for review', test: (u: UnitRow) => u.status === 'submitted' || u.status === 'under_review' },
  { key: 'done', label: 'Approved', test: (u: UnitRow) => u.status === 'approved' },
] as const;

const asCampaign = (d: Detail): CampaignRow => ({
  id: d.id, name: d.name, template_id: d.template_id, template_name: d.template_name, start_date: d.start_date ?? '', due_date: d.end_date ?? '', status: d.status,
  assessment_count: d.assigned_units, completed_count: d.completed_units, period_label: d.period,
});

function Workspace() {
  const params = useParams();
  const id = Number(Array.isArray(params?.id) ? params.id[0] : params?.id);
  const valid = Number.isFinite(id) && id > 0;
  const detail = useQuery({ queryKey: KEYS.campaign(id), queryFn: async () => (await rcsaApi.getCampaignDetail(id)).data as Detail, enabled: valid, retry: (n, e) => n < 1 && statusOf(e) !== 404 });
  const d = detail.data;
  if (!valid) return <ErrorState title="This campaign doesn't exist" message="Check the address, or open it from the campaigns list." />;
  if (detail.isLoading) return <div className="flex flex-col gap-[16px]" aria-busy="true"><SkeletonRows rows={3} columns={3} label="Loading the campaign" /><SkeletonRows rows={6} columns={4} label="Loading the units" /></div>;
  if (detail.isError || !d) {
    const gone = statusOf(detail.error) === 404;
    return <ErrorState title={gone ? "This campaign doesn't exist" : "Couldn't load the campaign"} message={gone ? 'It may have been deleted, or you may not have access to it.' : errorMessage(detail.error)} onRetry={!gone && canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />;
  }
  return <CampaignBody d={d} />;
}

function CampaignBody({ d }: { d: Detail }) {
  const router = useRouter();
  const { manage } = useRcsaRights();
  const [tab, setTab] = useTabParam('tab', TABS, { fallback: 'units' });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [sort, setSort] = useState<SortState>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const campaign = asCampaign(d);
  const actions = useCampaignActions(manage, () => router.push('/erm/rcsa/campaigns'));
  const late = isLate(campaign);
  const units = useMemo(() => sortUnits(d.assessments), [d.assessments]);
  const test = FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
  const shown = units.filter(test);
  const ordered = sort
    ? sortRows(shown, sort, (u, key) => (key === 'unit' ? u.business_unit_name : key === 'assessor' ? u.assessor_name : key === 'progress' ? u.progress : key === 'risk' ? u.risk_score : key === 'findings' ? u.findings_count : key === 'status' ? u.status : u.submitted_at))
    : shown;
  const chips: FilterChip[] = FILTERS.map((f) => ({ key: f.key, label: f.label, count: units.filter(f.test).length, active: f.key === filter }));
  const pill = statusPill(campaignStatus, d.status);
  const left = unfinished(units).length;
  const review = (d.status_counts.submitted ?? 0) + (d.status_counts.under_review ?? 0);

  const findings = useQuery({ queryKey: [...KEYS.findings, 'campaign', d.id], queryFn: async () => (await fetchAll<Finding>('/erm/rcsa/findings')).filter((f) => f.campaign_id === d.id), enabled: tab === 'findings' });

  const exportUnits = () => {
    const lines = ordered.map((u) => [u.business_unit_name, u.assessor_name ?? '', statusPill(assessmentStatus, u.status).label, u.progress, u.risk_score ?? '', u.control_score ?? '', u.findings_count, u.submitted_at ? formatDate(u.submitted_at) : '']);
    saveBlob(new Blob([toCsv(['Unit', 'Assessor', 'Status', 'Answered %', 'Residual', 'Controls', 'Findings', 'Submitted'], lines)], { type: 'text/csv;charset=utf-8' }), csvName('campaign-units'));
  };
  const more: MenuItem[] = [
    { key: 'edit', label: 'Edit details', icon: Pencil, hidden: !manage || d.status === 'closed', onSelect: () => setEditing(true) },
    { key: 'units', label: 'Add units', icon: Plus, hidden: !manage || d.status === 'closed', onSelect: () => setAdding(true) },
    { key: 'export', label: 'Export units (CSV)', icon: Download, onSelect: exportUnits },
    ...actions.items(campaign).filter((i) => i.key !== 'start'),
  ];
  const facts: Array<[string, ReactNode]> = [
    ['Questionnaire', d.template_name ? <TitleLink key="t" href={`/erm/rcsa/templates/${d.template_id}`} title={d.template_name} prefetch={false} /> : '—'],
    ['Period', d.period || '—'],
    ['Owner', d.created_by_name || '—'],
    ['Starts', formatDate(d.start_date, { calendar: true })],
    ['Due', formatDate(d.end_date, { calendar: true })],
    ['Units', formatCount(d.assigned_units)],
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={d.name}
        back={{ href: '/erm/rcsa/campaigns', label: 'Back to campaigns' }}
        meta={[d.template_name, d.period, d.start_date && d.end_date ? `${formatDate(d.start_date, { calendar: true })} to ${formatDate(d.end_date, { calendar: true })}` : null].filter(Boolean).join(' · ')}
        chips={(
          <>
            <StatusPill {...pill} />
            {d.status === 'active' && d.end_date && <StatusPill tone={late ? 'danger' : 'neutral'} label={dueWords(campaign)} />}
          </>
        )}
        actions={(
          <>
            {manage && d.status === 'draft' && <Button variant="primary" leftIcon={<Play aria-hidden />} loading={actions.busy} onClick={() => actions.ask.activate(campaign)}>Start campaign</Button>}
            <Menu label="More" items={more} />
          </>
        )}
      />

      {d.status === 'draft' && <Notice tone="info" title="This campaign has not started">{manage ? 'Nobody has been asked yet. Start it when the units and the days are right.' : 'It has not been started by the risk team yet.'}</Notice>}
      {d.status === 'closed' && <Notice tone="info" title="This campaign is closed">Units can no longer be answered. Approved answers and findings are kept.</Notice>}

      <div className="grid gap-[12px] sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Approved" value={`${formatCount(d.completed_units)} of ${formatCount(d.assigned_units)}`} unit="units" progress={percent(d.completed_units, d.assigned_units)} tone={progressTone(percent(d.completed_units, d.assigned_units), late) === 'danger' ? 'danger' : 'default'} />
        <StatTile label="Waiting for review" value={formatCount(review)} unit={review === 1 ? 'unit' : 'units'} />
        <StatTile label="Not finished" value={formatCount(left)} unit={left === 1 ? 'unit' : 'units'} note={unassigned(units).length > 0 ? `${formatCount(unassigned(units).length)} with no assessor` : undefined} tone={late && left > 0 ? 'danger' : 'default'} />
        <StatTile label="Open findings" value={formatCount(units.reduce((n, u) => n + (u.open_findings_count ?? 0), 0))} note={`${formatCount(d.total_findings)} raised in all`} />
        <StatTile label="Average residual" value={d.avg_risk_score == null ? null : riskText(d.avg_risk_score)} note={d.avg_control_score == null ? undefined : `Controls ${controlText(d.avg_control_score)}`} info="The mean of the units' scores, likelihood times impact." />
      </div>

      <Tabs tabs={[{ key: 'units', label: 'Units', count: units.length }, { key: 'findings', label: 'Findings', count: d.total_findings }, { key: 'setup', label: 'Setup' }]} value={tab} onChange={setTab} ariaLabel="Campaign sections" countFormat="exact">
        <TabPanel tabKey="units" className="pt-[12px]">
          <div className="flex flex-col gap-[12px]">
            <FilterChips label="Show units" chips={chips} onToggle={(k) => setFilter(k as typeof filter)} />
            <RegisterTable<UnitRow>
              caption={`Units of ${d.name}`}
              rows={ordered}
              getRowId={(u) => u.id}
              sort={sort}
              onSortChange={setSort}
              onRowActivate={(u) => router.push(`/erm/rcsa/assessments/${u.id}`)}
              empty={units.length === 0 ? (
                <EmptyState kind="firstUse" title="This campaign has no units yet" description={d.status === 'draft' ? 'Starting it makes every active department a unit.' : 'Add the business units that should answer.'} action={manage && d.status !== 'closed' ? <Button leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add units</Button> : undefined} />
              ) : <EmptyState kind="noMatches" title="No unit matches" description="Choose another status above." onClearFilters={() => setFilter('all')} />}
              footer={<p className="mt-[8px] text-ds-label text-ds-fg-muted">{`${formatCount(ordered.length)} of ${formatCount(units.length)} ${units.length === 1 ? 'unit' : 'units'}`}</p>}
              cardTitle={(u) => <TitleLink href={`/erm/rcsa/assessments/${u.id}`} title={u.business_unit_name} prefetch={false} />}
              columns={[
                { key: 'unit', header: 'Unit', sortable: true, isRowHeader: true, cell: (u) => <TitleLink href={`/erm/rcsa/assessments/${u.id}`} title={u.business_unit_name} prefetch={false} /> },
                { key: 'assessor', header: 'Assessor', sortable: true, priority: 2, card: 'meta', cell: (u) => <PersonChip name={u.assessor_name} /> },
                { key: 'status', header: 'Status', sortable: true, card: 'meta', cell: (u) => <span className="inline-flex flex-wrap items-center gap-[6px]"><StatusPill size="sm" {...statusPill(assessmentStatus, u.status)} />{(u.status === 'submitted' || u.status === 'under_review') && (u.current_approval_tier ?? 0) > 1 ? <span className="text-ds-label text-ds-fg-muted">{`step ${u.current_approval_tier}`}</span> : null}</span> },
                { key: 'progress', header: 'Answered', sortable: true, priority: 2, width: 'w-[150px]', card: 'meta', cell: (u) => <ProgressBar value={u.progress} label={`${u.business_unit_name} answered`} tone={u.progress >= 100 ? 'success' : 'primary'} /> },
                { key: 'risk', header: 'Residual', sortable: true, priority: 3, card: 'meta', cell: (u) => <span className="text-ds-body text-ds-fg">{riskText(u.risk_score)}</span> },
                { key: 'controls', header: 'Controls', priority: 3, card: 'meta', cell: (u) => <span className="text-ds-body text-ds-fg">{controlText(u.control_score)}</span> },
                { key: 'findings', header: 'Findings', sortable: true, priority: 3, align: 'right', card: 'meta', cell: (u) => <span className="text-ds-body tabular-nums text-ds-fg">{formatCount(u.findings_count)}</span> },
                { key: 'submitted', header: 'Submitted', sortable: true, priority: 3, cell: (u) => <span className="whitespace-nowrap text-ds-body text-ds-fg-muted">{u.submitted_at ? formatDateTime(u.submitted_at) : '—'}</span> },
              ]}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="findings" lazy className="pt-[12px]">
          <SectionCard id="campaign-findings" title="Findings" meta={findings.data ? `${formatCount(findings.data.length)} in this campaign` : undefined} actions={<Button size="sm" href="/erm/rcsa/findings">Findings register</Button>}>
            {findings.isLoading && <SkeletonRows rows={3} columns={3} label="Loading the findings" />}
            {findings.isError && <ErrorState compact title="Couldn't load the findings" message={errorMessage(findings.error)} onRetry={() => { void findings.refetch(); }} />}
            {findings.data && findings.data.length === 0 && <p className="text-ds-body text-ds-fg-muted">No finding has been raised in this campaign.</p>}
            {findings.data && findings.data.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0">
                {findings.data.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border py-[8px] first:border-t-0">
                    <TitleLink href={`/erm/rcsa/findings?open=${f.id}`} title={f.title} prefetch={false} className="min-w-0 flex-1" />
                    <span className="text-ds-label text-ds-fg-muted">{f.business_unit_name}</span>
                    <StatusPill size="sm" {...statusPill(findingSeverity, f.severity)} />
                    <StatusPill size="sm" {...statusPill(findingStatus, f.status)} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabPanel>
        <TabPanel tabKey="setup" lazy className="pt-[12px]">
          <SectionCard id="setup" title="Setup" actions={manage && d.status !== 'closed' ? <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit details</Button> : undefined}>
            <dl className="m-0 grid gap-x-[16px] gap-y-[12px] sm:grid-cols-2 lg:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0"><dt className="text-ds-label text-ds-fg-muted">{label}</dt><dd className="mt-[2px] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{value}</dd></div>
              ))}
            </dl>
            {d.description && <p className="mt-[12px] whitespace-pre-line text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{d.description}</p>}
            <p className="mt-[12px] text-ds-label text-ds-fg-muted">Nobody is emailed by the platform: units appear on their assessors&apos; worklists.</p>
          </SectionCard>
        </TabPanel>
      </Tabs>

      {manage && <EditCampaignSheet key={`e${editing}`} open={editing} details={d} onClose={() => setEditing(false)} />}
      {manage && <AddUnitsSheet key={`a${adding}`} open={adding} campaignId={d.id} tenantId={d.tenant_id} taken={units.map((u) => u.business_unit_id)} onClose={() => setAdding(false)} />}
      {actions.dialog}
    </div>
  );
}

export default function RcsaCampaignPage() {
  return <Suspense fallback={null}><Workspace /></Suspense>;
}
