'use client';

/**
 * Bulk-load entitlements from a purchase-order / licence-sheet export (CSV or XLSX).
 *
 * Two steps, one server round-trip each: choosing a file runs a DRY RUN (validate and
 * report — nothing is written); only the explicit Import button writes. Columns are
 * matched to fields by name on the server, rows that fail validation are skipped and
 * listed, and re-importing the same sheet is idempotent (identical rows are skipped).
 */
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { RightSlidePanel } from '@/cyber-assurance/components/ui/RightSlidePanel';
import { licensesApi, type LicenseImportResult } from '@/cyber-assurance/lib/api';
import { apiErrorMessage, humanize } from './lib';

const MAX_BYTES = 5 * 1024 * 1024; // mirrors the server limit, so an oversized file fails before uploading

const FIELD_LABEL: Record<string, string> = {
  license_type: 'License type', license_metric: 'Metric', total_quantity: 'Quantity', unit_cost: 'Unit cost',
  po_reference: 'PO reference', contract_reference: 'Contract reference',
  purchase_date: 'Purchase date', start_date: 'Start date', expiry_date: 'Expiry date',
  maintenance_expiry: 'Maintenance expiry', maintenance_included: 'Maintenance included',
  support_level: 'Support level', downgrade_rights: 'Downgrade rights',
  software_key: 'Software key', product_key: 'Product key',
};
const fieldLabel = (f: string) => FIELD_LABEL[f] ?? humanize(f);

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? '#047857' : tone === 'bad' ? '#B91C1C' : '#0F172A';
  return (
    <div className="rounded-lg border border-[#E2E5EC] bg-white px-3 py-2">
      <p className="m-0 text-[11px] text-[#64748B]">{label}</p>
      <p className="m-0 text-[20px] font-semibold leading-[1.2] tabular-nums" style={{ color: value ? color : '#94A3B8' }}>{value.toLocaleString()}</p>
    </div>
  );
}

