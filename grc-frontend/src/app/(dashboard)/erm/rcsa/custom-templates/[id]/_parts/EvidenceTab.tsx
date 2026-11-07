'use client';

// The evidence tab of an item: the files kept with it, and two ways to add one (upload a file, or pick one from the organisation's evidence library). A file is downloaded through the signed-in
// API client (a plain link would arrive without the sign-in), and deleting one asks first. A file linked from the library is only unlinked here: the library keeps it.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Library, Trash2, Upload } from 'lucide-react';
import { Button, Combobox, EmptyState, ErrorState, FormError, FormField, IconButton, SegmentedControl, SkeletonLines, StatusPill, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import apiClient, { rcsaApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDateTime, truncate } from '@/lib/format';
import { safeFileName, sizeText } from '@/lib/rcsa/registerModel';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { FilePicker } from '../../../templates/_parts/FilePicker';
import { itemsChanged } from './registerData';

interface Evidence {
  id: number;
  file_name: string;
  file_size?: number | null;
  description?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  linked_evidence_id?: number | null;
}

interface LibraryItem { id: number; name: string; file_name?: string | null; evidence_type?: string | null; status?: string | null }

type Mode = 'upload' | 'library';

function AttachCard({ templateId, rowId }: { templateId: number; rowId: number }) {
  const [mode, setMode] = useState<Mode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const library = useQuery({
    queryKey: ['rcsa', 'evidence-library'],
    enabled: mode === 'library',
    staleTime: 30_000,
    queryFn: async () => (await rcsaApi.customTemplates.listEvidenceLibrary()).data as LibraryItem[],
  });
  const reset = () => { setFile(null); setPicked(null); setDescription(''); setProblem(null); };
  const invalidate = [['rcsa', 'register-evidence', templateId, rowId], ...itemsChanged(templateId)];

  const upload = useReportedMutation({
    mutationFn: () => rcsaApi.customTemplates.uploadRowEvidence(templateId, rowId, file as File, description.trim() || undefined),
    success: 'File added',
    failure: "The file wasn't added",
    toast: 'success',
    retryable: false,
    invalidate,
    onSuccess: reset,
    onError: (e) => setProblem(e),
  });
  const link = useReportedMutation({
    mutationFn: () => rcsaApi.customTemplates.linkRowEvidenceFromLibrary(templateId, rowId, Number(picked), description.trim() || undefined),
    success: 'Evidence linked',
    failure: "The evidence wasn't linked",
    toast: 'success',
    retryable: false,
    invalidate,
    onSuccess: reset,
    onError: (e) => setProblem(e),
  });
  const items = library.data ?? [];

  return (
    <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
      <SegmentedControl<Mode>
        label="How to add evidence"
        name={`evidence-mode-${rowId}`}
        value={mode}
        onChange={(m) => { setMode(m); setProblem(null); }}
        options={[{ value: 'upload', label: 'Upload a file' }, { value: 'library', label: 'From the library' }]}
      />
      <FormError title={mode === 'upload' ? "The file wasn't added" : "The evidence wasn't linked"} error={problem} />
      {mode === 'upload' ? (
        <FormField label="File" hint="Up to 50 MB."><FilePicker file={file} onChange={setFile} /></FormField>
      ) : library.isError ? (
        <ErrorState compact title="Couldn't load the evidence library" message={errorMessage(library.error)} onRetry={() => { void library.refetch(); }} />
      ) : (
        <FormField label="Evidence" hint={items.length >= 200 ? 'Showing the first 200 items. Search to narrow the list.' : library.isLoading ? undefined : items.length === 0 ? 'The evidence library has nothing yet.' : undefined}>
          <Combobox
            label="Evidence from the library"
            options={items.map((e) => ({ value: String(e.id), label: e.name, description: [e.file_name, e.evidence_type].filter(Boolean).join(' · ') || undefined }))}
            value={picked}
            onChange={setPicked}
            placeholder={library.isLoading ? 'Loading the library' : 'Choose evidence'}
            searchable
            disabled={library.isLoading || items.length === 0}
            clearable
          />
        </FormField>
      )}
      <FormField label="What does it show?" optional><Textarea rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
      <div className="flex justify-end">
        {mode === 'upload' ? (
          <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={upload.isPending} disabled={!file} onClick={() => { setProblem(null); upload.mutate(); }}>Add the file</Button>
        ) : (
          <Button variant="primary" leftIcon={<Library aria-hidden />} loading={link.isPending} disabled={!picked} onClick={() => { setProblem(null); link.mutate(); }}>Link the evidence</Button>
        )}
      </div>
    </div>
  );
}

export function EvidenceTab({ templateId, rowId, canEdit }: { templateId: number; rowId: number; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const list = useQuery({
    queryKey: ['rcsa', 'register-evidence', templateId, rowId],
    queryFn: async () => (await rcsaApi.customTemplates.listRowEvidence(templateId, rowId)).data as Evidence[],
  });
  const download = useReportedMutation({
    mutationFn: async (e: Evidence) => {
      const r = await apiClient.get(rcsaApi.customTemplates.downloadRowEvidenceUrl(templateId, rowId, e.id), { responseType: 'blob' });
      saveBlob(r.data as Blob, safeFileName(e.file_name, 'evidence'));
    },
    failure: "The file couldn't be downloaded",
    fallback: 'It may have been removed. Try again in a moment.',
    toast: 'errors',
  });
  const remove = useReportedMutation({
    mutationFn: (e: Evidence) => rcsaApi.customTemplates.deleteRowEvidence(templateId, rowId, e.id),
    success: (_, e) => (e.linked_evidence_id ? 'Evidence unlinked' : 'File deleted'),
    failure: "The file wasn't removed",
    toast: 'always',
    retryable: false,
    invalidate: [['rcsa', 'register-evidence', templateId, rowId], ...itemsChanged(templateId)],
  });
  const ask = async (e: Evidence) => {
    const linked = !!e.linked_evidence_id;
    const ok = await confirm({
      title: linked ? `Unlink "${truncate(e.file_name, 60).text}"?` : `Delete "${truncate(e.file_name, 60).text}"?`,
      message: linked ? 'It stays in the evidence library; only the link to this item is removed.' : 'The file is removed from this item. This cannot be undone.',
      confirmLabel: linked ? 'Unlink evidence' : 'Delete file',
      tone: 'danger',
    });
    if (ok) remove.mutate(e);
  };
  const items = list.data ?? [];
  return (
    <div className="flex flex-col gap-[12px]">
      {canEdit && <AttachCard templateId={templateId} rowId={rowId} />}
      {list.isLoading ? (
        <SkeletonLines lines={3} label="Loading the evidence" />
      ) : list.isError ? (
        <ErrorState compact title="Couldn't load the evidence" message={errorMessage(list.error)} onRetry={() => { void list.refetch(); }} />
      ) : items.length === 0 ? (
        <EmptyState kind="firstUse" bare title="No evidence yet" description={canEdit ? 'Add a file, or link one from the evidence library, to show how the controls of this item work.' : 'Nothing has been attached to this item.'} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((e) => (
            <li key={e.id} className="flex min-w-0 items-start gap-[10px] border-t border-ds-border py-[8px] first:border-t-0">
              <FileText aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => download.mutate(e)} title={e.file_name} className="block max-w-full truncate rounded-ds-control text-left text-ds-body font-[500] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{e.file_name}</button>
                <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
                  <span>{`${e.uploaded_by_name || 'Someone'} · ${formatDateTime(e.uploaded_at)}`}</span>
                  {e.file_size != null && <span>{sizeText(e.file_size)}</span>}
                  {e.linked_evidence_id ? <StatusPill size="sm" tone="neutral" label="From the library" /> : null}
                </span>
                {e.description && <span className="mt-[2px] block text-ds-body text-ds-fg [overflow-wrap:anywhere]">{e.description}</span>}
              </div>
              <IconButton label={`Download ${e.file_name}`} onClick={() => download.mutate(e)}><Download aria-hidden /></IconButton>
              {canEdit && <IconButton label={`${e.linked_evidence_id ? 'Unlink' : 'Delete'} ${e.file_name}`} onClick={() => { void ask(e); }}><Trash2 aria-hidden /></IconButton>}
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
