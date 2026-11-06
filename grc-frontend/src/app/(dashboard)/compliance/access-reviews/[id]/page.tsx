'use client';
// A review. Where it stands (six steps), what to do next, and — once the rules have run —
// three views: Results (what every rule found), Certify (a decision per identity) and Report
// (the verdict and the evidence). One heading, one next action, one place for each job.

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Lock, Settings2, ShieldCheck } from 'lucide-react';
import { PageHeader, PageLoader } from '@/components/ui';
import {
  errorText, useCampaign, useCloseCampaign, useConnectors, useDrawSample, useRunChecks, useSyncPopulation,
} from '../api';
import { STAGES, decisionLabel, isClosed, ruleSetLabel, scopeLabel, statusLabel, statusToStage } from '../pipeline';
import type { Decision, StageIndex } from '../types';
import { useRulesFor } from '../_components/RulePicker';
import { usePageTitle } from '../_components/usePageTitle';
import { Alert, Badge, Button, ButtonLink, Stat, Tabs, panelId, tabId, type TabDef } from '../_components/ui';
import { CertifyTab } from './_parts/CertifyTab';
import { ChangeRulesDialog, selectionOf } from './_parts/ChangeRulesDialog';
import { IdentityDrawer } from './_parts/IdentityDrawer';
import { PlannedRules } from './_parts/PlannedRules';
import { ReportTab } from './_parts/ReportTab';
import { ResultsTab } from './_parts/ResultsTab';
import { Stepper } from './_parts/Stepper';

type View = 'results' | 'certify' | 'report';
const BASE = 'review';
const SAMPLING: Record<string, string> = { random: 'random sample', risk_based: 'risk-weighted sample', full: 'everyone in scope' };
const WORKING = ['Collecting people', 'Drawing the sample', 'Running the rules. Reading a source can take a minute'];

