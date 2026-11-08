'use client';

// The Summary tab: what the control is, where it stands, whether it applies, how mature it is, and what changed lately. Each card reads one thing; the work itself is in the tabs.
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { AccordionRow, Button, ClampedText, Fact, FactList, SectionCard, StatusPill } from '@/components/ui/ds';
import { EntityFieldsPanel } from '@/components/settings/CustomFields';
import { formatDate, formatDateTime } from '@/lib/format';
import { scfApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { applicabilityRequest, controlStatus, designation, testResult, workProgress } from '@/lib/statuses/controls';
import { Body, Loaded, Small } from './parts';
import { AttachedTests, RegisterCard } from './CustomExtras';
import { MaturityMeter } from './Maturity';
import { applicabilityView } from './applicabilityModel';
import { feedOf, groupCounts, levelWords, maturityGap, testOverdue } from './workspaceModel';
import { useAssurance, useHistory } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const GRID = 'grid gap-[16px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]';

function StatementCard() {
  const { d, go } = useWorkspace();
  const statement = d.description || '';
  const question = d.control_question || '';
  const groups = d.requirement_groups ?? [];
  return (
    <SectionCard id="statement" title="Control statement" info="As the Secure Controls Framework publishes it. A control you wrote yourself shows your own words.">
      {statement ? <ClampedText text={statement} lines={5} /> : <Small>No statement is published for this control.</Small>}
      {question && <p className="mt-[10px] border-l-2 border-ds-border pl-[10px] text-ds-body italic text-ds-fg-muted [overflow-wrap:anywhere]">{question}</p>}
      {groups.length > 0 && (
        <div className="mt-[12px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border pt-[10px]">
          <Small>{`Required by ${groupCounts(groups.map((g) => ({ label: g.label, count: g.count })))}`}</Small>
          <Button variant="link" size="sm" rightIcon={<ArrowRight aria-hidden />} onClick={() => go('links', 'requirements')}>See the requirements</Button>
        </div>
      )}
    </SectionCard>
  );
}

function StandsCard() {
  const { code, d, go } = useWorkspace();
  const q = useAssurance(code);
  const des = d.designation && d.designation !== '' ? d.designation : 'not_assessed';
  return (
    <SectionCard id="stands" title="Where it stands" actions={<Button variant="link" size="sm" rightIcon={<ArrowRight aria-hidden />} onClick={() => go('testing', 'results')}>Open testing</Button>}>
      <Loaded q={q} what="the testing record" rows={3}>
        {(a) => {
          const wi = a.work_item;
          const overdue = testOverdue(wi.next_test_date, new Date());
          const r = a.readiness;
          return (
            <FactList min={170}>
              <Fact label="Assurance"><StatusPill {...statusPill(designation, des)} /></Fact>
              <Fact label="Design"><StatusPill {...statusPill(testResult, wi.design_effectiveness || 'not_tested')} /></Fact>
              <Fact label="Operating"><StatusPill {...statusPill(testResult, wi.operating_effectiveness || 'not_tested')} /></Fact>
              <Fact label="Progress"><StatusPill {...statusPill(workProgress, wi.implementation_status || 'not_started')} /></Fact>
              <Fact label="Last tested">{wi.last_tested_at ? formatDate(wi.last_tested_at) : null}</Fact>
              <Fact label="Next test" empty="Not scheduled">{wi.next_test_date ? <span className={overdue ? 'font-[600] text-ds-danger' : undefined}>{`${formatDate(wi.next_test_date)}${overdue ? ' · overdue' : ''}`}</span> : null}</Fact>
              <Fact label="Automated tests">{d.checks_count ? <StatusPill {...statusPill(controlStatus, d.overall_status || 'not_run')} /> : (d.coverage?.state === 'connect_one' ? 'Connect a source to run them' : 'None reach this control')}</Fact>
              <Fact label="Required evidence">{r.total ? `${r.satisfied} of ${r.total} satisfied` : 'None named by your frameworks'}</Fact>
            </FactList>
          );
        }}
      </Loaded>
    </SectionCard>
  );
}

function ApplicabilityCard() {
  const { d, rights, me, decide } = useWorkspace();
  const v = applicabilityView(d.applicability, me, { frameworks: rights.frameworks });
  return (
    <SectionCard id="applicability" title="Does it apply?" actions={<Button size="sm" onClick={decide}>{v.canDecide ? 'Decide' : v.pending ? 'See the request' : 'Ask for a change'}</Button>}>
      <div className="flex flex-col gap-[6px]">
        {v.state === 'pending' && <div><StatusPill {...statusPill(applicabilityRequest, 'pending_review')} /></div>}
        <Body>{v.headline}</Body>
        {v.because && <Small>{v.because}</Small>}
        {v.pending?.reason && <Small>{`Their reason: ${v.pending.reason}`}</Small>}
        {d.inheritance_type && <Small>{d.inheritance_type === 'full' ? 'Your provider operates this control.' : 'Responsibility is shared with your provider.'}{d.provider_vendor_id != null ? ' ' : ''}{d.provider_vendor_id != null && <Link href={`/vendor-risk/vendors/${d.provider_vendor_id}`} className="font-medium text-ds-primary-text hover:underline">See the provider</Link>}</Small>}
        {d.alternative_scf_id && <Small>{'Covered by a compensating control: '}<Link href={`/automation/soc2-controls/${encodeURIComponent(d.alternative_scf_id)}`} className="font-medium text-ds-primary-text hover:underline">{d.alternative_scf_id}</Link></Small>}
        {d.exception_id != null && <Small>An approved exception exists. It does not remove the tests; the control stays deficient, accepted.</Small>}
      </div>
    </SectionCard>
  );
}

function MaturityCard() {
  const { d, rateMaturity } = useWorkspace();
  const impl = d.implementation;
  const actual = d.cmm_actual ?? null;
  const target = d.cmm_target ?? d.cmm_target_default ?? 3;
  return (
    <SectionCard id="maturity" title="Maturity" actions={impl ? <Button size="sm" onClick={rateMaturity}>Rate and read guidance</Button> : undefined}>
      {impl ? (
        <div className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <Small>Operates at</Small>
            <span className={actual == null ? 'text-ds-body text-ds-fg-muted' : 'text-ds-body font-[600] text-ds-fg'}>{levelWords(actual) ?? 'Not rated'}</span>
          </div>
          <MaturityMeter current={actual} target={target} />
          <Small>{`Target: ${levelWords(target)}. ${maturityGap(actual, target) ?? ''}`.trim()}</Small>
        </div>
      ) : <Small>No maturity guidance is published for this control.</Small>}
    </SectionCard>
  );
}

function RelatedCard() {
  const { d } = useWorkspace();
  const [all, setAll] = useState(false);
  const rows = [
    ...(d.related?.family ?? []).map((c) => ({ id: c.control_id, title: c.title, why: 'Same control family' })),
    ...(d.related?.by_requirements ?? []).map((c) => ({ id: c.control_id, title: c.title, why: c.requirements?.length ? `Shares ${c.requirements.join(', ')}` : `Shares ${c.shared} ${c.shared === 1 ? 'requirement' : 'requirements'}` })),
  ];
  const scope = (d.scope_frameworks ?? []).map((f) => f.label).join(', ');
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <SectionCard id="related" title="Related controls" meta={rows.length ? String(rows.length) : undefined}>
      {rows.length === 0 ? <Small>{scope ? `No other in-scope control shares ${scope} requirements with this one.` : 'No related controls.'}</Small> : (
        <>
          <ul className="flex flex-col gap-[8px]">
            {shown.map((c) => (
              <li key={`${c.id}-${c.why}`} className="min-w-0">
                <Link href={`/automation/soc2-controls/${encodeURIComponent(c.id)}`} prefetch={false} className="flex min-w-0 items-baseline gap-[8px] rounded-ds-control py-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                  <span className="shrink-0 font-mono text-ds-label font-[600] text-ds-primary-text">{c.id}</span>
                  <span className="min-w-0 truncate text-ds-body text-ds-fg" title={c.title ?? undefined}>{c.title}</span>
                </Link>
                <Small>{c.why}</Small>
              </li>
            ))}
          </ul>
          {rows.length > 4 && <Button variant="link" size="sm" className="-ml-[8px] mt-[4px]" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button>}
        </>
      )}
    </SectionCard>
  );
}

