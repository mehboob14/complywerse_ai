'use client';

// Obligations: every duty the circular sets, clause by clause. Each row says what it requires, who owns it, whether we comply and what meets it; open one in the drawer to read the circular's own
// words, set compliance, name owners, link controls and follow its tasks, then step to the next. The list is a paged table, so a 200-obligation circular is never 200 rows in the page; the filters
// and the open obligation are in the address (the Overview's links and the control page's card land here that way). A quote the circular does not contain word for word is flagged for a person to check.
import { useMemo, useState } from 'react';
import { ClipboardList, ListChecks, Plus, Sparkles } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, Notice, Pager, PersonStack, RegisterTable, Select, StatusPill, Textarea, TextInput, useConfirm, useNotify, useReportedMutation,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { regulatoryApi } from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { compliance, obligationType, optionsOf } from '@/lib/statuses/regulatory';
import { NO_OBLIGATION_PATCH, obligationFiltersOf, obligationPatch, type DetailAddress } from '../_lib/detailAddress';
import { usePeople, useLinks, useObligations, useTasks } from '../_lib/data';
import { taskForObligation } from '../_lib/drafts';
import {
  CONTROL_LABEL, PRIORITIES, controlStateOf, filterObligations, linksByObligation, numberOf, obligationFiltering, ownersOf, toCheckOf, type ObligationFilters,
} from '../_lib/regulatoryModel';
import type { Obligation, RegLink, Task, TaskDraft } from '../_lib/types';
import { ObligationDrawer } from './_ObligationDrawer';

const PAGE_SIZES = [25, 50, 100] as const;
const ALL = '';

interface Props {
  changeId: number;
  address: DetailAddress;
  setAddress: (patch: Partial<DetailAddress>) => void;
  onTask: (task: Task | TaskDraft) => void;
}

function ControlNote({ links }: { links?: RegLink[] }) {
  const { confirmed, proposed } = controlStateOf(links);
  if (confirmed) return <span className="text-ds-success">{`${confirmed} ${confirmed === 1 ? 'control' : 'controls'}`}</span>;
  if (proposed) return <span className="text-ds-warning">{`${proposed} ${proposed === 1 ? 'suggestion' : 'suggestions'} to review`}</span>;
  return <span>No control yet</span>;
}

