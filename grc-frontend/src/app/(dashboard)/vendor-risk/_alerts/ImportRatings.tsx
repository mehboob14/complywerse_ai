'use client';

// Import a ratings provider's export (a CSV with vendor, score and date columns): a fall of ten points or more raises a signal. It also says which feeds are on, so the page does not imply more
// than fills it. Right: monitoring:create, or the monitoring-edit / risk-edit right the server accepts in its place.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, FormError, FormField, Notice, Sheet, TextInput, useNotify, useReportedMutation } from '@/components/ui/ds';
import { tpraApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { ALERT_REFRESH, type Provider } from './alertsApi';

interface Result { imported: number; already_held: number; drops: number; problems: string[] }

export function feedLine(p: Provider): string {
  return `${p.label}: ${p.configured ? 'on' : p.reaches_internet ? 'off (turn it on in Settings)' : 'off'}`;
}

export function ImportRatings({ open, onClose, feeds }: { open: boolean; onClose: () => void; feeds: readonly Provider[] | undefined }) {
  const notify = useNotify();
  const [provider, setProvider] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useReportedMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('file', f);
      if (provider.trim()) form.append('provider', provider.trim());
      return (await tpraApi.importRatings(form)).data as Result;
    },
    success: (r) => ({
      title: `${formatCount(r.imported)} ratings imported`,
      message: [r.drops ? `${formatCount(r.drops)} ${r.drops === 1 ? 'drop' : 'drops'} raised as signals.` : '', r.already_held ? `${formatCount(r.already_held)} were already held.` : ''].filter(Boolean).join(' ') || undefined,
    }),
    failure: "Couldn't import the ratings",
    invalidate: [...ALERT_REFRESH, ['tprm-outside-in-portfolio']],
    toast: 'success',
    retryable: false,
    onSuccess: (r) => {
      if (r.problems.length > 0) notify.warning(`${formatCount(r.problems.length)} ${r.problems.length === 1 ? 'line was' : 'lines were'} skipped: ${r.problems.slice(0, 3).join('; ')}`, { title: 'Some lines were skipped' });
      setFile(null); setProvider(''); onClose();
    },
  });
  const close = () => { if (!run.isPending) { run.reset(); setFile(null); onClose(); } };
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import ratings"
      subtitle="From a security-ratings provider's export"
      dirty={file != null || provider.trim() !== ''}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} disabled={!file} onClick={() => { if (file) run.mutate(file); }}>Import</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <p className="m-0 text-ds-body text-ds-fg-body">A CSV with vendor, score (0 to 100) and date columns. A fall of ten points or more is raised as a signal.</p>
        <FormField label="Provider name" optional hint="Shown beside the score. Left blank it is called Security ratings.">
          <TextInput value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={60} />
        </FormField>
        <FormField label="The file" required>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<Upload aria-hidden />} onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose a CSV file'}</Button>
            <span className="min-w-0 break-all text-ds-body text-ds-fg-muted">{file ? file.name : 'No file chosen'}</span>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </div>
        </FormField>
        <FormError title="Couldn't import the ratings" error={run.error} onRetry={file ? () => run.mutate(file) : undefined} />
        <div className="flex flex-col gap-[6px]">
          <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Feeds</h3>
          {feeds && feeds.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-[4px] p-0 text-ds-body text-ds-fg">{feeds.map((f) => <li key={f.provider}>{feedLine(f)}</li>)}</ul>
          ) : <p className="m-0 text-ds-body text-ds-fg-muted">Which feeds are on could not be read.</p>}
          <Notice tone="info">A ratings provider is a paid feed. Until one is connected, import its export here.</Notice>
        </div>
      </div>
    </Sheet>
  );
}
