'use client';

// The two ways to bring analyses in, as Sheets: a NEW analysis for a supplier (it starts from what the programme already holds about the supplier: every number says where it came from, and all of it can be
// changed), and an IMPORT of a CSV (checked first; nothing is written unless every row is sound). Both used to be hand-built overlays with no focus handling and no way out with the keyboard.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { Button, Combobox, FormField, Notice, SegmentedControl, Sheet, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { vendorFairApi } from '@/lib/api';
import { ANALYSIS_EFFECTS, EFFECT_WORDS, type AnalysisEffect } from '@/lib/statuses/vendorInsights';
import { useSupplierNames } from '../../_lib/vendorNames';
import { download } from '../../_lib/fair/shared';
import type { FairAnalysis } from '../../_lib/fair/fairModel';

export function NewAnalysisSheet({ open, onClose, supplier }: { open: boolean; onClose: () => void; supplier: number | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<number | null>(null);
  const [effect, setEffect] = useState<AnalysisEffect>('confidentiality');
  const [error, setError] = useState<string | null>(null);
  const vendor = picked ?? supplier;                                   // a supplier chosen in the sheet wins over the one the link named
  const suppliers = useSupplierNames(open);
  const start = useReportedMutation({
    mutationFn: async () => {
      const pre = (await vendorFairApi.prefill(vendor as number, effect)).data as { inputs: object; notes: string[]; name: string };
      return (await vendorFairApi.create({ vendor_id: vendor, effect, name: pre.name, inputs: pre.inputs, notes: pre.notes })).data as FairAnalysis;
    },
    success: 'Analysis started',
    failure: 'The analysis could not be started.',
    invalidate: [['tprm-fair']],
    toast: 'success',
    onSuccess: (a) => { onClose(); router.push(`/vendor-risk/comply-analysis/${a.id}`); },
    onError: (e) => setError(errorMessage(e, 'The analysis could not be started. Try again.')),
  });
  return (
    <Sheet
      open={open} onClose={onClose} width="md" dirty={picked !== null && !start.isPending} title="New Comply analysis" subtitle="It starts from what we hold about the supplier; every number says where it came from, and all of it can be changed."
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={vendor === null} loading={start.isPending} onClick={() => { setError(null); start.mutate(); }}>Start</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {error && <Notice tone="danger" title="That did not work">{error}</Notice>}
        <FormField label="Supplier" required hint={suppliers.data && suppliers.data.total > suppliers.data.items.length ? `Showing ${suppliers.data.items.length} of ${suppliers.data.total} suppliers. Search by name.` : 'Search by name.'}
          error={suppliers.isError ? `${errorMessage(suppliers.error)} Close and open the sheet to try again.` : undefined}>
          <Combobox
            label="Supplier" placeholder={suppliers.isLoading ? 'Loading suppliers…' : 'Choose a supplier'} value={vendor === null ? null : String(vendor)} disabled={suppliers.isLoading || suppliers.isError}
            options={(suppliers.data?.items ?? []).map((v) => ({ value: String(v.id), label: v.name }))} searchPlaceholder="Search suppliers" onChange={(v) => setPicked(v === null ? null : Number(v))}
          />
        </FormField>
        <FormField label="What goes wrong">
          <SegmentedControl label="What goes wrong" name="new-analysis-effect" options={ANALYSIS_EFFECTS.map((value) => ({ value, label: EFFECT_WORDS[value] }))} value={effect} onChange={(v) => setEffect(v as AnalysisEffect)} />
        </FormField>
      </div>
    </Sheet>
  );
}

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ ready: number; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useReportedMutation({
    mutationFn: async (f: File) => (await vendorFairApi.importFile(f, true)).data as { ready: number; problems: string[] },
    failure: 'The file could not be checked.',
    toast: 'none',
    onSuccess: (d) => { setError(null); setPreview(d); },
    onError: (e) => { setPreview(null); setError(errorMessage(e, 'The file could not be checked. Is it the CSV from the template?')); },
  });
  const run = useReportedMutation({
    mutationFn: async () => (await vendorFairApi.importFile(file as File, false)).data as { ready: number },
    success: (r) => `${r.ready} ${r.ready === 1 ? 'analysis' : 'analyses'} imported and run`,
    failure: 'The analyses could not be imported.',
    invalidate: [['tprm-fair']],
    toast: 'success',
    onSuccess: () => onClose(),
    onError: (e) => setError(errorMessage(e, 'The analyses could not be imported. Nothing was written.')),
  });
  const template = useReportedMutation({
    mutationFn: async () => download((await vendorFairApi.template()).data as Blob, 'comply-analyses-template.csv'),
    failure: 'The template could not be downloaded.',
    toast: 'errors',
  });
  return (
    <Sheet
      open={open} onClose={onClose} width="md" dirty={!!file && !run.isPending} title="Import analyses"
      subtitle="One row per analysis: the supplier’s name as on record, then a least, most likely and most value for each factor. Nothing is written unless every row is sound."
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!preview || preview.problems.length > 0 || !preview.ready} loading={run.isPending} onClick={() => { setError(null); run.mutate(); }}>Import and run</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {error && <Notice tone="danger" title="That did not work">{error}</Notice>}
        <div>
          <Button variant="link" loading={template.isPending} onClick={() => template.mutate()}>Download the template</Button>
        </div>
        <input ref={input} type="file" accept=".csv" className="hidden" aria-label="Analyses file" tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setPreview(null); setError(null); if (f) check.mutate(f); e.target.value = ''; }} />
        <Button leftIcon={<Upload aria-hidden />} loading={check.isPending} onClick={() => input.current?.click()}>{file ? `Chosen: ${file.name}. Choose another` : 'Choose a CSV file'}</Button>
        {preview && (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]" role="status">
            <p className="text-ds-body text-ds-fg"><b className="font-[600]">{preview.ready}</b> {preview.ready === 1 ? 'analysis' : 'analyses'} ready.</p>
            {preview.problems.length > 0 && (
              <ul className="m-0 mt-[6px] list-disc pl-[20px] text-ds-body text-ds-danger">
                {preview.problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}
                {preview.problems.length > 10 && <li>and {preview.problems.length - 10} more</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
