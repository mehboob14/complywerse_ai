'use client';

// AI Assist on the Add finding form, under the columns it reads from. It proposes values for the EMPTY columns only, each with its reason; a list column only ever gets a value the platform already has
// (anything else is left out and said). The person uses one, or all, and every value stays editable; nothing is saved until the finding is added. Values worked out from the register or Settings
// instead of by AI (the owner's usual title, the target date) are marked Auto. The answer's `model` field is never read or shown: the page says "AI".
import { Sparkles, X } from 'lucide-react';
import { Button, IconButton, Notice } from '@/components/ui/ds';

export type AiSuggestion = { field: string; label: string; value: unknown; display: string; reason: string; source: 'ai' | 'rule' | 'register' };
export type AiAssistResult = { suggestions: AiSuggestion[]; dropped: string[]; notice: string | null };

export function AiAssistPanel({ canRun, running, error, result, pending, appliedCount, labelOf, onRun, onUse, onUseAll, onClose }: {
  canRun: boolean; running: boolean; error: string; result: AiAssistResult | null; pending: AiSuggestion[]; appliedCount: number; labelOf: (field: string) => string;
  onRun: () => void; onUse: (s: AiSuggestion) => void; onUseAll: () => void; onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-primary-soft p-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Sparkles aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" />
        <p className="m-0 min-w-0 flex-1 basis-[200px] text-ds-body text-ds-fg-body">
          {canRun ? 'AI Assist fills the empty fields from the report and what you have entered.' : 'Enter the issue name or paste the finding text, and AI Assist fills the rest.'}
        </p>
        <Button leftIcon={<Sparkles aria-hidden />} loading={running} disabled={!canRun} onClick={onRun}>{result ? 'Suggest again' : 'AI Assist'}</Button>
      </div>
      {error && <Notice tone="danger" title="AI Assist could not run" action={<Button disabled={running} onClick={onRun}>Try again</Button>}>{error}</Notice>}

      {result && (
        <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[8px]">
          {result.notice && <Notice tone="warning">{result.notice}</Notice>}
          {pending.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-[8px]">
                <span className="text-ds-body font-[600] text-ds-fg">{pending.length} {pending.length === 1 ? 'suggestion' : 'suggestions'}</span>
                <span className="flex items-center gap-[4px]">
                  <Button variant="primary" size="sm" onClick={onUseAll}>Use all</Button>
                  <IconButton label="Dismiss the suggestions" onClick={onClose}><X aria-hidden /></IconButton>
                </span>
              </div>
              <ul className="m-0 flex max-h-[360px] list-none flex-col gap-[8px] overflow-y-auto p-0">
                {pending.map((s) => (
                  <li key={s.field} className="grid items-start gap-x-[8px] gap-y-[2px] border-t border-ds-border pt-[8px] first:border-t-0 first:pt-0 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
                    <span className="text-ds-label font-[600] text-ds-fg-muted">{s.label}{s.source !== 'ai' ? ' · Auto' : ''}</span>
                    <div className="min-w-0">
                      <p className="m-0 line-clamp-4 whitespace-pre-wrap break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{s.display}</p>
                      {s.reason && <p className="m-0 text-ds-label text-ds-fg-muted">{s.reason}</p>}
                    </div>
                    <Button size="sm" onClick={() => onUse(s)}>Use</Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex items-center justify-between gap-[8px]">
              <p className="m-0 text-ds-body text-ds-fg-muted">{appliedCount ? 'All used. Review the fields, then add the finding.' : 'Nothing to suggest for the empty fields.'}</p>
              <IconButton label="Close" onClick={onClose}><X aria-hidden /></IconButton>
            </div>
          )}
          {result.dropped.length > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">Left out because the answer is not in your lists: {result.dropped.map(labelOf).join(', ')}. Add values under Setup, Dropdown lists.</p>}
          <p className="m-0 text-ds-label text-ds-fg-muted">AI can be wrong. Check each value against the report. Nothing is saved until you add the finding.</p>
        </div>
      )}
    </div>
  );
}
