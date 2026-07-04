'use client';

/**
 * Governance Documents Workspace — the new home of /governance/documents.
 * A persistent left library/hierarchy tree + an adaptive center view
 * (Tree list / Register table / Lifecycle board) + a right "Needs attention"
 * rail (shown on the Tree home). Data + scope/filter/view state live here;
 * the views are presentational. The existing create/upload/AI-draft/templates
 * modals stay in page.tsx and are opened via the callbacks passed in.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Table2, KanbanSquare, Plus, Sparkles, LayoutTemplate, Search } from 'lucide-react';
import { MultiSelectDropdown, RightSlidePanel, useToast, PageLoader } from '@/components/ui';
import { assetsApi, governanceApi } from '@/lib/api';
import type { GovDoc, GovDocNode } from './lib';
import { DOC_TYPE_STYLE, STAGE_ORDER, statusLabel } from './lib';
import {
  fetchDocuments, fetchHierarchy, fetchSummary, fetchOverdueReviews, fetchMyPending, fetchCoverageMap,
  bulkUpdateStatus, bulkArchive, bulkAssignOwner, bulkSetReviewDate, bulkPublish, signOffDocument,
} from './api';
import { LibraryTree } from './LibraryTree';
import { WorkspaceList } from './WorkspaceList';
import { RegisterTable } from './RegisterTable';
import { LifecycleBoard } from './LifecycleBoard';
import { AttentionRail } from './AttentionRail';

type ViewMode = 'tree' | 'table' | 'board';
type LibraryKey = 'all' | 'recent' | 'mine';

export interface DocumentsWorkspaceProps {
  canCreate: boolean;
  canEdit: boolean;
  currentUserId?: number | null;
  onNewDocument: () => void;
  onAIDraft: () => void;
  onTemplates: () => void;
  /** Open the pre-filled edit modal for an existing document (hosted in page.tsx). */
  onEditDocument?: (doc: GovDoc) => void;
}

const TYPE_OPTIONS = Object.keys(DOC_TYPE_STYLE).map((k) => ({ value: k, label: DOC_TYPE_STYLE[k].label }));
const STATUS_OPTIONS: { value: string; label: string }[] = [
  ...STAGE_ORDER.map((s) => ({ value: s as string, label: statusLabel(s) })),
  { value: 'expired', label: 'Expired' },
  { value: 'archived', label: 'Archived' },
];

function pluralType(t: string): string {
  const s = DOC_TYPE_STYLE[t]?.label || t;
  return s.endsWith('s') ? s : `${s}s`;
}

// ─── hierarchy helpers ───────────────────────────────────────────────────────
function findNode(nodes: GovDocNode[], id: number): GovDocNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}
function collectIds(node: GovDocNode, acc: Set<number>) {
  acc.add(node.id);
  for (const c of node.children ?? []) collectIds(c, acc);
}
function findPath(nodes: GovDocNode[], id: number, trail: GovDocNode[] = []): GovDocNode[] | null {
  for (const n of nodes) {
    const next = [...trail, n];
    if (n.id === id) return next;
    if (n.children?.length) { const f = findPath(n.children, id, next); if (f) return f; }
  }
  return null;
}