export function ImportDrawer({ onClose, onImported }: {
  onClose: () => void;
  /** Called after a real import with the server's result. */
  onImported: (result: LicenseImportResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LicenseImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dry = useMutation({
    mutationFn: async (f: File) => (await licensesApi.importFile(f, true)).data,
    onSuccess: (r) => { setPreview(r); setError(null); },
    onError: (e) => { setPreview(null); setError(apiErrorMessage(e, 'Could not read that file.')); },
  });
  const commit = useMutation({
    mutationFn: async (f: File) => (await licensesApi.importFile(f, false)).data,
    onSuccess: (r) => onImported(r),
    onError: (e) => setError(apiErrorMessage(e, 'The import failed. Nothing was changed.')),
  });
  const busy = dry.isPending || commit.isPending;

  const pick = (f: File | null) => {
    setPreview(null);
    setError(null);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_BYTES) { setError('That file is larger than 5 MB.'); return; }
    if (/\.xls$/i.test(f.name)) { setError("Legacy .xls isn't supported — save the sheet as .xlsx or .csv."); return; }
    dry.mutate(f);
  };

  const template = async () => {
    try {
      const blob = (await licensesApi.importTemplate()).data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'license_entitlements_template.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not download the template.'));
    }
  };

  const toCreate = preview?.would_create ?? 0;
  const mapped = preview ? Object.keys(preview.columns) : [];
  const hiddenErrors = preview ? Math.max(0, preview.error_count - preview.errors.length) : 0;

  const footer = (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#64748B]">
        {preview && preview.error_count > 0 && toCreate > 0 ? 'Rows with errors are skipped.' : ''}
      </span>
      <button type="button" onClick={onClose} disabled={busy}
        className="h-9 rounded-lg border border-[#D8DEE8] bg-white px-4 text-[13px] font-semibold text-[#334155] hover:bg-[#F6F7FB] disabled:opacity-60">Cancel</button>
      <button type="button" disabled={busy || !file || !preview || toCreate === 0} onClick={() => file && commit.mutate(file)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#005B96] bg-[#005B96] px-4 text-[13px] font-semibold text-white hover:bg-[#014A81] disabled:opacity-60">
        {commit.isPending && <Loader2 size={14} className="animate-spin" />}
        {toCreate > 0 ? `Import ${toCreate.toLocaleString()} ${toCreate === 1 ? 'entitlement' : 'entitlements'}` : 'Import'}
      </button>
    </div>
  );

  return (
    <RightSlidePanel isOpen onClose={busy ? () => {} : onClose} title="Import entitlements"
      subtitle="Load licenses from a purchase-order or license-sheet export (CSV or XLSX)." width="w-full max-w-xl" footer={footer}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".csv,.xlsx,.xlsm,text/csv" className="hidden"
            onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#005B96] bg-[#EFF5FA] px-3.5 text-[13px] font-semibold text-[#014A81] hover:bg-[#E3EEF7] disabled:opacity-60">
            <Upload size={15} aria-hidden />{file ? 'Choose a different file' : 'Choose a file'}
          </button>
          <button type="button" onClick={template}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#D8DEE8] bg-white px-3.5 text-[13px] font-semibold text-[#334155] hover:bg-[#F6F7FB]">
            <Download size={15} aria-hidden />Download template
          </button>
        </div>

        {file && (
          <p className="m-0 flex items-center gap-2 text-[12.5px] text-[#334155]">
            <FileSpreadsheet size={15} aria-hidden className="shrink-0 text-[#64748B]" />
            <span className="min-w-0 truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-[#94A3B8]">{(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB</span>
          </p>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#F1C6C6] bg-[#FDECEC] px-3 py-2.5 text-[12.5px] text-[#991B1B]">
            <AlertCircle size={15} className="mt-px shrink-0" /><span>{error}</span>
          </div>
        )}

        {!file && !error && (
          <div className="rounded-lg border border-dashed border-[#D8DEE8] bg-[#FAFBFC] px-4 py-5 text-[12.5px] leading-[1.55] text-[#64748B]">
            Pick a file and it is checked first &mdash; nothing is saved until you press Import. Publisher and Product columns are required;
            quantity, license type, metric, cost, dates and PO / contract references are picked up by column name. Download the template for the exact layout.
          </div>
        )}

        {dry.isPending && (
          <p className="m-0 flex items-center gap-2 text-[12.5px] text-[#64748B]"><Loader2 size={14} className="animate-spin" />Checking the file&hellip;</p>
        )}

        {preview && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Rows found" value={preview.total} />
              <Stat label="Will be added" value={toCreate} tone="good" />
              <Stat label="Already exist" value={preview.skipped} tone="muted" />
              <Stat label="With errors" value={preview.error_count} tone="bad" />
            </div>

            {toCreate === 0 && preview.error_count === 0 && (
              <p className="m-0 flex items-start gap-2 rounded-lg bg-[#F6F7FB] px-3 py-2.5 text-[12.5px] text-[#475569]">
                <CheckCircle2 size={15} className="mt-px shrink-0 text-[#047857]" />
                Every row in this file already exists, so there is nothing to add.
              </p>
            )}

            {mapped.length > 0 && (
              <div>
                <p className="mb-1.5 mt-0 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#64748B]">Columns matched</p>
                <div className="flex flex-wrap gap-1.5">
                  {mapped.map((h) => (
                    <span key={h} className="inline-flex items-center gap-1 rounded-full border border-[#E2E5EC] bg-white px-2.5 py-[3px] text-[11.5px] text-[#334155]">
                      <span className="max-w-[160px] truncate">{h}</span>
                      <span className="text-[#94A3B8]">&rarr;</span>
                      <b className="font-semibold text-[#014A81]">{fieldLabel(preview.columns[h])}</b>
                    </span>
                  ))}
                </div>
                {preview.unmapped.length > 0 && (
                  <p className="mb-0 mt-2 text-[11.5px] leading-[1.5] text-[#64748B]">
                    Ignored (no matching field): {preview.unmapped.join(', ')}
                  </p>
                )}
              </div>
            )}

            {preview.errors.length > 0 && (
              <div>
                <p className="mb-1.5 mt-0 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#B91C1C]">Rows that will be skipped</p>
                <ul className="m-0 max-h-[220px] list-none overflow-y-auto rounded-lg border border-[#F1C6C6] bg-[#FFF8F8] p-0">
                  {preview.errors.map((er) => (
                    <li key={`${er.row}-${er.error}`} className="flex gap-2 border-b border-[#F8E1E1] px-3 py-1.5 text-[12px] last:border-0">
                      <b className="w-[58px] shrink-0 font-semibold tabular-nums text-[#991B1B]">Row {er.row}</b>
                      <span className="min-w-0 text-[#7F1D1D]">{er.error}</span>
                    </li>
                  ))}
                </ul>
                {hiddenErrors > 0 && <p className="mb-0 mt-1.5 text-[11.5px] text-[#64748B]">+{hiddenErrors.toLocaleString()} more rows with errors not listed.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </RightSlidePanel>
  );
}
