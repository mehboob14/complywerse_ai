'use client';

// Connecting one collector, written for the person doing it.
//
// Left: how to create this provider's credential (its own menus, the exact
// read-only permissions, how long the credential lasts), the form in the
// provider's own terms, then Test and Collect with results named by test.
// Right: every test the collector runs, with the controls each one evidences, and
// every API call it makes. Everything on the right is generated from the checks
// themselves, so it always matches what actually runs.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, ChevronRight, ExternalLink, KeyRound, Loader2, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { automationApi } from '@/lib/api';
import { BrandLogo } from '@/components/integrations/BrandLogo';

export interface CatalogConnector {
  id: string;
  name: string;
  category: string;
  categories: string[];
  provider: string | null;
  supported: boolean;
  control_codes: string[];
  syncs: string[];
  connected: boolean;
  connection_id: number | null;
  last_run: { status: string; started_at?: string | null } | null;
  steampipe_plugin: string | null;
  needs_key_id?: boolean;
  needs_region?: boolean;
}

type FieldKey = 'token' | 'secret2' | 'domain' | 'email' | 'access_key_id' | 'region';
const SECRET_FIELDS: FieldKey[] = ['token', 'secret2'];
interface FormField { key: FieldKey; label: string; placeholder?: string; help?: string; required?: boolean }
interface ConnectorTest {
  id: string; title: string; checks: string | null; rule: string | null; fails_when: string | null;
  soc2: string[]; scf: string[]; call: string | null;
}
interface Details {
  provider: string;
  label: string;
  category: string;
  fields: FormField[];
  setup: {
    credential?: string;
    steps?: string[];
    create_url?: string | null;
    permissions?: string[];
    plan_note?: string | null;
    token_lifetime?: string | null;
    docs_url?: string | null;
    caveats?: string[];
  } | null;
  tests: ConnectorTest[];
  reads: { call: string; what: string }[];
}
interface Finding { control_codes?: string[]; check: string; resource?: string; status: string; detail?: string }

