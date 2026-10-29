'use client';

// The bar that stays at the foot of the screen while a supplier answers: what is left, a way to reach it, and the send button,
// without scrolling back to the top of a long page. Sending stays off until nothing is left and everything has saved.

import { ArrowRight, CheckCircle, Loader2, Send } from 'lucide-react';
import { BTN, BTN_MAIN } from './styles';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function ReadyBar({ left, missing, notSaved, saving, error, canNext, sending, onNext, onSend }: {
  left: number;               // questions still to answer (or to give their words)
  missing: number;            // documents still owed
  notSaved: number;           // answers that did not save
  saving: boolean;
  error: string | null;       // why the last send did not go
  canNext: boolean;           // there is an open item to jump to
  sending: boolean;
  onNext: () => void;
  onSend: () => void;
}) {
  const open = left + missing + notSaved > 0;
  const ready = !open && !saving;
  return (
    <div className="sticky bottom-3 z-20 mt-6 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div role="status" aria-live="polite" aria-atomic="true">
            {open ? (
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                {left > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">{plural(left, 'question', 'questions')} left</span>}
                {missing > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">{plural(missing, 'document', 'documents')} missing</span>}
                {notSaved > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs text-rose-800">{plural(notSaved, 'answer', 'answers')} not saved</span>}
              </p>
            ) : ready ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                <CheckCircle aria-hidden className="h-4 w-4" /> Ready to send
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Saving…
              </p>
            )}
          </div>
          {error ? (
            <p role="alert" className="mt-1 text-sm text-rose-700">{error}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-600">{saving && open ? 'Saving…' : 'Sending closes this link.'}</p>
          )}
        </div>
        {canNext && (
          <button type="button" onClick={onNext} className={BTN}>
            Next to do <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onSend} disabled={!ready || sending} className={BTN_MAIN}>
          {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />} Send answers
        </button>
      </div>
    </div>
  );
}
