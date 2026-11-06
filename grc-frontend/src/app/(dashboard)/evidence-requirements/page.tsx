'use client';

// Evidence Requirements: what each control of a framework asks you to show, and where each requirement stands in review (draft, submitted, pending review,
// approved, rejected). One framework at a time, read in full and filtered in the browser (the largest has 1,070 requirements), a page of it at a time.
// Everything the person chose lives in the address (?framework= &q= &status= &priority= &type= &open= &page=), so a link opens the same view. On the
// design-system kit: PageHeader variant="page", RegisterTable (cards below 768px), Pager with the true count, status pills from the registries, the details
// in a right-hand panel that opens from the keyboard, every step through useReportedMutation (said after the server answers, in its words) and the
// rejection in a dialog that keeps what was typed. The rules (filters, search, tiles, steps) are requirementsModel.ts, tested there.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, formatCount, truncate } from '@/lib/format';
import { integer, listOf, text } from '@/lib/addressState';
import { priority, statusPill } from '@/lib/status';
import { requirementStatus } from '@/lib/statuses/evidence';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, Combobox, EmptyState, ErrorState, Menu, MultiSelect, Notice, Pager, ReadOnlyNote, RegisterTable, Skeleton, StatTile, StatusPill, TextInput, useAddressState,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { pageOfRows } from '../evidence/_workspace/evidenceModel';
import { loadCatalogue, loadControls, loadFrameworks } from './_queries';
import { RejectDialog } from './_RejectDialog';
import { RequirementDrawer } from './_Drawer';
import { useSteps } from './_useSteps';
import { MUTED } from './_parts';
import {
  PRIORITIES, REQUIREMENT_STATUSES, catalogueTiles, controlLabel, countLine, filterRequirements, isFiltered, readable, stepsFor, typeChoices,
  type ParsedControl, type Requirement, type StepKey,
} from './requirementsModel';

const SCHEMA = {
  framework: integer(0, { min: 1 }),
  q: text(),
  status: listOf(REQUIREMENT_STATUSES),
  priority: listOf(PRIORITIES),
  type: listOf(),
  open: integer(0, { min: 1 }),
  page: integer(1, { min: 1 }),
};
const PAGE_SIZES = [25, 50, 100] as const;
const STATUS_OPTIONS = REQUIREMENT_STATUSES.map((value) => ({ value, label: requirementStatus.label(value) }));
const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({ value, label: priority.label(value) }));
/** a refusal (403, 404) is final, anything else is tried once more after a short wait: a failure is said within a couple of seconds, not after seven of spinner */
const retryRead = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;
const RETRY_AFTER = 800;

