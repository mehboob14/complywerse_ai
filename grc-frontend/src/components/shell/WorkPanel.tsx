'use client';

// The Work and context panel: what the person has to do and where they can go, on every page. On the kit's SidePanel, in the three places the window width gives it
// (shellMode.placementOf): docked beside the page from 1440 (the page keeps scrolling, nothing is covered), an overlay opened from the top bar between 1024 and 1439, a bottom
// sheet below 1024. Sections, each a disclosure:
//   Needs my action   the person's queue (the inbox: the same hook, count rule and links as the page), with Retry for a source that could not be loaded
//   In this committee the meetings of the committee a committee page or a meeting page is about
//   In {module}       the module's pages on the person's menu, Documents expanded to its tabs, the Vendor module's eight entries with the numbers that wait at two of them
//   Pinned, Recent    what the person pinned and opened last (per browser)
// Nothing here is a right of its own: every row is on the menu the person already has.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Pin, PinOff, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Disclosure, SidePanel, useNotify } from '@/components/ui/ds';
import { studioApi } from '@/lib/studio/api';
import { activeTab } from '@/lib/navRegistry';
import { KIND_META, dropdownOf } from '@/lib/inbox/buildInbox';
import { dueLine } from '@/lib/inbox/inboxView';
import { holds } from '@/components/layout/navAccess';
import { usePortfolioCounts } from '@/app/(dashboard)/vendor-risk/_lib/portfolioApi';
import { badgeText as vendorBadge } from '@/app/(dashboard)/vendor-risk/_lib/portfolioModel';
import { RAIL } from '@/app/(dashboard)/vendor-risk/_lib/railModel';
import { moduleSection, type PanelItem, type PanelRow } from './panelModel';
import { documentsStrip } from './shellAccess';
import { recordIdsIn, meetingChoices } from './records';
import { useCommitteeMeetings, useCrumbRecords } from './useShellRecords';
import { usePinnedRecent } from './PinnedRecentProvider';
import { useShell, useShellAccess, useShellQueue } from './ShellProvider';
import { useShellRoute } from './useShellRoute';

const ROW = 'flex min-h-ds-control w-full min-w-0 items-center gap-[8px] px-[12px] py-[6px] text-left text-ds-body text-ds-fg-body hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const LIT = 'relative bg-ds-primary-soft font-[600] text-ds-primary-text before:absolute before:bottom-[6px] before:left-0 before:top-[6px] before:w-[3px] before:rounded-r-[2px] before:bg-ds-primary before:content-[""]';
const NOTE = 'px-[12px] py-[8px] text-ds-label text-ds-fg-muted';
const MORE = 'flex min-h-ds-control w-full items-center px-[12px] py-[6px] text-left text-ds-body font-[600] text-ds-primary-text hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

/** A count beside a row: grey, the number drawn and what it means said. */
function Count({ text, label }: { text: string; label?: string }) {
  return (
    <span className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ds-border px-[5px] text-ds-label font-[600] tabular-nums text-ds-fg">
      <span aria-hidden>{text}</span>
      <span className="sr-only">{label ?? text}</span>
    </span>
  );
}

function ModuleRow({ row, first, onPick }: { row: PanelRow; first?: boolean; onPick: () => void }) {
  const Icon = row.icon;
  return (
    <Link
      href={row.href}
      onClick={onPick}
      title={row.name ?? row.label}
      aria-label={row.name}
      aria-current={row.current ? 'page' : undefined}
      data-panel-first={first ? '' : undefined}
      className={clsx(ROW, row.current && LIT, row.depth === 1 && 'pl-[36px]')}
    >
      {Icon && row.depth === 0 && <Icon size={16} strokeWidth={1.75} aria-hidden className={clsx('shrink-0', row.current ? 'text-ds-primary' : 'text-ds-fg-muted')} />}
      <span className="min-w-0 truncate">{row.label}</span>
      {row.count && <Count text={row.count} label={row.countLabel} />}
    </Link>
  );
}

function ModuleList({ items, firstRowIsEntry, onPick }: { items: PanelItem[]; firstRowIsEntry: boolean; onPick: () => void }) {
  let firstSeen = false;
  return (
    <>
      {items.map((item) => {
        if (item.kind === 'heading') return <div key={item.key} role="presentation" className="px-[12px] pb-[2px] pt-[8px] text-ds-label font-[600] text-ds-fg-muted">{item.label}</div>;
        const first = firstRowIsEntry && !firstSeen;
        firstSeen = true;
        return <ModuleRow key={item.key} row={item} first={first} onPick={onPick} />;
      })}
    </>
  );
}