function LatestCard() {
  const { d, code, go } = useWorkspace();
  const q = useHistory(d.scope_id, code);
  return (
    <SectionCard id="latest" title="Latest changes" actions={<Button variant="link" size="sm" rightIcon={<ArrowRight aria-hidden />} onClick={() => go('activity')}>All activity</Button>}>
      {!d.scope_id ? <Small>Changes are kept once your scope is set up.</Small> : (
        <Loaded q={q} what="the changes" rows={3}>
          {(events) => {
            const rows = feedOf(events, 3);
            return rows.length === 0 ? <Small>Nothing has changed on this control yet.</Small> : (
              <ul className="flex flex-col gap-[8px]">
                {rows.map((r) => (
                  <li key={r.key} className="min-w-0">
                    <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{r.what}</p>
                    <Small>{`${r.who} · ${formatDateTime(r.at)}`}</Small>
                  </li>
                ))}
              </ul>
            );
          }}
        </Loaded>
      )}
    </SectionCard>
  );
}

function FieldsRow() {
  const { code } = useWorkspace();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['control-fields', code], enabled: open, queryFn: async () => (await scfApi.controlFields(code)).data.custom_values || {} });
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[4px]">
      <AccordionRow title="Custom fields" meta="Fields your organisation added to controls" open={open} onOpenChange={setOpen} region={false}>
        {open && (
          <div className="px-[8px] pb-[8px]">
            <Loaded q={q} what="the fields" rows={2}>
              {(values) => (
                <EntityFieldsPanel moduleKey="controls" initial={values} onSave={async (v) => { await scfApi.saveControlFields(code, v); await qc.invalidateQueries({ queryKey: ['control-fields', code] }); }} />
              )}
            </Loaded>
          </div>
        )}
      </AccordionRow>
    </div>
  );
}

export function SummaryTab() {
  const { d, isCustom } = useWorkspace();
  return (
    <div className="flex flex-col gap-[16px]">
      <div className={GRID}>
        <StatementCard />
        <StandsCard />
        <ApplicabilityCard />
        <MaturityCard />
        {isCustom && <RegisterCard d={d} />}
        {isCustom && <AttachedTests initial={d.bound_check_ids ?? []} />}
        <RelatedCard />
        <LatestCard />
      </div>
      <FieldsRow />
    </div>
  );
}
