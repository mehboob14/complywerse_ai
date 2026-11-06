'use client';

// The Tests tab's first section: every objective the control is assessed against, the
// exact test for each, and whether it applies to this organisation.
//
// Nothing here waits on a connector. NIST SP 800-53A's own procedures (what to examine,
// whom to interview, what to test) and a fixed step for the objective's type cover every
// objective; an automated check is listed against the objective it covers, whether or
// not its system is connected yet. A test that does not apply says why.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Cpu, Eye, FileText, Loader2, Users, Wrench } from 'lucide-react';
import { automationApi } from '@/lib/api';
import { WrittenTest, type TestExplanation } from './WrittenTest';

interface PlanCheck {
  provider: string; label: string; category?: string | null; id: string; title: string;
  explain: TestExplanation | null; connected: boolean; state: 'passing' | 'failing' | 'expired' | null;
}
interface PlanMethod { type: 'examine' | 'interview' | 'test'; label: string; items: string[] }
interface PlanNist {
  control: string; title?: string | null; methods: PlanMethod[];
  refs: { ref: string; match: string; objective?: string | null }[];
}
interface PlanTest {
  ao_id: string; seq?: number | null; objective: string; pptdf?: string | null; rigor?: string | null;
  applies: boolean; not_applicable_reason: string | null;
  automated: PlanCheck[]; nist: PlanNist[];
  standard: { type: string; description: string; expected: string } | null;
}
export interface TestPlanData {
  scf_id: string;
  applicability: {
    state: 'applies' | 'not_applicable' | 'inherited' | 'alternative' | 'unscoped';
    reason: string; source?: string | null; obligation_label?: string | null; exception: boolean;
  };
  summary: { total: number; applies: number; not_applicable: number; automated: number; nist: number; standard: number };
  tests: PlanTest[];
  automated: PlanCheck[];
  scope: { has_facilities: boolean; processes_personal_data: boolean };
  nist_source: { title?: string | null; version?: string | null; url?: string | null } | null;
}

