'use client';

// The Audit Committee's decision on an extension request, recorded by Audit Services (the create right, as the server asks) in the Decision sheet: approve (the finding gets the revised date and
// is marked Extension) or not approve. The committee's words are kept "as minuted"; for a regulator's finding the date the regulator was told can be recorded with the approval.
import { useEffect, useState } from 'react';
import { DecisionSheet } from '@/components/auditor-portal/DecisionSheet';
import type { Decision } from '@/components/auditor-portal/decisionModel';
import { FormField, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ExtensionLine } from '@/lib/auditRegister/queuesModel';
import { localToday } from '@/lib/auditRegister/words';
import { REFRESH_ALL, REFRESH_FINDING } from './registerData';

export function ExtensionDecision({ request, regulator, onClose }: { request: ExtensionLine | null; regulator: boolean; onClose: () => void }) {
  const [notified, setNotified] = useState('');
  useEffect(() => { setNotified(''); }, [request?.id]);
  const decide = useReportedMutation({
    mutationFn: async (v: { approve: boolean; notes: string }) => (await auditRegisterApi.decideExtension((request as ExtensionLine).id, {
      approve: v.approve, notes: v.notes, regulator_notified_on: v.approve && regulator && notified ? notified : undefined,
    })).data,
    success: (_d, v) => (v.approve ? 'Extension approved' : 'Extension not approved'),
    failure: "Couldn't record the decision",
    invalidate: request ? [...REFRESH_FINDING(request.issue_id), ['audit-register-all-extensions']] : REFRESH_ALL,
    toast: 'success',
    retryable: false,
    onSuccess: () => onClose(),
  });
  const busy: Decision | null = decide.isPending ? (decide.variables?.approve ? 'approved' : 'rejected') : null;
  const title = request ? [request.reference, request.title].filter(Boolean).join(' · ') : '';

  return (
    <DecisionSheet
      open={!!request}
      onClose={onClose}
      title="Decide the extension"
      subject={title || 'Extension request'}
      facts={request ? [
        { label: 'Target date now', value: formatDate(request.previous_date, { calendar: true }) },
        { label: 'Date asked for', value: formatDate(request.requested_date, { calendar: true }) },
        { label: 'Asked by', value: request.requested_by },
        { label: 'Committee meeting', value: request.meeting ? `${request.meeting.title}${request.meeting.scheduled_date ? ` · ${formatDate(request.meeting.scheduled_date)}` : ''}` : 'No meeting yet' },
      ] : undefined}
      approveLabel="Approve"
      rejectLabel="Not approved"
      remarks={{ requiredFor: 'none', label: 'The committee’s decision, as minuted', hint: 'Kept with the decision and sent to the owner.' }}
      busy={busy}
      error={decide.isError ? errorMessage(decide.error) : null}
      onDecide={(decision, notes) => decide.mutate({ approve: decision === 'approved', notes })}
    >
      <div className="flex flex-col gap-[12px]">
        {request && (
          <div className="flex flex-col gap-[4px]">
            <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Why more time is needed</p>
            <p className="m-0 whitespace-pre-wrap break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{request.reason}</p>
          </div>
        )}
        {regulator && (
          <FormField label="Regulator told on" optional hint="If you approve and the regulator has been told already, record the date.">
            <TextInput type="date" value={notified} max={localToday()} onChange={(e) => setNotified(e.target.value)} />
          </FormField>
        )}
      </div>
    </DecisionSheet>
  );
}
