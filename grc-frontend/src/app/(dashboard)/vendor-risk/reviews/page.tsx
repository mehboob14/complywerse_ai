'use client';

export const dynamic = 'force-dynamic';

// Yearly check-ins (Third-Party Vendor Risk > Vendors > Check-ins): once a year whoever looks after a supplier confirms who owns it, whether anything changed, and that the contact details are
// right. A reported change goes to the TPRM team. The view, the scope (my suppliers or everyone), the search and the supplier a reminder links to (`?vendor=7`) are in the address. On the kit:
// a counter per state, a register with phone cards, the check-in and the history in sheets.
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, History as HistoryIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, DebouncedSearch, EmptyState, ErrorState, FilterChips, FormError, FormField, IconButton, Notice, PersonChip, RegisterTable, SegmentedControl, Select, Sheet, Skeleton, StatTile, StatusPill,
  Textarea, TextInput, useAddressState, useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { checkinState } from '@/lib/statuses/vendorRegister';
import { vendorOnboardingApi } from '@/lib/api';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import { usePeople } from '../_lib/portfolioApi';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import {
  CHECKIN_SCHEMA, NOTES_MIN, SHOWS, STATES, cadence, ready, rowsFor, when, type CheckinBoard, type CheckinHistory, type CheckinRow, type CheckinState, type ShowKey,
} from '../_lib/checkinsModel';

const MUTED = 'text-ds-fg-muted';
const day = (v?: string | null) => formatDate(v, { calendar: true });
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const TILE: Record<CheckinState, string> = { overdue: 'Overdue', due_soon: 'Due within 30 days', upcoming: 'Upcoming', done: 'Done recently' };

function useHistory(vendorId: number) {
  return useQuery<CheckinHistory>({
    queryKey: ['tprm-checkin-history', vendorId],
    queryFn: async () => (await vendorOnboardingApi.checkinHistory(vendorId)).data,
    retry: 1,
  });
}

