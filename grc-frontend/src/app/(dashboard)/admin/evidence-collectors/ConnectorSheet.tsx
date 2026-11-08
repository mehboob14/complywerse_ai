'use client';

// Connecting one collector, written for the person doing it, in the kit's Sheet (it was a hand-built dialog with no focus trap and no Escape, which lost a typed credential when its backdrop was pressed).
// Three steps: create the credential in the provider's own menus (the exact read-only permissions, how long it lasts), enter it here, then Test (live results, nothing saved) and Collect (recorded as evidence).
// What the collector checks and reads are one fold away; the technical lines (the exact rule, the API call) are inside it for the people who audit them. Closing with a credential typed asks first.
// The credential is never shown again, never put in the address, and the field is cleared after it is saved.
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, ShieldCheck, XCircle } from 'lucide-react';
import { Button, Disclosure, ErrorState, FormField, Notice, Sheet, SkeletonRows, StatusPill, TextInput, Textarea } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { automationApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { connection } from '@/lib/statuses/controls';
import type { Connector } from './connectionsModel';

type FieldKey = 'token' | 'secret2' | 'domain' | 'email' | 'access_key_id' | 'region';
const SECRET_FIELDS: FieldKey[] = ['token', 'secret2'];
interface Field { key: FieldKey; label: string; placeholder?: string; help?: string; required?: boolean }
interface ConnectorTest { id: string; title: string; checks: string | null; rule: string | null; fails_when: string | null; soc2: string[]; scf: string[]; call: string | null }
interface Details {
  provider: string; label: string; category: string; fields: Field[];
  setup: { credential?: string; steps?: string[]; create_url?: string | null; permissions?: string[]; plan_note?: string | null; token_lifetime?: string | null; docs_url?: string | null; caveats?: string[] } | null;
  tests: ConnectorTest[];
  reads: { call: string; what: string }[];
}
interface Finding { control_codes?: string[]; check: string; resource?: string; status: string; detail?: string }

const SUMMARY_RESOURCES = new Set(['directory', 'region', 'account']);
const RESULT_WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', error: 'Could not check', info: 'Recorded', not_run: 'Nothing to check', not_applicable: 'Nothing to check' };
const RESULT_TONE: Record<string, string> = { pass: 'text-ds-success', fail: 'text-ds-danger', error: 'text-ds-warning' };

function Step({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <h3 className="m-0 flex items-center gap-[8px] !text-ds-body !font-[600] !text-ds-fg">
          <span aria-hidden className="grid h-[20px] w-[20px] place-items-center rounded-full bg-ds-primary text-ds-label font-[600] text-ds-on-primary">{n}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One test the collector runs, with the controls it evidences; its exact rule and the call it makes are inside, as technical details. */
function TestItem({ test }: { test: ConnectorTest }) {
  const [open, setOpen] = useState(false);
  const technical = test.rule || test.fails_when || test.call;
  return (
    <li className="border-t border-ds-border py-[6px] first:border-t-0">
      <p className="m-0 text-ds-body font-[600] text-ds-fg">{test.title}</p>
      {test.checks && <p className="m-0 text-ds-label text-ds-fg-muted">{test.checks}</p>}
      {(test.scf.length > 0 || test.soc2.length > 0) && (
        <p className="m-0 mt-[4px] flex flex-wrap gap-[4px]">
          {test.scf.map((c) => <span key={c} title="A control this test evidences" className="rounded-ds-control bg-ds-primary-soft px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-primary-text">{c}</span>)}
          {test.soc2.map((c) => <span key={c} title="A SOC 2 criterion" className="rounded-ds-control bg-ds-surface-hover px-[6px] py-[1px] font-mono text-ds-label text-ds-fg-body">{c}</span>)}
        </p>
      )}
      {technical && (
        <>
          <Button variant="link" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide the technical details' : 'Technical details'}</Button>
          {open && (
            <dl className="m-0 grid gap-x-[12px] gap-y-[4px] text-ds-label sm:grid-cols-[8rem_1fr]">
              {test.rule && (<><dt className="font-[600] text-ds-fg-muted">Exact rule</dt><dd className="m-0 text-ds-fg-body">{test.rule}</dd></>)}
              {test.fails_when && (<><dt className="font-[600] text-ds-fg-muted">A failure means</dt><dd className="m-0 text-ds-fg-body">{test.fails_when}</dd></>)}
              {test.call && (<><dt className="font-[600] text-ds-fg-muted">Request it makes</dt><dd className="m-0 break-all font-mono text-ds-fg-body">{test.call}</dd></>)}
            </dl>
          )}
        </>
      )}
    </li>
  );
}

/** Test results grouped by test, so a person reads "Droplets have backups: 2 failing", not raw check ids. */
function Results({ findings, tests }: { findings: Finding[]; tests: ConnectorTest[] }) {
  const titles = new Map(tests.map((t) => [t.id, t.title]));
  const titleFor = (check: string) => titles.get(check) || check.replace(/^[^.]+\./, '').replace(/[._]/g, ' ');
  const summaries = findings.filter((f) => SUMMARY_RESOURCES.has(f.resource || '') || f.check.endsWith('.connectivity'));
  const items = findings.filter((f) => !summaries.includes(f) && f.status === 'fail');
  if (!findings.length) return null;
  return (
    <ul aria-label="Test results" className="m-0 mt-[8px] list-none rounded-ds-card border border-ds-border p-0">
      {summaries.map((f, i) => {
        const failing = items.filter((x) => x.check === f.check || x.check.startsWith(`${f.check}_`));
        return (
          <li key={`${f.check}-${i}`} className="border-t border-ds-border px-[10px] py-[6px] first:border-t-0">
            <div className="flex items-start justify-between gap-[8px]">
              <div className="min-w-0">
                <p className="m-0 text-ds-body font-[600] text-ds-fg">{f.check.endsWith('.connectivity') ? 'Connection' : titleFor(f.check)}</p>
                {f.detail && <p className="m-0 text-ds-label text-ds-fg-muted">{f.detail}</p>}
              </div>
              <span className={`shrink-0 text-ds-label font-[600] ${RESULT_TONE[f.status] ?? 'text-ds-fg-muted'}`}>{RESULT_WORD[f.status] ?? f.status}</span>
            </div>
            {failing.length > 0 && (
              <p className="m-0 mt-[4px] flex flex-wrap gap-[4px]">
                {failing.slice(0, 12).map((x, j) => <span key={`${x.resource}-${j}`} className="rounded-ds-control bg-ds-danger-soft px-[6px] py-[1px] font-mono text-ds-label text-ds-danger">{x.resource}</span>)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ConnectorSheet({ connector, onClose, onChanged, returnTo, returnLabel, canConnect }: {
  connector: Connector;
  onClose: () => void;
  onChanged: () => void;
  returnTo?: string | null;
  returnLabel?: string | null;
  /** the server lets only people who may run scans connect, test and collect (compliance:scan:execute); everyone may read the guide */
  canConnect: boolean;
}) {
  const provider = connector.provider;
  const supported = connector.supported && Boolean(provider);
  const connected = connector.connected;
  const [reconfig, setReconfig] = useState(!connected);
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'collect' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  const detailsQ = useQuery({
    queryKey: ['collector-details', provider],
    enabled: supported,
    queryFn: () => automationApi.getCollectorDetails(provider!).then((r) => r.data as Details),
    staleTime: 10 * 60_000,
  });
  const d = detailsQ.data;
  const setup = d?.setup;
  const fields = d?.fields ?? [];
  const typed = Object.values(values).some((v) => (v ?? '').length > 0);

  const save = async () => {
    if (!provider) return;
    const missing = fields.filter((f) => f.required !== false && !(values[f.key] || '').trim()).map((f) => f.label);
    if (missing.length) { setMsg({ tone: 'danger', title: 'Something is missing', text: `Fill in: ${missing.join(', ')}.` }); return; }
    setBusy('save'); setMsg(null);
    try {
      await automationApi.connectCollector(provider, {
        token: (values.token || '').trim(),
        secret2: values.secret2?.trim() || undefined,
        domain: values.domain?.trim() || undefined,
        email: values.email?.trim() || undefined,
        access_key_id: values.access_key_id?.trim() || undefined,
        region: values.region?.trim() || undefined,
      });
      setMsg({ tone: 'success', title: 'Credential saved', text: 'It is stored encrypted. Run Test to confirm it works.' });
      setReconfig(false); setValues({});
      onChanged();
    } catch (e) {
      setMsg({ tone: 'danger', title: 'The credential was not saved', text: errorMessage(e, 'Try again.') });
    } finally { setBusy(null); }
  };

  const test = async () => {
    if (!provider) return;
    setBusy('test'); setMsg(null); setFindings(null);
    try {
      const data = (await automationApi.testCollector(provider)).data as { connectivity: string; summary: string; findings: Finding[] };
      const reached = data.connectivity === 'pass' || data.connectivity === 'ok';
      setFindings(data.findings || []);
      setMsg(reached
        ? { tone: 'success', title: 'The credential works', text: 'These are live results; nothing was saved. Run Collect to record them as evidence.' }
        : { tone: 'danger', title: `${connector.name} rejected the request`, text: 'Check the credential and its permissions, then test again.' });
    } catch (e) {
      setMsg({ tone: 'danger', title: 'The test did not run', text: errorMessage(e, 'Try again.') });
    } finally { setBusy(null); }
  };

  const collect = async () => {
    if (!provider) return;
    setBusy('collect'); setMsg(null);
    try {
      const data = (await automationApi.runCollector(provider)).data as { status: string };
      setMsg(data.status === 'error'
        ? { tone: 'danger', title: 'Nothing was collected', text: `${connector.name} could not be reached. Run Test for the details.` }
        : { tone: 'success', title: 'Collected', text: 'The results are now evidence on every control these tests cover. Collection repeats daily.' });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'danger', title: 'Collection did not run', text: errorMessage(e, 'Try again.') });
    } finally { setBusy(null); }
  };

  const state = supported ? statusPill(connection, connected ? 'connected' : 'not_connected') : null;
  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      dirty={typed}
      title={<span className="inline-flex min-w-0 items-center gap-[10px]"><BrandLogo id={connector.id} name={connector.name} size={32} /><span className="min-w-0 truncate">{connector.name}</span></span>}
      subtitle={supported ? `${d ? `${d.tests.length} automated tests` : 'Automated tests'} using read-only access${setup?.credential ? ` · ${setup.credential}` : ''}` : 'Not available yet'}
      actions={state ? <StatusPill size="sm" {...state} /> : undefined}
      footer={(
        <>
          {returnTo ? <Link href={returnTo} className="mr-auto inline-flex min-h-ds-control items-center gap-[4px] text-ds-body font-medium text-ds-primary-text hover:underline"><ArrowLeft aria-hidden className="h-[14px] w-[14px]" />{`Back to ${returnLabel ?? 'where you were'}`}</Link> : null}
          <Button onClick={onClose}>Close</Button>
        </>
      )}
    >
      {!supported ? (
        <Notice tone="info" title="Not available yet">{`Collecting evidence straight from ${connector.name} is not available yet. It is listed so you can see what exists; there is nothing to connect.`}</Notice>
      ) : detailsQ.isPending ? (
        <SkeletonRows rows={5} columns={2} label="Loading the connection guide" />
      ) : detailsQ.isError ? (
        <ErrorState title="Couldn’t load the connection guide" message={errorMessage(detailsQ.error)} onRetry={canRetry(detailsQ.error) ? () => { void detailsQ.refetch(); } : undefined} />
      ) : (
        <div className="flex flex-col gap-[12px]">
          {!canConnect && <Notice tone="info" title="You can read the guide, not connect">Saving a credential, testing and collecting need the right to run scans. Ask an administrator if you need it.</Notice>}
          <Step n={1} title={setup?.credential ? `Create a ${setup.credential}` : `Create a ${connector.name} credential`}
            aside={setup?.create_url ? <a href={setup.create_url} target="_blank" rel="noreferrer" className="inline-flex min-h-ds-control items-center gap-[4px] text-ds-body font-[600] text-ds-primary-text hover:underline">{`Open ${connector.name}`}<ExternalLink aria-hidden className="h-[12px] w-[12px]" /></a> : null}>
            {setup?.steps?.length ? (
              <ol className="m-0 flex list-none flex-col gap-[6px] p-0">
                {setup.steps.map((s, i) => (
                  <li key={i} className="flex gap-[8px] text-ds-body text-ds-fg-body">
                    <span aria-hidden className="mt-[2px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label font-[600] text-ds-fg-body">{i + 1}</span>
                    <span className="min-w-0">{s}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="m-0 text-ds-body text-ds-fg-body">{`Create a read-only API credential in ${connector.name} for the requests listed under “What it reads”.`}</p>}
            {setup?.permissions && setup.permissions.length > 0 && (
              <div className="mt-[8px]">
                <p className="m-0 mb-[4px] inline-flex items-center gap-[4px] text-ds-label font-[600] text-ds-fg-muted"><ShieldCheck aria-hidden className="h-[12px] w-[12px]" />Permissions it needs (read-only)</p>
                <p className="m-0 flex flex-wrap gap-[4px]">{setup.permissions.map((p) => <span key={p} className="rounded-ds-control bg-ds-surface-hover px-[6px] py-[1px] font-mono text-ds-label text-ds-fg-body">{p}</span>)}</p>
              </div>
            )}
            {(setup?.token_lifetime || setup?.plan_note || (setup?.caveats?.length ?? 0) > 0) && (
              <ul className="m-0 mt-[8px] list-none p-0 text-ds-label text-ds-fg-body">
                {setup?.token_lifetime && <li><b>Lifetime:</b> {setup.token_lifetime}</li>}
                {setup?.plan_note && <li><b>Plan:</b> {setup.plan_note}</li>}
                {setup?.caveats?.map((c) => <li key={c}>• {c}</li>)}
              </ul>
            )}
            {setup?.docs_url && <a href={setup.docs_url} target="_blank" rel="noreferrer" className="mt-[8px] inline-flex min-h-ds-control items-center gap-[4px] text-ds-label text-ds-fg-muted hover:text-ds-primary-text">{`${connector.name} documentation`}<ExternalLink aria-hidden className="h-[12px] w-[12px]" /></a>}
          </Step>

          <Step n={2} title="Enter it here" aside={connected && !reconfig ? <Button variant="link" size="sm" onClick={() => setReconfig(true)}>Replace credential</Button> : null}>
            {reconfig ? (
              <form className="flex flex-col gap-[10px]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                {fields.map((f) => {
                  const secret = SECRET_FIELDS.includes(f.key);
                  // a pasted JSON key file (Google) needs room, not a one-line password box
                  const multiline = secret && (f.placeholder || '').trimStart().startsWith('{');
                  return (
                    <FormField key={f.key} label={f.label} optional={f.required === false} hint={f.help}>
                      {multiline ? (
                        <Textarea autoComplete="off" spellCheck={false} rows={4} value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="font-mono [-webkit-text-security:disc]" />
                      ) : (
                        <TextInput type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className={secret || f.key === 'access_key_id' ? 'font-mono' : undefined} />
                      )}
                    </FormField>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <p className="m-0 inline-flex items-center gap-[4px] text-ds-label text-ds-fg-muted"><KeyRound aria-hidden className="h-[12px] w-[12px]" />Stored encrypted. Never paste it into chat.</p>
                  <Button variant="primary" type="submit" loading={busy === 'save'} disabled={!canConnect || (busy !== null && busy !== 'save')}>Save</Button>
                </div>
              </form>
            ) : (
              <Notice tone="info" icon={CheckCircle2} title="A credential is saved">{connector.last_run?.started_at ? `Last collected ${formatDateTime(connector.last_run.started_at)}.` : 'Nothing has been collected yet.'}</Notice>
            )}
          </Step>

          <Step n={3} title="Check it works">
            <p className="m-0 text-ds-body text-ds-fg-body"><b>Test</b> runs every check live and shows the results without saving them. <b>Collect</b> records them as evidence on the controls they cover; collection then repeats daily.</p>
            <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
              <Button onClick={test} loading={busy === 'test'} disabled={!canConnect || !connected || (busy !== null && busy !== 'test')}>Test</Button>
              <Button variant="primary" onClick={collect} loading={busy === 'collect'} disabled={!canConnect || !connected || (busy !== null && busy !== 'collect')}>Collect</Button>
              {!connected && <span className="text-ds-label text-ds-fg-muted">Save a credential first.</span>}
            </div>
            {msg && (
              <Notice tone={msg.tone === 'success' ? 'info' : 'danger'} title={msg.title} icon={msg.tone === 'success' ? CheckCircle2 : XCircle} className="mt-[8px]">{msg.text}</Notice>
            )}
            {findings && <Results findings={findings} tests={d?.tests ?? []} />}
          </Step>

          <Disclosure label={`What it checks${d ? ` · ${d.tests.length} tests` : ''}`} level={3}>
            <ul className="m-0 list-none p-0">{(d?.tests ?? []).map((t) => <TestItem key={t.id} test={t} />)}</ul>
          </Disclosure>
          <Disclosure label="What it reads" level={3}>
            <p className="m-0 mb-[4px] text-ds-label font-[600] text-ds-success">Read-only: it changes nothing.</p>
            <ul className="m-0 list-none p-0">
              {(d?.reads ?? []).map((r) => <li key={r.call} className="border-t border-ds-border py-[6px] text-ds-body text-ds-fg-body first:border-t-0">{r.what}</li>)}
            </ul>
            {(d?.reads ?? []).length > 0 && (
              <Disclosure label="Technical details: the requests it makes" level={4}>
                <ul className="m-0 list-none p-0">
                  {(d?.reads ?? []).map((r) => <li key={r.call} className="break-all py-[2px] font-mono text-ds-label text-ds-fg-muted">{r.call}</li>)}
                </ul>
              </Disclosure>
            )}
          </Disclosure>
        </div>
      )}
    </Sheet>
  );
}
