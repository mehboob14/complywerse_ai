'use client';
// Connect (or re-sync) one source. Every field has a label, a secret can be shown on request,
// a problem is said in words at the top, and the result stays on screen until you close it.

import { useId, useState } from 'react';
import { clsx } from 'clsx';
import { useSyncSource, type ConnectorField } from '../../api';
import { Dialog } from '../../_components/Dialog';
import { Alert, Button, ButtonLink, FOCUS, Field, inputClass } from '../../_components/ui';
import { plural, sourceKeys, type Vendor } from './catalog';

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

function summarise(d: Record<string, unknown>): string {
  const left = ((d.skipped as { resource: string }[] | undefined) ?? []).map((s) => s.resource).join(', ');
  const grants = d.entitlements_linked == null ? '' : `, ${plural(num(d.entitlements_linked), 'access grant')}`;
  return `Connected. Pulled ${plural(num(d.created) + num(d.updated), 'account')}${grants}.${left ? ` Not readable with this token: ${left}.` : ''}`;
}

export function ConnectDialog({ vendor, fields, onClose }: { vendor: Vendor; fields: ConnectorField[]; onClose: () => void }) {
  const sync = useSyncSource();
  const formId = useId();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const needsBaseUrl = vendor.kind === 'iga' || (vendor.kind === 'app' && vendor.key !== 'database');
  const takesSample = vendor.kind === 'iga' || vendor.kind === 'app';

  const submit = (sample: boolean) => {
    setProblem(null);
    if (vendor.kind === 'upload' && !file) { setProblem('Choose a .csv or .xlsx file first.'); return; }
    if (needsBaseUrl && !sample && !baseUrl.trim()) { setProblem('Enter the API base URL.'); return; }
    let req: { url: string; body?: unknown; form?: FormData };
    if (vendor.kind === 'form') req = { url: `/connectors/${vendor.endpoint}/sync`, body: vendor.remembers ? { ...vals, remember } : vals };
    else if (vendor.kind === 'iga') req = { url: '/connectors/iga/sync', body: { vendor: vendor.key, base_url: baseUrl, credentials: vals, sample } };
    else if (vendor.kind === 'app') req = { url: '/connectors/apps/sync', body: { app: vendor.key, base_url: baseUrl, credentials: vals, sample } };
    else if (vendor.kind === 'upload') { const form = new FormData(); form.append('file', file!); req = { url: '/connectors/spreadsheet/import', form }; }
    else return;
    sync.mutate(req, {
      onSuccess: (d) => setDone(summarise(d)),
      onError: (e) => setProblem(e instanceof Error && e.message ? e.message : 'The sync failed.'),
    });
  };

  const sso = vendor.kind === 'sso';
  return (
    <Dialog open onClose={onClose} side width="max-w-lg" busy={sync.isPending} title={`Connect ${vendor.name}`} description={vendor.sub}
      footer={done ? (
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <ButtonLink href={`/compliance/access-reviews/new?source=${encodeURIComponent(sourceKeys(vendor)[0])}`} variant="primary">Start a review of this source</ButtonLink>
        </>
      ) : sso ? <Button onClick={onClose}>Close</Button> : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={sync.isPending}>Cancel</Button>
          {takesSample && <Button onClick={() => submit(true)} disabled={sync.isPending}>Load sample data</Button>}
          <Button type="submit" form={formId} variant="primary" loading={sync.isPending}>Connect and sync</Button>
        </>
      )}>
      <div className="space-y-4">
        {problem && <Alert tone="error" title="This source could not be connected">{problem}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        {sync.isPending && <p role="status" className="text-sm text-slate-700">Connecting and reading the source…</p>}

        {sso ? (
          <>
            <p className="text-sm text-slate-800">Microsoft Entra ID is connected once, for sign-in as well as for access reviews, in the identity settings.</p>
            <ButtonLink href="/admin?tab=identity" variant="primary">Open the identity settings</ButtonLink>
          </>
        ) : (
          <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-4">
            <p className="text-sm text-slate-700">
              {vendor.remembers
                ? 'Leave the token blank to reuse the one already connected. The people and access it finds join one shared population.'
                : 'Credentials are used for this sync only and are not stored. The people and access it finds join one shared population.'}
            </p>
            {vendor.kind === 'upload' ? (
              <Field label="File" hint="A .csv or .xlsx file with one row per person." required>
                {(aria) => (
                  <input {...aria} data-autofocus type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className={clsx('block w-full text-sm text-slate-800 file:mr-3 file:min-h-[36px] file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800', FOCUS)} />
                )}
              </Field>
            ) : (
              <>
                {needsBaseUrl && (
                  <Field label="API base URL" required hint="For example https://api.example.com">
                    {(aria) => <input {...aria} data-autofocus type="url" inputMode="url" autoComplete="off" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" className={inputClass} />}
                  </Field>
                )}
                {fields.map((f, i) => (
                  <Field key={f.name} label={f.label}>
                    {(aria) => (
                      <div className="relative">
                        <input {...aria} data-autofocus={!needsBaseUrl && i === 0 ? true : undefined} name={f.name} type={f.secret && !reveal[f.name] ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                          placeholder={f.ph} value={vals[f.name] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                          className={clsx(inputClass, f.secret && 'pr-16')} />
                        {f.secret && (
                          <button type="button" aria-pressed={!!reveal[f.name]} onClick={() => setReveal((r) => ({ ...r, [f.name]: !r[f.name] }))}
                            className={clsx('absolute inset-y-0 right-1 my-auto h-8 rounded px-2 text-xs font-semibold text-teal-800 hover:bg-slate-100', FOCUS)}>
                            {reveal[f.name] ? 'Hide' : 'Show'}<span className="sr-only"> {f.label}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </Field>
                ))}
              </>
            )}
            {vendor.remembers && (
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-700">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />
                <span>Keep this token, encrypted, so later reviews can refresh without it being typed again. It is the same credential the evidence collector uses.</span>
              </label>
            )}
          </form>
        )}
      </div>
    </Dialog>
  );
}
