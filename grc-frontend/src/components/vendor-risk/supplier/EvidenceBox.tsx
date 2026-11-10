'use client';

// Where a supplier attaches the document a question asks for (or offers one), or sends it as the answer itself.
// Green once attached, amber while owed, grey when optional. Drop a file on it or use the button; the server
// checks the file.

import { useId, useRef, useState } from 'react';
import { CheckCircle, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import type { EvidenceFile, EvidenceTone } from './answerLogic';
import { ACCEPT } from './requestModel';
import { BTN, FOCUS, LINK } from './styles';

const TONE: Record<EvidenceTone, string> = {
  attached: 'border-emerald-300 bg-emerald-50',
  owed: 'border-amber-300 bg-amber-50',
  optional: 'border-ds-border bg-ds-surface-subtle',
  later: 'border-ds-border bg-ds-surface-subtle',
};

// What the server takes (backend routers/questionnaires.py), to narrow the file picker; the server checks again.


export default function EvidenceBox({ question, files, tone, badge, asAnswer, editable, busy, onFile, onRemove }: {
  question: string;                              // the question, to name the buttons for a screen reader
  files: EvidenceFile[];
  tone: EvidenceTone;
  badge: string;
  asAnswer: boolean;                             // the document is the answer, not proof for one
  editable: boolean;
  busy: boolean;
  /** `replace`: the ids of the documents this one takes the place of. */
  onFile: (file: File, expiresOn: string, replace: number[]) => void;
  onRemove: (id: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef(false);
  const dateId = useId();
  const [expires, setExpires] = useState('');
  const [over, setOver] = useState(false);
  const attached = files.length > 0;

  const choose = (replace: boolean) => { replacing.current = replace; input.current?.click(); };
  const take = (file: File | undefined, replace: boolean) => {
    if (!file || busy) return;
    onFile(file, expires, replace ? files.map((f) => f.id) : []);
    setExpires('');
  };

  const title = attached ? (files.length > 1 ? `${files.length} documents attached` : 'Document attached')
    : asAnswer ? 'Your document' : 'Supporting document';
  const said = attached ? (editable ? 'Sent to the reviewer. Replace it any time before you send.' : 'Sent to the reviewer.')
    : editable ? 'Drop a file or upload. PDF, Office, image or text, up to 25 MB.' : 'No document was sent.';
  const Icon = attached ? CheckCircle : FileText;

  return (
    <div
      onDragOver={editable ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={editable ? () => setOver(false) : undefined}
      onDrop={editable ? (e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0], files.length === 1); } : undefined}
      className={`mt-3 rounded-lg border px-3 py-2.5 transition-colors ${over ? 'border-[#0f766e] bg-[#e6f4f1]' : TONE[tone]}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden className={`h-5 w-5 shrink-0 ${attached ? 'text-emerald-700' : tone === 'owed' ? 'text-amber-700' : 'text-ds-fg-muted'}`} />
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ds-fg">
            {title}
            {!attached && badge && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone === 'owed' ? 'bg-amber-100 text-amber-900' : 'bg-ds-border text-ds-fg-body'}`}>
                {badge}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ds-fg-body">{said}</p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-3">
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label={`Choose a document for ${question}`}
              onChange={(e) => { take(e.target.files?.[0], replacing.current); e.target.value = ''; }} />
            <button type="button" disabled={busy} onClick={() => choose(files.length === 1)} aria-label={`${files.length === 0 ? 'Upload' : files.length === 1 ? 'Replace' : 'Add another'} document for ${question}`} className={BTN}>
              {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Upload aria-hidden className="h-4 w-4" />}
              {files.length === 0 ? 'Upload' : files.length === 1 ? 'Replace' : 'Add another'}
            </button>
            {files.length === 1 && (
              <button type="button" disabled={busy} onClick={() => choose(false)} aria-label={`Add another document for ${question}`} className={LINK}>Add another</button>
            )}
          </div>
        )}
      </div>

      {attached && (
        <ul className="mt-2 space-y-0.5">
          {files.map((f) => (
            <li key={f.id} className="flex min-w-0 items-center gap-2 text-sm text-ds-fg-body">
              <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0 text-ds-fg-muted" />
              <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              {editable && (
                <button type="button" disabled={busy} onClick={() => onRemove(f.id)} aria-label={`Remove ${f.file_name}`}
                  className={`-my-1 grid h-[44px] w-[44px] shrink-0 place-items-center rounded text-ds-fg-body hover:text-rose-700 disabled:opacity-50 ${FOCUS}`}>
                  <Trash2 aria-hidden className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ds-fg-body">
          <label htmlFor={dateId}>Expires on (optional)</label>
          <input id={dateId} type="date" value={expires} onChange={(e) => setExpires(e.target.value)}
            className={`min-h-[44px] rounded-md border border-ds-border-control bg-ds-surface px-2 py-1 text-[16px] text-ds-fg sm:text-[14px] ${FOCUS}`} />
        </div>
      )}
    </div>
  );
}
