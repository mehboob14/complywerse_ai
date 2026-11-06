'use client';

// "Suggest exceptions": pick a policy (or all of them), press Suggest, and AI proposes exceptions that may need raising; "Use" opens the new-exception
// drawer filled with one. AI is opt-in, exactly as before: opening this, or changing the policy, asks for nothing; only Suggest does. What changed is
// that a request that failed now says so (with Retry) instead of reading as "No suggestions found".
import { useRef, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { AnimatedModal, MultiSelectDropdown } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, Skeleton, StatusPill } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import type { ExceptionCandidate, PolicyOption } from './_types';

type Run =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; candidates: ExceptionCandidate[]; source: string }
  | { status: 'failed'; error: unknown };

export function SuggestDialog({ policies, canCreate, onClose, onRaise }: {
  policies: { data?: PolicyOption[]; isLoading: boolean };
  canCreate: boolean;
  onClose: () => void;
  /** open the new-exception drawer against a policy, optionally filled with a suggestion */
  onRaise: (documentId: number, opts?: { title?: string; justification?: string; priority?: string }) => void;
}) {
  // empty until a policy (or "all") is picked: AI never runs before they press Suggest
  const [target, setTarget] = useState<number | 'all' | ''>('');
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const latest = useRef(0);                                        // an answer for a policy that is no longer the one picked is dropped

  const suggest = async () => {
    if (target === '') return;
    const mine = ++latest.current;
    setRun({ status: 'loading' });
    try {
      const params: { document_id?: number; limit: number } = { limit: 8 };
      if (target !== 'all') params.document_id = target;
      const res = await policyExceptionApi.suggestCandidates(params);
      if (mine === latest.current) setRun({ status: 'done', candidates: (res.data?.candidates || []) as ExceptionCandidate[], source: res.data?.source || '' });
    } catch (error) {
      if (mine === latest.current) setRun({ status: 'failed', error });
    }
  };
  const pick = (values: string[]) => {
    const value = values[0] || '';
    latest.current += 1;
    setTarget(value === '' ? '' : value === 'all' ? 'all' : Number(value));
    setRun({ status: 'idle' });
  };

  const chosen = typeof target === 'number' ? (policies.data ?? []).find((d) => d.id === target) ?? null : null;
  const candidates = run.status === 'done' ? run.candidates : [];

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Suggest exceptions"
      headerAccessory={(
        <InfoTip align="end" label="About suggesting exceptions"
          text="Pick a policy, or all of them, then press Suggest: AI proposes exceptions you may need to raise. Nothing runs until you press Suggest." />
      )}
    >
      <div className="flex flex-col gap-[16px] px-[20px] py-[20px]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <MultiSelectDropdown
            title="Policy"
            items={[{ value: 'all', label: 'All policies', subLabel: 'Scan across every policy' },
              ...(policies.data ?? []).map((d) => ({ value: String(d.id), label: d.title, subLabel: d.document_code || d.doc_type }))]}
            selectedValues={target === '' ? [] : [String(target)]}
            onApply={pick}
            multiSelect={false}
            triggerVariant="input"
            triggerClassName="w-full"
            size="sm"
            placeholder={policies.isLoading ? 'Loading policies…' : 'Select a policy…'}
            searchPlaceholder="Search policies…"
            forceSearch
            className="min-w-0 flex-1"
          />
          <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={run.status === 'loading'} disabled={target === ''} onClick={suggest}>
            {candidates.length ? 'Refresh' : 'Suggest'}
          </Button>
        </div>

        {chosen && canCreate && (
          <div className="flex items-center justify-between gap-2 rounded-ds-card border border-ds-border p-[12px]">
            <div className="min-w-0">
              <p className="truncate text-ds-body font-[600] text-ds-fg" title={chosen.title}>{chosen.title}</p>
              <p className="text-ds-label capitalize text-ds-fg-muted">{[chosen.doc_type || 'policy', chosen.document_code].filter(Boolean).join(' · ')}</p>
            </div>
            <Button leftIcon={<Plus aria-hidden />} onClick={() => onRaise(chosen.id)}>New exception</Button>
          </div>
        )}

        <div className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto" aria-live="polite">
          {run.status === 'loading' && (
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">{target === 'all' ? 'Analyzing your policies' : 'Analyzing this policy'}</span>
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[64px] w-full" />)}
            </div>
          )}
          {run.status === 'idle' && (
            <p className="rounded-ds-card border border-dashed border-ds-border-strong px-[12px] py-[16px] text-center text-ds-body text-ds-fg-muted">Pick a policy, then Suggest</p>
          )}
          {run.status === 'failed' && (
            <ErrorState compact title="Couldn't get suggestions" message={errorMessage(run.error)} onRetry={() => { void suggest(); }} />
          )}
          {run.status === 'done' && candidates.length === 0 && <p className="px-1 py-2 text-ds-body text-ds-fg-muted">No suggestions found</p>}
          {candidates.map((c, i) => (
            <div key={`${c.document_id}-${i}`} className="rounded-ds-card border border-ds-border p-[12px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.suggested_title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ds-label text-ds-fg-muted">
                    <span className="min-w-0 truncate">{c.document_title || `Policy #${c.document_id}`}</span>
                    <StatusPill size="sm" {...statusPill(priorityStatus, c.suggested_priority)} />
                  </div>
                </div>
                {canCreate && (
                  <Button leftIcon={<Plus aria-hidden />} onClick={() => onRaise(c.document_id, { title: c.suggested_title, justification: c.rationale, priority: c.suggested_priority })}>Use</Button>
                )}
              </div>
              {c.rationale && <p className="mt-2 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.rationale}</p>}
            </div>
          ))}
        </div>

        {run.status === 'done' && run.source === 'template' && candidates.length > 0 && (
          <p className="flex items-center gap-1 text-ds-label text-ds-fg-muted">
            From policy details only
            <InfoTip label="About these suggestions" text="Generated from policy metadata. Configure an AI key for richer, content-aware suggestions." />
          </p>
        )}
      </div>
    </AnimatedModal>
  );
}
