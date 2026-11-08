'use client';

// Needs attention: the Work queue, one ranked list of what in the third-party programme needs somebody today. The Overview's "My work" shows the person's own part of it; this page is all
// of it, with the actions the queue has always had (a note, assign, snooze, close, reopen) and each item's history. It is computed live by /vendor-risk/tpra/attention from current data, so an
// item leaves the list the moment the thing behind it is fixed. Whose items (Everything / Mine), which state (Open / Snoozed / Closed) and the condition are in the address.
// The queue counts ITEMS (23 kinds of condition); the Overview's "Vendors by next step" counts VENDORS by the one thing each waits on, so its numbers are lower. A vendor can be in both.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CheckCircle2, History, MessageSquare, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { EmptyState, ErrorState, FilterChips, SegmentedControl, SkeletonRows, WorkRow, useAddressState, useReportedMutation, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { oneOf, text } from '@/lib/addressState';
import { formatCount, formatDate } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { tpraApi } from '@/lib/api';
import { vendorTier } from '@/lib/statuses/vendor';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { DID, EMPTY, perCondition, type QueueAction, type QueueAnswer, type QueueForm, type QueueItem, type QueueView } from '../_lib/attentionModel';
import { ActionSheet, HistorySheet, type FormValues } from './_sheets';

const SCHEMA = { scope: oneOf(['portfolio', 'mine'] as const, 'portfolio'), view: oneOf(['open', 'snoozed', 'closed'] as const, 'open'), condition: text() };
const SCOPES = [{ value: 'portfolio', label: 'Everything' }, { value: 'mine', label: 'Mine' }] as const;

type ActVars = { item: QueueItem; action: QueueAction; text?: string; until?: string; assignee_id?: number | null };

function contextOf(item: QueueItem): string {
  const who = item.assignee_name ? `Assigned to ${item.assignee_name}` : item.owner_name ? `Owner: ${item.owner_name}` : 'No owner';
  return [
    item.badge, item.vendor_name, item.vendor_tier ? `${vendorTier.label(item.vendor_tier)} tier` : '', who,
    item.snoozed_until ? `Back on ${formatDate(item.snoozed_until, { calendar: true })}${item.snooze_reason ? `: ${item.snooze_reason}` : ''}` : '',
  ].filter(Boolean).join(' · ');
}

