'use client';

// One question on a supplier's questionnaire. Choices and dates save the moment they are picked; text and numbers when the
// field is left (or on Enter in a one-line field). A "not applicable" pick, or one whose option asks for a note, waits for
// its words: they are asked for right there and the answer saves with them. A failed save shows a red line under the
// question. The question's upload box, its comment thread and the reviewer's question (when the questionnaire came back)
// are all here.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Loader2, Lock, MessageSquare, Paperclip, Send } from 'lucide-react';
import { parseUtc } from '@/lib/serverTime';
import { asChips, choicesOf, controlOf, evidenceBox, isWholeDate, leaveNote, noteNeeded, pickAnswer, wordsKept, type EvidenceFile, type PortalQuestion } from './answerLogic';
import type { QuestionMessage } from './portalCalls';
import EvidenceBox from './EvidenceBox';
import { BTN, FIELD, FOCUS, LINK } from './styles';

export interface QuestionProblem { text: string; retry: boolean }

function Choices({ q, name, labelledBy, shown, disabled, onPick, onClear }: {
  q: PortalQuestion; name: string; labelledBy: string; shown: string; disabled: boolean;
  onPick: (value: string) => void; onClear: () => void;
}) {
  const options = choicesOf(q);
  const picked = shown.trim().toLowerCase();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="radiogroup" aria-labelledby={labelledBy} className={asChips(options) ? 'flex flex-wrap items-center gap-2' : 'grid w-full gap-2'}>
        {options.map((o) => {
          const on = o.value.trim().toLowerCase() === picked;
          return (
            <label key={o.value} className={`relative block ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
              <input type="radio" name={name} value={o.value} checked={on} disabled={disabled} onChange={() => onPick(o.value)}
                className="peer sr-only" />
              <span className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f766e] peer-focus-visible:ring-offset-1 peer-disabled:opacity-70 ${
                on ? 'border-[#0f766e] bg-[#e6f4f1] font-medium text-[#0b4f4a]' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'}`}>
                <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                  on ? 'border-[#0f766e] bg-[#0f766e] text-white' : 'border-gray-400'}`}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 break-words">{o.label}</span>
              </span>
            </label>
          );
        })}
      </div>
      {picked && !disabled && (
        <button type="button" onClick={onClear} aria-label="Clear the answer" className={LINK}>Clear</button>
      )}
    </div>
  );
}

export default function QuestionCard(p: {
  q: PortalQuestion;
  number: number;
  value: string;                                   // the answer as saved
  comment: string;                                 // the note as saved
  files: EvidenceFile[];
  thread: QuestionMessage[];                       // comments shared on this question, and the replies
  editable: boolean;
  /** Returned for questions: what the reviewer asked; undefined when this one was not asked about. */
  asked: string | null | undefined;
  problem: QuestionProblem | null;
  uploading: boolean;
  onCommit: (value: string, comment: string) => void;
  onRetry: () => void;
  onUpload: (file: File, expiresOn: string, replace: number[]) => void;
  onRemove: (fileId: number) => void;
  onReply: (body: string) => Promise<boolean>;
  /** Tells the page that a pick is waiting for its words (so sending waits too), and that it no longer is. */
  onWaiting: (waiting: boolean) => void;
}) {
  const { q } = p;
  const ids = useId();
  const titleId = `${ids}t`;
  const noteId = `${ids}n`;
  const hintId = `${ids}h`;
  const kind = controlOf(q);
  const isAsked = p.asked !== undefined;

  const [pending, setPending] = useState<string | null>(null);     // a pick still waiting for its words
  const [text, setText] = useState(p.value);
  const [draft, setDraft] = useState(p.comment);
  const [noteOpen, setNoteOpen] = useState(!!p.comment || isAsked);   // once open it stays, even when emptied
  const [attachOpen, setAttachOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const note = useRef<HTMLTextAreaElement>(null);
  const wantFocus = useRef(false);

  useEffect(() => setText(p.value), [p.value]);                     // follow what was saved, without fighting typing
  useEffect(() => setDraft(p.comment), [p.comment]);
  useEffect(() => { if (draft) setNoteOpen(true); }, [draft]);
  const { onWaiting } = p;
  useEffect(() => {
    onWaiting(pending !== null);
    return () => onWaiting(false);
  }, [pending]);                                                     // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                                  // a box opened for the supplier takes focus once it is there
    if (wantFocus.current && note.current) { wantFocus.current = false; note.current.focus(); }
  });

  const shown = pending ?? p.value;
  const needed = noteNeeded(q, shown);                              // the words this answer asks for
  const noteShown = !!needed || noteOpen || !!draft || isAsked;
  const box = evidenceBox(q, p.value, p.files.length);
  const offerBox = box.show && box.quiet && !attachOpen;               // a document is allowed: offered, not pushed

  const saved = { value: p.value, comment: p.comment };

  const pick = (value: string) => {
    const result = pickAnswer(q, value, saved);
    if (result.act === 'wait') {
      setDraft('');                                                  // the box starts empty: an old comment is not a reason
      wantFocus.current = true;
      setPending(value);
      return;
    }
    setPending(null);
    setDraft(result.words);
    p.onCommit(value, result.words);
  };

  const clear = () => {
    if (pending !== null) { setPending(null); setDraft(p.comment); return; }      // a pick that never saved: back to what was
    if (!p.value) return;
    const words = wordsKept(q, saved);
    setDraft(words);
    p.onCommit('', words);
  };

  const saveText = () => {
    const value = text.trim();
    if (value !== p.value.trim()) p.onCommit(value, p.comment);
  };

  const saveNote = () => {
    const result = leaveNote(q, { pending, saved, draft });
    if (result.act === 'restore') setDraft(p.comment);
    else if (result.act === 'save') { setPending(null); p.onCommit(result.value, result.words); }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setReplying(true);
    const sent = await p.onReply(reply.trim());
    setReplying(false);
    if (sent) setReply('');
  };

  return (
    <li id={`question-${q.id}`} className="scroll-mt-24 py-5">
      <div className="flex gap-3">
        <span aria-hidden className="w-6 shrink-0 pt-0.5 text-right text-xs font-medium tabular-nums text-gray-500">{p.number}</span>
        <div className="min-w-0 flex-1">
          <p id={titleId} className="break-words text-base leading-6 text-gray-900">
            {q.text}
            {!q.required && <span className="ml-2 text-xs text-gray-600">Optional</span>}
          </p>
          {q.help_text && <p className="mt-0.5 text-sm text-gray-600">{q.help_text}</p>}
          {q.locked && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
              <Lock aria-hidden className="h-3.5 w-3.5" /> Answered by your certificate
            </p>
          )}
          {isAsked && (
            <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              <span className="font-medium">Your contact asks: </span>{p.asked || 'Please review this answer.'}
            </p>
          )}

          {kind === 'choice' && (
            <Choices q={q} name={`${ids}a`} labelledBy={titleId} shown={shown} disabled={!p.editable}
              onPick={pick} onClear={clear} />
          )}
          {kind === 'text' && (
            <textarea aria-labelledby={titleId} value={text} rows={3} maxLength={8000} disabled={!p.editable}
              onChange={(e) => setText(e.target.value)} onBlur={saveText} className={`mt-3 ${FIELD}`} />
          )}
          {(kind === 'number' || kind === 'date') && (
            <input type={kind} inputMode={kind === 'number' ? 'decimal' : undefined} aria-labelledby={titleId} value={text}
              disabled={!p.editable}
              onChange={(e) => { setText(e.target.value); if (kind === 'date' && isWholeDate(e.target.value) && e.target.value !== p.value) p.onCommit(e.target.value, p.comment); }}
              onBlur={saveText}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveText(); } }}
              className={`mt-3 max-w-[14rem] ${FIELD}`} />
          )}

          {noteShown && (
            <div className="mt-3">
              <label htmlFor={noteId} className="block text-sm font-medium text-gray-800">
                {needed === 'reason' ? 'Why this does not apply to you' : needed === 'note' ? 'Explain your answer'
                  : isAsked ? 'Your reply' : 'Comment (optional)'}
                {needed && <span aria-hidden className="ml-1 text-rose-700">*</span>}
              </label>
              <textarea id={noteId} ref={note} rows={2} maxLength={4000} value={draft} disabled={!p.editable}
                required={!!needed} aria-required={!!needed} aria-describedby={pending !== null ? hintId : undefined}
                onChange={(e) => setDraft(e.target.value)} onBlur={saveNote} className={`mt-1 ${FIELD}`} />
              {pending !== null && (
                <p id={hintId} className="mt-1 text-xs text-amber-900">Not saved yet. Add your words to keep this answer.</p>
              )}
            </div>
          )}

          {box.show && !offerBox && (p.editable || p.files.length > 0) && (
            <EvidenceBox question={q.text} files={p.files} tone={box.tone} badge={box.badge} asAnswer={kind === 'file'}
              editable={p.editable} busy={p.uploading} onFile={p.onUpload} onRemove={p.onRemove} />
          )}

          {p.editable && (!noteShown || offerBox) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {!noteShown && (
                <button type="button" onClick={() => { wantFocus.current = true; setNoteOpen(true); }} className={`inline-flex items-center gap-1 ${LINK}`}>
                  <MessageSquare aria-hidden className="h-3.5 w-3.5" /> Add a comment
                </button>
              )}
              {offerBox && (
                <button type="button" onClick={() => setAttachOpen(true)} className={`inline-flex items-center gap-1 ${LINK}`}>
                  <Paperclip aria-hidden className="h-3.5 w-3.5" /> Attach a document
                </button>
              )}
            </div>
          )}

          {p.thread.length > 0 && (
            <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                <MessageSquare aria-hidden className="h-3.5 w-3.5 text-[#0f766e]" /> Comments
              </p>
              <ul className="space-y-2">
                {p.thread.map((m) => (
                  <li key={m.id} className={`rounded-lg px-3 py-2 ${m.from_supplier ? 'ml-6 bg-[#e6f4f1]' : 'mr-6 bg-gray-50'}`}>
                    <p className="text-xs text-gray-600">
                      <span className="font-medium text-gray-800">{m.author || (m.from_supplier ? 'You' : 'Us')}</span>
                      {' · '}{parseUtc(m.created_at)?.toLocaleDateString() ?? ''}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-900">{m.body}</p>
                  </li>
                ))}
              </ul>
              <form className="flex flex-wrap items-end gap-2" onSubmit={send}>
                <label className="min-w-[200px] flex-1">
                  <span className="sr-only">Reply to the comments on question {p.number}</span>
                  <textarea rows={2} maxLength={8000} value={reply} placeholder="Reply" onChange={(e) => setReply(e.target.value)} className={FIELD} />
                </label>
                <button type="submit" disabled={replying || !reply.trim()} className={BTN}>
                  {replying ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />} Reply
                </button>
              </form>
            </div>
          )}

          {p.problem && (
            <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-rose-700">
              <AlertCircle aria-hidden className="h-4 w-4 shrink-0" />
              <span>{p.problem.text}</span>
              {p.problem.retry && (
                <button type="button" onClick={p.onRetry} className={`rounded font-medium underline ${FOCUS}`}>Try again</button>
              )}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
