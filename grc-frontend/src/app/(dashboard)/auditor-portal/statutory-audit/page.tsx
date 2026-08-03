'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Eye, Trash2, ScrollText, Sparkles, Loader2, Check, X,
  AlertCircle, Search,
} from 'lucide-react';
import { statutoryAuditApi } from '@/lib/api';
import {
  MultiSelectDropdown, AnimatedModal, PageLoader, DataTable,
  RightSlidePanel, type ColumnDef,
} from '@/components/ui';
import { RowActionsMenu } from '@/app/(dashboard)/governance/documents/_workspace/RowActionsMenu';
import {
  StatusBadge, PriorityBadge, STATUS_LABEL, TYPE_LABEL,
  PRIORITY_OPTIONS, TYPE_OPTIONS, STATUS_OPTIONS, fmtDate,
  fieldClass, labelClass, helperClass, btnPrimary, btnPrimaryLg, btnSecondary, btnSecondaryLg,
  formatApiError, StepLabel, CategoryField,
  FileDropzone, AI_IMPORT_ACCEPT, validateAiImportFile,
} from './_ui';

type ObsRow = {
  id: number;
  code?: string;
  title: string;
  status: string;
  priority: string;
  observation_type?: string;
  regulator_source?: string;
  regulation_reference?: string;
  audit_period?: string;
  category?: string;
  due_date?: string;
  evidence_count?: number;
};

type DraftRow = {
  title: string;
  description?: string;
  observation_type: string;
  regulator_source?: string;
  regulation_reference?: string;
  priority: string;
  audit_period?: string;
  due_date?: string | null;
  area_domain?: string;
  category?: string;
  selected: boolean;
};

