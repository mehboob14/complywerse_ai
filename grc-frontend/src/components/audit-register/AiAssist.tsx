'use client';

/**
 * AI Assist on the add-a-finding form, sitting under the fields it reads from.
 * It proposes values for the empty fields only, each with its reason; list
 * fields only ever get values the platform already has. The person uses one,
 * or all, and every value stays editable. Values worked out from the
 * register or Settings rather than by the model (the owner's usual title,
 * the target date) are marked Auto.
 */
import { Loader2, Sparkles, X } from 'lucide-react';

export type AiSuggestion = {
  field: string; label: string; value: any; display: string; reason: string;
  source: 'ai' | 'rule' | 'register';
};
export type AiAssistResult = {
  suggestions: AiSuggestion[]; dropped: string[]; notice: string | null; model: string | null;
};

const tinyBtn = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50';

export function AiAssistBar({ canRun, running, error, result, pending, appliedCount, labelOf,
  onRun, onUse, onUseAll, onClose }: {
  canRun: boolean; running: boolean; error: string; result: AiAssistResult | null;
  pending: AiSuggestion[]; appliedCount: number; labelOf: (field: string) => string;
  onRun: () => void; onUse: (s: AiSuggestion) => void; onUseAll: () => void; onClose: () => void;
}) {
  return (
    <div className="bg-primary-50/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary-600" />
        <p className="mr-auto text-[11px] text-slate-600">
          {canRun
            ? 'AI Assist fills the empty fields from the report and what you have entered.'
            : 'Enter the issue name or paste the finding text, and AI Assist fills the rest.'}
        </p>
        <button type="button" onClick={onRun} disabled={!canRun || running}
                className={`${tinyBtn} bg-primary-600 py-1 text-[#0a0a0a] hover:bg-primary-700`}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {running ? 'Working…' : result ? 'Suggest again' : 'AI Assist'}
        </button>
      </div>
      {error && <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}

      {result && (
        <div className="mt-2 overflow-hidden rounded-lg border border-primary-200 bg-white">
          {result.notice && (
            <p className="border-b border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">{result.notice}</p>
          )}
          {pending.length > 0 ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
                <span className="text-[11px] font-semibold text-slate-700">
                  {pending.length} suggestion{pending.length === 1 ? '' : 's'}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={onUseAll}
                          className={`${tinyBtn} bg-primary-600 text-[#0a0a0a] hover:bg-primary-700`}>
                    Use all
                  </button>
                  <button type="button" onClick={onClose} aria-label="Dismiss the suggestions"
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ul className="max-h-96 divide-y divide-slate-50 overflow-y-auto">
                {pending.map((s) => (
                  <li key={s.field} className="grid grid-cols-[120px_1fr_auto] items-start gap-2 px-2.5 py-2">
                    <span className="pt-0.5 text-[11px] font-medium text-slate-600">
                      {s.label}
                      {s.source !== 'ai' && (
                        <span title="Worked out from your settings and register, not by the AI"
                              className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-semibold uppercase text-slate-500">
                          Auto
                        </span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs text-slate-900" title={s.display}>
                        {s.display}
                      </p>
                      {s.reason && <p className="mt-0.5 text-[10px] text-slate-400">{s.reason}</p>}
                    </div>
                    <button type="button" onClick={() => onUse(s)}
                            className={`${tinyBtn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex items-center justify-between px-2.5 py-2">
              <p className="text-[11px] text-slate-500">
                {appliedCount ? 'All used. Review the fields, then add the finding.' : 'Nothing to suggest for the empty fields.'}
              </p>
              <button type="button" onClick={onClose} aria-label="Close"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {result.dropped.length > 0 && (
            <p className="border-t border-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">
              Left out because the answer is not in your lists: {result.dropped.map(labelOf).join(', ')}.
              Add values under Settings → Dropdown lists.
            </p>
          )}
          <p className="border-t border-slate-100 px-2.5 py-1.5 text-[10px] text-slate-400">
            AI can be wrong. Check each value against the report. Nothing is saved until you add the finding.
          </p>
        </div>
      )}
    </div>
  );
}
