'use client';

// Artifacts: the documents a framework asks an organisation to produce, as a catalogue (by stage, with what each one is for) and the person's own working
// copies of them. View reads the document made for an entry, Create starts a working copy to edit, assign, review and download. The tab is used by the
// framework journey, by the assessments' artifacts lens and (its modals) by a control's "Documents to produce" and the requirement popup: the exports
// below are the ones they have always imported. The rules are artifactsModel.ts; the four modals and the download menu are ArtifactModals.tsx.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle, Database, Download, Eye, FileText, Pencil, Plus, Search, Shield, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import {
  AccordionRow, Button, EmptyState, ErrorState, Menu, Notice, RegisterTable, SectionCard, SegmentedControl, Select, SkeletonRows, StatusPill, TextInput,
  useConfirm, useReportedMutation, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { EMPTY, UNASSIGNED, formatCount } from '@/lib/format';
import { artifactStatus } from '@/lib/statuses/frameworkRegisters';
import { buildArtifactTemplate } from './artifactTemplates';
import { downloadAsFormat } from './downloadUtils';
import { ArtifactDownload, CreateArtifactModal, EditArtifactModal, ViewArtifactModal } from './ArtifactModals';
import {
  createdByCatalogId, dataTypeWords, filterCatalog, groupByStage, mandatoryNote, stageCounts, stageName, suggestedFor,
  type CatalogData, type CatalogItem, type TenantArtifact, type TenantUser,
} from './artifactsModel';

// The names other pages import (a control's documents, the requirement popup, the assessments' artifacts lens).
export { ArtifactDownload, CreateArtifactModal, EditArtifactModal, ViewArtifactModal };
export type { CatalogItem, TenantArtifact, TenantUser };

const TYPE_ICON: Record<string, typeof FileText> = {
  Policy: BookOpen, Procedure: FileText, Register: Database, Report: FileText, Plan: FileText, Evidence: Shield, Attestation: CheckCircle, 'Record/Log': FileText, 'Form/Template': FileText, Standard: BookOpen,
};
const iconOf = (type: string) => TYPE_ICON[type] || FileText;

type View = 'catalog' | 'mine';

