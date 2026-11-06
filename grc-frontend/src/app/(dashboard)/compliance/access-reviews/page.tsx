'use client';
// Reviews: where you land. What needs doing next, how the work is going, and every review
// in a table you can scan, search and filter. Each row's name is the one link into it.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Lock, Plus, Search, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader, PageLoader } from '@/components/ui';
import { errorText, useCampaigns, useConnectors, useDashboard } from './api';
import { STAGES, isClosed, ruleSetLabel, scopeLabel, statusLabel, statusToStage } from './pipeline';
import type { Campaign } from './types';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, FOCUS, ProgressBar, Stat, inputClass } from './_components/ui';
import { usePageTitle } from './_components/usePageTitle';

const crumbs = [{ label: 'Compliance', href: '/compliance' }, { label: 'Access reviews', href: '/compliance/access-reviews' }];

const STATUS_TONE: Record<string, 'slate' | 'sky' | 'amber' | 'emerald'> = {
  draft: 'slate', population_built: 'sky', sampled: 'sky', in_review: 'amber', completed: 'emerald',
};

export default function AccessReviewsPage() {
  usePageTitle('Reviews');
  const { data: campaigns, isLoading, isError, error, refetch } = useCampaigns();
  const { data: dash } = useDashboard();
  const { data: connectors } = useConnectors();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'sealed'>('all');

  const sourceName = useMemo(() => new Map((connectors?.sources ?? []).map((s) => [s.key, s.label])), [connectors]);
  const rows = useMemo(() => (campaigns ?? [])
    .filter((c) => (status === 'all' ? true : status === 'sealed' ? isClosed(c.status) : !isClosed(c.status)))
    .filter((c) => !q.trim() || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())),
  [campaigns, q, status]);

  if (isLoading) return <PageLoader />;
  if (isError) {
    return (
      <Alert tone="error" title="Your reviews could not be loaded" action={<Button size="sm" onClick={() => refetch()}>Try again</Button>}>
        {errorText(error)}
      </Alert>
    );
  }

  const hasSource = (connectors?.sources?.length ?? 0) > 0 || (dash?.items_total ?? 0) > 0;
  const total = campaigns?.length ?? 0;
  const active = (campaigns ?? []).filter((c) => !isClosed(c.status));
  const toCertify = Math.max((dash?.items_total ?? 0) - (dash?.items_reviewed ?? 0), 0);
  const certifiedPct = dash?.items_total ? Math.round(((dash.items_reviewed ?? 0) / dash.items_total) * 100) : 0;
  const findings = (dash?.findings_open ?? 0) + (dash?.connector_rules_failed ?? 0);
  const next = active.find((c) => statusToStage(c.status) >= 4) ?? active[0];

  return (
    <div className="space-y-5">
      <PageHeader title="Access reviews" icon={ShieldCheck} breadcrumbs={crumbs}
        subtitle="Certify that every person and account holds only the access it should, test the systems behind them, and keep the evidence."
        actions={<ButtonLink href="/compliance/access-reviews/new" variant="primary" icon={Plus}>New review</ButtonLink>} />

      {!hasSource ? (
        <Alert tone="info" title="Start by connecting a source"
          action={<ButtonLink href="/compliance/access-reviews/connect" size="sm" variant="primary">Connect a source</ButtonLink>}>
          A review certifies the people and accounts a source reports — Entra ID, Okta, Google Workspace, DigitalOcean and more — and tests the source itself against its rules.
        </Alert>
      ) : total === 0 ? (
        <Alert tone="info" title="You have a source. Create your first review"
          action={<ButtonLink href="/compliance/access-reviews/new" size="sm" variant="primary">New review</ButtonLink>}>
          Choose what to review, who to certify and which rules to run. Nothing changes in your systems.
        </Alert>
      ) : next ? (
        <Alert tone="info" title={`Next: ${next.name}`}
          action={<ButtonLink href={`/compliance/access-reviews/${next.id}`} size="sm" variant="primary">Continue</ButtonLink>}>
          Stage {Math.min(statusToStage(next.status), 6)} of 6 — {STAGES[Math.min(statusToStage(next.status), 6) - 1].label}.
          {' '}{STAGES[Math.min(statusToStage(next.status), 6) - 1].desc}
        </Alert>
      ) : null}

      <section aria-label="Summary">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Active reviews" value={active.length} hint="not yet sealed" />
          <Stat label="To certify" value={toCertify} hint="identities awaiting a decision" tone={toCertify ? 'amber' : undefined} />
          <Stat label="Open findings" value={findings} hint={`${dash?.users_with_open_exceptions ?? 0} identities flagged · ${dash?.connector_rules_failed ?? 0} failed rules on the estate`} tone={findings ? 'rose' : 'emerald'} />
          <Stat label="Certified" value={`${certifiedPct}%`} hint={`${dash?.items_reviewed ?? 0} of ${dash?.items_total ?? 0} identities`} />
        </dl>
      </section>

      <Card title="All reviews" description={total ? `${total} in total` : undefined} padded={false}
        actions={total > 0 ? (
          <>
            <div className="relative">
              <label htmlFor="review-search" className="sr-only">Search reviews</label>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
              <input id="review-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reviews" className={clsx(inputClass, 'w-56 pl-9')} />
            </div>
            <div>
              <label htmlFor="review-status" className="sr-only">Show</label>
              <select id="review-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
                <option value="all">All reviews</option>
                <option value="active">In progress</option>
                <option value="sealed">Sealed</option>
              </select>
            </div>
          </>
        ) : undefined}>
        {total === 0 ? (
          <div className="p-5">
            <EmptyState icon={ShieldCheck} title="No reviews yet"
              action={hasSource ? <ButtonLink href="/compliance/access-reviews/new" variant="primary" icon={Plus}>New review</ButtonLink>
                : <ButtonLink href="/compliance/access-reviews/connect" variant="primary">Connect a source</ButtonLink>}>
              Reviews you create appear here, with how far each has got.
            </EmptyState>
          </div>
        ) : (
          <>
            <p role="status" className="sr-only">Showing {rows.length} of {total} reviews.</p>
            <div role="region" aria-label="Reviews table" tabIndex={0} className={clsx('relative overflow-x-auto', FOCUS)}>
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <caption className="sr-only">Access reviews, newest first</caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    <th scope="col" className="px-5 py-3">Review</th>
                    <th scope="col" className="px-4 py-3">Source and rules</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="w-[200px] px-4 py-3">Certified</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => <ReviewRow key={c.id} c={c} source={c.source ? sourceName.get(c.source) ?? c.source : 'Every source'} />)}
                  {!rows.length && (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-600">No review matches your search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ReviewRow({ c, source }: { c: Campaign; source: string }) {
  const stage = Math.min(statusToStage(c.status), 6);
  const closed = isClosed(c.status);
  return (
    <tr className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50">
      <td className="px-5 py-4">
        <Link href={`/compliance/access-reviews/${c.id}`} className={clsx('rounded font-semibold text-slate-900 underline-offset-2 hover:underline', FOCUS)}>{c.name}</Link>
        <p className="mt-0.5 text-xs text-slate-600">{scopeLabel[c.review_type] ?? c.review_type} · {c.created_at ? `created ${new Date(c.created_at).toLocaleDateString()}` : ''}</p>
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-slate-900">{source}</p>
        <p className="mt-0.5 text-xs text-slate-600">{ruleSetLabel(c)}</p>
      </td>
      <td className="px-4 py-4">
        <Badge tone={STATUS_TONE[c.status] ?? 'slate'} icon={closed ? Lock : c.status === 'in_review' ? Clock : CheckCircle2}>{statusLabel[c.status] ?? c.status}</Badge>
        <p className="mt-1 text-xs text-slate-600">{closed ? 'Read-only evidence' : `Stage ${stage} of 6 · ${STAGES[stage - 1].label}`}</p>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm tabular-nums text-slate-900">{c.items_reviewed_live} of {c.sample_size}</p>
        <div className="mt-1.5"><ProgressBar value={c.items_reviewed_live} max={c.sample_size || 1} label={`${c.name}: identities certified`} tone={closed ? 'emerald' : 'teal'} /></div>
      </td>
    </tr>
  );
}
