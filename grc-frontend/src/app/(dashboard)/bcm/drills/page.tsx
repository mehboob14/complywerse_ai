'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Drills & Invocations. The request is the one it always was (GET /bcm/drills, key ['bcm-drills']: the server sends up to 200 drills, latest scheduled first, and the TRUE
// total); the search and the status, type and source filters work on the rows that came, and the count is the server's total, not the length of what loaded. The filters, the sort and the page
// are kept in the address (?q= status= type= source= sort= page= size=; `?status=overdue` is where the Overview's overdue counter opens), so a link, a reload and the Back button land where the
// person was. On the design-system kit: PageHeader variant="page", RegisterTable (cards below 768px) with Pager, a row menu that is always visible, useConfirm before a delete (it names what
// goes with the drill), useReportedMutation for the delete, DrillForm (a drawer that asks before it throws typing away).
import { useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDate, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { drillStatus, drillType, sourceType } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, PersonChip, RegisterTable, Select, TextInput, rowCountText, useAddressState, useConfirm, useReportedMutation,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { MUTED_LINK, Pill, TitleLink } from '../_bcm-ui';
import {
  DRILL_LIST_SCHEMA, PAGE_SIZES, asPage, cutNotice, drillDeleteWords, drillSortValue, filterDrills, ordered, pageOf, retryRead, type Drill, type Page,
} from '../bcmModel';
import { DrillForm } from './_DrillForm';

const MUTED = 'text-ds-fg-muted';
const NOUN = { one: 'drill', other: 'drills' };

export default function BcmDrillsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:drills:create');
  const canDelete = hasPermission('bcm:drills:delete');
  const [addr, setAddr] = useAddressState(DRILL_LIST_SCHEMA);
  const { q, status, type, source, sort, page, size } = addr;
  const { confirm, confirmDialog } = useConfirm();
  const searchField = useRef<HTMLInputElement>(null);

  const list = useQuery<Page<Drill>>({
    queryKey: ['bcm-drills'],
    queryFn: async () => {
      const answer = asPage<Drill>((await bcmApi.drills.list()).data);
      if (!answer) throw new Error('The server answered in a form this page cannot read.');
      return answer;
    },
    placeholderData: keepPreviousData,
    retry: retryRead,
  });

  const remove = useReportedMutation({
    mutationFn: async (d: Drill) => (await bcmApi.drills.remove(d.id)).data,
    success: 'Drill deleted', failure: "Couldn't delete the drill", invalidate: [['bcm-drills']],
    // the row the person was on is gone, and focus with it: back to where the list starts, unless they are typing or a dialog is open
    onSuccess: () => {
      const here = document.activeElement;
      const busy = !!here && here !== document.body && !!(here.closest('[role="dialog"]') || here.matches('input, textarea, select'));
      if (!busy) searchField.current?.focus();
    },
  });
  const askDelete = async (d: Drill) => {
    if (await confirm({ ...drillDeleteWords(d), tone: 'danger' })) remove.mutate(d);
  };

  const drills = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? drills.length;
  const matches = useMemo(() => ordered(filterDrills(drills, { q, status, type, source }), sort, drillSortValue), [drills, q, status, type, source, sort]);
  const { rows, range } = pageOf(matches, page, size);
  const cut = cutNotice({ loaded: drills.length, total, noun: NOUN, order: 'latest scheduled' });
  const clearFilters = () => setAddr({ q: '', status: 'all', type: 'all', source: 'all', page: 1 });
  const openCreate = () => setAddr({ new: true });
  const failed = list.isError && !list.data;
  const loading = !failed && !list.data;
  const creating = addr.new && canCreate;

  const head = (
    <PageHeader
      variant="page"
      title={routeFor('/bcm/drills')?.label ?? 'Drills & Invocations'}
      info="Continuity tests of the plans and the real activations of them, with what each found."
      actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>Schedule drill</Button> : undefined}
    />
  );

  if (failed) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the drills" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />
        {confirmDialog}
      </div>
    );
  }

  /** what can be done to one drill: always visible (a "⋯" button), never behind a hover */
  const rowMenu = (d: Drill) => (
    <Menu
      iconOnly
      label={`Actions for ${truncate(d.title, 60).text}`}
      items={[
        { key: 'open', label: 'Open', icon: ExternalLink, onSelect: () => router.push(`/bcm/drills/${d.id}`) },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(d); } },
      ]}
    />
  );

  const title = (d: Drill) => (
    <div className="min-w-0">
      <TitleLink href={`/bcm/drills/${d.id}`} title={d.title} />
      {d.plan_title && (
        <Link href={`/bcm/plans/${d.plan_id}`} title={d.plan_title} className={`mt-[2px] block text-ds-label font-normal ${MUTED_LINK}`}>
          <span className="line-clamp-1 break-words">{d.plan_title}</span>
        </Link>
      )}
    </div>
  );

  const columns: RegisterColumn<Drill>[] = [
    { key: 'title', header: 'Drill', isRowHeader: true, sortable: true, cell: title },
    {
      key: 'type', header: 'Type', width: 'w-[132px]', priority: 2, sortable: true, card: 'meta',
      cell: (d) => (
        <span className="block min-w-0">
          <span className="block whitespace-nowrap">{drillType.label(d.drill_type)}</span>
          <span className={`block whitespace-nowrap text-ds-label font-normal ${MUTED}`}>{sourceType.label(d.source_type)}</span>
        </span>
      ),
      cardCell: (d) => <span>{`${drillType.label(d.drill_type)} · ${sourceType.label(d.source_type)}`}</span>,
    },
    { key: 'status', header: 'Status', width: 'w-[124px]', sortable: true, card: 'meta', cell: (d) => <Pill registry={drillStatus} word={d.effective_status} /> },
    {
      key: 'scheduled', header: 'Scheduled', width: 'w-[116px]', sortable: true, card: 'meta',
      cell: (d) => <span className={`whitespace-nowrap ${d.scheduled_date ? '' : MUTED}`}>{formatDate(d.scheduled_date, { calendar: true, empty: NOT_SET })}</span>,
    },
    {
      key: 'owner', header: 'Owner', width: 'w-[160px]', priority: 3, sortable: true, card: 'meta',
      cell: (d) => <div className="max-w-[148px]"><PersonChip name={d.owner_name} /></div>,
      cardCell: (d) => <PersonChip name={d.owner_name} />,
    },
    { key: 'findings', header: 'Findings', width: 'w-[92px]', align: 'right', priority: 2, sortable: true, card: 'meta', cell: (d) => <span className="tabular-nums">{formatCount(d.finding_count)}</span> },
    ...(canDelete ? [{ key: 'actions', header: 'Actions', width: 'w-[64px]', align: 'right' as const, cell: rowMenu }] : []),
  ];

  const empty = drills.length === 0 ? (
    <EmptyState
      bare
      kind="firstUse"
      title="No drills yet"
      description={canCreate ? 'Schedule a continuity test or link a real incident-triggered invocation.' : 'No drill has been scheduled yet.'}
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>Schedule drill</Button> : undefined}
    />
  ) : (
    <EmptyState bare kind="noMatches" title="No drills match" description="Try another search or filter." onClearFilters={clearFilters} />
  );

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      {!loading && drills.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <TextInput
            ref={searchField} className="w-full sm:w-[280px]" aria-label="Search drills" placeholder="Search drills" maxLength={100} leftAdornment={<Search aria-hidden />}
            value={q} onChange={(e) => setAddr({ q: e.target.value, page: 1 })}
          />
          <Select aria-label="Status" className="w-full sm:w-[160px]" value={status} onChange={(e) => setAddr({ status: e.target.value, page: 1 })}>
            <option value="all">All statuses</option>
            {drillStatus.words.map((s) => <option key={s} value={s}>{drillStatus.label(s)}</option>)}
          </Select>
          <Select aria-label="Type" className="w-full sm:w-[150px]" value={type} onChange={(e) => setAddr({ type: e.target.value, page: 1 })}>
            <option value="all">All types</option>
            {drillType.words.map((s) => <option key={s} value={s}>{drillType.label(s)}</option>)}
          </Select>
          <Select aria-label="Source" className="w-full sm:w-[184px]" value={source} onChange={(e) => setAddr({ source: e.target.value, page: 1 })}>
            <option value="all">All sources</option>
            {sourceType.words.map((s) => <option key={s} value={s}>{sourceType.label(s)}</option>)}
          </Select>
          <span aria-live="polite" className={`text-ds-body ${MUTED} sm:ml-auto`}>{rowCountText({ shown: matches.length, total, noun: NOUN.one, plural: NOUN.other })}</span>
        </div>
      )}

      {cut && <Notice tone="warning" title={cut.title}>{cut.message}</Notice>}

      <RegisterTable
        caption="Drills and invocations"
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        sort={sort}
        onSortChange={(next) => setAddr({ sort: next, page: 1 })}
        loading={loading}
        empty={empty}
        cardTitle={title}
        cardActions={canDelete ? rowMenu : undefined}
        footer={matches.length > 0 ? (
          <Pager
            page={range.page} pageSize={size} total={matches.length} noun={NOUN} pageSizes={PAGE_SIZES}
            onPage={(p) => setAddr({ page: p })} onPageSize={(n) => setAddr({ size: n, page: 1 })}
          />
        ) : undefined}
      />

      {creating && <DrillForm mode={{ kind: 'create' }} onClose={() => setAddr({ new: false })} />}
      {confirmDialog}
    </div>
  );
}
