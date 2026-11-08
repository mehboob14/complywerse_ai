'use client';

/**
 * The evidence of one control, inside its drawer: the files attached (with where each stands in review and what the AI review found), Attach a file, Send for review (a file attached
 * is a draft until somebody sends it: that is what puts it in the approvals queue), and the AI's suggestions of what to collect. Deciding a review stays on the Pending Approvals page.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, Send, Sparkles } from 'lucide-react';
import { Button, EmptyState, ErrorState, SkeletonLines, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { statusPill } from '@/lib/status';
import { approvalWord, evidenceApproval } from '@/lib/statuses/assessments';
import { formatDate, orEmpty } from '@/lib/format';
import { AiEvidenceDialog } from '@/components/compliance/AiEvidenceAdvisor';
import { reviewPollMs } from '@/components/compliance/EvidenceQualityNote';
import type { WorkItem } from './itemModel';
import { QualityLine } from './QualityLine';
import { KEYS, workspaceApi, type EvidenceRow } from './workspaceApi';

export function EvidenceSection({ assessmentId, assessmentName, item, readOnly, onChanged }: { assessmentId: number; assessmentName: string; item: WorkItem; readOnly: boolean; onChanged: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const q = useQuery({
    queryKey: KEYS.evidence(assessmentId, item.id),
    queryFn: () => workspaceApi.evidence(assessmentId, item.id),
    refetchInterval: (query) => reviewPollMs(query.state.data),
  });
  const attach = useReportedMutation({
    mutationFn: (f: File) => workspaceApi.uploadEvidence(assessmentId, item.id, f),
    success: 'File attached',
    failure: "Couldn't attach the file",
    retryable: false,
    onSuccess: () => { void q.refetch(); onChanged(); },
  });
  const submit = useReportedMutation({
    mutationFn: (linkId: number | string) => workspaceApi.submitEvidence(linkId),
    success: 'Sent for review',
    failure: "Couldn't send the file for review",
    onSuccess: () => { void q.refetch(); onChanged(); },
  });
  const rows: EvidenceRow[] = q.data ?? [];

  return (
    <div className="flex flex-col gap-[12px]">
      <input ref={file} type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.csv,.docx" className="hidden" aria-label="Choose a file to attach"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }} />
      <div className="flex flex-wrap gap-[8px]">
        {!readOnly && <Button leftIcon={<Paperclip aria-hidden />} loading={attach.isPending} onClick={() => file.current?.click()}>Attach a file</Button>}
        <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setAsking(true)}>Suggest evidence (AI)</Button>
      </div>
      {q.isPending ? <SkeletonLines lines={3} label="Loading the evidence" />
        : q.isError ? <ErrorState title="Couldn't load the evidence" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
        : rows.length === 0 ? <EmptyState kind="firstUse" bare title="No evidence yet" description={readOnly ? 'Nothing is attached to this control.' : 'Attach a file, or ask the AI what to collect.'} />
        : (
          <ul className="flex flex-col gap-[8px]">
            {rows.map((r) => {
              const word = r.source === 'framework_link' ? 'framework_linked' : approvalWord(r.approval_status);
              const name = r.evidence_name || r.evidence_file_name || 'Evidence';
              const canSubmit = !readOnly && r.source === 'assessment_upload' && word === 'draft';
              return (
                <li key={String(r.id)} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                  <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
                    <div className="flex min-w-0 items-start gap-[8px]">
                      <FileText aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
                      <div className="min-w-0">
                        <p className="break-words text-ds-body font-[600] text-ds-fg">{name}</p>
                        <p className="text-ds-label text-ds-fg-muted">
                          {orEmpty(r.evidence_file_type)} · {r.source === 'framework_link' ? `Matched to ${r.control_code ?? 'this requirement'}${r.framework_name ? ` in ${r.framework_name}` : ''}` : `Attached ${formatDate(r.created_at)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <StatusPill {...statusPill(evidenceApproval, word)} size="sm" />
                      {canSubmit && <Button size="sm" variant="primary" leftIcon={<Send aria-hidden />} loading={submit.isPending && submit.variables === r.id} onClick={() => submit.mutate(r.id)}>Send for review</Button>}
                    </div>
                  </div>
                  {typeof r.evidence_id === 'number' && (
                    <QualityLine assessmentId={assessmentId} itemId={item.id} evidenceId={r.evidence_id} quality={r.quality} since={r.created_at} readOnly={readOnly}
                      onRechecked={() => { void q.refetch(); }} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      {asking && (
        <AiEvidenceDialog assessmentId={assessmentId} item={{ id: item.id, item_number: item.number, control_description: item.description }} context={assessmentName}
          onClose={() => setAsking(false)} onLinked={() => { void q.refetch(); onChanged(); }} />
      )}
    </div>
  );
}
