'use client';

// The two sheets of the Work queue: the form of an action that asks for something (a note, who to assign it to, the day to bring it back, a closing note) and the history of one item.
// The form has its own state and is remounted for each item and action (the page keys it), so it never carries a draft from one to the next; a draft asks before it is thrown away (`dirty`).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ErrorState, FormField, Select, Sheet, SkeletonRows, Textarea, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDateTime } from '@/lib/format';
import { tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import {
  FORM_WORDS, SNOOZE_DEFAULT_DAYS, SNOOZE_MAX_DAYS, didWhat, snoozeDay, type QueueActivity, type QueueAnswer, type QueueForm, type QueueItem,
} from '../_lib/attentionModel';

export interface FormValues { text?: string; until?: string; assignee_id?: number | null }

export function ActionSheet({ item, action, assignees, pending, onSubmit, onClose }: {
  item: QueueItem; action: QueueForm; assignees: QueueAnswer['assignees']; pending: boolean; onSubmit: (values: FormValues) => void; onClose: () => void;
}) {
  const words = FORM_WORDS[action];
  const [text, setText] = useState('');
  const [until, setUntil] = useState(snoozeDay(SNOOZE_DEFAULT_DAYS));
  const [assignee, setAssignee] = useState(item.assignee_id ? String(item.assignee_id) : '');
  const needsText = action !== 'assign';
  const ready = !needsText || text.trim().length > 0;
  const dirty = text.trim() !== '' || (action === 'assign' && assignee !== (item.assignee_id ? String(item.assignee_id) : '')) || (action === 'snooze' && until !== snoozeDay(SNOOZE_DEFAULT_DAYS));
  const submit = () => onSubmit({
    text: text.trim() || undefined,
    until: action === 'snooze' ? until : undefined,
    assignee_id: action === 'assign' ? (assignee ? Number(assignee) : null) : undefined,
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={words.title}
      subtitle={item.title}
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={submit}>{words.submit}</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (ready && !pending) submit(); }}>
        {action === 'assign' && (
          <FormField label="Assign to">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Nobody: back to the vendor&apos;s owner</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </FormField>
        )}
        {action === 'snooze' && (
          <FormField label="Bring it back on" required>
            <TextInput type="date" required min={snoozeDay(1)} max={snoozeDay(SNOOZE_MAX_DAYS)} value={until} onChange={(e) => setUntil(e.target.value)} />
          </FormField>
        )}
        <FormField label={words.field} required={needsText} hint={action === 'close' ? 'The note goes on the vendor\'s audit trail. If this becomes urgent again on a new date, it comes back.' : undefined}>
          <Textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}

export function HistorySheet({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['tprm-attention-history', item.key],
    queryFn: async () => (await tpraApi.attentionHistory({ condition: item.condition, record_type: item.record_type, record_id: item.record_id })).data as { items: QueueActivity[] },
    ...TPRM_QUERY_OPTS,
  });
  const rows = q.data?.items ?? [];
  return (
    <Sheet open onClose={onClose} title="History" subtitle={item.title} width="md">
      {q.isPending && <SkeletonRows rows={3} columns={2} label="Loading the history" />}
      {q.isError && <ErrorState compact title="Couldn't load the history" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      {q.isSuccess && rows.length === 0 && <p className="m-0 text-ds-body text-ds-fg-muted">No notes or actions yet.</p>}
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
          {rows.map((a) => (
            <li key={a.id} className="border-b border-ds-border pb-[12px] last:border-b-0">
              <p className="m-0 text-ds-body text-ds-fg"><span className="font-[600]">{a.actor_name || 'Someone'}</span> {didWhat(a)}</p>
              <p className="m-0 text-ds-label text-ds-fg-muted">{formatDateTime(a.created_at)}</p>
              {a.text && <p className="m-0 mt-[4px] whitespace-pre-line text-ds-body text-ds-fg">{a.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
