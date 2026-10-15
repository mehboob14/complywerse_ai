'use client';

/**
 * LifecycleHover — wraps a document's stage indicator in the library (Table "Lifecycle" column, Tree status) and, on hover or
 * keyboard focus, shows its life cycle: where it stands, who it is waiting for, how many have acknowledged, what happened last
 * and the key dates. The card is portaled and fixed-positioned (never clipped by the table's scroll), opens after a short pause
 * so moving down a list does not flicker, and closes on leave, Escape, scroll or click. The people and the activity come from
 * the life cycle endpoint when the organisation has it (same cache entry as the document's Approvals & Acknowledgements tab);
 * the dates are the ones the document already carries, so every organisation gets a useful card.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { dateTime, day, eventLabel, LIFECYCLE_KIND_LABEL, type LifecycleReply } from '@/lib/documentLifecycle';
import { type GovDoc, LifecycleDots, ReviewStatus, verLabel } from './lib';

const OPEN_DELAY = 250;     // ms the pointer rests before the card opens
const CLOSE_DELAY = 150;    // ms of grace to move from the indicator onto the card
const CARD_WIDTH = 340;
const ROOM_WANTED = 420;    // px the card likes to have; with less below the indicator it opens above when that side has more
const GAP = 6;
const MARGIN = 8;
const WAITING_SHOWN = 4;
const ACTIVITY_SHOWN = 4;

/** Where the card goes: under the indicator, or above it when there is more room there, and never off screen. The side is
 *  chosen once, when it opens, and the card is allowed to grow (or scroll) towards the room it has, so no measuring is needed. */
interface Placement { left: number; top?: number; bottom?: number; maxHeight: number }
function placeBeside(r: DOMRect): Placement {
  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  return below >= Math.min(above, ROOM_WANTED)
    ? { left, top: r.bottom + GAP, maxHeight: below }
    : { left, bottom: window.innerHeight - r.top + GAP, maxHeight: above };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {children}
    </div>
  );
}

function LifecycleCard({ doc }: { doc: GovDoc }) {
  const { data, isLoading, isError } = useQuery<LifecycleReply>({
    queryKey: ['document-lifecycle', String(doc.id)],
    queryFn: async () => (await apiClient.get(`/governance/documents/${doc.id}/lifecycle`)).data,
    staleTime: 30_000,
    retry: false,
  });
  const full = data && data.enabled ? data : null;
  const waiting = full ? full.approvals.filter((r) => r.status === 'pending') : [];
  const acks = full?.acknowledgements;
  const recent = full ? full.timeline.slice(0, ACTIVITY_SHOWN) : [];
  const dates: [string, string][] = [
    ['Created', day(doc.created_at)],
    ...(doc.approved_at ? [['Approved', day(doc.approved_at)] as [string, string]] : []),
    ...(doc.published_at ? [['Published', day(doc.published_at)] as [string, string]] : []),
    ...(doc.effective_date ? [['Effective', day(doc.effective_date)] as [string, string]] : []),
  ];

  return (
    <div className="space-y-3 text-xs text-slate-700">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{doc.title}</p>
          <span className="shrink-0 text-[11px] text-slate-500">{verLabel(doc.current_version)}</span>
        </div>
        <div className="mt-1.5"><LifecycleDots status={doc.status} /></div>
        <p className="mt-1 text-slate-500">
          Owner {doc.owner_name || 'not assigned'}{doc.author_name && doc.author_name !== doc.owner_name ? ` · prepared by ${doc.author_name}` : ''}
        </p>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the life cycle…</p>
      )}

      {waiting.length > 0 && (
        <Section title="Waiting for">
          <ul className="space-y-1">
            {waiting.slice(0, WAITING_SHOWN).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium text-slate-900">{r.user}</span>
                <span className={`shrink-0 ${r.overdue ? 'text-rose-600' : 'text-slate-500'}`}>
                  {LIFECYCLE_KIND_LABEL[r.kind]} · {r.overdue ? `overdue since ${day(r.due_date)}` : `due ${day(r.due_date)}`}
                </span>
              </li>
            ))}
            {waiting.length > WAITING_SHOWN && <li className="text-slate-500">and {waiting.length - WAITING_SHOWN} more</li>}
          </ul>
        </Section>
      )}

      {acks && acks.total > 0 && (
        <Section title="Acknowledgements">
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-1.5 bg-emerald-500" style={{ width: `${acks.percent}%` }} />
          </div>
          <p className="mt-1">
            {acks.done} of {acks.total} users ({acks.percent}%)
            {acks.overdue > 0 && <span className="text-rose-600"> · {acks.overdue} overdue</span>}
          </p>
        </Section>
      )}

      {full && (
        <Section title="Recent activity">
          {recent.length === 0 ? (
            <p className="text-slate-500">Nothing has happened to this document yet.</p>
          ) : (
            <ol className="space-y-1">
              {recent.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-[76px] shrink-0 text-slate-500">{dateTime(e.at)}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800">{eventLabel(e.kind)}</span>
                    {e.actor && <span className="text-slate-500"> · {e.actor}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      <Section title="Key dates">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {dates.map(([label, value]) => (
            <div key={label} className="flex gap-1.5"><dt className="text-slate-500">{label}</dt><dd>{value}</dd></div>
          ))}
          <div className="col-span-2 flex items-center gap-1.5">
            <dt className="text-slate-500">Next review</dt>
            <dd className="flex items-center gap-2">
              {doc.next_review_date ? <>{day(doc.next_review_date)}<ReviewStatus date={doc.next_review_date} className="!text-xs" /></> : 'Not set'}
            </dd>
          </div>
        </dl>
      </Section>

      {isError && !data && <p className="text-slate-500">The people and the activity could not be loaded just now.</p>}
      <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        {full ? 'Open the document for its full life cycle.' : 'Open the document for its sign-off and review history.'}
      </p>
    </div>
  );
}

export function LifecycleHover({ doc, children, focusable = false }: { doc: GovDoc; children: ReactNode; focusable?: boolean }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [placement, setPlacement] = useState<Placement | null>(null);     // null while the card is closed
  const cardId = useId();

  const hold = useCallback(() => clearTimeout(timer.current), []);
  const closeNow = useCallback(() => { hold(); setPlacement(null); }, [hold]);
  const openSoon = () => {
    hold();
    timer.current = setTimeout(() => { const r = wrapRef.current?.getBoundingClientRect(); if (r) setPlacement(placeBeside(r)); }, OPEN_DELAY);
  };
  const closeSoon = () => { hold(); timer.current = setTimeout(closeNow, CLOSE_DELAY); };
  useEffect(() => hold, [hold]);

  useEffect(() => {
    if (!placement) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); };
    const onScroll = (e: Event) => { if (!cardRef.current?.contains(e.target as Node)) closeNow(); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeNow);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeNow);
    };
  }, [placement, closeNow]);

  return (
    <>
      <span
        ref={wrapRef}
        className="inline-flex"
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={placement ? cardId : undefined}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onFocus={focusable ? openSoon : undefined}
        onBlur={focusable ? closeSoon : undefined}
        onClick={closeNow}
      >
        {children}
      </span>
      {placement && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={cardRef}
            id={cardId}
            role="tooltip"
            onMouseEnter={hold}
            onMouseLeave={closeSoon}
            style={{ left: placement.left, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight }}
            className="fixed z-[60] w-[340px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-left shadow-elevated"
          >
            <LifecycleCard doc={doc} />
          </div>,
          document.body,
        )}
    </>
  );
}

export default LifecycleHover;
