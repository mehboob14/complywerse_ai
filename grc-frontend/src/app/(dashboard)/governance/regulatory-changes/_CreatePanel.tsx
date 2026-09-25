'use client';

// A new regulatory change: upload the circular (the AI reads it; the regulator
// and title fill themselves from the file), or record one by hand.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, FileText, Loader2, PenLine, Plus, Sparkles, Upload, X } from 'lucide-react';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { regulatoryApi } from '@/lib/api';
import { Field, PRIORITIES, REGULATORS, Segmented, apiError, inputCls, useUsers } from './_ui';

// What the server reads off the circular's head before anything is saved.
interface Detected { source: string | null; reference: string | null; title: string | null }

interface UploadForm {
  file: File | null;
  source: string;
  sourceTouched: boolean;   // the person chose the regulator: detection leaves it alone
  title: string;
  titleEdited: boolean;     // the person typed the title: it is kept, not replaced by the circular's own
  identifying: boolean;
  detected: Detected | null;
}

const EMPTY_UPLOAD: UploadForm = {
  file: null, source: 'SBP', sourceTouched: false, title: '', titleEdited: false, identifying: false, detected: null,
};
const EMPTY_MANUAL = { title: '', source: 'SBP', reference_number: '', publication_date: '', effective_date: '', priority: 'medium', assigned_to: '', description: '' };

const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export type CreateMode = 'circular' | 'manual';

