'use client';

/**
 * Evidence Management > Audit packages: the register of the bundles of evidence an auditor is given, and the record of one (opened over the list, ?open=<id>). A package starts as a
 * draft, takes approved files, is finalized (locked) and exported as a zip that can be downloaded; a package can be put on legal hold. Filters (status, legal hold, search) and the
 * open package live in the address. Every action says what happened when the server answered; finalize, delete, legal hold and removing a file ask first, in words (no native dialogs).
 * The old page's export answered with a download address that nothing served: Download works now.
 */
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Button, EmptyState, ErrorState, FilterChips, Menu, Notice, Pager, RegisterTable, TextInput, useAddressState, type FilterChip, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { flag, integer, oneOf, text } from '@/lib/addressState';
import { EMPTY, formatCount, formatDate } from '@/lib/format';
import { EvidenceTabs } from '../_tabs/EvidenceTabs';
import { AddEvidenceSheet, CreatePackageSheet } from './PackageSheets';
import { PackageRecord, PackageStatus } from './PackageRecord';
import { LIST_LIMIT, usePackageActions, usePackages } from './packagesActions';
import { NO_PACKAGE_FILTER, STATUS_TABS, TAB_LABEL, filterPackages, periodText, stepsOf, tabCounts, type PackageRow } from './packagesModel';

