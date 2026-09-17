'use client';

// The Tests tab: what a control's automated tests do, where they get their data,
// and what they last found.
//
// Sources in one category are alternatives — a tenant runs one cloud, not four —
// so a category asks for any one of them. Every test says, in words generated
// from its own definition, what it checks, what it reads and what a failure
// means, so nobody has to connect a system to find out what will happen.
// Connecting opens the Connections page on that connector, with a way back.

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, KeyRound, Loader2, Play, ShieldCheck, Workflow } from 'lucide-react';
import { automationApi } from '@/lib/api';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { ControlStatusPill, type BindingSource, type LinkedCheck } from '@/components/soc2/ui';

export const CATEGORY_LABEL: Record<string, string> = {
  scm: 'Source control', identity: 'Identity provider', cloud: 'Cloud and databases',
  observability: 'Observability', security: 'Security tooling', productivity: 'Work management',
  comms: 'Communications', email: 'Email', incident: 'Incident response', hr: 'HR system',
  mdm: 'Device management', itsm: 'IT service management', crm: 'CRM', data: 'Data platform',
  payments: 'Payments', ai: 'AI platform', other: 'Other',
};

export interface TestExplanation {
  checks: string;
  rule: string | null;
  reads: string;
  call: string | null;
  fields: string[];
  fails_when: string | null;
  excludes: string | null;
  when_empty: string | null;
}
export interface ProviderTest {
  id: string;
  title: string;
  explain: TestExplanation | null;
  result: {
    status: string;
    detail: string | null;
    population: number | null;
    tested: number | null;
    failing_items: string[];
    checked_at: string | null;
  } | null;
}
export interface TestGroup {
  category: string;
  connected: boolean;
  status: string;
  providers: { provider: string; label: string; connected: boolean; checks: LinkedCheck[]; tests?: ProviderTest[] }[];
}

// A finding's word → the status vocabulary the pills use.
const RESULT_STATUS: Record<string, string> = {
  pass: 'passed', fail: 'failed', error: 'collection_failed', not_run: 'not_run', not_applicable: 'not_run',
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : (e as Error)?.message || fallback;
}

function HowItWorks({ code, bindingSource, bindingVia }: { code: string; bindingSource?: BindingSource | null; bindingVia: string[] }) {
  const steps = [
    { icon: KeyRound, title: 'Connect one source', text: 'Add a read-only API key for a system you already run. It is stored encrypted and can never change anything.' },
    { icon: Workflow, title: 'Tests run on their own', text: 'Each test reads configuration through the provider’s API once a day, and whenever you run it.' },
    { icon: ShieldCheck, title: 'Results become evidence', text: `A pass is evidence ${code} operates. A failure marks it failing and names what failed. Results expire with the control’s reassessment window.` },
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">How automated testing works</h3>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg bg-slate-50 p-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-primary-700 ring-1 ring-slate-200">
              <s.icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-800">{i + 1}. {s.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {bindingVia.length > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          {bindingSource === 'covers'
            ? <>Tests below are matched to {code}&apos;s own objectives: <span className="font-mono">{bindingVia.join(' · ')}</span>.</>
            : <>Tests below reach {code} through SOC 2 {bindingVia.join(', ')} until SCF-level matches are reviewed, so some may test only part of it.</>}
        </p>
      )}
    </section>
  );
}

function TestRow({ test, connected }: { test: ProviderTest; connected: boolean }) {
  const [open, setOpen] = useState(false);
  const r = test.result;
  const e = test.explain;
  const counted = r?.tested != null && r?.population != null ? ` · ${r.tested} of ${r.population} checked` : '';
  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-700">{value}</dd>
    </>
  );
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50/70">
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-slate-800">{test.title}</span>
          {!open && e && <span className="block truncate text-[11px] text-slate-500">{e.checks}</span>}
        </span>
        {connected && (r
          ? <ControlStatusPill status={RESULT_STATUS[r.status] || 'not_run'} />
          : <span className="shrink-0 text-[11px] text-slate-400">Not collected yet</span>)}
      </button>
      {connected && r?.detail && (
        <p className="-mt-1 px-3 pb-2 pl-8 text-[11px] text-slate-500">{r.detail}{counted}</p>
      )}
      {open && (
        <dl className="grid gap-x-4 gap-y-2 border-t border-slate-100 px-3 py-3 pl-8 text-[12px] leading-relaxed sm:grid-cols-[9rem_1fr]">
          {e ? (
            <>
              {row('What it checks', e.checks)}
              {e.rule && row('Exact rule', e.rule)}
              {row('What it reads', <>{e.reads}{e.fields.length > 0 && <span className="text-slate-500"> — only {e.fields.join(', ')}</span>}</>)}
              {e.call && row('API call', <><code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">{e.call}</code> <span className="text-slate-500">· read-only</span></>)}
              {e.fails_when && row('A failure means', e.fails_when)}
              {e.excludes && row('Leaves out', e.excludes)}
              {e.when_empty && row('Nothing to check', e.when_empty)}
            </>
          ) : row('What it checks', test.title)}
          {connected && r?.failing_items && r.failing_items.length > 0 && row('Failing now', (
            <span className="flex flex-wrap gap-1">
              {r.failing_items.map((item) => (
                <span key={item} className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] text-rose-700">{item}</span>
              ))}
            </span>
          ))}
          {connected && r?.checked_at && row('Last collected', when(r.checked_at))}
        </dl>
      )}
    </li>
  );
}

