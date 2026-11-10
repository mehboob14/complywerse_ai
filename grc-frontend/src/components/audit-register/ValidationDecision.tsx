'use client';

// Audit Services' decision on a submission, in the Auditor Portal's Decision sheet: "Pass and close" or "Not passed". Not passed has two meanings in the client's workbook (more materials are
// needed: Delayed; or it failed) and either needs the words that say what is missing, so the sheet asks which, beside the client's own status definitions read from their workbook.
// The sheet saves nothing itself: this component owns the request, shows its failure in the sheet with Try again, and tells the page when it went through.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DecisionSheet } from '@/components/auditor-portal/DecisionSheet';
import type { Decision } from '@/components/auditor-portal/decisionModel';
import { AccordionRow, FormField, SegmentedControl, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { NOT_PASSED, findingStatus, validationStage } from '@/lib/statuses/auditRegister';
import { REFRESH_FINDING } from './registerData';
import type { ValidationState } from './ValidationPanel';

type Outcome = (typeof NOT_PASSED)[number]['value'];
const DEFINITION_ORDER = ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD', 'COMPLETE'];

export function ValidationDecision({ issueId, open, subject, owner, onClose }: {
  issueId: number; open: boolean; subject: string; owner?: string | null; onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('more_info');
  useEffect(() => { if (open) setOutcome('more_info'); }, [open, issueId]);
  const validation = useQuery<ValidationState>({
    queryKey: ['audit-register-validation', issueId], enabled: open, retry: false,
    queryFn: async () => (await auditRegisterApi.validation(issueId)).data as ValidationState,
  });
  const decide = useReportedMutation({
    mutationFn: async (v: { result: 'pass' | 'more_info' | 'fail'; reason: string }) => (await auditRegisterApi.decideValidation(issueId, v.result, v.reason)).data,
    success: (_d, v) => (v.result === 'pass' ? 'Finding passed and closed' : v.result === 'more_info' ? 'Sent back for more materials' : 'Recorded as not passed'),
    failure: "Couldn't record the decision",
    invalidate: REFRESH_FINDING(issueId),
    toast: 'success',                       // a failure is shown in the sheet, with Try again
    retryable: false,
    onSuccess: () => onClose(),
  });
  const v = validation.data;
  const definitions = v ? DEFINITION_ORDER.filter((k) => v.definitions[k]) : [];
  const busy: Decision | null = decide.isPending ? (decide.variables?.result === 'pass' ? 'approved' : 'rejected') : null;

  return (
    <DecisionSheet
      open={open}
      onClose={onClose}
      title="Validate this finding"
      subject={subject}
      facts={v ? [
        { label: 'Status', value: <StatusPill size="sm" {...statusPill(findingStatus, v.status)} /> },
        { label: 'Submission', value: <StatusPill size="sm" {...statusPill(validationStage, v.stage)} /> },
        { label: 'Owner', value: owner },
        { label: 'Materials', value: v.evidence.length ? `${v.evidence.length} ${v.evidence.length === 1 ? 'file' : 'files'}` : 'None attached' },
      ] : undefined}
      approveLabel="Pass and close"
      rejectLabel="Not passed"
      remarks={{ requiredFor: 'rejected', label: 'What is missing, or why it did not pass', hint: 'Needed unless it passes: the owner reads it to know what to send.' }}
      busy={busy}
      error={decide.isError ? errorMessage(decide.error) : null}
      onDecide={(decision, reason) => decide.mutate({ result: decision === 'approved' ? 'pass' : outcome, reason })}
    >
      <div className="flex flex-col gap-[12px]">
        <FormField label="If it is not passed" hint={NOT_PASSED.find((n) => n.value === outcome)?.hint}>
          <SegmentedControl
            label="What not passing means" name={`validation-outcome-${issueId}`} value={outcome} onChange={(x) => setOutcome(x as Outcome)}
            options={NOT_PASSED.map((n) => ({ value: n.value, label: n.label }))}
          />
        </FormField>
        {definitions.length > 0 && v && (
          <AccordionRow title="The client’s status definitions" meta="From their workbook" level={4}>
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {definitions.map((k) => (
                <li key={k} className="text-ds-body text-ds-fg-body"><span className="font-[600] text-ds-fg">{k}</span> — {v.definitions[k]}</li>
              ))}
            </ul>
          </AccordionRow>
        )}
      </div>
    </DecisionSheet>
  );
}
