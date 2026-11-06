'use client';

/**
 * The sections of the library's details panel (DocumentDetail.tsx puts them in one scrolling body): Overview (the facts, the attestation line, the description, the tags), Workflow
 * (who the document waits for, the acknowledgements, the recent activity) and Frameworks (what it maps to): the facts, the words and the requests the library has always shown.
 * What they say is decided in drawerLogic.ts, which node --test checks. Written on the design-system kit: kit Buttons, --ds tokens, 12px at the least, dates through lib/format.ts.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Avatar, Button } from '@/components/ui/ds';
import { withFrom } from '@/components/shell/withFrom';
import { LIFECYCLE_KIND_LABEL, eventLabel, type LifecycleReply, type LifecycleRow } from '@/lib/documentLifecycle';
import { formatDate, formatDateTime } from '@/lib/format';
import { AttestationRing, ReviewDate, attestationColour, shortDate } from './atoms';
import { attestationSummary, keyInfoRows, mappedFrameworkIds, mappedLine, timelineFromDates, type InfoRow } from './drawerLogic';
import { FrameworkList } from './FrameworkList';
import type { GovDoc } from './lib';
import type { Lookups } from './libraryModel';
import { useHere } from './useHere';

const WAITING_SHOWN = 6;
const ACTIVITY_SHOWN = 6;

const MUTED = 'text-ds-label text-ds-fg-muted';

// ─── Small pieces ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Section({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-ds-border pt-4'}>
      <h3 className="!text-ds-body font-[600] !text-ds-fg">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <li key={`${t}-${i}`} className="rounded-ds-control border border-ds-border-strong bg-ds-surface-hover px-2 py-[2px] text-ds-label text-ds-fg-body">{t}</li>
      ))}
    </ul>
  );
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-ds-label text-ds-fg-muted">
      <Loader2 className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden /> {children}
    </p>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function InfoItem({ row, doc }: { row: InfoRow; doc: GovDoc }) {
  const value = <span className={row.empty ? 'text-ds-fg-muted' : ''}>{row.value}</span>;
  return (
    <div className={`min-w-0 ${row.wide ? 'col-span-2' : ''}`}>
      <dt className="text-ds-label text-ds-fg-muted">{row.label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-ds-body text-ds-fg">
        {row.kind === 'review' ? <ReviewDate doc={doc} />
          : row.kind === 'person' ? (
            <span className="inline-flex items-center gap-2">
              {!row.empty && <Avatar name={row.value} size={24} decorative />}
              {value}
            </span>
          )
          : value}
        {row.note && <span className="block text-ds-label text-ds-fg-muted">{row.note}</span>}
      </dd>
    </div>
  );
}

/** The description, five lines of it and "Show more" only when there is more (measured: the lines depend on the width). */
function Description({ text }: { text: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = (text ?? '').trim();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [body, open]);
  if (!body) return <p className="text-ds-body text-ds-fg-muted">No description.</p>;
  return (
    <div>
      <p ref={ref} dir="auto" className={`whitespace-pre-line break-words text-ds-body text-ds-fg-body ${open ? '' : 'line-clamp-5'}`}>{body}</p>
      {(long || open) && (
        <Button variant="link" size="sm" className="mt-1" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</Button>
      )}
    </div>
  );
}

export function Overview({ doc, lookups, counts }: { doc: GovDoc; lookups: Lookups; counts: Record<number, { done: number; total: number }> }) {
  const here = useHere();
  const att = attestationSummary(lookups.coverage[doc.id], counts[doc.id]);
  const tags = doc.tags ?? [];
  const scope = doc.regulatory_scope ?? [];
  return (
    <div>
      <Section title="Details" first>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5">
          {keyInfoRows(doc, lookups, shortDate).map((row) => <InfoItem key={row.key} row={row} doc={doc} />)}
        </dl>
      </Section>
      <Section title="Attestation">
        <div className="flex items-center gap-[12px]">
          {att.requested && <AttestationRing pct={att.pct} done={att.done ?? undefined} total={att.total ?? undefined} size={44} />}
          <div className="min-w-0">
            <p className="text-ds-body font-[600] text-ds-fg">{att.headline}</p>
            {att.detail && <p className={MUTED}>{att.detail}</p>}
          </div>
        </div>
        <Button href={withFrom('/governance/documents/attestation', here)} variant="link" size="sm" className="mt-2">Manage attestation</Button>
      </Section>
      <Section title="Description"><Description text={doc.description} /></Section>
      {tags.length > 0 && <Section title="Tags"><Chips items={tags} /></Section>}
      {scope.length > 0 && <Section title="Regulatory scope"><Chips items={scope} /></Section>}
    </div>
  );
}

// ─── Workflow ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const dueWords = (r: LifecycleRow): string => (!r.due_date ? 'no due date' : r.overdue ? `overdue since ${formatDate(r.due_date)}` : `due ${formatDate(r.due_date)}`);

