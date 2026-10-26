'use client';

/**
 * DocumentDrawer — the "peek" of the Governance → Documents library: a panel docked to the right, just under the app header, that
 * opens when a table row is clicked. It shows the document's key facts, workflow, versions and framework mappings, with a button to
 * open the full page. It does not hide the table (no scrim): clicking another row swaps the content, and the tab chosen stays.
 * Portaled to <body> like the library's other overlays, so the governance-light rules that rewrite button sizes and spacing cannot
 * reach it; every size and colour is explicit (and arbitrary hex, as the platform CSS repaints slate/white). What it says (the facts,
 * the fallback timeline, the tabs, the attestation line) is decided in drawerLogic.ts, which node --test checks.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUpRight, ChevronDown, ChevronUp, Download, Loader2, Pencil, X } from 'lucide-react';
import apiClient from '@/lib/api';
import { dateTime, day, eventLabel, LIFECYCLE_KIND_LABEL, type LifecycleReply, type LifecycleRow } from '@/lib/documentLifecycle';
import { AttestationRing, ReviewDate, attestationColour, shortDate } from './atoms';
import {
  attestationSummary, inForceText, inWorkflow, keyInfoRows, mappedFrameworkIds, mappedLine, nextTab, tabsFor, timelineFromDates, versionText,
  type InfoRow, type TabId,
} from './drawerLogic';
import { FrameworkList } from './FrameworkList';
import { type GovDoc, InitialsAvatar, LifecycleDots, docTypeStyle } from './lib';
import { type Lookups, statusLabel, typeLabel } from './libraryModel';
import { type RowAction, RowActionsMenu } from './RowActionsMenu';
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
  onClose: () => void;
  /** the full document page */
  onOpenDoc: (id: number) => void;
  /** a framework row was clicked: the library filters by it (the drawer stays open) */
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