export default function CreatePanel({ open, mode, onMode, onClose }: {
  open: boolean; mode: CreateMode; onMode: (m: CreateMode) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { people } = useUsers();
  const [upload, setUpload] = useState<UploadForm>(EMPTY_UPLOAD);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const done = (id: number) => {
    qc.invalidateQueries({ queryKey: ['regulatory-changes'] });
    qc.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
    close();
    router.push(`/governance/regulatory-changes/${id}`);
  };
  const close = () => { setUpload(EMPTY_UPLOAD); setManual(EMPTY_MANUAL); setError(''); onClose(); };

  // A file is read for its regulator, reference and title as soon as it is picked,
  // so nothing has to be typed; whatever the person already chose or typed stands.
  const pickFile = async (file: File | null) => {
    setError('');
    setUpload((u) => ({
      ...u, file, detected: null, identifying: !!file,
      title: u.titleEdited ? u.title : file ? titleFromName(file.name) : '',
    }));
    if (!file) return;
    let found: Detected | null = null;
    try {
      found = (await regulatoryApi.identifyChangeDocument(file)).data as Detected;
    } catch {
      // Not needed to go on: the AI reads the title and reference as it analyses.
    }
    setUpload((u) => (u.file !== file ? u : {
      ...u, identifying: false, detected: found,
      source: found?.source && !u.sourceTouched ? found.source : u.source,
      title: found?.title && !u.titleEdited ? found.title : u.title,
    }));
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!upload.file) throw new Error('Choose the circular to upload.');
      const title = upload.title.trim();
      return (await regulatoryApi.uploadChangeDocument(upload.file, {
        source: upload.source, title_hint: title || undefined, title_locked: upload.titleEdited && !!title,
      })).data as { id: number };
    },
    onSuccess: (created) => done(created.id),
    onError: (e: unknown) => setError(apiError(e, (e as { message?: string })?.message || 'The upload failed. Please try again.')),
  });
  const createMutation = useMutation({
    mutationFn: async () => (await regulatoryApi.createChange({
      title: manual.title.trim(), source: manual.source, reference_number: manual.reference_number.trim() || undefined,
      publication_date: manual.publication_date || undefined, effective_date: manual.effective_date || undefined,
      priority: manual.priority, assigned_to: manual.assigned_to ? Number(manual.assigned_to) : undefined,
      description: manual.description.trim() || undefined,
    })).data as { id: number },
    onSuccess: (created) => done(created.id),
    onError: (e: unknown) => setError(apiError(e, 'The change could not be saved.')),
  });

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="New regulatory change"
      subtitle={mode === 'circular' ? 'Upload the circular. The AI reads it and maps what it means for you.' : 'Record a change by hand.'}
      width="w-full max-w-2xl"
      footer={(
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={close}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          {mode === 'circular' ? (
            <button type="submit" form="circular-form" disabled={uploadMutation.isPending || !upload.file}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {uploadMutation.isPending ? 'Uploading…' : 'Analyze with AI'}
            </button>
          ) : (
            <button type="submit" form="manual-form" disabled={createMutation.isPending || !manual.title.trim()}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create change
            </button>
          )}
        </div>
      )}
    >
      <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
        {([['circular', Upload, 'Upload a circular'], ['manual', PenLine, 'Enter manually']] as const).map(([m, Icon, label]) => (
          <button key={m} type="button" onClick={() => { setError(''); onMode(m); }} aria-pressed={mode === m}
            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 transition-colors ${
              mode === m ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {mode === 'circular' ? (
        <form id="circular-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(''); uploadMutation.mutate(); }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
          >
            <input id="circular-file" type="file" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff" className="sr-only"
              onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            {upload.file ? (
              <div className={`flex items-center gap-3 rounded-xl border p-3 ${dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <FileText className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{upload.file.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    {fileSize(upload.file.size)} ·
                    {upload.identifying ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Reading the circular…</>
                    ) : upload.detected?.reference ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle className="h-3 w-3" /> {upload.detected.reference}</span>
                    ) : (
                      <span>Ready to analyze</span>
                    )}
                  </p>
                </div>
                <label htmlFor="circular-file" className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">Replace</label>
                <button type="button" onClick={() => pickFile(null)} aria-label="Remove the file"
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label htmlFor="circular-file"
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-300 bg-slate-50 hover:border-primary-400 hover:bg-primary-50/40'}`}>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-primary-600 shadow-sm">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  Drop the circular here, or <span className="text-primary-700 underline underline-offset-2">browse</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">PDF, Word or text. Scanned copies are read too.</p>
              </label>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="circular-type" className="text-sm font-medium text-slate-700">Circular type *</label>
              {upload.detected?.source && upload.detected.source === upload.source && (
                <span className="text-xs text-emerald-700">Detected from the circular</span>
              )}
            </div>
            <select id="circular-type" value={upload.source} className={inputCls}
              onChange={(e) => setUpload((u) => ({ ...u, source: e.target.value, sourceTouched: true }))}>
              {REGULATORS.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="circular-title" className="mb-1 block text-sm font-medium text-slate-700">Title</label>
            <input id="circular-title" type="text" value={upload.title} placeholder="Filled in from the circular" className={inputCls}
              onChange={(e) => setUpload((u) => ({ ...u, title: e.target.value, titleEdited: true }))} />
            <p className="mt-1 text-xs text-slate-500">
              {upload.titleEdited && upload.title.trim() ? 'Your title is kept.' : 'No need to type: the AI sets the official title and reference as it reads.'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <Sparkles className="h-4 w-4 text-primary-600" /> What the AI does
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Reads every clause and lists each obligation in the circular&apos;s own words.</li>
              <li>Maps the impact on your policies and controls, and drafts the implementation tasks.</li>
              <li>Shows results as they are found, usually within two minutes. You can leave the page.</li>
            </ul>
          </div>
        </form>
      ) : (
        <form id="manual-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(''); if (manual.title.trim()) createMutation.mutate(); }}>
          <Field label="Title *">
            <input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} required autoFocus
              placeholder="e.g. Guidelines on cloud outsourcing" className={inputCls} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Regulator">
              <select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })} className={inputCls}>
                {REGULATORS.map((r) => <option key={r.value} value={r.value}>{r.hint}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input value={manual.reference_number} onChange={(e) => setManual({ ...manual, reference_number: e.target.value })}
                placeholder="e.g. BPRD Circular No. 07 of 2026" className={inputCls} />
            </Field>
            <Field label="Published">
              <input type="date" value={manual.publication_date} onChange={(e) => setManual({ ...manual, publication_date: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Effective">
              <input type="date" value={manual.effective_date} onChange={(e) => setManual({ ...manual, effective_date: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Owner">
              <MultiSelectDropdown title="Nobody yet" triggerVariant="input" size="md" multiSelect={false} autoApply forceSearch
                items={people} selectedValues={manual.assigned_to ? [manual.assigned_to] : []}
                onApply={(v) => setManual({ ...manual, assigned_to: v[0] || '' })} />
            </Field>
            <Field label="Priority">
              <Segmented value={manual.priority} options={PRIORITIES} onChange={(v) => setManual({ ...manual, priority: v })} label="Priority" />
            </Field>
          </div>
          <Field label="What it requires">
            <textarea rows={4} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })}
              placeholder="A few lines on what changes and for whom" className={`${inputCls} resize-y`} />
          </Field>
          <p className="text-xs text-slate-500">You can add obligations, impact assessments and tasks on the next page.</p>
        </form>
      )}

      {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    </RightSlidePanel>
  );
}
