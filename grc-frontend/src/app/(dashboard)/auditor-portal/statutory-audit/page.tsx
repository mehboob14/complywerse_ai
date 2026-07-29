'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Eye, Trash2, ScrollText, Sparkles, Loader2, Upload, Check, X,
} from 'lucide-react';
import { statutoryAuditApi } from '@/lib/api';
import { SearchInput, MultiSelectDropdown, AnimatedModal, PageLoader } from '@/components/ui';
import EmptyState from '@/components/common/EmptyState';
import {
  StatusBadge, PriorityBadge, STATUS_LABEL, TYPE_LABEL,
  PRIORITY_OPTIONS, TYPE_OPTIONS, fmtDate, fieldClass, labelClass,
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
  selected: boolean;
};

function formatApiError(e: any, fallback: string): string {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d)))
      .filter(Boolean)
      .join('; ') || fallback;
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return e?.message || fallback;
}

export default function StatutoryAuditListPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data: meta } = useQuery({
    queryKey: ['statutory-audit-meta'],
    queryFn: async () => (await statutoryAuditApi.meta()).data as any,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['statutory-audit-obs', statusFilter, priorityFilter, sourceFilter, periodFilter, search],
    queryFn: async () =>
      (await statutoryAuditApi.list({
        search: search || undefined,
        status_filter: statusFilter !== 'all' ? statusFilter : undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        regulator_source: sourceFilter !== 'all' ? sourceFilter : undefined,
        audit_period: periodFilter !== 'all' ? periodFilter : undefined,
      })).data as { items: ObsRow[]; total: number },
    placeholderData: keepPreviousData,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => statutoryAuditApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
    },
  });

  const rows = data?.items || [];
  const sourceItems = useMemo(
    () => (meta?.regulator_sources || []).map((s: string) => ({ value: s, label: s })),
    [meta],
  );
  const periodItems = useMemo(
    () => (meta?.audit_periods || []).map((s: string) => ({ value: s, label: s })),
    [meta],
  );

  if (isLoading) return <PageLoader className="h-64" />;
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">
        Failed to load audit observations.
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <ScrollText className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Statutory Audit</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Register and track regulator requirements and audit observations to closure.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-4 w-4 text-primary-600" /> Import with AI
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
          >
            <Plus size={16} /> Register observation
          </button>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'open', 'in_progress', 'complied', 'closed'] as const).map((s) => {
          const count = s === 'all' ? data?.total : meta?.counts_by_status?.[s] || 0;
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-[200px] flex-1 sm:max-w-md">
          <SearchInput value={search} onChange={setSearch} placeholder="Search title, code, regulator, reference…" size="md" />
        </div>
        <MultiSelectDropdown
          title="Priority"
          items={PRIORITY_OPTIONS}
          selectedValues={priorityFilter === 'all' ? [] : [priorityFilter]}
          onApply={(v: string[]) => setPriorityFilter(v[0] || 'all')}
          multiSelect={false}
        />
        {sourceItems.length > 0 && (
          <MultiSelectDropdown
            title="Regulator"
            items={sourceItems}
            selectedValues={sourceFilter === 'all' ? [] : [sourceFilter]}
            onApply={(v: string[]) => setSourceFilter(v[0] || 'all')}
            multiSelect={false}
          />
        )}
        {periodItems.length > 0 && (
          <MultiSelectDropdown
            title="Period"
            items={periodItems}
            selectedValues={periodFilter === 'all' ? [] : [periodFilter]}
            onApply={(v: string[]) => setPeriodFilter(v[0] || 'all')}
            multiSelect={false}
          />
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="No audit observations yet"
          description="Register a requirement manually, or upload a regulatory / audit report and let AI draft the rows for review."
          primaryAction={{ label: 'Register observation', onClick: () => setShowCreate(true) }}
          secondaryAction={{ label: 'Import with AI', onClick: () => setShowImport(true) }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Code</th>
                  <th className="px-3 py-2 text-left font-semibold">Observation</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Priority</th>
                  <th className="px-3 py-2 text-left font-semibold">Regulator</th>
                  <th className="px-3 py-2 text-left font-semibold">Period</th>
                  <th className="px-3 py-2 text-left font-semibold">Due</th>
                  <th className="px-3 py-2 text-right font-semibold">Evidence</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{o.code || '—'}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      <Link href={`/auditor-portal/statutory-audit/${o.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-primary-600">
                        {o.title}
                      </Link>
                      <div className="truncate text-[11px] text-slate-400">
                        {TYPE_LABEL[o.observation_type || ''] || o.observation_type}
                        {o.regulation_reference ? ` · ${o.regulation_reference}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                    <td className="px-3 py-2"><PriorityBadge priority={o.priority} /></td>
                    <td className="px-3 py-2 text-slate-600">{o.regulator_source || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{o.audit_period || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(o.due_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{o.evidence_count ?? 0}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link
                          href={`/auditor-portal/statutory-audit/${o.id}`}
                          className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-600"
                          title="Open"
                        >
                          <Eye size={16} />
                        </Link>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete ${o.code || o.title}?`)) deleteMut.mutate(o.id);
                          }}
                          className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
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
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not create observation'),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AnimatedModal isOpen onClose={onClose} title="Register observation" size="lg">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Title *</label>
          <input className={fieldClass} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Strengthen AML transaction monitoring thresholds" />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={fieldClass} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Type</label>
            <select className={fieldClass} value={form.observation_type} onChange={(e) => set('observation_type', e.target.value)}>
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select className={fieldClass} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Regulator / source</label>
            <input className={fieldClass} value={form.regulator_source} onChange={(e) => set('regulator_source', e.target.value)} placeholder="SBP, SAMA, External auditor…" />
          </div>
          <div>
            <label className={labelClass}>Reference</label>
            <input className={fieldClass} value={form.regulation_reference} onChange={(e) => set('regulation_reference', e.target.value)} placeholder="Circular / clause ref" />
          </div>
          <div>
            <label className={labelClass}>Audit period</label>
            <input className={fieldClass} value={form.audit_period} onChange={(e) => set('audit_period', e.target.value)} placeholder="FY2025 / Q1 2026" />
          </div>
          <div>
            <label className={labelClass}>Due date</label>
            <input type="date" className={fieldClass} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            disabled={!form.title.trim() || mut.isPending}
            onClick={() => mut.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [regulatorHint, setRegulatorHint] = useState('');
  const [periodHint, setPeriodHint] = useState('');
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [batchId, setBatchId] = useState<string | undefined>();
  const [sourceFile, setSourceFile] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'review'>('upload');

  const parseMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('No file');
      return statutoryAuditApi.uploadParse(file, {
        regulator_hint: regulatorHint || undefined,
        audit_period_hint: periodHint || undefined,
      });
    },
    onSuccess: (res) => {
      const d = res.data as any;
      setDrafts(d.draft_observations || []);
      setBatchId(d.import_batch_id);
      setSourceFile(d.source_file);
      setStep('review');
      setError(null);
    },
    onError: (e: any) => setError(formatApiError(e, 'AI parse failed')),
  });

  const confirmMut = useMutation({
    mutationFn: () =>
      statutoryAuditApi.confirmImport({
        observations: drafts,
        source_document_name: sourceFile,
        import_batch_id: batchId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
      qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
      onClose();
    },
    onError: (e: any) => setError(formatApiError(e, 'Could not create observations')),
  });

  const selectedCount = drafts.filter((d) => d.selected).length;
  const updateDraft = (idx: number, patch: Partial<DraftRow>) => {
    setDrafts((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <AnimatedModal isOpen onClose={onClose} title="Import with AI" size="xl">
      {step === 'upload' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Upload a regulatory circular, inspection letter, or audit report. AI will draft observation rows for you to review before anything is saved.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Regulator hint (optional)</label>
              <input className={fieldClass} value={regulatorHint} onChange={(e) => setRegulatorHint(e.target.value)} placeholder="SBP, SAMA…" />
            </div>
            <div>
              <label className={labelClass}>Period hint (optional)</label>
              <input className={fieldClass} value={periodHint} onChange={(e) => setPeriodHint(e.target.value)} placeholder="FY2025" />
            </div>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center hover:border-primary-300 hover:bg-primary-50/40">
            <Upload className="h-8 w-8 text-slate-400" />
            <span className="mt-2 text-sm font-medium text-slate-700">{file ? file.name : 'Choose PDF, Word, or text file'}</span>
            <span className="mt-1 text-xs text-slate-500">AI extracts requirements — you confirm before create</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.rtf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {error && <p className="text-sm text-rose-600">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              disabled={!file || parseMut.isPending}
              onClick={() => parseMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
            >
              {parseMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze document
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Review {drafts.length} draft{drafts.length === 1 ? '' : 's'} from <span className="font-medium">{sourceFile}</span>. Uncheck any you do not want to create.
            </p>
            <button onClick={() => setStep('upload')} className="text-xs text-primary-700 hover:underline">← Back</button>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {drafts.map((d, idx) => (
              <div key={idx} className={`rounded-lg border p-3 ${d.selected ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => updateDraft(idx, { selected: !d.selected })}
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${d.selected ? 'border-primary-500 bg-primary-500 text-[#0a0a0a]' : 'border-slate-300 bg-white'}`}
                  >
                    {d.selected && <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input className={fieldClass} value={d.title} onChange={(e) => updateDraft(idx, { title: e.target.value })} />
                    <textarea className={fieldClass} rows={2} value={d.description || ''} onChange={(e) => updateDraft(idx, { description: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <select className={fieldClass} value={d.observation_type} onChange={(e) => updateDraft(idx, { observation_type: e.target.value })}>
                        {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select className={fieldClass} value={d.priority} onChange={(e) => updateDraft(idx, { priority: e.target.value })}>
                        {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input className={fieldClass} placeholder="Regulator" value={d.regulator_source || ''} onChange={(e) => updateDraft(idx, { regulator_source: e.target.value })} />
                      <input className={fieldClass} placeholder="Reference" value={d.regulation_reference || ''} onChange={(e) => updateDraft(idx, { regulation_reference: e.target.value })} />
                    </div>
                  </div>
                  <button onClick={() => setDrafts((rows) => rows.filter((_, i) => i !== idx))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {drafts.length === 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No observations were extracted. Try another file or register manually.</p>
            )}
          </div>
          {error && <p className="text-sm text-rose-600">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              disabled={selectedCount === 0 || confirmMut.isPending}
              onClick={() => confirmMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
            >
              {confirmMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create {selectedCount} observation{selectedCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}