export default function AttentionPage() {
  const [{ scope, view, condition }, set] = useAddressState(SCHEMA);
  const [form, setForm] = useState<{ item: QueueItem; action: QueueForm } | null>(null);
  const [history, setHistory] = useState<QueueItem | null>(null);

  const q = useQuery({
    queryKey: ['tprm-attention', scope, view],
    queryFn: async () => (await tpraApi.attention({ scope, view })).data as QueueAnswer,
    ...TPRM_QUERY_OPTS,
  });

  const act = useReportedMutation({
    mutationFn: async (v: ActVars) => (await tpraApi.attentionAct({
      condition: v.item.condition, record_type: v.item.record_type, record_id: v.item.record_id,
      action: v.action, text: v.text, until: v.until, assignee_id: v.assignee_id,
    })).data,
    success: (_data, v) => `You ${DID[v.action]}: ${v.item.title}`,
    failure: "Couldn't save that",
    invalidate: [['tprm-attention'], ['tprm-attention-history'], ['tprm-dashboard']],
    onSuccess: () => setForm(null),
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const per = useMemo(() => perCondition(items), [items]);
  const conditionName = (c: string) => q.data?.conditions?.[c] ?? c;
  const shown = condition ? items.filter((i) => i.condition === condition) : items;
  const chips: FilterChip[] = Object.keys(per).length > 1
    ? [{ key: '', label: 'All', count: items.length, active: condition === '' }, ...Object.keys(per).map((c) => ({ key: c, label: conditionName(c), count: per[c], active: condition === c }))]
    : [];

  const canAct = !!q.data?.can_act;
  const menuFor = (item: QueueItem): MenuItem[] => [
    { key: 'note', label: 'Add a note', icon: MessageSquare, onSelect: () => setForm({ item, action: 'note' }), hidden: !canAct || view !== 'open' },
    { key: 'assign', label: 'Assign', icon: UserPlus, onSelect: () => setForm({ item, action: 'assign' }), hidden: !canAct || view !== 'open' },
    { key: 'snooze', label: 'Snooze', icon: AlarmClock, onSelect: () => setForm({ item, action: 'snooze' }), hidden: !canAct || view !== 'open' },
    { key: 'close', label: 'Close', icon: CheckCircle2, onSelect: () => setForm({ item, action: 'close' }), hidden: !canAct || view !== 'open' },
    { key: 'history', label: 'History', icon: History, onSelect: () => setHistory(item) },
  ];
  const busy = (item: QueueItem) => act.isPending && act.variables?.item.key === item.key;
  const actionFor = (item: QueueItem) => {
    if (canAct && view === 'snoozed') return { label: 'Wake up', onClick: () => act.mutate({ item, action: 'unsnooze' }), loading: busy(item) };
    if (canAct && view === 'closed') return { label: 'Reopen', onClick: () => act.mutate({ item, action: 'reopen' }), loading: busy(item) };
    return { label: 'Open', href: item.link };
  };

  const counts = q.data?.counts;
  const views = (['open', 'snoozed', 'closed'] as QueueView[]).map((v) => ({ value: v, label: `${v[0].toUpperCase()}${v.slice(1)}${counts ? ` ${formatCount(counts[v])}` : ''}` }));

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/vendor-risk/attention') ?? 'Needs attention'}
        info="What needs somebody today, ranked. It is worked out from current data every time, so fixing the thing behind an item removes it."
        back={{ href: '/vendor-risk', label: 'Back to the Overview' }}
        meta={counts && view === 'open' && counts.urgent > 0 ? <span className="font-[600] text-ds-danger">{`${formatCount(counts.urgent)} urgent`}</span> : undefined}
        actions={<SegmentedControl label="Whose items" name="queue-scope" options={SCOPES} value={scope} onChange={(value) => set({ scope: value, condition: '' })} />}
      />
      <SegmentedControl label="Which items" name="queue-view" options={views} value={view} onChange={(value) => { set({ view: value, condition: '' }); setForm(null); }} />
      {chips.length > 0 && <FilterChips label="What the items are about" chips={chips} onToggle={(key) => set({ condition: key === condition ? '' : key })} />}

      {q.isPending && <SkeletonRows rows={6} columns={3} label="Loading the queue" />}
      {q.isError && <ErrorState title="Couldn't load the queue" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      {q.isSuccess && shown.length === 0 && (
        condition
          ? <EmptyState kind="noMatches" title="Nothing here for that condition" description="Pick All to see the rest of the queue." />
          : <p className="m-0 flex items-center gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[24px] text-ds-body text-ds-fg-muted"><CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />{EMPTY[view]}</p>
      )}
      {shown.length > 0 && (
        <ul aria-label="The queue" className="m-0 list-none rounded-ds-card border border-ds-border bg-ds-surface p-[8px]">
          {shown.map((item) => (
            <WorkRow
              key={item.key}
              kind={{ label: item.label, tone: item.tone === 'red' ? 'danger' : 'warning' }}
              title={item.title}
              href={item.link}
              context={contextOf(item)}
              action={actionFor(item)}
              menu={{ label: `More for ${item.title}`, items: menuFor(item) }}
            />
          ))}
        </ul>
      )}

      {form && q.data && (
        <ActionSheet
          key={`${form.item.key}:${form.action}`}
          item={form.item}
          action={form.action}
          assignees={q.data.assignees}
          pending={busy(form.item)}
          onClose={() => setForm(null)}
          onSubmit={(values: FormValues) => act.mutate({ item: form.item, action: form.action, ...values })}
        />
      )}
      {history && <HistorySheet item={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
