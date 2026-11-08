'use client';

/**
 * The onboarding register: every framework of the library with where its onboarding stands (not started, draft, ready, complete, underway), how many of its
 * required answers are in, when it last changed and whether its journey has started. One action per row: Start, Continue or Open. The filters (state, family,
 * name) live in the address. When the organisation profile is not complete a notice says so at the top; an onboarding can still be started.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Play, Search } from 'lucide-react';
import {
  Button, EmptyState, Notice, ProgressBar, RegisterTable, SectionCard, SegmentedControl, Select, StatusPill, TextInput, useAddressState, useNotify,
  rowCountText, sortRows, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { oneOf, text } from '@/lib/addressState';
import { formatRelative } from '@/lib/format';
import { ONBOARDING_KEYS, onboardingApi, problemOf, STATE_LABEL, type RegisterRow } from '@/lib/frameworkOnboarding';
import {
  actionOf, countsOf, familiesOf, filterRows, journeyWords, knownFamily, orgStages, progressPercent, progressWords, sortValue, startRefusalWords, STATE_FILTERS, STATE_TONE,
  underwayWords, workspaceHref, type StateFilter,
} from './registerModel';

const SCHEMA = { state: oneOf(STATE_FILTERS, 'all'), family: text(), q: text() };
const NAME = 'break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

function NameCell({ row }: { row: RegisterRow }) {
  return (
    <>
      {row.onboarding_id ? <Link href={workspaceHref(row.onboarding_id)} className={NAME}>{row.label}</Link> : <span className="break-words font-[600] text-ds-fg">{row.label}</span>}
      {row.name !== row.label && <span className="block break-words text-ds-label text-ds-fg-muted">{row.name}</span>}
    </>
  );
}

function StateCell({ row }: { row: RegisterRow }) {
  const why = underwayWords(row.underway);
  return (
    <>
      <StatusPill tone={STATE_TONE[row.state]} label={STATE_LABEL[row.state]} size="sm" />
      {why && <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{why}</span>}
    </>
  );
}

function ProgressCell({ row }: { row: RegisterRow }) {
  return <ProgressBar value={progressPercent(row.progress)} valueText={row.progress ? progressWords(row.progress) : undefined} label={`${row.label}: required answers in`} />;
}

export default function OnboardingRegister() {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const [address, setAddress] = useAddressState(SCHEMA);
  const [sort, setSort] = useState<SortState>(null);
  const [startingId, setStartingId] = useState<number | null>(null);
  const register = useQuery({ queryKey: ONBOARDING_KEYS.register, queryFn: onboardingApi.register });

  const all = useMemo(() => register.data?.frameworks ?? [], [register.data]);
  const family = knownFamily(all, address.family);
  const filter = { state: address.state, family, q: address.q };
  const families = familiesOf(all);                                                    // a few dozen rows: no memo needed
  const counts = countsOf(all, filter);
  const rows = sortRows(filterRows(all, filter), sort, sortValue);
  const filtered = address.state !== 'all' || family !== '' || address.q.trim() !== '';

  const start = useMutation({
    mutationFn: (row: RegisterRow) => { setStartingId(row.uploaded_framework_id); return onboardingApi.start(row.uploaded_framework_id); },
    onSuccess: (view) => {
      qc.setQueryData(ONBOARDING_KEYS.detail(view.id), view);
      void qc.invalidateQueries({ queryKey: ONBOARDING_KEYS.register });
      router.push(workspaceHref(view.id));
    },
    onError: (e) => { const p = problemOf(e); notify.error(startRefusalWords(p.status, p.message), { title: "Couldn't start the onboarding" }); },
    onSettled: () => setStartingId(null),
  });

  const chips = STATE_FILTERS.map((s) => ({ value: s, label: `${s === 'all' ? 'All' : STATE_LABEL[s]} ${counts[s]}` }));
  const org = register.data?.org;
  const stages = orgStages(org?.groups);

  const columns: RegisterColumn<RegisterRow>[] = [
    { key: 'name', header: 'Framework', sortable: true, isRowHeader: true, cell: (r) => <NameCell row={r} /> },
    { key: 'family', header: 'Family', sortable: true, priority: 2, card: 'meta', cell: (r) => r.family_label || r.family },
    { key: 'state', header: 'State', sortable: true, card: 'meta', cell: (r) => <StateCell row={r} /> },
    { key: 'progress', header: 'Progress', sortable: true, priority: 2, width: 'w-[180px]', card: 'meta', cell: (r) => <ProgressCell row={r} /> },
    { key: 'updated', header: 'Last change', sortable: true, priority: 3, card: 'meta', cell: (r) => formatRelative(r.updated_at) || '—' },
    {
      key: 'journey', header: 'Journey', sortable: true, priority: 2, card: 'meta',
      cell: (r) => (r.journey
        ? <Link href={`/frameworks/${r.journey.id}`} className="text-ds-body text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{journeyWords(r.journey)}</Link>
        : <span className="text-ds-fg-muted">{journeyWords(null)}</span>),
    },
    {
      key: 'action', header: 'Action', align: 'right', card: 'meta', cardLabel: 'Next step',
      cell: (r) => {
        const a = actionOf(r);
        const label = `${a.label} ${r.label}`;
        return a.starts || !r.onboarding_id
          ? <Button size="sm" variant="primary" leftIcon={<Play aria-hidden />} loading={startingId === r.uploaded_framework_id} aria-label={label} onClick={() => start.mutate(r)}>{a.label}</Button>
          : <Button size="sm" href={workspaceHref(r.onboarding_id)} rightIcon={<ArrowRight aria-hidden />} aria-label={label}>{a.label}</Button>;
      },
    },
  ];

  const clear = () => setAddress({ state: 'all', family: '', q: '' });
  return (
    <div className="flex flex-col gap-[16px]">
      {org && !org.complete && (
        <Notice tone="warning" role="status" title="Complete the organisation profile first" action={<Button size="sm" href="/compliance/organisation">Open profile</Button>}>
          {stages.length > 0 && (
            <ul className="flex flex-wrap gap-x-[16px] gap-y-[2px]">
              {stages.map((s) => <li key={s.key} className="text-ds-label text-ds-fg-body">{s.label}: {s.done} of {s.total}{s.complete ? ' (done)' : ''}</li>)}
            </ul>
          )}
        </Notice>
      )}
      <SectionCard
        id="onboarding" title="Frameworks"
        meta={rowCountText({ shown: rows.length, total: all.length, noun: 'framework', loading: register.isLoading, failed: register.isError })}
        actions={(
          <>
            <TextInput type="search" aria-label="Search the frameworks" placeholder="Search" value={address.q} onChange={(e) => setAddress({ q: e.target.value })} leftAdornment={<Search aria-hidden />} className="w-[14rem]" />
            <Select aria-label="Family" placeholder="All families" value={family} onChange={(e) => setAddress({ family: e.target.value })} className="w-[14rem]">
              {families.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.count})</option>)}
            </Select>
          </>
        )}
      >
        <div className="mb-[12px]">
          <SegmentedControl<StateFilter> label="State" name="onboarding-state" options={chips} value={address.state} onChange={(s) => setAddress({ state: s })} />
        </div>
        <RegisterTable<RegisterRow>
          caption="Framework onboarding"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.uploaded_framework_id}
          sort={sort}
          onSortChange={setSort}
          loading={register.isLoading}
          error={register.isError ? { message: errorMessage(register.error), onRetry: canRetry(register.error) ? () => { void register.refetch(); } : undefined } : null}
          cardTitle={(r) => <NameCell row={r} />}
          empty={filtered ? (
            <EmptyState kind="noMatches" bare title="No framework matches" onClearFilters={clear} />
          ) : (
            <EmptyState kind="firstUse" bare title="No frameworks yet" description="Add a framework to the library first." action={<Button variant="primary" href="/frameworks?tab=library">Open the library</Button>} />
          )}
        />
      </SectionCard>
    </div>
  );
}
