'use client';

// Artifacts as real documents — the same tenant-artifact store the compliance
// ArtifactsTab uses, namespaced per vendor via framework_key = `tpra-vendor-{id}`.
// Users can create a document (from the stage's expected artifact templates or
// blank), preview it, edit its markdown, download it (docx/pdf/md), and push it
// straight into the assessment's evidence — all with existing endpoints.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Eye, Pencil, Download, Trash2, Paperclip, Loader2, ChevronDown,
} from 'lucide-react';
import { artifactsApi, tpraApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';

interface TenantArtifact {
  id: number; name: string; artifact_type: string; stage: string | null; status: string;
  content: string | null; description: string | null; format: string | null; updated_at: string | null;
}

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';
const TYPES = ['Document', 'Policy', 'Procedure', 'Form', 'Register', 'Agreement', 'Report', 'Plan', 'Attestation'];
const STATUSES = ['draft', 'in_review', 'approved', 'archived'];
const DOC_FORMATS = ['docx', 'pdf', 'md'];
const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', in_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700', archived: 'bg-slate-100 text-slate-500',
};

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export default function ArtifactDocumentsPanel({
  vendorId, assessmentId, stageLabel, expectedArtifacts,
}: { vendorId: number; assessmentId: number; stageLabel: string; expectedArtifacts: string[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const fk = `tpra-vendor-${vendorId}`;

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-artifacts', vendorId],
    queryFn: async () => (await artifactsApi.list({ framework_key: fk })).data as TenantArtifact[],
  });
  const all = data || [];
  const stageArtifacts = all.filter((a) => (a.stage || '') === stageLabel);
  const existing = new Set(all.map((a) => a.name.trim().toLowerCase()));
  const toCreate = expectedArtifacts.filter((n) => !existing.has(n.trim().toLowerCase()));

  const [editing, setEditing] = useState<TenantArtifact | 'new' | null>(null);
  const [seed, setSeed] = useState('');
  const [preview, setPreview] = useState<TenantArtifact | null>(null);
  const [dlOpen, setDlOpen] = useState<number | null>(null);
  const [evBusy, setEvBusy] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tpra-artifacts', vendorId] });

  const del = useMutation({
    mutationFn: (id: number) => artifactsApi.remove(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Artifact deleted' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not delete', message: errMsg(e, 'Try again.') }),
  });

  const download = async (a: TenantArtifact, fmt: string) => {
    setDlOpen(null);
    try {
      const blob = (await artifactsApi.export(a.id, fmt)).data as Blob;
      saveBlob(blob, `${a.name}.${fmt}`);
    } catch (e) { toast({ type: 'error', title: 'Download failed', message: errMsg(e, 'Try again.') }); }
  };

  const useAsEvidence = async (a: TenantArtifact) => {
    setEvBusy(a.id);
    try {
      const blob = (await artifactsApi.export(a.id, 'pdf')).data as Blob;
      const file = new File([blob], `${a.name}.pdf`, { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', a.name);
      fd.append('evidence_type', 'artifact');
      fd.append('note', `Artifact produced at ${stageLabel}`);
      await tpraApi.uploadEvidence(assessmentId, fd);
      qc.invalidateQueries({ queryKey: ['tpra-evidence'] });
      toast({ type: 'success', title: 'Added to evidence', message: 'The document is now linked as evidence.' });
    } catch (e) { toast({ type: 'error', title: 'Could not add', message: errMsg(e, 'Try again.') }); }
    finally { setEvBusy(null); }
  };

  return (
    <div className="space-y-3">
      {/* Create from the stage's expected artifact templates */}
      {canEdit && toCreate.length > 0 && (
        <div className="rounded-lg bg-gray-50 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Create from template</p>
          <div className="flex flex-wrap gap-1.5">
            {toCreate.map((n) => (
              <button key={n} onClick={() => { setSeed(n); setEditing('new'); }}
                className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-white px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-50">
                <Plus className="h-3 w-3" /> {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Documents ({stageArtifacts.length})</p>
        {canEdit && (
          <button onClick={() => { setSeed(''); setEditing('new'); }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> New document
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : stageArtifacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No documents yet</p>
          <p className="text-xs text-gray-500">Create one from a template above, or start a new document.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {stageArtifacts.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-900">{a.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[a.status] || 'bg-gray-100 text-gray-600'}`}>{a.status.replace('_', ' ')}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{a.artifact_type}</span>
                  </div>
                  {a.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">{a.description}</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button onClick={() => setPreview(a)} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">
                  <Eye className="h-3 w-3" /> Preview
                </button>
                {canEdit && (
                  <button onClick={() => { setSeed(''); setEditing(a); }} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
                <div className="relative">
                  <button onClick={() => setDlOpen(dlOpen === a.id ? null : a.id)} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">
                    <Download className="h-3 w-3" /> Download <ChevronDown className="h-3 w-3" />
                  </button>
                  {dlOpen === a.id && (
                    <div className="absolute z-10 mt-1 w-24 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {DOC_FORMATS.map((f) => (
                        <button key={f} onClick={() => download(a, f)} className="block w-full px-3 py-1 text-left text-[11px] uppercase text-gray-600 hover:bg-gray-50">{f}</button>
                      ))}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <button onClick={() => useAsEvidence(a)} disabled={evBusy === a.id}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                    {evBusy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Use as evidence
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => del.mutate(a.id)} className="ml-auto inline-flex items-center rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      <RightSlidePanel isOpen={!!preview} onClose={() => setPreview(null)} title={preview?.name || 'Preview'} width="w-full max-w-2xl">
        {preview?.content ? <GovernanceDocumentMarkdown content={preview.content} /> : <p className="text-sm text-gray-400">This document has no content yet.</p>}
      </RightSlidePanel>

      {/* Create / edit */}
      {editing && (
        <ArtifactEditor
          artifact={editing === 'new' ? null : editing}
          seedName={seed} stageLabel={stageLabel} frameworkKey={fk}
          onClose={() => setEditing(null)}
          onSaved={() => { invalidate(); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ArtifactEditor({
  artifact, seedName, stageLabel, frameworkKey, onClose, onSaved,
}: {
  artifact: TenantArtifact | null; seedName: string; stageLabel: string; frameworkKey: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: artifact?.name || seedName || '',
    artifact_type: artifact?.artifact_type || 'Document',
    status: artifact?.status || 'draft',
    description: artifact?.description || '',
    content: artifact?.content || '',
  });
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, content: String(reader.result || '') }));
    reader.readAsText(file);
  };

  const save = useMutation({
    mutationFn: () => {
      if (artifact) {
        return artifactsApi.update(artifact.id, {
          name: form.name, artifact_type: form.artifact_type, status: form.status,
          description: form.description || null, content: form.content || null,
        });
      }
      return artifactsApi.create({
        framework_key: frameworkKey, name: form.name, artifact_type: form.artifact_type,
        stage: stageLabel, status: form.status, description: form.description || null,
        content: form.content || null, is_platform_native: false,
      });
    },
    onSuccess: () => { onSaved(); toast({ type: 'success', title: artifact ? 'Artifact saved' : 'Artifact created' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  return (
    <RightSlidePanel isOpen onClose={onClose} title={artifact ? 'Edit artifact' : 'New artifact'} width="w-full max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending ? 'Saving…' : artifact ? 'Save' : 'Create'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={form.artifact_type} onChange={(e) => setForm({ ...form, artifact_type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelCls}>Content <span className="text-gray-400">(markdown)</span></label>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer text-[11px] font-medium text-gray-500 hover:text-gray-700">
                Load from file
                <input type="file" accept=".md,.txt,.markdown" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
              </label>
              <div className="inline-flex overflow-hidden rounded-md border border-gray-200 text-[11px]">
                <button type="button" onClick={() => setMode('edit')} className={`px-2 py-0.5 ${mode === 'edit' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>Edit</button>
                <button type="button" onClick={() => setMode('preview')} className={`px-2 py-0.5 ${mode === 'preview' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>Preview</button>
              </div>
            </div>
          </div>
          {mode === 'edit' ? (
            <textarea className={`${inputCls} font-mono`} rows={14} value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="# Document title&#10;&#10;Write the artifact here…" />
          ) : (
            <div className="min-h-[14rem] rounded-lg border border-gray-200 p-3">
              {form.content ? <GovernanceDocumentMarkdown content={form.content} /> : <p className="text-sm text-gray-400">Nothing to preview.</p>}
            </div>
          )}
        </div>
      </div>
    </RightSlidePanel>
  );
}
