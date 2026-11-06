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
import { RESULT_STATUS, WrittenTest, reachOf, when, type TestExplanation, type TestReach, type TestResult } from './WrittenTest';

export type { TestExplanation };

export const CATEGORY_LABEL: Record<string, string> = {
  scm: 'Source control', identity: 'Identity provider', cloud: 'Cloud and databases',
  observability: 'Observability', security: 'Security tooling', productivity: 'Work management',
  comms: 'Communications', email: 'Email', incident: 'Incident response', hr: 'HR system',
  mdm: 'Device management', itsm: 'IT service management', crm: 'CRM', data: 'Data platform',
  payments: 'Payments', ai: 'AI platform', other: 'Other',
};

export interface ProviderTest extends TestReach {
  id: string;
  title: string;
  explain: TestExplanation | null;
  result: TestResult | null;
}
export interface TestGroup {
  category: string;
  connected: boolean;
  status: string;
  providers: { provider: string; label: string; connected: boolean; checks: LinkedCheck[]; tests?: ProviderTest[] }[];
}

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

function TestRow({ test, connected, cadence, criteria, initialOpen }: {
  test: ProviderTest; connected: boolean; cadence?: string | null; criteria: string[]; initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const r = test.result;
  const e = test.explain;
  const counted = r?.tested != null && r?.population != null ? ` · ${r.tested} of ${r.population} checked` : '';
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
          : <span className="shrink-0 text-[11px] text-slate-500">Not collected yet</span>)}
        <span className="shrink-0 text-[11px] font-semibold text-primary-700">{open ? 'Hide test' : 'View test'}</span>
      </button>
      {connected && r?.detail && (
        <p className="-mt-1 px-3 pb-2 pl-8 text-[11px] text-slate-500">{r.detail}{counted}</p>
      )}
      {open && (
        <div className="border-t border-slate-100 px-3 py-3 sm:pl-8">
          {e
            ? <WrittenTest explain={e} result={connected ? r : null} reach={reachOf(test, criteria)} cadence={cadence} />
            : <p className="text-[12px] text-slate-700">{test.title}</p>}
        </div>
      )}
    </li>
  );
}

function ProviderCard({ code, provider: p, connectionId, onRan, cadence, criteria, expandAll, solo }: {
  code: string;
  provider: TestGroup['providers'][number];
  connectionId?: number | null;
  onRan: () => void;
  cadence?: string | null;
  /** The SOC 2 criteria this control goes through, when its tests are matched that way. */
  criteria: string[];
  expandAll: boolean;
  /** The only source for this control: nothing to choose between, so its tests are shown. */
  solo: boolean;
}) {
  const [open, setOpen] = useState(p.connected || solo || expandAll);
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
            {tests.map((t) => <TestRow key={t.id} test={t} connected={p.connected} cadence={cadence} criteria={criteria} initialOpen={expandAll} />)}
          </ol>
        ) : (
          <p className="mt-3 text-[12px] text-slate-500 sm:pl-12">{plugin?.title || 'This source'} evidences this control.</p>
        )
      )}
    </li>
  );
}

export default function AutomatedTests({
  code, groups, connectionId, onRan, bindingSource, bindingVia, cadence,
}: {
  code: string;
  groups: TestGroup[];
  connectionId?: number | null;
  onRan: () => void;
  bindingSource?: BindingSource | null;
  bindingVia: string[];
  /** The control's reassessment cadence: how long a result stays current. */
  cadence?: string | null;
}) {
  // Every test opened at once; the generation remounts the cards so one click really does open them all.
  const [expand, setExpand] = useState({ all: false, gen: 0 });
  const total = groups.reduce((n, g) => n + g.providers.reduce((m, p) => m + (p.tests?.length ?? 0), 0), 0);
  const solo = groups.reduce((n, g) => n + g.providers.length, 0) === 1;
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
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{total} automated test{total === 1 ? '' : 's'} reach {code}</h3>
          <button type="button" onClick={() => setExpand((s) => ({ all: !s.all, gen: s.gen + 1 }))}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            {expand.all ? 'Hide all written tests' : 'Show all written tests'}
          </button>
        </div>
      )}
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
                <ProviderCard key={`${p.provider}-${expand.gen}`} code={code} provider={p} connectionId={connectionId} onRan={onRan}
                  cadence={cadence} criteria={bindingSource === 'soc2_fallback' ? bindingVia : []} expandAll={expand.all} solo={solo} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
