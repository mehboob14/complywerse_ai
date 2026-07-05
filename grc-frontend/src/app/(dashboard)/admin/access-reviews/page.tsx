'use client';
// src/app/(dashboard)/admin/access-reviews/page.tsx
// Landing: KPI summary + guided journey + reviews list (each row shows its
// pipeline stage). Visual spec: "Access Reviews.dc.html" (landing screen).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Plus, Plug, ListChecks, ChevronRight, Check, Users, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { useCampaigns, useDashboard, useCreateCampaign } from './api';
import { STAGES, statusToStage, isClosed, scopeLabel } from './pipeline';
import type { Campaign } from './types';
import { CreateReviewModal } from './_components/CreateReviewModal';

const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;

export default function AccessReviewsPage() {
  const router = useRouter();
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: dash } = useDashboard();
  const [showCreate, setShowCreate] = useState(false);

  const hasReviews = (campaigns?.length ?? 0) > 0;
  const hasSource = hasReviews || (dash?.items_total ?? 0) > 0;
  const allClosed = hasReviews && campaigns!.every((c) => isClosed(c.status));
  const activeCount = campaigns?.filter((c) => !isClosed(c.status)).length ?? 0;
  const step = !hasSource ? 1 : !hasReviews ? 2 : 3;

  const primary = useMemo(() => {
    if (step === 1) return { label: 'Connect a source', go: () => router.push('/admin/access-reviews/connect') };
    if (step === 2) return { label: 'Create a review', go: () => setShowCreate(true) };
    if (allClosed) return { label: 'Start new review', go: () => setShowCreate(true) };
    const active = campaigns!.find((c) => !isClosed(c.status) && statusToStage(c.status) >= 4);
    if (active) return { label: 'Continue certifying', go: () => router.push(`/admin/access-reviews/${active.id}`) };
    return { label: 'Open latest review', go: () => router.push(`/admin/access-reviews/${campaigns![0].id}`) };
  }, [step, allClosed, campaigns, router]);

  if (isLoading) return <PageLoader />;

  const reviewed = dash?.items_reviewed ?? 0;
  const sampled = dash?.items_total ?? 0;
  const kpis = [
    { label: 'Active reviews', value: activeCount, sub: 'in progress', Icon: ShieldCheck, tone: 'text-primary-600' },
    { label: 'Awaiting decision', value: Math.max(sampled - reviewed, 0), sub: 'users to certify', Icon: Clock, tone: 'text-amber-600' },
    { label: 'Open exceptions', value: dash?.findings_open ?? 0, sub: `${dash?.users_with_open_exceptions ?? 0} users flagged`, Icon: AlertTriangle, tone: 'text-rose-600' },
    { label: 'Certified', value: sampled ? `${Math.round((reviewed / sampled) * 100)}%` : '0%', sub: `${reviewed} of ${sampled}`, Icon: CheckCircle2, tone: 'text-emerald-600' },
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7 pb-16">
      {/* header */}
      <div className="mb-5 flex items-start justify-between gap-5">
        <div>
          <h1 className="text-[23px] font-bold tracking-tight text-slate-900">Access Reviews</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">Certify that every user holds only the access they should — and prove it.</p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          <button onClick={() => router.push('/admin/access-reviews/connect')} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
            <Plug size={15} /> Sources
          </button>
          <button onClick={() => router.push('/admin/access-reviews/rules')} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
            <ListChecks size={15} /> Rule library
          </button>
          <button disabled={!hasSource} onClick={() => setShowCreate(true)} style={hasSource ? ACCENT : undefined}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold ${hasSource ? 'shadow-sm' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}>
            <Plus size={15} /> New review
          </button>
        </div>
      </div>

      {/* guided journey — the single guidance element */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-stretch">
          {[
            { n: 1, title: 'Connect a source', sub: 'Identity & access data', done: hasSource },
            { n: 2, title: 'Create a review', sub: 'Scope & sample population', done: hasReviews },
            { n: 3, title: 'Run & certify', sub: 'Decide and seal the report', done: allClosed },
          ].map((s, i) => {
            const active = step === s.n;
            return (
              <div key={s.n} className={`flex-1 px-6 py-5 ${i < 2 ? 'border-r border-slate-100' : ''} ${active ? 'bg-[color:var(--color-base-soft)]' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold"
                    style={s.done ? ACCENT : active ? { background: 'var(--color-base-strong)', color: '#fff' } : { background: '#EEF1F4', color: '#8A94A1' }}>
                    {s.done ? <Check size={15} /> : s.n}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Step {s.n}</div>
                    <div className={`text-[13.5px] font-semibold ${active || s.done ? 'text-slate-900' : 'text-slate-500'}`}>{s.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{s.sub}</div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex shrink-0 items-center border-l border-slate-100 bg-slate-50 px-6">
            <button onClick={primary.go} style={ACCENT} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm">
              {primary.label} <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="mb-7 grid grid-cols-4 gap-3.5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex items-center gap-2"><k.Icon size={16} className={k.tone} /><span className="text-[12.5px] font-medium text-slate-500">{k.label}</span></div>
            <div className="font-mono text-[27px] font-bold tracking-tight text-slate-900">{k.value}</div>
            <div className="mt-0.5 text-[11.5px] text-slate-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* reviews list */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Reviews</h2>
        {hasReviews && <span className="text-xs text-slate-400">{campaigns!.length} total</span>}
      </div>

      {hasReviews ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[2.4fr_1fr_2.1fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
            <div>Review</div><div>Scope</div><div>Pipeline stage</div><div>Certified</div>
          </div>
          {campaigns!.map((c) => <ReviewRow key={c.id} c={c} onOpen={() => router.push(`/admin/access-reviews/${c.id}`)} />)}
        </div>
      ) : (
        <EmptyState hasSource={hasSource} onPrimary={primary.go} label={primary.label} />
      )}

      {showCreate && <CreateReviewModal onClose={() => setShowCreate(false)} onCreated={(c) => router.push(`/admin/access-reviews/${c.id}`)} />}
    </div>
  );
}

function ReviewRow({ c, onOpen }: { c: Campaign; onOpen: () => void }) {
  const stage = statusToStage(c.status);
  const closed = isClosed(c.status);
  const pct = c.requested_sample_size ? Math.round((c.items_reviewed / c.requested_sample_size) * 100) : 0;
  return (
    <button onClick={onOpen} className="grid w-full grid-cols-[2.4fr_1fr_2.1fr_1fr] items-center gap-4 border-b border-slate-100 px-5 py-3.5 text-left hover:bg-slate-50">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-slate-900">{c.name}</div>
        <div className="mt-0.5 font-mono text-[11.5px] text-slate-400">AR-{c.id} · {scopeLabel[c.review_type] ?? c.review_type}</div>
      </div>
      <div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{scopeLabel[c.review_type] ?? c.review_type}</span></div>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          {STAGES.map((s) => {
            const done = closed || s.n < stage; const cur = !closed && s.n === stage;
            return <div key={s.n} title={s.label} className="h-[5px] flex-1 rounded-full" style={{ background: done ? 'var(--color-base)' : cur ? 'var(--color-base-strong)' : '#EEF1F4' }} />;
          })}
        </div>
        <div className="text-[11.5px] font-medium text-slate-600">Stage {Math.min(stage, 6)} · {STAGES[Math.min(stage, 6) - 1].label}</div>
      </div>
      <div>
        <div className="font-mono text-[13px] font-semibold text-slate-700">{c.items_reviewed}/{c.requested_sample_size}</div>
        <div className="mt-1.5 h-1 w-[84px] overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-base)' }} /></div>
      </div>
    </button>
  );
}

function EmptyState({ hasSource, onPrimary, label }: { hasSource: boolean; onPrimary: () => void; label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--color-base-soft)', color: 'var(--color-base-strong)' }}>
        <ShieldCheck size={24} />
      </div>
      <div className="text-[15px] font-semibold text-slate-900">{hasSource ? 'No reviews yet' : 'Connect a source to begin'}</div>
      <div className="mx-auto mb-4 mt-1 max-w-sm text-[13px] text-slate-500">
        {hasSource ? 'Create your first review to draw a sample and start certifying access.' : 'Access Reviews pulls users from the identity and access systems you connect — they all feed one user table.'}
      </div>
      <button onClick={onPrimary} style={ACCENT} className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm">{label} <ChevronRight size={15} /></button>
    </div>
  );
}