export default function WorkPanel() {
  const ui = useShell();
  const { access, nav } = useShellAccess();
  const queue = useShellQueue();
  const { pathname, litHref } = useShellRoute();
  const records = useCrumbRecords(pathname);
  const pins = usePinnedRecent();
  const notify = useNotify();
  const root = useRef<HTMLDivElement>(null);
  const docked = ui.placement === 'dock';
  const onPick = () => { if (!docked) ui.setPanel(false); };

  // sections the person shut stay shut for this visit; on the queue's own page that section starts shut (the page is the same list)
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const onQueuePage = pathname === '/needs-my-action';
  const isOpen = (id: string, dflt = true) => (id in shut ? !shut[id] : id === 'queue' && onQueuePage ? false : dflt);
  const toggle = (id: string) => (open: boolean) => setShut((s) => ({ ...s, [id]: !open }));

  // Ctrl . asks for focus: the first pending item, else the first row
  useEffect(() => {
    if (!ui.focusRequest) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>('[data-panel-first]') ?? root.current?.querySelector<HTMLElement>('a[href], button');
      el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ui.focusRequest]);

  // the Documents strip the person has (the same studio flag the strip reads) and the tab the page lights
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false, enabled: access.signedIn });
  const studioOn = !!studio.data?.enabled;
  const docTabs = documentsStrip(access, studioOn);
  const docTabPath = activeTab('documents', pathname, { studio: studioOn })?.path;

  const counts = usePortfolioCounts();
  const vendorCounts = Object.fromEntries(RAIL.filter((e) => e.count).map((e) => {
    const text = vendorBadge(counts?.[e.count!]);
    return [e.count!, text ? { text, label: `${text} ${e.waiting ?? ''}`.trim() } : undefined];
  }));
  const section = moduleSection({ nav, litHref, pathname, docTabs, docTabPath, vendorCounts });

  const needs = dropdownOf(queue.inbox, 6);
  const canAssessments = access.isAdmin || holds(access.permissions, 'compliance:assessments:*');
  const loading = queue.inbox.badge.kind === 'loading';

  const ids = recordIdsIn(pathname);
  const committeeId = ids.meetingId != null ? records.meeting?.committeeId ?? null : ids.committeeId;
  const meetings = useCommitteeMeetings(committeeId, ui.panelShown && committeeId != null);
  const [allMeetings, setAllMeetings] = useState(false);
  const choices = meetingChoices(meetings.data, ids.meetingId);

  const hasFirstItem = needs.items.length > 0;

  const togglePin = () => {
    const was = pins.currentPinned;
    const result = pins.toggleCurrent();
    if (result) notify.success(was ? `Unpinned: ${pins.current?.label}` : `Pinned: ${pins.current?.label}`);
  };

  return (
    <SidePanel
      open={ui.panelShown}
      onClose={() => ui.setPanel(false)}
      title="Work and context"
      dockFrom={1440}
      mode={docked ? 'docked' : ui.placement === 'overlay' ? 'overlay' : 'sheet'}
      width="sm"
      padded={false}
      initialFocus={docked ? undefined : '[data-panel-first]'}
      restoreFocus={ui.panelButton}
      closeLabel="Close Work and context"
      // the docked column is 320px, as in the lab (the kit's narrowest width is 360 and the overlay keeps it): a layout-only override, so the page keeps 1032px at 1440
      className="!w-[320px]"
    >
      <div ref={root} data-work-panel="">
        <Disclosure label="Needs my action" level={3} region={false} count={queue.inbox.counts.decision} countLabel="to decide" open={isOpen('queue')} onOpenChange={toggle('queue')}>
          <div aria-busy={loading}>
            {needs.notices.map((n) => (
              <div key={n.source} role="alert" className={clsx(NOTE, 'flex items-center justify-between gap-[8px] !text-ds-danger')}>
                <span>{n.label} could not be loaded.</span>
                <button type="button" onClick={() => queue.refetch(n.source)} className="rounded-ds-control px-[6px] py-[2px] font-[600] text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:min-h-[44px]">Retry</button>
              </div>
            ))}
            {loading && needs.items.length === 0 && [0, 1].map((i) => <div key={i} aria-hidden className="mx-[12px] my-[10px] h-[14px] animate-pulse rounded-ds-control bg-ds-border" style={{ width: `${60 + i * 18}%` }} />)}
            {needs.items.map((item, i) => {
              const due = dueLine(item);
              return (
                <Link key={item.key} href={item.href} onClick={onPick} title={item.title} data-panel-first={i === 0 ? '' : undefined} className={clsx(ROW, 'items-start')}>
                  <ClipboardCheck size={16} strokeWidth={1.75} aria-hidden className="mt-[2px] shrink-0 text-ds-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-[500] text-ds-fg">{item.title}</span>
                    <span className={clsx('block truncate text-ds-label', due.tone === 'danger' ? 'text-ds-danger' : 'text-ds-fg-muted')}>{KIND_META[item.kind].label} · {due.text}</span>
                  </span>
                </Link>
              );
            })}
            {!loading && needs.items.length === 0 && needs.notices.length === 0 && <p className={NOTE}>Nothing needs your decision.</p>}
            {needs.more > 0 && <Link href="/needs-my-action" onClick={onPick} className={MORE}>{needs.more.toLocaleString('en-US')} more to decide →</Link>}
            {needs.acknowledgements > 0 && <Link href="/needs-my-action?section=ack" onClick={onPick} className={MORE}>{needs.acknowledgements.toLocaleString('en-US')} to acknowledge →</Link>}
            <Link href="/needs-my-action" onClick={onPick} className={MORE}>Open Needs my action →</Link>
            {canAssessments && <Link href="/compliance/assessments/approvals" onClick={onPick} className={MORE}>Assessment approvals →</Link>}
          </div>
        </Disclosure>

        {committeeId != null && (
          <Disclosure label="In this committee" level={3} region={false} count={meetings.status === 'ready' ? choices.length : null} countLabel="meetings" open={isOpen('committee')} onOpenChange={toggle('committee')}>
            {meetings.status === 'failed' && (
              <div role="alert" className={clsx(NOTE, '!text-ds-danger')}>
                Could not load the meetings.
                <button type="button" onClick={meetings.retry} className="ml-[6px] rounded-ds-control px-[6px] py-[2px] font-[600] text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring">Retry</button>
              </div>
            )}
            {meetings.status !== 'ready' && meetings.status !== 'failed' && <p role="status" className={NOTE}>Loading…</p>}
            {meetings.status === 'ready' && choices.length === 0 && <p className={NOTE}>No meetings yet.</p>}
            {(allMeetings ? choices : choices.slice(0, 6)).map((c) => (
              <Link key={c.href} href={c.href} onClick={onPick} title={c.label} aria-current={c.current ? 'page' : undefined} className={clsx(ROW, c.current && LIT)}>
                <span className="min-w-0 truncate">{c.label}</span>
              </Link>
            ))}
            {choices.length > 6 && <button type="button" onClick={() => setAllMeetings((v) => !v)} className={MORE}>{allMeetings ? 'Show fewer' : `Show all ${choices.length}`}</button>}
          </Disclosure>
        )}

        <Disclosure label={section.title} level={3} region={false} open={isOpen('module')} onOpenChange={toggle('module')}>
          <nav aria-label={section.navLabel}>
            <ModuleList items={section.items} firstRowIsEntry={!hasFirstItem} onPick={onPick} />
          </nav>
        </Disclosure>

        <Disclosure label="Pinned" level={3} region={false} count={pins.pins.length} countLabel="pinned" open={isOpen('pinned')} onOpenChange={toggle('pinned')}>
          {pins.current && (
            <button type="button" onClick={togglePin} aria-pressed={pins.currentPinned} className={ROW}>
              {pins.currentPinned ? <PinOff size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ds-fg-muted" /> : <Pin size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ds-fg-muted" />}
              <span className="min-w-0 truncate">{pins.currentPinned ? 'Unpin this page' : 'Pin this page'}</span>
            </button>
          )}
          {pins.pins.length === 0 && <p className={NOTE}>Pin a page to find it here.</p>}
          {pins.pins.map((p) => (
            <div key={p.href} className="flex items-center">
              <Link href={p.href} onClick={onPick} title={p.label} className={clsx(ROW, 'flex-1')}>
                <Pin size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ds-fg-muted" />
                <span className="min-w-0 truncate">{p.label}</span>
              </Link>
              <button type="button" onClick={() => pins.unpin(p.href)} aria-label={`Unpin ${p.label}`} className="mr-[4px] inline-flex h-ds-control w-ds-control shrink-0 items-center justify-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
                <X size={14} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          ))}
        </Disclosure>

        <Disclosure label="Recent" level={3} region={false} count={pins.recent.length} countLabel="recent" open={isOpen('recent')} onOpenChange={toggle('recent')}>
          {pins.recent.length === 0 && <p className={NOTE}>Pages and records you open appear here.</p>}
          {pins.recent.map((r) => (
            <Link key={r.href} href={r.href} onClick={onPick} title={r.sub ? `${r.label} · ${r.sub}` : r.label} className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.label}</span>
                {r.sub && <span className="block truncate text-ds-label text-ds-fg-muted">{r.sub}</span>}
              </span>
            </Link>
          ))}
        </Disclosure>
      </div>
    </SidePanel>
  );
}

