'use client';

/**
 * Evidence Workspace — the new home of /evidence. Stat cards + a 5-way view switcher
 * (Workbench master-detail [default] · Register inline-expand · Pipeline kanban ·
 * Snapshot board · Performance) over one shared, client-filtered data source.
 * Mirrors governance documents/_workspace/DocumentsWorkspace. Upload stays in page.tsx.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutPanelLeft, Table2, KanbanSquare, PieChart, Trophy, Plus, Search,
  FileCheck, CheckCircle2, Clock, CalendarClock,
} from 'lucide-react';
import { MultiSelectDropdown, useToast } from '@/components/ui';
import EvidenceViewer, { EvidenceFile } from '@/components/evidence/EvidenceViewer';
import type { EvidenceItem } from './lib';
import { statusLabel } from './lib';
import {
  fetchSummary, fetchItems, fetchTypes, fetchExpiringSoon,
  reviewEvidence, runAssessment, submitForReview, deleteEvidence,
} from './api';
import { WorkbenchView } from './WorkbenchView';
import { RegisterView } from './RegisterView';
import { PipelineView } from './PipelineView';
import { SnapshotView } from './SnapshotView';
import { PerformanceView } from './PerformanceView';

type ViewMode = 'workbench' | 'register' | 'pipeline' | 'snapshot' | 'performance';

export interface EvidenceWorkspaceProps {
  canCreate: boolean;
  canDelete: boolean;
  onUploadClick: () => void;
}

const STATUS_OPTIONS = ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived']
  .map((s) => ({ value: s, label: statusLabel(s) }));

export function EvidenceWorkspace({ canCreate, canDelete, onUploadClick }: EvidenceWorkspaceProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [view, setView] = useState<ViewMode>('workbench');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);

  const { data: summary } = useQuery({ queryKey: ['ev-ws-summary'], queryFn: fetchSummary });
  const { data: listData, isLoading } = useQuery({
    queryKey: ['ev-ws-items'],
    queryFn: () => fetchItems({ limit: 1000 }),
    // While any freshly-uploaded item is still being OCR'd / assessed, poll so
    // its status + quality badges settle live (no manual refresh). Stops once
    // nothing is pending/processing.
    refetchInterval: (query) => {
      const rows = (query.state.data as { items?: Array<{ ocr_status?: string }> } | undefined)?.items ?? [];
      const busy = rows.some((r) => r.ocr_status === 'pending' || r.ocr_status === 'processing');
      return busy ? 3000 : false;
    },
  });
  const { data: types = [] } = useQuery({ queryKey: ['ev-ws-types'], queryFn: fetchTypes });
  const { data: expiringSoon = [] } = useQuery({ queryKey: ['ev-ws-expiring'], queryFn: () => fetchExpiringSoon(30) });

  const allItems: EvidenceItem[] = listData?.items ?? [];
  const typeOptions = useMemo(
    () => (types.length ? types : Array.from(new Set(allItems.map((i) => i.evidence_type).filter(Boolean))).map((t) => ({ value: t as string, label: (t as string).replace(/_/g, ' ') }))),
    [types, allItems]
  );

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (typeFilter && e.evidence_type !== typeFilter) return false;
      if (q) {
        const hay = `${e.name} ${e.owner_name ?? ''} ${e.uploader_name ?? ''} ${e.source_system ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, search, statusFilter, typeFilter]);

  // default the workbench selection to the first visible item
  const effectiveSelected = (selectedId != null && items.some((i) => i.id === selectedId)) ? selectedId : (items[0]?.id ?? null);

  // stat cards
  const total = summary?.total_count ?? allItems.length;
  const approvedCount = summary?.by_status?.approved ?? allItems.filter((i) => i.status === 'approved').length;
  const approvedPct = total > 0 ? Math.round((approvedCount / total) * 100) : 0;
  const pendingCount = summary?.pending_review_count ?? allItems.filter((i) => i.status === 'pending_review').length;
  const expiringCount = summary?.expiring_soon_count ?? expiringSoon.length;

  const refresh = () => ['ev-ws-summary', 'ev-ws-items', 'ev-ws-expiring'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, type: 'success' }); refresh(); }
    catch { toast({ title: 'Action failed', message: 'The backend action may be unavailable.', type: 'error' }); }
  };

  const openFull = (id: number) => router.push(`/evidence/${id}`);
  const onOpenFile = (id: number) => {
    const it = allItems.find((x) => x.id === id);
    if (it?.file_path) setPreviewFile({ evidence_id: it.id, file_path: it.file_path, file_name: it.file_name || `Evidence ${it.id}`, mime_type: (it as any).file_type ?? null, file_size: null });
    else openFull(id);
  };
  const onApprove = (id: number) => run(() => reviewEvidence(id, 'approve'), 'Approved');
  const onReassess = (id: number) => run(() => runAssessment(id), 'Re-assessment started');
  const onDelete = async (id: number) => {
    const it = allItems.find((x) => x.id === id);
    if (!window.confirm(`Delete "${it?.name ?? 'this evidence'}"? This cannot be undone.`)) return;
    try {
      const res = await deleteEvidence(id, false);
      const data = res.data as { warning?: boolean; message?: string } | undefined;
      if (data?.warning) {
        if (!window.confirm(`${data.message}\n\nDelete it anyway?`)) return;
        await deleteEvidence(id, true);
      }
      toast({ title: 'Evidence deleted', type: 'success' });
      if (selectedId === id) setSelectedId(null);
      refresh();
    } catch {
      toast({ title: 'Failed to delete evidence', message: 'Please try again.', type: 'error' });
    }
  };
  const onTransition = (id: number, action: 'submit' | 'review') => {
    if (action === 'submit') return run(() => submitForReview(id), 'Submitted for review');
    return run(() => reviewEvidence(id, 'approve'), 'Approved');
  };

  const VIEWS: { key: ViewMode; label: string; icon: typeof Table2 }[] = [
    { key: 'workbench', label: 'Workbench', icon: LayoutPanelLeft },
    { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
    { key: 'snapshot', label: 'Snapshot', icon: PieChart },
  ];

  const STATS = [
    { label: 'Total', value: total, icon: FileCheck, tint: 'bg-primary-50 text-primary-600' },
    { label: 'Approved', value: `${approvedPct}%`, icon: CheckCircle2, tint: 'bg-emerald-50 text-emerald-600' },
    { label: 'Pending', value: pendingCount, icon: Clock, tint: 'bg-amber-50 text-amber-600' },
    { label: 'Expiring', value: expiringCount, icon: CalendarClock, tint: 'bg-orange-50 text-orange-600' },
  ];

  return (
    <div className="governance-light space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="cw-card flex items-center gap-3 rounded-xl p-3">
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${s.tint}`}><Icon strokeWidth={1.75} className="h-4 w-4" /></span>
              <div>
                <div className="text-lg font-semibold text-slate-900">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search evidence…"
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          <MultiSelectDropdown title="Status" items={STATUS_OPTIONS} selectedValues={statusFilter ? [statusFilter] : []} onApply={(v) => setStatusFilter(v[0] || '')} multiSelect={false} autoApply placeholder="Status" size="md" />
          <MultiSelectDropdown title="Type" items={typeOptions} selectedValues={typeFilter ? [typeFilter] : []} onApply={(v) => setTypeFilter(v[0] || '')} multiSelect={false} autoApply placeholder="Type" size="md" />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {VIEWS.map((v) => {
              const Icon = v.icon; const active = view === v.key;
              return (
                <button key={v.key} onClick={() => setView(v.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden sm:inline">{v.label}</span>
                </button>
              );
            })}
          </div>
          {canCreate && (
            <button onClick={onUploadClick} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700">
              <Plus strokeWidth={1.75} className="h-4 w-4" /> Upload evidence
            </button>
          )}
        </div>
      </div>

      {/* Active view */}
      {view === 'workbench' && (
        <WorkbenchView items={items} selectedId={effectiveSelected} onSelect={setSelectedId} onOpenFull={openFull} onApprove={onApprove} onReassess={onReassess} onOpenFile={onOpenFile} onDelete={onDelete} canReview={canCreate} canDelete={canDelete} />
      )}
      {view === 'register' && (
        <RegisterView items={items} onOpenFull={openFull} onApprove={onApprove} onOpenFile={onOpenFile} canReview={canCreate} />
      )}
      {view === 'pipeline' && (
        <PipelineView items={items} onOpenFull={openFull} onTransition={onTransition} canReview={canCreate} />
      )}
      {view === 'snapshot' && <SnapshotView summary={summary} expiringSoon={expiringSoon} />}
      {view === 'performance' && <PerformanceView summary={summary} />}

      {isLoading && view !== 'snapshot' && view !== 'performance' && items.length === 0 && (
        <div className="cw-card rounded-xl p-8 text-center text-sm text-slate-400">Loading evidence…</div>
      )}

      <EvidenceViewer evidence={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
