'use client';

// The Tracker layout of the Documents library ("Plain English", design E: a parcel-tracking card for each document). A card says, in this order: the title (the whole card opens the
// document: the title is a real link stretched over it, so a keyboard has one stop per card and a modified click opens a new tab, as a row does), a plain label (Live, Needs a fresh look,
// Out of date, Not live yet, On its way ...), who looks after it and where, the six steps it goes through with the one it is at marked, ONE line for what is happening now and ONE for what
// happens next, and the acknowledgements as a meter when people were asked to confirm they read it. The rules are libraryTracker.ts (tested): the steps, the label, the lines (a name only
// where the inbox or the row holds it), the order (what needs attention first: yours, expired, late for a check-up, ...). The steps are never colour alone: each has a mark (a tick, a ring,
// a warning, an empty circle) and a word for a screen reader. The cards are drawn 12 at a time ("Show more"), never all of a large library. The room decides the layout, not the window: the
// view measures its own box, and a narrow one says "Step 2 of 6: Being checked" instead of the six names.
//   <TrackerView docs={filteredDocs} lookups={lookups} now={now} people={peopleOf(inbox)} activeId={openId} onOpen={(d) => setOpenId(d.id)} hrefOf={docHref} />
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { AlertTriangle, Check } from 'lucide-react';
import { Button, ProgressBar, StatusPill } from '@/components/ui/ds';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { formatCount } from '@/lib/format';
import type { GovDoc } from './lib';
import { BADGE_TERM } from './glossary';
import { HowItWorksButton } from './HowItWorks';
import { typeLabel, type Lookups } from './libraryModel';
import { OwnerAvatar } from './libraryRows';
import { CARDS_AT_A_TIME, cardsShown, trackOf, trackerOrder, type DocPeople, type Step, type Track } from './libraryTracker';
import { PlainTerm } from './PlainTerm';

/** Below this width of the view's own box a card says where it is in one line and a pair of Now / Next stacks. */
const NARROW_BELOW = 600;

const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// ─── The six steps ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Pin({ step, problemTone }: { step: Step; problemTone: 'warning' | 'danger' }) {
  const box = 'grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border-2';
  if (step.state === 'done') return <span className={clsx(box, 'border-ds-success bg-ds-success text-ds-on-primary')}><Check className="h-[12px] w-[12px]" strokeWidth={3} /></span>;
  if (step.state === 'here' && step.problem) {
    return <span className={clsx(box, problemTone === 'danger' ? 'border-ds-danger bg-ds-danger-soft text-ds-danger' : 'border-ds-warning bg-ds-warning-soft text-ds-warning')}><AlertTriangle className="h-[12px] w-[12px]" strokeWidth={2.5} /></span>;
  }
  if (step.state === 'here') return <span className={clsx(box, 'border-ds-primary bg-ds-surface')}><span className="h-[8px] w-[8px] rounded-full bg-ds-primary" /></span>;
  if (step.state === 'off') return <span className={clsx(box, 'border-ds-border bg-ds-surface-subtle')} />;
  return <span className={clsx(box, 'border-ds-border-control bg-ds-surface')} />;
}

/** The six steps as a list: a rail through the marks, the name under each. Narrow, the names are for a screen reader only and one line says where the document is. */
function Stepper({ track, narrow }: { track: Track; narrow: boolean }) {
  const { steps } = track;
  const problemTone = track.badge.tone === 'danger' ? 'danger' : 'warning';
  const last = steps.length - 1;
  return (
    <div>
      <ol aria-label="Steps" className="m-0 grid list-none grid-cols-6 p-0">
        {steps.map((s, i) => {
          const reached = s.state === 'done' || s.state === 'here';
          const caption = s.state === 'here' ? (s.problem ? s.word : s.stage.what) : s.word === 'Not asked' ? s.word : '';
          return (
            <li key={s.stage.id} aria-current={s.state === 'here' ? 'step' : undefined} className="min-w-0">
              <div aria-hidden className="flex items-center">
                <span className={clsx('h-[2px] flex-1', i === 0 ? 'bg-transparent' : reached ? 'bg-ds-success' : 'bg-ds-border')} />
                <Pin step={s} problemTone={problemTone} />
                <span className={clsx('h-[2px] flex-1', i === last ? 'bg-transparent' : s.state === 'done' ? 'bg-ds-success' : 'bg-ds-border')} />
              </div>
              <span className={narrow ? 'sr-only' : clsx('mt-[4px] block px-[2px] text-center text-ds-label [overflow-wrap:anywhere]', s.state === 'here' ? 'font-[600] text-ds-fg' : s.state === 'done' ? 'text-ds-fg-body' : 'text-ds-fg-muted')}>
                {s.stage.name}
                <span className="sr-only">{`: ${s.word}`}</span>
              </span>
              {!narrow && caption && <span aria-hidden className={clsx('block px-[2px] text-center text-ds-label [overflow-wrap:anywhere]', s.problem ? (problemTone === 'danger' ? 'font-[600] text-ds-danger' : 'font-[600] text-ds-warning') : 'text-ds-fg-muted')}>{caption}</span>}
            </li>
          );
        })}
      </ol>
      {narrow && <p aria-hidden className="m-0 mt-[6px] text-ds-label font-[500] text-ds-fg-body">{track.where}</p>}
    </div>
  );
}

// ─── One card ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ackTone = (pct: number) => (pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger');

interface CardEnv {
  lookups: Lookups;
  narrow: boolean;
  activeId: number | null;
  onOpen: (doc: GovDoc) => void;
  hrefOf: (id: number) => string;
}

