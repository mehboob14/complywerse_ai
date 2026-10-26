'use client';

/**
 * Register TABLE of the Governance Documents workspace, built on the shipped DataTable<GovDoc>. Columns: Title · Type · Lifecycle ·
 * Owner · Department · Frameworks · Ver · Actions. Every document has an arrow before its title: opened, it shows every version of the document
 * (each major version with its minor versions under it, newest major first; each opens the document on that version) and the
 * documents under it (parent_document_id) as rows of the same table, one level in, which open the same way. The shell owns
 * filtering/data + action handlers.
 */

import { useMemo, useState } from 'react';
import {
  Send, UserPlus, CalendarClock, Archive, ArchiveRestore, FileText, Eye, Download, Pencil,
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import {
  DataTable,
  type ColumnDef,
  type BulkAction,
} from '@/components/ui';
import {
  type GovDoc,
  TypePill,
  LifecycleDots,
  OwnerChip,
  FrameworkPills,
  AttestCell,
  useFrameworkNames,
  useDepartmentNames,
  inForceNote,
  statusLabel,
  verLabel,
} from './lib';
import { LifecycleHover } from './LifecycleHover';
import { RowActionsMenu } from './RowActionsMenu';
import { bulkActionIds } from './archive';
import { NOTHING_OPEN, buildTree, collapseAll, expandAll, flip, openness, treeEntries, type Fold } from './docTree';
import { shownFrameworkIds } from './library';
import { GAP, STEP, Versions } from './Versions';

export interface RegisterTableProps {
  /** the documents that match the search and filters */
  docs: GovDoc[];
  /** every document the list is drawn from (archived ones only when asked for): the documents above a match come from here */
  scope: GovDoc[];
  /** a search or filter is on: the way to every match is open, the documents above it greyed */
  filtering?: boolean;
  totalCount: number;
  updatedLabel?: string;
  coverageMap?: Record<number, number>;
  onOpenDoc: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  /** documents are archived, never deleted */
  onArchive: (doc: GovDoc) => void;
  onBulkPublish: (ids: number[]) => void;
  onBulkArchive: (ids: number[]) => void;
  onBulkAssignOwner: (ids: number[]) => void;
  onBulkSetReviewDate: (ids: number[]) => void;
  canEdit?: boolean;
  /** per row: the owner and the author may change or archive their own document without the role permission */
  canEditRow?: (d: GovDoc) => boolean;
  canArchiveRow?: (d: GovDoc) => boolean;
  /** an archived document back as a draft, for the people who may change it */
  onRestore?: (doc: GovDoc) => void;
  canRestoreRow?: (d: GovDoc) => boolean;
  /** the list shows the archived documents: its bulk bar offers Restore only */
  showingArchived?: boolean;
  onBulkRestore?: (ids: number[]) => void;
  loading?: boolean;
}

const NO_DOCS: GovDoc[] = [];
const NONE = new Set<number>();
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white px-2.5 py-1 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
type Open = 'all' | 'docs' | null;
function TitleCell({ doc, depth, match, childCount, open, parentTitle, onToggle }: {
  doc: GovDoc; depth: number; match: boolean; childCount: number; open: Open; parentTitle?: string; onToggle: () => void;
}) {
  const label = open === 'docs' ? `Hide the documents under ${doc.title}`
    : `${open ? 'Hide' : 'Show'} the versions of ${doc.title}${childCount ? ' and the documents under it' : ''}`;
  return (
    <div className="flex items-start" style={{ paddingLeft: depth * STEP, gap: GAP }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-expanded={open != null}
        aria-label={label}
        title={label}
        className="-my-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      >
        {open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
      </button>
      <span className="relative min-w-0">
        <span className={match ? 'font-medium text-slate-900' : 'text-[#586472]'}>{doc.title}</span>
        {/* the indent shows the nesting to the eye; this says it to a screen reader */}
        {parentTitle && <span className="sr-only">, under {parentTitle}</span>}
        {!open && childCount > 0 && <span className="ml-1.5 whitespace-nowrap text-[11px] text-[#586472]">{childCount} under it</span>}
        {!match && <span className="block text-[11px] text-[#586472]">Parent of a match</span>}
      </span>
    </div>
  );
}

export function RegisterTable({
  docs,
  scope,
  filtering = false,
  totalCount,
  updatedLabel,
  coverageMap = {},
  onOpenDoc,
  onEdit,
  onDownload,
  onArchive,
  onBulkPublish,
  onBulkArchive,
  onBulkAssignOwner,
  onBulkSetReviewDate,
  canEdit = false,
  canEditRow,
  canArchiveRow,
  onRestore,
  canRestoreRow,
  showingArchived = false,
  onBulkRestore,
  loading = false,
}: RegisterTableProps) {
  const nameMap = useFrameworkNames();
  const departmentName = useDepartmentNames();
  const rows = docs ?? [];

  // each document under its parent; with a search or filter, the matches and the documents above them (docTree.ts)
  const roots = useMemo(() => buildTree(scope, new Set(rows.map((d) => d.id))), [scope, rows]);
  const entries = useMemo(() => treeEntries(roots), [roots]);
  const at = useMemo(() => new Map(entries.map((e) => [e.doc.id, e])), [entries]);
  const top = useMemo(() => roots.map((n) => n.doc), [roots]);
  const parents = entries.filter((e) => e.children.length > 0).map((e) => e.doc.id);
  const context = entries.filter((e) => !e.match).length;

  // what the person closed belongs to one set of matches: a new search or filter opens the way to every match again
  const matchKey = useMemo(() => rows.map((d) => d.id).join(','), [rows]);
  const [state, setState] = useState<{ key: string; fold: Fold }>({ key: '', fold: NOTHING_OPEN });
  const current = (s: typeof state): Fold => (s.key === matchKey ? s.fold : { ...s.fold, shut: NONE });
  const fold = current(state);
  const change = (next: (f: Fold) => Fold) => setState((s) => ({ key: matchKey, fold: next(current(s)) }));
  const openIn = (f: Fold, id: number): Open => openness(f, id, (at.get(id)?.children.length ?? 0) > 0, filtering);
  const openOf = (id: number) => openIn(fold, id);
  const anyOpen = entries.some((e) => openOf(e.doc.id) != null);

  const columns: ColumnDef<GovDoc>[] = [
    {
      id: 'title',
      header: 'Title',
      accessor: 'title',
      sortable: true,
      minWidth: '280px',
      render: (d) => {
        const e = at.get(d.id);
        const open = openOf(d.id);
        return (
          <TitleCell doc={d} depth={e?.depth ?? 0} match={e?.match ?? true} childCount={e?.children.length ?? 0} open={open}
            parentTitle={e && e.depth > 0 && d.parent_document_id != null ? at.get(d.parent_document_id)?.doc.title : undefined}
            onToggle={() => change((f) => flip(f, d.id, openIn(f, d.id) != null))} />
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessor: 'doc_type',
      minWidth: '110px',
      render: (d) => <TypePill docType={d.doc_type} />,
    },
    {
      id: 'lifecycle',
      header: 'Lifecycle',
      accessor: 'status',
      minWidth: '190px',
      render: (d) => <LifecycleHover doc={d} focusable><LifecycleDots status={d.status} /></LifecycleHover>,
    },
    {
      id: 'owner',
      header: 'Owner',
      accessor: 'owner_name',
      minWidth: '150px',
      render: (d) => <OwnerChip name={d.owner_name} />,
    },
    {
      id: 'department',
      header: 'Department',
      // the NAME, so sorting and the CSV export carry what the table shows, not the id; an id the list does not know shows a dash
      accessor: (d) => (d.department_id != null ? departmentName[String(d.department_id)] : undefined) || '—',
      sortable: true,
      minWidth: '130px',
    },
    {
      id: 'frameworks',
      header: 'Frameworks',
      minWidth: '150px',
      render: (d) => (
        <FrameworkPills
          ids={shownFrameworkIds(d)}
          nameMap={nameMap}
          max={3}
        />
      ),
    },
    {
      id: 'attest',
      header: 'Attestation %',
      minWidth: '110px',
      render: (d) => <AttestCell pct={coverageMap[d.id] ?? null} />,
    },
    {
      id: 'ver',
      header: 'Ver',
      minWidth: '60px',
      render: (d) => (
        <span className="text-sm text-slate-600">
          {d.current_version || '—'}
          {inForceNote(d) && <span className="block text-[11px] text-[#586472]">{inForceNote(d)}</span>}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '90px',
      render: (d) => (
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            actions={[
              { key: 'open', label: 'Open', icon: Eye, onClick: () => onOpenDoc(d.id) },
              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(d), hidden: !(canEditRow ? canEditRow(d) : canEdit) },
              { key: 'download', label: 'Download', icon: Download, onClick: () => onDownload(d) },
              { key: 'archive', label: 'Archive', icon: Archive, onClick: () => onArchive(d), variant: 'danger', hidden: !(canArchiveRow ? canArchiveRow(d) : canEdit) },
              { key: 'restore', label: 'Restore', icon: ArchiveRestore, onClick: () => onRestore?.(d), hidden: !(onRestore && canRestoreRow?.(d)) },
            ]}
          />
        </div>
      ),
    },
  ];

  const ids = (selected: GovDoc[]) => selected.map((d) => d.id);

  // the rows get tick boxes only when the bulk bar has something for this person to do; no Approve: a document is approved by its
  // approvers signing it in its review (the server refuses a bulk approval), and Publish publishes only approved documents
  const offered = new Set(bulkActionIds(showingArchived));
  const bulkActions: BulkAction<GovDoc>[] = canEdit
    ? ([
        { id: 'publish', label: 'Publish', icon: Send, onClick: (r) => onBulkPublish(ids(r)) },
        { id: 'assign-owner', label: 'Assign owner', icon: UserPlus, onClick: (r) => onBulkAssignOwner(ids(r)) },
        { id: 'set-review', label: 'Set review date', icon: CalendarClock, onClick: (r) => onBulkSetReviewDate(ids(r)) },
        { id: 'archive', label: 'Archive', icon: Archive, variant: 'danger', onClick: (r) => onBulkArchive(ids(r)) },
        { id: 'restore', label: 'Restore', icon: ArchiveRestore, onClick: (r) => onBulkRestore?.(ids(r)) },
      ] as BulkAction<GovDoc>[]).filter((a) => offered.has(a.id) && (a.id !== 'restore' || !!onBulkRestore))
    : [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Document Register</h2>
          <p className="text-sm text-slate-500">
            {rows.length} shown · {totalCount} total
            {context > 0 ? ` · ${context} shown as parents` : ''}
            {updatedLabel ? ` · ${updatedLabel}` : ''}
          </p>
        </div>
        {(parents.length > 0 || anyOpen) && (
          <div className="flex shrink-0 items-center gap-2">
            {/* the documents under every document; a document's versions open with its own arrow (each is read when it opens) */}
            <button type="button" className={BTN} onClick={() => change(expandAll)}
              disabled={parents.every((id) => openOf(id) != null)} title="Show every document under its parent">
              <ChevronsUpDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Expand all
            </button>
            <button type="button" className={BTN} onClick={() => change(() => collapseAll(parents))} disabled={!anyOpen}>
              <ChevronsDownUp className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Collapse all
            </button>
          </div>
        )}
      </div>

      <DataTable<GovDoc>
        data={top}
        subRows={(d) => at.get(d.id)?.children ?? NO_DOCS}
        showSubRows={(d) => openOf(d.id) != null}
        renderUnder={(d) => (openOf(d.id) === 'all' ? <Versions doc={d} depth={at.get(d.id)?.depth ?? 0} /> : null)}
        isContext={(d) => at.get(d.id)?.match === false}
        columns={columns}
        loading={loading}
        selectable={bulkActions.length > 0}
        bulkActions={bulkActions}
        bulkBarVariant="dark"
        exportable
        exportFilename="document-register"
        searchable={false}
        pageSize={15}
        stickyHeader
        onRowClick={(d) => onOpenDoc(d.id)}
        emptyMessage="No documents match the current filters."
        emptyIcon={FileText}
      />
    </section>
  );
}

export default RegisterTable;
