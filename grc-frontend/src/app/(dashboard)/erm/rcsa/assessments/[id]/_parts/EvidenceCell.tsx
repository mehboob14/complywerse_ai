'use client';

// The evidence of one answer: the files already attached (name, size, when), "Add a file" while the unit can be edited, and Remove behind a question. Uploads and removals go through the
// API client (the old form used a bare fetch that had no error message and removed a file without a header or a question). A failure is said in a toast with what the server said; the
// list only changes when the server has answered. The size comes from the server now (it used to be 0 B for every file).
import { useRef, useState } from 'react';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { rcsaApi } from '@/lib/api';
import { Button, IconButton, useConfirm, useNotify } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';

export interface EvidenceFile { id: number; filename: string; file_size: number; uploaded_at?: string | null }

function size(bytes: number): string {
  if (!(bytes > 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceCell({ assessmentId, questionId, questionLabel, files, editable, onChange }: {
  assessmentId: number; questionId: number; questionLabel: string; files: EvidenceFile[]; editable: boolean; onChange: (next: EvidenceFile[]) => void;
}) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { data } = await rcsaApi.uploadEvidence(assessmentId, questionId, file);
      onChange([...files, { id: data.id, filename: data.filename ?? file.name, file_size: data.file_size ?? file.size, uploaded_at: data.uploaded_at }]);
      notify.success(`Added ${file.name}`);
    } catch (e) {
      notify.error(e, { title: "The file couldn't be added", fallback: 'Try again, or use a smaller file.', retry: () => { void upload(list); } });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (f: EvidenceFile) => {
    if (!(await confirm({ title: `Remove ${f.filename}?`, message: 'The file is deleted from this answer and from the evidence library.', confirmLabel: 'Remove file', tone: 'danger' }))) return;
    try {
      await rcsaApi.deleteEvidence(f.id);
      onChange(files.filter((x) => x.id !== f.id));
      notify.success(`Removed ${f.filename}`);
    } catch (e) {
      notify.error(e, { title: "The file couldn't be removed", fallback: 'It is still attached.' });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      {files.length === 0 && !editable && <span className="text-ds-body text-ds-fg-muted">No evidence</span>}
      {files.length > 0 && (
        <ul aria-label={`Evidence for: ${questionLabel}`} className="m-0 flex list-none flex-col gap-[2px] p-0">
          {files.map((f) => (
            <li key={f.id} className="flex min-w-0 items-center gap-[6px] text-ds-label text-ds-fg-body">
              <Paperclip aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" title={f.filename}>{f.filename}</span>
              <span className="shrink-0 text-ds-fg-muted">{[size(f.file_size), f.uploaded_at ? formatDate(f.uploaded_at) : ''].filter(Boolean).join(' · ')}</span>
              {editable && <IconButton label={`Remove ${f.filename}`} onClick={() => { void remove(f); }}><Trash2 aria-hidden /></IconButton>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <>
          <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void upload(e.target.files); }} />
          <div>
            <Button size="sm" loading={busy} leftIcon={<Upload aria-hidden />} aria-label={`Add a file for: ${questionLabel}`} onClick={() => input.current?.click()}>
              Add a file
            </Button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
