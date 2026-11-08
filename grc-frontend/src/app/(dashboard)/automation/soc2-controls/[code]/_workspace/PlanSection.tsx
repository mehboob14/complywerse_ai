'use client';

// Testing > Plan: every objective the control is assessed against, the exact test for each, and whether it applies to this organisation. Nothing here waits on a connector: NIST SP 800-53A's own
// procedures (what to examine, whom to interview, what to test) and a fixed step for the objective's type cover every objective; an automated test is listed against the objective it covers
// whether or not its system is connected yet. A test that does not apply says why. The objectives are the Secure Controls Framework's and are shown as published.
import { useState } from 'react';
import { Cpu, Eye, FileText, Users, Wrench } from 'lucide-react';
import { AccordionRow, Button, Notice, StatusPill } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { checkResult } from '@/lib/statuses/controls';
import { Body, Loaded, Small } from './parts';
import type { PlanCheck, PlanNist, PlanTest, TestPlanData } from './types';
import { WrittenTest } from './WrittenTest';
import { useTestPlan } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const BANNER: Record<TestPlanData['applicability']['state'], { title: string; tone: 'info' | 'warning' }> = {
  applies: { title: 'These tests apply to you', tone: 'info' },
  not_applicable: { title: 'Not applicable to you', tone: 'info' },
  inherited: { title: 'Operated by your provider', tone: 'info' },
  alternative: { title: 'Covered by a compensating control', tone: 'info' },
  unscoped: { title: 'Your scope is not set yet', tone: 'warning' },
};
const METHOD_ICON = { examine: FileText, interview: Users, test: Wrench } as const;
const STANDARD_LABEL: Record<string, string> = { inspection: 'Inspect', inquiry: 'Interview', observation: 'Observe' };
const STATE_TO_RESULT: Record<string, string> = { passing: 'pass', failing: 'fail', expired: 'expired' };

