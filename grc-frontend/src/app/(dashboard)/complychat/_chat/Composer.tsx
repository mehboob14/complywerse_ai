'use client';

// The box the question is typed in: a labelled field that grows with its text, Enter to send and Shift+Enter for a new line (not while an input method
// is composing a word, which Arabic and Urdu keyboards do), a paperclip with the types and size said next to it, the files waiting to go with the
// question (each removable) and the files already in this chat (by name only). While an answer is coming, Send is Stop.
import { forwardRef, useImperativeHandle, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Paperclip, Send, Square, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/ds/Button';
import { Notice } from '@/components/ui/ds/Notice';
import { useAutoGrow } from '@/lib/useAutoGrow';
import { ACCEPT_ATTR, checkFiles, formatSize, MAX_PENDING, UPLOAD_HELP, type Refused } from './uploadRules';
import type { AttachedFile } from './chatModel';

export interface ComposerHandle {
  /** puts a question in the box and focuses it (Edit question, a new chat) */
  setText: (text: string) => void;
  focus: () => void;
}

export interface ComposerProps {
  /** the files already in this chat */
  attached: readonly AttachedFile[];
  /** a request is in flight: Send becomes Stop */
  busy: boolean;
  uploading: boolean;
  /** called with what was typed and the files waiting; true when the question was taken (the box then empties) */
  onSubmit: (text: string, files: File[]) => Promise<{ accepted: true } | { accepted: false; message: string }>;
  onStop: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ attached, busy, uploading, onSubmit, onStop }, ref) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useAutoGrow(box, text);
  useImperativeHandle(ref, () => ({
    setText: (t: string) => { setText(t); window.setTimeout(() => { box.current?.focus(); const end = t.length; box.current?.setSelectionRange(end, end); }, 0); },
    focus: () => box.current?.focus(),
  }), []);

  const canSend = (text.trim().length > 0 || files.length > 0) && !busy && !uploading;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    setProblem(null);
    const result = await onSubmit(text, files);
    if (result.accepted) { setText(''); setFiles([]); setRefused([]); box.current?.focus(); }
    else setProblem(result.message);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';                                      // the same file can be picked again after it was removed
    if (picked.length === 0) return;
    const { accepted, refused: no } = checkFiles(picked, files.length);
    setRefused(no);
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
  };

  return (
    <div className="border-t border-ds-border bg-ds-surface px-[12px] pb-[10px] pt-[10px]">
      {attached.length > 0 && (
        <ul aria-label="Files in this chat" className="mb-[8px] flex flex-wrap gap-[6px]">
          {attached.map((f) => (
            <li key={`${f.id}-${f.filename}`} className="inline-flex max-w-full items-center gap-[4px] rounded-full border border-ds-border bg-ds-surface-subtle px-[10px] py-[2px] text-ds-label text-ds-fg-body">
              <Paperclip aria-hidden className="h-[12px] w-[12px] shrink-0" strokeWidth={1.75} />
              <span className="max-w-[220px] truncate">{f.filename}</span>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul aria-label="Files that will be sent with your question" className="mb-[8px] flex flex-wrap gap-[6px]">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-[2px] rounded-full bg-ds-primary-soft py-[0px] pl-[10px] pr-[2px] text-ds-label text-ds-primary-text">
              <span className="max-w-[200px] truncate">{f.name}</span>
              <span className="shrink-0 text-ds-fg-muted">{formatSize(f.size)}</span>
              <IconButton label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}><X /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {refused.length > 0 && (
        <Notice tone="warning" className="mb-[8px]" action={<Button size="sm" onClick={() => setRefused([])}>Dismiss</Button>}>
          {refused.map((r) => <span key={r.name} className="block">{r.reason}</span>)}
        </Notice>
      )}
      {problem && <Notice tone="danger" title="Your question was not sent" className="mb-[8px]">{problem}</Notice>}

      <form onSubmit={submit} className="flex items-end gap-[8px]">
        <input ref={picker} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
        <IconButton label="Attach files" variant="secondary" disabled={files.length >= MAX_PENDING || busy} onClick={() => picker.current?.click()}><Paperclip /></IconButton>
        <div className="min-w-0 flex-1">
          <label htmlFor="complychat-message" className="sr-only">Message to Comply Agent</label>
          <textarea
            id="complychat-message"
            ref={box}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about controls, evidence, risks or your documents"
            className="block max-h-[40vh] min-h-ds-control w-full resize-none rounded-ds-control border border-ds-border-control bg-ds-surface px-[12px] py-[6px] text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring"
          />
        </div>
        {busy ? (
          <Button leftIcon={<Square aria-hidden />} onClick={onStop}>Stop</Button>
        ) : (
          <Button type="submit" variant="primary" leftIcon={<Send aria-hidden />} loading={uploading} disabled={!canSend && !uploading}>Send</Button>
        )}
      </form>
      <p className="mt-[6px] text-ds-label text-ds-fg-muted">{UPLOAD_HELP}</p>
      <p className="mt-[2px] text-ds-label text-ds-fg-muted">Comply Agent can make mistakes: check important answers against the source. Chats are saved in this browser only.</p>
    </div>
  );
});
