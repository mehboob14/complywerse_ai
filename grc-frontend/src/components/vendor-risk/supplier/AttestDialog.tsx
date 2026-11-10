'use client';

// The last step before sending: a named person stands behind the answers. A native dialog, so the page behind it is
// inert, Escape closes it and focus comes back to the button that opened it.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import type { Attestation } from './portalCalls';
import { BTN, BTN_MAIN, FIELD } from './styles';

export default function AttestDialog({ open, initial, busy, onCancel, onConfirm }: {
  open: boolean;
  initial: Attestation;                         // the contact's own details, when the link is theirs
  busy: boolean;
  onCancel: () => void;
  onConfirm: (who: Attestation) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef(initial);
  first.current = initial;
  const ids = useId();
  const [who, setWho] = useState<Attestation>(initial);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setWho(first.current);
      setConfirmed(false);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onConfirm({ name: who.name.trim(), title: who.title.trim(), email: who.email.trim() });
  };
  const set = (key: keyof Attestation) => (e: { target: { value: string } }) => setWho((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <dialog ref={dialog} aria-labelledby={`${ids}t`} onClose={onCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-ds-border bg-ds-surface p-0 text-ds-fg shadow-2xl backdrop:bg-black/40">
      <form onSubmit={submit} className="p-5 sm:p-6">
        <h2 id={`${ids}t`} className="text-lg font-semibold text-ds-fg">Confirm and send</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ds-fg-body sm:col-span-2">
            Name
            <input required autoComplete="name" value={who.name} onChange={set('name')} className={`mt-1 ${FIELD}`} />
          </label>
          <label className="block text-sm font-medium text-ds-fg-body">
            Job title
            <input autoComplete="organization-title" value={who.title} onChange={set('title')} className={`mt-1 ${FIELD}`} />
          </label>
          <label className="block text-sm font-medium text-ds-fg-body">
            Email
            <input required type="email" autoComplete="email" value={who.email} onChange={set('email')} className={`mt-1 ${FIELD}`} />
          </label>
        </div>
        <label className="mt-4 flex min-h-[44px] items-start gap-3 text-sm text-ds-fg-body">
          <input required type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 accent-[#0f766e]" />
          <span>I confirm these answers are accurate and complete to the best of my knowledge, and that I am authorised to give them.</span>
        </label>
        <p className="mt-3 text-xs text-ds-fg-body">Sending closes this link.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={BTN}>Cancel</button>
          <button type="submit" disabled={busy} className={BTN_MAIN}>
            {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />} Send answers
          </button>
        </div>
      </form>
    </dialog>
  );
}