export default function EvidenceRequirementsPage() {
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canEdit = hasPermission('evidence:evidence_library:edit');
  const [a, set] = useAddressState(SCHEMA);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rejecting, setRejecting] = useState<Requirement | null>(null);
  const framework = a.framework || null;

  const frameworksQ = useQuery({ queryKey: ['uploaded-frameworks-for-evidence'], queryFn: loadFrameworks, retry: retryRead, retryDelay: RETRY_AFTER });
  const controlsQ = useQuery({ queryKey: ['parsed-controls-for-evidence', framework], queryFn: () => loadControls(framework as number), enabled: framework !== null, retry: retryRead, retryDelay: RETRY_AFTER });
  const catalogueQ = useQuery({ queryKey: ['evidence-requirements', framework], queryFn: () => loadCatalogue(framework as number), enabled: framework !== null, retry: retryRead, retryDelay: RETRY_AFTER });
  const steps = useSteps(framework ?? 0, () => setRejecting(null));

  const catalogue = catalogueQ.data;
  const rows = useMemo(() => catalogue?.requirements ?? [], [catalogue]);
  const controlMap = useMemo(() => new Map<number, ParsedControl>((controlsQ.data ?? []).map((c) => [c.id, c])), [controlsQ.data]);
  const filters = useMemo(() => ({ q: a.q, status: a.status, priority: a.priority, types: a.type }), [a.q, a.status, a.priority, a.type]);
  const matches = useMemo(() => filterRequirements(rows, filters, controlMap), [rows, filters, controlMap]);
  const types = useMemo(() => typeChoices(rows), [rows]);
  const { range, rows: pageRows } = pageOfRows(matches, a.page, pageSize);
  const tiles = catalogueTiles(catalogue?.status_counts, catalogue?.total);
  const opened = a.open ? rows.find((r) => r.id === a.open) : undefined;
  const labelOf = (r: Requirement) => controlLabel(r, controlMap.get(r.parsed_control_id));
  const pendingId = [steps.submit, steps.review, steps.approve, steps.reject].find((m) => m.isPending)?.variables?.id;
  const frameworkName = frameworksQ.data?.find((f) => f.id === framework)?.name ?? catalogue?.framework_name;
  const clearFilters = () => set({ q: '', status: [], priority: [], type: [], page: 1 });
  const readOnly = !permsLoading && !canEdit;

  const onStep = (r: Requirement, key: StepKey) => {
    if (key === 'reject') {
      steps.reject.reset();
      setRejecting(r);
      return;
    }
    steps.run(key, { id: r.id, title: r.evidence_title });
  };

  const head = (
    <PageHeader
      variant="page"
      title="Evidence requirements"
      info="What each control of a framework asks you to show, how often to collect it and what makes it acceptable, with where each requirement stands in review: draft, submitted, pending review, approved or rejected."
      meta={readOnly ? (
        <ReadOnlyNote>
          View only
          <InfoTip text="Only people who may edit the evidence library can move a requirement through review." label="Why the requirements are view only" />
        </ReadOnlyNote>
      ) : undefined}
    />
  );

  const picker = (
    <div className="w-full sm:w-[420px]">
      {frameworksQ.isLoading ? <Skeleton className="h-[32px] w-full" /> : (
        <Combobox
          label="Framework"
          showLabel
          placeholder="Choose a framework"
          searchPlaceholder="Search frameworks"
          options={(frameworksQ.data ?? []).map((f) => ({ value: String(f.id), label: f.name, description: f.version ? `Version ${f.version}` : undefined }))}
          value={framework === null ? null : String(framework)}
          onChange={(v) => set({ framework: v ? Number(v) : 0, open: 0, page: 1 })}
          className="w-full"
        />
      )}
    </div>
  );

  if (frameworksQ.isError && !frameworksQ.data) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the frameworks" message={errorMessage(frameworksQ.error)} onRetry={canRetry(frameworksQ.error) ? () => { void frameworksQ.refetch(); } : undefined} />
      </div>
    );
  }

  if (!frameworksQ.isLoading && (frameworksQ.data ?? []).length === 0) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <EmptyState kind="firstUse" title="No frameworks to show" description="Evidence requirements belong to a framework that has been read. None is available yet." />
      </div>
    );
  }

  const loading = framework !== null && catalogueQ.isLoading;
  const failed = framework !== null && catalogueQ.isError && !catalogue;
  const loaded = !!catalogue;

  const columns: RegisterColumn<Requirement>[] = [
    {
      key: 'control', header: 'Control', isRowHeader: true, width: 'w-[200px]',
      cell: (r) => {
        const l = labelOf(r);
        return (
          <span className="block min-w-0">
            <span className="block break-words font-[500] text-ds-fg">{l.reference}</span>
            <span className={`line-clamp-2 break-words text-ds-label ${MUTED}`} title={l.title}>{l.title}</span>
          </span>
        );
      },
    },
    {
      key: 'evidence', header: 'Evidence',
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          <span className="line-clamp-2 min-w-0 break-words text-ds-fg" title={r.evidence_title} dir="auto">{r.evidence_title}</span>
          {!r.is_mandatory && <span className={`shrink-0 rounded-ds-control border border-ds-border px-[6px] text-ds-label ${MUTED}`}>Optional</span>}
        </span>
      ),
    },
    { key: 'type', header: 'Type', priority: 2, width: 'w-[112px]', card: 'meta', cell: (r) => readable(r.evidence_type) || <span className={MUTED}>{EMPTY}</span> },
    { key: 'priority', header: 'Priority', priority: 3, width: 'w-[96px]', card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(priority, r.priority)} /> },
    { key: 'status', header: 'Status', width: 'w-[128px]', card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(requirementStatus, r.status)} /> },
    { key: 'frequency', header: 'How often', priority: 3, width: 'w-[96px]', card: 'meta', cell: (r) => readable(r.collection_frequency) || <span className={MUTED}>{EMPTY}</span> },
    ...(canEdit ? [{
      key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[190px]',
      cell: (r: Requirement) => (
        <span className="inline-flex flex-wrap justify-end gap-[6px]">
          {stepsFor(r.status, canEdit).map((s) => (
            <Button
              key={s.key} size="sm" variant={s.key === 'reject' ? 'dangerOutline' : 'primary'} aria-label={`${s.label}: ${truncate(r.evidence_title, 60).text}`}
              loading={pendingId === r.id} disabled={pendingId !== undefined && pendingId !== r.id} onClick={() => onStep(r, s.key)}
            >
              {s.label}
            </Button>
          ))}
        </span>
      ),
    }] : []),
  ];

  const empty = !loaded ? undefined : rows.length === 0 ? (
    <EmptyState bare kind="firstUse" title="No evidence requirements for this framework" description="None have been added for it yet." />
  ) : (
    <EmptyState bare kind="noMatches" title="No requirements match" description="Try another search or fewer filters." onClearFilters={clearFilters} />
  );

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        {picker}
        {framework !== null && loaded && (
          <TextInput
            className="w-full sm:w-[260px]" aria-label="Search requirements" placeholder="Search by control or title" maxLength={100} leftAdornment={<Search aria-hidden />}
            value={a.q} onChange={(e) => set({ q: e.target.value, page: 1 })}
          />
        )}
      </div>

      {framework === null && (
        <EmptyState kind="firstUse" title="Choose a framework" description="Pick one above to see what evidence each of its controls asks for." />
      )}

      {framework !== null && !failed && (
        <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Requirements" value={loaded ? formatCount(tiles.total) : null} loading={loading} note="In this framework" />
          <StatTile label="Draft" value={loaded ? formatCount(tiles.draft) : null} loading={loading} />
          <StatTile label="In review" value={loaded ? formatCount(tiles.inReview) : null} loading={loading} note="Submitted or pending review" />
          <StatTile label="Approved" value={loaded ? formatCount(tiles.approved) : null} loading={loading} tone="success" />
          <StatTile label="Rejected" value={loaded ? formatCount(tiles.rejected) : null} loading={loading} tone={tiles.rejected > 0 ? 'danger' : 'default'} />
        </div>
      )}

      {failed && (
        <ErrorState
          title="Couldn't load the requirements" message={errorMessage(catalogueQ.error)}
          onRetry={canRetry(catalogueQ.error) ? () => { void catalogueQ.refetch(); } : undefined}
        />
      )}

      {loaded && catalogue.requirements.length < catalogue.total && (
        <Notice
          tone="warning" title={`Showing ${formatCount(catalogue.requirements.length)} of ${formatCount(catalogue.total)} requirements`}
          action={<Button size="sm" onClick={() => { void catalogueQ.refetch(); }}>Reload</Button>}
        >
          The server sent fewer than it counted. Search and filters use the ones shown.
        </Notice>
      )}

      {framework !== null && !failed && (
        <>
          {loaded && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
              <MultiSelect showLabel label="Status" placeholder="All" options={STATUS_OPTIONS} value={a.status} onChange={(v) => set({ status: v, page: 1 })} className="w-full sm:w-[200px]" />
              <MultiSelect showLabel label="Priority" placeholder="All" options={PRIORITY_OPTIONS} value={a.priority} onChange={(v) => set({ priority: v, page: 1 })} className="w-full sm:w-[190px]" />
              <MultiSelect
                showLabel label="Type" placeholder="All" value={a.type} onChange={(v) => set({ type: v, page: 1 })} className="w-full sm:w-[190px]"
                options={types.map((t) => ({ value: t.value, label: t.label, description: `${formatCount(t.count)} requirements` }))}
              />
              {isFiltered(filters) && <Button variant="link" onClick={clearFilters}>Clear filters</Button>}
              <span aria-live="polite" className={`text-ds-body ${MUTED} sm:ml-auto`}>{countLine(matches.length, rows.length)}</span>
            </div>
          )}
          <RegisterTable
            caption={frameworkName ? `Evidence requirements of ${frameworkName}` : 'Evidence requirements'}
            columns={columns}
            rows={pageRows}
            getRowId={(r) => r.id}
            loading={loading}
            loadingRows={8}
            empty={empty}
            selectedId={a.open || null}
            onRowActivate={(r) => set({ open: r.id })}
            cardTitle={(r) => (
              <span className="block min-w-0">
                <span className="line-clamp-3 break-words" title={r.evidence_title} dir="auto">{r.evidence_title}</span>
                <span className={`mt-[2px] block break-words text-ds-label font-normal ${MUTED}`}>{labelOf(r).reference}</span>
              </span>
            )}
            cardActions={canEdit ? (r) => (
              <Menu
                iconOnly label={`Actions for ${truncate(r.evidence_title, 50).text}`}
                items={stepsFor(r.status, canEdit).map((s) => ({ key: s.key, label: s.label, danger: s.key === 'reject', onSelect: () => onStep(r, s.key) }))}
              />
            ) : undefined}
            footer={matches.length > 0 ? (
              <Pager
                page={range.page} pageSize={pageSize} total={matches.length} noun={{ one: 'requirement', other: 'requirements' }} pageSizes={PAGE_SIZES}
                onPage={(page) => set({ page })} onPageSize={(n) => { setPageSize(n); set({ page: 1 }); }}
              />
            ) : undefined}
          />
        </>
      )}

      {opened && (
        <RequirementDrawer
          key={opened.id} req={opened} control={labelOf(opened)} steps={stepsFor(opened.status, canEdit)} busy={pendingId === opened.id}
          onStep={(key) => onStep(opened, key)} onClose={() => set({ open: 0 })}
        />
      )}
      {rejecting && (
        <RejectDialog
          key={rejecting.id} title={rejecting.evidence_title} busy={steps.reject.isPending}
          error={steps.reject.isError ? errorMessage(steps.reject.error) : null}
          onSubmit={(reason) => steps.reject.mutate({ id: rejecting.id, title: rejecting.evidence_title, reason })}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}
