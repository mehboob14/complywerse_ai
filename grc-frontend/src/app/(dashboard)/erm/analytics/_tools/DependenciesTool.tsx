'use client';

// The dependencies tool: which risks cause or amplify others, and what one risk sets off downstream. A dependency is source -> target with a type and a strength (1 to 5, sent as the
// `impact_factor` the server stores and multiplies the target's score by: lib/erm/dependency.ts); the cascade card reads the fields the server really sends (the source, its score, the
// nested risks it reaches and the total of the first level) - it used to look for names the server does not use and showed an empty card. Add and delete keep today's rights.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import { integer, text } from '@/lib/addressState';
import { RightSlidePanel } from '@/components/ui';
import {
  Button, Combobox, EmptyState, ErrorState, FormField, IconButton, Menu, NoAccessState, Notice, Pager, RegisterTable, SegmentedControl, SkeletonRows, StatTile, StatusPill, Textarea, TextInput, useAddressState, useConfirm,
  useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, truncate } from '@/lib/format';
import { DEFAULT_STRENGTH, DEPENDENCY_TYPES, dependencyError, factorOfStrength, flattenCascade, reachedCount, strengthWords, STRENGTHS, type CascadeResult } from '@/lib/erm/dependency';
import { statusPill } from '@/lib/status';
import { dependencyType, optionsOf } from '@/lib/statuses/monitoring';
import { riskOptions, useLeanRisks } from '../../_monitoring/lookups';
import { clampPage, pageSlice } from '../../_monitoring/registerModel';

interface Dep { id: number; source_risk_id: number; target_risk_id: number; dependency_type: string; impact_factor: number; description?: string | null; source_risk_title?: string | null; target_risk_title?: string | null }
const SCHEMA = { risk: integer(0, { min: 1 }), q: text() };
const KEY = ['erm-dependencies'] as const;
const PAGE = 25;
const num = 'tabular-nums text-ds-body text-ds-fg-body';

