'use client';

// Remind owners: what would be sent today, before anything is. The preview lists every finding coming due, past due, delayed or not started with why it is on the list, how many owners would hear (one
// message each) and how many escalate to Audit Services; the same rules the daily job follows (Setup, Reminders and SLAs). Sending needs the create right, as the server asks, and says who was reminded.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button, Checkbox, ErrorState, SkeletonLines, Sheet, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { remindedLine, reminderReason, reminderSummary, type ReminderPreview } from '@/lib/auditRegister/words';

const SHOWN = 30;

export function RemindSheet({ open, onClose, onSetup }: { open: boolean; onClose: () => void; onSetup: () => void }) {
  const [email, setEmail] = useState(false);
  const preview = useQuery<ReminderPreview>({
    queryKey: ['audit-register-reminders'], enabled: open, retry: false,
    queryFn: async () => (await auditRegisterApi.previewReminders()).data as ReminderPreview,
  });
  // email or not starts from Settings; the box here decides for this send
  useEffect(() => { if (preview.data) setEmail(!!preview.data.email); }, [preview.data]);
  const send = useReportedMutation({
    mutationFn: async () => (await auditRegisterApi.sendReminders(email)).data as ReminderPreview,
    success: (d) => remindedLine(d),
    failure: "Couldn't send the reminders",
    invalidate: [['audit-register-reminders'], ['audit-register-rows']],
    retryable: false,
    onSuccess: () => onClose(),
  });
  const p = preview.data;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Remind owners"
      subtitle={p ? reminderSummary(p) : undefined}
      width="md"
      footer={(
        <div className="flex w-full flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button variant="primary" leftIcon={<Bell aria-hidden />} loading={send.isPending} disabled={!p || p.items.length === 0} onClick={() => send.mutate()}>{p && p.items.length === 0 ? 'Nobody to remind today' : 'Send reminders'}</Button>
        </div>
      )}
    >
      {preview.isLoading ? <SkeletonLines lines={6} label="Working out the reminders" />
        : preview.isError || !p ? <ErrorState compact title="Couldn't work out the reminders" message={errorMessage(preview.error)} onRetry={() => { void preview.refetch(); }} />
        : (
          <div className="flex flex-col gap-[12px]">
            <p className="m-0 text-ds-body text-ds-fg-body">
              {formatCount(p.owners)} {p.owners === 1 ? 'owner' : 'owners'}, one message each{p.escalated ? `; ${formatCount(p.escalated)} escalate to Audit Services` : ''}. When and how often follow the SLAs under{' '}
              <Button variant="link" onClick={() => { onClose(); onSetup(); }}>Setup, Reminders and SLAs</Button>.
            </p>
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0" aria-label="Findings to remind about">
              {p.items.slice(0, SHOWN).map((i) => (
                <li key={`${i.kind}-${i.issue_id}`} className="break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">
                  <span className="font-[600] text-ds-fg">{[i.reference, i.title].filter(Boolean).join(' · ')}</span> · {reminderReason(i)}
                </li>
              ))}
              {p.items.length > SHOWN && <li className="text-ds-label text-ds-fg-muted">And {formatCount(p.items.length - SHOWN)} more.</li>}
            </ul>
            <Checkbox label="Also email them (the in-app notification is always sent)" checked={email} disabled={send.isPending} onChange={(e) => setEmail(e.target.checked)} />
          </div>
        )}
    </Sheet>
  );
}
