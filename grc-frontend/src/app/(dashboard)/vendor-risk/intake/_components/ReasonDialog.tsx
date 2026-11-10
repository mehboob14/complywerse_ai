'use client';

// One reason, asked for in a small sheet: decline a request, send it back, or reopen it. The words the requester will read (at least ten characters, as the server asks). What was typed is
// not thrown away without asking.
import { useEffect, useId, useState } from 'react';
import { Button, FormField, Sheet, Textarea } from '@/components/ui/ds';

const MIN = 10;

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
    <Sheet
      open={open} onClose={onClose} title={title} subtitle={description} width="sm" dirty={text.length > 0 && !busy}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={id} variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={busy}>{confirmLabel}</Button>
        </div>
      )}
    >
      <form id={id} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(text); }}>
        <FormField label={label} required hint={ok ? undefined : `At least ${MIN} characters.`} error={error || undefined}>
          <Textarea rows={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}
