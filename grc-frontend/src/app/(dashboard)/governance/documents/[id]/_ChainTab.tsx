'use client';

// The document's change log (the "change chain"): every version from the original (the uploaded file, or the first version written here) to the
// document as it is now, with who changed what, from what to what, on whose request and from which sources, the approvals in
// between, each version's size (major or minor), file to download and text to read as it was, and the whole chain as a table that exports to Excel, PDF and CSV. The next person
// to review reads what each person before them changed. Backend: governance/change_chain.py.
//
// The log is narrowed by person, date, where a change came from, kind of entry and a search (a sticky bar; the filters live in the URL),
// split into Changes (versions and what each changed), Activity (reviews, approvals, statements, other steps) or All, grouped by
// day; on wide screens the selected entry's details stand beside the list, on narrow ones they open under its row. The Export menu
// has the whole log and, while it is narrowed, what is shown. The rules are in lib/changeLog.ts, and the backend applies the same ones to the export.
//
// Words: the header's explanation is an (i) note; a row says who, what, from → to, when and from where, and nothing else.
// Colours are explicit values where the platform shell repaints slate classes (see the design system): teal for the AI, amber
// for taken back, emerald for approvals, neutral for edits by hand, the original outlined.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, BookOpenCheck, Building2, CheckCircle2, ChevronDown, ChevronRight, Download, FileDown, FileSpreadsheet, FileText, GitCompare, GitCommitVertical, History,
  ListTree, Loader2, Send, ShieldCheck, Sparkles, Table2, Users, XCircle, type LucideIcon,
  RotateCcw, FileCheck2, FileInput, FileX2, ListPlus, ListX, PencilLine, RefreshCw, Undo2, Wrench, GitPullRequest,
} from 'lucide-react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { documentChainApi, ORIGIN_LABEL, shapeOf, sourceLabel, type ChainItem, type ChainSource, type ChainVersion, type ExportFormat } from '@/lib/documentChain';
import {
  NO_FILTERS, WHAT_LABEL, WHATS, WHEN_LABEL, WHENS, buildLog, dateRange, dayName, effective, exportParams, filtersOn, groupByDay, personIndex, readQuery,
  sortRows, sourceCounts, tableRows, versionAt, whatCounts, writeQuery, type EventEntry, type LogEntry, type LogFilters, type SortKey, type Split,
  type TableRow, type VersionEntry, type What, type When,
} from '@/lib/changeLog';
import { problemOf, saveBlob, type Segment } from '@/lib/studio/api';
import { ago, plural, wordDiff } from '@/lib/studio/text';
import { dateTime } from '@/lib/documentLifecycle';
import { parseUtc } from '@/lib/serverTime';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { BTN, BTN_TEXT } from '@/components/governance/docUi';
import { InitialsAvatar } from '../_workspace/lib';
import { OriginBadge, SourceChips, originLook } from '../studio/_components/ChangeAttribution';

