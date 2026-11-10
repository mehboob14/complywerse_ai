'use client';

// The observation's evidence: the files that prove it was remedied or complied with. Each is a link to the file in Evidence Management (where its maturity, what is missing and how to
// close it are spelled out), with where its AI maturity rating stands; a file is attached by upload (checked here for type and size before it is sent, and again by the server) or linked
// from the library. Unlinking asks first: the file stays in the library.
import { useState } from 'react';
import Link from 'next/link';
import { File, FileSpreadsheet, FileText, FileUp, Image as ImageIcon, Link2, Link2Off, Paperclip, Upload } from 'lucide-react';
import { Button, EmptyState, IconButton, Notice, Sheet, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { statutoryAuditApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { useEvidenceReview, reviewActive } from '@/app/(dashboard)/evidence/_review';
import { EVIDENCE_EXTENSIONS, MAX_MB, acceptOf, extensionOf, fileProblem, sizeText } from '../../_register/files';
import { REFRESH, type RecordDetail } from '../../_register/observationData';

type Row = RecordDetail['evidence'][number];

function FileIcon({ name }: { name: string | null }) {
  const ext = extensionOf(name);
  const Icon = ['xls', 'xlsx', 'csv', 'tsv'].includes(ext) ? FileSpreadsheet : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ImageIcon : ['pdf', 'doc', 'docx', 'rtf', 'txt', 'md'].includes(ext) ? FileText : File;
  return <Icon aria-hidden className="h-[20px] w-[20px] shrink-0 text-ds-fg-muted" strokeWidth={1.5} />;
}

/** Where the AI rating of a file stands, as a pill with its words: "Maturity 72%", "AI is rating it", "Not rated". The file's own page says what is missing. */
function Maturity({ evidenceId }: { evidenceId: number }) {
  const { review } = useEvidenceReview(evidenceId);
  if (!review) return null;
  const score = review.quality_score;
  if (typeof score === 'number') return <StatusPill size="sm" tone={score >= 80 ? 'success' : score >= 60 ? 'progress' : score >= 40 ? 'warning' : 'danger'} label={`Maturity ${Math.round(score)}%`} />;
  if (reviewActive(review.status)) return <StatusPill size="sm" tone="progress" label="AI is rating it" />;
  if (review.status === 'failed' || review.status === 'unavailable') return <StatusPill size="sm" tone="warning" label="Not rated" />;
  return <StatusPill size="sm" tone="neutral" label="Not rated yet" />;
}

function UploadSheet({ obsId, onClose }: { obsId: number; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const send = useReportedMutation({
    mutationFn: async (f: File) => (await statutoryAuditApi.uploadEvidence(obsId, f)).data,
    success: 'Evidence attached',
    failure: "Couldn't attach the file",
    toast: 'success',
    retryable: false,
    invalidate: REFRESH,
    onSuccess: onClose,
  });
  const choose = (f: File | null) => {
    send.reset();
    const why = f ? fileProblem(f, 'evidence') : null;
    setProblem(why);
    setFile(why ? null : f);
  };
  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      dirty={!!file && !send.isPending}
      title="Upload evidence"
      subtitle="Attach a file as proof for this observation"
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={send.isPending} disabled={!file} onClick={() => file && send.mutate(file)}>Upload file</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <label className={`flex cursor-pointer flex-col items-center gap-[8px] rounded-ds-card border-2 border-dashed p-[24px] text-center focus-within:shadow-ds-ring ${problem ? 'border-ds-danger-border bg-ds-danger-soft' : 'border-ds-border-strong bg-ds-surface-subtle'}`}>
          <input type="file" className="sr-only" accept={acceptOf(EVIDENCE_EXTENSIONS)} disabled={send.isPending} onChange={(e) => { choose(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <FileUp aria-hidden className="h-[28px] w-[28px] text-ds-fg-muted" />
          {file ? (
            <>
              <span className="break-all text-ds-body font-[600] text-ds-fg">{file.name}</span>
              <span className="text-ds-label text-ds-fg-muted">{sizeText(file.size)}. Choose another file to replace it.</span>
            </>
          ) : (
            <>
              <span className="text-ds-body font-[600] text-ds-fg">Choose a file</span>
              <span className="max-w-[24rem] text-ds-label text-ds-fg-muted">PDF, Word, Excel, CSV, text, an image or a ZIP, up to {MAX_MB} MB.</span>
            </>
          )}
        </label>
        {problem && <Notice tone="danger">{problem}</Notice>}
        {send.isError && <Notice tone="danger" title="The file wasn't attached">{errorMessage(send.error)}</Notice>}
      </div>
    </Sheet>
  );
}

export function EvidenceTab({ obsId, evidence, onLink }: { obsId: number; evidence: readonly Row[]; onLink: () => void }) {
  const [uploading, setUploading] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const unlink = useReportedMutation({
    mutationFn: async (r: Row) => (await statutoryAuditApi.unlinkEvidence(obsId, r.id)).data,
    success: 'Evidence unlinked',
    failure: "Couldn't unlink the evidence",
    invalidate: REFRESH,
  });
  const ask = async (r: Row) => {
    const yes = await confirm({ title: 'Unlink this evidence?', message: `“${truncate(r.name || r.file_name || 'This file', 80).text}” stops counting as proof for this observation. The file stays in the evidence library.`, confirmLabel: 'Unlink evidence', tone: 'danger' });
    if (yes) unlink.mutate(r);
  };
  return (
    <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="flex flex-wrap items-center justify-end gap-[8px]">
        <Button leftIcon={<Link2 aria-hidden />} onClick={onLink}>Link from the library</Button>
        <Button variant="primary" leftIcon={<Upload aria-hidden />} onClick={() => setUploading(true)}>Upload file</Button>
      </div>
      {evidence.length === 0 ? (
        <EmptyState bare kind="firstUse" icon={Paperclip} title="No evidence attached yet" description="Upload a file, or link one that is already in the evidence library." />
      ) : (
        <ul aria-label="Evidence" className="m-0 flex list-none flex-col rounded-ds-card border border-ds-border p-0">
          {evidence.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-b border-ds-border px-[12px] py-[8px] last:border-b-0">
              <FileIcon name={r.file_name || r.name} />
              <div className="min-w-0 flex-1 basis-[12rem]">
                <Link href={`/evidence/${r.evidence_id}`} className="inline-flex min-h-ds-control max-w-full items-center break-words text-ds-body font-[600] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">
                  {r.name || r.file_name || 'File'}
                </Link>
                <p className="text-ds-label text-ds-fg-muted">{[extensionOf(r.file_name || r.name).toUpperCase() || null, r.relationship_type, formatDate(r.created_at)].filter(Boolean).join(' · ')}</p>
              </div>
              <Maturity evidenceId={r.evidence_id} />
              <IconButton label={`Unlink ${truncate(r.name || r.file_name || 'file', 60).text}`} onClick={() => { void ask(r); }}><Link2Off aria-hidden /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {uploading && <UploadSheet obsId={obsId} onClose={() => setUploading(false)} />}
      {confirmDialog}
    </div>
  );
}
