'use client';

// The Control Library (/control-library): the unified, de-duplicated controls across all the frameworks, grouped by domain. The page draws its head, the strip it shares with the Catalog and Assurance, five
// figures, the plain-words reconciliation of "why N, not M", the filters (search, category, domain, empty groups, cards or table) and the groups. "Build your view" scopes the whole library to some frameworks,
// live and without a re-run; the choice lives in the address (?fw=A,B) and travels into a domain. What a figure means is libraryModel.ts. The rights the page checks are the ones it always did
// (controls:control_library:create / edit / delete); the server asks only for a signed-in person on these routes, which is listed for the user, not changed here.
import { useCallback, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, GitMerge, Library, Pencil, Plus, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, Checkbox, DebouncedSearch, EmptyState, ErrorState, Menu, Notice, Pager, ProgressBar, RegisterTable, SegmentedControl, Select, SkeletonRows, StatTile, TitleLink,
  useAddressState, useConfirm, useReportedMutation, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import { listOf, oneOf, text } from '@/lib/addressState';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient from '@/lib/api';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { BuildViewSheet, GroupFormSheet, ViewSheet } from './GroupSheets';
import { GL, GROUP_PAGE, optionsOf, useActiveJob, useAvailableFrameworks, useChoices, useCoverage, useGroups, useSessions } from './libraryData';
import { completionOf, completionTone, domainHref, headline, reconciliation, sharedOf, type ControlGroup } from './libraryModel';

const SCHEMA = { fw: listOf(), q: text(), category: text(), domain: text(), view: oneOf(['cards', 'table'] as const, 'cards') };
const NOUN = { one: 'group', other: 'groups' };
const TONE_PROGRESS = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'primary', pending: 'primary', progress: 'primary' } as const;

