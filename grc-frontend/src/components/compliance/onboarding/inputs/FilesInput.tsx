'use client';

/**
 * Documents attached to an answer (a `files` field): each file with a download and a remove, and an Upload while there is room. Always optional: a field of this
 * kind is asked only after a yes (the existing statement, the last audit report), and nothing waits for it. A file goes to the server first (it is kept in
 * Evidence), then the new list is the field's value and the page saves it like any other answer. A refused file says why, under the button.
 */
import { useRef, useState } from 'react';
import { Download, Paperclip, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/ds';
import { onboardingApi, problemOf, type FieldInputProps } from '@/lib/frameworkOnboarding';
import { filesOf, MAX_FILES } from '../fieldModel';

const ROW = 'flex items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface py-[2px] pl-[10px] pr-[2px]';
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg';

export default function FilesInput({ id, label, value, onChange, readOnly = false }: Pick<FieldInputProps, 'id' | 'value' | 'onChange' | 'readOnly'> & { id: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const files = filesOf(value);
  const problemId = `${id}-problem`;

  async function attach(file: File) {
    setBusy(true);
    setProblem(null);
    try {
      onChange([...files, await onboardingApi.uploadFile(file)]);
    } catch (e) {
      setProblem(problemOf(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={label} className="space-y-[8px]">
      {files.length > 0 && (
        <ul className="space-y-[4px]">
          {files.map((f) => (
            <li key={f.id} className={ROW}>
              <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg">{f.name}</span>
              <IconButton label={`Download ${f.name}`} onClick={() => { setProblem(null); onboardingApi.downloadFile(f).catch((e) => setProblem(problemOf(e).message)); }}>
                <Download aria-hidden />
              </IconButton>
              {!readOnly && <IconButton label={`Remove ${f.name}`} onClick={() => onChange(files.filter((x) => x.id !== f.id))}><X aria-hidden /></IconButton>}
            </li>
          ))}
        </ul>
      )}
      {files.length === 0 && readOnly && <span className="block text-ds-body text-ds-fg-muted">Nothing attached</span>}
      {!readOnly && files.length < MAX_FILES && (
        <>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" tabIndex={-1} aria-label={`Choose a file for ${label}`}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
          <Button id={`${id}-upload`} size="sm" leftIcon={<Paperclip aria-hidden />} loading={busy} aria-describedby={problem ? problemId : undefined} onClick={() => input.current?.click()}>
            {files.length === 0 ? 'Upload a file' : 'Upload another'}
          </Button>
        </>
      )}
      {problem && <p id={problemId} role="alert" className="break-words text-ds-label font-normal text-ds-danger">{problem}</p>}
    </div>
  );
}
