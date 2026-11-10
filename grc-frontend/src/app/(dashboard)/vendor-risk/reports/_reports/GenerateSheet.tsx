'use client';

// Generate a report: the kind, its period or its supplier, a Preview (the report as it would be made now, not kept) and Generate and keep (a frozen copy, which opens on its own page). It is a Sheet: focus
// stays inside, Escape closes it (asking first while a preview or a choice is half made is not needed: nothing is lost by closing). Preview is open to every signed-in person (it is a read); keeping needs
// the right to generate, and a person without it sees the preview and is told so. A failed preview or generate says so in the sheet, in plain words, with Try again.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { Button, Combobox, FormField, Notice, Select, Sheet, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import ReportView, { type ReportContent } from '@/components/vendor-risk/ReportView';
import { useSupplierNames } from '../../_lib/vendorNames';
import { KIND_ABOUT, needsPeriod, needsSupplier, quarters, ready, requestOf, type KeptReport } from './reportsModel';
import { REPORT_KINDS, reportKind, type ReportKind } from '@/lib/statuses/vendorInsights';

export default function GenerateSheet({ open, onClose, canKeep, initialSupplier }: { open: boolean; onClose: () => void; canKeep: boolean; initialSupplier?: number | null }) {
  const router = useRouter();
  const periods = useMemo(() => quarters(), []);
  const [kind, setKind] = useState<ReportKind>('committee_pack');
  const [period, setPeriod] = useState(1);                       // the last whole quarter, as the page has always started
  const [vendorId, setVendorId] = useState<number | null>(initialSupplier ?? null);
  const [preview, setPreview] = useState<ReportContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suppliers = useSupplierNames(open && needsSupplier(kind));
  const request = requestOf(kind, periods[period], vendorId);
  const complete = ready(kind, vendorId);
  const change = (fn: () => void) => { setPreview(null); setError(null); fn(); };

  const previewIt = useReportedMutation({
    mutationFn: async () => (await tpraApi.previewReport(request as Parameters<typeof tpraApi.previewReport>[0])).data as ReportContent,
    failure: 'The preview could not be made.',
    toast: 'none',
    onSuccess: (c) => { setError(null); setPreview(c); },
    onError: (e) => setError(errorMessage(e, 'The preview could not be made. Try again.')),
  });
  const keep = useReportedMutation({
    mutationFn: async () => (await tpraApi.createReport(request as Parameters<typeof tpraApi.createReport>[0])).data as KeptReport,
    success: 'Report generated and kept',
    failure: 'The report could not be generated.',
    invalidate: [['tprm-reports']],
    toast: 'success',
    onSuccess: (r) => { onClose(); router.push(`/vendor-risk/reports/${r.id}`); },
    onError: (e) => setError(errorMessage(e, 'The report could not be generated. Try again.')),
  });

  return (
    <Sheet
      open={open} onClose={onClose} width="lg" title="Generate a report" subtitle="A report is made from the programme’s own records. A kept report does not change afterwards."
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Close</Button>
          <Button leftIcon={<Eye aria-hidden />} disabled={!complete} loading={previewIt.isPending} onClick={() => previewIt.mutate()}>Preview</Button>
          {canKeep && <Button variant="primary" disabled={!complete} loading={keep.isPending} onClick={() => keep.mutate()}>Generate and keep</Button>}
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {error && <Notice tone="danger" title="That did not work" action={<Button size="sm" onClick={() => (preview ? keep.mutate() : previewIt.mutate())}>Try again</Button>}>{error}</Notice>}
        {!canKeep && <Notice tone="info">You can preview any report. Generating and keeping one needs permission to edit suppliers.</Notice>}
        <FormField label="Report" hint={KIND_ABOUT[kind]}>
          <Select value={kind} onChange={(e) => change(() => setKind(e.target.value as ReportKind))}>
            {REPORT_KINDS.map((k) => <option key={k} value={k}>{reportKind.label(k)}</option>)}
          </Select>
        </FormField>
        {needsPeriod(kind) && (
          <FormField label="Period">
            <Select value={String(period)} onChange={(e) => change(() => setPeriod(Number(e.target.value)))}>
              {periods.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </Select>
          </FormField>
        )}
        {needsSupplier(kind) && (
          <FormField label="Supplier" hint={suppliers.data && suppliers.data.total > suppliers.data.items.length ? `Showing ${suppliers.data.items.length} of ${suppliers.data.total} suppliers. Search by name.` : 'Search by name.'}
            error={suppliers.isError ? `${errorMessage(suppliers.error)} Close and open the sheet to try again.` : undefined}>
            <Combobox
              label="Supplier" placeholder={suppliers.isLoading ? 'Loading suppliers…' : 'Choose a supplier'} value={vendorId === null ? null : String(vendorId)} disabled={suppliers.isLoading || suppliers.isError}
              options={(suppliers.data?.items ?? []).map((v) => ({ value: String(v.id), label: v.name }))} searchPlaceholder="Search suppliers"
              onChange={(v) => change(() => setVendorId(v === null ? null : Number(v)))}
            />
          </FormField>
        )}
        {preview && (
          <section aria-label="Preview" className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle p-[12px]">
            <p className="mb-[8px] text-ds-label font-[600] text-ds-fg-muted">Preview, not kept</p>
            <ReportView content={preview} heading="h2" />
          </section>
        )}
      </div>
    </Sheet>
  );
}
