'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Continuity Plans. The request is the one it always was (GET /bcm/plans, key ['bcm-plans']: the server sends up to 200 plans, most recently updated first, and
// the TRUE total); the search, the status filter, the sort and the page work on the rows that came, and the count is the server's total, not the length of what loaded: a list the
// server cut says so. The filters, the sort and the page are kept in the address (?q= status= sort= page= size=), so a link, a reload and the Back button land where the person was.
// On the design-system kit: PageHeader variant="page", RegisterTable (cards below 768px) with Pager, a row menu that is always visible, useConfirm before a delete (it names what goes
// with the plan), useReportedMutation for the delete, PlanForm (a drawer that asks before it throws typing away).
import { useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDate, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { planStatus } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, PersonChip, RegisterTable, Select, TextInput, rowCountText, useAddressState, useConfirm, useReportedMutation,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { HoursText, Pill, TitleLink } from '../_parts';
import {
  PAGE_SIZES, PLAN_LIST_SCHEMA, asPage, cutNotice, filterPlans, ordered, pageOf, planDeleteWords, planSortValue, retryRead, type Page, type Plan,
} from '../bcmModel';
import { PlanForm } from './_PlanForm';

const MUTED = 'text-ds-fg-muted';
const NOUN = { one: 'plan', other: 'plans' };

export default function BcmPlansPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:plans:create');
  const canDelete = hasPermission('bcm:plans:delete');
  const [addr, setAddr] = useAddressState(PLAN_LIST_SCHEMA);
  const { q, status, sort, page, size } = addr;
  const { confirm, confirmDialog } = useConfirm();
  const searchField = useRef<HTMLInputElement>(null);

  const list = useQuery<Page<Plan>>({
    queryKey: ['bcm-plans'],
    queryFn: async () => {
      const answer = asPage<Plan>((await bcmApi.plans.list()).data);
      if (!answer) throw new Error('The server answered in a form this page cannot read.');
      return answer;
    },
    placeholderData: keepPreviousData,
    retry: retryRead,
  });

  const remove = useReportedMutation({
    mutationFn: async (p: Plan) => (await bcmApi.plans.remove(p.id)).data,
    success: 'Plan deleted', failure: "Couldn't delete the plan", invalidate: [['bcm-plans']],
    // the row the person was on is gone, and focus with it: back to where the list starts, unless they are typing or a dialog is open
    onSuccess: () => {
      const here = document.activeElement;
      const busy = !!here && here !== document.body && !!(here.closest('[role="dialog"]') || here.matches('input, textarea, select'));
      if (!busy) searchField.current?.focus();
    },
  });
  const askDelete = async (p: Plan) => {
    if (await confirm({ ...planDeleteWords(p), tone: 'danger' })) remove.mutate(p);
  };

  const plans = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? plans.length;
  const matches = useMemo(() => ordered(filterPlans(plans, { q, status }), sort, planSortValue), [plans, q, status, sort]);
  const { rows, range } = pageOf(matches, page, size);
  const cut = cutNotice({ loaded: plans.length, total, noun: NOUN });
  const clearFilters = () => setAddr({ q: '', status: 'all', page: 1 });
  const openCreate = () => setAddr({ new: true });
  const failed = list.isError && !list.data;
  const loading = !failed && !list.data;
  const creating = addr.new && canCreate;

  const head = (
    <PageHeader
      variant="page"
      title={routeFor('/bcm/plans')?.label ?? 'Continuity Plans'}
      info="Business continuity plans: their recovery objectives, business impact analysis and drills."
      actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>Add plan</Button> : undefined}
    />
  );

  if (failed) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the plans" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />
        {confirmDialog}
      </div>
    );
  }

  /** what can be done to one plan: always visible (a "⋯" button), never behind a hover */
  const rowMenu = (p: Plan) => (
    <Menu
      iconOnly
      label={`Actions for ${truncate(p.title, 60).text}`}
      items={[
        { key: 'open', label: 'Open', icon: ExternalLink, onSelect: () => router.push(`/bcm/plans/${p.id}`) },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(p); } },
      ]}
    />
  );

  const columns: RegisterColumn<Plan>[] = [
    {
      key: 'title', header: 'Plan', isRowHeader: true, sortable: true,
      cell: (p) => (
        <div className="min-w-0">
          <TitleLink href={`/bcm/plans/${p.id}`} title={p.title} />
          {p.business_unit && <span className={`mt-[2px] line-clamp-1 break-words text-ds-label font-normal ${MUTED}`} title={p.business_unit}>{p.business_unit}</span>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', width: 'w-[120px]', sortable: true, card: 'meta', cell: (p) => <Pill registry={planStatus} word={p.status} /> },
    {
      key: 'rto', header: 'RTO', width: 'w-[68px]', align: 'right', priority: 2, sortable: true, card: 'meta', cardLabel: 'RTO / RPO',
      cell: (p) => <HoursText h={p.rto_hours} />,
      cardCell: (p) => <span className="inline-flex flex-wrap items-center gap-x-[6px]"><HoursText h={p.rto_hours} /><span aria-hidden className={MUTED}>/</span><HoursText h={p.rpo_hours} /></span>,
    },
    { key: 'rpo', header: 'RPO', width: 'w-[68px]', align: 'right', priority: 2, sortable: true, card: 'hide', cell: (p) => <HoursText h={p.rpo_hours} /> },
    {
      key: 'review', header: 'Review due', width: 'w-[112px]', priority: 2, sortable: true, card: 'meta',
      cell: (p) => <span className={`whitespace-nowrap ${p.next_review_due ? '' : MUTED}`}>{formatDate(p.next_review_due, { calendar: true, empty: NOT_SET })}</span>,
    },
    {
      key: 'owner', header: 'Owner', width: 'w-[160px]', priority: 3, sortable: true, card: 'meta',
      cell: (p) => <div className="max-w-[148px]"><PersonChip name={p.owner_name} /></div>,
      cardCell: (p) => <PersonChip name={p.owner_name} />,
    },
    {
      key: 'bia', header: 'BIA / Drills', width: 'w-[104px]', align: 'right', priority: 3, card: 'meta', cardLabel: 'BIA processes / drills',
      cell: (p) => <span className="whitespace-nowrap tabular-nums">{`${formatCount(p.bia_count)} / ${formatCount(p.drill_count)}`}</span>,
    },
    ...(canDelete ? [{ key: 'actions', header: 'Actions', width: 'w-[64px]', align: 'right' as const, cell: rowMenu }] : []),
  ];

  const empty = plans.length === 0 ? (
    <EmptyState
      bare
      kind="firstUse"
      title="No continuity plans yet"
      description={canCreate ? 'Create your first BCM plan to start tracking recovery objectives and drills.' : 'No continuity plan has been created yet.'}
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>Add plan</Button> : undefined}
    />
  ) : (
    <EmptyState bare kind="noMatches" title="No plans match" description="Try another search or status." onClearFilters={clearFilters} />
  );

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      {!loading && plans.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <TextInput
            ref={searchField} className="w-full sm:w-[280px]" aria-label="Search plans" placeholder="Search plans" maxLength={100} leftAdornment={<Search aria-hidden />}
            value={q} onChange={(e) => setAddr({ q: e.target.value, page: 1 })}
          />
          <Select aria-label="Status" className="w-full sm:w-[176px]" value={status} onChange={(e) => setAddr({ status: e.target.value, page: 1 })}>
            <option value="all">All statuses</option>
            {planStatus.words.map((s) => <option key={s} value={s}>{planStatus.label(s)}</option>)}
          </Select>
          <span aria-live="polite" className={`text-ds-body ${MUTED} sm:ml-auto`}>{rowCountText({ shown: matches.length, total, noun: NOUN.one, plural: NOUN.other })}</span>
        </div>
      )}

      {cut && <Notice tone="warning" title={cut.title}>{cut.message}</Notice>}

      <RegisterTable
        caption="Continuity plans"
        columns={columns}
        rows={rows}
        getRowId={(p) => p.id}
        sort={sort}
        onSortChange={(next) => setAddr({ sort: next, page: 1 })}
        loading={loading}
        empty={empty}
        cardTitle={(p) => (
          <div className="min-w-0">
            <TitleLink href={`/bcm/plans/${p.id}`} title={p.title} />
            {p.business_unit && <span className={`mt-[2px] line-clamp-1 break-words text-ds-label font-normal ${MUTED}`} title={p.business_unit}>{p.business_unit}</span>}
          </div>
        )}
        cardActions={canDelete ? rowMenu : undefined}
        footer={matches.length > 0 ? (
          <Pager
            page={range.page} pageSize={size} total={matches.length} noun={NOUN} pageSizes={PAGE_SIZES}
            onPage={(p) => setAddr({ page: p })} onPageSize={(n) => setAddr({ size: n, page: 1 })}
          />
        ) : undefined}
      />

      {creating && <PlanForm plan={null} onClose={() => setAddr({ new: false })} />}
      {confirmDialog}
    </div>
  );
}
