'use client';

// A new regulatory change: upload the circular (the AI reads it; the regulator and title fill themselves from the file) or record one by hand. On the kit: a drawer that takes focus and asks
// "Discard changes?" before typed input is thrown away, FormField fields, a failure said in the drawer in plain words with what was typed kept, and a confirmation when it worked. What it sends
// is what the old panel sent (the identify preview, title_locked only when the person typed the title, a 15-minute upload).
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Sparkles, Upload, X } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, IconButton, SegmentedControl, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { regulatoryApi } from '@/lib/api';
import { PRIORITIES, REGULATORS } from './_lib/regulatoryModel';
import { CHANGE_REFRESH } from './_lib/data';
import { PersonPicker } from './_parts/shared';

export type CreateMode = 'circular' | 'manual';

/** What the server reads off the circular's head before anything is saved. */
interface Detected { source: string | null; reference: string | null; title: string | null }

interface UploadForm { file: File | null; source: string; sourceTouched: boolean; title: string; titleEdited: boolean; identifying: boolean; detected: Detected | null }
const EMPTY_UPLOAD: UploadForm = { file: null, source: 'SBP', sourceTouched: false, title: '', titleEdited: false, identifying: false, detected: null };
const EMPTY_MANUAL = { title: '', source: 'SBP', reference_number: '', publication_date: '', effective_date: '', priority: 'medium', assigned_to: null as number | null, description: '' };

const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
const MODES = [{ value: 'circular', label: 'Upload a circular' }, { value: 'manual', label: 'Enter manually' }] as const;

