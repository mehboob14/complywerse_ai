'use client';

// Uploading the monthly workbook: checked first, applied second. The check reads the file and says what an import would do (how many findings, from which sheets, which owner names match nobody, which
// rows need a look) and writes nothing; Import applies it; a re-upload updates the same findings. The sheet follows the request through reading, ready, importing and done, and a failure at either step is
// said in plain words with Try again. The file is the client's own record: nothing about it is read or shown here beyond the counts the server returns.
import { useEffect } from 'react';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { AccordionRow, Button, Notice, SkeletonLines, Sheet, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { alsoAddedLine, readyLine, resultLine, sheetsLine, unmatchedLine, type ImportResult, type WorkbookPreview } from '@/lib/auditRegister/words';
import { REFRESH_ALL } from './registerData';

export function ImportSheet({ file, onClose }: { file: File | null; onClose: () => void }) {
  const check = useReportedMutation({
    mutationFn: async (f: File) => (await auditRegisterApi.preview(f)).data as WorkbookPreview,
    failure: "Couldn't read the workbook",
    toast: 'none',
    retryable: false,
  });
  const apply = useReportedMutation({
    mutationFn: async (f: File) => (await auditRegisterApi.import(f)).data as ImportResult,
    success: 'Workbook imported',
    failure: "Couldn't import the workbook",
    invalidate: [...REFRESH_ALL, ['audit-register-imports'], ['audit-register-owner-mappings'], ['audit-register-lob-mappings']],
    toast: 'success',
    retryable: false,
  });
  // a new file is read as soon as the sheet has it
  useEffect(() => { if (file) { apply.reset(); check.mutate(file); } }, [file]);       // eslint-disable-line react-hooks/exhaustive-deps

  const preview = check.data;
  const result = apply.data;
  const unmatched = preview ? unmatchedLine(preview.unmatched_owners.map((o) => o.name)) : null;
  const busy = check.isPending || apply.isPending;
  const close = () => { if (!apply.isPending) onClose(); };

  return (
    <Sheet
      open={!!file}
      onClose={close}
      title="Upload the workbook"
      subtitle={file?.name}
      width="md"
      footer={result ? (
        <div className="flex w-full justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
      ) : (
        <div className="flex w-full flex-wrap justify-end gap-[8px]">
          <Button onClick={close} disabled={apply.isPending}>Cancel</Button>
          <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={apply.isPending} disabled={!preview || check.isPending || preview.rows === 0} onClick={() => file && apply.mutate(file)}>
            {preview ? `Import ${formatCount(preview.rows)} ${preview.rows === 1 ? 'finding' : 'findings'}` : 'Import'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {check.isPending && <div aria-busy="true"><SkeletonLines lines={4} label="Reading the workbook" /><p className="m-0 mt-[8px] text-ds-body text-ds-fg-muted">Reading the workbook. A large one can take a minute.</p></div>}

        {check.isError && !preview && (
          <Notice tone="danger" title="The workbook could not be read" action={<Button onClick={() => file && check.mutate(file)}>Try again</Button>}>{errorMessage(check.error)}</Notice>
        )}

        {preview && !result && (
          <>
            {preview.as_of && (
              <p className="m-0 flex items-center gap-[8px] text-ds-body text-ds-fg-muted">
                <FileSpreadsheet aria-hidden className="h-[16px] w-[16px] shrink-0" />
                The workbook is as of {formatDate(preview.as_of, { calendar: true })}.
              </p>
            )}
            <p className="m-0 text-ds-body text-ds-fg">{readyLine(preview)}</p>
            <p className="m-0 text-ds-label text-ds-fg-muted">Sheets: {sheetsLine(preview.sheet_counts) || 'none'}. Nothing is imported until you press Import; a re-upload updates the same findings.</p>
            {unmatched && <Notice tone="warning">{unmatched}</Notice>}
            {preview.warnings.length > 0 && (
              <AccordionRow title={`${formatCount(preview.warnings.length)} ${preview.warnings.length === 1 ? 'row needs' : 'rows need'} a look`} level={4}>
                <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
                  {preview.warnings.slice(0, 10).map((w) => <li key={w} className="break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{w}</li>)}
                  {preview.warnings.length > 10 && <li className="text-ds-label text-ds-fg-muted">And {formatCount(preview.warnings.length - 10)} more.</li>}
                </ul>
              </AccordionRow>
            )}
            {preview.rows === 0 && <Notice tone="warning">The workbook holds no findings this register can read.</Notice>}
          </>
        )}

        {apply.isError && !result && (
          <Notice tone="danger" title="The import did not finish" action={<Button disabled={apply.isPending} onClick={() => file && apply.mutate(file)}>Try again</Button>}>
            {errorMessage(apply.error)} Importing again updates the same findings, it does not add them twice.
          </Notice>
        )}

        {result && (
          <Notice tone="info" icon={CheckCircle2} title="Imported">
            {resultLine(result)}
            {alsoAddedLine(result.linked) ? ` ${alsoAddedLine(result.linked)}` : ''}
            {result.unmatched_owners.length > 0 ? ` ${unmatchedLine(result.unmatched_owners)}` : ''}
          </Notice>
        )}
        {busy && !check.isPending && <p role="status" className="m-0 text-ds-body text-ds-fg-muted">Importing. A large workbook can take a few minutes.</p>}
      </div>
    </Sheet>
  );
}
