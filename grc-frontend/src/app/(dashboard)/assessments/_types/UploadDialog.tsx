'use client';

// Upload the workbook of a kind of assessment (Types). The kind is named to the server (`expected_format`), so a workbook of another kind is refused with a sentence that says which kind the file
// is (the old shared uploader did not name the kind: a PDPL workbook sent under Maturity quietly became a PDPL assessment on another page). On success the new assessment opens. The file is
// checked here first (a workbook, a CSV or a supported PDF, not empty); a failure stays in the dialog in the server's words and the file stays chosen, so trying again is one press.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormField, Notice, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { refreshAssessmentLists } from '@/components/compliance/scoping/scopingApi';
import { api, KEYS } from '../_data/assessmentData';
import { WORKBOOK_ACCEPT, fileProblem, type TypeSpec } from './typesModel';

export function UploadDialog({ spec, onClose }: { spec: TypeSpec; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const problem = fileProblem(file);
  const upload = useReportedMutation({
    mutationFn: (f: File) => api.upload(f, spec.expectFormat),
    success: { title: `${spec.label} uploaded`, message: 'It is open now. Its controls were read from the file.' },
    failure: "Couldn't upload the file",
    toast: 'success',
    invalidate: [[...KEYS.register], [...KEYS.board], [...KEYS.points], [...KEYS.myWork]],
    onSuccess: ({ id }) => { refreshAssessmentLists(qc); onClose(); router.push(id ? `/assessments/a/${id}` : `/assessments/register?type=${spec.format}`); },
  });
  const send = () => { setTried(true); if (!problem && file) upload.mutate(file); };

  return (
    <AnimatedModal
      isOpen onClose={onClose} size="lg" title={`Upload ${spec.label}`} dirty={!!file && !upload.isPending}
      subtitle={spec.about}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose} disabled={upload.isPending}>Cancel</Button>
          <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={upload.isPending} onClick={send}>Upload</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px] px-[20px] py-[16px]">
        <FormField label="The file" required error={tried && problem ? problem : undefined} hint={spec.needs.length ? `Have ready: ${spec.needs.join('; ')}.` : undefined}>
          <input
            ref={input}
            type="file"
            accept={WORKBOOK_ACCEPT}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); upload.reset(); }}
            className="block w-full min-w-0 text-ds-body text-ds-fg file:mr-[12px] file:min-h-ds-control file:cursor-pointer file:rounded-ds-control file:border file:border-ds-border-strong file:bg-ds-surface file:px-[12px] file:text-ds-body file:font-[500] file:text-ds-fg-body hover:file:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
          />
        </FormField>
        <p className="m-0 text-ds-label text-ds-fg-muted">A new file is a new assessment. To bring an existing assessment up to date from a changed workbook, use Refresh from a workbook on its own page: it shows what would change first.</p>
        {upload.isError && <Notice tone="danger" title="Couldn't upload the file">{errorMessage(upload.error)}</Notice>}
      </div>
    </AnimatedModal>
  );
}