export default function CheckinsPage() {
  const label = routeFor('/vendor-risk/reviews')?.label ?? 'Yearly check-ins';
  const [address, setAddress] = useAddressState(CHECKIN_SCHEMA);
  const show = address.state as ShowKey;
  const scope = address.scope as 'mine' | 'all';
  const q = address.q as string;
  const checking = (address.vendor as number) || 0;
  const [viewing, setViewing] = useState<number | null>(null);

  // A link from a reminder or the attention queue opens that supplier directly, among everyone's.
  useEffect(() => { if (checking) setAddress({ scope: 'all', state: 'all' }); }, [checking, setAddress]);

  const list = useQuery<CheckinBoard>({
    queryKey: ['tprm-checkins', scope, q],
    queryFn: async () => (await vendorOnboardingApi.checkins({ scope, search: q || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  const data = list.data;
  const rows = useMemo(() => rowsFor(data?.items ?? [], show), [data, show]);
  const counts = data?.counts;

  const columns: RegisterColumn<CheckinRow>[] = [
    {
      key: 'supplier', header: 'Supplier', isRowHeader: true,
      cell: (r) => (
        <div className="flex min-w-0 flex-col items-start gap-[2px]">
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={r.name}>{r.name}</span>
          {r.tier && <StatusPill size="sm" {...statusPill(vendorTier, r.tier)} />}
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (r) => (r.owner?.name ? <span className="block max-w-[220px]"><PersonChip name={r.owner.name} /></span> : <span className="text-ds-fg-body">No owner</span>) },
    {
      key: 'last', header: 'Last check-in', priority: 2, card: 'meta',
      cell: (r) => (r.last ? (
        <span className="text-ds-fg-body">
          {day(r.last.at)} <span className={`text-ds-label ${MUTED}`}>by {r.last.by || '—'}</span>
          {r.last.changed && <span className="ml-[6px] inline-block"><StatusPill size="sm" tone="warning" label="Change reported" /></span>}
        </span>
      ) : <span className={MUTED}>Never</span>),
    },
    {
      key: 'due', header: 'Next due', card: 'meta',
      cell: (r) => (
        <span className="flex flex-col items-start gap-[2px]">
          <StatusPill size="sm" {...statusPill(checkinState, r.state)} />
          <span className={`text-ds-label ${MUTED}`}>{day(r.due_date)} · {when(r.days)}</span>
        </span>
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'right', card: 'hide',
      cell: (r) => (
        <span className="inline-flex items-center gap-[6px]">
          <IconButton label={`History of ${r.name}`} onClick={() => setViewing(r.vendor_id)}><HistoryIcon aria-hidden /></IconButton>
          {r.can_check_in && <Button variant="primary" size="sm" leftIcon={<CalendarCheck aria-hidden />} aria-label={`Check in: ${r.name}`} onClick={() => setAddress({ vendor: r.vendor_id })}>Check in</Button>}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info={`Once ${cadence(data?.every_days)}, whoever looks after a supplier confirms who owns it, whether anything changed, and that the contact details are right. A reported change goes to the TPRM team.`}
        meta={counts ? `${formatCount(counts.overdue)} overdue` : undefined}
        actions={<SegmentedControl label="Whose suppliers" name="checkin-scope" value={scope} onChange={(v) => setAddress({ scope: v })} options={[{ value: 'mine', label: 'My suppliers' }, { value: 'all', label: 'Everyone' }]} />}
      />
      <VendorTabs />

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        {STATES.map((s) => <StatTile key={s} label={TILE[s]} value={counts ? formatCount(counts[s]) : null} tone={s === 'overdue' && counts?.overdue ? 'danger' : undefined} />)}
      </div>

      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <FilterChips
          label="Check-ins shown"
          chips={SHOWS.map((s) => ({ key: s.key, label: s.label, count: s.key === 'all' ? undefined : counts?.[s.key as CheckinState], active: show === s.key }))}
          onToggle={(k) => setAddress({ state: k as ShowKey })}
        />
        <DebouncedSearch className="w-full max-w-[320px] sm:ml-auto" label="Search suppliers" placeholder="Search suppliers" value={q} onSearch={(next) => setAddress({ q: next })} loading={list.isFetching && !list.isLoading} />
      </div>

      <RegisterTable
        caption="Yearly check-ins"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.vendor_id}
        loading={list.isLoading}
        error={list.isError && !data ? { message: errorMessage(list.error), onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
        empty={(
          <EmptyState
            bare
            kind="noMatches"
            title={show === 'overdue' ? 'Nothing overdue' : 'Nothing in this view'}
            description={scope === 'mine' ? 'This shows your own suppliers. Switch to Everyone to see all of them.' : undefined}
            onClearFilters={q || show !== 'overdue' ? () => setAddress({ state: 'overdue', q: '' }) : undefined}
          />
        )}
        cardTitle={(r) => <span className="line-clamp-2 break-words font-[600] text-ds-fg">{r.name}</span>}
        footer={rows.length > 0 ? <p className={`px-[4px] pt-[8px] text-ds-label ${MUTED}`}>{formatCount(rows.length)} {rows.length === 1 ? 'supplier' : 'suppliers'}</p> : undefined}
      />

      {checking > 0 && <CheckinSheet vendorId={checking} onClose={() => setAddress({ vendor: 0 })} />}
      {viewing && <HistorySheet vendorId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CheckinSheet({ vendorId, onClose }: { vendorId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const people = usePeople();
  const history = useHistory(vendorId);
  const data = history.data;
  const [stillOwner, setStillOwner] = useState<boolean | null>(null);
  const [newOwner, setNewOwner] = useState<number | ''>('');
  const [changed, setChanged] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [contactOk, setContactOk] = useState<boolean | null>(null);
  const [contact, setContact] = useState({ primary_contact_name: '', primary_contact_email: '', primary_contact_phone: '' });
  const [problem, setProblem] = useState<unknown>(null);
  useEffect(() => {
    if (data) setContact({ primary_contact_name: data.vendor.primary_contact_name || '', primary_contact_email: data.vendor.primary_contact_email || '', primary_contact_phone: data.vendor.primary_contact_phone || '' });
  }, [data]);
  const save = useReportedMutation({
    mutationFn: () => vendorOnboardingApi.checkIn(vendorId, {
      still_owner: !!stillOwner, new_owner_id: stillOwner ? null : Number(newOwner) || null,
      changed: !!changed, change_notes: notes, contact_current: !!contactOk, contact: contactOk ? undefined : contact,
    }),
    success: 'Check-in saved',
    failure: "Couldn't save the check-in",
    toast: 'success',
    retryable: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tprm-checkins'] });
      void qc.invalidateQueries({ queryKey: ['tprm-checkin-history', vendorId] });
      onClose();
    },
    onError: setProblem,
  });
  const ok = ready({ stillOwner, newOwner, changed, notes, contactOk });
  const dirty = stillOwner !== null || changed !== null || contactOk !== null || notes !== '';
  const yn = (v: boolean | null): string => (v === null ? '' : v ? 'yes' : 'no');
  const LEGEND = 'p-0 text-ds-body font-[600] text-ds-fg';

  return (
    <Sheet
      open
      onClose={onClose}
      title={data ? `Yearly check-in: ${data.vendor.name}` : 'Yearly check-in'}
      subtitle={data ? `Due ${day(data.due_date)}` : undefined}
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          {data?.can_check_in && <Button type="submit" form={`${uid}-checkin`} variant="primary" loading={save.isPending} disabled={!ok}>Save check-in</Button>}
        </div>
      )}
    >
      {history.isLoading ? (
        <div aria-busy="true" className="flex flex-col gap-[12px]"><Skeleton className="h-[48px] w-full" /><Skeleton className="h-[48px] w-full" /><Skeleton className="h-[48px] w-full" /></div>
      ) : history.isError || !data ? (
        <ErrorState title="Couldn't load this supplier" message={errorMessage(history.error)} onRetry={() => { void history.refetch(); }} />
      ) : !data.can_check_in ? (
        <Notice tone="info" title="Not yours to check in">Only the people looking after this supplier can check in on it.</Notice>
      ) : (
        <form id={`${uid}-checkin`} className="flex flex-col gap-[20px]" onSubmit={(e) => { e.preventDefault(); if (ok) { setProblem(null); save.mutate(); } }}>
          <FormError title="Couldn't save the check-in" error={problem} />
          <fieldset className="m-0 flex flex-col items-start gap-[8px] border-0 p-0">
            <legend className={LEGEND}>Is {data.vendor.owner || 'the current owner'} still the right owner?</legend>
            <SegmentedControl label="Still the right owner" name={`${uid}-owner`} value={yn(stillOwner)} onChange={(v) => setStillOwner(v === 'yes')} options={YES_NO} />
            {stillOwner === false && (
              <FormField label="Who owns it now?" required className="w-full">
                <Select value={String(newOwner)} onChange={(e) => setNewOwner(e.target.value ? Number(e.target.value) : '')} placeholder="Choose the new owner">
                  {people.filter((p) => p.id !== data.vendor.owner_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
            )}
          </fieldset>
          <fieldset className="m-0 flex flex-col items-start gap-[8px] border-0 p-0">
            <legend className={LEGEND}>Has anything about the relationship changed?</legend>
            <p className={`text-ds-label ${MUTED}`}>New services, new data, new countries, or relying on them more or less.</p>
            <SegmentedControl label="Anything changed" name={`${uid}-changed`} value={yn(changed)} onChange={(v) => setChanged(v === 'yes')} options={YES_NO} />
            {changed && <FormField label="What changed?" required hint={`At least ${NOTES_MIN} characters. The TPRM team will follow up.`} className="w-full"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>}
          </fieldset>
          <fieldset className="m-0 flex flex-col items-start gap-[8px] border-0 p-0">
            <legend className={LEGEND}>Are their contact details still right?</legend>
            <p className={`text-ds-label ${MUTED}`}>{[data.vendor.primary_contact_name, data.vendor.primary_contact_email, data.vendor.primary_contact_phone].filter(Boolean).join(' · ') || 'No contact on record.'}</p>
            <SegmentedControl label="Contact details right" name={`${uid}-contact`} value={yn(contactOk)} onChange={(v) => setContactOk(v === 'yes')} options={YES_NO} />
            {contactOk === false && (
              <div className="grid w-full gap-[8px] sm:grid-cols-3">
                <FormField label="Name"><TextInput value={contact.primary_contact_name} onChange={(e) => setContact({ ...contact, primary_contact_name: e.target.value })} /></FormField>
                <FormField label="Email"><TextInput type="email" value={contact.primary_contact_email} onChange={(e) => setContact({ ...contact, primary_contact_email: e.target.value })} /></FormField>
                <FormField label="Phone"><TextInput value={contact.primary_contact_phone} onChange={(e) => setContact({ ...contact, primary_contact_phone: e.target.value })} /></FormField>
              </div>
            )}
          </fieldset>
        </form>
      )}
    </Sheet>
  );
}

function HistorySheet({ vendorId, onClose }: { vendorId: number; onClose: () => void }) {
  const history = useHistory(vendorId);
  const data = history.data;
  return (
    <Sheet open onClose={onClose} title={data?.vendor.name || 'Check-ins'} subtitle={data ? `Next due ${day(data.due_date)}` : undefined} width="md">
      {history.isLoading ? <Skeleton className="h-[96px] w-full" /> : history.isError || !data ? (
        <ErrorState title="Couldn't load the history" message={errorMessage(history.error)} onRetry={() => { void history.refetch(); }} />
      ) : data.items.length === 0 ? (
        <p className={`text-ds-body ${MUTED}`}>No check-ins yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-[12px] p-0">
          {data.items.map((c) => (
            <li key={c.id} className="rounded-ds-card border border-ds-border p-[12px]">
              <p className="flex flex-wrap items-center gap-[8px] text-ds-body font-[600] text-ds-fg">{day(c.completed_at)} · {c.by || '—'}<StatusPill size="sm" tone={c.on_time ? 'success' : 'warning'} label={c.on_time ? 'On time' : 'Late'} /></p>
              <ul className="m-0 mt-[6px] flex list-none flex-col gap-[2px] p-0 text-ds-label text-ds-fg-body">
                <li>Owner: {c.still_owner ? 'unchanged' : `moved to ${c.new_owner || 'someone else'}`}</li>
                <li>Changes: {c.changed ? c.change_notes : 'none reported'}</li>
                <li>Contact: {c.contact_current ? 'still right' : `updated (${Object.keys(c.contact_update || {}).map((k) => k.replace('primary_contact_', '')).join(', ')})`}</li>
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
