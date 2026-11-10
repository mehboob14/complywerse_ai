'use client';

export const dynamic = 'force-dynamic';

// Every supplier contract on one page (Third-Party Vendor Risk > Vendors > Contracts). What needs a decision (past its date, inside its notice period, or ending within the inbox window)
// is the worklist at the top, while there is still time to renew, renegotiate or leave; below it the register, by view (in force, drafts, ended, all), type and search, kept in the address
// (`?contract=7` opens one contract: reminders and the attention queue link straight to it). On the kit: counters, a work list, a register with phone cards, the contract in a sheet.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Paperclip, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, DebouncedSearch, EmptyState, ErrorState, FilterChips, Pager, RegisterTable, SectionCard, Select, StatTile, StatusPill, WorkRow, sortRows, useAddressState,
  type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { contractState } from '@/lib/statuses/vendorRegister';
import { vendorContractsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import ContractDrawer, { CloseOutDialog, RenewDialog } from '../_lib/contracts/ContractDrawer';
import { CONTRACT_SCHEMA, PAGE_SIZE, VIEWS, filterContracts, inboxOf, sortValue, typesOf, viewCounts, type ViewKey } from '../_lib/contracts/contractsModel';
import { RENEWAL_LABEL, countdown, money, type ContractRow, type Register } from '../_lib/contracts/shared';

const MUTED = 'text-ds-fg-muted';
const INFO = 'Every supplier contract in one place. Anything past its date, inside its notice period, or ending soon is at the top, while there is still time to renew, renegotiate or leave.';
const day = (v?: string | null) => formatDate(v, { calendar: true });

export default function ContractsPage() {
  const label = routeFor('/vendor-risk/contracts')?.label ?? 'Contracts';
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:contracts:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:contracts:create') || canEdit;
  const [address, setAddress] = useAddressState(CONTRACT_SCHEMA);
  const [adding, setAdding] = useState(false);
  const [renewing, setRenewing] = useState<ContractRow | null>(null);
  const [closing, setClosing] = useState<ContractRow | null>(null);

  const list = useQuery<Register>({
    queryKey: ['tprm-contracts'],
    queryFn: async () => (await vendorContractsApi.list()).data,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const data = list.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const inbox = useMemo(() => inboxOf(items), [items]);
  const types = useMemo(() => typesOf(items), [items]);
  const view = address.view as ViewKey;
  const sort = address.sort as SortState;
  const rows = useMemo(() => sortRows(filterContracts(items, { view, type: address.type, q: address.q }), sort, sortValue), [items, view, address.type, address.q, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(address.page as number, pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const counts = data?.counts;
  const perView = viewCounts(counts);
  const value = Object.entries(data?.annual_value || {}).sort((a, b) => b[1] - a[1]);
  const open = (address.contract as number) || 0;
  const filtering = view !== 'current' || !!address.type || !!address.q;
  const clear = () => setAddress({ view: 'current', type: '', q: '', page: 1 });
  const openContract = (id: number) => setAddress({ contract: id });
  const typeName = (t: string) => data?.types[t] || t;

  const columns: RegisterColumn<ContractRow>[] = [
    {
      key: 'supplier', header: 'Supplier', sortable: true, isRowHeader: true,
      cell: (c) => (
        <div className="flex min-w-0 flex-col items-start gap-[2px]">
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={c.vendor.name}>{c.vendor.name}</span>
          {c.vendor.tier && <StatusPill size="sm" {...statusPill(vendorTier, c.vendor.tier)} />}
        </div>
      ),
    },
    {
      key: 'contract', header: 'Contract', sortable: true, card: 'meta',
      cell: (c) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-fg" title={c.title || c.type_label}>{c.title || c.type_label}</span>
          <span className={`flex items-center gap-[4px] text-ds-label ${MUTED}`}>
            {c.type_label}{c.reference && <> · {c.reference}</>}
            {c.evidence_id && <Paperclip aria-label="Signed copy attached" className="h-[12px] w-[12px] shrink-0" strokeWidth={1.75} />}
          </span>
        </div>
      ),
    },
    { key: 'started', header: 'Started', sortable: true, priority: 3, card: 'hide', cell: (c) => <span className="whitespace-nowrap text-ds-fg-body">{day(c.effective_date)}</span> },
    {
      key: 'ends', header: 'Ends', sortable: true, card: 'meta',
      cell: (c) => (
        <span className="text-ds-fg-body">
          {c.ends_on ? day(c.ends_on) : <span className={MUTED}>No end date</span>}
          {c.renewal_type && <span className={`block text-ds-label ${MUTED}`}>{RENEWAL_LABEL[c.renewal_type]}</span>}
        </span>
      ),
    },
    { key: 'notice', header: 'Notice by', sortable: true, priority: 2, card: 'hide', cell: (c) => (c.act_by && c.act_by !== c.ends_on ? <span className="whitespace-nowrap text-ds-fg-body">{day(c.act_by)}</span> : <span className={MUTED}>—</span>) },
    { key: 'value', header: 'Per year', sortable: true, priority: 2, align: 'right', firstDir: 'desc', card: 'meta', cell: (c) => <span className="tabular-nums text-ds-fg-body">{money(c.annual_value, c.currency)}</span> },
    {
      key: 'state', header: 'State', sortable: true, card: 'meta',
      cell: (c) => (
        <span className="flex flex-col items-start gap-[2px]">
          <StatusPill size="sm" {...statusPill(contractState, c.state)} />
          {(c.state === 'lapsed' || c.state === 'decide' || c.state === 'ending') && <span className={`text-ds-label ${MUTED}`}>{countdown(c)}</span>}
        </span>
      ),
    },
  ];

  const stats = [
    {
      label: 'Needs a decision now', value: counts ? formatCount(counts.lapsed + counts.decide) : null, tone: counts && counts.lapsed + counts.decide ? 'danger' as const : undefined,
      note: counts?.lapsed ? `${formatCount(counts.lapsed)} past ${counts.lapsed === 1 ? 'its' : 'their'} date` : `Notice due within ${data?.decide_days ?? 30} days`,
    },
    { label: `Ending within ${data?.inbox_days ?? 90} days`, value: counts ? formatCount(counts.ending) : null, note: 'No notice due yet' },
    { label: 'In force', value: counts ? formatCount(counts.lapsed + counts.decide + counts.ending + counts.in_force) : null, note: counts?.draft ? `${formatCount(counts.draft)} draft${counts.draft === 1 ? '' : 's'} not signed` : 'Signed and running' },
    {
      label: 'Annual value in force', value: counts && value.length ? money(value[0][1], value[0][0] || null) : null,
      note: value.length > 1 ? `+ ${value.slice(1).map(([cur, v]) => money(v, cur || null)).join(' · ')}` : undefined,
    },
  ];

  const head = (
    <>
      <PageHeader
        variant="page"
        title={label}
        info={INFO}
        meta={counts ? `${formatCount(Object.values(counts).reduce((a, b) => a + b, 0))} contracts` : undefined}
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add contract</Button> : undefined}
      />
      <VendorTabs />
    </>
  );

  if (list.isLoading) {
    return <div className="flex flex-col gap-[16px]">{head}<RegisterTable caption="Contracts" columns={columns} rows={[]} getRowId={(c) => c.id} loading cardTitle={(c) => c.vendor.name} /></div>;
  }
  if (list.isError && !data) {
    return <div className="flex flex-col gap-[16px]">{head}<ErrorState title="Couldn't load the contracts" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} /></div>;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {head}
      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.value} tone={s.tone} note={s.note} />)}
      </div>

      <SectionCard id="needs-a-decision" title="Needs a decision" meta={`${formatCount(inbox.length)} ${inbox.length === 1 ? 'contract' : 'contracts'}`}
        info={`Past its date, notice due, or ending within ${data?.inbox_days ?? 90} days.`}>
        {inbox.length === 0 ? (
          <p className={`text-ds-body ${MUTED}`}>Nothing is ending or due for notice in the next {data?.inbox_days ?? 90} days.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {inbox.map((c) => (
              <WorkRow
                key={c.id}
                kind={{ label: contractState.label(c.state), tone: contractState.tone(c.state) }}
                title={`${c.vendor.name} · ${c.title || c.type_label}`}
                onOpen={() => openContract(c.id)}
                context={[countdown(c), c.renewal_type ? RENEWAL_LABEL[c.renewal_type] : c.type_label, c.ends_on ? `${c.renewal_type === 'auto' ? 'renews' : 'ends'} ${day(c.ends_on)}` : null, c.annual_value !== null ? `${money(c.annual_value, c.currency)} a year` : null].filter(Boolean).join(' · ')}
                action={canEdit ? { label: 'Renewed', onClick: () => setRenewing(c), ariaLabel: `Renewed: ${c.vendor.name}, ${c.title || c.type_label}` } : undefined}
                menu={canEdit ? { label: `More for ${c.vendor.name}`, items: [{ key: 'close', label: 'Close out', onSelect: () => setClosing(c) }] } : undefined}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <section aria-labelledby="contracts-register-h" className="flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <h2 id="contracts-register-h" className="!text-ds-section !text-ds-fg">All contracts</h2>
          <FilterChips
            label="Contracts shown"
            chips={VIEWS.map((v) => ({ key: v.key, label: v.label, count: perView ? perView[v.key] : undefined, active: view === v.key }))}
            onToggle={(k) => setAddress({ view: k as ViewKey, page: 1 })}
          />
          <div className="w-[200px]">
            <Select aria-label="Contract type" value={address.type as string} onChange={(e) => setAddress({ type: e.target.value, page: 1 })}>
              <option value="">Every type</option>
              {types.map((t) => <option key={t} value={t}>{typeName(t)}</option>)}
            </Select>
          </div>
          <DebouncedSearch className="w-full max-w-[320px] sm:ml-auto" label="Search contracts" placeholder="Search supplier, title or reference" value={address.q as string} onSearch={(q) => setAddress({ q, page: 1 })} />
        </div>
        <RegisterTable
          caption="Contracts"
          columns={columns}
          rows={shown}
          getRowId={(c) => c.id}
          sort={sort}
          onSortChange={(next) => setAddress({ sort: next, page: 1 })}
          onRowActivate={(c) => openContract(c.id)}
          selectedId={open || null}
          cardTitle={(c) => <span className="line-clamp-2 break-words font-[600] text-ds-fg">{c.vendor.name}</span>}
          empty={items.length === 0
            ? <EmptyState bare kind="firstUse" icon={FileSignature} title="No contracts yet" description={canCreate ? "Add one here, or at the contracting stage of a supplier's assessment." : 'No contracts have been added yet.'} action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add contract</Button> : undefined} />
            : <EmptyState bare kind="noMatches" title="No contract matches" description="Try another search, or take a filter off." onClearFilters={filtering ? clear : undefined} />}
          footer={<Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={(n) => setAddress({ page: n })} noun={{ one: 'contract', other: 'contracts' }} />}
        />
      </section>

      {(adding || open > 0) && <ContractDrawer contractId={adding ? null : open} onClose={() => { if (adding) setAdding(false); else setAddress({ contract: 0 }); }} />}
      {renewing && <RenewDialog contract={renewing} onClose={() => setRenewing(null)} />}
      {closing && <CloseOutDialog contract={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}