export function DependenciesTool() {
  const [a, set] = useAddressState(SCHEMA);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risk_assessments:create');
  const canDelete = hasPermission('erm:risk_assessments:delete');
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const risks = useLeanRisks();
  const deps = useQuery({ queryKey: KEY, queryFn: async () => (await ermApi.dependencies.getAll()).data as unknown as Dep[], retry: 1 });
  const cascade = useQuery({ queryKey: ['erm-cascade-analysis', a.risk], queryFn: async () => (await ermApi.dependencies.getCascadeAnalysis(a.risk)).data as unknown as CascadeResult, enabled: a.risk > 0, retry: 1 });

  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await ermApi.dependencies.create(payload as never)).data,
    success: 'Dependency added', failure: "Couldn't add the dependency", retryable: false, invalidate: [KEY as unknown as unknown[], ['erm-cascade-analysis']], onSuccess: () => setAdding(false),
  });
  const remove = useReportedMutation({
    mutationFn: async (d: Dep) => (await ermApi.dependencies.delete(d.id)).data,
    success: 'Dependency removed', failure: "Couldn't remove the dependency", invalidate: [KEY as unknown as unknown[], ['erm-cascade-analysis']],
  });
  const askRemove = async (d: Dep) => {
    if (await confirm({ title: 'Remove this dependency?', message: `“${truncate(d.source_risk_title ?? '', 60).text}” will no longer be counted as affecting “${truncate(d.target_risk_title ?? '', 60).text}”. The risks are not changed.`, confirmLabel: 'Remove dependency', tone: 'danger' })) remove.mutate(d);
  };

  const terms = a.q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = useMemo(() => deps.data ?? [], [deps.data]);
  const matches = useMemo(() => all.filter((d) => terms.every((t) => `${d.source_risk_title ?? ''} ${d.target_risk_title ?? ''}`.toLowerCase().includes(t))), [all, a.q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pages = clampPage(page, matches.length, PAGE);
  const refused = statusOf(deps.error) === 403;

  const columns: RegisterColumn<Dep>[] = [
    { key: 'source', header: 'Risk', isRowHeader: true, cell: (d) => <Link href={`/erm/risks/${d.source_risk_id}`} className="inline-flex min-h-ds-control items-center font-[600] text-ds-fg underline-offset-2 hover:underline"><span className="line-clamp-2 break-words">{d.source_risk_title || `Risk ${d.source_risk_id}`}</span></Link> },
    { key: 'type', header: 'Relation', width: 'w-[150px]', card: 'meta', cell: (d) => <span className="flex items-center gap-[6px]"><StatusPill size="sm" {...statusPill(dependencyType, d.dependency_type)} /><ArrowRight aria-hidden size={14} className="text-ds-fg-muted" /></span> },
    { key: 'target', header: 'Affects', card: 'meta', cell: (d) => <Link href={`/erm/risks/${d.target_risk_id}`} className="inline-flex min-h-ds-control items-center text-ds-body text-ds-fg-body underline-offset-2 hover:underline"><span className="line-clamp-2 break-words">{d.target_risk_title || `Risk ${d.target_risk_id}`}</span></Link> },
    { key: 'strength', header: 'Strength', width: 'w-[140px]', card: 'meta', cell: (d) => <span className={num}>{strengthWords(d.impact_factor)}</span> },
    {
      key: 'cascade', header: 'Actions', width: 'w-[180px]', align: 'right',
      cell: (d) => (
        <span className="inline-flex items-center gap-[4px]">
          <Button size="sm" onClick={() => { set({ risk: d.source_risk_id }); window.scrollTo({ top: 0 }); }}>See cascade</Button>
          {canDelete && <IconButton label={`Remove the dependency of ${truncate(d.source_risk_title ?? 'this risk', 40).text}`} onClick={() => { void askRemove(d); }}><Trash2 aria-hidden /></IconButton>}
        </span>
      ),
    },
  ];

  const head = (
    <div className="flex flex-wrap items-end gap-[12px]">
      <TextInput type="search" aria-label="Search dependencies by risk" placeholder="Search by risk" value={a.q} onChange={(e) => { set({ q: e.target.value }); setPage(1); }} className="w-full max-w-[320px]" />
      <span className="ml-auto" />
      {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add dependency</Button>}
    </div>
  );

  if (refused) return <NoAccessState title="You don't have access to risk dependencies" reason={errorMessage(deps.error)} />;

  const cascadeSection = (
    <section aria-labelledby="dep-cascade" className="flex min-w-0 flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <h2 id="dep-cascade" className="!text-ds-section !text-ds-fg">Cascade</h2>
        <FormField label="Risk" info="Choose a risk to see every risk its dependencies reach, with the score each would carry.">
          <Combobox label="Risk" options={riskOptions(risks.data?.items)} value={a.risk ? String(a.risk) : null} onChange={(v) => set({ risk: v ? Number(v) : 0 })} clearable searchable placeholder={risks.isError ? 'The risks could not be loaded' : 'Choose a risk'} disabled={risks.isError} />
        </FormField>
        {a.risk > 0 && cascade.isLoading && <SkeletonRows rows={3} columns={3} label="Working out the cascade" />}
        {a.risk > 0 && cascade.isError && <ErrorState compact title="Couldn't work out the cascade" message={errorMessage(cascade.error)} onRetry={() => { void cascade.refetch(); }} />}
        {cascade.data && a.risk > 0 && <CascadeCard result={cascade.data} />}
      </section>
  );
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {a.risk > 0 && cascadeSection}
      {head}
      <RegisterTable
        caption="Risk dependencies"
        columns={columns}
        rows={pageSlice(matches, pages, PAGE)}
        getRowId={(d) => d.id}
        loading={deps.isLoading}
        error={deps.isError ? { message: errorMessage(deps.error), onRetry: () => { void deps.refetch(); } } : null}
        empty={all.length === 0
          ? <EmptyState bare kind="firstUse" title="No dependencies yet" description={canCreate ? 'Record which risks cause or amplify others.' : 'No dependencies have been recorded yet.'} action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add dependency</Button> : undefined} />
          : <EmptyState bare kind="noMatches" title="No dependency matches" onClearFilters={() => set({ q: '' })} />}
        cardTitle={(d) => <span className="font-[600] text-ds-fg">{d.source_risk_title || `Risk ${d.source_risk_id}`}</span>}
        cardActions={(d) => <Menu iconOnly label={`Actions for ${truncate(d.source_risk_title ?? 'dependency', 50).text}`} items={[{ key: 'cascade', label: 'See cascade', icon: ArrowRight, onSelect: () => set({ risk: d.source_risk_id }) }, { key: 'delete', label: 'Remove', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void askRemove(d); } }]} />}
        footer={matches.length > PAGE ? <Pager page={pages} pageSize={PAGE} total={matches.length} onPage={setPage} noun={{ one: 'dependency', other: 'dependencies' }} /> : undefined}
      />


      {a.risk === 0 && cascadeSection}

      {adding && <DependencyForm risks={riskOptions(risks.data?.items)} risksFailed={risks.isError} saving={create.isPending} onClose={() => setAdding(false)} onSubmit={(payload) => create.mutate(payload)} />}
      {confirmDialog}
    </div>
  );
}