export default function StatutoryAuditListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ObsRow | null>(null);

  const { data: meta } = useQuery({
    queryKey: ['statutory-audit-meta'],
    queryFn: async () => (await statutoryAuditApi.meta()).data as {
      regulator_sources?: string[];
      audit_periods?: string[];
      categories?: string[];
      counts_by_status?: Record<string, number>;
    },
  });

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['statutory-audit-obs', statusFilter, priorityFilter, sourceFilter, periodFilter, categoryFilter, search],
    queryFn: async () =>
      (await statutoryAuditApi.list({
        search: search || undefined,
        status_filter: statusFilter || undefined,
        priority: priorityFilter || undefined,
        regulator_source: sourceFilter || undefined,
        audit_period: periodFilter || undefined,
        category: categoryFilter || undefined,
      })).data as { items: ObsRow[]; total: number },
    placeholderData: keepPreviousData,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => statutoryAuditApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
      setDeleteTarget(null);
    },
  });

  const rowsRaw = data?.items || [];
  const total = data?.total ?? 0;
  const sourceItems = useMemo(
    () => (meta?.regulator_sources || []).map((s: string) => ({ value: s, label: s })),
    [meta],
  );
  const periodItems = useMemo(
    () => (meta?.audit_periods || []).map((s: string) => ({ value: s, label: s })),
    [meta],
  );
  const categorySuggestions = meta?.categories || [];
  const categoryItems = useMemo(
    () => categorySuggestions.map((s) => ({ value: s, label: s })),
    [categorySuggestions],
  );

  const rows = useMemo(() => {
    if (!groupByCategory) return rowsRaw;
    return [...rowsRaw].sort((a, b) => {
      const ca = (a.category || 'zzz').toLowerCase();
      const cb = (b.category || 'zzz').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [rowsRaw, groupByCategory]);

  const openRow = (id: number) => router.push(`/auditor-portal/statutory-audit/${id}`);

  const columns: ColumnDef<ObsRow>[] = useMemo(
    () => [
      {
        id: 'code',
        header: 'Code',
        accessor: 'code',
        minWidth: '100px',
        render: (o) => (
          <span className="font-mono text-xs text-slate-500">{o.code || '—'}</span>
        ),
      },
      {
        id: 'title',
        header: 'Observation',
        accessor: 'title',
        sortable: true,
        minWidth: '260px',
        render: (o) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{o.title}</div>
            <div className="truncate text-xs text-slate-500">
              {TYPE_LABEL[o.observation_type || ''] || o.observation_type || '—'}
              {o.regulation_reference ? ` · ${o.regulation_reference}` : ''}
            </div>
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        accessor: 'category',
        minWidth: '130px',
        render: (o) =>
          o.category ? (
            <span className="inline-flex max-w-[140px] truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
              {o.category}
            </span>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: 'status',
        minWidth: '110px',
        render: (o) => <StatusBadge status={o.status} />,
      },
      {
        id: 'priority',
        header: 'Priority',
        accessor: 'priority',
        minWidth: '100px',
        render: (o) => <PriorityBadge priority={o.priority} />,
      },
      {
        id: 'regulator',
        header: 'Regulator',
        accessor: 'regulator_source',
        minWidth: '120px',
        render: (o) => <span className="text-sm text-slate-600">{o.regulator_source || '—'}</span>,
      },
      {
        id: 'period',
        header: 'Period',
        accessor: 'audit_period',
        minWidth: '100px',
        render: (o) => <span className="text-sm text-slate-600">{o.audit_period || '—'}</span>,
      },
      {
        id: 'due',
        header: 'Due',
        accessor: 'due_date',
        minWidth: '100px',
        render: (o) => <span className="text-sm text-slate-600">{fmtDate(o.due_date)}</span>,
      },
      {
        id: 'evidence',
        header: 'Evidence',
        minWidth: '80px',
        render: (o) => (
          <span className="tabular-nums text-sm text-slate-700">{o.evidence_count ?? 0}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        minWidth: '80px',
        render: (o) => (
          <div onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu
              actions={[
                { key: 'open', label: 'Open', icon: Eye, onClick: () => openRow(o.id) },
                {
                  key: 'delete',
                  label: 'Delete',
                  icon: Trash2,
                  variant: 'danger',
                  onClick: () => setDeleteTarget(o),
                },
              ]}
            />
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (isLoading && !data) return <PageLoader className="h-64" />;
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">
        Could not load audit observations. Please try again.
      </div>
    );
  }

  const statusCounts = meta?.counts_by_status || {};

  return (
    <div className="governance-light space-y-4">
      {/* Toolbar — single dense row matching Documents */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <div className="relative w-40 shrink-0 sm:w-52 xl:w-72">
          <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, code, regulator…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="shrink-0">
          <MultiSelectDropdown
            title="Status"
            items={STATUS_OPTIONS}
            selectedValues={statusFilter ? [statusFilter] : []}
            onApply={(v) => setStatusFilter(v[0] || '')}
            multiSelect={false}
            autoApply
            placeholder="All"
            size="md"
          />
        </div>
        <div className="shrink-0">
          <MultiSelectDropdown
            title="Priority"
            items={PRIORITY_OPTIONS}
            selectedValues={priorityFilter ? [priorityFilter] : []}
            onApply={(v) => setPriorityFilter(v[0] || '')}
            multiSelect={false}
            autoApply
            placeholder="All"
            size="md"
          />
        </div>
        {sourceItems.length > 0 && (
          <div className="shrink-0">
            <MultiSelectDropdown
              title="Regulator"
              items={sourceItems}
              selectedValues={sourceFilter ? [sourceFilter] : []}
              onApply={(v) => setSourceFilter(v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All"
              size="md"
            />
          </div>
        )}
        {periodItems.length > 0 && (
          <div className="shrink-0">
            <MultiSelectDropdown
              title="Period"
              items={periodItems}
              selectedValues={periodFilter ? [periodFilter] : []}
              onApply={(v) => setPeriodFilter(v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All"
              size="md"
            />
          </div>
        )}
        {categoryItems.length > 0 && (
          <div className="shrink-0">
            <MultiSelectDropdown
              title="Category"
              items={categoryItems}
              selectedValues={categoryFilter ? [categoryFilter] : []}
              onApply={(v) => setCategoryFilter(v[0] || '')}
              multiSelect={false}
              autoApply
              forceSearch
              placeholder="All"
              size="md"
            />
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setGroupByCategory((g) => !g)}
            title="Group by category"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              groupByCategory
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Group
          </button>
          <button
            onClick={() => setShowImport(true)}
            title="Import with AI"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Sparkles strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
            <span className="hidden xl:inline">Import with AI</span>
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus strokeWidth={1.75} className="h-4 w-4" />
            <span className="hidden sm:inline">New observation</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'open', 'in_progress', 'complied', 'closed'] as const).map((s) => {
          const count = s === 'all' ? total : statusCounts[s] || 0;
          const active = s === 'all' ? !statusFilter : statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === 'all' ? '' : s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-primary-300 bg-primary-50 text-primary-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]} ({count})
            </button>
          );
        })}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Observation register</h2>
            <p className="text-sm text-slate-500">
              {rows.length} shown · {total} total
              {isFetching && !isLoading ? ' · updating…' : ''}
            </p>
          </div>
        </div>

        <DataTable<ObsRow>
          data={rows}
          columns={columns}
          loading={isLoading && !data}
          searchable={false}
          pageSize={15}
          stickyHeader
          onRowClick={(o) => openRow(o.id)}
          emptyMessage="No observations match the current filters. Try clearing filters, or add one manually / import with AI."
          emptyIcon={ScrollText}
          exportable
          exportFilename="statutory-audit-observations"
        />
      </section>

      {showCreate && (
        <CreatePanel
          onClose={() => setShowCreate(false)}
          categorySuggestions={categorySuggestions}
        />
      )}
      {showImport && (
        <ImportPanel
          onClose={() => setShowImport(false)}
          categorySuggestions={categorySuggestions}
        />
      )}

      <AnimatedModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete observation?"
        subtitle={deleteTarget ? `${deleteTarget.code || ''} ${deleteTarget.title}`.trim() : undefined}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} className={btnSecondaryLg}>
              Keep it
            </button>
            <button
              type="button"
              disabled={deleteMut.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete permanently
            </button>
          </div>
        }
      >
        <div className="px-5 py-4 text-sm text-slate-600">
          This removes the observation and its links. Evidence files in the library are not deleted. This cannot be undone.
        </div>
      </AnimatedModal>
    </div>
  );
}

function CreatePanel({
  onClose,
  categorySuggestions,
}: {
  onClose: () => void;
  categorySuggestions: string[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    description: '',
    observation_type: 'requirement',
    regulator_source: '',
    regulation_reference: '',
    priority: 'medium',
    audit_period: '',
    due_date: '',
    area_domain: '',
    category: '',
  });
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      statutoryAuditApi.create({
        ...form,
        due_date: form.due_date || null,
        regulator_source: form.regulator_source || null,
        regulation_reference: form.regulation_reference || null,
        audit_period: form.audit_period || null,
        area_domain: form.area_domain || null,
        category: form.category.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
      onClose();
    },
    onError: (e: unknown) => setError(formatApiError(e, 'Could not create observation')),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="New observation"
      subtitle="Register a regulator requirement, finding, or audit observation"
      width="w-full max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondaryLg}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-obs-form"
            disabled={!form.title.trim() || mut.isPending}
            className={btnPrimaryLg}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create observation
          </button>
        </div>
      }
    >
      <form
        id="create-obs-form"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim()) mut.mutate();
        }}
      >
        <section>
          <StepLabel n={1} label="What is this about?" />
          <div className="space-y-3">
            <div>
              <label className={labelClass}>
                Title <span className="text-rose-500">*</span>
              </label>
              <input
                autoFocus
                className={fieldClass}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Strengthen AML transaction monitoring thresholds"
              />
            </div>
            <div>
              <label className={labelClass}>
                Description <span className="text-xs font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                className={fieldClass}
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Summarise the requirement or finding in plain language"
              />
            </div>
            <CategoryField
              value={form.category}
              onChange={(v) => set('category', v)}
              suggestions={categorySuggestions}
              id="create-obs-category"
            />
          </div>
        </section>

        <section>
          <StepLabel n={2} label="Classify it" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Type</label>
              <select className={fieldClass} value={form.observation_type} onChange={(e) => set('observation_type', e.target.value)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select className={fieldClass} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Area / domain</label>
              <input
                className={fieldClass}
                value={form.area_domain}
                onChange={(e) => set('area_domain', e.target.value)}
                placeholder="e.g. AML, IT, Credit"
              />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input type="date" className={fieldClass} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
          </div>
        </section>

        <section>
          <StepLabel n={3} label="Regulator details" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Regulator / source</label>
              <input
                className={fieldClass}
                value={form.regulator_source}
                onChange={(e) => set('regulator_source', e.target.value)}
                placeholder="SBP, SAMA, External auditor…"
              />
            </div>
            <div>
              <label className={labelClass}>Reference</label>
              <input
                className={fieldClass}
                value={form.regulation_reference}
                onChange={(e) => set('regulation_reference', e.target.value)}
                placeholder="Circular / clause reference"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Audit period</label>
              <input
                className={fieldClass}
                value={form.audit_period}
                onChange={(e) => set('audit_period', e.target.value)}
                placeholder="FY2025 / Q1 2026"
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </RightSlidePanel>
  );
}

function ImportPanel({
  onClose,
  categorySuggestions,
}: {
  onClose: () => void;
  categorySuggestions: string[];
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [regulatorHint, setRegulatorHint] = useState('');
  const [periodHint, setPeriodHint] = useState('');
  const [categoryHint, setCategoryHint] = useState('');
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [batchId, setBatchId] = useState<string | undefined>();
  const [sourceFile, setSourceFile] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'review'>('upload');

  const parseMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('No file');
      const invalid = validateAiImportFile(file);
      if (invalid) throw new Error(invalid);
      return statutoryAuditApi.uploadParse(file, {
        regulator_hint: regulatorHint || undefined,
        audit_period_hint: periodHint || undefined,
        category_hint: categoryHint || undefined,
      });
    },
    onSuccess: (res) => {
      const d = res.data as {
        draft_observations?: DraftRow[];
        import_batch_id?: string;
        source_file?: string;
        category?: string;
      };
      const fallbackCat = (d.category || categoryHint || '').trim();
      setDrafts(
        (d.draft_observations || []).map((row) => ({
          ...row,
          selected: row.selected !== false,
          category: (row.category || fallbackCat || '').trim() || undefined,
        })),
      );
      setBatchId(d.import_batch_id);
      setSourceFile(d.source_file);
      if (d.category && !categoryHint) setCategoryHint(d.category);
      setStep('review');
      setError(null);
      setFileError(null);
    },
    onError: (e: unknown) => setError(formatApiError(e, 'Could not analyse the document')),
  });

  const confirmMut = useMutation({
    mutationFn: () =>
      statutoryAuditApi.confirmImport({
        observations: drafts,
        source_document_name: sourceFile,
        import_batch_id: batchId,
        default_category: categoryHint.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
      onClose();
    },
    onError: (e: unknown) => setError(formatApiError(e, 'Could not create observations')),
  });

  const selectedCount = drafts.filter((d) => d.selected).length;
  const updateDraft = (idx: number, patch: Partial<DraftRow>) => {
    setDrafts((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const applyCategoryToAll = () => {
    const cat = categoryHint.trim();
    setDrafts((rows) => rows.map((r) => ({ ...r, category: cat || undefined })));
  };

  const onFile = (f: File | null) => {
    setError(null);
    if (!f) {
      setFile(null);
      setFileError(null);
      return;
    }
    const invalid = validateAiImportFile(f);
    if (invalid) {
      setFile(null);
      setFileError(invalid);
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const selectAll = (selected: boolean) => {
    setDrafts((rows) => rows.map((r) => ({ ...r, selected })));
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Import with AI"
      subtitle={
        step === 'upload'
          ? 'Upload a report — AI drafts rows for you to review before anything is saved'
          : `Review drafts from ${sourceFile || 'your document'}`
      }
      width="w-full max-w-4xl"
      footer={
        step === 'upload' ? (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btnSecondaryLg}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!file || parseMut.isPending}
              onClick={() => parseMut.mutate()}
              className={btnPrimaryLg}
            >
              {parseMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analysing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analyse document
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setStep('upload');
                setError(null);
              }}
              className={btnSecondary}
            >
              ← Back to upload
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btnSecondaryLg}>
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedCount === 0 || confirmMut.isPending}
                onClick={() => confirmMut.mutate()}
                className={btnPrimaryLg}
              >
                {confirmMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create {selectedCount} observation{selectedCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )
      }
    >
      {step === 'upload' ? (
        <div className="space-y-5">
          <section>
            <StepLabel n={1} label="Optional hints" />
            <p className={`${helperClass} mb-3 mt-0`}>
              Helps AI label regulator, period, and category — leave blank if unsure.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass}>Regulator</label>
                <input
                  className={fieldClass}
                  value={regulatorHint}
                  onChange={(e) => setRegulatorHint(e.target.value)}
                  placeholder="SBP, SAMA…"
                  disabled={parseMut.isPending}
                />
              </div>
              <div>
                <label className={labelClass}>Audit period</label>
                <input
                  className={fieldClass}
                  value={periodHint}
                  onChange={(e) => setPeriodHint(e.target.value)}
                  placeholder="FY2025"
                  disabled={parseMut.isPending}
                />
              </div>
              <CategoryField
                value={categoryHint}
                onChange={setCategoryHint}
                suggestions={categorySuggestions}
                id="import-category-hint"
                disabled={parseMut.isPending}
              />
            </div>
          </section>

          <section>
            <StepLabel n={2} label="Upload the document" />
            <FileDropzone
              file={file}
              onFile={onFile}
              accept={AI_IMPORT_ACCEPT}
              disabled={parseMut.isPending}
              error={fileError}
              hint={
                <>
                  Supported: PDF, Word (.doc, .docx), Excel (.xls, .xlsx), CSV, and text · Max 25 MB
                  <br />
                  AI drafts observation rows — you review and confirm before anything is saved
                </>
              }
            />
          </section>

          {parseMut.isPending && (
            <div className="flex items-center gap-3 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Reading the document and drafting observation rows…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <CategoryField
                  value={categoryHint}
                  onChange={setCategoryHint}
                  suggestions={categorySuggestions}
                  id="import-review-category"
                />
              </div>
              <button type="button" onClick={applyCategoryToAll} className={`${btnSecondary} mb-5`}>
                Apply to all drafts
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2.5">
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">{drafts.length}</span> draft
                {drafts.length === 1 ? '' : 's'} ·{' '}
                <span className="font-medium text-slate-900">{selectedCount}</span> selected
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => selectAll(true)} className="text-xs font-medium text-primary-700 hover:underline">
                  Select all
                </button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => selectAll(false)} className="text-xs font-medium text-slate-600 hover:underline">
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {drafts.map((d, idx) => (
              <div
                key={idx}
                className={`rounded-xl border p-4 transition-colors ${
                  d.selected ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => updateDraft(idx, { selected: !d.selected })}
                    className={`mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      d.selected
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                    aria-label={d.selected ? 'Deselect' : 'Select'}
                  >
                    {d.selected && <Check className="h-3 w-3" strokeWidth={2.5} />}
                  </button>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <label className={labelClass}>Title</label>
                      <input
                        className={fieldClass}
                        value={d.title}
                        onChange={(e) => updateDraft(idx, { title: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Description</label>
                      <textarea
                        className={fieldClass}
                        rows={2}
                        value={d.description || ''}
                        onChange={(e) => updateDraft(idx, { description: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <div>
                        <label className={labelClass}>Type</label>
                        <select
                          className={fieldClass}
                          value={d.observation_type}
                          onChange={(e) => updateDraft(idx, { observation_type: e.target.value })}
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Priority</label>
                        <select
                          className={fieldClass}
                          value={d.priority}
                          onChange={(e) => updateDraft(idx, { priority: e.target.value })}
                        >
                          {PRIORITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Category</label>
                        <input
                          list={`draft-cat-${idx}`}
                          className={fieldClass}
                          value={d.category || ''}
                          onChange={(e) => updateDraft(idx, { category: e.target.value })}
                          placeholder="Optional"
                        />
                        <datalist id={`draft-cat-${idx}`}>
                          {categorySuggestions.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className={labelClass}>Regulator</label>
                        <input
                          className={fieldClass}
                          value={d.regulator_source || ''}
                          onChange={(e) => updateDraft(idx, { regulator_source: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Reference</label>
                        <input
                          className={fieldClass}
                          value={d.regulation_reference || ''}
                          onChange={(e) => updateDraft(idx, { regulation_reference: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrafts((rows) => rows.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Remove draft"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            {drafts.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
                <p className="text-sm font-medium text-amber-900">No observations were found</p>
                <p className="mt-1 text-sm text-amber-700">
                  Try another file, or go back and register one manually.
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </RightSlidePanel>
  );
}
