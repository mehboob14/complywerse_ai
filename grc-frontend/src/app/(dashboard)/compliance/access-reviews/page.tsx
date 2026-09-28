'use client';
// src/app/(dashboard)/compliance/access-reviews/page.tsx
// Landing: compact live stat strip + onboarding journey (collapses to a slim
// strip once reviews exist) + a dense, full-width reviews table. The module
// header/tab bar now live in layout.tsx — this page owns content only.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Plus, ChevronRight, Check, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { useCampaigns, useDashboard } from './api';
import { STAGES, statusToStage, isClosed, scopeLabel } from './pipeline';
import type { Campaign } from './types';
import { CreateReviewModal } from './_components/CreateReviewModal';

const ACCENT = { background: 'var(--ar-accent)', color: '#fff' } as const;

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
    if (step === 1) return { label: 'Connect a source', go: () => router.push('/compliance/access-reviews/connect') };
    if (step === 2) return { label: 'Create a review', go: () => setShowCreate(true) };
    if (allClosed) return { label: 'Start new review', go: () => setShowCreate(true) };
    const active = campaigns!.find((c) => !isClosed(c.status) && statusToStage(c.status) >= 4);
    if (active) return { label: 'Continue certifying', go: () => router.push(`/compliance/access-reviews/${active.id}`) };
    return { label: 'Open latest review', go: () => router.push(`/compliance/access-reviews/${campaigns![0].id}`) };
  }, [step, allClosed, campaigns, router]);

  if (isLoading) return <PageLoader />;

  const reviewed = dash?.items_reviewed ?? 0;
  const sampled = dash?.items_total ?? 0;
  const kpis = [
    { label: 'active', value: activeCount, Icon: ShieldCheck, tone: '#4F46E5' },
    { label: 'awaiting decision', value: Math.max(sampled - reviewed, 0), Icon: Clock, tone: '#B45309' },
    { label: 'open exceptions', value: dash?.findings_open ?? 0, Icon: AlertTriangle, tone: '#B42318' },
    { label: 'certified', value: sampled ? `${Math.round((reviewed / sampled) * 100)}%` : '0%', Icon: CheckCircle2, tone: '#15803D' },
  ];

  return (
    <div className="px-6 py-5">
      {/* toolbar: compact stat chips + primary action (Sources/Rule library now live in the tab bar) */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {kpis.map((k) => (
          <div key={k.label} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2" style={{ borderColor: 'var(--ar-border)' }}>
            <k.Icon size={14} style={{ color: k.tone }} />
            <span className="font-mono text-[14px] font-bold" style={{ color: 'var(--ar-text)' }}>{k.value}</span>
            <span className="text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>{k.label}</span>
          </div>
        ))}
        <button
          onClick={() => setShowCreate(true)}
          disabled={!hasSource}
          style={hasSource ? ACCENT : undefined}
          className={`ml-auto inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold ${hasSource ? 'shadow-sm' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}
        >
          <Plus size={14} /> New review
        </button>
      </div>

      {/* onboarding journey — full card pre-first-review, a slim strip after */}
      {step < 3 ? (
        <div className="mb-5 overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: 'var(--ar-border)' }}>
          <div className="flex items-stretch">
            {[
              { n: 1, title: 'Connect a source', sub: 'Identity & access data', done: hasSource },
              { n: 2, title: 'Create a review', sub: 'Scope & sample population', done: hasReviews },
              { n: 3, title: 'Run & certify', sub: 'Decide and seal the report', done: allClosed },
            ].map((s, i) => {
              const active = step === s.n;
              return (
                <div key={s.n} className="flex-1 border-r px-5 py-4 last:border-r-0" style={{ borderColor: 'var(--ar-border)', background: active ? 'var(--ar-accent-soft)' : undefined }}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[12.5px] font-semibold"
                      style={s.done ? ACCENT : active ? { background: 'var(--ar-accent-strong)', color: '#fff' } : { background: '#EEF1F4', color: '#8A94A1' }}>
                      {s.done ? <Check size={13} /> : s.n}
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Step {s.n}</div>
                      <div className="text-[13px] font-semibold" style={{ color: active || s.done ? 'var(--ar-text)' : 'var(--ar-text-muted)' }}>{s.title}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex shrink-0 items-center border-l px-5" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }}>
              <button onClick={primary.go} style={ACCENT} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-[12.5px] font-semibold shadow-sm">
                {primary.label} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        !allClosed && (
          <div className="mb-4 flex items-center justify-between rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-accent-soft)' }}>
            <span className="text-[12.5px] font-medium" style={{ color: 'var(--ar-text)' }}>{activeCount} review{activeCount === 1 ? '' : 's'} in progress</span>
            <button onClick={primary.go} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ar-accent-strong)' }}>{primary.label} <ChevronRight size={13} /></button>
          </div>
        )
      )}

      {/* reviews table */}
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[13px] font-bold" style={{ color: 'var(--ar-text)' }}>Reviews</h2>
        {hasReviews && <span className="text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>{campaigns!.length} total</span>}
      </div>

      {hasReviews ? (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: 'var(--ar-border)' }}>
          <div className="grid grid-cols-[2fr_0.8fr_1.8fr_0.8fr_0.9fr_0.9fr] gap-4 border-b px-5 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}>
            <div>Review</div><div>Scope</div><div>Pipeline stage</div><div>Exceptions</div><div>Certified</div><div>Created</div>
          </div>
          {campaigns!.map((c) => <ReviewRow key={c.id} c={c} onOpen={() => router.push(`/compliance/access-reviews/${c.id}`)} />)}
        </div>
      ) : (
        <EmptyState hasSource={hasSource} onPrimary={primary.go} label={primary.label} />
      )}

      {showCreate && <CreateReviewModal onClose={() => setShowCreate(false)} onCreated={(c) => router.push(`/compliance/access-reviews/${c.id}`)} />}
    </div>
  );
}

function ReviewRow({ c, onOpen }: { c: Campaign; onOpen: () => void }) {
  const stage = statusToStage(c.status);
  const closed = isClosed(c.status);
  const pct = c.requested_sample_size ? Math.round((c.items_reviewed / c.requested_sample_size) * 100) : 0;
  const created = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  return (
    <button onClick={onOpen} className="grid w-full grid-cols-[2fr_0.8fr_1.8fr_0.8fr_0.9fr_0.9fr] items-center gap-4 border-b px-5 py-3 text-left transition-colors hover:bg-[color:var(--ar-surface-alt)]" style={{ borderColor: 'var(--ar-border)' }}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--ar-text)' }}>{c.name}</div>
        <div className="mt-0.5 font-mono text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>AR-{c.id} · {c.sampling_method}</div>
      </div>
      <div><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">{scopeLabel[c.review_type] ?? c.review_type}</span></div>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          {STAGES.map((s) => {
            const done = closed || s.n < stage; const cur = !closed && s.n === stage;
            return <div key={s.n} title={s.label} className="h-[4px] flex-1 rounded-full" style={{ background: done ? 'var(--ar-accent)' : cur ? 'var(--ar-accent-strong)' : '#EEF1F4' }} />;
          })}
        </div>
        <div className="text-[11px] font-medium" style={{ color: 'var(--ar-text-muted)' }}>Stage {Math.min(stage, 6)} · {STAGES[Math.min(stage, 6) - 1].label}</div>
      </div>
      <div>{c.exceptions_found > 0 ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-rose-700">{c.exceptions_found}</span> : <span className="text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>—</span>}</div>
      <div>
        <div className="font-mono text-[12px] font-semibold" style={{ color: 'var(--ar-text)' }}>{c.items_reviewed}/{c.requested_sample_size}</div>
        <div className="mt-1 h-1 w-[64px] overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--ar-accent)' }} /></div>
      </div>
      <div className="text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>{created}</div>
    </button>
  );
}

function EmptyState({ hasSource, onPrimary, label }: { hasSource: boolean; onPrimary: () => void; label: string }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-14 text-center" style={{ borderColor: 'var(--ar-border)', background: 'white' }}>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--ar-accent-soft)', color: 'var(--ar-accent-strong)' }}>
        <ShieldCheck size={24} />
      </div>
      <div className="text-[15px] font-semibold" style={{ color: 'var(--ar-text)' }}>{hasSource ? 'No reviews yet' : 'Connect a source to begin'}</div>
      <div className="mx-auto mb-4 mt-1 max-w-sm text-[13px]" style={{ color: 'var(--ar-text-muted)' }}>
        {hasSource ? 'Create your first review to draw a sample and start certifying access.' : 'Access Reviews pulls users from the identity and access systems you connect — they all feed one user table.'}
      </div>
      <button onClick={onPrimary} style={ACCENT} className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm">{label} <ChevronRight size={15} /></button>
    </div>
  );
}