export default function ArtifactsTab({ assessmentId, assessmentType, tenantUsers, relevanceText }: {
  assessmentId?: number;
  assessmentType: string;
  tenantId?: number;
  tenantUsers: TenantUser[];
  /** When set (e.g. opened from a specific control), the catalogue shows a "Suggested for this control" shortlist ranked by the words it shares with this. */
  relevanceText?: string;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<View>('catalog');
  const [stage, setStage] = useState('all');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<TenantArtifact | null>(null);
  const [creating, setCreating] = useState<CatalogItem | null>(null);
  const [viewing, setViewing] = useState<CatalogItem | null>(null);

  const catalogQuery = useQuery<CatalogData>({
    queryKey: ['artifact-catalog', assessmentType],
    queryFn: async () => (await apiClient.get('/artifacts/catalog', { params: { assessment_type: assessmentType } })).data,
    staleTime: 5 * 60_000,
  });
  const mineKey = ['tenant-artifacts', assessmentId, assessmentType] as const;
  const mineQuery = useQuery<TenantArtifact[]>({
    queryKey: mineKey,
    queryFn: async () => {
      const params: Record<string, unknown> = { assessment_type: assessmentType };
      if (assessmentId != null) params.assessment_id = assessmentId;
      const r = await apiClient.get('/artifacts', { params });
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post('/artifacts', payload)).data,
    success: { title: 'Working copy started', message: 'You find it under My artifacts.' },
    failure: "Couldn't start the working copy",
    retryable: false,
    invalidate: [mineKey],
    onSuccess: () => { setCreating(null); setView('mine'); },
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; data: Partial<TenantArtifact> }) => (await apiClient.put(`/artifacts/${v.id}`, v.data)).data,
    success: 'Artifact saved',
    failure: "Couldn't save the artifact",
    invalidate: [mineKey],
    onSuccess: () => setEditing(null),
  });
  const remove = useReportedMutation({
    mutationFn: async (a: TenantArtifact) => { await apiClient.delete(`/artifacts/${a.id}`); },
    success: 'Artifact deleted',
    failure: "Couldn't delete the artifact",
    invalidate: [mineKey],
  });

  const catalog = catalogQuery.data;
  const items = catalog?.items ?? [];
  const mine = mineQuery.data ?? [];
  const frameworkName = catalog?.framework_name ?? null;
  const frameworkKey = catalog?.framework_key ?? assessmentType;
  const made = useMemo(() => createdByCatalogId(mine), [mine]);
  const counts = useMemo(() => stageCounts(items), [items]);
  const shown = useMemo(() => filterCatalog(items, stage, query), [items, stage, query]);
  const groups = useMemo(() => groupByStage(shown, catalog?.stages ?? []), [shown, catalog?.stages]);
  const suggested = useMemo(() => suggestedFor(items, relevanceText), [items, relevanceText]);
  const searching = query.trim() !== '' || stage !== 'all';

  const askDelete = async (a: TenantArtifact) => {
    if (await confirm({ title: 'Delete this artifact?', message: `"${a.name}" and what is written in it are removed. The catalogue entry it came from stays.`, confirmLabel: 'Delete artifact', tone: 'danger' })) remove.mutate(a);
  };
  const downloadTemplate = (item: CatalogItem) => downloadAsFormat(
    item.name,
    buildArtifactTemplate({
      name: item.name, artifactType: item.artifact_type, controlRef: item.control_ref, description: item.description, frameworkName: frameworkName ?? frameworkKey,
      frameworkKey, stage: item.stage, artifactId: item.artifact_id, owner: item.owner, format: item.format,
    }),
    item.format, item.artifact_type,
  );

  if (catalogQuery.isLoading) return <SkeletonRows rows={6} />;
  if (catalogQuery.error) {
    return <ErrorState title="Couldn't load the artifact catalogue" message={safeDetail(apiErrorText(catalogQuery.error, 'Please try again.'))} onRetry={() => { void catalogQuery.refetch(); }} />;
  }
  if (!frameworkName) {
    return <EmptyState kind="firstUse" title="No artifact catalogue for this framework" description="This framework has no list of artifacts to produce yet." />;
  }

  const mineMenu = (a: TenantArtifact): MenuItem[] => [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(a) },
    { key: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => { void askDelete(a); } },
  ];
  const mineActions = (a: TenantArtifact) => (
    <div className="flex items-center justify-end gap-[4px]">
      <ArtifactDownload artifact={a} />
      <Menu iconOnly label={`Actions for ${a.name}`} items={mineMenu(a)} />
    </div>
  );
  const mineColumns: RegisterColumn<TenantArtifact>[] = [
    {
      key: 'name', header: 'Artifact', isRowHeader: true,
      cell: (a) => (
        <div className="min-w-0">
          <span className="line-clamp-2 text-ds-body font-medium text-ds-fg" title={a.name.length > 70 ? a.name : undefined}>{a.name}</span>
          {a.is_platform_native && a.platform_data_type && <p className="text-ds-label text-ds-fg-muted">{`Live ${dataTypeWords(a.platform_data_type)} data · ${a.platform_record_count == null ? EMPTY : formatCount(a.platform_record_count)} records`}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', priority: 2, card: 'meta', cell: (a) => <span className="text-ds-body text-ds-fg-body">{a.artifact_type || EMPTY}</span> },
    { key: 'stage', header: 'Stage', priority: 3, card: 'meta', cell: (a) => <span className="line-clamp-2 text-ds-body text-ds-fg-body">{stageName(a.stage) || EMPTY}</span> },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (a) => (a.assigned_to_name ? <span className="text-ds-body text-ds-fg-body">{a.assigned_to_name}</span> : <span className="text-ds-body text-ds-fg-muted">{UNASSIGNED}</span>) },
    { key: 'status', header: 'Status', card: 'meta', cell: (a) => <StatusPill size="sm" tone={artifactStatus.tone(a.status)} label={artifactStatus.label(a.status)} /> },
    { key: '__actions', header: 'Actions', align: 'right', card: 'hide', width: 'w-[110px]', cell: mineActions },
  ];

  return (
    <SectionCard
      id="artifacts"
      title={`${frameworkName} artifacts`}
      info="View shows the document made for an artifact. Create starts a working copy you can edit, assign, send for review and download."
      meta={`${formatCount(items.length)} in the catalogue · ${mineQuery.isLoading ? EMPTY : formatCount(mine.length)} created`}
    >
      <div className="space-y-[12px]">
        <SegmentedControl<View>
          label="Show"
          name="artifact-view"
          value={view}
          onChange={setView}
          options={[
            { value: 'catalog', label: `Catalogue ${formatCount(items.length)}` },
            { value: 'mine', label: `My artifacts ${mineQuery.isLoading ? '' : formatCount(mine.length)}`.trim() },
          ]}
        />

        {view === 'catalog' && (
          <div className="space-y-[12px]">
            {mineQuery.error && <Notice tone="warning" title="Your working copies didn't load">The catalogue below can't say which artifacts you have already started.</Notice>}
            {suggested.length > 0 && (
              <section aria-label="Suggested for this control" className="rounded-ds-card border border-ds-border bg-ds-info-soft p-[12px]">
                <p className="mb-[8px] text-ds-body font-medium text-ds-fg">Suggested for this control</p>
                <ul className="space-y-[6px]">
                  {suggested.map((it) => (
                    <li key={it.id} className="flex flex-wrap items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[6px]">
                      <span className="min-w-0 flex-1 basis-[10rem] truncate text-ds-body text-ds-fg" title={it.name}>{it.name}</span>
                      <span className="text-ds-label text-ds-fg-muted">{it.artifact_type}</span>
                      <Button size="sm" leftIcon={<Eye aria-hidden />} onClick={() => setViewing(it)}>View</Button>
                      {!it.is_platform_native && <Button size="sm" leftIcon={<Download aria-hidden />} onClick={() => downloadTemplate(it)}>Template</Button>}
                    </li>
                  ))}
                </ul>
                <p className="mt-[6px] text-ds-label text-ds-fg-muted">Best matches for this control. Not the right one? Search the whole catalogue below.</p>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-[8px]">
              <TextInput aria-label="Search artifacts" placeholder="Search artifacts" value={query} onChange={(e) => setQuery(e.target.value)} leftAdornment={<Search aria-hidden className="h-[16px] w-[16px]" />} className="w-full sm:w-[260px]" />
              {(catalog?.stages?.length ?? 0) > 1 && (
                <Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-full sm:w-[280px]">
                  <option value="all">{`All stages (${formatCount(items.length)})`}</option>
                  {(catalog?.stages ?? []).map((s) => <option key={s} value={s}>{`${stageName(s) || s} (${formatCount(counts[s] ?? 0)})`}</option>)}
                </Select>
              )}
              {searching && <Button variant="link" onClick={() => { setQuery(''); setStage('all'); }}>Clear filters</Button>}
              {searching && <span className="text-ds-label text-ds-fg-muted" aria-live="polite">{`${formatCount(shown.length)} of ${formatCount(items.length)} shown`}</span>}
            </div>

            {groups.length === 0 ? (
              <EmptyState kind={items.length === 0 ? 'firstUse' : 'noMatches'} bare title={items.length === 0 ? 'The catalogue is empty' : 'No artifacts match'} description={items.length === 0 ? undefined : 'Nothing in the catalogue matches the search or the stage.'} onClearFilters={items.length === 0 ? undefined : () => { setQuery(''); setStage('all'); }} />
            ) : (
              <div className="space-y-[8px]">
                {groups.map((g, gi) => (
                  <AccordionRow
                    key={g.stage}
                    level={3}
                    region={false}
                    title={stageName(g.stage) || g.stage}
                    meta={g.stage.match(/Stage \d+/)?.[0]}
                    trailing={<span className="text-ds-label text-ds-fg-muted">{`${formatCount(g.items.length)} ${g.items.length === 1 ? 'artifact' : 'artifacts'}`}</span>}
                    open={searching || (opened[g.stage] ?? gi === 0)}
                    onOpenChange={(o) => setOpened((prev) => ({ ...prev, [g.stage]: o }))}
                  >
                    <ul className="divide-y divide-ds-border">
                      {g.items.map((it) => (
                        <CatalogRow key={it.id} item={it} frameworkKey={frameworkKey} created={made.has(it.id)} onView={() => setViewing(it)} onCreate={() => setCreating(it)} />
                      ))}
                    </ul>
                  </AccordionRow>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'mine' && (
          mineQuery.error ? (
            <ErrorState title="Couldn't load your artifacts" message={safeDetail(apiErrorText(mineQuery.error, 'Please try again.'))} onRetry={() => { void mineQuery.refetch(); }} />
          ) : (
            <RegisterTable
              caption="My artifacts"
              columns={mineColumns}
              rows={mine}
              getRowId={(a) => a.id}
              loading={mineQuery.isLoading}
              onRowActivate={setEditing}
              cardTitle={(a) => a.name}
              cardActions={mineActions}
              empty={<EmptyState kind="firstUse" bare title="No artifacts created yet" description="Start a working copy from the catalogue." action={<Button variant="primary" onClick={() => setView('catalog')}>Browse the catalogue</Button>} />}
            />
          )
        )}
      </div>

      {creating && (
        <CreateArtifactModal
          item={creating}
          frameworkKey={frameworkKey}
          frameworkName={frameworkName}
          assessmentId={assessmentId}
          tenantUsers={tenantUsers}
          onConfirm={(payload) => create.mutate(payload)}
          onClose={() => setCreating(null)}
          isPending={create.isPending}
        />
      )}
      {editing && (
        <EditArtifactModal artifact={editing} tenantUsers={tenantUsers} onSave={(data) => update.mutate({ id: editing.id, data })} onClose={() => setEditing(null)} isPending={update.isPending} />
      )}
      {viewing && (
        <ViewArtifactModal
          item={viewing}
          frameworkKey={frameworkKey}
          onClose={() => setViewing(null)}
          onCreate={viewing.is_platform_native ? undefined : () => { setCreating(viewing); setViewing(null); }}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}

/** One entry of the catalogue: what it is, what it is for, and View / Create (or "Created"). */
function CatalogRow({ item, frameworkKey, created, onView, onCreate }: { item: CatalogItem; frameworkKey: string; created: boolean; onView: () => void; onCreate: () => void }) {
  const Icon = iconOf(item.artifact_type);
  const facts = [item.artifact_type, item.control_ref, item.owner ? `Suggested owner: ${item.owner}` : '', item.format ? `Format: ${item.format}` : ''].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px] px-[4px] py-[10px]">
      <span aria-hidden className="mt-[2px] grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control bg-ds-surface-hover text-ds-fg-muted"><Icon className="h-[16px] w-[16px]" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1 basis-[14rem]">
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="text-ds-body font-medium text-ds-fg [overflow-wrap:anywhere]">{item.name}</span>
          {item.mandatory && <span title={mandatoryNote(frameworkKey)}><StatusPill size="sm" tone="warning" label="Mandatory" /></span>}
          {item.is_platform_native && <StatusPill size="sm" tone="pending" label="Live platform data" />}
          {item.has_content && !item.is_platform_native && <StatusPill size="sm" tone="success" label="Document ready" />}
        </div>
        {item.description && <p className="mt-[2px] line-clamp-2 text-ds-body text-ds-fg-body" title={item.description.length > 120 ? item.description : undefined}>{item.description}</p>}
        {facts && <p className="mt-[2px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{facts}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        <Button size="sm" leftIcon={<Eye aria-hidden />} aria-label={`View ${item.name}`} onClick={onView}>View</Button>
        {created ? <StatusPill size="sm" tone="success" label="Created" /> : (
          <Button size="sm" variant="primary" leftIcon={<Plus aria-hidden />} aria-label={`Create a working copy of ${item.name}`} onClick={onCreate}>Create</Button>
        )}
      </div>
    </li>
  );
}
