'use client';

// The Testing tab: how the control is tested and what the tests found, in five sections that fold: the Plan (every objective and its exact test), the Automated tests (sources, connect, run), the
// Procedures (a tester's numbered steps), the Results (effectiveness, the tests recorded, sign-off) and the Sampling (sampled evidence). One scroll, a bar to jump, nothing behind a second page.
import { StatusPill } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { testResult } from '@/lib/statuses/controls';
import { AutomatedSection } from './AutomatedSection';
import { PlanSection } from './PlanSection';
import { ProceduresSection } from './ProceduresSection';
import { ResultsSection } from './ResultsSection';
import { SamplingSection } from './SamplingSection';
import { SectionStack } from './SectionStack';
import { useAssurance, useTestPlan, useTesting } from './workspaceData';
import { useWorkspace } from './workspaceContext';

export function TestingTab() {
  const { code, d } = useWorkspace();
  const plan = useTestPlan(code);
  const testing = useTesting(code);
  const assurance = useAssurance(code);
  const groups = d.test_groups ?? [];
  const sources = groups.reduce((n, g) => n + g.providers.length, 0);
  const connected = groups.reduce((n, g) => n + g.providers.filter((p) => p.connected).length, 0);
  const procedures = testing.data?.procedures ?? [];
  const samples = testing.data ? testing.data.control_files.length + testing.data.procedures.reduce((n, p) => n + p.files.length, 0) : null;
  const wi = assurance.data?.work_item;
  const s = plan.data?.summary;
  return (
    <SectionStack
      label="Testing"
      sections={[
        { key: 'plan', meta: s ? `${s.total} ${s.total === 1 ? 'objective' : 'objectives'} · ${s.applies} apply` : plan.isError ? 'Couldn’t be loaded' : 'Loading', children: <PlanSection /> },
        { key: 'automated', meta: sources ? `${sources} ${sources === 1 ? 'source' : 'sources'} · ${connected} connected` : 'No source reaches this control', children: <AutomatedSection /> },
        { key: 'procedures', meta: testing.data ? (procedures.length ? `${procedures.filter((p) => p.is_checked).length} of ${procedures.length} done` : 'No steps yet') : testing.isError ? 'Couldn’t be loaded' : 'Loading', children: <ProceduresSection /> },
        {
          key: 'results',
          meta: wi ? undefined : assurance.isError ? 'Couldn’t be loaded' : 'Loading',
          trailing: wi ? (
            <span className="flex flex-wrap items-center gap-[6px]">
              <StatusPill size="sm" {...statusPill(testResult, wi.design_effectiveness || 'not_tested')} label={`Design: ${statusPill(testResult, wi.design_effectiveness || 'not_tested').label}`} />
              <StatusPill size="sm" {...statusPill(testResult, wi.operating_effectiveness || 'not_tested')} label={`Operating: ${statusPill(testResult, wi.operating_effectiveness || 'not_tested').label}`} />
            </span>
          ) : undefined,
          children: <ResultsSection />,
        },
        { key: 'sampling', meta: samples == null ? (testing.isError ? 'Couldn’t be loaded' : 'Loading') : samples ? `${samples} ${samples === 1 ? 'sample' : 'samples'}` : 'No samples yet', children: <SamplingSection /> },
      ]}
    />
  );
}