const SCHEMA = { status: oneOf(STATUS_TABS, 'all'), hold: flag(), q: text(), open: integer(0, { min: 1 }) };
const PAGE_SIZES = [25, 50, 100] as const;
const MUTED = 'text-ds-fg-muted';
const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max)}…` : name);

export default function AuditPackagesPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('evidence:evidence_library:create');
  const [a, set] = useAddressState(SCHEMA);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const listQ = usePackages();
  const rows = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const counts = useMemo(() => tabCounts(rows), [rows]);
  const filter = useMemo(() => ({ ...NO_PACKAGE_FILTER, status: a.status, hold: a.hold, q: a.q }), [a.status, a.hold, a.q]);
  const shown = useMemo(() => filterPackages(rows, filter), [rows, filter]);
  const pageClamped = Math.min(pageNo, Math.max(1, Math.ceil(shown.length / pageSize)));
  const pageRows = shown.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);
  const opened = a.open ? rows.find((r) => r.id === a.open) ?? null : null;
  const missing = a.open > 0 && !listQ.isLoading && !listQ.isError && !opened;
  const filtering = a.status !== 'all' || a.hold || a.q.trim() !== '';
  const noList = listQ.isError && !listQ.data;
  const total = listQ.data?.total ?? rows.length;

  const actions = usePackageActions((id) => { if (a.open === id) set({ open: 0 }); }, (id) => { setCreating(false); set({ open: id, status: 'all' }); });
  const clear = () => { set({ status: 'all', hold: false, q: '' }); setPageNo(1); };
  const refilter = (patch: Partial<typeof a>) => { set(patch); setPageNo(1); };

  const chips: FilterChip[] = [
    ...STATUS_TABS.map((s) => ({ key: s, label: TAB_LABEL[s], count: counts[s], active: a.status === s })),
    { key: 'hold', label: 'Legal hold', count: rows.filter((r) => r.is_legal_hold).length, active: a.hold },
  ];
  const onChip = (key: string) => (key === 'hold' ? refilter({ hold: !a.hold }) : refilter({ status: key as typeof a.status }));

  const rowMenu = (p: PackageRow): MenuItem[] => {
    const steps = stepsOf(p);
    return [
      { key: 'open', label: 'Open', onSelect: () => set({ open: p.id }) },
      { key: 'finalize', label: 'Finalize', hidden: p.status !== 'draft', disabled: !steps.finalize.allowed, reason: steps.finalize.why ?? undefined, onSelect: () => actions.askFinalize(p) },
      { key: 'export', label: p.status === 'exported' ? 'Export again' : 'Export', hidden: !steps.exportable, onSelect: () => actions.exportIt(p) },
      { key: 'download', label: 'Download', hidden: !steps.downloadable, onSelect: () => actions.download(p) },
      { key: 'hold', label: p.is_legal_hold ? 'Remove legal hold' : 'Put on legal hold', onSelect: () => actions.askHold(p) },
      { key: 'delete', label: 'Delete', danger: true, disabled: !steps.remove.allowed, reason: steps.remove.why ?? undefined, onSelect: () => actions.askDelete(p) },
    ];
  };

  const columns: RegisterColumn<PackageRow>[] = [
    {
      key: 'name', header: 'Package', isRowHeader: true,
      cell: (p) => (
        <span className="block min-w-0">
          <button type="button" onClick={() => set({ open: p.id })} title={p.name} dir="auto" className="line-clamp-2 break-words rounded-ds-control py-[4px] text-left font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{p.name}</button>
          <span className={`block truncate text-ds-label ${MUTED}`}>{p.framework_name ?? 'No framework'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', width: 'w-[168px]', card: 'meta', cell: (p) => <PackageStatus p={p} /> },
    { key: 'period', header: 'Audit period', priority: 2, width: 'w-[220px]', card: 'meta', cell: (p) => <span className="text-ds-body text-ds-fg-body">{periodText(p.audit_period_start, p.audit_period_end)}</span> },
    { key: 'files', header: 'Files', align: 'right', width: 'w-[80px]', card: 'meta', cell: (p) => <span className="tabular-nums">{formatCount(p.evidence_count)}</span> },
    { key: 'created', header: 'Created', priority: 3, width: 'w-[150px]', card: 'meta', cell: (p) => <span className="text-ds-body text-ds-fg-body">{p.created_at ? formatDate(p.created_at) : EMPTY}</span> },
    { key: 'menu', header: 'Actions', align: 'right', width: 'w-[56px]', cell: (p) => <Menu label={`Actions for ${short(p.name, 60)}`} iconOnly items={rowMenu(p)} /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[12px]">
        <PageHeader
          variant="page"
          title="Audit packages"
          info="Bundle approved evidence for an auditor: add files in the order they should be printed, finalize the package to lock it, then export it as a zip. A package on legal hold cannot be deleted."
          meta={listQ.isLoading || noList ? undefined : `${formatCount(total)} ${total === 1 ? 'package' : 'packages'}`}
          actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New package</Button> : undefined}
        />
        <EvidenceTabs current="packages" />
      </div>

      {noList ? (
        <ErrorState title="Couldn't load the audit packages" message={errorMessage(listQ.error)} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} />
      ) : (
        <>
          {total > LIST_LIMIT && <Notice tone="info" title="Only part of the list is loaded">The newest {formatCount(rows.length)} of {formatCount(total)} packages are shown.</Notice>}
          {missing && <Notice tone="warning" title="That package is not in the list" action={<Button variant="ghost" onClick={() => set({ open: 0 })}>Dismiss</Button>}>It may have been deleted.</Notice>}
          {listQ.isError && listQ.data && <ErrorState compact title="Couldn't refresh the packages" message={`${errorMessage(listQ.error)} What is shown may be out of date.`} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} />}

          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
            <FilterChips label="Package status" chips={listQ.isLoading ? [] : chips} onToggle={onChip} overflow="scroll" className="min-w-0 max-w-full" />
            <TextInput
              className="w-full sm:ml-auto sm:w-[260px]" type="search" aria-label="Search audit packages" placeholder="Search packages" maxLength={100} leftAdornment={<Search aria-hidden />}
              value={a.q} onChange={(e) => refilter({ q: e.target.value })}
            />
          </div>

          <RegisterTable
            caption="Audit packages"
            columns={columns}
            rows={pageRows}
            getRowId={(p) => p.id}
            loading={listQ.isLoading}
            loadingRows={6}
            selectedId={a.open || null}
            onRowActivate={(p) => set({ open: p.id })}
            empty={rows.length === 0 ? (
              <EmptyState
                bare kind="firstUse" title="No audit packages yet" description="A package bundles approved evidence for an auditor."
                action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New package</Button> : undefined}
              />
            ) : <EmptyState bare kind="noMatches" title="No package matches" description="Try other words or another status." onClearFilters={filtering ? clear : undefined} />}
            cardTitle={(p) => <span className="block min-w-0"><span className="line-clamp-2 break-words" dir="auto">{p.name}</span><span className={`block truncate text-ds-label font-normal ${MUTED}`}>{p.framework_name ?? 'No framework'}</span></span>}
            cardActions={(p) => <Menu label={`Actions for ${short(p.name, 50)}`} iconOnly items={rowMenu(p)} />}
            footer={shown.length > 0 ? <Pager page={pageClamped} pageSize={pageSize} total={shown.length} noun={{ one: 'package', other: 'packages' }} pageSizes={PAGE_SIZES} onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} /> : undefined}
          />
        </>
      )}

      <PackageRecord row={opened} actions={actions} canAdd={canCreate} onAdd={() => setAdding(true)} onClose={() => set({ open: 0 })} />
      <CreatePackageSheet open={creating} onClose={() => setCreating(false)} onCreate={actions.create} busy={actions.busy.create} />
      {opened && (
        <AddEvidenceSheet
          open={adding} onClose={() => setAdding(false)} packageId={opened.id} packageName={opened.name} busy={actions.busy.add}
          onAdd={(ids) => actions.addMutation.mutate({ p: opened, ids }, { onSuccess: () => setAdding(false) })}
        />
      )}
      {actions.ui}
    </div>
  );
}
