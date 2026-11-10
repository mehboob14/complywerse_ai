'use client';

// Bulk create or update vendors from a sheet. Checking the file first shows what every row would do; importing is all or nothing, so one bad row changes nothing.
// The kit's modal (focus, Escape, a name); a failed check or import says so in the dialog, with the words the server gave and a Retry.
import { useRef, useState } from 'react';
import { Download, FileUp, Upload } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, Notice, StatusPill, TBody, Table, TableFrame, Td, Th, THead, Tr, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { vendorOnboardingApi } from '@/lib/api';

interface PlanRow { row: number; action: 'create' | 'update' | 'error'; name: string; vendor_id: number | null; changes: string[]; errors: string[] }
interface Plan { dry_run: boolean; summary: { create: number; update: number; error: number }; rows: PlanRow[]; ignored_columns: string[] }

const ACTION = { create: { tone: 'success', label: 'New' }, update: { tone: 'progress', label: 'Update' }, error: { tone: 'danger', label: 'Error' } } as const;
const plural = (n: number, one: string, other: string) => `${formatCount(n)} ${n === 1 ? one : other}`;

export default function ImportVendors({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Plan | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = useReportedMutation({
    mutationFn: async (f: File) => (await vendorOnboardingApi.importVendors(f, true)).data as Plan,
    failure: "Couldn't read the file",
    toast: 'none',
    onSuccess: setPlan,
  });
  const apply = useReportedMutation({
    mutationFn: async (f: File) => (await vendorOnboardingApi.importVendors(f, false)).data as Plan,
    success: (p: Plan) => `${plural(p.summary.create, 'vendor', 'vendors')} created, ${formatCount(p.summary.update)} updated`,
    failure: "Couldn't import the vendors",
    retryable: false,
    toast: 'success',
    onSuccess: (p: Plan) => { setDone(p); onDone(); },
  });
  const template = async () => {
    setTemplateFailed(false);
    try {
      const res = await vendorOnboardingApi.importTemplate();
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vendor-import-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setTemplateFailed(true);
    }
  };
  const changes = plan ? plan.summary.create + plan.summary.update : 0;
  const failure = check.isError ? errorMessage(check.error, 'The file could not be read.') : apply.isError ? errorMessage(apply.error, 'The vendors could not be imported.') : null;

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Import vendors"
      subtitle="Create new vendors or update existing ones from a CSV or Excel sheet"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && !plan && <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={check.isPending} disabled={!file} onClick={() => file && check.mutate(file)}>Check the file</Button>}
          {!done && plan && (
            <Button variant="primary" loading={apply.isPending} disabled={!file || plan.summary.error > 0 || changes === 0} onClick={() => file && apply.mutate(file)}>
              {plan.summary.error ? 'Fix the errors first' : changes === 0 ? 'Nothing to import' : `Import ${plural(changes, 'vendor', 'vendors')}`}
            </Button>
          )}
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
        {done ? (
          <Notice tone="info" title={`${plural(done.summary.create, 'vendor', 'vendors')} created and ${formatCount(done.summary.update)} updated`}>
            Each change is on the vendor&apos;s history.
          </Notice>
        ) : (
          <>
            <ol className="m-0 flex list-none flex-col gap-[6px] p-0 text-ds-body text-ds-fg-body">
              <li>1. Download the template. Only <span className="font-[600] text-ds-fg">name</span> is needed for a new vendor.</li>
              <li>2. A row updates the vendor with the same website, or else the same name; blank cells leave a field as it is.</li>
              <li>3. Owners are matched by email. Separate several data types or locations with a semicolon.</li>
            </ol>
            <div>
              <Button leftIcon={<Download aria-hidden />} onClick={() => { void template(); }}>Download the template</Button>
              {templateFailed && <p role="alert" className="mt-[6px] text-ds-label text-ds-danger">The template could not be downloaded. Try again.</p>}
            </div>
            <div className="flex flex-col items-start gap-[8px] rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle px-[16px] py-[16px]">
              <p className="text-ds-body text-ds-fg-body">{file ? <>Chosen: <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{file.name}</span></> : 'Choose a .csv or .xlsx file.'}</p>
              <input ref={input} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); check.reset(); apply.reset(); }} />
              <Button leftIcon={<FileUp aria-hidden />} onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose a file'}</Button>
            </div>
          </>
        )}

        {failure && (
          <Notice tone="danger" title="Not done" action={file && !done ? <Button onClick={() => (plan ? apply.mutate(file) : check.mutate(file))}>Try again</Button> : undefined}>{failure}</Notice>
        )}

        {plan && !done && (
          <div className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill size="sm" tone="success" label={`${formatCount(plan.summary.create)} new`} />
              <StatusPill size="sm" tone="progress" label={`${formatCount(plan.summary.update)} updated`} />
              <StatusPill size="sm" tone={plan.summary.error ? 'danger' : 'neutral'} label={`${formatCount(plan.summary.error)} with errors`} />
            </div>
            {plan.ignored_columns.length > 0 && <Notice tone="warning" title="Some columns are ignored">{plan.ignored_columns.join(', ')}</Notice>}
            <TableFrame aria-label="What each row of the file would do" maxHeight="max-h-[40vh]">
              <Table caption="What each row of the file would do">
                <THead><tr><Th sticky>Row</Th><Th sticky>Vendor</Th><Th sticky>Does</Th><Th sticky>Details</Th></tr></THead>
                <TBody>
                  {plan.rows.map((r) => (
                    <Tr key={r.row}>
                      <Td className="text-ds-fg-muted">{r.row}</Td>
                      <Td className="font-[600] text-ds-fg">{r.name || '—'}</Td>
                      <Td><StatusPill size="sm" tone={ACTION[r.action].tone} label={ACTION[r.action].label} /></Td>
                      <Td className="text-ds-fg-body">{r.errors.length ? r.errors.join('; ') : r.changes.length ? r.changes.join(', ').replace(/_/g, ' ') : 'No change'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
