'use client';

// The bar that stays at the foot of the screen while a supplier answers: how far along (n of N answered), what is left, a way to reach it, a way to jump to a
// section, and the send button, without scrolling back to the top of a long page. Two rows at most on a phone: the words, then the buttons. Sending stays off
// until nothing is left and everything has saved.

import { ArrowRight, CheckCircle, ListTree, Loader2, Send } from 'lucide-react';
import { BTN, BTN_MAIN } from './styles';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function ReadyBar({ answered, total, left, missing, notSaved, saving, error, canNext, sending, onSections, onNext, onSend }: {
  answered: number;           // questions answered, of `total`
  total: number;
  left: number;               // questions still to answer (or to give their words)
  missing: number;            // documents still owed
  notSaved: number;           // answers that did not save
  saving: boolean;
  error: string | null;       // why the last send did not go
  canNext: boolean;           // there is an open item to jump to
  sending: boolean;
  /** open the list of sections (offered when there is more than one) */
  onSections?: () => void;
  onNext: () => void;
  onSend: () => void;
}) {
  const open = left + missing + notSaved > 0;
  const ready = !open && !saving;
  return (
    <div className="sticky bottom-3 z-20 mt-6 rounded-xl border border-ds-border bg-ds-surface p-3 shadow-lg">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-ds-fg">{answered} of {total} answered</span>
        {open ? (
          <>
            {left > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">{left} left</span>}
            {missing > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">{plural(missing, 'document', 'documents')} missing</span>}
            {notSaved > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800">{notSaved} not saved</span>}
          </>
        ) : ready ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800"><CheckCircle aria-hidden className="h-3.5 w-3.5" /> Ready to send</span>
        ) : null}
        {saving && <span className="inline-flex items-center gap-1 text-xs text-ds-fg-body"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-rose-700">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        {onSections && (
          <button type="button" onClick={onSections} aria-label="Sections" title="Sections" className={`${BTN} !w-[44px] !px-0 sm:!w-auto sm:!px-3`}>
            <ListTree aria-hidden className="h-4 w-4" /><span className="hidden sm:inline">Sections</span>
          </button>
        )}
        {canNext && (
          <button type="button" onClick={onNext} className={BTN}>
            Next<span className="hidden sm:inline">&nbsp;to do</span> <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onSend} disabled={!ready || sending} className={`${BTN_MAIN} ml-auto`}>
          {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />} Send answers
        </button>
      </div>
    </div>
  );
}