function TrackCard({ doc, track, env }: { doc: GovDoc; track: Track; env: CardEnv }) {
  const dept = doc.department_id != null ? env.lookups.departments[String(doc.department_id)] : '';
  const cycle = doc.review_cycle_months && doc.review_cycle_months > 0 ? `Checked every ${doc.review_cycle_months} ${doc.review_cycle_months === 1 ? 'month' : 'months'}` : '';
  const facts = [dept, typeLabel(doc.doc_type), cycle].filter(Boolean).join(' · ');
  const active = env.activeId === doc.id;
  const term = BADGE_TERM[track.badge.word];
  const ack = track.ack;
  return (
    <li data-record-row={doc.id} className="list-none">
      <article
        aria-current={active ? 'true' : undefined}
        className={clsx('relative min-w-0 rounded-ds-card border p-[12px] hover:bg-ds-surface-hover', active ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface')}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
          <div className="min-w-0 flex-1 basis-[14rem]">
            <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">
              <Link
                href={env.hrefOf(doc.id)}
                prefetch={false}
                title={doc.title}
                dir="auto"
                onClick={(e) => { if (plainClick(e)) { e.preventDefault(); env.onOpen(doc); } }}
                className="line-clamp-2 rounded-ds-control [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-ds-card hover:underline focus-visible:underline focus-visible:outline-none focus-visible:after:shadow-ds-ring"
              >
                {doc.title}
              </Link>
            </h3>
            <div className="mt-[4px] flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[2px] text-ds-label text-ds-fg-muted">
              <span className="relative z-[1] min-w-0"><OwnerAvatar doc={doc} withName /></span>
              {facts && <span className="min-w-0 break-words">{facts}</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
            {track.you && <StatusPill tone={track.you.word === 'Needs you' ? 'pending' : 'danger'} label={track.you.word} />}
            <StatusPill tone={track.badge.tone} label={track.badge.word} />
            {term && <span className="relative z-[1]"><PlainTerm term={term} align="end" /></span>}
          </div>
        </div>

        <div className="mt-[12px]"><Stepper track={track} narrow={env.narrow} /></div>

        <div className={clsx('mt-[12px] grid gap-x-[16px] gap-y-[8px]', env.narrow ? 'grid-cols-1' : 'grid-cols-2')}>
          <div className="min-w-0">
            <span className="block text-ds-label font-[600] text-ds-fg-muted">Now</span>
            <p className="m-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{track.now}</p>
          </div>
          <div className="min-w-0">
            <span className="block text-ds-label font-[600] text-ds-fg-muted">Next</span>
            <p className="m-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{track.next}</p>
          </div>
        </div>

        {ack && doc.status === 'published' && (
          <div className="mt-[10px] flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
            <span className="relative z-[1] inline-flex items-center text-ds-label text-ds-fg-muted">
              <PlainTerm term="attestation">Acknowledged</PlainTerm>
            </span>
            <ProgressBar
              value={ack.pct}
              label={`${doc.title}: acknowledged`}
              valueText={ack.done != null && ack.total != null ? `${formatCount(ack.done)} of ${formatCount(ack.total)}` : `${ack.pct}%`}
              tone={ackTone(ack.pct)}
              className="min-w-[160px] max-w-[320px] flex-1"
            />
          </div>
        )}
      </article>
    </li>
  );
}

// ─── The view ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrackerViewProps {
  /** the documents that match, in the order the person chose: the cards keep it among documents of the same standing */
  docs: readonly GovDoc[];
  lookups: Lookups;
  /** the instant every rule is read at */
  now: Date;
  /** what the inbox says about each document (libraryTracker.peopleOf); without it no card names a person it does not know */
  people?: ReadonlyMap<number, DocPeople>;
  activeId?: number | null;
  /** the card was pressed: the same as a row's title (the details open over the list) */
  onOpen: (doc: GovDoc) => void;
  /** where a document's page is (a modified click opens it in a new tab) */
  hrefOf?: (id: number) => string;
  label?: string;
}

const pageOf = (id: number) => `/governance/documents/${id}`;

export function TrackerView({ docs, lookups, now, people, activeId = null, onOpen, hrefOf = pageOf, label = 'Documents by step' }: TrackerViewProps) {
  const box = useRef<HTMLElement>(null);
  const width = useContainerWidth(box);
  const narrow = width != null && width < NARROW_BELOW;
  const [shown, setShown] = useState(CARDS_AT_A_TIME);
  const ordered = useMemo(() => trackerOrder(docs, { lookups, now, people }), [docs, lookups, now, people]);
  const { count, more } = cardsShown(shown, ordered.length);
  const env: CardEnv = { lookups, narrow, activeId, onOpen, hrefOf };

  return (
    <section ref={box} aria-label={label} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] px-[12px] pt-[8px]">
        <span role="status" className="text-ds-label text-ds-fg-muted">{count < ordered.length ? `Showing ${formatCount(count)} of ${formatCount(ordered.length)}` : `${formatCount(ordered.length)} ${ordered.length === 1 ? 'document' : 'documents'}`}</span>
        <HowItWorksButton />
      </div>
      <ol className="m-0 flex list-none flex-col gap-[10px] p-[10px]">
        {ordered.slice(0, count).map((doc) => <TrackCard key={doc.id} doc={doc} track={trackOf(doc, { lookups, now, people })} env={env} />)}
      </ol>
      {more > 0 && (
        <div className="flex justify-center px-[10px] pb-[12px]">
          <Button onClick={() => setShown(count + CARDS_AT_A_TIME)}>{`Show ${formatCount(more)} more`}</Button>
        </div>
      )}
    </section>
  );
}
