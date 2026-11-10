'use client';

// A finding's Validation tab, in the client's own terms. The owner submits the materials (the edit right); Audit Services decide (the create right) in the Decision sheet: pass and close, or not
// passed (more materials, or failed). What each right may do is the server's rule; a person who holds neither sees the state and the history and no buttons. The history is every submission and
// decision with who and when.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Download, Paperclip, Send } from 'lucide-react';
import { Button, ErrorState, FormField, ReadOnlyNote, SkeletonLines, StatusPill, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient, { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingStatus, validationResult, validationStage } from '@/lib/statuses/auditRegister';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { REFRESH_FINDING, saveBlob } from './registerData';
import { ValidationDecision } from './ValidationDecision';

export type ValidationState = {
  layout: string; has_validation: boolean; stage: 'open' | 'awaiting_validation' | 'closed';
  status: string; recorded_status: string | null; days_past_due: number; due_date: string | null;
  validated_on: string | null; pass_fail: string | null; definitions: Record<string, string>;
  evidence: Array<{ id: number; name: string; file_name: string | null; status: string; uploaded_at: string | null }>;
  history: Array<{ type: string; result: string | null; text: string | null; files: number; by: string | null; at: string | null }>;
};

const HEAD = 'm-0 !text-ds-label !font-[600] !text-ds-fg-muted';
const fileWord = (n: number): string => `${formatCount(n)} ${n === 1 ? 'file' : 'files'}`;

export function ValidationPanel({ issueId, subject, owner, rights }: { issueId: number; subject: string; owner?: string | null; rights: RegisterRights }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [deciding, setDeciding] = useState(false);
  const validation = useQuery<ValidationState>({
    queryKey: ['audit-register-validation', issueId], retry: false,
    queryFn: async () => (await auditRegisterApi.validation(issueId)).data as ValidationState,
  });
  const submit = useReportedMutation({
    mutationFn: () => auditRegisterApi.submitValidation(issueId, note, files),
    success: 'Submitted for validation',
    failure: "Couldn't submit for validation",
    invalidate: REFRESH_FINDING(issueId),
    retryable: false,
    onSuccess: () => { setNote(''); setFiles([]); },
  });
  const download = useReportedMutation({
    mutationFn: async (f: { id: number; name: string }) => saveBlob((await apiClient.get(`/evidence/${f.id}/download`, { responseType: 'blob' })).data as Blob, f.name),
    failure: "Couldn't download the file",
    toast: 'errors',
  });

  if (validation.isLoading) return <SkeletonLines lines={5} label="Loading the validation" />;
  if (validation.isError || !validation.data) {
    return <ErrorState compact title="Couldn't load the validation" message={errorMessage(validation.error)} onRetry={() => { void validation.refetch(); }} />;
  }
  const v = validation.data;
  if (!v.has_validation) return <p className="m-0 text-ds-body text-ds-fg-muted">This kind of finding has no validation step in the client’s template.</p>;
  const open = v.stage !== 'closed';
  const canSubmit = open && can(rights, 'submitValidation');
  const canDecide = open && can(rights, 'decideValidation');
  const outcome = v.stage === 'closed'
    ? `Validated${v.validated_on ? ` ${formatDate(v.validated_on, { calendar: true })}` : ''}${v.pass_fail ? ` · ${v.pass_fail}` : ''}`
    : v.due_date ? `Target ${formatDate(v.due_date, { calendar: true })}` : 'No target date';

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill {...statusPill(validationStage, v.stage)} />
        <StatusPill {...statusPill(findingStatus, v.status)} />
        {v.days_past_due > 0 && open && <span className="text-ds-body font-[600] text-ds-danger">{formatCount(v.days_past_due)} {v.days_past_due === 1 ? 'day' : 'days'} past due</span>}
        <span className="text-ds-body text-ds-fg-muted">{outcome}</span>
      </div>

      {!canSubmit && !canDecide && open && <ReadOnlyNote>View only</ReadOnlyNote>}

      {v.evidence.length > 0 && (
        <section aria-label="Materials submitted" className="flex flex-col gap-[6px]">
          <h3 className={HEAD}>Materials submitted</h3>
          <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
            {v.evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-[8px]">
                <Paperclip aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{e.file_name || e.name}</span>
                <Button size="sm" leftIcon={<Download aria-hidden />} loading={download.isPending && download.variables?.id === e.id} onClick={() => download.mutate({ id: e.id, name: e.file_name || e.name })}>Download</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canSubmit && (
        <section aria-label="Submit for validation" className="flex flex-col gap-[8px]">
          <h3 className={HEAD}>Submit for validation</h3>
          <FormField label="What was done" hint="And where the materials are, when they are not attached.">
            <Textarea value={note} rows={3} disabled={submit.isPending} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <input
            ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Attach the validation materials"
            onChange={(e) => { setFiles(Array.from(e.target.files || [])); if (fileRef.current) fileRef.current.value = ''; }}
          />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<Paperclip aria-hidden />} onClick={() => fileRef.current?.click()}>{files.length ? fileWord(files.length) + ' attached' : 'Attach materials'}</Button>
            <Button variant="primary" leftIcon={<Send aria-hidden />} loading={submit.isPending} disabled={!note.trim() && files.length === 0} onClick={() => submit.mutate()}>Submit for validation</Button>
          </div>
        </section>
      )}

      {canDecide && (
        <section aria-label="Validate" className="flex flex-col gap-[8px]">
          <h3 className={HEAD}>Audit Services</h3>
          <div><Button variant={v.stage === 'awaiting_validation' ? 'primary' : 'secondary'} leftIcon={<ClipboardCheck aria-hidden />} onClick={() => setDeciding(true)}>Validate this finding</Button></div>
        </section>
      )}

      {v.history.length > 0 && (
        <section aria-label="History" className="flex flex-col gap-[8px]">
          <h3 className={HEAD}>History</h3>
          <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
            {v.history.map((h, i) => (
              <li key={`${h.type}-${h.at}-${i}`} className="flex flex-col gap-[2px] border-l-2 border-ds-border pl-[12px]">
                <span className="flex flex-wrap items-center gap-[8px]">
                  {h.type === 'validation_submitted' ? <span className="text-ds-body font-[600] text-ds-fg">Submitted</span> : <StatusPill size="sm" {...statusPill(validationResult, h.result)} />}
                  <span className="text-ds-label text-ds-fg-muted">{[h.by, h.at ? formatDateTime(h.at) : null, h.files ? fileWord(h.files) : null].filter(Boolean).join(' · ')}</span>
                </span>
                {h.text && <span className="whitespace-pre-wrap break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{h.text}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <ValidationDecision issueId={issueId} open={deciding} subject={subject} owner={owner} onClose={() => setDeciding(false)} />
    </div>
  );
}
