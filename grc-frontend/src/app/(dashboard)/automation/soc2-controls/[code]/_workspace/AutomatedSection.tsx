'use client';

// Testing > Automated tests: what the control's automated tests do, where they get their data and what they last found. Sources in one category are alternatives (a tenant runs one cloud, not
// four), so a category asks for any one of them. Every test says, in words generated from its own definition, what it checks, what it reads and what a failure means, so nobody has to
// connect a system to find out what will happen. Connecting opens the Connections page on that connector with a way back to this control.
import { useState } from 'react';
import { Play } from 'lucide-react';
import { Button, EmptyState, StatusPill } from '@/components/ui/ds';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { checkResult, controlStatus } from '@/lib/statuses/controls';
import { Small } from './parts';
import type { ProviderTest, TestGroup } from './types';
import { WrittenTest, reachOf, resultWord } from './WrittenTest';
import { useRunChecks } from './useRunChecks';
import { useWorkspace } from './workspaceContext';

export const CATEGORY_LABEL: Record<string, string> = {
  scm: 'Source control', identity: 'Identity provider', cloud: 'Cloud and databases', observability: 'Observability', security: 'Security tooling', productivity: 'Work management',
  comms: 'Communications', email: 'Email', incident: 'Incident response', hr: 'HR system', mdm: 'Device management', itsm: 'IT service management', crm: 'CRM', data: 'Data platform',
  payments: 'Payments', ai: 'AI platform', other: 'Other',
};

function TestRow({ test, connected, cadence, criteria, open, onToggle }: { test: ProviderTest; connected: boolean; cadence?: string | null; criteria: string[]; open: boolean; onToggle: () => void }) {
  const r = test.result;
  const e = test.explain;
  const counted = r?.tested != null && r?.population != null ? ` · ${r.tested} of ${r.population} checked` : '';
  return (
    <li className="rounded-ds-control border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center gap-[8px] px-[10px] py-[6px]">
        <span className="min-w-0 flex-1 basis-[14rem] text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{test.title}</span>
        {connected && (r ? <StatusPill size="sm" {...statusPill(checkResult, resultWord(r.status))} /> : <Small>Not collected yet</Small>)}
        <Button variant="link" size="sm" aria-expanded={open} onClick={onToggle}>{open ? 'Hide test' : 'View test'}</Button>
      </div>
      {!open && e && <p className="px-[10px] pb-[6px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{e.checks}</p>}
      {connected && r?.detail && <p className="px-[10px] pb-[6px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{`${r.detail}${counted}`}</p>}
      {open && (
        <div className="border-t border-ds-border px-[10px] py-[10px]">
          {e ? <WrittenTest explain={e} result={connected ? r : null} reach={reachOf(test, criteria)} cadence={cadence} /> : <p className="text-ds-body text-ds-fg-body">{test.title}</p>}
        </div>
      )}
    </li>
  );
}

function ProviderCard({ provider: p, criteria, cadence, solo }: { provider: TestGroup['providers'][number]; criteria: string[]; cadence?: string | null; solo: boolean }) {
  const { code, rights, why } = useWorkspace();
  const { run, running } = useRunChecks();
  const [open, setOpen] = useState(p.connected || solo);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const plugin = p.checks[0];
  const tests = p.tests ?? [];
  const lastRun = plugin?.last_run?.started_at;
  const back = `/automation/soc2-controls/${encodeURIComponent(code)}?tab=tests`;
  const status = p.checks.map((c) => (c as { control_status?: string }).control_status).find(Boolean) || 'not_run';
  return (
    <li className="px-[12px] py-[10px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <BrandLogo id={p.provider} name={p.label} size={32} />
        <div className="min-w-0 flex-1 basis-[12rem]">
          <p className="text-ds-body font-[600] text-ds-fg">{p.label}</p>
          <Small>{`${tests.length} ${tests.length === 1 ? 'test' : 'tests'} for this control · ${p.connected ? (lastRun ? `last collected ${formatDateTime(lastRun)}` : 'connected, not collected yet') : 'not connected'}`}</Small>
        </div>
        {p.connected ? (
          <>
            <StatusPill {...statusPill(controlStatus, status)} />
            <Button leftIcon={<Play aria-hidden />} loading={running} disabled={!plugin?.id || !rights.scan} title={why('scan')} onClick={() => { void run([{ id: plugin?.id ?? null, title: p.label }]); }}>Run now</Button>
          </>
        ) : (
          <Button variant="primary" href={`/admin/evidence-collectors?connector=${encodeURIComponent(p.provider)}&return=${encodeURIComponent(back)}`}>{`Connect ${p.label}`}</Button>
        )}
        <Button size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide tests' : 'Show tests'}</Button>
      </div>
      {open && (tests.length ? (
        <ol className="mt-[10px] flex flex-col gap-[6px] sm:pl-[42px]">
          {tests.map((t) => <TestRow key={t.id} test={t} connected={p.connected} cadence={cadence} criteria={criteria} open={openTest === t.id} onToggle={() => setOpenTest(openTest === t.id ? null : t.id)} />)}
        </ol>
      ) : <Small className="mt-[8px] sm:pl-[42px]">{`${plugin?.title || 'This source'} evidences this control.`}</Small>)}
    </li>
  );
}

export function AutomatedSection() {
  const { code, d } = useWorkspace();
  const groups = d.test_groups ?? [];
  const solo = groups.reduce((n, g) => n + g.providers.length, 0) === 1;
  const cadence = d.conformity_cadence || d.implementation?.conformity_cadence;
  const via = d.binding_via ?? [];
  if (!groups.length) {
    return <EmptyState kind="firstUse" bare title={`No automated test reaches ${code} yet`} description="None of the connectors can check this control today, so it is evidenced by hand in the Evidence tab." />;
  }
  return (
    <div className="flex flex-col gap-[12px]">
      <Small>Connect one source you already run with a read-only key. Its tests run by themselves once a day and whenever you run them; a pass is evidence the control operates, and a failure names what failed.</Small>
      {via.length > 0 && (
        <Small>{d.binding_source === 'covers' ? `Tests are matched to this control’s own objectives: ${via.join(' · ')}.` : `Tests reach this control through SOC 2 ${via.join(', ')} until SCF-level matches are reviewed, so some may test only part of it.`}</Small>
      )}
      {groups.map((g) => {
        const live = g.providers.filter((p) => p.connected);
        return (
          <section key={g.category} aria-label={CATEGORY_LABEL[g.category] || g.category} className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
            <header className="flex flex-wrap items-center justify-between gap-[8px] border-b border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
              <div className="min-w-0">
                <h3 className="!m-0 !text-ds-body !font-[600] !text-ds-fg">{CATEGORY_LABEL[g.category] || g.category}</h3>
                <Small>{live.length ? `Tested through ${live.map((p) => p.label).join(', ')}.` : `Connect any one of these ${g.providers.length}; you do not need them all.`}</Small>
              </div>
              {g.connected ? <StatusPill {...statusPill(controlStatus, g.status)} /> : <StatusPill tone="pending" label="Connect any one" />}
            </header>
            <ul className="divide-y divide-ds-border">
              {g.providers.map((p) => <ProviderCard key={p.provider} provider={p} criteria={d.binding_source === 'soc2_fallback' ? via : []} cadence={cadence} solo={solo} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
