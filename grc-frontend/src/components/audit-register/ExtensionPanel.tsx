'use client';

// A finding's Extension tab: every request for more time, how it stands and what the committee decided, and, for a finding still open, a request (the owner, the edit right) that goes on the
// Audit Committee's next meeting. Audit Services (the create right) record the committee's decision in the Decision sheet and, for a regulator's finding, the day the regulator was told.
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Send } from 'lucide-react';
import { Button, ErrorState, FormField, Notice, ReadOnlyNote, Select, SkeletonLines, StatusPill, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { extensionStatus } from '@/lib/statuses/auditRegister';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import type { ExtensionLine } from '@/lib/auditRegister/queuesModel';
import { localToday } from '@/lib/auditRegister/words';
import { ExtensionDecision } from './ExtensionDecision';
import { REFRESH_FINDING, useFinding } from './registerData';

type Meeting = { id: number; title: string; committee: string; scheduled_date: string | null };
const HEAD = 'm-0 !text-ds-label !font-[600] !text-ds-fg-muted';

export function ExtensionPanel({ issueId, rights }: { issueId: number; rights: RegisterRights }) {
  const finding = useFinding(issueId);
  const [deciding, setDeciding] = useState<ExtensionLine | null>(null);
  const [form, setForm] = useState({ date: '', reason: '', meeting: '' });
  const [told, setTold] = useState(localToday());
  const extensions = useQuery<ExtensionLine[]>({
    queryKey: ['audit-register-extensions', issueId], retry: false,
    queryFn: async () => (await auditRegisterApi.extensions(issueId)).data as ExtensionLine[],
  });
  const lines = extensions.data ?? [];
  const pending = lines.find((x) => x.status === 'requested');
  const open = finding.data?.workflow_state !== 'closed' && finding.data?.workflow_state !== 'cancelled';
  const canAsk = open && !pending && can(rights, 'requestExtension');
  const meetings = useQuery<Meeting[]>({
    queryKey: ['audit-register-extension-meetings'], retry: false, enabled: canAsk,
    queryFn: async () => (await auditRegisterApi.extensionMeetings()).data as Meeting[],
  });
  const ask = useReportedMutation({
    mutationFn: () => auditRegisterApi.requestExtension(issueId, { requested_date: form.date, reason: form.reason, meeting_id: form.meeting ? Number(form.meeting) : undefined }),
    success: 'Sent to the Audit Committee',
    failure: "Couldn't send the request",
    invalidate: REFRESH_FINDING(issueId),
    retryable: false,
    onSuccess: () => setForm({ date: '', reason: '', meeting: '' }),
  });
  const notice = useReportedMutation({
    mutationFn: (id: number) => auditRegisterApi.regulatorNotice(id, told),
    success: 'Recorded that the regulator was told',
    failure: "Couldn't record it",
    invalidate: REFRESH_FINDING(issueId),
  });

  if (extensions.isLoading || finding.isLoading) return <SkeletonLines lines={4} label="Loading the extension requests" />;
  if (extensions.isError) return <ErrorState compact title="Couldn't load the extension requests" message={errorMessage(extensions.error)} onRetry={() => { void extensions.refetch(); }} />;
  const regulator = (finding.data?.links?.regulator_statuses.length ?? 0) > 0;
  const today = localToday();

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 text-ds-body text-ds-fg-muted">A new target date needs the Audit Committee’s approval.</p>

      {lines.length === 0 && <p className="m-0 text-ds-body text-ds-fg-body">{open ? 'No extension has been asked for.' : 'Closed: no extension is needed.'}</p>}

      {lines.map((x) => (
        <section key={x.id} aria-label={`Request to move the target to ${formatDate(x.requested_date, { calendar: true })}`} className="flex flex-col gap-[6px] rounded-ds-card border border-ds-border p-[12px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="text-ds-body font-[600] text-ds-fg">{x.previous_date ? formatDate(x.previous_date, { calendar: true }) : 'No date'} → {formatDate(x.requested_date, { calendar: true })}</span>
            <StatusPill size="sm" {...statusPill(extensionStatus, x.status)} />
          </div>
          <p className="m-0 whitespace-pre-wrap break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{x.reason}{x.requested_by ? ` — ${x.requested_by}` : ''}</p>
          {x.meeting && (
            <Link href={`/governance/committees/meetings/${x.meeting.id}`} className="text-ds-body font-medium text-ds-primary-text underline underline-offset-2">
              {x.meeting.title}{x.meeting.scheduled_date ? ` · ${formatDate(x.meeting.scheduled_date)}` : ''}
            </Link>
          )}
          {x.decision_notes && <p className="m-0 break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">Decision: {x.decision_notes}</p>}
          {x.status === 'requested' && can(rights, 'decideExtension') && <div><Button variant="primary" onClick={() => setDeciding(x)}>Record the decision</Button></div>}
          {x.status === 'requested' && !can(rights, 'decideExtension') && <ReadOnlyNote>Audit Services record the committee’s decision</ReadOnlyNote>}
          {x.regulator_notified_on && <p className="m-0 text-ds-label text-ds-fg-muted">Regulator told {formatDate(x.regulator_notified_on, { calendar: true })}</p>}
          {x.needs_regulator_notice && (
            <Notice tone="warning" title="The regulator has to be told of this extension">
              {can(rights, 'regulatorNotice') ? (
                <span className="flex flex-wrap items-end gap-[8px]">
                  <FormField label="Told on" className="w-[170px]"><TextInput type="date" value={told} max={today} onChange={(e) => setTold(e.target.value)} /></FormField>
                  <Button loading={notice.isPending} disabled={!told} onClick={() => notice.mutate(x.id)}>Record that they were told</Button>
                </span>
              ) : 'Audit Services record the day the regulator was told.'}
            </Notice>
          )}
        </section>
      ))}

      {canAsk && (
        <section aria-label="Ask for more time" className="flex flex-col gap-[12px]">
          <h3 className={HEAD}>Ask for more time</h3>
          <FormField label="New target date" required><TextInput type="date" value={form.date} min={today} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField>
          <FormField label="Why the action plan needs more time" required><Textarea value={form.reason} rows={3} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>
          <FormField label="Committee meeting" hint={meetings.isError ? 'The meetings could not be read: it will go on the next one.' : meetings.data && meetings.data.length === 0 ? 'No upcoming meeting: the request is recorded without one.' : undefined}>
            <Select value={form.meeting} onChange={(e) => setForm({ ...form, meeting: e.target.value })}>
              <option value="">Next Audit Committee meeting</option>
              {(meetings.data || []).map((mt) => <option key={mt.id} value={mt.id}>{mt.committee} · {mt.title}{mt.scheduled_date ? ` · ${formatDate(mt.scheduled_date)}` : ''}</option>)}
            </Select>
          </FormField>
          <div><Button variant="primary" leftIcon={<Send aria-hidden />} loading={ask.isPending} disabled={!form.date || !form.reason.trim()} onClick={() => ask.mutate()}>Send to the Audit Committee</Button></div>
        </section>
      )}
      {open && !pending && !canAsk && <p className="m-0 flex items-center gap-[6px] text-ds-label text-ds-fg-muted"><CalendarClock aria-hidden className="h-[14px] w-[14px]" /> The finding’s owner asks for more time.</p>}

      <ExtensionDecision request={deciding} regulator={regulator} onClose={() => setDeciding(null)} />
    </div>
  );
}
