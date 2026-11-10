'use client';

// Comply analysis > Write-up: the AI's short read of the figures for a committee: a risk level, how far to trust the numbers and what to do. It is written from the SAVED figures on request, says it was
// written by AI and by whom, and is marked when it was written before the latest changes. A failed write says so in plain words with Try again (the guard that protects what is sent to the AI answers in
// words too); nothing the AI said is ever shown as a fact: "Check it before relying on it".
import { Sparkles } from 'lucide-react';
import { Button, Notice, SectionCard, StatusPill } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { formatDateTime } from '@/lib/format';
import { analysisConfidence, analysisRisk } from '@/lib/statuses/vendorInsights';
import type { FairAnalysis } from '../../../_lib/fair/fairModel';

export default function WriteUpTab({ a, canEdit, busy, dirty, error, onWrite }: { a: FairAnalysis; canEdit: boolean; busy: boolean; dirty: boolean; error: string | null; onWrite: () => void }) {
  const w = a.ai_review;
  return (
    <div className="flex flex-col gap-[16px]">
      {error && <Notice tone="danger" title="No write-up" action={<Button size="sm" onClick={onWrite} loading={busy}>Try again</Button>}>{error}</Notice>}
      {dirty && <Notice tone="warning" title="You have changes that are not saved">The write-up is made from the saved figures. Save and run first.</Notice>}
      <SectionCard
        id="write-up" title="What it means"
        actions={canEdit ? <Button leftIcon={<Sparkles aria-hidden />} loading={busy} disabled={dirty} onClick={onWrite}>{w ? 'Write it again' : 'Write it up with AI'}</Button> : undefined}
      >
        {!w ? (
          <p className="text-ds-body text-ds-fg-muted">The AI can turn these figures into a short read for a committee: a risk level, how far to trust the numbers, and what to do.</p>
        ) : (
          <div className="flex flex-col gap-[12px] text-ds-body text-ds-fg-body">
            <p className="flex flex-wrap items-center gap-[8px]">
              <StatusPill size="sm" {...statusPill(analysisRisk, w.risk_level)} />
              <StatusPill size="sm" {...statusPill(analysisConfidence, w.confidence)} />
              {a.ai_review_stale && <span className="rounded-full bg-ds-warning-soft px-[8px] text-ds-label font-[600] text-ds-warning">Written before the latest changes</span>}
            </p>
            <p className="text-ds-body text-ds-fg-body">{w.summary}</p>
            {w.reasons.length > 0 && <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px]">{w.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
            {w.actions.length > 0 && (
              <div>
                <p className="text-ds-label font-[600] text-ds-fg-muted">What to do</p>
                <ul className="m-0 mt-[4px] flex list-disc flex-col gap-[4px] pl-[20px]">{w.actions.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            {w.insurance && <p className="rounded-ds-control bg-ds-surface-subtle px-[12px] py-[8px]"><b className="font-[600]">Insurance: </b>{w.insurance}</p>}
            <p className="text-ds-label text-ds-fg-muted">Written by AI from the figures{w.by ? ` at ${w.by}’s request` : ''} on {formatDateTime(w.at)}. Check it before relying on it.</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
