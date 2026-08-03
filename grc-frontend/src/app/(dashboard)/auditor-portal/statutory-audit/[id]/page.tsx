'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Link2, Paperclip, Loader2, Trash2, Upload, Clock, Pencil,
  AlertCircle, Search,
} from 'lucide-react';
import { statutoryAuditApi } from '@/lib/api';
import { AnimatedModal, PageLoader, RightSlidePanel } from '@/components/ui';
import {
  StatusBadge, PriorityBadge, STATUS_LABEL, TYPE_LABEL, TYPE_OPTIONS, PRIORITY_OPTIONS,
  fmtDate, fieldClass, labelClass, helperClass, btnPrimary, btnPrimaryLg, btnSecondary, btnSecondaryLg,
  formatApiError, StepLabel, CategoryField, FileDropzone, EVIDENCE_ACCEPT, formatFileSize, getFileIcon, fileExt, getFileTypeColor,
} from '../_ui';

const TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'complied', 'closed', 'cancelled'],
  in_progress: ['open', 'complied', 'closed', 'cancelled'],
  complied: ['in_progress', 'closed', 'open'],
  closed: ['open', 'in_progress'],
  cancelled: ['open'],
};

export default function StatutoryAuditDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const obsId = Number(params?.id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'details' | 'evidence' | 'links' | 'history'>('details');
  const [editOpen, setEditOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<'controls' | 'risks' | 'issues' | 'documents' | 'evidence' | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: obs, isLoading, error } = useQuery({
    queryKey: ['statutory-audit-obs', obsId],
    queryFn: async () => (await statutoryAuditApi.get(obsId)).data as any,
    enabled: obsId > 0,
  });

  const { data: meta } = useQuery({
    queryKey: ['statutory-audit-meta'],
    queryFn: async () => (await statutoryAuditApi.meta()).data as { categories?: string[] },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['statutory-audit-obs', obsId] });
    qc.invalidateQueries({ queryKey: ['statutory-audit-obs'] });
    qc.invalidateQueries({ queryKey: ['statutory-audit-meta'] });
  };

  const transitionMut = useMutation({
    mutationFn: (status: string) => statutoryAuditApi.transition(obsId, { status }),
    onSuccess: invalidate,
  });

  const uploadEvMut = useMutation({
    mutationFn: (file: File) => statutoryAuditApi.uploadEvidence(obsId, file),
    onSuccess: () => {
      setUploadOpen(false);
      invalidate();
    },
  });

  const unlinkEvMut = useMutation({
    mutationFn: (linkId: number) => statutoryAuditApi.unlinkEvidence(obsId, linkId),
    onSuccess: invalidate,
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !obs) {
    return (
      <div className="governance-light space-y-4">
        <Link href="/auditor-portal/statutory-audit" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to observation register
        </Link>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">
          Could not load this observation.
        </div>
      </div>
    );
  }

  const nextStatuses = TRANSITIONS[obs.status] || [];
  const categorySuggestions = meta?.categories || [];

  return (
    <div className="governance-light space-y-4 sm:space-y-6">
      {/* Header — Documents detail pattern */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <button
            type="button"
            onClick={() => router.push('/auditor-portal/statutory-audit')}
            className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900">{obs.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              {obs.code && <span className="font-mono text-xs text-slate-500">{obs.code}</span>}
              <StatusBadge status={obs.status} />
              <PriorityBadge priority={obs.priority} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {TYPE_LABEL[obs.observation_type] || obs.observation_type}
              </span>
              {obs.category && (
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {obs.category}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {[obs.regulator_source, obs.regulation_reference, obs.audit_period].filter(Boolean).join(' · ')
                || 'No regulator / period set'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button type="button" onClick={() => setEditOpen(true)} className={btnSecondaryLg}>
            <Pencil className="h-4 w-4" />
            Edit details
          </button>
        </div>
      </div>

      {nextStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="mr-1 text-xs font-medium text-slate-500">Move to:</span>
          {nextStatuses.map((s) => (
            <button
              key={s}
              type="button"
              disabled={transitionMut.isPending}
              onClick={() => transitionMut.mutate(s)}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
            >
              {STATUS_LABEL[s] || s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ['details', 'Details'],
          ['evidence', `Evidence (${obs.evidence?.length ?? obs.evidence_count ?? 0})`],
          ['links', 'Linkages'],
          ['history', 'History'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary-500 text-primary-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Description</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.description || 'No description yet.'}</p>
            </section>
            <section className="border-t border-slate-100 pt-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Management response</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.management_response || '—'}</p>
            </section>
            <section className="border-t border-slate-100 pt-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Notes</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.notes || '—'}</p>
            </section>
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm">
            <MetaRow label="Category" value={obs.category} />
            <MetaRow label="Area / domain" value={obs.area_domain} />
            <MetaRow label="Due date" value={fmtDate(obs.due_date)} />
            <MetaRow label="Owner" value={obs.owner_name} />
            <MetaRow label="Created by" value={obs.created_by_name} />
            <MetaRow label="Created" value={fmtDate(obs.created_at)} />
            <MetaRow label="Updated" value={fmtDate(obs.updated_at)} />
            <MetaRow label="Source document" value={obs.source_document_name} />
          </div>
        </div>
      )}

      {tab === 'evidence' && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Attach proof of remediation or compliance, or link a file already in the evidence library.
              PDF, Word, Excel, CSV, images, and other files are all supported.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setLinkKind('evidence')} className={btnSecondary}>
                <Link2 className="h-4 w-4" /> Link existing
              </button>
              <button type="button" onClick={() => setUploadOpen(true)} className={btnPrimary}>
                <Upload className="h-4 w-4" /> Upload file
              </button>
            </div>
          </div>
          {(obs.evidence || []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <Paperclip className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">No evidence attached yet</p>
              <p className="mt-1 text-xs text-slate-500">Upload a file or link one from the library.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(obs.evidence || []).map((ev: any) => {
                const ext = fileExt(ev.file_name || ev.name);
                const Icon = getFileIcon(ext);
                return (
                  <li key={ev.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className={`h-5 w-5 shrink-0 ${getFileTypeColor(ext)}`} strokeWidth={1.5} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{ev.name || ev.file_name}</p>
                        <p className="text-xs text-slate-500">
                          {ext ? `${ext.toUpperCase()} · ` : ''}
                          {ev.relationship_type} · {fmtDate(ev.created_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => unlinkEvMut.mutate(ev.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Unlink"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-4">
          <LinkSection
            title="Controls"
            emptyHint="Link controls this observation relates to."
            rows={(obs.controls || []).map((r: any) => ({
              id: r.id,
              label: `${r.control_id || ''} — ${r.name || ''}`.trim(),
            }))}
            onAdd={() => setLinkKind('controls')}
            onRemove={(linkId) => statutoryAuditApi.unlinkControl(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Risks"
            emptyHint="Link related risks from the risk register."
            rows={(obs.risks || []).map((r: any) => ({ id: r.id, label: r.title || `Risk #${r.risk_id}` }))}
            onAdd={() => setLinkKind('risks')}
            onRemove={(linkId) => statutoryAuditApi.unlinkRisk(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Issues"
            emptyHint="Link issues tracked elsewhere in GRC."
            rows={(obs.issues || []).map((r: any) => ({
              id: r.id,
              label: `${r.code || ''} — ${r.title || ''}`.trim(),
            }))}
            onAdd={() => setLinkKind('issues')}
            onRemove={(linkId) => statutoryAuditApi.unlinkIssue(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Governance documents"
            emptyHint="Link policies or procedures that address this."
            rows={(obs.documents || []).map((r: any) => ({ id: r.id, label: r.title || `Doc #${r.document_id}` }))}
            onAdd={() => setLinkKind('documents')}
            onRemove={(linkId) => statutoryAuditApi.unlinkDocument(obsId, linkId).then(invalidate)}
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {(obs.history || []).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {(obs.history || []).map((h: any) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                  <div>
                    <p className="text-slate-800">{h.message || h.activity_type}</p>
                    <p className="text-xs text-slate-500">
                      {h.user_name || 'System'} · {fmtDate(h.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editOpen && (
        <EditPanel
          obs={obs}
          categorySuggestions={categorySuggestions}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); invalidate(); }}
        />
      )}
      {uploadOpen && (
        <UploadEvidencePanel
          isPending={uploadEvMut.isPending}
          error={uploadEvMut.error ? formatApiError(uploadEvMut.error, 'Upload failed') : null}
          onClose={() => setUploadOpen(false)}
          onUpload={(file) => uploadEvMut.mutate(file)}
        />
      )}
      {linkKind && (
        <LinkPickerModal
          kind={linkKind}
          obsId={obsId}
          onClose={() => setLinkKind(null)}
          onLinked={() => { setLinkKind(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-800">{value || '—'}</div>
    </div>
  );
}

function LinkSection({
  title, emptyHint, rows, onAdd, onRemove,
}: {
  title: string;
  emptyHint: string;
  rows: { id: number; label: string }[];
  onAdd: () => void;
  onRemove: (id: number) => void | Promise<unknown>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <button type="button" onClick={onAdd} className={btnSecondary}>
          <Link2 className="h-3.5 w-3.5" /> Link
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate text-slate-800">{r.label}</span>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditPanel({
  obs, categorySuggestions, onClose, onSaved,
}: {
  obs: any;
  categorySuggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: obs.title || '',
    description: obs.description || '',
    observation_type: obs.observation_type || 'observation',
    regulator_source: obs.regulator_source || '',
    regulation_reference: obs.regulation_reference || '',
    priority: obs.priority || 'medium',
    audit_period: obs.audit_period || '',
    due_date: obs.due_date ? String(obs.due_date).slice(0, 10) : '',
    area_domain: obs.area_domain || '',
    category: obs.category || '',
    management_response: obs.management_response || '',
    notes: obs.notes || '',
  });
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      statutoryAuditApi.update(obs.id, {
        ...form,
        due_date: form.due_date || null,
        category: form.category.trim() || null,
      }),
    onSuccess: onSaved,
    onError: (e: unknown) => setError(formatApiError(e, 'Could not save changes')),
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Edit observation"
      subtitle="Update details, category, and responses"
      width="w-full max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondaryLg}>Cancel</button>
          <button
            type="submit"
            form="edit-obs-form"
            disabled={mut.isPending || !form.title.trim()}
            className={btnPrimaryLg}
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </div>
      }
    >
      <form
        id="edit-obs-form"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim()) mut.mutate();
        }}
      >
        <section>
          <StepLabel n={1} label="Basics" />
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Title</label>
              <input className={fieldClass} value={form.title} onChange={(e) => set('title', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea className={fieldClass} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <CategoryField
              value={form.category}
              onChange={(v) => set('category', v)}
              suggestions={categorySuggestions}
              id="edit-obs-category"
            />
          </div>
        </section>

        <section>
          <StepLabel n={2} label="Classification" />
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
              <input className={fieldClass} value={form.regulator_source} onChange={(e) => set('regulator_source', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Reference</label>
              <input className={fieldClass} value={form.regulation_reference} onChange={(e) => set('regulation_reference', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Audit period</label>
              <input className={fieldClass} value={form.audit_period} onChange={(e) => set('audit_period', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input type="date" className={fieldClass} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Area / domain</label>
              <input className={fieldClass} value={form.area_domain} onChange={(e) => set('area_domain', e.target.value)} />
            </div>
          </div>
        </section>

        <section>
          <StepLabel n={3} label="Responses" />
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Management response</label>
              <textarea className={fieldClass} rows={2} value={form.management_response} onChange={(e) => set('management_response', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea className={fieldClass} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
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

function UploadEvidencePanel({
  isPending,
  error,
  onClose,
  onUpload,
}: {
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onUpload: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Upload evidence"
      subtitle="Attach a file as proof for this observation — any common office or image format"
      width="w-full max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondaryLg} disabled={isPending}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!file || isPending}
            onClick={() => file && onUpload(file)}
            className={btnPrimaryLg}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload file
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <FileDropzone
          file={file}
          onFile={setFile}
          accept={EVIDENCE_ACCEPT}
          disabled={isPending}
          hint={
            <>
              Supported: PDF, Word, Excel, CSV, text, images, ZIP · Max 25 MB
              <br />
              Drag and drop, or browse to choose a file
            </>
          }
        />
        {file && (
          <p className={`${helperClass} mt-0`}>
            Ready to attach <span className="font-medium text-slate-700">{file.name}</span>
            {' '}({formatFileSize(file.size)})
          </p>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}

function LinkPickerModal({
  kind, obsId, onClose, onLinked,
}: {
  kind: 'controls' | 'risks' | 'issues' | 'documents' | 'evidence';
  obsId: number;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['statutory-link-opts', kind, search],
    queryFn: async () =>
      (await statutoryAuditApi.linkOptions(kind, search || undefined)).data as Array<{ id: number; label: string; subtitle?: string }>,
  });

  const titles: Record<string, string> = {
    controls: 'Link a control',
    risks: 'Link a risk',
    issues: 'Link an issue',
    documents: 'Link a document',
    evidence: 'Link evidence',
  };
  const subtitles: Record<string, string> = {
    controls: 'Choose a control from the register to connect here.',
    risks: 'Choose a risk this observation relates to.',
    issues: 'Choose an issue to track alongside this observation.',
    documents: 'Choose a governance document that addresses this.',
    evidence: 'Choose an existing file from the evidence library.',
  };

  const linkOne = async (id: number) => {
    setPending(true);
    setError(null);
    try {
      if (kind === 'controls') await statutoryAuditApi.linkControl(obsId, { internal_control_id: id });
      else if (kind === 'risks') await statutoryAuditApi.linkRisk(obsId, { risk_id: id });
      else if (kind === 'issues') await statutoryAuditApi.linkIssue(obsId, { issue_id: id });
      else if (kind === 'documents') await statutoryAuditApi.linkDocument(obsId, { document_id: id });
      else await statutoryAuditApi.linkEvidence(obsId, { evidence_id: id });
      onLinked();
    } catch (e: unknown) {
      setError(formatApiError(e, 'Could not link'));
    } finally {
      setPending(false);
    }
  };

  const filtered = useMemo(() => options, [options]);

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      title={titles[kind]}
      subtitle={subtitles[kind]}
      size="md"
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={btnSecondaryLg}>Close</button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={`${fieldClass} pl-8`}
            placeholder="Search by name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-500">
            No matches. Try a different search.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => linkOne(o.id)}
                  className="flex w-full flex-col items-start px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-slate-900">{o.label}</span>
                  {o.subtitle && <span className="text-xs text-slate-500">{o.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
