'use client';

/**
 * AttentionRail — the right-hand "Needs attention" rail for the Governance
 * Documents workspace (mockup 1D right / 1A KPI cards).
 *
 * Presentational: receives overdue reviews, my-pending sign-offs, attestation
 * gaps and quick-start callbacks via props. The shell owns data + sticky
 * positioning; this component only renders scannable cards and omits any
 * section with no data.
 *
 * Design charter: single teal brand (primary-*) for actions; category tints
 * (rose/amber/violet) only as incidental attention markers; hairline borders,
 * no gradients, dense spacing.
 */

import { AlertCircle, Sparkles, LayoutTemplate } from 'lucide-react';
import type { OverdueReviewItem, MyPendingItem } from './api';

export interface AttentionRailProps {
  overdue: { count: number; documents: OverdueReviewItem[] };
  myPending: { total: number; items: MyPendingItem[] };
  attestationGaps: Array<{ id: number; title: string; pct: number }>; // docs with coverage < 90
  onOpenDoc: (id: number) => void;
  onApprove: (docId: number) => void;
  onReview: (docId: number) => void;
  onAIDraft: () => void;
  onTemplates: () => void;
  loading?: boolean;
}

// ─── Small building blocks ───────────────────────────────────────────────────

function Dot({ className }: { className: string }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

function SecondaryButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function OverdueCard({
  overdue,
  onOpenDoc,
}: {
  overdue: AttentionRailProps['overdue'];
  onOpenDoc: (id: number) => void;
}) {
  const docs = overdue.documents ?? [];
  const shown = docs.slice(0, 4);
  const rest = docs.length - shown.length;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Dot className="bg-rose-500" />
        <span className="text-sm font-medium text-slate-900">
          {overdue.count} review{overdue.count === 1 ? '' : 's'} overdue
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {shown.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenDoc(d.id)}
              className="truncate text-left text-sm text-slate-700 hover:text-primary-700"
              title={d.title}
            >
              {d.title}
            </button>
            <span className="shrink-0 text-xs font-medium text-rose-600">
              {Math.abs(d.days_overdue ?? 0)}d
            </span>
          </div>
        ))}
        {rest > 0 && <div className="text-xs text-slate-400">+{rest} more</div>}
      </div>
    </div>
  );
}

function PendingCard({
  myPending,
  onApprove,
  onReview,
}: {
  myPending: AttentionRailProps['myPending'];
  onApprove: (docId: number) => void;
  onReview: (docId: number) => void;
}) {
  const items = (myPending.items ?? []).slice(0, 3);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Dot className="bg-amber-500" />
        <span className="text-sm font-medium text-slate-900">
          {myPending.total} pending your approval
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {items.map((it) => (
          <div key={it.document_id} className="space-y-1.5">
            <div className="truncate text-sm text-slate-700" title={it.title}>
              {it.title}
            </div>
            {it.stage_label && (
              <div className="text-xs text-slate-400">{it.stage_label}</div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onApprove(it.document_id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onReview(it.document_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Review
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttestationGapsCard({
  attestationGaps,
  onOpenDoc,
}: {
  attestationGaps: AttentionRailProps['attestationGaps'];
  onOpenDoc: (id: number) => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Dot className="bg-violet-500" />
        <span className="text-sm font-medium text-slate-900">
          {attestationGaps.length} attestation gap{attestationGaps.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {attestationGaps.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenDoc(g.id)}
              className="truncate text-left text-sm text-slate-700 hover:text-primary-700"
              title={g.title}
            >
              {g.title}
            </button>
            <span
              className={`shrink-0 text-xs font-medium ${
                g.pct < 70 ? 'text-rose-600' : 'text-amber-700'
              }`}
            >
              {Math.round(g.pct)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickStartCard({
  onAIDraft,
  onTemplates,
}: {
  onAIDraft: () => void;
  onTemplates: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Quick start
      </div>
      <div className="mt-3 space-y-2">
        <SecondaryButton onClick={onAIDraft} icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}>
          Draft a document with AI
        </SecondaryButton>
        <SecondaryButton
          onClick={onTemplates}
          icon={<LayoutTemplate className="h-4 w-4" strokeWidth={1.75} />}
        >
          Browse NCA / ISO templates
        </SecondaryButton>
      </div>
    </div>
  );
}

// ─── Rail ────────────────────────────────────────────────────────────────────

export function AttentionRail({
  overdue,
  myPending,
  attestationGaps,
  onOpenDoc,
  onApprove,
  onReview,
  onAIDraft,
  onTemplates,
  loading = false,
}: AttentionRailProps) {
  const overdueCount = overdue?.count ?? 0;
  const pendingTotal = myPending?.total ?? 0;
  const gaps = attestationGaps ?? [];

  const hasOverdue = overdueCount > 0;
  const hasPending = pendingTotal > 0;
  const hasGaps = gaps.length > 0;
  const allClear = !hasOverdue && !hasPending && !hasGaps;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Needs attention</h3>

      {loading ? (
        <div className="card p-4 text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          {hasOverdue && <OverdueCard overdue={overdue} onOpenDoc={onOpenDoc} />}

          {hasPending && (
            <PendingCard myPending={myPending} onApprove={onApprove} onReview={onReview} />
          )}

          {hasGaps && (
            <AttestationGapsCard attestationGaps={gaps} onOpenDoc={onOpenDoc} />
          )}

          {allClear && (
            <div className="card flex items-center gap-2 p-4 text-sm text-slate-500">
              <AlertCircle className="h-4 w-4 text-emerald-500" strokeWidth={1.75} />
              All clear
            </div>
          )}
        </>
      )}

      <QuickStartCard onAIDraft={onAIDraft} onTemplates={onTemplates} />
    </div>
  );
}
