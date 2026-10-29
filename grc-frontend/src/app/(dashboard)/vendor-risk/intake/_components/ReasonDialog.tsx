'use client';

// One reason, asked for in a 480px dialog: decline a request, send it back, or reopen it. The words the requester will read.
import { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { BTN, BTN_PRIMARY, Dialog } from '../../_ui';

const MIN = 10;
const FIELD = 'block w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-sm leading-5 text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30';
const DANGER_FILL = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#b42318] px-3 text-sm font-medium text-[#fff] hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

export default function ReasonDialog({ open, title, description, label = 'Reason', confirmLabel, danger = false, busy, error, onClose, onConfirm }: {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  /** a red confirm button, for a decision that turns something down */
  danger?: boolean;
  busy: boolean;
  /** why the last try failed, in the server's words */
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => { if (open) setReason(''); }, [open]);
  const text = reason.trim();
  const ok = text.length >= MIN;
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={id} disabled={!ok || busy} className={clsx(danger ? DANGER_FILL : BTN_PRIMARY)}>
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      )}>
      <form id={id} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(text); }}>
        <label htmlFor={`${id}-reason`} className="mb-1 block text-[13px] font-medium leading-5 text-[#26323d]">{label}</label>
        <textarea id={`${id}-reason`} data-autofocus rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} />
        <p className="mt-1 min-h-[16px] text-[12px] leading-4 text-[#64707e]">{ok ? null : `At least ${MIN} characters.`}</p>
        {error && <p role="alert" className="mt-2 text-[13px] leading-5 text-[#c01741]">{error}</p>}
      </form>
    </Dialog>
  );
}
