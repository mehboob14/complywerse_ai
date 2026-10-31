'use client';

// The evidence of one milestone: the files uploaded for it (with the AI review's maturity chip), an upload, and a delete that asks first. The requests are the old
// panel's (the list under ['is-project-milestone-evidence', project, milestone], the multipart upload, the delete of one link) and each is reported:
// the upload says "Evidence uploaded" once the server has stored it, and a refusal is said in the server's words with Retry; the delete asks, says "Evidence deleted",
// and is no longer a one-click loss. A list that failed to load says so (the old panel read it as "No evidence uploaded").
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { isProjectsApi } from '@/lib/api';
import { EvidenceMaturity } from '@/app/(dashboard)/evidence/_review';
import { Button, IconButton, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { formatDate, truncate } from '@/lib/format';
import { QueryError, retryRead } from '../_ui';

interface MilestoneEvidence {
  id: number; evidence_id: number; name: string; file_name: string; file_type: string; file_path: string; uploaded_by_name: string; created_at: string; status: string;
}

export function MilestoneEvidencePanel({ projectId, milestoneId, milestoneName }: { projectId: number; milestoneId: number; milestoneName: string }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);                       // a new file box after an upload (a file box cannot be emptied from the outside)
  const { confirm, confirmDialog } = useConfirm();
  const key = ['is-project-milestone-evidence', projectId, milestoneId] as const;

  const list = useQuery<MilestoneEvidence[]>({
    queryKey: key,
    queryFn: async () => (await isProjectsApi.getMilestoneEvidence(projectId, milestoneId)).data || [],
    retry: retryRead,
  });
  const evidence = list.data ?? [];

  const upload = useReportedMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return isProjectsApi.uploadMilestoneEvidence(projectId, milestoneId, formData);
    },
    success: 'Evidence uploaded',
    failure: "Couldn't upload the file",
    invalidate: [key],
    onSuccess: () => { setSelectedFile(null); setInputKey((n) => n + 1); },
  });
  const remove = useReportedMutation({
    mutationFn: (linkId: number) => isProjectsApi.deleteMilestoneEvidence(projectId, milestoneId, linkId),
    success: 'Evidence deleted',
    failure: "Couldn't delete the evidence",
    invalidate: [key],
  });
  const askDelete = async (ev: MilestoneEvidence) => {
    const name = ev.file_name || ev.name;
    if (await confirm({ title: 'Delete this evidence?', message: truncate(name, 120).text, confirmLabel: 'Delete evidence', tone: 'danger' })) remove.mutate(ev.id);
  };

  return (
    <div className="mt-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="inline-flex items-center gap-[6px] text-ds-label font-[600] text-ds-fg"><Paperclip aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />Evidence{evidence.length > 0 ? ` (${evidence.length})` : ''}</p>
        <div className="flex flex-wrap items-center gap-[8px]">
          <TextInput key={inputKey} type="file" aria-label={`Evidence file for ${truncate(milestoneName, 40).text}`} className="w-[240px] max-w-full" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
          <Button size="sm" leftIcon={<Upload aria-hidden />} loading={upload.isPending} disabled={!selectedFile} onClick={() => selectedFile && upload.mutate(selectedFile)}>Upload</Button>
        </div>
      </div>

      {list.isLoading ? (
        <p role="status" className="mt-[8px] text-ds-label text-ds-fg-muted">Loading the evidence</p>
      ) : list.isError && !list.data ? (
        <QueryError title="Couldn't load the evidence" error={list.error} onRetry={() => { void list.refetch(); }} className="!px-0" />
      ) : evidence.length === 0 ? (
        <p className="mt-[8px] text-ds-label text-ds-fg-muted">No evidence uploaded for this milestone.</p>
      ) : (
        <ul className="mt-[8px] flex flex-col gap-[6px]">
          {evidence.map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface px-[8px] py-[6px]">
              <div className="min-w-0">
                <p className="truncate text-ds-body font-[500] text-ds-fg" title={ev.file_name || ev.name}>{ev.file_name || ev.name}</p>
                <p className="text-ds-label text-ds-fg-muted">{ev.uploaded_by_name || 'Unknown'} · {formatDate(ev.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-[8px]">
                <EvidenceMaturity evidenceId={ev.evidence_id} refresh={['is-project-milestone-evidence']} />
                <IconButton label={`Delete evidence ${truncate(ev.file_name || ev.name, 40).text}`} onClick={() => { void askDelete(ev); }}><Trash2 aria-hidden /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
