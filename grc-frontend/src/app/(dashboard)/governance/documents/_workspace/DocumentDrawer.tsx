'use client';

/**
 * DocumentDrawer — the "peek" of the Governance → Documents library: the document's key facts, workflow, versions and framework mappings, with a button to open the full
 * page. It opens when a row (or a card) is clicked; clicking another row swaps the content and the tab chosen stays.
 *
 * It has two shapes, decided by the window (the page passes `mode`):
 *   side   from 1024px: a panel BESIDE the register (in the page's flow, sticky under the app header), not over it. The register narrows to make room and keeps the columns the
 *          person is reading (libraryColumns.PEEK_FROM); nothing is hidden behind the panel. It does not trap focus (the page stays usable): focus goes to its Close button
 *          when it opens, Escape closes it from inside it or from the row it came from, and focus goes back to that row.
 *   sheet  below 1024px: a full-screen sheet, modal: focus goes in and is kept inside (Tab wraps), the page behind does not scroll, Escape closes it, and focus goes back to the
 *          row or card that opened it (useDialogFocus, the platform's overlay focus). Its Close button is the first thing focused.
 * What it says (the facts, the fallback timeline, the tabs, the attestation line) is decided in drawerLogic.ts, which node --test checks. Written on the design-system kit:
 * kit Buttons, Menu and Tabs, StatusPill, --ds tokens, 12px at the least, dates through lib/format.ts.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArchiveRestore, Archive, ArrowUpRight, ChevronDown, ChevronUp, Download, Loader2, Pencil, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Avatar, Button, IconButton, Menu, StatusPill, TabPanel, Tabs, type MenuItem } from '@/components/ui/ds';
import { LIFECYCLE_KIND_LABEL, eventLabel, type LifecycleReply, type LifecycleRow } from '@/lib/documentLifecycle';
import { formatDate, formatDateTime } from '@/lib/format';
import { documentStatus, statusPill } from '@/lib/status';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { lockBodyScroll } from '@/components/ui/scrollLock';
import { AttestationRing, ReviewDate, attestationColour, shortDate } from './atoms';
import {
  attestationSummary, inForceText, inWorkflow, keyInfoRows, mappedFrameworkIds, mappedLine, tabsFor, timelineFromDates, versionText,
  type InfoRow, type TabId,
} from './drawerLogic';
import { FrameworkList } from './FrameworkList';
import { type GovDoc, LifecycleDots } from './lib';
import { type Lookups, typeLabel } from './libraryModel';
import { Versions } from './Versions';

export interface DocumentDrawerProps {
  /** null = closed (nothing is drawn) */
  doc: GovDoc | null;
  /** departments, frameworks, coverage (document id -> %), the signed-in person */
  lookups: Lookups;
  /** attestation "4 of 5" (may be empty) */
  counts: Record<number, { done: number; total: number }>;
  /** the frameworks the library is already filtered by */
  activeFrameworks: string[];
  /** `side`: beside the register (from 1024px, not modal); `sheet`: a full-screen modal sheet below that */
  mode: 'side' | 'sheet';
  onClose: () => void;
  /** the full document page */
  onOpenDoc: (id: number) => void;
  /** a framework row was clicked: the library filters by it (the panel stays open) */
  onPickFramework: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  canEdit: boolean;
  onDownload: (doc: GovDoc) => void;
  onArchive: (doc: GovDoc) => void;
  canArchive: boolean;
  onRestore?: (doc: GovDoc) => void;
  canRestore: boolean;
  /** previous / next row of the table (the caller moves the selection) */
  onStep?: (dir: -1 | 1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

const WAITING_SHOWN = 6;
const ACTIVITY_SHOWN = 6;

const MUTED = 'text-ds-label text-ds-fg-muted';
const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

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

export function Overview({ doc, lookups, counts }: { doc: GovDoc; lookups: Lookups; counts: DocumentDrawerProps['counts'] }) {
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
        <Button href="/governance/documents/attestation" variant="link" size="sm" className="mt-2">Manage attestation</Button>
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

// ─── The panel ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Escape closes the panel unless something else owns it: an open menu or dialog, or a search box with text to clear; and only when
 *  focus is in the panel, on the page itself or on the table's row (never in a field elsewhere). */
function escapeCloses(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return false;
  const over = document.querySelector('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]');
  if (over && !panel?.contains(over)) return false;
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'search' && t.value) return false;
  const focus = document.activeElement;
  return !focus || focus === document.body || !!panel?.contains(focus) || !!focus.closest('[data-doc-row], [data-folder-row]');
}

/** The row or card of a document that is on screen (the table and the cards are both drawn, one hidden by the window's width). */
function visibleRowOf(id: number): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-doc-row="${id}"]`)).find((el) => el.getClientRects().length > 0) ?? null;
}

function DrawerPanel({
  doc, lookups, counts, activeFrameworks, mode, onClose, onOpenDoc, onPickFramework, onEdit, canEdit, onDownload, onArchive, canArchive,
  onRestore, canRestore, onStep, hasPrev, hasNext,
}: DocumentDrawerProps & { doc: GovDoc }) {
  const sheet = mode === 'sheet';
  const uid = useId();
  const [tab, setTab] = useState<TabId>('overview');         // kept while the panel shows another document; gone when it closes
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ id: doc.id, onClose });
  latest.current = { id: doc.id, onClose };

  // the sheet is modal: focus is kept inside it and goes back to what opened it, and the page behind does not scroll (the platform's overlay focus and scroll lock)
  useDialogFocus(sheet, panelRef);
  useEffect(() => (sheet ? lockBodyScroll() : undefined), [sheet]);

  // opening: focus the close button, the sheet slides in (unless motion is reduced); closing: the side panel puts focus back on the row it came from
  useEffect(() => {
    const panel = panelRef.current;
    closeRef.current?.focus({ preventScroll: true });
    if (sheet && panel && typeof panel.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 150, easing: 'ease-out' });
    }
    // capture phase: this looks at the page before a menu's own Escape handler closes it
    const onKey = (e: KeyboardEvent) => { if (escapeCloses(e, panelRef.current)) latest.current.onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (sheet) return;                                      // the sheet's focus goes back through useDialogFocus
      const focus = document.activeElement;
      if (focus && focus !== document.body) return;           // focus went somewhere on purpose
      const row = visibleRowOf(latest.current.id);
      if (!row) return;
      if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
      row.focus({ preventScroll: true });
    };
  }, [sheet]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [doc.id, tab]);

  const tabs = tabsFor(doc);
  const menu: MenuItem[] = [
    { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => onArchive(doc), danger: true, hidden: !canArchive },
    { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => onRestore?.(doc), hidden: !(onRestore && canRestore) },
  ];
  const inForce = inForceText(doc);
  const titleId = `${uid}-title`;

  return (
    <div
      ref={panelRef}
      role={sheet ? 'dialog' : 'complementary'}
      aria-modal={sheet ? true : undefined}
      aria-labelledby={sheet ? titleId : undefined}
      aria-label={sheet ? undefined : 'Document details'}
      tabIndex={sheet ? -1 : undefined}
      data-doc-drawer=""
      className={sheet
        ? 'fixed inset-0 z-[60] flex flex-col bg-ds-surface'
        : 'sticky top-[64px] flex max-h-[calc(100vh-80px)] w-[400px] shrink-0 flex-col self-start overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface shadow-ds-pop'}
    >
      <div className="shrink-0 border-b border-ds-border px-[16px] pb-[12px] pt-[12px]">
        <div className="flex items-start gap-[12px]">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} dir="auto" title={doc.title} className="line-clamp-3 break-words !text-ds-section !text-ds-fg">{doc.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-ds-label text-ds-fg-muted">
              {doc.document_code && <><span className="font-mono text-ds-fg-body">{doc.document_code}</span><span aria-hidden>·</span></>}
              <span>{typeLabel(doc.doc_type)}</span>
              {doc.current_version && <><span aria-hidden>·</span><span>{versionText(doc.current_version)}</span></>}
              {inForce && <><span aria-hidden>·</span><span>{inForce}</span></>}
            </p>
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0 items-center gap-0.5">
            {onStep && (
              <>
                <IconButton label="Previous document" aria-disabled={hasPrev === false || undefined} onClick={() => { if (hasPrev !== false) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
                <IconButton label="Next document" aria-disabled={hasNext === false || undefined} onClick={() => { if (hasNext !== false) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
              </>
            )}
            <Menu label="More actions" iconOnly items={menu} />
            <IconButton label="Close details" ref={closeRef} data-autofocus="" onClick={onClose}><X aria-hidden /></IconButton>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill {...statusPill(documentStatus, doc.status)} />
          {inWorkflow(doc.status) && <span aria-hidden><LifecycleDots status={doc.status} showLabel={false} /></span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => onOpenDoc(doc.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open document</Button>
          <Button onClick={() => onDownload(doc)} leftIcon={<Download aria-hidden />}>Download</Button>
          {canEdit && <Button onClick={() => onEdit(doc)} title="Edit the document's details" leftIcon={<Pencil aria-hidden />}>Edit</Button>}
        </div>
      </div>

      <Tabs tabs={tabs.map((t) => ({ key: t.id, label: t.label }))} value={tab} onChange={(key) => setTab(key as TabId)} ariaLabel="Document sections" className="flex min-h-0 flex-1 flex-col">
        {/* the strip above does not scroll; this body does. Focusable (the kit's tab panel), so the keyboard can scroll it */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-6 pt-4">
          <TabPanel tabKey={tab}>
            {/* keyed by the document: a search box, a "Show more" or a loading state never carries over to the next one */}
            <div key={doc.id}>
              {tab === 'overview' && <Overview doc={doc} lookups={lookups} counts={counts} />}
              {tab === 'workflow' && <Workflow doc={doc} onOpenDoc={onOpenDoc} />}
              {tab === 'versions' && (
                <div>
                  <Versions doc={doc} />
                </div>
              )}
              {tab === 'frameworks' && <Frameworks doc={doc} lookups={lookups} active={activeFrameworks} onPick={onPickFramework} />}
            </div>
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
}

export function DocumentDrawer(props: DocumentDrawerProps): JSX.Element | null {
  const { doc } = props;
  if (!doc || typeof document === 'undefined') return null;
  const panel = <DrawerPanel {...props} doc={doc} />;
  return props.mode === 'sheet' ? createPortal(panel, document.body) : panel;
}

export default DocumentDrawer;