const MUTED = 'text-[#586472]';
const KIND: Record<string, { label: string; tone: string }> = {
  inserted: { label: 'Added', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  deleted: { label: 'Removed', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  modified: { label: 'Changed', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
};
const STAGE_DOT: Record<string, string> = {
  draft: 'bg-[#94a3b8]', pending_review: 'bg-amber-500', pending_approval: 'bg-amber-500', approved: 'bg-emerald-500', published: 'bg-emerald-600',
  expired: 'bg-rose-500', archived: 'bg-[#94a3b8]', exception_applied: 'bg-amber-500',
};
const SLATE = 'bg-[#f1f5f9] text-[#586472] ring-[#e2e8f0]';
/** the version's kind (its change_type): a major change raises 1.x to 2.0, a minor one 1.1 to 1.2 */
const SIZE: Record<string, { label: string; tone: string }> = {
  major: { label: 'Major', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  minor: { label: 'Minor', tone: 'bg-primary-50 text-[#0f766e] ring-primary-100' },
  patch: { label: 'Patch', tone: SLATE },
};
const EVENT: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  created: { label: 'Created', icon: FileText, tone: SLATE },
  sent_for_review: { label: 'Sent for review', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  sent_for_approval: { label: 'Sent for approval', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  signed: { label: 'Signed', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejected', icon: XCircle, tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  published: { label: 'Published', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  archived: { label: 'Archived', icon: FileText, tone: SLATE },
  restored: { label: 'Restored from archive', icon: FileText, tone: SLATE },
  status_changed: { label: 'Status changed', icon: GitCommitVertical, tone: SLATE },
  review_completed: { label: 'Review completed', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  version_rollback: { label: 'Earlier version restored', icon: History, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  statements_updated_from_document: { label: 'Statements synced', icon: ListTree, tone: SLATE },
  // the rest of the approval trail the document's history records
  submitted: { label: 'Submitted', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  reviewed: { label: 'Reviewed', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  approved: { label: 'Approved', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  acknowledged: { label: 'Acknowledged', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  review_skipped: { label: 'Review skipped', icon: GitCommitVertical, tone: SLATE },
  request_cancelled: { label: 'Request withdrawn', icon: XCircle, tone: SLATE },
  participant_removed: { label: 'Reviewer or approver removed', icon: Users, tone: SLATE },
  owner_assigned: { label: 'Owner changed', icon: Users, tone: SLATE },
  department_changed: { label: 'Department changed', icon: Building2, tone: SLATE },
  return_to_draft: { label: 'Returned to draft', icon: RotateCcw, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  escalated: { label: 'Escalated', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  delegated: { label: 'Delegated', icon: Send, tone: SLATE },
  changes_requested: { label: 'Changes requested', icon: RotateCcw, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  resubmitted: { label: 'Resubmitted', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  review_again_requested: { label: 'Review asked again', icon: RotateCcw, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  withdrawn: { label: 'Withdrawn from review', icon: RotateCcw, tone: SLATE },
  route_set: { label: 'Approval route set', icon: Users, tone: SLATE },
  // changes to the document's statements (not approvals): each shows the statement's wording before and after
  statement_added: { label: 'Statement added', icon: ListPlus, tone: SLATE },
  statement_edited: { label: 'Statement edited', icon: PencilLine, tone: SLATE },
  statement_deleted: { label: 'Statement removed', icon: ListX, tone: SLATE },
  statement_rolled_back: { label: 'Statement rolled back', icon: History, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  statements_reparsed: { label: 'Statements re-read', icon: RefreshCw, tone: SLATE },
  statement_corrected_to_file: { label: 'Statement corrected', icon: FileCheck2, tone: SLATE },
  statement_out_of_document: { label: 'Statement not in document', icon: FileX2, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  statement_changed_by_fix: { label: 'Changed by gap fix', icon: Wrench, tone: SLATE },
  statement_fix_undone: { label: 'Gap fix undone', icon: Undo2, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  statements_written_to_document: { label: 'Statements written', icon: FileInput, tone: SLATE },
  // changes proposed by others than the owner or author, and the owner's decision on them (lib/proposals.ts)
  change_proposed: { label: 'Change proposed', icon: GitPullRequest, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  proposal_accepted: { label: 'Proposal accepted', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  proposal_rejected: { label: 'Proposal not accepted', icon: XCircle, tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  proposal_withdrawn: { label: 'Proposal withdrawn', icon: Undo2, tone: SLATE },
};

const STAGE_NAME: Record<string, string> = {
  draft: 'Draft', pending_review: 'In review', pending_approval: 'In approval', approved: 'Approved', published: 'Published', expired: 'Expired',
  archived: 'Archived', exception_applied: 'Exception applied',
};
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const FORMATS = [['xlsx', 'Excel', FileSpreadsheet], ['pdf', 'PDF', FileText], ['csv', 'CSV', FileDown]] as const;
const SPLITS: Array<{ value: Split; text: string; hint: string }> = [
  { value: 'changes', text: 'Changes', hint: 'Versions and what each changed' },
  { value: 'activity', text: 'Activity', hint: 'Reviews, approvals, statements and other steps' },
  { value: 'all', text: 'All', hint: 'Changes and activity together' },
];
type DiffMode = 'redline' | 'sides';

const eventMeta = (kind: string) => EVENT[kind] ?? { label: kind.replace(/_/g, ' '), icon: FileText, tone: SLATE };
const eventLabel = (kind: string) => eventMeta(kind).label;
const LABELS = { kind: (s: string) => (KIND[s] ?? KIND.modified).label, event: eventLabel, source: (k: string) => ORIGIN_LABEL[k] ?? 'Changed' };
const clock = (at: string | null) => parseUtc(at)?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) ?? '';

/** sources with nothing to name them by (a change made on the person's request) are labelled by what they rest on, not "Source" */
const named = (sources: ChainSource[]) => (sources ?? []).map((s) => (s.ref || s.title || s.locator ? s : { ...s, title: sourceLabel(s) }));
/** how a change reshaped the outline ("Paragraph → Heading 2"), or "Formatting only"; null when it is told by its words */
const tagOf = (it: ChainItem) => (it.structure?.length ? it.structure.join(' · ') : shapeOf(it));

const originLabel = (v: ChainVersion, isFirst: boolean) => (isFirst && v.origin === 'initial' ? 'The original'
  : v.restored_from ? `Restored v${v.restored_from}` : ORIGIN_LABEL[v.origin] ?? v.origin_label);

function Words({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" title={`${added} words added, ${removed} removed`}>
      <span className="font-mono font-semibold text-emerald-700">+{added}</span>
      <span className="font-mono font-semibold text-rose-700">−{removed}</span>
      <span className={MUTED}>words</span>
    </span>
  );
}

function Stage({ stage, label }: { stage: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#26323d]" title="The stage the document was in when this happened">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage] ?? 'bg-[#94a3b8]'}`} aria-hidden />{label}
    </span>
  );
}

function SectionPath({ section }: { section: string }) {
  const parts = (section || 'Top of the document').split(' › ');
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[#94a3b8]" aria-hidden />}
          <span className={i === parts.length - 1 ? 'font-semibold text-[#1f2933]' : MUTED}>{p}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** one side of a change shown before and after: what the text said, or that there was nothing there */
function Side({ label, text, after }: { label: string; text: string; after: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`mb-1 text-xs font-semibold ${MUTED}`}>{label}</p>
      <p className={`whitespace-pre-wrap break-words rounded-lg border-l-[3px] px-3 py-2 text-[13px] leading-relaxed ${after ? 'border-l-emerald-500 bg-emerald-50/60 text-emerald-950' : 'border-l-rose-500 bg-rose-50/60 text-rose-900'}`}>
        {text || <span className={`text-xs italic ${MUTED}`}>{after ? 'None (removed)' : 'None (added)'}</span>}
      </p>
    </div>
  );
}

function Diff({ item, mode = 'redline' }: { item: Pick<ChainItem, 'status' | 'before_text' | 'after_text'>; mode?: DiffMode }) {
  const segs: Segment[] = useMemo(() => (item.status === 'modified' && mode === 'redline' ? wordDiff(item.before_text, item.after_text) : []), [item, mode]);
  if (mode === 'sides') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Side label="Before" text={item.status === 'inserted' ? '' : item.before_text} after={false} />
        <Side label="After" text={item.status === 'deleted' ? '' : item.after_text} after />
      </div>
    );
  }
  if (item.status === 'inserted') {
    return <p className="whitespace-pre-wrap break-words rounded-lg border-l-[3px] border-l-emerald-500 bg-emerald-50/60 px-3 py-2 text-[13px] leading-relaxed text-emerald-950">{item.after_text}</p>;
  }
  if (item.status === 'deleted') {
    return <p className="whitespace-pre-wrap break-words rounded-lg border-l-[3px] border-l-rose-500 bg-rose-50/60 px-3 py-2 text-[13px] leading-relaxed text-rose-900 line-through decoration-rose-400">{item.before_text}</p>;
  }
  return (
    <p className="whitespace-pre-wrap break-words rounded-lg border-l-[3px] border-l-amber-400 bg-[#fffdf5] px-3 py-2 text-[13px] leading-relaxed text-slate-800">
      {segs.map(([op, text], i) => (op === 'insert'
        ? <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline">{text}</ins>
        : op === 'delete' ? <del key={i} className="rounded-sm bg-rose-100 px-0.5 text-rose-800 line-through decoration-rose-400">{text}</del> : <span key={i}>{text}</span>))}
    </p>
  );
}

function ItemCard({ item, version, mode }: { item: ChainItem; version: string; mode: DiffMode }) {
  const kind = KIND[item.status] ?? KIND.modified;
  const shape = shapeOf(item);                                      // no word changed: say how the outline or formatting changed
  const tag = tagOf(item);
  return (
    <li className="rounded-xl border border-[#d5dbe1] bg-[#fff]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#e1e6eb] px-3 py-2">
        <span className="rounded-md bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#26323d]" title="Reference in the export">{version}.{item.n}</span>
        <SectionPath section={item.section} />
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${kind.tone}`}>{kind.label}{tag ? ` · ${tag}` : ''}</span>
        {!shape && <span className="ml-auto"><Words added={item.words_added} removed={item.words_removed} /></span>}
      </div>
      <div className="px-3 py-2.5">
        <Diff item={item} mode={mode} />
        {item.truncated && (
          <p className={`mt-1 flex items-center gap-0.5 text-xs ${MUTED}`}>
            Shortened <InfoTip label="About the shortened text" text="The whole text is in the document and in the Excel export." />
          </p>
        )}
      </div>
      <div className="rounded-b-xl border-t border-[#e1e6eb] bg-[#f7f9fa] px-3 py-2">
        <OriginBadge origin={item.origin} by={item.by} coverage={item.coverage} at={item.at} />
        {item.request && <p className="mt-1.5 border-l-2 border-primary-100 pl-2 text-xs italic text-[#586472]">“{item.request}”</p>}
        {item.reason && <p className="mt-1 text-xs text-[#26323d]">{item.origin === 'ai' ? <span className="font-medium text-[#0f766e]">Why: </span> : null}{item.reason}</p>}
        <SourceChips sources={named(item.sources)} />
      </div>
    </li>
  );
}

/** a row of toggle buttons (one pressed): the split, the layout, how changes are shown */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; onChange: (v: T) => void;
  /** `iconOnly`: on a phone only the icon shows (the words stay for screen readers and in the tooltip); `hint`: what the choice shows, on hover */
  options: Array<{ value: T; text: string; icon?: LucideIcon; iconOnly?: boolean; hint?: string }>;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg bg-[#eef1f4] p-0.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)} title={o.hint ?? (o.iconOnly ? o.text : undefined)}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold sm:gap-1.5 sm:px-2.5 ${FOCUS} ${on ? 'bg-[#fff] text-[#0f766e] shadow-card' : 'text-[#586472] hover:text-[#1f2933]'}`}>
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            <span className={o.iconOnly ? 'sr-only sm:not-sr-only' : ''}>{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

const MODES: Array<{ value: DiffMode; text: string }> = [{ value: 'redline', text: 'Redline' }, { value: 'sides', text: 'Before and after' }];

/** A version: who made it, how and when, its file, Read / Show in the document / Restore, and its changes from what to what. */
function VersionDetail({ entry, current, mode, onMode, onShow, onDownload, downloading, onRestore, onRead }: {
  entry: VersionEntry; current: boolean; mode: DiffMode; onMode: (m: DiffMode) => void; onShow: () => void; onDownload: () => void; downloading: boolean;
  /** make this version the document again, as a new version (editors only) */
  onRestore?: () => void;
  /** read this version as it was, in the Document view */
  onRead?: () => void;
}) {
  const v = entry.version;
  const isFirst = entry.first;
  const [all, setAll] = useState(false);                        // the changes the filters leave out, shown anyway
  const items = all ? v.items : entry.items;
  const look = originLook(isFirst && v.origin === 'initial' ? 'initial' : v.origin);
  const Icon = look.icon;
  // the summary holds the "Major change: why" line; the person's own reason is shown under it when it says something else
  const reason = v.reason && !v.summary.includes(v.reason) ? `“${v.reason}”` : '';
  const size = SIZE[v.kind ?? ''];
  const canShow = !isFirst && v.origin !== 'initial' && v.comparable;
  const nothing = v.origin === 'initial' || isFirst ? 'First version: nothing to compare'
    : v.comparable ? 'No text changes' : 'Not listed: its file could not be read';
  return (
    <div data-version-id={v.id}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pb-2.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${look.node}`} aria-hidden><Icon className="h-3.5 w-3.5" /></span>
            <span className="text-[15px] font-semibold text-[#1f2933]">v{v.number}</span>
            {current && <span className="rounded-full bg-[#f0fdfa] px-2 py-0.5 text-[11px] font-semibold text-[#0f766e] ring-1 ring-inset ring-primary-100">Current</span>}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.pill}`}>{originLabel(v, isFirst)}</span>
            {size && !isFirst && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${size.tone}`} title="How big the change was: a major change raises the first number of the version">{size.label}</span>}
            {!v.comparable && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">Text not readable</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5 text-[#26323d]"><InitialsAvatar name={v.by} size="sm" /> {v.by}</span>
            <span className={MUTED} title={ago(v.at)}>{dateTime(v.at)}</span>
            <Stage stage={v.stage} label={v.stage_label} />
            {v.has_file && v.file_name && <span className={`inline-flex min-w-0 items-center gap-1 break-all ${MUTED}`}><FileText className="h-3.5 w-3.5 shrink-0" aria-hidden /> {v.file_name}</span>}
            {v.changes > 0 && <Words added={v.words_added} removed={v.words_removed} />}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {v.has_file && (
            <button type="button" onClick={onDownload} disabled={downloading} title={`Download the file of version ${v.number}`} className={BTN}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} File
            </button>
          )}
          {onRead && !current && (
            <button type="button" onClick={onRead} title={`Read version ${v.number} as it was`} className={BTN}>
              <BookOpen className="h-4 w-4" /> Read
            </button>
          )}
          <button type="button" onClick={onShow} disabled={!canShow} title={canShow ? "See this version's changes marked in the document" : 'The original has nothing before it to compare with'} className={BTN}>
            <GitCompare className="h-4 w-4" /> Show in document
          </button>
          {onRestore && !current && (
            <button type="button" onClick={onRestore} title={`Make version ${v.number} the document again, as a new version`} className={BTN}>
              <RotateCcw className="h-4 w-4" /> Restore
            </button>
          )}
        </div>
      </div>
      {(v.summary || reason) && (
        <div className="mx-4 mb-2.5 border-l-2 border-[#c3ccd5] pl-3 text-[13px] text-[#586472]">
          {v.summary && <p className="text-[13px] text-[#26323d]">{v.summary}</p>}
          {reason && <p className="text-[13px] italic text-[#586472]">{reason}</p>}
        </div>
      )}
      {v.approved_by && (
        <p className="mx-4 mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approved by {v.approved_by}{v.approved_at ? `, ${dateTime(v.approved_at)}` : ''}
        </p>
      )}
      <div className="rounded-b-xl border-t border-[#e1e6eb] bg-[#f7f9fa] p-3">
        {v.items.length > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#1f2933]">
              {entry.hidden && !all ? `${items.length} of ${plural(v.items.length, 'change')} shown` : plural(v.items.length, 'change')}
            </p>
            <Segmented label="Show each change as" value={mode} onChange={onMode} options={MODES} />
          </div>
        )}
        {items.length === 0
          ? <p className={`text-xs ${MUTED}`}>{v.items.length ? 'None match the filters' : nothing}</p>
          : <ul className="space-y-2.5">{items.map((it) => <ItemCard key={`${v.id}-${it.n}`} item={it} version={v.number} mode={mode} />)}</ul>}
        {entry.hidden > 0 && (
          <button type="button" onClick={() => setAll(!all)} className={`mt-2 ${BTN_TEXT}`}>
            {all ? 'Show matching only' : `Show ${plural(entry.hidden, 'other change')}`}
          </button>
        )}
      </div>
    </div>
  );
}

/** A step: what happened, who did it and when, the stage it left the document in, and a statement's wording from what to what. */
function EventDetail({ entry, versionThen, mode, onMode }: { entry: EventEntry; versionThen: string; mode: DiffMode; onMode: (m: DiffMode) => void }) {
  const e = entry.event;
  const meta = eventMeta(e.kind);
  const Icon = meta.icon;
  const label = `text-xs font-semibold ${MUTED}`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${meta.tone}`}><Icon className="h-3.5 w-3.5" aria-hidden /> {meta.label}</span>
        <span className={label}>{WHAT_LABEL[entry.group]}</span>
      </div>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className={MUTED}>Who</dt>
        <dd className="text-[#26323d]">{e.actor ? <span className="inline-flex items-center gap-1.5"><InitialsAvatar name={e.actor} size="sm" /> {e.actor}</span> : 'Not recorded'}</dd>
        <dt className={MUTED}>When</dt>
        <dd className="text-[#26323d]">{e.at ? `${dateTime(e.at)} (${ago(e.at)})` : 'Not recorded'}</dd>
        {e.to && (
          <>
            <dt className={MUTED}>Status</dt>
            <dd className="text-[#26323d]">{e.from ? `${STAGE_NAME[e.from] ?? e.from} → ` : ''}{STAGE_NAME[e.to] ?? e.to}</dd>
          </>
        )}
        <dt className={MUTED}>Stage</dt>
        <dd><Stage stage={e.stage} label={STAGE_NAME[e.stage] ?? e.stage} /></dd>
        {versionThen && (
          <>
            <dt className={MUTED}>Version</dt>
            <dd className="font-mono text-[#26323d]">v{versionThen}</dd>
          </>
        )}
      </dl>
      {e.detail && (
        <div>
          <p className={label}>Details</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-[#26323d]">{e.detail}</p>
        </div>
      )}
      {(e.before || e.after) && (                                  // a statement's wording, from what to what
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className={label}>Wording</p>
            {e.before && e.after && <Segmented label="Show the wording as" value={mode} onChange={onMode} options={MODES} />}
          </div>
          <Diff item={{ status: e.before && e.after ? 'modified' : e.after ? 'inserted' : 'deleted', before_text: e.before ?? '', after_text: e.after ?? '' }} mode={mode} />
        </div>
      )}
    </div>
  );
}

/** One entry of the list, in a line or three: a version (number, how it was made, by whom, its changes) or a step. On a wide screen
 *  it selects the entry for the pane beside the list; on a narrow one it opens the details under it. */
function EntryRow({ entry, current, selected, open, wide, onPick }: { entry: LogEntry; current: boolean; selected: boolean; open: boolean; wide: boolean; onPick: () => void }) {
  const aria = wide ? { 'aria-current': selected ? ('true' as const) : undefined, 'aria-controls': 'change-log-detail' }
    : { 'aria-expanded': open, 'aria-controls': `${entry.key}-detail` };
  const cls = `flex w-full items-start gap-3 px-3 py-2.5 text-left ${FOCUS} focus-visible:ring-inset ${selected && wide ? 'bg-[#f0fdfa] shadow-[inset_3px_0_0_#0f766e]' : 'hover:bg-[#f7f9fa]'}`;
  const chevron = !wide && <ChevronDown className={`mt-1 h-3.5 w-3.5 shrink-0 text-[#7b8794] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />;
  if (entry.type === 'event') {
    const e = entry.event;
    const meta = eventMeta(e.kind);
    const Icon = meta.icon;
    const line = e.detail || e.after || e.before;
    return (
      <button type="button" onClick={onPick} data-entry={entry.key} className={cls} {...aria}>
        <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${meta.tone}`} aria-hidden><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold text-[#1f2933]">{meta.label}</span>
            {e.actor && <span className="text-xs text-[#26323d]">{e.actor}</span>}
          </span>
          {line && <span className={`mt-0.5 block truncate text-xs ${MUTED}`}>{line}</span>}
        </span>
        <span className={`shrink-0 text-xs ${MUTED}`}>{clock(e.at)}</span>
        {chevron}
      </button>
    );
  }
  const v = entry.version;
  const look = originLook(entry.first && v.origin === 'initial' ? 'initial' : v.origin);
  const Icon = look.icon;
  const size = SIZE[v.kind ?? ''];
  const added = entry.items.reduce((n, i) => n + i.words_added, 0);
  const removed = entry.items.reduce((n, i) => n + i.words_removed, 0);
  return (
    <button type="button" onClick={onPick} data-entry={entry.key} className={cls} {...aria}>
      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${look.node} ${current ? 'ring-2 ring-primary-600' : ''}`} aria-hidden><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#1f2933]">v{v.number}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.pill}`}>{originLabel(v, entry.first)}</span>
          {size && !entry.first && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${size.tone}`}>{size.label}</span>}
          {current && <span className="rounded-full bg-[#f0fdfa] px-1.5 py-0.5 text-[11px] font-semibold text-[#0f766e] ring-1 ring-inset ring-primary-100">Current</span>}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#26323d]">
          <span>{v.by}</span>
          <Stage stage={v.stage} label={v.stage_label} />
          {v.items.length > 0 && <span className={MUTED}>{entry.hidden ? `${entry.items.length} of ${plural(v.items.length, 'change')}` : plural(v.items.length, 'change')}</span>}
          {added + removed > 0 && <Words added={added} removed={removed} />}
        </span>
        {v.summary && <span className={`mt-0.5 block truncate text-xs ${MUTED}`}>{v.summary}</span>}
      </span>
      <span className={`shrink-0 text-xs ${MUTED}`}>{clock(v.at)}</span>
      {chevron}
    </button>
  );
}

/** From the original to now at a glance: one marker per version, coloured by how it was made. A marker opens its version. */
function Journey({ versions, onPick }: { versions: ChainVersion[]; onPick: (id: number) => void }) {
  if (versions.length < 2) return null;
  const first = versions[0];
  const last = versions[versions.length - 1];
  const dense = versions.length > 14;
  return (
    <div className="mt-3 border-t border-[#e1e6eb] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className={MUTED}><span className="font-semibold text-[#1f2933]">Original</span> · v{first.number} · {dateTime(first.at)}{first.file_name ? ` · ${first.file_name}` : ''}</span>
        <span className={MUTED}><span className="font-semibold text-[#1f2933]">Now</span> · v{last.number} · {last.stage_label}</span>
      </div>
      {/* on a phone a long journey scrolls inside its box, not the page */}
      <div className="relative -mx-1 overflow-x-auto px-1 py-1">
        <div className="w-max min-w-full">
          <div className="relative mt-1.5 flex items-center justify-between gap-1">
            <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded bg-[#dbe3ea]" aria-hidden />
            {versions.map((v, i) => {
              const look = originLook(i === 0 && v.origin === 'initial' ? 'initial' : v.origin);
              const Icon = look.icon;
              const now = i === versions.length - 1;
              return (
                <button key={v.id} type="button" onClick={() => onPick(v.id)}
                  title={`v${v.number} · ${originLabel(v, i === 0)} · ${v.by} · ${dateTime(v.at)}${v.changes ? ` · ${plural(v.changes, 'change')}` : ''}`}
                  className={`relative z-[1] inline-flex shrink-0 items-center justify-center rounded-full ring-inset transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${look.node}
                    ${dense ? 'h-5 w-5 ring-1' : 'h-8 w-8 ring-1'} ${now ? 'ring-2 ring-primary-600' : ''}`}>
                  {!dense && <Icon className="h-3.5 w-3.5" aria-hidden />}
                  <span className="sr-only">Version {v.number}</span>
                </button>
              );
            })}
          </div>
          {!dense && <div className="mt-1 flex justify-between gap-1 font-mono text-[11px] text-[#7b8794]">{versions.map((v) => <span key={v.id} className="w-8 shrink-0 text-center">v{v.number}</span>)}</div>}
        </div>
      </div>
    </div>
  );
}

/** One number of the summary strip: what it counts, the figure, and a short fact beside it (a longer one in the tooltip). */
function Stat({ icon: Icon, label, value, sub, title }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <p className={`flex items-center gap-1.5 text-xs font-medium ${MUTED}`}><Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />{label}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg font-semibold leading-6 text-[#1f2933]">{value}</span>
        {sub && <span className={`text-xs ${MUTED}`}>{sub}</span>}
      </div>
    </div>
  );
}

function People({ names }: { names: string[] }) {
  return (
    <span className="flex items-center">
      {names.slice(0, 4).map((n, i) => <span key={n} className={i ? '-ml-1.5' : ''}><InitialsAvatar name={n} size="sm" /></span>)}
      {names.length > 4 && <span className="ml-1">+{names.length - 4}</span>}
    </span>
  );
}

const COLUMNS: Array<{ label: string; sort?: SortKey }> = [
  { label: 'Ref' }, { label: 'When', sort: 'when' }, { label: 'Who', sort: 'who' }, { label: 'What', sort: 'what' }, { label: 'Source', sort: 'source' },
  { label: 'Version', sort: 'version' }, { label: 'Stage' }, { label: 'Section or details' }, { label: 'From' }, { label: 'To' }, { label: 'Words' },
  { label: 'Request and reason' }, { label: 'Sources' },
];
const TD = 'px-2.5 py-2 align-top text-xs';

function Who({ name }: { name: string | null | undefined }) {
  return name ? <span className="inline-flex items-center gap-1.5 text-[#26323d]"><InitialsAvatar name={name} size="sm" /> {name}</span> : <span className={MUTED}>—</span>;
}

function Pill({ tone, icon: Icon, children }: { tone: string; icon?: LucideIcon; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>{Icon && <Icon className="h-3 w-3" aria-hidden />}{children}</span>;
}

function Texts({ before, after }: { before: string | null | undefined; after: string | null | undefined }) {
  return (
    <>
      <td className={`${TD} max-w-[16rem] bg-rose-50/40 text-rose-900`}><span className="line-clamp-4 whitespace-pre-wrap break-words" title={before ?? ''}>{before || '—'}</span></td>
      <td className={`${TD} max-w-[16rem] bg-emerald-50/40 text-emerald-950`}><span className="line-clamp-4 whitespace-pre-wrap break-words" title={after ?? ''}>{after || '—'}</span></td>
    </>
  );
}

function Line({ row }: { row: TableRow }) {
  const { entry, item: it } = row;
  const tr = 'border-t border-[#e1e6eb] hover:bg-[#f7f9fa]';
  const none = <span className={MUTED}>—</span>;
  if (entry.type === 'event') {
    const e = entry.event;
    const meta = eventMeta(e.kind);
    const statement = e.before || e.after;
    return (
      <tr className={tr}>
        <td className={TD}>{none}</td>
        <td className={`${TD} whitespace-nowrap text-[#26323d]`}>{dateTime(e.at)}</td>
        <td className={TD}><Who name={e.actor} /></td>
        <td className={TD}><Pill tone={meta.tone} icon={meta.icon}>{meta.label}</Pill></td>
        <td className={TD}>{none}</td>
        <td className={`${TD} whitespace-nowrap font-mono text-[#26323d]`}>{row.version ? `v${row.version}` : '—'}</td>
        <td className={`${TD} whitespace-nowrap`}><Stage stage={e.stage} label={STAGE_NAME[e.stage] ?? e.stage} /></td>
        <td className={`${TD} max-w-[16rem] text-[#26323d]`}>{e.detail || '—'}</td>
        {statement ? <Texts before={e.before} after={e.after} />
          : <Texts before={e.from ? STAGE_NAME[e.from] ?? e.from : null} after={e.to ? STAGE_NAME[e.to] ?? e.to : null} />}
        <td className={TD}>{none}</td>
        <td className={TD}>{none}</td>
        <td className={TD}>{none}</td>
      </tr>
    );
  }
  const v = entry.version;
  if (!it) {                                                      // a version shown by itself (the original, one with no change listed)
    const look = originLook(entry.first && v.origin === 'initial' ? 'initial' : v.origin);
    return (
      <tr className={tr}>
        <td className={`${TD} whitespace-nowrap font-mono text-[#26323d]`}>v{v.number}</td>
        <td className={`${TD} whitespace-nowrap text-[#26323d]`}>{dateTime(v.at)}</td>
        <td className={TD}><Who name={v.by} /></td>
        <td className={TD}><Pill tone={SLATE}>Version</Pill></td>
        <td className={TD}><Pill tone={look.pill} icon={look.icon}>{originLabel(v, entry.first)}</Pill></td>
        <td className={`${TD} whitespace-nowrap font-mono text-[#26323d]`}>v{v.number}</td>
        <td className={`${TD} whitespace-nowrap`}><Stage stage={v.stage} label={v.stage_label} /></td>
        <td className={`${TD} max-w-[16rem] text-[#26323d]`}>{v.summary || '—'}</td>
        <Texts before={null} after={null} />
        <td className={TD}>{none}</td>
        <td className={`${TD} max-w-[14rem] text-[#26323d]`}>{v.reason || '—'}</td>
        <td className={TD}>{none}</td>
      </tr>
    );
  }
  const kind = KIND[it.status] ?? KIND.modified;
  const look = originLook(it.origin);
  const tag = tagOf(it);
  return (
    <tr className={tr}>
      <td className={`${TD} whitespace-nowrap font-mono text-[#26323d]`}>{v.number}.{it.n}</td>
      <td className={`${TD} whitespace-nowrap text-[#26323d]`}>{dateTime(it.at || v.at)}</td>
      <td className={TD}><Who name={it.by || v.by} /></td>
      <td className={TD}>
        <Pill tone={kind.tone}>{kind.label}</Pill>
        {tag && <span className="mt-1 block whitespace-nowrap text-xs font-medium text-[#8a6100]">{tag}</span>}
      </td>
      <td className={TD}><Pill tone={look.pill} icon={look.icon}>{ORIGIN_LABEL[it.origin] ?? 'Changed'}</Pill></td>
      <td className={`${TD} whitespace-nowrap font-mono text-[#26323d]`}>v{v.number}</td>
      <td className={`${TD} whitespace-nowrap`}><Stage stage={v.stage} label={v.stage_label} /></td>
      <td className={`${TD} max-w-[16rem] text-[#26323d]`}>{it.section || '—'}</td>
      <Texts before={it.before_text} after={it.after_text} />
      <td className={`${TD} whitespace-nowrap`}>{shapeOf(it) ? <span className={`text-xs ${MUTED}`} title="No word changed">—</span> : <Words added={it.words_added} removed={it.words_removed} />}</td>
      <td className={`${TD} max-w-[14rem] text-[#26323d]`}>{[it.request && `“${it.request}”`, it.reason].filter(Boolean).join(' — ') || '—'}</td>
      <td className={`${TD} max-w-[16rem]`}><SourceChips sources={named(it.sources)} /></td>
    </tr>
  );
}

/** The log as a table: a row per change and per step, with the same filters; When, Who, What, Source and Version sort. */
function LogTable({ rows, sort, onSort }: { rows: TableRow[]; sort: { by: SortKey; dir: 'asc' | 'desc' }; onSort: (by: SortKey) => void }) {
  // the head's look is set on the <th> and a <span> in it: the platform's `thead th` rule would beat classes on the <thead>
  const HEAD = 'text-[11px] font-semibold uppercase tracking-wide';
  return (
    <div className="relative overflow-x-auto rounded-xl border border-[#d5dbe1] bg-[#fff]">
      <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
        <caption className="sr-only">The change log as a table. The When, Who, What, Source and Version columns can be sorted.</caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const on = !!c.sort && sort.by === c.sort;
              const Arrow = !on ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th key={c.label} scope="col" className="whitespace-nowrap border-b border-[#d5dbe1] px-2.5 py-2.5 text-left !bg-[#f3f6f8]"
                  aria-sort={c.sort ? (on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                  {c.sort ? (
                    <button type="button" onClick={() => onSort(c.sort as SortKey)} className={`inline-flex items-center gap-1 rounded hover:text-[#1f2933] ${on ? 'text-[#1f2933]' : 'text-[#586472]'} ${FOCUS}`}>
                      <span className={HEAD}>{c.label}</span><Arrow className={`h-3 w-3 ${on ? 'text-[#0f766e]' : 'text-[#7b8794]'}`} aria-hidden />
                    </button>
                  ) : <span className={`${HEAD} text-[#586472]`}>{c.label}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{rows.map((r) => <Line key={r.key} row={r} />)}</tbody>
      </table>
    </div>
  );
}

const MENU_ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';

/** One Export button: the whole log as Excel, PDF or CSV and, while the log is narrowed, what is shown (`shown`: how much that is). */
function ExportMenu({ busy, shown, onPick }: { busy: { format: ExportFormat; filtered: boolean } | null; shown: string | null; onPick: (f: ExportFormat, filtered: boolean) => void }) {
  const [open, setOpenState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // closing by a choice or Escape gives the keyboard focus back to the button
  const setOpen = (v: boolean) => {
    setOpenState((cur) => {
      if (cur && !v) setTimeout(() => trigger.current?.focus(), 0);
      return v;
    });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpenState(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const groups: Array<{ title: string | null; filtered: boolean }> = shown ? [{ title: 'All', filtered: false }, { title: `Shown: ${shown}`, filtered: true }] : [{ title: null, filtered: false }];
  return (
    <div ref={box} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen(!open)} disabled={busy !== null} aria-haspopup="menu" aria-expanded={open} title="Export the change log" className={BTN}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[#d5dbe1] bg-[#fff] p-1 shadow-xl">
          {groups.map((g) => (
            <div key={String(g.filtered)} role="group" aria-label={g.title ?? 'Export'}>
              {g.title && <div role="presentation" className={`px-2.5 pb-0.5 pt-2 text-xs font-semibold ${MUTED}`}>{g.title}</div>}
              {FORMATS.map(([fmt, name, Icon]) => (
                <button key={fmt} type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); onPick(fmt, g.filtered); }}>
                  <Icon className="h-4 w-4 text-[#586472]" aria-hidden /> {name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// the pill's look is the shared dropdown's (Person, Source, What), so the row reads as one set
const PILL = 'inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border bg-white px-3 text-xs text-slate-900 transition-colors';

/** Any time, Today, the last 7, 30 or 90 days, or two days the person picks (the later one included). */
function DateFilter({ f, set }: { f: LogFilters; set: (p: Partial<LogFilters>) => void }) {
  const input = `h-8 rounded-lg border border-[#d5dbe1] bg-[#fff] px-2 text-xs text-[#1f2933] ${FOCUS}`;
  const applied = f.when !== 'any';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className={`relative ${PILL} focus-within:ring-2 focus-within:ring-[#0f766e] ${applied ? 'border-primary-500' : 'border-slate-300 hover:border-slate-400'}`}>
        <span>{applied ? `Date · ${f.when === 'custom' ? 'Custom' : WHEN_LABEL[f.when]}` : 'Date'}</span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-700" aria-hidden />
        <select aria-label="Date" value={f.when} onChange={(e) => set({ when: e.target.value as When })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {WHENS.map((w) => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}
        </select>
      </label>
      {f.when === 'custom' && (
        <>
          <label className="inline-flex items-center gap-1 text-xs text-[#26323d]">From
            <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className={input} />
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-[#26323d]">To
            <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className={input} />
          </label>
        </>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-[#99d5cf] bg-[#f0fdfa] pl-2.5 pr-0.5 text-xs text-[#115e59]">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove the filter: ${label}`} className={`grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-[#ccfbf1] ${FOCUS}`}><X className="h-3.5 w-3.5" aria-hidden /></button>
    </span>
  );
}

const WIDE = '(min-width: 1280px)';

/** whether the screen is wide enough for the list and the details side by side */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** the sticky bar's height (day headers and the details pane stick under it) and the height of the area that scrolls */
function useStickyBar(): { ref: (el: HTMLDivElement | null) => void; bar: number; room: number } {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ bar: 0, room: 0 });
  useEffect(() => {
    if (!el) return;
    let scroller = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      const next = { bar: el.offsetHeight, room: (scroller ?? document.documentElement).clientHeight };
      setSize((p) => (p.bar === next.bar && p.room === next.room ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
  }, [el]);
  return { ref: setEl, ...size };
}

export default function ChainTab({ documentId, currentVersion, onShowInDocument, onRestore, onRead, focusVersionId }: {
  documentId: number;
  /** a version to open and scroll to once the chain is read (a link from the library tree) */
  focusVersionId?: number;
  /** editors: make a version the document again (asks first) */
  onRestore?: (v: { id: number; number: string }) => void;
  /** read an earlier version as it was, in the Document view */
  onRead?: (v: { id: number; number: string }) => void;
  currentVersion?: string | null;
  /** open the Document Viewer with the changes of one version marked (from the version before it, to it) */
  onShowInDocument: (range: { from: number; to: number }) => void;
}) {
  const { toast } = useToast();
  const search = useSearchParams();
  // the filters, split and layout come from the URL and go back into it, so a link keeps them and they survive switching views
  const [f, setF] = useState<LogFilters>(() => (search ? readQuery(search) : NO_FILTERS));
  const [text, setText] = useState(f.q);                                      // the search box, read into the filters as typing stops
  const [selected, setSelected] = useState<string | null>(null);               // wide screens: the entry in the details pane
  const [opened, setOpened] = useState<Set<string> | null>(null);             // narrow screens; null: nothing touched, the newest version is open
  const [mode, setMode] = useState<DiffMode>('redline');
  const [sort, setSort] = useState<{ by: SortKey; dir: 'asc' | 'desc' }>({ by: 'when', dir: 'desc' });
  const [filtersShown, setFiltersShown] = useState(false);                     // phones: the filters fold away under one button
  const [exporting, setExporting] = useState<{ format: ExportFormat; filtered: boolean } | null>(null);
  const [fetching, setFetching] = useState<number | null>(null);
  const wide = useWide();
  const sticky = useStickyBar();
  const q = useQuery({ queryKey: ['document-chain', documentId], queryFn: () => documentChainApi.chain(documentId), staleTime: 15_000 });
  const set = (p: Partial<LogFilters>) => setF((prev) => ({ ...prev, ...p }));

  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === text ? p : { ...p, q: text })), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    // replaceState: no new history entry and no reload. Its state stays null: Next (14.1+) then keeps its own history state and
    // follows the new URL in useSearchParams, so the page's own links (switching views) carry the filters on
    const next = writeQuery(new URLSearchParams(window.location.search), f).toString();
    if (next !== window.location.search.replace(/^\?/, '')) window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`);
  }, [f]);

  const data = q.data;
  const chain = useMemo(() => ({ versions: data?.versions ?? [], events: data?.events ?? [] }), [data]);
  const oldestFirst = chain.versions;
  const log = useMemo(() => buildLog(chain, f, new Date(), eventLabel), [chain, f]);
  const groups = useMemo(() => groupByDay(log.entries, new Date()), [log]);
  const people = useMemo(() => personIndex(chain).people, [chain]);
  const sourceOptions = useMemo(() => sourceCounts(chain), [chain]);
  const kinds = useMemo(() => whatCounts(chain), [chain]);
  const rows = useMemo(() => (f.layout === 'table' ? sortRows(tableRows(chain, log.entries, LABELS), sort.by, sort.dir) : []), [f.layout, chain, log, sort]);

  const firstVersion = log.entries.find((x) => x.type === 'version')?.key;
  const open = opened ?? new Set<string>(firstVersion ? [firstVersion] : []);
  const shown = log.entries.find((x) => x.key === selected) ?? log.entries.find((x) => x.type === 'version') ?? log.entries[0] ?? null;
  const pick = (key: string) => {
    setSelected(key);
    if (!wide) setOpened(() => { const n = new Set(open); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };
  const jumpTo = (id: number) => {
    const key = `v${id}`;
    if (!log.entries.some((x) => x.key === key)) {                             // hidden by the filters: show everything again
      setF(NO_FILTERS);
      setText('');
    } else if (f.layout !== 'timeline') set({ layout: 'timeline' });
    setSelected(key);
    setOpened(new Set(Array.from(open).concat(key)));
    setTimeout(() => document.querySelector(`[data-entry="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const focused = useRef<number | null>(null);
  useEffect(() => {
    if (!focusVersionId || focused.current === focusVersionId || !oldestFirst.some((v) => v.id === focusVersionId)) return;
    focused.current = focusVersionId;
    jumpTo(focusVersionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusVersionId, oldestFirst]);
  const download = async (format: ExportFormat, filtered: boolean) => {
    setExporting({ format, filtered });
    try {
      const { blob, filename } = await documentChainApi.exportFile(documentId, format, filtered ? exportParams(f, new Date()) : undefined);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: 'Could not export the change log', message: problemOf(e) });
    } finally {
      setExporting(null);
    }
  };
  const downloadVersion = async (v: ChainVersion) => {
    setFetching(v.id);
    try {
      const { blob, filename } = await documentChainApi.versionFile(documentId, v.id, v.file_name || data?.document?.title || 'document', v.number);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: `Could not download the file of version ${v.number}`, message: problemOf(e) });
    } finally {
      setFetching(null);
    }
  };

  if (q.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" aria-label="Loading" role="status" /></div>;
  if (q.isError || !data) return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{problemOf(q.error, 'Could not load the change log.')}</p>;
  if (!data.enabled) return <p className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4 text-[13px] text-[#26323d]">Not enabled for your organisation.</p>;
  const s = data.summary;
  const latest = currentVersion ?? data.document?.version;
  const found = data.sources.filter((x) => x.verified === true).length;
  const now = new Date();
  const e = effective(f);
  const span = dateRange(e, now);
  const filtering = filtersOn(f, now);
  const status = filtering ? `${log.entries.length} of ${plural(log.total, 'entry', 'entries')}` : plural(log.total, 'entry', 'entries');
  const nameOf = (key: string) => people.find((p) => p.key === key)?.name ?? key;
  const whenChip = f.when !== 'custom' ? WHEN_LABEL[f.when]
    : e.from && e.to ? `${dayName(e.from)} to ${dayName(e.to)}` : e.from ? `From ${dayName(e.from)}` : `Until ${dayName(e.to)}`;
  const chips = [
    ...e.people.map((p) => ({ key: `who:${p}`, label: nameOf(p), clear: () => set({ people: f.people.filter((x) => x !== p) }) })),
    ...(span.start || span.end ? [{ key: 'when', label: whenChip, clear: () => set({ when: 'any', from: '', to: '' }) }] : []),
    ...e.sources.map((x) => ({ key: `source:${x}`, label: ORIGIN_LABEL[x] ?? x, clear: () => set({ sources: f.sources.filter((y) => y !== x) }) })),
    ...e.what.map((w) => ({ key: `what:${w}`, label: WHAT_LABEL[w], clear: () => set({ what: f.what.filter((y) => y !== w) }) })),
    ...(e.q ? [{ key: 'q', label: `“${e.q}”`, clear: () => { setText(''); set({ q: '' }); } }] : []),
  ];
  const clearAll = () => {
    setText('');
    set({ people: [], when: 'any', from: '', to: '', sources: [], what: [], q: '' });
  };
  const whats = (f.split === 'activity' ? WHATS.filter((w) => w !== 'text') : WHATS).filter((w) => kinds[w] > 0 || f.what.includes(w));
  const detailOf = (en: LogEntry) => (en.type === 'version' ? (
    <VersionDetail key={en.key} entry={en} current={en.version.number === latest} mode={mode} onMode={setMode} downloading={fetching === en.version.id}
      onDownload={() => downloadVersion(en.version)} onRestore={onRestore ? () => onRestore({ id: en.version.id, number: en.version.number }) : undefined}
      onRead={onRead ? () => onRead({ id: en.version.id, number: en.version.number }) : undefined}
      onShow={() => {
        const idx = oldestFirst.findIndex((x) => x.id === en.version.id);
        const before = idx > 0 ? oldestFirst[idx - 1] : null;
        if (before) onShowInDocument({ from: before.id, to: en.version.id });
      }} />
  ) : <EventDetail key={en.key} entry={en} versionThen={versionAt(oldestFirst, en.event.at)} mode={mode} onMode={setMode} />);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <h3 className="text-[15px] font-semibold text-[#1f2933]">Change log</h3>
            <InfoTip label="About the change log"
              text="Every version from the original to now: who changed what, when and why, with the reviews and approvals in between. The next reviewer sees what each person before them changed." />
          </div>
          <ExportMenu busy={exporting} shown={filtering || f.split !== 'all' ? status : null} onPick={(fmt, filtered) => download(fmt, filtered)} />
        </div>

        <Journey versions={oldestFirst} onPick={jumpTo} />

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#e1e6eb] pt-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat icon={History} label="Versions" value={s.versions} sub={oldestFirst[0]?.at ? `since ${dateTime(oldestFirst[0].at)}` : undefined} />
          <Stat icon={GitCompare} label="Changes" value={s.changes} sub={<Words added={s.words_added} removed={s.words_removed} />} />
          <Stat icon={Sparkles} label="Comply Agent" value={s.ai_assisted} sub={s.changes ? `${Math.round((100 * s.ai_assisted) / s.changes)}%` : undefined}
            title={s.changes ? `${Math.round((100 * s.ai_assisted) / s.changes)}% of the changes were made with Comply Agent` : undefined} />
          <Stat icon={Users} label="People" value={s.people}
            sub={<People names={Array.from(new Set([...oldestFirst.map((v) => v.by), ...chain.events.map((x) => x.actor ?? '')].filter(Boolean))).sort()} />} />
          <Stat icon={BookOpenCheck} label="Sources" value={s.sources} sub={s.sources ? `${found}/${s.sources} verified` : undefined}
            title={s.sources ? `${found} of ${s.sources} quoted passages were found in their source` : undefined} />
        </div>
      </section>

      {/* the filter bar: stays at the top while the log scrolls */}
      <div ref={sticky.ref} className="sticky top-0 z-20 -mx-1 bg-[#f4f6f8] px-1 pb-2 pt-1">
        <div role="search" aria-label="Filter the change log" className="space-y-2 rounded-xl border border-[#d5dbe1] bg-[#fff] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Show" value={f.split} onChange={(split) => set({ split })} options={SPLITS} />
            {/* on a wide screen this group sits at the end of the row, on a phone it stays beside the Show switch */}
            <div className="ml-auto flex items-center gap-2 sm:order-last">
              {!wide && f.layout === 'timeline' && log.entries.length > 0 && (
                <button type="button" className={BTN_TEXT}
                  onClick={() => setOpened(open.size ? new Set() : new Set(log.entries.map((x) => x.key)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
              )}
              <p role="status" className={`text-xs ${MUTED}`}>{status}</p>
              <Segmented label="Show as" value={f.layout} onChange={(layout) => set({ layout })}
                options={[{ value: 'timeline', text: 'Timeline', icon: ListTree, iconOnly: true }, { value: 'table', text: 'Table', icon: Table2, iconOnly: true }]} />
            </div>
            <label className="relative order-last min-w-[11rem] flex-1 sm:order-none sm:max-w-[14rem]">
              <span className="sr-only">Search the change log</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7b8794]" aria-hidden />
              <input type="search" value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Search"
                className="h-8 w-full rounded-full border border-[#d5dbe1] bg-[#fff] pl-8 pr-3 text-xs text-[#1f2933] placeholder:text-[#7b8794] focus:border-[#0f766e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]" />
            </label>
            <button type="button" aria-expanded={filtersShown} aria-controls="change-log-filters" onClick={() => setFiltersShown(!filtersShown)}
              className={`order-last inline-flex h-8 items-center gap-1.5 rounded-full border border-[#d5dbe1] bg-[#fff] px-3 text-xs font-medium text-[#1f2933] sm:hidden ${FOCUS}`}>
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Filters{chips.length ? ` · ${chips.length}` : ''}
            </button>
            <div id="change-log-filters" className={`${filtersShown ? 'flex' : 'hidden'} order-last w-full flex-wrap items-center gap-2 sm:order-none sm:flex sm:w-auto`}>
              <MultiSelectDropdown title="Person" compact placeholder="Everyone" size="sm" showAvatars={false} selectedValues={f.people} onApply={(v) => set({ people: v })}
                items={people.map((p) => ({ value: p.key, label: p.name, subLabel: plural(p.count, 'entry', 'entries') }))} searchPlaceholder="Find a person" />
              <DateFilter f={f} set={set} />
              {f.split !== 'activity' && (
                <MultiSelectDropdown title="Source" compact placeholder="All" size="sm" showAvatars={false} selectedValues={f.sources} onApply={(v) => set({ sources: v })}
                  items={sourceOptions.map((o) => ({ value: o.key, label: ORIGIN_LABEL[o.key] ?? o.key,
                    subLabel: [o.changes && plural(o.changes, 'change'), o.versions && plural(o.versions, 'version')].filter(Boolean).join(', ') }))} />
              )}
              {f.split !== 'changes' && (
                <MultiSelectDropdown title="What" compact placeholder="All" size="sm" showAvatars={false} selectedValues={f.what} onApply={(v) => set({ what: v as What[] })}
                  items={whats.map((w) => ({ value: w, label: WHAT_LABEL[w], subLabel: plural(kinds[w], 'entry', 'entries') }))} />
              )}
            </div>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => <Chip key={c.key} label={c.label} onRemove={c.clear} />)}
              <button type="button" onClick={clearAll} className={BTN_TEXT}>Clear all</button>
            </div>
          )}
        </div>
      </div>

      {log.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#c3ccd5] bg-[#fff] px-4 py-8 text-center">
          <History className="h-8 w-8 text-[#7b8794]" strokeWidth={1.5} aria-hidden />
          {log.total === 0 ? (
            <>
              <p className="text-[13px] font-medium text-[#1f2933]">{f.split === 'activity' ? 'No activity yet' : 'Nothing recorded yet'}</p>
              {f.split !== 'all' && <button type="button" onClick={() => set({ split: 'all' })} className={BTN}>Show all</button>}
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-[#1f2933]">No matches</p>
              <button type="button" onClick={clearAll} className={BTN}><X className="h-4 w-4" aria-hidden /> Clear filters</button>
            </>
          )}
        </div>
      ) : f.layout === 'table' ? (
        <LogTable rows={rows} sort={sort}
          onSort={(by) => setSort((p) => ({ by, dir: p.by === by ? (p.dir === 'desc' ? 'asc' : 'desc') : by === 'when' || by === 'version' ? 'desc' : 'asc' }))} />
      ) : (
        <div className="xl:grid xl:grid-cols-12 xl:items-start xl:gap-4">
          <div className="min-w-0 space-y-3 xl:col-span-5">
            {groups.map((g) => (
              <section key={g.key} aria-label={`${g.label}: ${plural(g.entries.length, 'entry', 'entries')}`}>
                <h4 className="sticky z-10 -mx-1 bg-[#f4f6f8] px-1 py-1 text-xs font-semibold text-[#26323d]" style={{ top: sticky.bar }}>
                  {g.label} <span className="font-normal text-[#586472]">· {g.entries.length}</span>
                </h4>
                <ul className="divide-y divide-[#e1e6eb] overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff]">
                  {g.entries.map((en) => (
                    <li key={en.key}>
                      <EntryRow entry={en} current={en.type === 'version' && en.version.number === latest} selected={shown?.key === en.key} open={open.has(en.key)} wide={wide}
                        onPick={() => pick(en.key)} />
                      {!wide && open.has(en.key) && <div id={`${en.key}-detail`} className="border-t border-[#e1e6eb]">{detailOf(en)}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {wide && shown && (
            <aside key={shown.key} id="change-log-detail" aria-label="The selected entry" className="sticky col-span-7 overflow-y-auto rounded-xl border border-[#d5dbe1] bg-[#fff]"
              style={{ top: sticky.bar, maxHeight: sticky.room ? Math.max(240, sticky.room - sticky.bar - 12) : undefined }}>
              {detailOf(shown)}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