export function DocumentsWorkspace({ canCreate, canEdit, currentUserId, onNewDocument, onAIDraft, onTemplates, onEditDocument }: DocumentsWorkspaceProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [view, setView] = useState<ViewMode>('table');
  const [library, setLibrary] = useState<LibraryKey>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [ownerFilter, setOwnerFilter] = useState<string>('');

  // bulk side-panels
  const [assignOwnerFor, setAssignOwnerFor] = useState<number[] | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState<string>('');
  const [reviewDateFor, setReviewDateFor] = useState<number[] | null>(null);
  const [reviewDate, setReviewDate] = useState<string>('');

  const { data: listData, isLoading: docsLoading } = useQuery({
    queryKey: ['gov-docs-workspace'],
    queryFn: () => fetchDocuments({ limit: 1000, sort_by: 'updated_at', sort_order: 'desc' }),
  });
  const { data: hierarchy = [] } = useQuery({ queryKey: ['gov-docs-hierarchy'], queryFn: fetchHierarchy });
  const { data: summary } = useQuery({ queryKey: ['gov-docs-summary'], queryFn: fetchSummary });
  const { data: overdue } = useQuery({ queryKey: ['gov-docs-overdue'], queryFn: fetchOverdueReviews });
  const { data: myPending } = useQuery({ queryKey: ['gov-docs-mypending'], queryFn: fetchMyPending });
  const { data: coverageMap = {} } = useQuery({ queryKey: ['gov-docs-coverage'], queryFn: fetchCoverageMap });
  const { data: users = [] } = useQuery({
    queryKey: ['tenant-users-gov'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Array<{ id: number; display_name: string; email?: string }>,
    staleTime: 5 * 60 * 1000,
  });

  const allDocs: GovDoc[] = listData?.items ?? [];
  const ownerOptions = useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email })),
    [users]
  );
  const myDocsCount = useMemo(
    () => (currentUserId ? allDocs.filter((d) => d.owner_id === currentUserId).length : 0),
    [allDocs, currentUserId]
  );

  const refreshAll = () => {
    ['gov-docs-workspace', 'gov-docs-hierarchy', 'gov-docs-summary', 'gov-docs-overdue', 'gov-docs-mypending', 'gov-docs-coverage']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  // ── scope: tree selection OR library shortcut ──
  const scopedDocs = useMemo(() => {
    if (selectedNodeId != null) {
      const node = findNode(hierarchy, selectedNodeId);
      if (node) { const ids = new Set<number>(); collectIds(node, ids); return allDocs.filter((d) => ids.has(d.id)); }
    }
    if (library === 'mine') return currentUserId ? allDocs.filter((d) => d.owner_id === currentUserId) : [];
    return allDocs;
  }, [allDocs, hierarchy, selectedNodeId, library, currentUserId]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = scopedDocs.filter((d) => {
      if (typeFilter && d.doc_type !== typeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (ownerFilter && String(d.owner_id ?? '') !== ownerFilter) return false;
      if (q) {
        const hay = `${d.title} ${d.document_code ?? ''} ${d.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (library === 'recent' && selectedNodeId == null) {
      out = [...out].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }
    return out;
  }, [scopedDocs, typeFilter, statusFilter, ownerFilter, search, library, selectedNodeId]);

  // list (tree view) sorted by review date (overdue first, nulls last)
  const listSorted = useMemo(() => {
    const val = (d: GovDoc) => (d.next_review_date ? new Date(d.next_review_date).getTime() : Number.POSITIVE_INFINITY);
    return [...filteredDocs].sort((a, b) => val(a) - val(b));
  }, [filteredDocs]);

  const headerDoc = selectedNodeId != null ? allDocs.find((d) => d.id === selectedNodeId) ?? null : null;
  const breadcrumb = useMemo(() => {
    if (selectedNodeId == null) return ['All documents'];
    const path = findPath(hierarchy, selectedNodeId);
    if (!path || path.length === 0) return ['All documents'];
    return [pluralType(path[0].doc_type), ...path.map((n) => n.title)];
  }, [hierarchy, selectedNodeId]);

  const attestationGaps = useMemo(
    () =>
      allDocs
        .filter((d) => coverageMap[d.id] != null && coverageMap[d.id] < 90)
        .map((d) => ({ id: d.id, title: d.title, pct: coverageMap[d.id] }))
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 6),
    [allDocs, coverageMap]
  );

  // ── handlers ──
  const openDoc = (id: number) => router.push(`/governance/documents/${id}`);
  const selectLibrary = (key: LibraryKey) => { setLibrary(key); setSelectedNodeId(null); };
  const selectNode = (id: number | null) => { setSelectedNodeId(id); if (id != null) setLibrary('all'); };

  const runBulk = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, type: 'success' }); refreshAll(); }
    catch { toast({ title: 'Action failed', message: 'The backend endpoint may not be available yet.', type: 'error' }); }
  };
  const onBulkApprove = (ids: number[]) => runBulk(() => bulkUpdateStatus(ids, 'approved'), `${ids.length} approved`);
  const onBulkPublish = (ids: number[]) => runBulk(() => bulkPublish(ids), `Publish requested for ${ids.length}`);
  const onBulkArchive = (ids: number[]) => runBulk(() => bulkArchive(ids), `${ids.length} archived`);

  const doAssignOwner = async () => {
    if (!assignOwnerFor || !assignOwnerId) return;
    await runBulk(() => bulkAssignOwner(assignOwnerFor, Number(assignOwnerId)), 'Owner assigned');
    setAssignOwnerFor(null); setAssignOwnerId('');
  };
  const doSetReviewDate = async () => {
    if (!reviewDateFor || !reviewDate) return;
    await runBulk(() => bulkSetReviewDate(reviewDateFor, new Date(reviewDate).toISOString()), 'Review date set');
    setReviewDateFor(null); setReviewDate('');
  };

  const onApproveFromRail = (docId: number) => runBulk(() => signOffDocument(docId), 'Signed off');

  // ── register row actions ──
  const onEditDoc = (doc: GovDoc) => (onEditDocument ? onEditDocument(doc) : openDoc(doc.id));
  const triggerDownload = (data: BlobPart, fileName: string) => {
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const onDownloadDoc = async (doc: GovDoc) => {
    const pdfName = `${(doc.title || 'document').replace(/[^\w.\- ]+/g, '_').trim() || 'document'}.pdf`;
    try {
      // /export serves the uploaded file when present, else a PDF of the markdown
      // content — so every document (incl. content-only AI drafts) is downloadable.
      const res = await governanceApi.exportDocument(doc.id);
      triggerDownload(res.data as BlobPart, doc.has_file && doc.file_name ? doc.file_name : pdfName);
    } catch {
      // Fallback (e.g. /export not live yet) — file-backed docs still work via download-file.
      if (doc.has_file) {
        try {
          const r = await governanceApi.downloadDocumentFile(doc.id);
          triggerDownload(r.data as BlobPart, doc.file_name || `document-${doc.id}`);
          return;
        } catch { /* fall through to error toast */ }
      }
      toast({ title: 'Download failed', message: 'Could not export this document.', type: 'error' });
    }
  };
  const onDeleteDoc = async (doc: GovDoc) => {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try { await governanceApi.deleteDocument(doc.id); toast({ title: 'Document deleted', type: 'success' }); refreshAll(); }
    catch { toast({ title: 'Delete failed', type: 'error' }); }
  };

  // ── toolbar bits ──
  const VIEWS: { key: ViewMode; label: string; icon: typeof FolderTree }[] = [
    { key: 'tree', label: 'Tree', icon: FolderTree },
    { key: 'table', label: 'Table', icon: Table2 },
    { key: 'board', label: 'Board', icon: KanbanSquare },
  ];

  const updatedLabel = useMemo(() => {
    const latest = allDocs.reduce((m, d) => (d.updated_at > m ? d.updated_at : m), '');
    if (!latest) return 'up to date';
    const mins = Math.round((Date.now() - new Date(latest).getTime()) / 60000);
    if (mins < 1) return 'updated just now';
    if (mins < 60) return `updated ${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `updated ${hrs}h ago`;
    return `updated ${Math.round(hrs / 24)}d ago`;
  }, [allDocs]);

  return (
    <div className="governance-light space-y-4">
      {/* Toolbar — ALWAYS a single row. Search flexes with the screen; filters and
          actions stay put (shrink-0). On very narrow screens the row scrolls
          horizontally rather than wrapping. Secondary buttons collapse to icons. */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <div className="relative w-40 shrink-0 sm:w-52 xl:w-72">
          <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, code, owner or control…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="shrink-0">
          <MultiSelectDropdown title="Type" items={TYPE_OPTIONS} selectedValues={typeFilter ? [typeFilter] : []} onApply={(v) => setTypeFilter(v[0] || '')} multiSelect={false} autoApply placeholder="Type: All" size="md" />
        </div>
        <div className="shrink-0">
          <MultiSelectDropdown title="Status" items={STATUS_OPTIONS} selectedValues={statusFilter ? [statusFilter] : []} onApply={(v) => setStatusFilter(v[0] || '')} multiSelect={false} autoApply placeholder="Status: All" size="md" />
        </div>
        <div className="shrink-0">
          <MultiSelectDropdown title="Owner" items={ownerOptions} selectedValues={ownerFilter ? [ownerFilter] : []} onApply={(v) => setOwnerFilter(v[0] || '')} multiSelect={false} autoApply forceSearch placeholder="Owner: All" size="md" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const active = view === v.key;
              return (
                <button key={v.key} onClick={() => setView(v.key)} title={v.label}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden sm:inline">{v.label}</span>
                </button>
              );
            })}
          </div>
          {canCreate && (
            <>
              <button onClick={onTemplates} title="Templates" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <LayoutTemplate strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden xl:inline">Templates</span>
              </button>
              <button onClick={onAIDraft} title="AI Draft" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Sparkles strokeWidth={1.75} className="h-4 w-4 text-primary-600" /> <span className="hidden xl:inline">AI Draft</span>
              </button>
              <button onClick={onNewDocument} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700">
                <Plus strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden sm:inline">New Document</span><span className="sm:hidden">New</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Adaptive layout: Tree = 3-pane workspace (tree · list · attention rail);
          Table/Board = full-width to match the dense-register / pipeline frames. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {view === 'tree' && (
          <aside className="lg:col-span-3">
            <LibraryTree
              summary={summary}
              hierarchy={hierarchy}
              myDocsCount={myDocsCount}
              activeLibrary={library}
              onSelectLibrary={selectLibrary}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectNode}
              loading={docsLoading}
            />
          </aside>
        )}

        <section className={view === 'tree' ? 'lg:col-span-6' : 'lg:col-span-12'}>
          {docsLoading ? (
            <div className="card"><PageLoader className="h-96" /></div>
          ) : view === 'tree' ? (
            <WorkspaceList docs={listSorted} headerDoc={headerDoc} breadcrumb={breadcrumb} onOpenDoc={openDoc} />
          ) : view === 'table' ? (
            <RegisterTable
              docs={filteredDocs}
              totalCount={summary?.total_documents ?? allDocs.length}
              updatedLabel={updatedLabel}
              onOpenDoc={openDoc}
              onEdit={onEditDoc}
              onDownload={onDownloadDoc}
              onDelete={onDeleteDoc}
              onBulkApprove={onBulkApprove}
              onBulkPublish={onBulkPublish}
              onBulkArchive={onBulkArchive}
              onBulkAssignOwner={(ids) => setAssignOwnerFor(ids)}
              onBulkSetReviewDate={(ids) => setReviewDateFor(ids)}
              canEdit={canEdit}
              canDelete={canEdit}
            />
          ) : (
            <LifecycleBoard docs={filteredDocs} onOpenDoc={openDoc} />
          )}
        </section>

        {view === 'tree' && (
          <aside className="lg:col-span-3">
            <div className="lg:sticky lg:top-4">
              <AttentionRail
                overdue={overdue ?? { count: 0, documents: [] }}
                myPending={myPending ?? { total: 0, items: [] }}
                attestationGaps={attestationGaps}
                onOpenDoc={openDoc}
                onApprove={onApproveFromRail}
                onReview={openDoc}
                onAIDraft={onAIDraft}
                onTemplates={onTemplates}
              />
            </div>
          </aside>
        )}
      </div>

      {/* Bulk: assign owner */}
      <RightSlidePanel isOpen={assignOwnerFor != null} onClose={() => setAssignOwnerFor(null)} title={`Assign owner · ${assignOwnerFor?.length ?? 0} documents`}>
        <div className="space-y-4 p-1">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">New owner</label>
            <MultiSelectDropdown title="Owner" items={ownerOptions} selectedValues={assignOwnerId ? [assignOwnerId] : []} onApply={(v) => setAssignOwnerId(v[0] || '')} multiSelect={false} autoApply forceSearch triggerVariant="input" placeholder="Select a user" size="md" triggerClassName="w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setAssignOwnerFor(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={doAssignOwner} disabled={!assignOwnerId} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">Assign owner</button>
          </div>
        </div>
      </RightSlidePanel>

      {/* Bulk: set review date */}
      <RightSlidePanel isOpen={reviewDateFor != null} onClose={() => setReviewDateFor(null)} title={`Set review date · ${reviewDateFor?.length ?? 0} documents`}>
        <div className="space-y-4 p-1">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Next review date</label>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setReviewDateFor(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={doSetReviewDate} disabled={!reviewDate} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">Set date</button>
          </div>
        </div>
      </RightSlidePanel>
    </div>
  );
}
