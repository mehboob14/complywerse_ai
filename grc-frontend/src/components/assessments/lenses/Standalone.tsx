'use client';

/**
 * A lens on a page that has no assessment id yet (the older tabs of Compliance > Assessments, the NCA hub, the Cyber Security questionnaire page): it finds the newest assessment of
 * the format, or says there is none and takes the workbook that starts one. It is the bridge that keeps those pages working while the workspace (`/assessments/a/<id>`) becomes the
 * one place; group C retires the pages that mount it. The upload names the kind of workbook it expects (the server refuses another kind, so a PDPL file cannot land under Maturity).
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, SkeletonLines, useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { refreshAssessmentLists } from '@/components/compliance/scoping/scopingApi';
import { refreshWorkspaceCaches } from '../workspace/workspaceApi';

export interface StandaloneProps {
  format: string;
  /** what the page is about: "OWASP ASVS" */
  title: string;
  /** the kind of assessment the workbook becomes ("gap_assessment", "cybersecurity", "privacy") */
  assessmentType: string;
  /** the id when the caller has it (an assessment made for one application): nothing is looked for and no workbook is asked for */
  assessmentId?: number;
  /** false: the workbook is the questionnaire's, not a scoped assessment's: no upload, no replace, no delete */
  allowUpload?: boolean;
  /** the types made per application keep their questionnaire apart: only the uploaded workbook (no scope) is the page's own */
  uploadedOnly?: boolean;
  /** a workbook that ships with the app, offered as a way to start */
  starter?: { label: string; url: string; fileName: string };
  children: (assessmentId: number, readOnly: boolean) => ReactNode;
}

export function Standalone({ format, title, assessmentType, assessmentId, allowUpload = true, uploadedOnly = false, starter, children }: StandaloneProps) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const readOnly = !hasPermission('compliance:assessments:edit');
  const { confirm, confirmDialog } = useConfirm();
  const notify = useNotify();
  const file = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<File | null>(null);
  const list = useQuery({
    queryKey: ['assessment-lens-standalone', format, uploadedOnly], enabled: assessmentId == null, staleTime: 15_000,
    queryFn: async () => ((await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: format, ...(uploadedOnly ? { scope_model: 'none' } : {}), all_formats: 1, summary: 0 } })).data?.assessments ?? []) as Array<{ id: number; name: string; assessment_format?: string }>,
  });
  const active = assessmentId ?? list.data?.find((a) => !a.assessment_format || a.assessment_format === format)?.id ?? null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['assessment-lens-standalone', format] }); if (active) refreshWorkspaceCaches(qc, active); refreshAssessmentLists(qc); };

  const send = useReportedMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      if (active) return (await apiClient.post(`/compliance/assessments/${active}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
      fd.append('name', title);
      fd.append('assessment_type', assessmentType);
      fd.append('expected_format', format);
      return (await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    success: active ? 'Refreshed from the workbook' : 'Workbook read',
    failure: `Couldn't read the workbook. Check that it is the ${title} workbook.`,
    retryable: false,
    onSuccess: refresh,
  });
  const remove = useReportedMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${active}`),
    success: `${title} deleted`,
    failure: "Couldn't delete the assessment",
    retryable: false,
    onSuccess: refresh,
  });
  const pick = async (f: File) => {
    if (active && !(await confirm({ title: 'Refresh from this workbook?', message: 'Whatever the workbook holds for a control replaces what is here. Nothing else changes.', confirmLabel: 'Refresh from the workbook' }))) return;
    setReplacing(f);
    send.mutate(f, { onSettled: () => setReplacing(null) });
  };
  const startFromShipped = async (s: NonNullable<StandaloneProps['starter']>) => {
    try {
      const res = await fetch(s.url);
      if (!res.ok) throw new Error('missing');
      send.mutate(new File([await res.blob()], s.fileName));
    } catch {
      notify.error('The built-in toolkit could not be loaded. Upload the workbook instead.', { title: "Couldn't start from the toolkit" });
    }
  };
  const askDelete = async () => {
    if (await confirm({ title: `Delete ${title}?`, message: 'Every control, answer and link to evidence of this assessment is removed. This cannot be undone.', confirmLabel: 'Delete assessment', tone: 'danger' })) remove.mutate();
  };

  const pickerInput = <input ref={file} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" aria-label={`Choose the ${title} workbook`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />;
  const uploadAllowed = allowUpload && !readOnly;

  if (assessmentId == null && list.isPending) return <SkeletonLines lines={4} label={`Loading ${title}`} />;
  if (assessmentId == null && list.isError) return <ErrorState title={`Couldn't load ${title}`} message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
  if (active == null) {
    return (
      <>
        {pickerInput}
        <EmptyState
          kind="firstUse" title={`No ${title} yet`}
          description={uploadAllowed ? `Upload the ${title} workbook and every control in it is read into this page.` : 'Nothing has been uploaded yet.'}
          action={uploadAllowed ? (
            <span className="flex flex-wrap justify-center gap-[8px]">
              <Button variant="primary" leftIcon={<FileUp aria-hidden />} loading={send.isPending} onClick={() => file.current?.click()}>Upload the workbook</Button>
              {starter && <Button loading={send.isPending} onClick={() => void startFromShipped(starter)}>{starter.label}</Button>}
            </span>
          ) : undefined}
        />
        {confirmDialog}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      {pickerInput}
      {uploadAllowed && assessmentId == null && (
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button leftIcon={<FileUp aria-hidden />} loading={send.isPending || replacing !== null} onClick={() => file.current?.click()}>Refresh from a workbook</Button>
          <Button leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => void askDelete()}>Delete</Button>
        </div>
      )}
      {children(active, readOnly)}
      {confirmDialog}
    </div>
  );
}
