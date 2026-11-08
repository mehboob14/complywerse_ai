'use client';

/**
 * The AI draft block, one pattern for every "Suggest with AI" in Risk Assessments: a button, a labelled result, a Use button beside each field, "Use all", and a plain sentence when it fails
 * with Try again. The result says WHERE it came from ("Suggested by AI" / "Suggested by rules": the server used to answer a template in the shape of an AI answer, so a person could save
 * a template believing the AI had drafted it), and says it is a draft to check. Using a suggestion fills the form's field; nothing is saved by it. Never a model, vendor or exception text.
 */
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, ClampedText, StatusPill } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { suggestionSource } from '@/lib/statuses/riskAssessments';

export interface DraftRow { key: string; label: string; value: string | null | undefined; onUse?: () => void }

export interface AiDraftProps {
  state: 'idle' | 'loading' | 'ready' | 'error';
  source: 'ai' | 'rules' | 'unknown';
  rows: readonly DraftRow[];
  /** guidance or rationale, under the rows */
  note?: ReactNode;
  /** what failed, in plain words */
  error?: string;
  onRun: () => void;
  onUseAll?: () => void;
  /** more of the result (suggested scores ...) */
  extra?: ReactNode;
  /** the sentence before a first run */
  idleText?: string;
  /** the button before a first run */
  runLabel?: string;
  disabled?: boolean;
  /** why the button is off */
  disabledReason?: string;
}

const WHERE: Record<'ai' | 'rules' | 'unknown', string> = {
  ai: 'Drafted by the AI from this record. Check it before you use it.',
  rules: 'Standard wording from a template, not drafted by the AI. Check it before you use it.',
  unknown: 'A draft to check before you use it.',
};

export function AiDraft({ state, source, rows, note, error, onRun, onUseAll, extra, idleText, runLabel = 'Suggest with AI', disabled, disabledReason }: AiDraftProps) {
  const busy = state === 'loading';
  return (
    <section aria-label="AI suggestion" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px]">
        <h3 className="m-0 flex items-center gap-[6px] !text-ds-body !font-[600] !text-ds-fg"><Sparkles aria-hidden className="h-[16px] w-[16px] text-ds-primary-text" strokeWidth={1.75} />Suggestion</h3>
        {state === 'ready' && <StatusPill size="sm" {...statusPill(suggestionSource, source === 'unknown' ? 'ai' : source)} {...(source === 'unknown' ? { label: 'Draft' } : {})} />}
        <span className="ml-auto flex flex-wrap items-center gap-[8px]">
          {state === 'ready' && onUseAll && <Button size="sm" onClick={onUseAll}>Use all</Button>}
          <Button size="sm" variant={state === 'ready' ? 'secondary' : 'primary'} loading={busy} disabled={disabled} title={disabled ? disabledReason : undefined} onClick={onRun}>
            {busy ? 'Drafting…' : state === 'ready' || state === 'error' ? 'Suggest again' : runLabel}
          </Button>
        </span>
      </div>

      {state === 'idle' && idleText && <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">{idleText}</p>}
      {state === 'error' && (
        <p role="alert" className="mb-0 mt-[8px] text-ds-body text-ds-danger">{error ?? 'The AI could not draft this right now. Try again, or fill it in yourself.'}</p>
      )}
      {state === 'ready' && (
        <div className="mt-[8px]">
          <p className="m-0 text-ds-label text-ds-fg-muted">{WHERE[source]}</p>
          <ul className="m-0 mt-[8px] list-none p-0">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-[8px] border-t border-ds-border py-[8px] first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">{r.label}</p>
                  <div className="text-ds-body text-ds-fg">{r.value?.trim() ? <ClampedText text={r.value} lines={4} /> : <span className="text-ds-fg-muted">{EMPTY}</span>}</div>
                </div>
                {r.onUse && r.value?.trim() && <Button size="sm" onClick={r.onUse} aria-label={`Use the suggested ${r.label.toLowerCase()}`}>Use</Button>}
              </li>
            ))}
          </ul>
          {extra}
          {note && <div className="mt-[8px] text-ds-label italic text-ds-fg-muted">{note}</div>}
        </div>
      )}
    </section>
  );
}