/** The automated tests of a plan row, by system: a control can be tested through any one of many, so the list is by system, not by test. */
function ChecksBySystem({ checks, reach, cadence }: { checks: PlanCheck[]; reach: string; cadence?: string | null }) {
  const { code } = useWorkspace();
  const [openTest, setOpenTest] = useState<string | null>(null);
  const back = `/automation/soc2-controls/${encodeURIComponent(code)}?tab=tests`;
  const bySystem = new Map<string, PlanCheck[]>();
  checks.forEach((c) => bySystem.set(c.provider, [...(bySystem.get(c.provider) || []), c]));
  const systems = Array.from(bySystem.values());
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[10px]">
      <p className="flex flex-wrap items-center gap-[6px] text-ds-label font-[600] text-ds-fg">
        <Cpu aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> Automated
        <span className="font-normal text-ds-fg-muted">{systems.length > 1 ? `· ${checks.length} tests across ${systems.length} systems: connect the one you run` : `· ${systems[0][0].label}`}</span>
      </p>
      <ul className="mt-[6px] flex flex-col gap-[6px]">
        {systems.map((group) => {
          const first = group[0];
          return (
            <li key={first.provider} className="rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[6px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="text-ds-body font-[600] text-ds-fg">{first.label}</span>
                <Small>{`${group.length} ${group.length === 1 ? 'test' : 'tests'}`}</Small>
                {first.connected
                  ? <Small>Connected</Small>
                  : <Button size="sm" className="ml-auto" href={`/admin/evidence-collectors?connector=${encodeURIComponent(first.provider)}&return=${encodeURIComponent(back)}`}>{`Connect ${first.label}`}</Button>}
              </div>
              <ul className="mt-[6px] flex flex-col gap-[6px]">
                {group.map((c) => (
                  <li key={c.id} className="text-ds-body text-ds-fg-body">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <span className="font-[500] text-ds-fg">{c.title}</span>
                      {c.connected && c.state && <StatusPill size="sm" {...statusPill(checkResult, STATE_TO_RESULT[c.state])} />}
                      {c.connected && !c.state && <Small>Not collected yet</Small>}
                      {c.explain && <Button variant="link" size="sm" className="ml-auto" aria-expanded={openTest === c.id} onClick={() => setOpenTest(openTest === c.id ? null : c.id)}>{openTest === c.id ? 'Hide test' : 'View test'}</Button>}
                    </div>
                    {c.explain && openTest !== c.id && <p className="mt-[2px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{c.explain.checks}{c.explain.fails_when ? ` A failure means: ${c.explain.fails_when}` : ''}</p>}
                    {c.explain && openTest === c.id && <div className="mt-[6px] rounded-ds-control border border-ds-border bg-ds-surface p-[10px]"><WrittenTest explain={c.explain} reach={reach} cadence={cadence} /></div>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** An objective cites parts of a NIST control: statements to prove, and parameters to define yourself. */
function NistProcedure({ n }: { n: PlanNist }) {
  const statements = n.refs.filter((r) => r.match !== 'odp' && r.objective);
  const parameters = n.refs.filter((r) => r.match === 'odp');
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[10px]">
      <p className="text-ds-label font-[600] text-ds-fg">NIST SP 800-53A {n.control}{n.title ? <span className="font-normal text-ds-fg-muted">{` · ${n.title}`}</span> : null}</p>
      {statements.length > 0 && (
        <ul className="mt-[4px] flex flex-col gap-[2px] text-ds-body text-ds-fg-body">
          {statements.map((r) => <li key={r.ref} className="[overflow-wrap:anywhere]"><span className="font-mono text-ds-label text-ds-fg-muted">{r.ref}</span> <span className="italic">{r.objective}</span></li>)}
        </ul>
      )}
      {parameters.length > 0 && <Small className="mt-[4px]">{`Parameters this objective asks you to define for yourself: ${parameters.map((r) => r.ref).join(', ')}.`}</Small>}
      <div className="mt-[8px] grid gap-[10px] sm:grid-cols-3">
        {n.methods.map((m) => {
          const Icon = METHOD_ICON[m.type];
          return (
            <div key={m.type} className="min-w-0">
              <p className="flex items-center gap-[4px] text-ds-label font-[600] text-ds-fg"><Icon aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> {m.label}</p>
              <ul className="mt-[2px] list-disc pl-[18px] text-ds-body text-ds-fg-body">
                {m.items.map((it) => <li key={it} className="[overflow-wrap:anywhere]">{it}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kindsOf(t: PlanTest): string {
  return [
    t.automated.length ? 'Automated' : null,
    t.nist.length ? 'NIST procedure' : null,
    !t.nist.length && t.standard ? `${STANDARD_LABEL[t.standard.type] || 'Inspect'} (standard step)` : null,
  ].filter(Boolean).join(' · ');
}

function preview(t: PlanTest): string | null {
  const m = t.nist[0]?.methods[0];
  return m ? `${m.label}: ${m.items.slice(0, 2).join('; ')}${m.items.length > 2 ? ` (+${m.items.length - 2})` : ''}` : null;
}

function Objective({ t, open, onToggle, cadence }: { t: PlanTest; open: boolean; onToggle: (o: boolean) => void; cadence?: string | null }) {
  const pptdf = t.pptdf ? `${t.pptdf} · ` : '';
  return (
    <AccordionRow
      title={t.objective}
      lead={<span className="font-mono text-ds-label font-[600] text-ds-fg-muted">{t.ao_id}</span>}
      meta={t.applies ? `${pptdf}${[kindsOf(t), open ? null : preview(t)].filter(Boolean).join(' · ')}` : `${pptdf}Not applicable: ${t.not_applicable_reason ?? 'it does not apply to your scope'}`}
      trailing={<StatusPill size="sm" tone={t.applies ? 'success' : 'neutral'} label={t.applies ? 'Applies' : 'N/A'} />}
      open={open}
      onOpenChange={onToggle}
      region={false}
    >
      <div className="flex flex-col gap-[8px] pb-[8px] pl-[8px] pr-[8px]">
        {t.automated.length > 0 && <ChecksBySystem checks={t.automated} reach={`Written for objective ${t.ao_id}.`} cadence={cadence} />}
        {t.nist.map((n) => <NistProcedure key={n.control} n={n} />)}
        {t.standard && (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[10px]">
            <p className="flex items-center gap-[4px] text-ds-label font-[600] text-ds-fg"><Eye aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /> Standard step</p>
            <Body className="mt-[2px]">{t.standard.description}</Body>
            <Small className="mt-[4px]"><span className="font-[600]">Expected: </span>{t.standard.expected}</Small>
          </div>
        )}
      </div>
    </AccordionRow>
  );
}

export function PlanSection() {
  const { code, d, decide, go } = useWorkspace();
  const q = useTestPlan(code);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const cadence = d.conformity_cadence || d.implementation?.conformity_cadence;
  const requiredBy = (d.requirement_groups ?? []).map((g) => ({ label: g.label, count: g.count }));
  return (
    <Loaded q={q} what="the test plan" rows={4}>
      {(plan) => {
        const a = plan.applicability;
        const banner = BANNER[a.state];
        const s = plan.summary;
        const isOpen = (id: string) => (id in opened ? opened[id] : all);
        return (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[6px]">
              <StatusPill size="sm" tone="success" label={`${s.applies} apply`} />
              {s.not_applicable > 0 && <StatusPill size="sm" tone="neutral" label={`${s.not_applicable} N/A`} />}
              {s.automated > 0 && <StatusPill size="sm" tone="progress" label={`${s.automated} automated`} />}
              {s.nist > 0 && <StatusPill size="sm" tone="neutral" label={`${s.nist} follow NIST SP 800-53A`} />}
              {s.standard > 0 && <StatusPill size="sm" tone="neutral" label={`${s.standard} standard ${s.standard === 1 ? 'step' : 'steps'}`} />}
            </div>
            <Notice tone={banner.tone} title={banner.title} action={<Button size="sm" onClick={decide}>{a.state === 'applies' || a.state === 'not_applicable' ? 'Does it apply?' : 'See the request'}</Button>}>
              {a.reason}{a.state === 'applies' && a.obligation_label ? ` It is ${a.obligation_label}.` : ''}
              {a.state === 'applies' && requiredBy.length ? ` Required by ${requiredBy.map((r) => `${r.label} (${r.count})`).join(', ')}.` : ''}
              {a.exception ? ' An approved exception exists. It does not remove the tests; the control stays deficient, accepted.' : ''}
              {(!plan.scope.has_facilities || !plan.scope.processes_personal_data) ? ` Your scope rules out ${[!plan.scope.has_facilities && 'physical facilities', !plan.scope.processes_personal_data && 'personal data'].filter(Boolean).join(' and ')}, so objectives about ${[!plan.scope.has_facilities && 'facilities', !plan.scope.processes_personal_data && 'data'].filter(Boolean).join(' and ')} are N/A.` : ''}
            </Notice>
            {plan.automated.length > 0 && <Small>{`${plan.automated.length} automated ${plan.automated.length === 1 ? 'test covers' : 'tests cover'} the control as a whole. `}<Button variant="link" size="sm" onClick={() => go('testing', 'automated')}>See the automated tests</Button></Small>}
            {s.total === 0 ? <Small>{`No assessment objectives are published for ${code}.`}</Small> : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <Small>{`${s.total} ${s.total === 1 ? 'objective' : 'objectives'} to prove, each with the exact test.`}</Small>
                  <Button size="sm" onClick={() => { setAll(!all); setOpened({}); }}>{all ? 'Collapse all' : 'Expand all'}</Button>
                </div>
                <ol className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                  {plan.tests.map((t) => <li key={t.ao_id}><Objective t={t} open={isOpen(t.ao_id)} onToggle={(o) => setOpened((m) => ({ ...m, [t.ao_id]: o }))} cadence={cadence} /></li>)}
                </ol>
              </>
            )}
            <Small>
              Objectives are quoted as the Secure Controls Framework publishes them.
              {plan.nist_source ? ` Procedures are from NIST SP 800-53A Rev. 5${plan.nist_source.version ? ` (release ${plan.nist_source.version})` : ''}, a work of NIST in the public domain.` : ''}
              {' '}Standard steps are fixed instructions for the objective’s type, not generated text.
            </Small>
          </div>
        );
      }}
    </Loaded>
  );
}