const MUTED = 'text-[12px] leading-snug text-[#586472]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const BTN = `inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white px-3 text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] ${FOCUS}`;
// text-[#fff], not text-white: the platform CSS repaints text-white
const BTN_PRIMARY = `inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#0f766e] bg-[#0f766e] px-3 text-[13px] font-medium text-[#fff] hover:border-[#115e59] hover:bg-[#115e59] ${FOCUS} focus-visible:ring-offset-2`;
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-md text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent ${FOCUS}`;
const TEXT_LINK = `inline-flex items-center gap-1 rounded text-[13px] font-medium text-[#0f766e] hover:text-[#115e59] hover:underline ${FOCUS}`;
// RowActionsMenu draws its own small grey trigger: made the size and look of the other buttons here (the hover fill needs ! because
// the platform CSS sets the trigger's hover:bg-slate-100 with !important, to a colour that is not defined)
const MORE = 'inline-flex [&>button]:inline-flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-lg [&>button]:border [&>button]:border-[#d5dbe1] [&>button]:p-0 [&>button]:text-[#586472] [&>button:hover]:!bg-[#f3f6f8] [&>button:hover]:text-[#1f2933] [&>button:focus-visible]:outline-none [&>button:focus-visible]:ring-2 [&>button:focus-visible]:ring-[#0f766e]';

// the label next to the dots, in dark ink (the library's own label colours are repainted by the platform CSS: Approved comes out mint)
const STATUS_INK: Record<string, string> = {
  draft: 'text-[#475569]', pending_review: 'text-[#b45309]', pending_approval: 'text-[#b45309]', approved: 'text-[#1d4ed8]', published: 'text-[#047857]',
};

// ─── Small pieces ────────────────────────────────────────────────────────────────────────────────────────────────────────

// dark text on a light tint of the type (the library's own tints are too pale for a letter)
const TILE: Record<string, string> = {
  policy: 'bg-[#f0fdfa] text-[#0f766e]', standard: 'bg-[#eff6ff] text-[#1d4ed8]', procedure: 'bg-[#fffbeb] text-[#b45309]',
  guideline: 'bg-[#f5f3ff] text-[#6d28d9]', charter: 'bg-[#f1f5f9] text-[#475569]', framework: 'bg-[#ecfeff] text-[#0e7490]',
};

function IconButton({ label, onClick, disabled = false, innerRef, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  innerRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  // aria-disabled, not disabled: at the end of the list the button keeps the keyboard focus it was given
  return (
    <button ref={innerRef} type="button" title={label} aria-label={label} aria-disabled={disabled || undefined} onClick={() => { if (!disabled) onClick(); }} className={ICON_BTN}>
      {children}
    </button>
  );
}

function Section({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-[#e1e6eb] pt-4'}>
      <h3 className="text-[13px] font-semibold text-[#1f2933]">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <li key={`${t}-${i}`} className="rounded-md border border-[#d5dbe1] bg-[#f3f6f8] px-2 py-0.5 text-[12px] text-[#26323d]">{t}</li>
      ))}
    </ul>
  );
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[12px] text-[#586472]">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden /> {children}
    </p>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function InfoItem({ row, doc }: { row: InfoRow; doc: GovDoc }) {
  const value = <span className={row.empty ? 'text-[#586472]' : ''}>{row.value}</span>;
  return (
    <div className={`min-w-0 ${row.wide ? 'col-span-2' : ''}`}>
      <dt className="text-[12px] leading-4 text-[#586472]">{row.label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[13px] leading-snug text-[#1f2933]">
        {row.kind === 'review' ? <ReviewDate doc={doc} />
          : row.kind === 'person' ? (
            <span className="inline-flex items-center gap-2">
              {!row.empty && <InitialsAvatar name={doc.owner_name} size="sm" />}
              {value}
            </span>
          )
          : value}
        {row.note && <span className="block text-[12px] text-[#586472]">{row.note}</span>}
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
  if (!body) return <p className="text-[13px] text-[#586472]">No description.</p>;
  return (
    <div>
      <p ref={ref} className={`whitespace-pre-line break-words text-[13px] leading-relaxed text-[#26323d] ${open ? '' : 'line-clamp-5'}`}>{body}</p>
      {(long || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`mt-1 ${TEXT_LINK}`}>{open ? 'Show less' : 'Show more'}</button>
      )}
    </div>
  );
}

function Overview({ doc, lookups, counts }: { doc: GovDoc; lookups: Lookups; counts: DocumentDrawerProps['counts'] }) {
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
        <div className="flex items-center gap-3">
          {att.requested && <AttestationRing pct={att.pct} done={att.done ?? undefined} total={att.total ?? undefined} size={44} />}
          <div className="min-w-0">
            <p className="text-[13px] font-medium leading-snug text-[#1f2933]">{att.headline}</p>
            {att.detail && <p className={MUTED}>{att.detail}</p>}
          </div>
        </div>
        <Link href="/governance/documents/attestation" className={`mt-2.5 ${TEXT_LINK}`}>Manage attestation</Link>
      </Section>
      <Section title="Description"><Description text={doc.description} /></Section>
      {tags.length > 0 && <Section title="Tags"><Chips items={tags} /></Section>}
      {scope.length > 0 && <Section title="Regulatory scope"><Chips items={scope} /></Section>}
    </div>
  );
}

// ─── Workflow ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const dueWords = (r: LifecycleRow): string => (!r.due_date ? 'no due date' : r.overdue ? `overdue since ${day(r.due_date)}` : `due ${day(r.due_date)}`);

/** What the document itself says when the workflow history cannot be read (the feature is off for the organisation, or the call failed). */
function OwnDates({ doc, failed }: { doc: GovDoc; failed: boolean }) {
  const events = timelineFromDates(doc, shortDate);
  return (
    <div>
      {failed && <p role="status" className={`mb-3 ${MUTED}`}>Could not read the history.</p>}
      <ol className="ml-1.5 border-l border-[#d5dbe1]">
        {events.map((e) => (
          <li key={e.key} className="relative pb-3 pl-4">
            <span aria-hidden className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-[#0f766e]" />
            <p className="text-[13px] font-medium leading-snug text-[#1f2933]">{e.label}</p>
            <p className={MUTED}>{e.text}</p>
          </li>
        ))}
      </ol>
      <p className={MUTED}>More in the Change log.</p>
    </div>
  );
}

// fetched only while this tab is open (it is mounted only then); the same cache entry as the life-cycle hover card
function Workflow({ doc, onOpenDoc }: { doc: GovDoc; onOpenDoc: (id: number) => void }) {
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
              <ul className="divide-y divide-[#e1e6eb]">
                {waiting.slice(0, WAITING_SHOWN).map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-[13px] font-medium text-[#1f2933]">{r.user || 'Unknown person'}</span>
                    <span className={`shrink-0 text-right text-[12px] ${r.overdue ? 'font-medium text-[#b42318]' : 'text-[#586472]'}`}>
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
                <div role="progressbar" aria-label="Acknowledged" aria-valuemin={0} aria-valuemax={100} aria-valuenow={acks.percent} className="h-2 w-full overflow-hidden rounded-full bg-[#e1e6eb]">
                  <div className="h-2 rounded-full" style={{ width: `${acks.percent}%`, backgroundColor: attestationColour(acks.percent) }} />
                </div>
                <p className="mt-1.5 text-[13px] text-[#26323d]">
                  {acks.done} of {acks.total} users ({acks.percent}%)
                  {acks.overdue > 0 && <span className="font-medium text-[#b42318]"> · {acks.overdue} overdue</span>}
                </p>
              </>
            ) : <p className={MUTED}>None requested</p>}
          </Section>
          <Section title="Recent activity">
            {recent.length === 0 ? <p className={MUTED}>No activity yet</p> : (
              <ol className="space-y-2">
                {recent.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-[7.5rem] shrink-0 whitespace-nowrap text-[12px] leading-snug text-[#586472]">{dateTime(e.at)}</span>
                    <span className="min-w-0 text-[13px] leading-snug text-[#1f2933]">
                      <span className="font-medium">{eventLabel(e.kind)}</span>
                      {e.actor && <span className="text-[#586472]"> · {e.actor}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
      <div className="mt-5 border-t border-[#e1e6eb] pt-3">
        <button type="button" onClick={() => onOpenDoc(doc.id)} className={TEXT_LINK}>
          Open workflow <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ─── Frameworks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function Frameworks({ doc, lookups, active, onPick }: { doc: GovDoc; lookups: Lookups; active: string[]; onPick: (id: number) => void }) {
  const ids = mappedFrameworkIds(doc);
  if (ids.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#c3ccd5] px-4 py-8 text-center">
        <p className="text-[13px] font-medium text-[#1f2933]">No frameworks</p>
        <p className={`mt-1 ${MUTED}`}>Map them from Edit.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-[13px] font-medium text-[#1f2933]">{mappedLine(ids.length)}</p>
      <FrameworkList ids={ids} info={lookups.frameworks} active={active} onPick={onPick} maxHeight={420} />
    </div>
  );
}

// ─── The panel ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Escape closes the drawer unless something else owns it: an open menu or dialog, or a search box with text to clear; and only when
 *  focus is in the drawer, on the page itself or on the table's row (never in a field elsewhere). */
function escapeCloses(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return false;
  const over = document.querySelector('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]');
  if (over && !panel?.contains(over)) return false;
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'search' && t.value) return false;
  const focus = document.activeElement;
  return !focus || focus === document.body || !!panel?.contains(focus) || !!focus.closest('[data-doc-row]');
}

function DrawerPanel({
  doc, lookups, counts, activeFrameworks, onClose, onOpenDoc, onPickFramework, onEdit, canEdit, onDownload, onArchive, canArchive,
  onRestore, canRestore, onStep, hasPrev, hasNext,
}: DocumentDrawerProps & { doc: GovDoc }) {
  const uid = useId();
  const [tab, setTab] = useState<TabId>('overview');         // kept while the drawer shows another document; gone when it closes
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ id: doc.id, onClose });
  latest.current = { id: doc.id, onClose };

  // opening: focus the close button, slide in (unless motion is reduced); closing: focus goes back to the row it came from
  useEffect(() => {
    const panel = panelRef.current;
    closeRef.current?.focus({ preventScroll: true });
    if (panel && typeof panel.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 150, easing: 'ease-out' });
    }
    // capture phase: this looks at the page before a menu's own Escape handler closes it
    const onKey = (e: KeyboardEvent) => { if (escapeCloses(e, panelRef.current)) latest.current.onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const focus = document.activeElement;
      if (focus && focus !== document.body) return;           // focus went somewhere on purpose
      const row = document.querySelector<HTMLElement>(`[data-doc-row="${latest.current.id}"]`);
      if (!row) return;
      if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
      row.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [doc.id, tab]);

  const tabs = tabsFor(doc);
  const onTabKey = (e: React.KeyboardEvent) => {
    const next = nextTab(tabs.map((t) => t.id), tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  const menu: RowAction[] = [
    { key: 'archive', label: 'Archive', icon: Archive, onClick: () => onArchive(doc), variant: 'danger', hidden: !canArchive },
    { key: 'restore', label: 'Restore', icon: ArchiveRestore, onClick: () => onRestore?.(doc), hidden: !(onRestore && canRestore) },
  ];
  const inForce = inForceText(doc);

  return (
    <div
      ref={panelRef}
      role="complementary"
      aria-label="Document details"
      data-doc-drawer=""
      // under the app header (h-12) and its menus (z-50), over the page; a full-width sheet below 768px
      className="fixed bottom-0 right-0 top-12 z-40 flex w-full flex-col border-l border-[#d5dbe1] bg-white shadow-elevated md:w-[480px]"
    >
      <div className="shrink-0 border-b border-[#e1e6eb] px-5 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          <span aria-hidden title={typeLabel(doc.doc_type)} className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[16px] font-semibold ${TILE[doc.doc_type] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
            {docTypeStyle(doc.doc_type).letter}
          </span>
          <div className="min-w-0 flex-1">
            <h2 title={doc.title} className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-[#1f2933]">{doc.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-snug text-[#586472]">
              {doc.document_code && <><span className="font-mono text-[#26323d]">{doc.document_code}</span><span aria-hidden>·</span></>}
              <span>{typeLabel(doc.doc_type)}</span>
              {doc.current_version && <><span aria-hidden>·</span><span>{versionText(doc.current_version)}</span></>}
              {inForce && <><span aria-hidden>·</span><span>{inForce}</span></>}
            </p>
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0 items-center gap-0.5">
            {onStep && (
              <>
                <IconButton label="Previous document" disabled={hasPrev === false} onClick={() => onStep(-1)}><ChevronUp className="h-4 w-4" strokeWidth={1.75} aria-hidden /></IconButton>
                <IconButton label="Next document" disabled={hasNext === false} onClick={() => onStep(1)}><ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /></IconButton>
              </>
            )}
            <IconButton label="Close details" onClick={onClose} innerRef={closeRef}><X className="h-4 w-4" strokeWidth={1.75} aria-hidden /></IconButton>
          </div>
        </div>

        <div className="mt-3">
          {inWorkflow(doc.status) ? (
            // the dots' unfilled track is bg-slate-200, which the platform CSS repaints white: made visible here
            <div className="flex items-center gap-2 [&_.bg-slate-200]:!bg-[#d5dbe1]">
              <LifecycleDots status={doc.status} showLabel={false} />
              <span className={`text-[13px] font-medium ${STATUS_INK[doc.status] ?? 'text-[#26323d]'}`}>{statusLabel(doc.status)}</span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d5dbe1] bg-[#f3f6f8] px-2.5 py-0.5 text-[12px] font-medium text-[#3f4b58]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#7b8794]" />
              {statusLabel(doc.status)}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => onOpenDoc(doc.id)} className={BTN_PRIMARY}>
            Open document <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" onClick={() => onDownload(doc)} className={BTN}>
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Download
          </button>
          {canEdit && (
            <button type="button" onClick={() => onEdit(doc)} title="Edit the document's details" className={BTN}>
              <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Edit
            </button>
          )}
          {menu.some((a) => !a.hidden) && <span className={MORE}><RowActionsMenu actions={menu} /></span>}
        </div>
      </div>

      <div role="tablist" aria-label="Document sections" onKeyDown={onTabKey} className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#e1e6eb] px-3 scrollbar-thin">
        {tabs.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${uid}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e] ${on ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472] hover:text-[#1f2933]'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* focusable, so the keyboard can scroll it when it holds nothing else to focus */}
      <div ref={bodyRef} role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e]">
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
      </div>
    </div>
  );
}

export function DocumentDrawer(props: DocumentDrawerProps): JSX.Element | null {
  const { doc } = props;
  if (!doc || typeof document === 'undefined') return null;
  return createPortal(<DrawerPanel {...props} doc={doc} />, document.body);
}

export default DocumentDrawer;