function ProviderCard({ code, provider: p, connectionId, onRan }: {
  code: string;
  provider: TestGroup['providers'][number];
  connectionId?: number | null;
  onRan: () => void;
}) {
  const [open, setOpen] = useState(p.connected);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plugin = p.checks[0];
  const tests = p.tests ?? [];
  const lastRun = plugin?.last_run?.started_at;
  const back = `/automation/soc2-controls/${encodeURIComponent(code)}?tab=tests`;
  const connectHref = `/admin/evidence-collectors?connector=${encodeURIComponent(p.provider)}&return=${encodeURIComponent(back)}`;
  const status = p.checks.map((c) => (c as LinkedCheck & { control_status?: string }).control_status).find(Boolean) || 'not_run';

  const run = async () => {
    if (!plugin?.id) return;
    setBusy(true); setErr(null);
    try {
      await automationApi.runCheck(plugin.id, connectionId ?? undefined);
      onRan();
    } catch (e) {
      setErr(errorText(e, 'Could not run the tests.'));
    } finally { setBusy(false); }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <BrandLogo id={p.provider} name={p.label} size={36} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold text-slate-800">{p.label}</span>
          <span className="block text-[11px] text-slate-500">
            {tests.length} test{tests.length === 1 ? '' : 's'} for {code}
            {' · '}
            {p.connected ? (lastRun ? `last collected ${when(lastRun)}` : 'connected, not collected yet') : 'not connected'}
          </span>
        </button>
        {p.connected ? (
          <>
            <ControlStatusPill status={status} />
            <button type="button" onClick={run} disabled={busy || !plugin?.id}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run now
            </button>
          </>
        ) : (
          <Link href={connectHref}
            className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700">
            Connect {p.label}
          </Link>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Hide tests' : 'Show tests'}
          className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {err && <p className="mt-2 pl-12 text-xs text-rose-700">{err}</p>}
      {open && (
        tests.length ? (
          <ol className="mt-3 space-y-2 sm:pl-12">
            {tests.map((t) => <TestRow key={t.id} test={t} connected={p.connected} />)}
          </ol>
        ) : (
          <p className="mt-3 text-[12px] text-slate-500 sm:pl-12">{plugin?.title || 'This source'} evidences this control.</p>
        )
      )}
    </li>
  );
}

export default function AutomatedTests({
  code, groups, connectionId, onRan, bindingSource, bindingVia,
}: {
  code: string;
  groups: TestGroup[];
  connectionId?: number | null;
  onRan: () => void;
  bindingSource?: BindingSource | null;
  bindingVia: string[];
}) {
  if (!groups.length) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-semibold text-slate-800">No automated test reaches {code} yet</p>
        <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-slate-500">
          None of the connectors can check this control today, so it is evidenced by hand on the Evidence tab.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      <HowItWorks code={code} bindingSource={bindingSource} bindingVia={bindingVia} />
      {groups.map((g) => {
        const live = g.providers.filter((p) => p.connected);
        return (
          <section key={g.category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">{CATEGORY_LABEL[g.category] || g.category}</h3>
                <p className="text-[12px] text-slate-500">
                  {live.length
                    ? `Tested through ${live.map((p) => p.label).join(', ')}.`
                    : `Connect any one of these ${g.providers.length} — you do not need them all.`}
                </p>
              </div>
              {g.connected
                ? <ControlStatusPill status={g.status} />
                : <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">Connect any one</span>}
            </header>
            <ul className="divide-y divide-slate-100">
              {g.providers.map((p) => (
                <ProviderCard key={p.provider} code={code} provider={p} connectionId={connectionId} onRan={onRan} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
