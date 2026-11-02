'use client';

// The three questions the workspace asks before it moves work: send it back (to which stage, and what has to change), skip a stage
// (why), and open a new review (why). Each needs a reason, which goes on the audit trail with the person's name.
import { useEffect, useState } from 'react';
import { BTN, BTN_PRIMARY, Dialog } from '@/app/(dashboard)/vendor-risk/_ui';

const FIELD = 'w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-[14px] text-[#1f2933] placeholder:text-[#8a95a1] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#99d5cf] disabled:bg-[#f3f6f8]';
const LABEL = 'mb-1 block text-[13px] font-medium text-[#26323d]';

function useReason(open: boolean) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  return [reason, setReason] as const;
}

export function SendBackDialog({ open, onClose, targets, initial, busy, onSubmit }: {
  open: boolean;
  onClose: () => void;
  /** the stages before the current one */
  targets: Array<{ key: string; label: string }>;
  /** the stage to preselect: the one being looked at, else the previous one */
  initial: string;
  busy: boolean;
  onSubmit: (target: string, reason: string) => void;
}) {
  const [reason, setReason] = useReason(open);
  const [target, setTarget] = useState(initial);
  useEffect(() => { if (open) setTarget(initial); }, [open, initial]);
  const label = targets.find((t) => t.key === target)?.label ?? '';
  return (
    <Dialog
      open={open} onClose={onClose} title="Send back" description="The stages in between reopen."
      footer={<>
        <button type="button" className={BTN} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !reason.trim() || !target} onClick={() => onSubmit(target, reason.trim())}>
          {busy ? 'Sending back…' : `Send back to ${label}`}
        </button>
      </>}
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="sendback-to">Back to</label>
          <select id="sendback-to" className={FIELD} value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="sendback-why">What has to change</label>
          <textarea id="sendback-why" data-autofocus rows={4} className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

export function ReasonDialog({ open, onClose, title, description, cta, busy, onSubmit }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  cta: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useReason(open);
  return (
    <Dialog
      open={open} onClose={onClose} title={title} description={description}
      footer={<>
        <button type="button" className={BTN} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>
          {busy ? 'Working…' : cta}
        </button>
      </>}
    >
      <label className={LABEL} htmlFor="reason-why">Reason</label>
      <textarea id="reason-why" data-autofocus rows={4} className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Dialog>
  );
}
