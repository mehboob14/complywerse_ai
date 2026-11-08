'use client';

/**
 * Regulatory Feed > Feed: an inbox and a reader. The tabs are New, Analyzed, Converted and Not relevant with the server's true counts; the list is the items of the tab (newest first), the reader is the
 * one under the cursor (j / k move it on a keyboard). Triage is read, decide, next: Analyze with AI, Convert to a regulatory change (it says what it made and links to it), or Not relevant (undoable). Every
 * action says what happened or why it did not. The tab, the search and the item open are in the address. Below 1024px the reader opens as a sheet.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Rss } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterChips, Notice, Sheet, SkeletonRows, StatusPill, TextInput, useAddressState, useNotify, useReportedMutation, type FilterChip } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { moveCursor } from '@/components/records/explorerModel';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { integer, oneOf, text } from '@/lib/addressState';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { feedItemStatus } from '@/lib/statuses/regulatory';
import { FEED_REFRESH, useFeedCounts, useFeedItems, useFeedSources } from '../../regulatory-changes/_lib/data';
import { feedApi } from '../../regulatory-changes/_lib/api';
import type { FeedItem } from '../../regulatory-changes/_lib/types';
import { changeHref } from '../../regulatory-changes/_overview/overviewModel';
import { FeedReader } from './FeedReader';
import { FEED_TABS, convertedWords, descriptionOf, firstTab, statusOfTab, tabCount, type FeedTab } from './feedModel';

const SCHEMA = { status: oneOf(['new', 'analyzed', 'processed', 'ignored', 'all'] as const, 'new'), item: integer(0, { min: 1 }), q: text() };
const LIMIT = 200;

const subscribe = (onChange: () => void) => { const list = window.matchMedia('(min-width: 1024px)'); list.addEventListener('change', onChange); return () => list.removeEventListener('change', onChange); };
const useWide = (): boolean => useSyncExternalStore(subscribe, () => window.matchMedia('(min-width: 1024px)').matches, () => true);

export function FeedInbox({ canCreate, onAdd }: { canCreate: boolean; onAdd: () => void }) {
  const router = useRouter();
  const notify = useNotify();
  const wide = useWide();
  const [address, setAddress] = useAddressState(SCHEMA);
  const tab = address.status as FeedTab;
  const counts = useFeedCounts();
  const sources = useFeedSources();
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useDeferredValue(address.q);
  const itemsQ = useFeedItems(statusOfTab(tab), LIMIT, search);
  const items = useMemo<FeedItem[]>(() => itemsQ.data ?? [], [itemsQ.data]);

  // Open on the first tab that has something when there is nothing new, once, unless the address asked for a tab
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || !counts.data) return;
    settled.current = true;
    if (typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('status')) {
      const first = firstTab(counts.data);
      if (first !== 'new') setAddress({ status: first });
    }
  }, [counts.data, setAddress]);

  const selectedId = address.item || (wide ? items[0]?.id ?? 0 : 0);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const at = selected ? items.findIndex((i) => i.id === selected.id) : -1;
  const select = useCallback((id: number) => setAddress({ item: id }), [setAddress]);
  const after = (id: number) => { const i = items.findIndex((x) => x.id === id); return items[i + 1]?.id ?? items[i - 1]?.id ?? 0; };

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => { const to = moveCursor(ids, selectedId || null, dir); if (to) select(to); },
    onOpen: () => undefined,
    onEscape: () => { if (address.item) select(0); },
  }, true);
  useEffect(() => { if (selectedId) document.querySelector(`[data-feed-item="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selectedId]);

  const invalidate = FEED_REFRESH.map((k) => [...k]);
  const analyze = useReportedMutation({
    mutationFn: (id: number) => feedApi.analyze(id),
    success: { title: 'Analysis ready', message: 'Read it, then convert it to a regulatory change or mark it not relevant.' }, failure: "Couldn't analyse the item", invalidate,
  });
  const convert = useReportedMutation({
    mutationFn: async (id: number) => (await feedApi.convert(id)).data as { id: number },
    failure: "Couldn't convert the item", retryable: false, invalidate,
    onSuccess: (made) => { const w = convertedWords(); notify.success(w.message, { title: w.title, action: { label: 'Open the change', onClick: () => router.push(changeHref(made.id)) } }); },
  });
  const restore = useReportedMutation({
    mutationFn: (id: number) => feedApi.restore(id), success: 'Put back in the list', failure: "Couldn't put the item back", invalidate,
  });
  const dismiss = useReportedMutation({
    mutationFn: (id: number) => feedApi.dismiss(id), failure: "Couldn't mark the item", invalidate,
    onSuccess: (_, id) => {
      notify.success('It is under Not relevant now.', { title: 'Marked not relevant', action: { label: 'Undo', onClick: () => restore.mutate(id) } });
      if (selectedId === id) select(after(id));
    },
  });
  const busyFor = (id: number) => ({
    analyze: analyze.isPending && analyze.variables === id, convert: convert.isPending && convert.variables === id,
    dismiss: dismiss.isPending && dismiss.variables === id, restore: restore.isPending && restore.variables === id,
  });

  const chips: FilterChip[] = FEED_TABS.map((t) => ({ key: t.value, label: t.label, active: tab === t.value, count: tabCount(counts.data, t.value) ?? undefined }));
  const total = tabCount(counts.data, tab);
  const cut = total != null && total > items.length && !search.trim();
  const noFeeds = !!sources.data && sources.data.length === 0 && counts.data?.total === 0;

  const reader = selected && (
    <FeedReader
      item={selected} busy={busyFor(selected.id)} canCreate={canCreate}
      onAnalyze={() => analyze.mutate(selected.id)} onConvert={() => convert.mutate(selected.id)} onDismiss={() => dismiss.mutate(selected.id)} onRestore={() => restore.mutate(selected.id)}
    />
  );

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        <FilterChips label="Feed items" chips={counts.data || counts.isPending ? chips : chips.map((c) => ({ ...c, count: undefined }))} onToggle={(key) => setAddress({ status: key as FeedTab, item: 0 })} overflow="wrap" className="min-w-0 flex-1" />
      </div>
      <TextInput
        ref={searchRef} type="search" value={address.q} onChange={(e) => setAddress({ q: e.target.value, item: 0 })} aria-label="Search the feed" placeholder="Search the feed" autoComplete="off" className="max-w-[360px]"
      />
      {counts.isError && !counts.data && <Notice tone="warning" title="The counts could not be loaded" action={<Button onClick={() => { void counts.refetch(); }}>Retry</Button>}>The items below are still the real ones.</Notice>}
      {cut && <Notice tone="info" title={`Showing the newest ${formatCount(items.length)} of ${formatCount(total)}`}>Search to find an older item.</Notice>}
      {selectedId > 0 && !selected && !itemsQ.isPending && <Notice tone="warning" title="That item is not in this list" action={<Button variant="ghost" onClick={() => select(0)}>Dismiss</Button>}>It may have been moved to another tab.</Notice>}

      {itemsQ.isError && !itemsQ.data ? (
        <ErrorState title="Couldn't load the feed items" message={errorMessage(itemsQ.error)} onRetry={canRetry(itemsQ.error) ? () => { void itemsQ.refetch(); } : undefined} />
      ) : itemsQ.isPending ? (
        <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={3} label="Loading the feed" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {noFeeds ? (
            <EmptyState kind="firstUse" bare icon={Rss} title="No feeds yet" description="Add the address of a regulator's RSS feed, and its announcements arrive here to read."
              action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add a feed</Button> : undefined} />
          ) : search.trim() ? (
            <EmptyState kind="noMatches" bare title="No item matches" description="Search for other words." onClearFilters={() => setAddress({ q: '' })} />
          ) : (
            <EmptyState kind="firstUse" bare icon={Rss} title={tab === 'new' ? 'Nothing new to triage' : 'Nothing here'} description={tab === 'new' ? 'New items appear when a feed is checked. Check the feeds from Manage sources.' : 'Items appear here as they are analysed, converted or set aside.'} />
          )}
        </div>
      ) : (
        <div className={wide ? 'grid items-start gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}>
          <ul aria-label="Feed items" className="m-0 list-none overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {items.map((it) => {
              const on = it.id === selectedId;
              return (
                <li key={it.id} className="border-b border-ds-border last:border-b-0">
                  <button
                    type="button" data-feed-item={it.id} aria-current={on ? 'true' : undefined} onClick={() => select(it.id)}
                    className={`flex min-h-[56px] w-full flex-col items-start gap-[2px] px-[12px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] ${on ? 'bg-ds-primary-soft' : ''}`}
                  >
                    <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{it.title}</span>
                    <span className="flex w-full flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
                      <span className="min-w-0 truncate">{it.feed_source_name || 'A feed'}</span>
                      <span>{formatDate(it.published_date, { empty: 'No date' })}</span>
                      <StatusPill size="sm" {...statusPill(feedItemStatus, it.status)} />
                    </span>
                    <span className="line-clamp-1 w-full text-ds-label text-ds-fg-muted">{descriptionOf(it)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {wide && selected && <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px] lg:sticky lg:top-[12px] lg:max-h-[calc(100vh-24px)] lg:overflow-y-auto">{reader}</div>}
          {wide && !selected && <p className="m-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-ds-body text-ds-fg-muted">Choose an item to read it.</p>}
        </div>
      )}
      {!wide && (
        <Sheet open={!!selected && address.item > 0} onClose={() => select(0)} title={selected?.title ?? 'Feed item'} width="lg"
          actions={at >= 0 ? <span className="text-ds-label text-ds-fg-muted">{`${at + 1} of ${items.length}`}</span> : undefined}>
          {reader}
        </Sheet>
      )}
    </div>
  );
}