export function LibraryPage() {
  const router = useRouter();
  const uid = useId();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('controls:control_library:create');
  const canEdit = hasPermission('controls:control_library:edit');
  const canDelete = hasPermission('controls:control_library:delete');
  const { confirm, confirmDialog } = useConfirm();
  const [address, setAddress] = useAddressState(SCHEMA);
  const picked = address.fw;
  const [page, setPage] = useState(1);
  const [showEmpty, setShowEmpty] = useState(true);
  const [runId, setRunId] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [form, setForm] = useState<{ open: boolean; group: ControlGroup | null }>({ open: false, group: null });

  const groupsQ = useGroups({ search: address.q, category: address.category, domain: address.domain, page, runId });
  const choices = useChoices();
  const availableQ = useAvailableFrameworks();
  const sessions = useSessions();
  const job = useActiveJob();
  const data = groupsQ.data;
  const items = data?.items ?? [];
  const coverageQ = useCoverage(viewOpen || picked.length > 0, items, runId);
  const h = useMemo(() => headline({ data, showEmpty, picked, coverage: coverageQ.data, availableCount: availableQ.data?.length ?? 0 }), [data, showEmpty, picked, coverageQ.data, availableQ.data]);
  const rec = reconciliation(h, picked.length, availableQ.data?.length ?? 0);
  const session = sessions.data?.find((s) => s.id === runId);
  const label = routeFor('/control-library')?.label ?? 'Control Library';
  const categoryOptions = optionsOf(items, 'category');
  const domainOptions = optionsOf(items, 'domain');
  const filtering = !!(address.q || address.category || address.domain);
  const loading = groupsQ.isPending;
  const failed = groupsQ.isError && !data;

  const deleteGroup = useReportedMutation({
    mutationFn: (id: number) => apiClient.delete(`${GL}/${id}`),
    success: { title: 'Group deleted', message: 'It is no longer in the library.' },
    failure: "Couldn't delete the group",
    invalidate: [['control-groups']],
  });
  const summarise = useReportedMutation({
    mutationFn: (id: number) => apiClient.post(`${GL}/${id}/generate-summary`),
    success: { title: 'Summary written', message: 'The AI summary of the group is up to date.' },
    failure: "Couldn't write the summary",
    invalidate: [['control-groups']],
  });
  const dropSession = useReportedMutation({
    mutationFn: (id: number) => apiClient.delete(`${GL}/sessions/${id}`),
    success: { title: 'View deleted', message: 'The library is back to the master baseline, which was not touched.' },
    failure: "Couldn't delete the view",
    invalidate: [['normalization-sessions'], ['control-groups']],
    onSuccess: () => { setRunId(null); setPage(1); },
  });
  const stopJob = useReportedMutation({
    mutationFn: (jobId: string) => apiClient.post(`${GL}/auto-group/cancel/${jobId}`),
    success: 'Stopping the job',
    failure: "Couldn't stop the job",
    invalidate: [['auto-group-active']],
  });

  const askDelete = async (g: ControlGroup) => {
    if (await confirm({ title: `Delete “${g.name}”?`, message: 'The group leaves the library. The framework controls in it are not deleted.', confirmLabel: 'Delete group', tone: 'danger' })) deleteGroup.mutate(g.id);
  };
  const askDropSession = async () => {
    if (runId && await confirm({ title: `Delete the view “${session?.label ?? 'this view'}”?`, message: 'This removes the scoped view only. The master baseline is not touched.', confirmLabel: 'Delete view', tone: 'danger' })) dropSession.mutate(runId);
  };
  const open = useCallback((g: ControlGroup) => router.push(domainHref(g.id, picked)), [router, picked]);
  const menuOf = (g: ControlGroup): MenuItem[] => [
    { key: 'open', label: 'Open the domain', icon: Library, onSelect: () => open(g) },
    { key: 'edit', label: 'Edit', icon: Pencil, hidden: !canEdit, onSelect: () => setForm({ open: true, group: g }) },
    { key: 'summary', label: 'Write an AI summary', icon: Sparkles, disabled: summarise.isPending, onSelect: () => summarise.mutate(g.id) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => askDelete(g) },
  ];

  const columns: RegisterColumn<ControlGroup>[] = [
    { key: 'code', header: 'Code', priority: 2, card: 'hide', cell: (g) => <span className="font-mono text-ds-label font-[600] text-ds-primary-text">{g.code}</span> },
    { key: 'name', header: 'Name', isRowHeader: true, cell: (g) => (<><span className="block text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{g.name}</span>{g.description && g.description !== g.name && <span className="line-clamp-2 text-ds-label text-ds-fg-muted">{g.description}</span>}</>) },
    { key: 'category', header: 'Category', priority: 3, card: 'meta', cell: (g) => <span className="text-ds-label text-ds-fg-body">{g.category || '—'}</span> },
    { key: 'domain', header: 'Domain', priority: 3, card: 'meta', cell: (g) => <span className="text-ds-label text-ds-fg-body">{g.domain || '—'}</span> },
    { key: 'controls', header: 'Controls', align: 'right', card: 'meta', cell: (g) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(g.total_control_count)}</span> },
    { key: 'split', header: 'Shared / unique', priority: 2, card: 'meta', cell: (g) => <span className="text-ds-label tabular-nums text-ds-fg-body">{`${formatCount(sharedOf(g))} shared · ${formatCount(g.standalone_control_count ?? 0)} unique`}</span> },
    { key: 'completion', header: 'Completion', priority: 3, width: 'w-[140px]', card: 'meta', cell: (g) => { const c = completionOf(g); return <ProgressBar value={c} label={`${g.name} completion`} tone={TONE_PROGRESS[completionTone(c)]} showValue />; } },
    { key: 'actions', header: 'Actions', cell: (g) => <Menu label={`Actions for ${g.name}`} iconOnly items={menuOf(g)} /> },
  ];

  const body = (() => {
    if (failed) return <ErrorState title="Couldn’t load the control groups" message={errorMessage(groupsQ.error)} onRetry={canRetry(groupsQ.error) ? () => { void groupsQ.refetch(); } : undefined} />;
    if (loading) return <SkeletonRows rows={8} columns={4} label="Loading the control groups" />;
    if (h.groups.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {filtering || picked.length > 0 || !showEmpty
            ? <EmptyState kind="noMatches" bare title="No control groups match" description="Loosen a filter, or search for other words." onClearFilters={() => { setAddress({ q: '', category: '', domain: '', fw: [] }); setShowEmpty(true); }} />
            : (
              <EmptyState
                kind="firstUse" bare icon={Library} title="No control groups yet" description="Create a group, or let the AI build a unified view of your frameworks."
                action={(
                  <span className="flex flex-wrap justify-center gap-[8px]">
                    {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setForm({ open: true, group: null })}>New control group</Button>}
                    <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setBuildOpen(true)}>Build unified view</Button>
                  </span>
                )}
              />
            )}
        </div>
      );
    }
    if (address.view === 'table') {
      return <RegisterTable caption="Control groups" columns={columns} rows={h.groups} getRowId={(g) => g.id} onRowActivate={open} cardTitle={(g) => <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{g.name}</span>} cardActions={(g) => <Menu label={`Actions for ${g.name}`} iconOnly items={menuOf(g)} />} />;
    }
    return (
      <ul aria-label="Control groups" className="m-0 grid list-none grid-cols-1 gap-[12px] p-0 md:grid-cols-2 xl:grid-cols-3">
        {h.groups.map((g) => {
          const c = completionOf(g);
          return (
            <li key={g.id} className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
              <div className="flex items-start justify-between gap-[8px]">
                <TitleLink href={domainHref(g.id, picked)} prefetch={false} title={g.name} />
                <Menu label={`Actions for ${g.name}`} iconOnly items={menuOf(g)} />
              </div>
              {g.description && g.description !== g.name && <p className="m-0 line-clamp-2 text-ds-label text-ds-fg-muted">{g.description}</p>}
              <p className="m-0 text-ds-label tabular-nums text-ds-fg-body">{`${formatCount(g.normalized_control_count ?? 0)} controls · ${formatCount(sharedOf(g))} shared · ${formatCount(g.standalone_control_count ?? 0)} unique`}</p>
              <ProgressBar value={c} label="Completion" tone={TONE_PROGRESS[completionTone(c)]} showValue />
            </li>
          );
        })}
      </ul>
    );
  })();

  const total = data?.total ?? 0;
  const meta = loading ? undefined : picked.length
    ? (rec.show ? `Filtered · ${formatCount(h.rawTotal)} controls → ${formatCount(h.controls)} unified · ${formatCount(h.duplicates)} duplicates merged` : `Filtered · ${formatCount(h.controls)} unified controls`)
    : `${formatCount(h.domains)} domains · ${formatCount(h.controls)} unified controls · ${formatCount(h.frameworks)} frameworks`;
  const tileError = failed ? { title: 'Couldn’t load', onRetry: () => { void groupsQ.refetch(); } } : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info="Unified, de-duplicated controls across all your frameworks, grouped by domain. Filter to any subset of frameworks without a re-run."
        meta={meta}
        actions={(
          <>
            <Button leftIcon={<Filter aria-hidden />} aria-pressed={picked.length > 0} onClick={() => setViewOpen(true)}>{picked.length ? `${formatCount(picked.length)} ${picked.length === 1 ? 'framework' : 'frameworks'}` : 'Build your view'}</Button>
            <Button href="/control-library/review" leftIcon={<ShieldCheck aria-hidden />}>Review master list</Button>
            <Button variant="primary" href="/controls?promote=1" leftIcon={<GitMerge aria-hidden />} title="Move verified unified controls into the working Control Catalog">Promote to Catalog</Button>
          </>
        )}
      />
      <ControlSurfaceTabs active="library" />

      {runId && (
        <Notice
          tone="info"
          title={`You are looking at the view “${session?.label ?? 'a scoped view'}”`}
          action={(
            <span className="flex flex-wrap gap-[8px]">
              <Button onClick={() => { setRunId(null); setPage(1); }}>Back to the library</Button>
              <Button variant="dangerOutline" loading={dropSession.isPending} onClick={askDropSession}>Delete this view</Button>
            </span>
          )}
        >
          It covers {session ? `${formatCount(session.unified_controls)} unified controls` : 'a chosen set of frameworks'}. The master baseline is not touched.
        </Notice>
      )}
      {job.data?.active && job.data.job_id && (
        <Notice
          tone="info"
          title={`Building the unified view${job.data.status === 'cancelling' ? ': stopping' : ''}`}
          action={<Button variant="dangerOutline" leftIcon={<X aria-hidden />} loading={stopJob.isPending} disabled={job.data.status === 'cancelling'} onClick={() => stopJob.mutate(job.data!.job_id!)}>Stop</Button>}
        >
          <ProgressBar label="Building the unified view" value={Math.max(1, Math.min(100, job.data.progress_percent ?? 1))} tone="primary" showValue />
          <span className="mt-[4px] block text-ds-label text-ds-fg-muted">{(job.data.message || job.data.phase || 'Working').replace(/_/g, ' ')}. It is safe to leave this page: the job keeps running.</span>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-[12px] md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Control domains" value={loading ? null : formatCount(h.domains)} loading={loading} error={tileError} note="Grouped by topic area" />
        <StatTile label="Unified controls" value={loading ? null : formatCount(h.controls)} loading={loading} error={tileError} note={h.rawTotal > 0 && h.duplicates > 0 ? `from ${formatCount(h.rawTotal)} framework controls · ${formatCount(h.duplicates)} duplicates merged` : 'Distinct across all frameworks'} />
        <StatTile label="Frameworks covered" value={loading ? null : formatCount(h.frameworks)} loading={loading} error={tileError} note="Compliance standards" />
        <StatTile label="Shared" value={loading ? null : formatCount(h.sets)} loading={loading} error={tileError} note={`of the ${formatCount(h.controls)} unified · required by 2+ frameworks`} />
        <StatTile label="Unique" value={loading ? null : formatCount(h.standalone)} loading={loading} error={tileError} note={`of the ${formatCount(h.controls)} unified · required by one framework`} />
      </div>

      {rec.show && !loading && (
        <Notice tone="info" title={`Why ${formatCount(h.controls)}, not ${formatCount(h.rawTotal)}?`}>
          {rec.who} list {formatCount(h.rawTotal)} controls in total, but {formatCount(rec.repeated)} of those requirements are repeated across them (the same requirement listed separately by several frameworks). Counting each one once removes {formatCount(h.duplicates)} duplicate copies. Nothing is deleted: every framework’s controls still exist individually. Shared and Unique are a breakdown of the {formatCount(h.controls)}, not additional controls.
          <span className="mt-[6px] block text-ds-label tabular-nums text-ds-fg-body">{`${formatCount(h.rawTotal)} framework controls − ${formatCount(h.duplicates)} duplicates = ${formatCount(h.controls)} unified controls, which is ${formatCount(h.standalone)} unique + ${formatCount(h.sets)} shared.`}</span>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch label="Search by name or code" placeholder="Search by name or code" value={address.q} onSearch={(v) => { setAddress({ q: v }); setPage(1); }} loading={groupsQ.isFetching && !loading} className="w-full sm:w-[260px]" />
        {categoryOptions.length > 1 && (
          <Select aria-label="Category" className="w-full sm:w-[200px]" value={address.category} onChange={(e) => { setAddress({ category: e.target.value }); setPage(1); }} placeholder="All categories">
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        <Select aria-label="Domain" className="w-full sm:w-[200px]" value={address.domain} onChange={(e) => { setAddress({ domain: e.target.value }); setPage(1); }} placeholder="All domains">
          {domainOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Checkbox label="Show empty groups" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
        <SegmentedControl label="Layout" name={`${uid}-layout`} options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} value={address.view} onChange={(v) => setAddress({ view: v as 'cards' | 'table' })} className="ml-auto" />
      </div>

      {body}
      {total > GROUP_PAGE && <Pager page={page} pageSize={GROUP_PAGE} total={total} onPage={setPage} noun={NOUN} />}

      <ViewSheet open={viewOpen} onClose={() => setViewOpen(false)} coverage={coverageQ.data} loading={coverageQ.isFetching} picked={picked} onPick={(next) => setAddress({ fw: next })} shown={{ controls: h.controls, domains: h.domains }} />
      <GroupFormSheet open={form.open} group={form.group} onClose={() => setForm({ open: false, group: null })} categories={choices.categories} domains={choices.domains} />
      <BuildViewSheet open={buildOpen} onClose={() => setBuildOpen(false)} frameworks={availableQ.data ?? []} onRun={(id) => { setRunId(id); setPage(1); }} />
      {confirmDialog}
    </div>
  );
}
