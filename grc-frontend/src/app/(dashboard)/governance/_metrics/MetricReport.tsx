'use client';

// Shared metric-report surface, parameterised by kind so KPI and KRI stay SEPARATE while reusing one engine (/erm/kris/*).
//   kind="kpi" → Governance → KPI Report (performance vs target); its only caller is governance/kpi-report. kind="kri" has none today: /erm/kris is its own page.
// Define (manual or live-fed) → measure each period → RAG → scorecard. The calculations are the server's (the rating of a value, the live value, the history);
// the rules this page adds (words, formats, due, search, sort, what the form sends) are metricModel.ts, tested there.
// On the design-system kit: PageHeader variant="page", RegisterTable with Pager (search, status filter and sort run over the whole list the server sent, whose
// size is its own `summary.total`), StatusPill from the `rag` registry, RightSlidePanel and AnimatedModal with `dirty` (MetricForm, MeasureDialog), and every
// request through useReportedMutation / useConfirm: it is said only after the server answers, the server's words are shown when it refuses, and Retry is offered
// where repeating is safe. Only the --ds tokens and arbitrary values (the platform CSS repaints the named utilities inside the shell: ds/kitRules.ts).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Hand, Pencil, PencilLine, Plus, Search, Trash2, Zap } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, NOT_SET, formatCount, formatDate, truncate } from '@/lib/format';
import { pageRange } from '@/lib/pagerModel';
import { titleFor } from '@/lib/navRegistry';
import { TONE, rag, statusPill, type Tone } from '@/lib/status';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, EmptyState, ErrorState, Menu, NoAccessState, Pager, ReadOnlyNote, RegisterTable, SectionCard, SegmentedControl, Skeleton, StatusPill, TextInput,
  rowCountText, sortRows, useConfirm, useReportedMutation, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import type { RiskKRICreate, RiskKRIUpdate } from '@/types';
import { MeasureDialog } from './MeasureDialog';
import { MetricForm, type Feed } from './MetricForm';
import { Sparkline } from './Sparkline';
import {
  KIND_META, byCreation, filterMetrics, formatMetricValue, isDue, ragOf, sortValue,
  type CategoryRow, type Kind, type Metric, type MetricOption, type StatusFilter, type Summary, type Template,
} from './metricModel';

type Report = { kris: Metric[]; summary: Summary; by_category: CategoryRow[] };

const PAGE_SIZES = [10, 25, 50, 100] as const;
const TILE = 'flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[12px]';
const MUTED = 'text-ds-fg-muted';
/** a refusal (403, 404...) is final, anything else is tried again up to three times: so a person who may not see these is told at once */
const retryLoad = (failures: number, error: unknown): boolean => canRetry(error) && failures < 3;

function Tile({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className={TILE}>
      <span className={`text-ds-label ${MUTED}`}>{label}</span>
      <span className="mt-[4px] text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg" style={tone ? { color: TONE[tone].text } : undefined}>{formatCount(value)}</span>
    </div>
  );
}

function TilesSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-6">
      <span className="sr-only">{label}</span>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} aria-hidden className={TILE}>
          <Skeleton className="h-[12px] w-[64px]" />
          <Skeleton className="mt-[8px] h-[28px] w-[44px]" />
        </div>
      ))}
    </div>
  );
}

/** A count in the by-category table: a zero is a quiet dash, as it always was. */
const countCell = (n: number, tone?: Tone) => (n ? <span style={tone ? { color: TONE[tone].text } : undefined}>{formatCount(n)}</span> : <span className={MUTED}>{EMPTY}</span>);

const categoryColumns = (plural: string): RegisterColumn<CategoryRow>[] => [
  { key: 'category', header: 'Category', isRowHeader: true, cell: (c) => <span className="line-clamp-2 break-words" title={c.category}>{c.category}</span> },
  { key: 'total', header: plural, align: 'right', card: 'meta', cell: (c) => formatCount(c.total) },
  { key: 'green', header: rag.label('green'), align: 'right', card: 'meta', cell: (c) => countCell(c.green, 'success') },
  { key: 'amber', header: rag.label('amber'), align: 'right', card: 'meta', cell: (c) => countCell(c.amber, 'warning') },
  { key: 'red', header: rag.label('red'), align: 'right', card: 'meta', cell: (c) => countCell(c.red, 'danger') },
  { key: 'unknown', header: rag.label('unknown'), align: 'right', card: 'meta', cell: (c) => countCell(c.unknown) },
];