export default function ReviewDetailPage() {
  const router = useRouter();
  const id = Number(useParams().id);
  const params = useSearchParams();
  const campaign = useCampaign(id);
  const connectors = useConnectors();
  const sync = useSyncPopulation(); const sample = useDrawSample();
  const checks = useRunChecks(); const close = useCloseCampaign();
  const [openItem, setOpenItem] = useState<number | null>(null);
  const [editingRules, setEditingRules] = useState(false);
  const [announce, setAnnounce] = useState('');
  const c = campaign.data;
  usePageTitle(c?.name ?? 'Access review');
  const planned = useRulesFor(c ? selectionOf(c) : { rule_scope: 'enabled' }, c?.source);

  if (campaign.isLoading) return <PageLoader />;
  if (campaign.isError || !c) {
    return (
      <Alert tone="error" title="This review could not be opened"
        action={<ButtonLink href="/compliance/access-reviews" size="sm">Back to reviews</ButtonLink>}>
        {errorText(campaign.error, 'It may have been deleted.')}
      </Alert>
    );
  }

  const stage = statusToStage(c.status);
  const closed = isClosed(c.status);
  const checked = closed || stage >= 4;                                  // the rules have run
  const results = c.rule_results ?? [];
  const failedRules = results.filter((r) => r.status === 'fail').length;
  const reviewed = c.items.filter((i) => i.decision !== 'pending').length;
  const sourceLabel = c.source ? connectors.data?.sources.find((s) => s.key === c.source)?.label ?? c.source : null;

  // ?view=results|certify|report  (older links: view=rules, stage=report)
  const asked = params.get('view') === 'rules' ? 'results' : params.get('view') || (params.get('stage') === 'report' ? 'report' : '');
  const view: View = asked === 'results' || asked === 'certify' || asked === 'report' ? asked : closed ? 'report' : 'certify';
  const go = (v: string) => router.replace(`/compliance/access-reviews/${id}?view=${v}`, { scroll: false });

  const step = (Math.min(stage, 6)) as StageIndex;
  const current = STAGES[step - 1];
  const running = [sync, sample, checks][step - 1];
  const advance = () => {
    if (step === 1) sync.mutate(id);
    else if (step === 2) sample.mutate(id);
    else if (step === 3) checks.mutate(id, { onSuccess: () => go('results') });
  };
  const n = planned.rules.length;
  const nextLabel = step === 1 ? 'Collect people' : step === 2 ? 'Draw the sample' : n ? `Run ${n} rule${n === 1 ? '' : 's'}` : 'Run the rules';

  // Save and open next: the highest-risk identity still undecided, after this one
  const order = [...c.items].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  const pendingAfter = (fromId: number) => {
    const i = order.findIndex((u) => u.id === fromId);
    return [...order.slice(i + 1), ...order.slice(0, Math.max(i, 0))].find((u) => u.decision === 'pending' && u.id !== fromId);
  };
  const shown = openItem !== null ? c.items.find((u) => u.id === openItem) : undefined;
  const onSaved = (decision: Decision, next: boolean) => {
    if (!shown) return;
    setAnnounce(`Saved: ${decisionLabel[decision]} for ${shown.display_name || shown.email || 'the identity'}.`);
    setOpenItem(next ? pendingAfter(shown.id)?.id ?? null : null);
  };

  const tabs: TabDef[] = [
    { id: 'results', label: 'Results', badge: failedRules ? `${failedRules} failed` : undefined },
    { id: 'certify', label: 'Certify', badge: `${reviewed}/${c.sample_size}` },
    { id: 'report', label: 'Report' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={c.name} icon={ShieldCheck} subtitle={c.description || undefined}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Access reviews', href: '/compliance/access-reviews' },
          { label: c.name, href: `/compliance/access-reviews/${id}` },
        ]} />

      <div className="-mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
        <Badge tone={closed ? 'emerald' : c.status === 'in_review' ? 'amber' : 'sky'} icon={closed ? Lock : c.status === 'in_review' ? Clock : CheckCircle2}>{statusLabel[c.status]}</Badge>
        <span><span className="text-slate-600">Source </span>{sourceLabel ?? 'Every connected source'}</span>
        <span><span className="text-slate-600">Who </span>{scopeLabel[c.review_type] ?? c.review_type}, {SAMPLING[c.sampling_method] ?? c.sampling_method}</span>
        <span><span className="text-slate-600">Rules </span>{ruleSetLabel(c)}</span>
        {!closed && <Button size="sm" variant="ghost" icon={Settings2} onClick={() => setEditingRules(true)}>Change rules</Button>}
      </div>

      <Stepper stage={checked && view === 'report' && !closed ? 5 : step} closed={closed} />

      <section aria-label="Figures">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Identities in scope" value={c.population_size} />
          <Stat label="Sample" value={step >= 3 || closed ? c.sample_size : '—'} hint={step >= 3 || closed ? 'frozen snapshot' : 'not drawn yet'} />
          <Stat label="Findings" value={checked ? c.exceptions_found : '—'} tone={checked && c.exceptions_found ? 'rose' : undefined}
            hint={checked ? `${failedRules} of ${results.length} rules failed` : 'rules not run yet'} />
          <Stat label="Certified" value={checked ? `${reviewed} of ${c.sample_size}` : '—'} hint={checked ? 'identities decided' : 'after the rules run'} />
        </dl>
      </section>

      {!closed && step <= 3 && (
        <>
          <section aria-labelledby="next-step" className="rounded-xl border-2 border-teal-700 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">Next step · {step} of 6</p>
            <h2 id="next-step" className="mt-0.5 text-lg font-semibold text-slate-900">{current.label}</h2>
            <p className="mt-1 text-sm text-slate-700">{current.desc}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" loading={running.isPending} onClick={advance} disabled={step === 3 && (planned.loading || planned.rules.length === 0)}>{nextLabel}</Button>
              {running.isPending && <span role="status" className="text-sm text-slate-700">{WORKING[step - 1]}…</span>}
            </div>
            {running.isError && <Alert tone="error" className="mt-3">{errorText(running.error)}</Alert>}
          </section>
          <PlannedRules rules={planned.rules} loading={planned.loading} label={ruleSetLabel(c).replace(/ \(\d+\)$/, '')} onChange={() => setEditingRules(true)} />
        </>
      )}

      {checked && (
        <section aria-label="Review">
          <Tabs label="Review views" base={BASE} tabs={tabs} value={view} onChange={go} />
          <div role="tabpanel" id={panelId(BASE, view)} aria-labelledby={tabId(BASE, view)} className="pt-4">
            {view === 'results' && (
              <ResultsTab campaign={c} onUser={setOpenItem}
                onRerun={closed ? undefined : () => checks.mutate(id)} rerunning={checks.isPending} rerunError={checks.error}
                onChangeRules={closed ? undefined : () => setEditingRules(true)} />
            )}
            {view === 'certify' && (
              <CertifyTab campaignId={id} items={c.items} sampleSize={c.sample_size} readOnly={closed} onOpen={setOpenItem} onContinue={() => go('report')} />
            )}
            {view === 'report' && (
              <ReportTab campaign={c} closed={closed} onSeal={() => close.mutate(id)} sealing={close.isPending} sealError={close.error} onSeeRules={() => go('results')} />
            )}
          </div>
        </section>
      )}

      {shown && (
        <IdentityDrawer key={shown.id} campaignId={id} item={shown} results={results} readOnly={closed}
          hasNext={!closed && !!pendingAfter(shown.id)} onClose={() => setOpenItem(null)} onSaved={onSaved} />
      )}
      {editingRules && (
        <ChangeRulesDialog campaign={c} sourceLabel={sourceLabel} rerun={checked} onClose={() => setEditingRules(false)} onRan={() => go('results')} />
      )}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