/** What the document itself says when the workflow history cannot be read (the feature is off for the organisation, or the call failed). */
function OwnDates({ doc, failed }: { doc: GovDoc; failed: boolean }) {
  const events = timelineFromDates(doc, shortDate);
  return (
    <div>
      {failed && <p role="status" className={`mb-3 ${MUTED}`}>Could not read the history.</p>}
      <ol className="ml-1.5 border-l border-ds-border-strong">
        {events.map((e) => (
          <li key={e.key} className="relative pb-3 pl-4">
            <span aria-hidden className="absolute -left-[4.5px] top-1.5 h-[8px] w-[8px] rounded-full bg-ds-primary" />
            <p className="text-ds-body font-[600] text-ds-fg">{e.label}</p>
            <p className={MUTED}>{e.text}</p>
          </li>
        ))}
      </ol>
      <p className={MUTED}>More in the Change log.</p>
    </div>
  );
}

// fetched only while this tab is open (it is mounted only then); the same cache entry as the life-cycle hover card
export function Workflow({ doc, onOpenDoc }: { doc: GovDoc; onOpenDoc: (id: number) => void }) {
  const q = useQuery<LifecycleReply>({
    queryKey: ['document-lifecycle', String(doc.id)],
    queryFn: async () => (await apiClient.get(`/governance/documents/${doc.id}/lifecycle`)).data,
    staleTime: 30_000,
    retry: false,
  });
  const full = q.data && q.data.enabled ? q.data : null;
  const waiting = full ? full.approvals.filter((r) => r.status === 'pending') : [];
  const acks = full?.acknowledgements;
  const recent = full ? full.timeline.slice(0, ACTIVITY_SHOWN) : [];

  return (
    <div>
      {q.isLoading && <Loading>Reading the workflow…</Loading>}
      {!q.isLoading && !full && <OwnDates doc={doc} failed={q.isError} />}
      {full && (
        <>
          <Section title="Waiting for" first>
            {waiting.length === 0 ? <p className={MUTED}>Nobody waiting</p> : (
              <ul className="divide-y divide-ds-border">
                {waiting.slice(0, WAITING_SHOWN).map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-[12px] py-1.5">
                    <span className="min-w-0 truncate text-ds-body font-[600] text-ds-fg">{r.user || 'Unknown person'}</span>
                    <span className={`shrink-0 text-right text-ds-label ${r.overdue ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>
                      {LIFECYCLE_KIND_LABEL[r.kind]} · {dueWords(r)}
                    </span>
                  </li>
                ))}
                {waiting.length > WAITING_SHOWN && <li className={`py-1.5 ${MUTED}`}>and {waiting.length - WAITING_SHOWN} more</li>}
              </ul>
            )}
          </Section>
          <Section title="Acknowledgements">
            {acks && acks.total > 0 ? (
              <>
                <div role="progressbar" aria-label="Acknowledged" aria-valuemin={0} aria-valuemax={100} aria-valuenow={acks.percent} className="h-[8px] w-full overflow-hidden rounded-full bg-ds-border">
                  <div className="h-[8px] rounded-full" style={{ width: `${acks.percent}%`, backgroundColor: attestationColour(acks.percent) }} />
                </div>
                <p className="mt-1.5 text-ds-body text-ds-fg-body">
                  {acks.done} of {acks.total} users ({acks.percent}%)
                  {acks.overdue > 0 && <span className="font-[600] text-ds-danger"> · {acks.overdue} overdue</span>}
                </p>
              </>
            ) : <p className={MUTED}>None requested</p>}
          </Section>
          <Section title="Recent activity">
            {recent.length === 0 ? <p className={MUTED}>No activity yet</p> : (
              <ol className="space-y-2">
                {recent.map((e, i) => (
                  <li key={i} className="flex gap-[12px]">
                    <span className="w-[8.5rem] shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted">{formatDateTime(e.at)}</span>
                    <span className="min-w-0 text-ds-body text-ds-fg">
                      <span className="font-[600]">{eventLabel(e.kind)}</span>
                      {e.actor && <span className="text-ds-fg-muted"> · {e.actor}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
      <div className="mt-5 border-t border-ds-border pt-3">
        <Button variant="link" size="sm" onClick={() => onOpenDoc(doc.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open workflow</Button>
      </div>
    </div>
  );
}

// ─── Frameworks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Frameworks({ doc, lookups, active, onPick }: { doc: GovDoc; lookups: Lookups; active: string[]; onPick: (id: number) => void }) {
  const ids = mappedFrameworkIds(doc);
  if (ids.length === 0) {
    return (
      <div className="rounded-ds-card border border-dashed border-ds-border-strong px-[16px] py-[32px] text-center">
        <p className="text-ds-body font-[600] text-ds-fg">No frameworks</p>
        <p className={`mt-1 ${MUTED}`}>Map them from Edit.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-ds-body font-[600] text-ds-fg">{mappedLine(ids.length)}</p>
      <FrameworkList ids={ids} info={lookups.frameworks} active={active} onPick={onPick} maxHeight={420} />
    </div>
  );
}