function SourceCell({ m }: { m: Metric }) {
  const Icon = m.is_live ? Zap : Hand;
  return (
    <span className={`inline-flex items-center gap-[6px] ${MUTED}`}>
      <Icon aria-hidden size={14} className="shrink-0" />
      <span className="min-w-0 break-words">{m.is_live ? m.module_label || 'Live' : 'Manual'}</span>
    </span>
  );
}

/** The day the next measurement is due (a day, not a moment), and "Due" once it has come. A live-fed metric is never measured by hand, so no date there is no gap. */
function DueCell({ m }: { m: Metric }) {
  const text = m.next_due_date ? formatDate(m.next_due_date, { calendar: true }) : m.is_live ? EMPTY : NOT_SET;
  return (
    <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <span className={`whitespace-nowrap ${m.next_due_date ? '' : MUTED}`}>{text}</span>
      {isDue(m.next_due_date, m.is_live) && <StatusPill size="sm" tone="danger" label="Due" />}
    </span>
  );
}

export default function MetricReport({ kind }: { kind: Kind }) {
  const meta = KIND_META[kind];
  const key = ['metric-report', kind];
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canEdit = hasPermission('erm:kris:create') || hasPermission('erm:kris:edit');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [editing, setEditing] = useState<Metric | null | undefined>(undefined);        // undefined: the drawer is shut; null: a new one
  const [measuring, setMeasuring] = useState<Metric | null>(null);
  const [showCategories, setShowCategories] = useState(true);
  const { confirm, confirmDialog } = useConfirm();

  const report = useQuery({
    queryKey: key,
    queryFn: () => ermApi.kris.report(90, kind).then((r) => r.data as Report),
    retry: retryLoad,
  });
  const optionsQuery = useQuery({ queryKey: ['kri-metric-options'], queryFn: () => ermApi.kris.metricOptions().then((r) => r.data as { metrics: MetricOption[] }), retry: retryLoad });
  const templatesQuery = useQuery({ queryKey: ['kri-templates'], queryFn: () => ermApi.kris.templates().then((r) => r.data as { templates: Template[] }), retry: retryLoad });

  // What the drawer picks from: where each list stands, so a failed one is said there (it used to leave an empty menu)
  const options: Feed<MetricOption> = {
    items: optionsQuery.data?.metrics ?? [], state: optionsQuery.data ? 'ready' : optionsQuery.isError ? 'error' : 'loading', error: optionsQuery.error, retry: () => { void optionsQuery.refetch(); },
  };
  const templates: Feed<Template> = {
    items: (templatesQuery.data?.templates ?? []).filter((t) => t.kind === kind), state: templatesQuery.data ? 'ready' : templatesQuery.isError ? 'error' : 'loading',
    error: templatesQuery.error, retry: () => { void templatesQuery.refetch(); },
  };

  // ── requests: each says what happened only after the server has answered; the page's own work (closing the drawer) runs once it has said yes ──
  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await ermApi.kris.create(payload as unknown as RiskKRICreate)).data,
    success: `${meta.noun} created`, failure: `Couldn't create the ${meta.noun}`, retryable: false,                 // a create repeated after a lost answer would make a second one
    invalidate: [key], onSuccess: () => setEditing((now) => (now === null ? undefined : now)),
  });
  const update = useReportedMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => (await ermApi.kris.update(id, payload as unknown as RiskKRIUpdate)).data,
    success: `${meta.noun} saved`, failure: `Couldn't save the ${meta.noun}`,
    invalidate: [key], onSuccess: (_, { id }) => setEditing((now) => (now && now.id === id ? undefined : now)),
  });
  const measure = useReportedMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Parameters<typeof ermApi.kris.measure>[1] }) => (await ermApi.kris.measure(id, payload)).data,
    success: 'Measurement recorded', failure: "Couldn't record the measurement", retryable: false,
    invalidate: [key], onSuccess: (_, { id }) => setMeasuring((now) => (now && now.id === id ? null : now)),
  });
  const remove = useReportedMutation({
    mutationFn: async (m: Metric) => (await ermApi.kris.delete(m.id)).data,
    success: `${meta.noun} deleted`, failure: `Couldn't delete the ${meta.noun}`, invalidate: [key],
  });
  const askDelete = async (m: Metric) => {
    const yes = await confirm({
      title: `Delete this ${meta.noun}?`,
      message: `“${truncate(m.name, 80).text}” and its measurement history will be deleted. This can't be undone.`,
      confirmLabel: `Delete ${meta.noun}`, tone: 'danger',
    });
    if (yes) remove.mutate(m);
  };

  // ── what is shown ──
  const summary = report.data?.summary;
  const categories = report.data?.by_category ?? [];
  const metrics = useMemo(() => byCreation(report.data?.kris ?? []), [report.data]);
  const matches = useMemo(() => sortRows(filterMetrics(metrics, { q, status }), sort, sortValue), [metrics, q, status, sort]);
  const range = pageRange(page, pageSize, matches.length);
  const rows = range.to === 0 ? [] : matches.slice(range.from - 1, range.to);
  const total = summary?.total ?? metrics.length;                                       // the server's own count, never the length of what happened to load
  const counted = (n: number) => ` (${formatCount(n)})`;
  const title = (kind === 'kpi' && titleFor('/governance/kpi-report')) || meta.title;
  const refused = report.isError && !report.data && statusOf(report.error) === 403;
  const readOnly = !permsLoading && !canEdit && !refused;
  const clearFilters = () => { setQ(''); setStatus('all'); setPage(1); };

  const columns: RegisterColumn<Metric>[] = [
    { key: 'name', header: meta.noun, isRowHeader: true, sortable: true, cell: (m) => <span className="line-clamp-2 break-words font-[500] text-ds-fg" title={m.name}>{m.name}</span> },
    { key: 'status', header: 'Status', width: 'w-[112px]', sortable: true, card: 'meta', cell: (m) => <StatusPill size="sm" {...statusPill(rag, ragOf(m.current_status))} /> },
    {
      key: 'value', header: 'Current', width: 'w-[104px]', align: 'right', sortable: true, firstDir: 'desc', card: 'meta', cardLabel: 'Current value',
      cell: (m) => <span className="whitespace-nowrap font-[600] tabular-nums text-ds-fg">{formatMetricValue(m.current_value, m.unit)}</span>,
    },
    {
      key: 'target', header: 'Target', width: 'w-[88px]', priority: 2, align: 'right', sortable: true, firstDir: 'desc', card: 'meta',
      cell: (m) => (m.target == null ? <span className={`whitespace-nowrap ${MUTED}`}>{NOT_SET}</span> : <span className="whitespace-nowrap tabular-nums">{formatMetricValue(m.target, m.unit)}</span>),
    },
    { key: 'trend', header: 'Trend', width: 'w-[144px]', priority: 2, cell: (m) => <Sparkline points={m.history} unit={m.unit} /> },
    {
      key: 'category', header: 'Category', width: 'w-[168px]', priority: 3, sortable: true, card: 'meta',
      cell: (m) => (m.category ? <span className="line-clamp-2 break-words" title={m.category}>{m.category}</span> : <span className={MUTED}>{NOT_SET}</span>),
    },
    { key: 'source', header: 'Source', width: 'w-[112px]', priority: 3, card: 'meta', cell: (m) => <SourceCell m={m} /> },
    { key: 'due', header: 'Next due', width: 'w-[136px]', priority: 3, sortable: true, card: 'meta', cell: (m) => <DueCell m={m} /> },
    ...(canEdit ? [{
      key: 'actions', header: 'Actions', width: 'w-[72px]', align: 'right' as const, card: 'meta' as const,
      cell: (m: Metric) => (
        <Menu iconOnly label={`Actions for ${truncate(m.name, 60).text}`} items={[
          { key: 'measure', label: 'Record measurement', icon: PencilLine, hidden: m.is_live, onSelect: () => setMeasuring(m) },
          { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(m) },
          { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(m); } },
        ]} />
      ),
    }] : []),
  ];

  const filters: { value: StatusFilter; label: string }[] = summary ? [
    { value: 'all', label: `All${counted(summary.total)}` },
    { value: 'red', label: `${rag.label('red')}${counted(summary.red)}` },
    { value: 'amber', label: `${rag.label('amber')}${counted(summary.amber)}` },
    { value: 'green', label: `${rag.label('green')}${counted(summary.green)}` },
    { value: 'unknown', label: `${rag.label('unknown')}${counted(summary.unknown)}` },
  ] : [];

  const head = (
    <PageHeader
      variant="page"
      title={title}
      info={meta.blurb}
      meta={readOnly ? (
        <ReadOnlyNote>
          View only
          <InfoTip text={`Only people who may create or edit ${meta.plural} can change them.`} label={`Why ${meta.plural} are view only`} />
        </ReadOnlyNote>
      ) : undefined}
      actions={canEdit ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New {meta.noun}</Button> : undefined}
    />
  );

  if (refused) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <NoAccessState title={`You don't have access to these ${meta.plural}`} reason={errorMessage(report.error)} />
      </div>
    );
  }
  if (report.isError && !report.data) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title={`Couldn't load the ${meta.plural}`} message={errorMessage(report.error)} onRetry={() => { void report.refetch(); }} />
      </div>
    );
  }

  const loading = report.isLoading;
  const empty = metrics.length === 0
    ? (
      <EmptyState bare kind="firstUse" title={`No ${meta.plural} yet`}
        description={canEdit ? 'Create one from a template, or build your own: manual or live-fed.' : `No ${meta.plural} have been set up yet.`}
        action={canEdit ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New {meta.noun}</Button> : undefined} />
    ) : (
      <EmptyState bare kind="noMatches" title={`No ${meta.plural} match`} description="Try another search or status." onClearFilters={clearFilters} />
    );

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      {loading ? <TilesSkeleton label={`Loading the ${meta.plural}`} /> : summary && (
        <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-6">
          <Tile label={meta.plural} value={summary.total} />
          <Tile label={rag.label('green')} value={summary.green} tone="success" />
          <Tile label={rag.label('amber')} value={summary.amber} tone="warning" />
          <Tile label={rag.label('red')} value={summary.red} tone="danger" />
          <Tile label={rag.label('unknown')} value={summary.unknown} />
          <Tile label="Live-fed" value={summary.live} />
        </div>
      )}

      {categories.length > 0 && (
        <SectionCard
          id="by-category"
          title="By category"
          info={`How many ${meta.plural} of each category are on track, being watched, off target or not rated yet.`}
          meta={`${formatCount(categories.length)} ${categories.length === 1 ? 'category' : 'categories'}`}
          actions={(
            <Button size="sm" aria-expanded={showCategories} aria-controls="by-category-panel" rightIcon={<ChevronDown aria-hidden className={showCategories ? 'rotate-180' : ''} />} onClick={() => setShowCategories((v) => !v)}>
              {showCategories ? 'Hide' : 'Show'}
            </Button>
          )}
        >
          {showCategories ? (
            <div id="by-category-panel">
              <RegisterTable caption={`${meta.plural} by category`} columns={categoryColumns(meta.plural)} rows={categories} getRowId={(c) => c.category} cardTitle={(c) => c.category} />
            </div>
          ) : null}
        </SectionCard>
      )}

      {!loading && metrics.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <TextInput
            className="w-full sm:w-[280px]" aria-label={`Search ${meta.plural}`} placeholder={`Search ${meta.plural}`} maxLength={100} leftAdornment={<Search aria-hidden />}
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
          <SegmentedControl label={`Show ${meta.plural} by status`} name="metric-status" options={filters} value={status} onChange={(v: StatusFilter) => { setStatus(v); setPage(1); }} />
          <span aria-live="polite" className={`text-ds-body ${MUTED} sm:ml-auto`}>{rowCountText({ shown: matches.length, total, noun: meta.noun, plural: meta.plural })}</span>
        </div>
      )}

      <RegisterTable
        caption={meta.plural}
        columns={columns}
        rows={rows}
        getRowId={(m) => m.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        loading={loading}
        empty={empty}
        cardTitle={(m) => <span className="line-clamp-3" title={m.name}>{m.name}</span>}
        footer={matches.length > 0 ? (
          <Pager page={range.page} pageSize={pageSize} total={matches.length} noun={meta.plural} pageSizes={PAGE_SIZES}
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        ) : undefined}
      />

      {editing !== undefined && (
        <MetricForm
          key={editing?.id ?? 'new'} kind={kind} metric={editing} options={options} templates={templates} saving={create.isPending || update.isPending}
          onSubmit={(payload) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate(payload))}
          onClose={() => setEditing(undefined)}
        />
      )}
      {measuring && (
        <MeasureDialog
          key={measuring.id} metric={measuring} saving={measure.isPending}
          onSubmit={(payload) => measure.mutate({ id: measuring.id, payload })}
          onClose={() => setMeasuring(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