function CascadeCard({ result }: { result: CascadeResult }) {
  const rows = flattenCascade(result.cascade_impact);
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <StatTile label="Starts at" value={result.source_score != null ? String(result.source_score) : null} note={result.source_risk_title} info="The risk's residual score, else its inherent score." />
        <StatTile label="Risks reached" value={formatCount(reachedCount(result))} note={`${formatCount(result.cascade_impact.length)} directly`} />
        <StatTile label="Cascade score" value={String(result.total_cascade_score)} info="The scores of the risks it reaches directly, each multiplied by the strength of the dependency. Risks further down are shown but not added." />
      </div>
      {rows.length === 0 ? <p className="text-ds-body text-ds-fg-muted">This risk does not affect any other risk.</p> : (
        <ul className="m-0 flex list-none flex-col gap-[4px] p-0" aria-label="Risks reached">
          {rows.map(({ node, depth }, i) => (
            <li key={`${node.risk_id}-${i}`} style={{ marginLeft: (depth - 1) * 20 }} className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px] rounded-ds-control border border-ds-border px-[10px] py-[6px]">
              <Link href={`/erm/risks/${node.risk_id}`} className="inline-flex min-w-0 flex-1 items-center gap-[4px] text-ds-body font-[600] text-ds-fg underline-offset-2 hover:underline min-h-ds-control"><span className="break-words">{node.risk_title}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" /></Link>
              {node.dependency_type && <StatusPill size="sm" {...statusPill(dependencyType, node.dependency_type)} />}
              <span className="text-ds-label text-ds-fg-muted">{`${depth === 1 ? 'direct' : `level ${depth}`} · ${strengthWords(node.impact_factor)}`}</span>
              <span className="tabular-nums text-ds-body font-[600] text-ds-fg">{node.cascade_score}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DependencyForm({ risks, risksFailed, saving, onClose, onSubmit }: { risks: Array<{ value: string; label: string; description?: string }>; risksFailed: boolean; saving: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [type, setType] = useState<string>('causes');
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [description, setDescription] = useState('');
  const [tried, setTried] = useState(false);
  const error = dependencyError(source ? Number(source) : null, target ? Number(target) : null);
  const dirty = !!source || !!target || !!description || type !== 'causes' || strength !== DEFAULT_STRENGTH;
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title="Add a dependency"
      subtitle="One risk affecting another"
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => { setTried(true); if (error) return; onSubmit({ source_risk_id: Number(source), target_risk_id: Number(target), dependency_type: type, impact_factor: factorOfStrength(strength), description: description || undefined }); }}>Add dependency</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Risk that causes the impact" required error={tried && !source ? 'Choose the risk that causes the impact.' : undefined}>
          <Combobox label="Risk that causes the impact" options={risks} value={source} onChange={setSource} searchable placeholder={risksFailed ? 'The risks could not be loaded' : 'Choose a risk'} disabled={risksFailed} />
        </FormField>
        <FormField label="Relation">
          <SegmentedControl label="Relation" name="dep-type" options={optionsOf(dependencyType, DEPENDENCY_TYPES)} value={type} onChange={setType} />
        </FormField>
        <FormField label="Risk that is affected" required error={tried ? (!target ? 'Choose the risk that is affected.' : error === 'A risk cannot depend on itself.' ? error : undefined) : undefined}>
          <Combobox label="Risk that is affected" options={risks} value={target} onChange={setTarget} searchable placeholder={risksFailed ? 'The risks could not be loaded' : 'Choose a risk'} disabled={risksFailed} />
        </FormField>
        <FormField label="Strength" hint={`${strength} of 5: the affected risk carries ${Math.round(factorOfStrength(strength) * 100)}% of its score into the cascade.`}>
          <SegmentedControl label="Strength" name="dep-strength" options={STRENGTHS.map((n) => ({ value: String(n), label: String(n) }))} value={String(strength)} onChange={(v) => setStrength(Number(v))} />
        </FormField>
        <FormField label="Description" optional><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        {risksFailed && <Notice tone="warning">The risks could not be loaded, so a dependency cannot be added yet. Reload the page.</Notice>}
      </div>
    </RightSlidePanel>
  );
}