const SUMMARY_RESOURCES = new Set(['directory', 'region', 'account']);

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : (e as Error)?.message || fallback;
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${connected ? 'text-emerald-600' : 'text-slate-400'}`}>
      <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}

function Section({ step, title, children, aside }: { step?: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {step != null && <span className="flex size-5 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">{step}</span>}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TestItem({ test }: { test: ConnectorTest }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50/70">
        <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-slate-800">{test.title}</span>
          {test.checks && <span className={`block text-[12px] text-slate-500 ${open ? '' : 'line-clamp-1'}`}>{test.checks}</span>}
          <span className="mt-1 flex flex-wrap gap-1">
            {test.scf.map((c) => (
              <span key={c} title="SCF control this test is matched to" className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-700">{c}</span>
            ))}
            {test.soc2.map((c) => (
              <span key={c} title="SOC 2 criterion" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{c}</span>
            ))}
          </span>
        </span>
      </button>
      {open && (test.rule || test.fails_when || test.call) && (
        <dl className="grid gap-x-3 gap-y-1.5 border-t border-slate-100 px-3 py-2.5 pl-8 text-[12px] sm:grid-cols-[7.5rem_1fr]">
          {test.rule && (<><dt className="font-medium text-slate-500">Exact rule</dt><dd className="text-slate-700">{test.rule}</dd></>)}
          {test.fails_when && (<><dt className="font-medium text-slate-500">A failure means</dt><dd className="text-slate-700">{test.fails_when}</dd></>)}
          {test.call && (<><dt className="font-medium text-slate-500">API call</dt><dd><code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">{test.call}</code></dd></>)}
        </dl>
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
  const tone = (s: string) => (s === 'pass' ? 'text-emerald-700' : s === 'fail' ? 'text-rose-700' : s === 'error' ? 'text-amber-700' : 'text-slate-500');
  const label = (s: string) => ({ pass: 'Pass', fail: 'Fail', error: 'Could not check', info: 'Recorded', not_run: 'Nothing to check', not_applicable: 'Nothing to check' } as Record<string, string>)[s] || s;
  return (
    <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
      {summaries.map((f, i) => {
        const failing = items.filter((x) => x.check === f.check || x.check.startsWith(`${f.check}_`));
        return (
          <li key={`${f.check}-${i}`} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800">{f.check.endsWith('.connectivity') ? 'Connection' : titleFor(f.check)}</p>
                {f.detail && <p className="text-[11px] text-slate-500">{f.detail}</p>}
              </div>
              <span className={`shrink-0 text-[11px] font-semibold ${tone(f.status)}`}>{label(f.status)}</span>
            </div>
            {failing.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1">
                {failing.slice(0, 12).map((x, j) => (
                  <span key={`${x.resource}-${j}`} className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] text-rose-700">{x.resource}</span>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ConnectorDialog({
  connector, onClose, onChanged, returnTo, returnLabel,
}: {
  connector: CatalogConnector;
  onClose: () => void;
  onChanged: () => void;
  returnTo?: string | null;
  returnLabel?: string | null;
}) {
  const provider = connector.provider;
  const supported = connector.supported && Boolean(provider);
  const connected = connector.connected;
  const [reconfig, setReconfig] = useState(!connected);
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'collect' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
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

  const save = async () => {
    if (!provider) return;
    const missing = fields.filter((f) => f.required !== false && !(values[f.key] || '').trim()).map((f) => f.label);
    if (missing.length) { setMsg({ tone: 'err', text: `Fill in: ${missing.join(', ')}` }); return; }
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
      setMsg({ tone: 'ok', text: 'Saved and encrypted. Now run Test to confirm it works.' });
      setReconfig(false); setValues({});
      onChanged();
    } catch (e) {
      setMsg({ tone: 'err', text: errorText(e, 'Could not save the credentials.') });
    } finally { setBusy(null); }
  };

  const test = async () => {
    if (!provider) return;
    setBusy('test'); setMsg(null); setFindings(null);
    try {
      const r = await automationApi.testCollector(provider);
      const data = r.data as { connectivity: string; summary: string; findings: Finding[] };
      const reached = data.connectivity === 'pass' || data.connectivity === 'ok';
      setFindings(data.findings || []);
      setMsg(reached
        ? { tone: 'ok', text: 'The credential works. These are live results; nothing was saved. Run Collect to record them as evidence.' }
        : { tone: 'err', text: `${connector.name} rejected the request. Check the credential and its permissions. (${data.summary})` });
    } catch (e) {
      setMsg({ tone: 'err', text: errorText(e, 'Test failed.') });
    } finally { setBusy(null); }
  };

  const collect = async () => {
    if (!provider) return;
    setBusy('collect'); setMsg(null);
    try {
      const r = await automationApi.runCollector(provider);
      const data = r.data as { status: string; run_id: number };
      setMsg({
        tone: data.status === 'error' ? 'err' : 'ok',
        text: data.status === 'error'
          ? 'Collection could not reach the provider. Test the connection for details.'
          : 'Collected. Results are now evidence on every control these tests cover, and it will run again daily.',
      });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'err', text: errorText(e, 'Collection failed.') });
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Connect ${connector.name}`}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <div className="flex items-start gap-3.5 border-b border-slate-200 bg-white p-5">
          <BrandLogo id={connector.id} name={connector.name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-slate-900">{connector.name}</h2>
              {supported ? <StatusDot connected={connected} /> : <span className="text-[11px] font-semibold text-sky-600">Available via Steampipe</span>}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {supported
                ? `${d ? `${d.tests.length} automated tests` : 'Automated tests'} using read-only access${setup?.credential ? ` · ${setup.credential}` : ''}`
                : `Direct evidence collection isn't wired for ${connector.name} yet.`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {!supported ? (
          <div className="space-y-3 overflow-auto p-5">
            <Section title="Not wired yet">
              <p className="text-sm text-slate-600">
                {connector.name} is listed from the Steampipe plugin catalog. It has no collector here yet, so there is nothing to connect.
              </p>
            </Section>
          </div>
        ) : detailsQ.isLoading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading connection guide…</div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-4">
              <Section step={1} title={setup?.credential ? `Create a ${setup.credential}` : `Create a ${connector.name} credential`}
                aside={setup?.create_url ? (
                  <a href={setup.create_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline">
                    Open {connector.name} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}>
                {setup?.steps?.length ? (
                  <ol className="space-y-1.5">
                    {setup.steps.map((s, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{i + 1}</span>
                        <span className="min-w-0">{s}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-slate-600">Create a read-only API credential in {connector.name} for the calls listed on the right.</p>
                )}
                {setup?.permissions && setup.permissions.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><ShieldCheck className="h-3 w-3" /> Permissions it needs (read-only)</p>
                    <div className="flex flex-wrap gap-1">
                      {setup.permissions.map((p) => <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{p}</code>)}
                    </div>
                  </div>
                )}
                {(setup?.token_lifetime || setup?.plan_note || (setup?.caveats?.length ?? 0) > 0) && (
                  <ul className="mt-3 space-y-1 text-[12px] text-slate-600">
                    {setup?.token_lifetime && <li><span className="font-medium text-slate-700">Lifetime:</span> {setup.token_lifetime}</li>}
                    {setup?.plan_note && <li><span className="font-medium text-slate-700">Plan:</span> {setup.plan_note}</li>}
                    {setup?.caveats?.map((c) => <li key={c} className="flex gap-1.5"><span className="text-slate-400">•</span><span>{c}</span></li>)}
                  </ul>
                )}
                {setup?.docs_url && (
                  <a href={setup.docs_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-primary-700">
                    {connector.name} documentation <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </Section>

              <Section step={2} title="Enter it here"
                aside={connected && !reconfig ? (
                  <button type="button" onClick={() => setReconfig(true)} className="text-xs font-semibold text-primary-700 hover:underline">Replace credential</button>
                ) : null}>
                {reconfig ? (
                  <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    {fields.map((f) => {
                      const secret = SECRET_FIELDS.includes(f.key);
                      // a pasted JSON key file (Google) needs room, not a one-line password box
                      const multiline = secret && (f.placeholder || '').trimStart().startsWith('{');
                      return (
                        <label key={f.key} className="block">
                          <span className="mb-1 block text-[12px] font-medium text-slate-700">{f.label}{f.required === false && <span className="font-normal text-slate-400"> (optional)</span>}</span>
                          {multiline ? (
                            <textarea autoComplete="off" spellCheck={false} rows={4}
                              value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                              placeholder={f.placeholder}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs focus:border-primary-500 focus:outline-none [-webkit-text-security:disc]" />
                          ) : (
                            <input type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                              value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                              placeholder={f.placeholder}
                              className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none ${secret || f.key === 'access_key_id' ? 'font-mono' : ''}`} />
                          )}
                          {f.help && <span className="mt-0.5 block text-[11px] text-slate-500">{f.help}</span>}
                        </label>
                      );
                    })}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="flex items-center gap-1 text-[11px] text-slate-500"><KeyRound className="h-3 w-3" /> Stored encrypted. Never paste it into chat.</p>
                      <button type="submit" disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                        {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" /> A credential is saved{connector.last_run?.started_at ? `; last collected ${new Date(connector.last_run.started_at).toLocaleString()}` : ''}.
                  </p>
                )}
              </Section>

              <Section step={3} title="Check it works">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  <span className="font-medium text-slate-700">Test</span> runs every check live and shows the results without saving them.{' '}
                  <span className="font-medium text-slate-700">Collect</span> records them as evidence on the controls they cover. Collection then repeats daily.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={test} disabled={busy !== null || !connected}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {busy === 'test' && <Loader2 className="h-4 w-4 animate-spin" />} Test
                  </button>
                  <button type="button" onClick={collect} disabled={busy !== null || !connected}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
                    {busy === 'collect' && <Loader2 className="h-4 w-4 animate-spin" />} Collect
                  </button>
                  {!connected && <span className="self-center text-[11px] text-slate-400">Save a credential first</span>}
                </div>
                {msg && (
                  <p className={`mt-3 flex gap-1.5 rounded-lg border px-3 py-2 text-[13px] ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                    {msg.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span>{msg.text}</span>
                  </p>
                )}
                {findings && <Results findings={findings} tests={d?.tests ?? []} />}
              </Section>
            </div>

            <div className="min-w-0 space-y-4">
              <Section title={`What it checks${d ? ` · ${d.tests.length} tests` : ''}`}>
                <ul className="space-y-2">
                  {(d?.tests ?? []).map((t) => <TestItem key={t.id} test={t} />)}
                </ul>
              </Section>
              <Section title="What it reads" aside={<span className="text-[11px] font-medium text-emerald-700">Read-only · changes nothing</span>}>
                <ul className="divide-y divide-slate-100">
                  {(d?.reads ?? []).map((r) => (
                    <li key={r.call} className="py-2 first:pt-0 last:pb-0">
                      <code className="block break-all text-[11px] text-slate-700">{r.call}</code>
                      <span className="block text-[12px] text-slate-500">{r.what}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
          {returnTo ? (
            <Link href={returnTo} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to {returnLabel}
            </Link>
          ) : <span />}
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        </div>
      </div>
    </div>
  );
}