const BANNER: Record<TestPlanData['applicability']['state'], { title: string; cls: string }> = {
  applies: { title: 'These tests apply to you', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  not_applicable: { title: 'Not applicable to you', cls: 'border-slate-200 bg-slate-50 text-slate-800' },
  inherited: { title: 'Operated by your provider', cls: 'border-slate-200 bg-slate-50 text-slate-800' },
  alternative: { title: 'Covered by a compensating control', cls: 'border-slate-200 bg-slate-50 text-slate-800' },
  unscoped: { title: 'Your scope is not set yet', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
};
const METHOD_ICON = { examine: FileText, interview: Users, test: Wrench } as const;
const STANDARD_LABEL: Record<string, string> = { inspection: 'Inspect', inquiry: 'Interview', observation: 'Observe' };
const STATE_PILL: Record<string, { label: string; cls: string }> = {
  passing: { label: 'Passing', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  failing: { label: 'Failing', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  expired: { label: 'Result expired', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

function Chip({ children, cls = 'bg-slate-100 text-slate-600' }: { children: React.ReactNode; cls?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${cls}`}>{children}</span>;
}

function CheckRow({ c, reach, cadence }: { c: PlanCheck; reach: string; cadence?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="text-[12px] text-slate-700">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-slate-800">{c.title}</span>
        {c.connected && c.state && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${STATE_PILL[c.state].cls}`}>{STATE_PILL[c.state].label}</span>}
        {c.connected && !c.state && <span className="text-[10.5px] text-slate-500">Not collected yet</span>}
        {c.explain && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ml-auto text-[11px] font-semibold text-primary-700 hover:underline">
            {open ? 'Hide test' : 'View test'}
          </button>
        )}
      </div>
      {c.explain && !open && (
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">
          {c.explain.checks}{c.explain.fails_when ? <> <span className="text-slate-500">A failure means: {c.explain.fails_when}</span></> : null}
        </p>
      )}
      {c.explain && open && (
        <div className="mt-1.5 rounded-md border border-violet-100 bg-white p-2.5">
          <WrittenTest explain={c.explain} reach={reach} cadence={cadence} />
        </div>
      )}
    </li>
  );
}

function Checks({ code, checks, reach, cadence }: { code: string; checks: PlanCheck[]; reach: string; cadence?: string | null }) {
  const back = `/automation/soc2-controls/${encodeURIComponent(code)}?tab=tests`;
  // One row per system: a control can be tested through any one of many, so the list is by system, not by test.
  const bySystem = new Map<string, PlanCheck[]>();
  checks.forEach((c) => bySystem.set(c.provider, [...(bySystem.get(c.provider) || []), c]));
  const systems = Array.from(bySystem.values());
  return (
    <div className="rounded-md border border-violet-100 bg-violet-50/40 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-800">
        <Cpu className="h-3.5 w-3.5" /> Automated
        <span className="font-normal text-violet-700">
          · {systems.length > 1 ? `${checks.length} tests across ${systems.length} systems: connect the one you run` : systems[0][0].label}
        </span>
      </p>
      <ul className="mt-1 divide-y divide-violet-100">
        {systems.map((group) => {
          const first = group[0];
          return (
            <li key={first.provider}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-[12px] [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                  <span className="font-medium text-slate-800">{first.label}</span>
                  <span className="text-slate-500">{group.length} test{group.length === 1 ? '' : 's'}</span>
                  {first.connected
                    ? <span className="text-[10.5px] text-slate-400">Connected</span>
                    : (
                      <Link href={`/admin/evidence-collectors?connector=${encodeURIComponent(first.provider)}&return=${encodeURIComponent(back)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-[11px] font-medium text-primary-700 hover:underline">Connect {first.label}</Link>
                    )}
                </summary>
                <ul className="space-y-2 pb-2 pl-5">
                  {group.map((c) => <CheckRow key={c.id} c={c} reach={reach} cadence={cadence} />)}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NistProcedure({ n }: { n: PlanNist }) {
  // An objective cites parts of a NIST control: statements to prove, and parameters to define yourself.
  const statements = n.refs.filter((r) => r.match !== 'odp' && r.objective);
  const parameters = n.refs.filter((r) => r.match === 'odp');
  return (
    <div className="rounded-md border border-sky-100 bg-sky-50/40 p-2.5">
      <p className="text-[11px] font-semibold text-sky-900">
        NIST SP 800-53A {n.control}{n.title ? <span className="font-normal text-sky-800"> · {n.title}</span> : null}
      </p>
      {statements.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-slate-600">
          {statements.map((r) => <li key={r.ref}><span className="font-mono text-[10.5px] text-slate-400">{r.ref}</span> <span className="italic">{r.objective}</span></li>)}
        </ul>
      )}
      {parameters.length > 0 && (
        <p className="mt-1 text-[11.5px] text-slate-600">
          Parameters this objective asks you to define for yourself: <span className="font-mono text-[10.5px] text-slate-500">{parameters.map((r) => r.ref).join(', ')}</span>.
        </p>
      )}
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {n.methods.map((m) => {
          const Icon = METHOD_ICON[m.type];
          return (
            <div key={m.type} className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-700"><Icon className="h-3 w-3" /> {m.label}</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11.5px] leading-snug text-slate-600">
                {m.items.map((it) => <li key={it}>{it}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function preview(t: PlanTest): string | null {
  const m = t.nist[0]?.methods[0];
  return m ? `${m.label}: ${m.items.slice(0, 2).join('; ')}${m.items.length > 2 ? ` (+${m.items.length - 2})` : ''}` : null;
}

function Row({ code, t, open, onToggle, cadence }: { code: string; t: PlanTest; open: boolean; onToggle: () => void; cadence?: string | null }) {
  const kinds = [
    t.automated.length ? 'Automated' : null,
    t.nist.length ? 'NIST procedure' : null,
    !t.nist.length && t.standard ? `${STANDARD_LABEL[t.standard.type] || 'Inspect'} (standard step)` : null,
  ].filter(Boolean) as string[];
  return (
    <li className={`rounded-lg border bg-white ${t.applies ? 'border-slate-200' : 'border-slate-200 opacity-80'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50/70">
        <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold text-slate-500">{t.ao_id}</span>
            {t.pptdf && <Chip>{t.pptdf}</Chip>}
            {kinds.map((k) => <Chip key={k} cls={k === 'Automated' ? 'bg-violet-50 text-violet-700' : k === 'NIST procedure' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}>{k}</Chip>)}
          </span>
          <span className={`mt-1 block text-[13px] leading-snug ${t.applies ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{t.objective}</span>
          {!open && t.applies && preview(t) && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{preview(t)}</span>}
          {!t.applies && t.not_applicable_reason && <span className="mt-0.5 block text-[11.5px] text-slate-500">N/A: {t.not_applicable_reason}</span>}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${t.applies ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {t.applies ? 'Applies' : 'N/A'}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-3 pl-8">
          {t.automated.length > 0 && <Checks code={code} checks={t.automated} reach={`Written for objective ${t.ao_id}.`} cadence={cadence} />}
          {t.nist.map((n) => <NistProcedure key={n.control} n={n} />)}
          {t.standard && (
            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 text-[12px] leading-relaxed text-slate-700">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-700"><Eye className="h-3 w-3" /> Standard step</p>
              <p className="mt-0.5">{t.standard.description}</p>
              <p className="mt-1 text-slate-500"><span className="font-medium text-slate-600">Expected: </span>{t.standard.expected}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function TestPlan({ code, requiredBy, cadence, middle }: {
  code: string; requiredBy?: { label: string; count: number }[];
  /** The control's reassessment cadence: how long an automated result stays current. */
  cadence?: string | null;
  /** Shown between the summary and the objectives: the automated tests, which run by themselves. */
  middle?: React.ReactNode;
}) {
  const { data: plan, isLoading, isError } = useQuery({
    queryKey: ['automation-test-plan', code],
    queryFn: () => automationApi.getControlTestPlan(code).then((r) => r.data as TestPlanData),
    retry: false,
  });
  const [openAll, setOpenAll] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  if (isLoading) return <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !plan) return <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-500">The test plan could not be loaded for {code}.</p>;

  const a = plan.applicability;
  const banner = BANNER[a.state];
  const s = plan.summary;
  const isOpen = (id: string) => (id in opened ? opened[id] : openAll);
  const toggleAll = () => { setOpenAll((v) => !v); setOpened({}); };

  return (
    <section className="space-y-3" aria-labelledby="test-plan">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id="test-plan" className="text-sm font-semibold text-slate-900">Test plan for {code}</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {s.total} objective{s.total === 1 ? '' : 's'} to prove, each with the exact test and whether it applies to you.
            </p>
          </div>
          {s.total > 0 && (
            <button type="button" onClick={toggleAll} className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              {openAll ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip cls="bg-emerald-50 text-emerald-700">{s.applies} apply</Chip>
          {s.not_applicable > 0 && <Chip>{s.not_applicable} N/A</Chip>}
          {s.automated > 0 && <Chip cls="bg-violet-50 text-violet-700">{s.automated} automated</Chip>}
          {s.nist > 0 && <Chip cls="bg-sky-50 text-sky-700">{s.nist} follow NIST SP 800-53A</Chip>}
          {s.standard > 0 && <Chip>{s.standard} standard step{s.standard === 1 ? '' : 's'}</Chip>}
        </div>
        <div className={`mt-3 rounded-lg border px-3 py-2 ${banner.cls}`}>
          <p className="text-[12.5px] font-semibold">{banner.title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed">
            {a.reason}{a.state === 'applies' && a.obligation_label ? ` It is ${a.obligation_label}.` : ''}
            {a.state === 'applies' && requiredBy?.length ? ` Required by ${requiredBy.map((r) => `${r.label} (${r.count})`).join(', ')}.` : ''}
          </p>
          {a.exception && <p className="mt-1 text-[11.5px]">An approved exception exists. It does not remove the tests; the control stays deficient, accepted.</p>}
          {(!plan.scope.has_facilities || !plan.scope.processes_personal_data) && (
            <p className="mt-1 text-[11.5px]">
              Your scope rules out {[!plan.scope.has_facilities && 'physical facilities', !plan.scope.processes_personal_data && 'personal data'].filter(Boolean).join(' and ')},
              so objectives about {[!plan.scope.has_facilities && 'facilities', !plan.scope.processes_personal_data && 'data'].filter(Boolean).join(' and ')} are N/A.{' '}
              <Link href="/automation/soc2-controls?configure=scope" className="font-medium underline">Change scope</Link>
            </p>
          )}
        </div>
      </div>

      {plan.automated.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="mb-2 text-[12px] font-semibold text-slate-800">Automated tests for the whole control</h4>
          <Checks code={code} checks={plan.automated} reach="Written for this control as a whole." cadence={cadence} />
        </div>
      )}

      {middle}

      {s.total === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
          No assessment objectives are published for {code}.
        </p>
      ) : (
        <ol className="space-y-2">
          {plan.tests.map((t) => (
            <Row key={t.ao_id} code={code} t={t} open={isOpen(t.ao_id)} cadence={cadence}
                 onToggle={() => setOpened((o) => ({ ...o, [t.ao_id]: !isOpen(t.ao_id) }))} />
          ))}
        </ol>
      )}

      <p className="px-1 text-[10.5px] leading-relaxed text-slate-400">
        Objectives are quoted verbatim from the Secure Controls Framework.
        {plan.nist_source && <> Procedures are from NIST SP 800-53A Rev. 5{plan.nist_source.version ? ` (release ${plan.nist_source.version})` : ''}, a work of NIST in the public domain.</>}
        {' '}Standard steps are fixed instructions for the objective&apos;s type, not generated text.
      </p>
    </section>
  );
}
