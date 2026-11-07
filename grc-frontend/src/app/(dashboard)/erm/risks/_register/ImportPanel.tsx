'use client';

/**
 * Import a risk register: a right-hand panel (the kit's SidePanel) with the register type, the file, the template, and the result in words. The three paths and what they read are
 * riskImport.ts (unchanged); what is new is that a failure stays in the panel with the server's own sentence, the rows an NCA import could not post are named ("Row 14"), the
 * template is one press away, and the check for older NCA entries (which used to run in silence whenever the NCA filter was picked) is a button that says what it found.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Link2, Upload } from 'lucide-react';
import { Button, FormField, Notice, Select, SidePanel, useNotify } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { ONELINK, bridgeOlderNcaEntries, downloadTemplate, importRegister, isNca, type ImportOutcome } from './riskImport';

/** The register types the import offers (a blank one is the standard reader's own). */
const TYPES = ['UBL Template', 'NCA Template', ONELINK, 'RCSA', 'PCI-DSS', 'ISO 27001', 'SOX', 'GDPR', 'NIST', 'SAMA CSF', 'Internal', 'Project-Based', 'Third-Party', 'Other'];
const MAX_ROWS_NAMED = 12;

export function ImportPanel({ open, onClose, initialType = '' }: { open: boolean; onClose: () => void; initialType?: string }) {
  const [type, setType] = useState(initialType);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [bridging, setBridging] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const notify = useNotify();
  const close = () => { setOutcome(null); setFailure(null); onClose(); };
  const refresh = () => ['erm-risks-lean', 'erm-risks-dashboard', 'erm-risks-heatmap', 'nca-risk-entries'].forEach((k) => { void qc.invalidateQueries({ queryKey: [k] }); });

  const run = async (f: File) => {
    setBusy(true);
    setOutcome(null);
    setFailure(null);
    try {
      const result = await importRegister(f, type);
      setOutcome(result);
      refresh();
      notify.success(result.message, { title: 'Register imported' });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The file could not be imported.');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const template = async () => {
    try { await downloadTemplate(); } catch { notify.error('The template could not be downloaded.', { title: 'Download failed', retry: () => { void template(); } }); }
  };

  const bridge = async () => {
    setBridging(true);
    try {
      const n = await bridgeOlderNcaEntries();
      if (n > 0) refresh();
      notify.success(n > 0 ? `${formatCount(n)} older NCA ${n === 1 ? 'entry is' : 'entries are'} in the register now.` : 'There are no older NCA entries to bring in.', { title: 'NCA entries checked' });
    } catch {
      notify.error('The older NCA entries could not be checked.', { title: 'Not checked', retry: () => { void bridge(); } });
    } finally {
      setBridging(false);
    }
  };

  const named = outcome?.errors.slice(0, MAX_ROWS_NAMED) ?? [];
  return (
    <SidePanel open={open} onClose={close} title="Import a risk register" subtitle="An Excel workbook" width="md" dockFrom={Infinity}>
      <div className="flex flex-col gap-[16px]">
        <FormField label="Register type" optional hint="Files every risk of the workbook under this register. Leave it empty for the standard layout.">
          <Select placeholder="Standard layout" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>

        <div className="flex flex-wrap items-center gap-[8px]">
          <input
            ref={file}
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); }}
          />
          <Button variant="primary" loading={busy} leftIcon={<Upload aria-hidden />} onClick={() => file.current?.click()}>{busy ? 'Importing…' : 'Choose a file'}</Button>
          <Button leftIcon={<Download aria-hidden />} onClick={() => { void template(); }}>Download the template</Button>
        </div>
        {isNca(type) && <p className="m-0 text-ds-label text-ds-fg-muted">An NCA workbook is read row by row; each row becomes a risk in the register, so a long file takes a moment.</p>}

        {failure && <Notice tone="danger" title="The file was not imported">{failure}</Notice>}

        {outcome && (
          <Notice tone={outcome.errors.length ? 'warning' : 'info'} title={outcome.message}>
            {outcome.created > 0 && <p className="m-0">{formatCount(outcome.created)} {outcome.created === 1 ? 'risk was' : 'risks were'} added.</p>}
            {outcome.skipped > 0 && <p className="m-0">{formatCount(outcome.skipped)} already in the register {outcome.skipped === 1 ? 'was' : 'were'} skipped.</p>}
            {outcome.errors.length > 0 && (
              <>
                <p className="m-0">{formatCount(outcome.errors.length)} {outcome.errors.length === 1 ? 'row was' : 'rows were'} not imported:</p>
                <ul className="m-0 list-disc pl-[20px]">{named.map((m, i) => <li key={`${m}-${i}`} className="break-words">{m}</li>)}</ul>
                {outcome.errors.length > named.length && <p className="m-0">and {formatCount(outcome.errors.length - named.length)} more.</p>}
              </>
            )}
          </Notice>
        )}

        <div className="border-t border-ds-border pt-[12px]">
          <h3 className="!text-ds-body !font-[600] !text-ds-fg">Older NCA entries</h3>
          <p className="mb-[8px] mt-[2px] text-ds-label text-ds-fg-muted">Entries made before NCA risks joined the register have no risk of their own. This brings them in.</p>
          <Button loading={bridging} leftIcon={<Link2 aria-hidden />} onClick={() => { void bridge(); }}>Bring in older NCA entries</Button>
        </div>
      </div>
    </SidePanel>
  );
}