export default function ObligationsTab({ changeId, address, setAddress, onTask }: Props) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const obligations = useObligations(changeId);
  const linksQ = useLinks(changeId);
  const tasksQ = useTasks(changeId);
  const people = usePeople();
  const all = useMemo(() => obligations.data ?? [], [obligations.data]);
  const links = useMemo(() => linksQ.data ?? [], [linksQ.data]);
  const [adding, setAdding] = useState(false);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const filters = obligationFiltersOf(address);
  const setFilters = (f: ObligationFilters) => { setAddress(obligationPatch(f)); setPageNo(1); };
  const byObligation = useMemo(() => linksByObligation(links), [links]);
  const numbers = useMemo(() => numberOf(all), [all]);
  const tasksOf = useMemo(() => {
    const out = new Map<number, Task[]>();
    (tasksQ.data ?? []).forEach((t) => { if (t.obligation_id) out.set(t.obligation_id, (out.get(t.obligation_id) ?? []).concat(t)); });
    return out;
  }, [tasksQ.data]);
  const shown = useMemo(() => filterObligations(all, filters, byObligation, numbers), [all, filters.q, filters.compliance, filters.type, filters.control, filters.owner, filters.check, byObligation, numbers]);  // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = obligationFiltering(filters);

  const met = all.filter((o) => controlStateOf(byObligation.get(o.id)).state === 'met').length;
  const suggestions = links.filter((l) => l.status === 'proposed').length;
  const toCheck = all.filter(toCheckOf).length;

  const refreshObligations = [['regulatory-obligations', changeId], ['regulatory-change', changeId], ['regulatory-changes'], ['regulatory-overview'], ['regulatory-my-work']];
  const save = useReportedMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown>; words?: string }) => regulatoryApi.updateObligation(id, data),
    failure: "Couldn't save the obligation", invalidate: refreshObligations,
    onSuccess: (_, v) => { if (v.words) notify.success(v.words); },
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => regulatoryApi.deleteObligation(id),
    success: { title: 'Obligation removed', message: 'Its control links went with it.' }, failure: "Couldn't remove the obligation",
    invalidate: [...refreshObligations, ['regulatory-links', changeId]],
    onSuccess: (_, id) => { if (address.obl === id) setAddress({ obl: 0 }); },
  });
  const suggest = useReportedMutation({
    mutationFn: () => regulatoryApi.suggestControls(changeId),
    success: { title: 'Control suggestions updated', message: 'Review them on each obligation.' }, failure: "Couldn't suggest controls", invalidate: [['regulatory-links', changeId], ['regulatory-overview'], ['regulatory-changes']],
  });
  const refreshLinks = () => { void linksQ.refetch(); };

  const askRemove = async (o: Obligation) => {
    const yes = await confirm({
      title: 'Remove this obligation?',
      message: `Obligation ${numbers.get(o.id)}: “${truncate(o.summary, 140).text}”. Its control links go with it. The tasks raised for it stay.`,
      confirmLabel: 'Remove obligation', tone: 'danger',
    });
    if (yes) remove.mutate(o.id);
  };

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const page = Math.min(pageNo, pages);
  const rows = useMemo(() => shown.slice((page - 1) * pageSize, page * pageSize), [shown, page, pageSize]);
  const open = address.obl ? all.find((o) => o.id === address.obl) ?? null : null;
  const at = open ? shown.findIndex((o) => o.id === open.id) : -1;
  const missing = address.obl > 0 && !!obligations.data && !open;

  const columns: RegisterColumn<Obligation>[] = [
    { key: 'n', header: '#', width: 'w-[56px]', cell: (o) => <span className="tabular-nums text-ds-label text-ds-fg-muted" title={`Obligation ${numbers.get(o.id)} of ${all.length}`}><span className="sr-only">Obligation </span>{numbers.get(o.id)}</span>, card: 'hide' },
    {
      key: 'summary', header: 'Obligation', isRowHeader: true,
      cell: (o) => {
        const mine = tasksOf.get(o.id) ?? [];
        const done = mine.filter((t) => t.status === 'completed').length;
        return (
          <div className="min-w-0">
            <p className="m-0 line-clamp-2 text-ds-body text-ds-fg [overflow-wrap:anywhere]" title={o.summary}>{o.summary}</p>
            <p className="m-0 flex flex-wrap gap-x-[8px] text-ds-label text-ds-fg-muted">
              {o.ref && <span>{`Clause ${o.ref}`}</span>}
              <span>{obligationType.label(o.obligation_type)}</span>
              {(o.deadline || o.deadline_text) && <span className="text-ds-danger">{`Due ${o.deadline ? formatDate(o.deadline, { calendar: true }) : o.deadline_text}`}</span>}
              <ControlNote links={byObligation.get(o.id)} />
              {mine.length > 0 && <span>{`${done} of ${mine.length} ${mine.length === 1 ? 'task' : 'tasks'} done`}</span>}
              {toCheckOf(o) && <span className="font-[600] text-ds-warning">Check the wording</span>}
            </p>
          </div>
        );
      },
      cardLabel: 'Obligation',
    },
    { key: 'owners', header: 'Owners', priority: 2, cell: (o) => <PersonStack people={(o.owners || []).map((w) => w.display_name)} label="Owners" size={24} />, card: 'meta' },
    { key: 'compliance', header: 'Compliance', cell: (o) => <StatusPill size="sm" {...statusPill(compliance, o.compliance_status)} />, card: 'meta' },
    {
      key: 'task', header: '', width: 'w-[48px]', priority: 2, card: 'hide',
      cell: (o) => <IconButton label={`Create a task for obligation ${numbers.get(o.id)}`} onClick={() => onTask(taskForObligation(o))}><ClipboardList aria-hidden /></IconButton>,
    },
  ];

  const ownerOptions = [{ value: 'none', label: 'Unassigned' }].concat(
    Array.from(new Set(all.flatMap(ownersOf))).map((id) => ({ value: String(id), label: people.users.find((u) => u.id === id)?.display_name || all.flatMap((o) => o.owners || []).find((w) => w.id === id)?.display_name || 'Someone no longer here' })).sort((a, b) => a.label.localeCompare(b.label)),
  );

  if (obligations.isError && !obligations.data) {
    return <ErrorState title="Couldn't load the obligations" message={errorMessage(obligations.error)} onRetry={canRetry(obligations.error) ? () => { void obligations.refetch(); } : undefined} />;
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {all.length > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-body text-ds-fg-body">
          <Button variant="link" onClick={() => setFilters({ ...filters, control: filters.control === 'met' ? '' : 'met' })}>{`${met} of ${all.length} met by a control`}</Button>
          {suggestions > 0 && <Button variant="link" onClick={() => setFilters({ ...filters, control: filters.control === 'review' ? '' : 'review' })}>{`${suggestions} ${suggestions === 1 ? 'suggestion' : 'suggestions'} to review`}</Button>}
          {toCheck > 0 && <Button variant="link" onClick={() => setFilters({ ...filters, check: !filters.check })}>{`${toCheck} to check against the circular`}</Button>}
        </p>
      )}

      <div role="search" aria-label="Filter the obligations" className="flex flex-wrap items-end gap-[8px]">
        <TextInput type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search obligations" placeholder="Search obligations" autoComplete="off" className="min-w-[160px] max-w-[280px] flex-1" />
        <Select aria-label="Compliance" value={filters.compliance} onChange={(e) => setFilters({ ...filters, compliance: e.target.value })} className="w-auto">
          <option value={ALL}>All compliance</option>{optionsOf(compliance).map((o) => <option key={o.value} value={o.value}>{`${o.label} (${all.filter((x) => x.compliance_status === o.value).length})`}</option>)}
        </Select>
        <Select aria-label="Type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="w-auto">
          <option value={ALL}>All types</option>{optionsOf(obligationType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select aria-label="Controls" value={filters.control} onChange={(e) => setFilters({ ...filters, control: e.target.value })} className="w-auto">
          <option value={ALL}>Any control state</option>{(['met', 'review', 'none'] as const).map((k) => <option key={k} value={k}>{CONTROL_LABEL[k]}</option>)}
        </Select>
        <Select aria-label="Owner" value={filters.owner} onChange={(e) => setFilters({ ...filters, owner: e.target.value })} className="w-auto">
          <option value={ALL}>Any owner</option>{ownerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Checkbox label={`Needs checking (${toCheck})`} checked={filters.check} onChange={(e) => setFilters({ ...filters, check: e.target.checked })} />
        {filtering && <Button variant="link" onClick={() => { setAddress(NO_OBLIGATION_PATCH); setPageNo(1); }}>Clear filters</Button>}
        <div className="ml-auto flex flex-wrap gap-[8px]">
          <Button leftIcon={<Sparkles aria-hidden />} loading={suggest.isPending} disabled={all.length === 0} title="Suggest the controls that meet each obligation" onClick={() => suggest.mutate()}>Suggest controls</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add obligation</Button>
        </div>
      </div>
      {linksQ.isError && !linksQ.data && <Notice tone="warning" title="The control links could not be loaded" action={<Button onClick={() => { void linksQ.refetch(); }}>Retry</Button>}>Which controls meet each obligation is not shown until they load.</Notice>}
      {missing && <Notice tone="warning" title="That obligation is not on this change" action={<Button variant="ghost" onClick={() => setAddress({ obl: 0 })}>Dismiss</Button>}>It may have been removed.</Notice>}

      <RegisterTable<Obligation>
        caption="Obligations of this change"
        columns={columns}
        rows={rows}
        getRowId={(o) => o.id}
        onRowActivate={(o) => setAddress({ obl: o.id })}
        selectedId={address.obl || null}
        loading={obligations.isPending}
        cardTitle={(o) => <span className="line-clamp-3 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{`${numbers.get(o.id)}. ${o.summary}`}</span>}
        empty={(
          <EmptyState
            kind={filtering ? 'noMatches' : 'firstUse'} bare icon={ListChecks} title={all.length === 0 ? 'No obligations yet' : 'No obligation matches'}
            description={all.length === 0 ? 'They appear as the circular is read, or add the first one yourself.' : 'Loosen a filter, or search for other words.'}
            onClearFilters={filtering && all.length > 0 ? () => { setAddress(NO_OBLIGATION_PATCH); setPageNo(1); } : undefined}
          />
        )}
        footer={<Pager page={page} pageSize={pageSize} total={shown.length} onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} pageSizes={PAGE_SIZES} noun={{ one: 'obligation', other: 'obligations' }} />}
      />
      {filtering && all.length > 0 && <p role="status" className="m-0 text-ds-label text-ds-fg-muted">{`${formatCount(shown.length)} of ${formatCount(all.length)} obligations match.`}</p>}

      <ObligationDrawer
        o={open}
        number={open ? numbers.get(open.id) ?? 0 : 0}
        total={all.length}
        links={open ? byObligation.get(open.id) ?? [] : []}
        tasks={open ? tasksOf.get(open.id) ?? [] : []}
        onOpenTask={(t) => onTask(t)}
        onPrev={at > 0 ? () => setAddress({ obl: shown[at - 1].id }) : undefined}
        onNext={at >= 0 && at < shown.length - 1 ? () => setAddress({ obl: shown[at + 1].id }) : undefined}
        onClose={() => setAddress({ obl: 0 })}
        onSave={(data, words) => { if (open) save.mutate({ id: open.id, data, words }); }}
        onLinksChanged={refreshLinks}
        onRemove={() => { if (open) void askRemove(open); }}
        onTask={() => { if (open) onTask(taskForObligation(open)); }}
      />
      <AddObligation changeId={changeId} open={adding} onClose={() => setAdding(false)} />
      {confirmDialog}
    </div>
  );
}

function AddObligation({ changeId, open, onClose }: { changeId: number; open: boolean; onClose: () => void }) {
  const empty = { summary: '', ref: '', obligation_type: 'requirement', priority: 'medium', deadline: '' };
  const [draft, setDraft] = useState(empty);
  const [problem, setProblem] = useState('');
  const ok = draft.summary.trim().length >= 3;
  const close = () => { setDraft(empty); setProblem(''); onClose(); };
  const add = useReportedMutation({
    mutationFn: () => regulatoryApi.addObligation(changeId, { summary: draft.summary.trim(), ref: draft.ref.trim() || undefined, obligation_type: draft.obligation_type, priority: draft.priority, deadline: draft.deadline || undefined }),
    success: 'Obligation added', failure: "Couldn't add the obligation", retryable: false, toast: 'success',
    invalidate: [['regulatory-obligations', changeId], ['regulatory-change', changeId], ['regulatory-changes'], ['regulatory-overview']],
    onSuccess: close, onError: (e) => setProblem(errorMessage(e)),
  });
  return (
    <RightSlidePanel
      isOpen={open} onClose={close} dirty={!!draft.summary.trim() || !!draft.ref.trim()} title="Add an obligation" subtitle="A duty the AI missed, or one from another source" width="w-full max-w-xl"
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!ok} loading={add.isPending} onClick={() => { setProblem(''); add.mutate(); }}>Add obligation</Button></div>}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (ok && !add.isPending) { setProblem(''); add.mutate(); } }}>
        <FormField label="What the circular requires" required hint="At least a few words.">
          <Textarea autoFocus rows={3} maxLength={4000} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="e.g. Report every major cyber incident to the State Bank within 24 hours" />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-3">
          <FormField label="Clause" optional><TextInput value={draft.ref} maxLength={120} placeholder="e.g. 4.2" onChange={(e) => setDraft({ ...draft, ref: e.target.value })} /></FormField>
          <FormField label="Type">
            <Select value={draft.obligation_type} onChange={(e) => setDraft({ ...draft, obligation_type: e.target.value })}>{optionsOf(obligationType).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </FormField>
          <FormField label="Deadline" optional><TextInput type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></FormField>
        </div>
        <FormField label="Priority">
          <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{priority.label(p)}</option>)}</Select>
        </FormField>
        {problem && <p role="alert" className="m-0 text-ds-body text-ds-danger">{problem}</p>}
      </form>
    </RightSlidePanel>
  );
}
