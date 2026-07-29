'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ScrollText, Link2, Paperclip, Loader2, Trash2, Upload, Clock,
} from 'lucide-react';
import { statutoryAuditApi } from '@/lib/api';
import { AnimatedModal, PageLoader } from '@/components/ui';
import {
  StatusBadge, PriorityBadge, STATUS_LABEL, TYPE_LABEL, TYPE_OPTIONS, PRIORITY_OPTIONS,
  fmtDate, fieldClass, labelClass,
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
  const obsId = Number(params?.id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'details' | 'evidence' | 'links' | 'history'>('details');
  const [editOpen, setEditOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<'controls' | 'risks' | 'issues' | 'documents' | 'evidence' | null>(null);

  const { data: obs, isLoading, error } = useQuery({
    queryKey: ['statutory-audit-obs', obsId],
    queryFn: async () => (await statutoryAuditApi.get(obsId)).data as any,
    enabled: obsId > 0,
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
    onSuccess: invalidate,
  });

  const unlinkEvMut = useMutation({
    mutationFn: (linkId: number) => statutoryAuditApi.unlinkEvidence(obsId, linkId),
    onSuccess: invalidate,
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !obs) {
    return (
      <div>
        <Link href="/auditor-portal/statutory-audit" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to Statutory Audit
        </Link>
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">
          Failed to load observation.
        </div>
      </div>
    );
  }

  const nextStatuses = TRANSITIONS[obs.status] || [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Link href="/auditor-portal/statutory-audit" className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50" title="Back">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <ScrollText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {obs.code || 'Observation'} · {TYPE_LABEL[obs.observation_type] || obs.observation_type}
              </div>
              <h1 className="text-lg font-semibold text-slate-900">{obs.title}</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {[obs.regulator_source, obs.regulation_reference, obs.audit_period].filter(Boolean).join(' · ') || 'No regulator / period set'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <StatusBadge status={obs.status} />
            <PriorityBadge priority={obs.priority} />
            <button onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Edit
            </button>
          </div>
        </div>

        {nextStatuses.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="mr-1 text-[11px] font-medium text-slate-400">Move to:</span>
            {nextStatuses.map((s) => (
              <button
                key={s}
                disabled={transitionMut.isPending}
                onClick={() => transitionMut.mutate(s)}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
              >
                {STATUS_LABEL[s] || s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ['details', 'Details'],
          ['evidence', `Evidence (${obs.evidence?.length ?? obs.evidence_count ?? 0})`],
          ['links', 'Linkages'],
          ['history', 'History'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
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
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Description</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.description || 'No description.'}</p>
            <h2 className="pt-2 text-sm font-semibold text-slate-900">Management response</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.management_response || '—'}</p>
            <h2 className="pt-2 text-sm font-semibold text-slate-900">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{obs.notes || '—'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">Upload proof of remediation or compliance, or link existing evidence from the library.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setLinkKind('evidence')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Link2 className="h-4 w-4" /> Link existing
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700">
                {uploadEvMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload file
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadEvMut.mutate(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          {(obs.evidence || []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              <Paperclip className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              No evidence attached yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(obs.evidence || []).map((ev: any) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{ev.name || ev.file_name}</p>
                    <p className="text-[11px] text-slate-500">{ev.relationship_type} · {fmtDate(ev.created_at)}</p>
                  </div>
                  <button
                    onClick={() => unlinkEvMut.mutate(ev.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Unlink"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-4">
          <LinkSection
            title="Controls"
            rows={(obs.controls || []).map((r: any) => ({
              id: r.id,
              label: `${r.control_id || ''} — ${r.name || ''}`.trim(),
            }))}
            onAdd={() => setLinkKind('controls')}
            onRemove={(linkId) => statutoryAuditApi.unlinkControl(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Risks"
            rows={(obs.risks || []).map((r: any) => ({ id: r.id, label: r.title || `Risk #${r.risk_id}` }))}
            onAdd={() => setLinkKind('risks')}
            onRemove={(linkId) => statutoryAuditApi.unlinkRisk(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Issues"
            rows={(obs.issues || []).map((r: any) => ({
              id: r.id,
              label: `${r.code || ''} — ${r.title || ''}`.trim(),
            }))}
            onAdd={() => setLinkKind('issues')}
            onRemove={(linkId) => statutoryAuditApi.unlinkIssue(obsId, linkId).then(invalidate)}
          />
          <LinkSection
            title="Governance documents"
            rows={(obs.documents || []).map((r: any) => ({ id: r.id, label: r.title || `Doc #${r.document_id}` }))}
            onAdd={() => setLinkKind('documents')}
            onRemove={(linkId) => statutoryAuditApi.unlinkDocument(obsId, linkId).then(invalidate)}
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {(obs.history || []).length === 0 ? (
            <p className="text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {(obs.history || []).map((h: any) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                  <div>
                    <p className="text-slate-800">{h.message || h.activity_type}</p>
                    <p className="text-[11px] text-slate-500">
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
        <EditModal
          obs={obs}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); invalidate(); }}
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
  title, rows, onAdd, onRemove,
}: {
  title: string;
  rows: { id: number; label: string }[];
  onAdd: () => void;
  onRemove: (id: number) => void | Promise<unknown>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <Link2 className="h-3.5 w-3.5" /> Link
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">None linked.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate text-slate-800">{r.label}</span>
              <button onClick={() => onRemove(r.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditModal({ obs, onClose, onSaved }: { obs: any; onClose: () => void; onSaved: () => void }) {
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
    management_response: obs.management_response || '',
    notes: obs.notes || '',
  });
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      statutoryAuditApi.update(obs.id, {
        ...form,
        due_date: form.due_date || null,
      }),
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.response?.data?.detail || 'Update failed'),
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AnimatedModal isOpen onClose={onClose} title="Edit observation" size="lg">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Title</label>
          <input className={fieldClass} value={form.title} onChange={(e) => set('title', e.target.value)} />
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
        </div>
        <div>
          <label className={labelClass}>Management response</label>
          <textarea className={fieldClass} rows={2} value={form.management_response} onChange={(e) => set('management_response', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <textarea className={fieldClass} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button>
          <button
            disabled={mut.isPending || !form.title.trim()}
            onClick={() => mut.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </AnimatedModal>
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
    controls: 'Link control',
    risks: 'Link risk',
    issues: 'Link issue',
    documents: 'Link document',
    evidence: 'Link evidence',
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not link');
    } finally {
      setPending(false);
    }
  };

  const filtered = useMemo(() => options, [options]);

  return (
    <AnimatedModal isOpen onClose={onClose} title={titles[kind]} size="md">
      <div className="space-y-3">
        <input
          className={fieldClass}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No matches.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  disabled={pending}
                  onClick={() => linkOne(o.id)}
                  className="flex w-full flex-col items-start px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-slate-900">{o.label}</span>
                  {o.subtitle && <span className="text-[11px] text-slate-500">{o.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </AnimatedModal>
  );
}
