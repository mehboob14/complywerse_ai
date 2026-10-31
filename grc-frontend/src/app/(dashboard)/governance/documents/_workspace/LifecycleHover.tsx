'use client';

/**
 * LifecycleHover — wraps a document's stage indicator in the library (the Lifecycle column's status pill, a card's status line) and, on hover or keyboard focus, shows its
 * life cycle: where it stands, who it is waiting for, how many have acknowledged, what happened last and the key dates. The card is portaled and fixed-positioned (never
 * clipped by the table's scroll), opens after a short pause so moving down a list does not flicker, and closes on leave, Escape, scroll or click. The people and the activity
 * come from the life cycle endpoint when the organisation has it (same cache entry as the document's Approvals & Acknowledgements tab); the dates are the ones the document
 * already carries, so every organisation gets a useful card. Written on the design-system tokens, 12px at the least, dates through lib/format.ts.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { LIFECYCLE_KIND_LABEL, eventLabel, type LifecycleReply } from '@/lib/documentLifecycle';
import { formatDate, formatDateTime } from '@/lib/format';
import { type GovDoc, LifecycleDots, verLabel } from './lib';
import { reviewState } from './libraryModel';

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
      <p className="mb-1 text-ds-label font-[600] uppercase tracking-wide text-ds-fg-muted">{title}</p>
      {children}
    </div>
  );
}

const REVIEW_TEXT = { overdue: 'text-ds-danger', due_soon: 'text-ds-warning', ok: 'text-ds-success', unscheduled: 'text-ds-fg-muted' } as const;

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
    ['Created', formatDate(doc.created_at)],
    ...(doc.approved_at ? [['Approved', formatDate(doc.approved_at)] as [string, string]] : []),
    ...(doc.published_at ? [['Published', formatDate(doc.published_at)] as [string, string]] : []),
    ...(doc.effective_date ? [['Effective', formatDate(doc.effective_date, { calendar: true })] as [string, string]] : []),
  ];
  const review = reviewState(doc);

  return (
    <div className="space-y-[12px] text-ds-label text-ds-fg-body">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg">{doc.title}</p>
          <span className="shrink-0 text-ds-label text-ds-fg-muted">{verLabel(doc.current_version)}</span>
        </div>
        <div className="mt-1.5"><LifecycleDots status={doc.status} /></div>
        <p className="mt-1 text-ds-fg-muted">
          Owner {doc.owner_name || 'not assigned'}{doc.author_name && doc.author_name !== doc.owner_name ? ` · prepared by ${doc.author_name}` : ''}
        </p>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-ds-fg-muted"><Loader2 className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" aria-hidden /> Loading…</p>
      )}

      {waiting.length > 0 && (
        <Section title="Waiting for">
          <ul className="space-y-1">
            {waiting.slice(0, WAITING_SHOWN).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-[12px]">
                <span className="truncate font-[600] text-ds-fg">{r.user}</span>
                <span className={`shrink-0 ${r.overdue ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>
                  {LIFECYCLE_KIND_LABEL[r.kind]} · {r.overdue ? `overdue since ${formatDate(r.due_date)}` : `due ${formatDate(r.due_date)}`}
                </span>
              </li>
            ))}
            {waiting.length > WAITING_SHOWN && <li className="text-ds-fg-muted">and {waiting.length - WAITING_SHOWN} more</li>}
          </ul>
        </Section>
      )}

      {acks && acks.total > 0 && (
        <Section title="Acknowledgements">
          <div className="h-[6px] w-full overflow-hidden rounded-full bg-ds-border">
            <div className="h-[6px] bg-ds-success" style={{ width: `${acks.percent}%` }} />
          </div>
          <p className="mt-1">
            {acks.done} of {acks.total} users ({acks.percent}%)
            {acks.overdue > 0 && <span className="text-ds-danger"> · {acks.overdue} overdue</span>}
          </p>
        </Section>
      )}

      {full && (
        <Section title="Recent activity">
          {recent.length === 0 ? (
            <p className="text-ds-fg-muted">No activity yet</p>
          ) : (
            <ol className="space-y-1">
              {recent.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-[8rem] shrink-0 text-ds-fg-muted">{formatDateTime(e.at)}</span>
                  <span className="min-w-0">
                    <span className="font-[600] text-ds-fg">{eventLabel(e.kind)}</span>
                    {e.actor && <span className="text-ds-fg-muted"> · {e.actor}</span>}
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
            <div key={label} className="flex gap-1.5"><dt className="text-ds-fg-muted">{label}</dt><dd>{value}</dd></div>
          ))}
          <div className="col-span-2 flex items-center gap-1.5">
            <dt className="text-ds-fg-muted">Next review</dt>
            <dd className="flex items-center gap-2">
              {doc.next_review_date ? (
                <>
                  {formatDate(doc.next_review_date, { calendar: true })}
                  {review.label && <span className={`font-[600] ${REVIEW_TEXT[review.bucket ?? 'unscheduled']}`}>{review.label}</span>}
                </>
              ) : 'Not set'}
            </dd>
          </div>
        </dl>
      </Section>

      {isError && !data && <p className="text-ds-fg-muted">Could not load the people and activity.</p>}
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
        className="inline-flex max-w-full rounded-ds-control focus-visible:outline-none focus-visible:shadow-ds-ring"
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
            className="fixed z-[60] w-[340px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-3 text-left shadow-ds-pop"
          >
            <LifecycleCard doc={doc} />
          </div>,
          document.body,
        )}
    </>
  );
}

export default LifecycleHover;