export default function CreatePanel({ open, mode, onMode, onClose }: { open: boolean; mode: CreateMode; onMode: (m: CreateMode) => void; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<UploadForm>(EMPTY_UPLOAD);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState('');

  const close = () => { setUpload(EMPTY_UPLOAD); setManual(EMPTY_MANUAL); setProblem(''); onClose(); };
  const done = (id: number) => { close(); router.push(`/governance/regulatory-changes/${id}`); };
  const dirty = mode === 'circular' ? !!upload.file || upload.titleEdited : JSON.stringify(manual) !== JSON.stringify(EMPTY_MANUAL);

  // A file is read for its regulator, reference and title as soon as it is picked, so nothing has to be typed; whatever the person already chose or typed stands.
  const pickFile = async (file: File | null) => {
    setProblem('');
    setUpload((u) => ({ ...u, file, detected: null, identifying: !!file, title: u.titleEdited ? u.title : file ? titleFromName(file.name) : '' }));
    if (!file) return;
    let found: Detected | null = null;
    try {
      found = (await regulatoryApi.identifyChangeDocument(file)).data as Detected;
    } catch {
      // not needed to go on: the AI reads the title and reference as it analyses
    }
    setUpload((u) => (u.file !== file ? u : {
      ...u, identifying: false, detected: found,
      source: found?.source && !u.sourceTouched ? found.source : u.source,
      title: found?.title && !u.titleEdited ? found.title : u.title,
    }));
  };

  // a create that lost its answer could be a second change if repeated: no Retry. The failure is shown in the drawer, so the toast only confirms.
  const uploadIt = useReportedMutation({
    mutationFn: async () => {
      if (!upload.file) throw new Error('Choose the circular to upload.');
      const title = upload.title.trim();
      return (await regulatoryApi.uploadChangeDocument(upload.file, { source: upload.source, title_hint: title || undefined, title_locked: upload.titleEdited && !!title })).data as { id: number };
    },
    success: { title: 'Circular uploaded', message: 'The AI is reading it. You can leave this page.' }, failure: "Couldn't upload the circular", retryable: false, toast: 'success',
    invalidate: CHANGE_REFRESH.map((k) => [...k]),
    onSuccess: (created) => done(created.id),
    onError: (e) => setProblem(errorMessage(e, 'The upload failed. Please try again.')),
  });
  const createIt = useReportedMutation({
    mutationFn: async () => (await regulatoryApi.createChange({
      title: manual.title.trim(), source: manual.source, reference_number: manual.reference_number.trim() || undefined,
      publication_date: manual.publication_date || undefined, effective_date: manual.effective_date || undefined, priority: manual.priority,
      assigned_to: manual.assigned_to ?? undefined, description: manual.description.trim() || undefined,
    })).data as { id: number },
    success: 'Change recorded', failure: "Couldn't save the change", retryable: false, toast: 'success',
    invalidate: CHANGE_REFRESH.map((k) => [...k]),
    onSuccess: (created) => done(created.id),
    onError: (e) => setProblem(errorMessage(e, 'The change could not be saved.')),
  });
  const busy = uploadIt.isPending || createIt.isPending;
  const canSubmit = mode === 'circular' ? !!upload.file : !!manual.title.trim();
  const submit = () => { setProblem(''); if (mode === 'circular') uploadIt.mutate(); else createIt.mutate(); };

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      dirty={dirty}
      title="New regulatory change"
      subtitle={mode === 'circular' ? 'Upload the circular. The AI reads it and maps what it means for you.' : 'Record a change by hand.'}
      width="w-full max-w-2xl"
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!canSubmit} leftIcon={mode === 'circular' ? <Sparkles aria-hidden /> : undefined} onClick={submit}>
            {mode === 'circular' ? (busy ? 'Uploading…' : 'Analyze with AI') : 'Create change'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <SegmentedControl label="How to add it" name="regulatory-create-mode" options={MODES} value={mode} onChange={(m) => { setProblem(''); onMode(m); }} />

        {mode === 'circular' ? (
          <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (canSubmit && !busy) submit(); }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void pickFile(e.dataTransfer.files?.[0] ?? null); }}
              className={`rounded-ds-card border border-dashed p-[16px] ${dragging ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface-subtle'}`}
            >
              <input ref={input} type="file" tabIndex={-1} aria-label="The circular" className="sr-only" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff"
                onChange={(e) => { void pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              {upload.file ? (
                <div className="flex items-center gap-[12px]">
                  <FileText aria-hidden className="h-[24px] w-[24px] shrink-0 text-ds-primary-text" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-ds-body font-[600] text-ds-fg" title={upload.file.name}>{upload.file.name}</p>
                    <p className="m-0 text-ds-label text-ds-fg-muted" role="status">
                      {fileSize(upload.file.size)} · {upload.identifying ? 'Reading the circular…' : upload.detected?.reference ? `Reference ${upload.detected.reference}` : 'Ready to analyze'}
                    </p>
                  </div>
                  <Button onClick={() => input.current?.click()}>Replace</Button>
                  <IconButton label="Remove the file" onClick={() => { void pickFile(null); }}><X aria-hidden /></IconButton>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-[8px] py-[16px] text-center">
                  <Upload aria-hidden className="h-[24px] w-[24px] text-ds-fg-muted" strokeWidth={1.5} />
                  <p className="m-0 text-ds-body text-ds-fg">Drop the circular here, or choose a file.</p>
                  <p className="m-0 text-ds-label text-ds-fg-muted">PDF, Word or text. Scanned copies are read too.</p>
                  <Button variant="primary" onClick={() => input.current?.click()}>Choose a file</Button>
                </div>
              )}
            </div>

            <FormField label="Circular type" required hint={upload.detected?.source && upload.detected.source === upload.source ? 'Detected from the circular.' : undefined}>
              <Select value={upload.source} onChange={(e) => setUpload((u) => ({ ...u, source: e.target.value, sourceTouched: true }))}>
                {REGULATORS.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Title" optional hint={upload.titleEdited && upload.title.trim() ? 'Your title is kept.' : 'No need to type: the AI sets the official title and reference as it reads.'}>
              <TextInput value={upload.title} maxLength={500} placeholder="Filled in from the circular" onChange={(e) => setUpload((u) => ({ ...u, title: e.target.value, titleEdited: true }))} />
            </FormField>
            <ul className="m-0 list-disc pl-[20px] text-ds-label text-ds-fg-muted">
              <li>It lists each obligation in the circular&apos;s own words.</li>
              <li>It maps the impact on your policies and controls and drafts the tasks.</li>
              <li>Results appear as they are found, usually within two minutes.</li>
            </ul>
          </form>
        ) : (
          <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (canSubmit && !busy) submit(); }}>
            <FormField label="Title" required>
              <TextInput autoFocus value={manual.title} maxLength={500} placeholder="e.g. Guidelines on cloud outsourcing" onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </FormField>
            <div className="grid gap-[12px] sm:grid-cols-2">
              <FormField label="Regulator">
                <Select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>
                  {REGULATORS.map((r) => <option key={r.value} value={r.value}>{r.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Reference" optional>
                <TextInput value={manual.reference_number} maxLength={255} placeholder="e.g. BPRD Circular No. 07 of 2026" onChange={(e) => setManual({ ...manual, reference_number: e.target.value })} />
              </FormField>
              <FormField label="Published" optional><TextInput type="date" value={manual.publication_date} onChange={(e) => setManual({ ...manual, publication_date: e.target.value })} /></FormField>
              <FormField label="Takes effect" optional><TextInput type="date" value={manual.effective_date} onChange={(e) => setManual({ ...manual, effective_date: e.target.value })} /></FormField>
              <FormField label="Owner" optional><PersonPicker label="Owner" value={manual.assigned_to} onChange={(id) => setManual({ ...manual, assigned_to: id })} placeholder="Nobody yet" /></FormField>
              <FormField label="Priority">
                <SegmentedControl label="Priority" name="regulatory-create-priority" options={PRIORITY_OPTIONS} value={manual.priority} onChange={(v) => setManual({ ...manual, priority: v })} />
              </FormField>
            </div>
            <FormField label="What it requires" optional hint="A few lines on what changes and for whom. You can add obligations, impact assessments and tasks on the next page.">
              <Textarea rows={4} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} placeholder="What changes and for whom" />
            </FormField>
          </form>
        )}

        {problem && <p role="alert" className="m-0 rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">{problem}</p>}
      </div>
    </RightSlidePanel>
  );
}
