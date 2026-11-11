'use client';

/**
 * The AI help that sits beside a field (or, for the gap review, in the Review stage): a button that asks, a panel that shows the suggestion with its origin
 * ("AI", or "Rules" when the server answered without AI), and Accept, Edit, Dismiss. Nothing is saved by asking. Accept hands the change to the page, which
 * puts it through the normal autosave, so it is the person's own change and is recorded as theirs.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button, Checkbox, Notice, StatusPill, Textarea } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { onboardingApi, problemOf, type AiKind, type AiSuggestion, type Step } from '@/lib/frameworkOnboarding';
import {
  actionRefusal, AI_FOR, AI_TITLE, aiChange, aiOrigin, draftStatement, exclusionQuestions, gapQuestions, jumpToRef, labelOfRef, suggestedRows, type AiChange,
} from './workspaceModel';

const PANEL = 'rounded-ds-card border border-ds-border bg-ds-surface-hover p-[12px] focus-visible:outline-none focus-visible:shadow-ds-ring';
const LIST = 'list-disc space-y-[4px] pl-[18px] text-ds-body text-ds-fg-body';
const HEAD = 'text-ds-label font-[600] text-ds-fg';

const isTable = (k: AiKind): k is 'exclusions_check' => k === 'exclusions_check';

export default function AiPanel({ id, kind, current, steps, onAccept, onJump }: {
  id: number;
  kind: AiKind;
  /** the value of the field the help writes to (rows are added after the ones already there) */
  current: unknown;
  steps: ReadonlyArray<Pick<Step, 'key' | 'fields'>>;
  onAccept: (change: AiChange) => void;
  onJump: (stage: string, field: string) => void;
}) {
  const [result, setResult] = useState<AiSuggestion | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ask = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  const run = useMutation({
    mutationFn: () => onboardingApi.ai(id, kind),
    onSuccess: (r) => {
      setResult(r); setEditing(false); setAdded(null);
      setDraft(draftStatement(r.suggestion));
      setPicked(isTable(kind) ? suggestedRows(kind, r.suggestion).map((_, i) => i) : []);
    },
  });
  // the suggestion takes focus when it arrives, so a keyboard user lands on it; Dismiss gives it back to the button
  useEffect(() => { if (result) panel.current?.focus(); }, [result]);

  const dismiss = () => { setResult(null); setEditing(false); window.setTimeout(() => ask.current?.focus(), 0); };
  const accept = () => {
    if (!result) return;
    const change = aiChange(kind, result.suggestion, current, { text: kind === 'scope_draft' ? draft : undefined, rows: editing ? picked : undefined });
    if (!change) return;
    onAccept(change);
    setAdded(kind === 'scope_draft' ? 'Scope statement replaced. It saves with your other changes.' : `${change.added} ${change.added === 1 ? 'row' : 'rows'} added. They save with your other changes.`);
    setResult(null); setEditing(false);
    window.setTimeout(() => ask.current?.focus(), 0);                      // the Accept button is gone: focus goes back to the one that asked
  };

  const origin = result ? aiOrigin(result.by) : null;
  const rows = result && isTable(kind) ? suggestedRows(kind, result.suggestion) : [];
  const nothingToAdd = result !== null && kind !== 'gap_review' && (kind === 'scope_draft' ? !draftStatement(result.suggestion) : rows.length === 0);
  const hasText = typeof current === 'string' && current.trim() !== '';
  const problem = run.error ? problemOf(run.error) : null;

  return (
    <div className="mt-[8px] flex flex-col gap-[8px]">
      {!result && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button ref={ask} size="sm" leftIcon={<Sparkles aria-hidden />} loading={run.isPending} onClick={() => run.mutate()}>
            Ask AI<span className="sr-only"> for {AI_FOR[kind]}</span>
          </Button>
          {added && <span role="status" className="text-ds-label text-ds-fg-muted">{added}</span>}
        </div>
      )}
      {run.isPending && <span role="status" className="sr-only">Asking AI</span>}
      {problem && !result && (
        <Notice tone="danger" title="No suggestion" action={<Button size="sm" onClick={() => run.mutate()}>Try again</Button>}>{actionRefusal('edit', problem)}</Notice>
      )}
      {result && origin && (
        <div ref={panel} tabIndex={-1} role="region" aria-label={AI_TITLE[kind]} className={PANEL}>
          <div className="mb-[8px] flex flex-wrap items-center gap-[8px]">
            <StatusPill tone="pending" size="sm" label={origin.tag} />
            <span className={HEAD}>{AI_TITLE[kind]}</span>
            <InfoTip text={origin.note} label={`About this ${AI_TITLE[kind].toLowerCase()}`} />
          </div>

          {kind === 'scope_draft' && (editing
            ? <Textarea aria-label="Edit the draft" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
            : <p className="whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{draftStatement(result.suggestion) || 'Nothing to suggest yet.'}</p>)}

          {isTable(kind) && (rows.length === 0
            ? <p className="text-ds-body text-ds-fg-muted">Nothing to suggest.</p>
            : <ul className="space-y-[6px]">
              {rows.map((r, i) => {
                const words = [r.item, r.reason].filter(Boolean).join(': ');
                return (
                  <li key={i} className="text-ds-body text-ds-fg-body">
                    {editing
                      ? <Checkbox label={words} checked={picked.includes(i)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))} />
                      : <span className="break-words">{words}</span>}
                  </li>
                );
              })}
            </ul>)}

          {kind === 'exclusions_check' && exclusionQuestions(result.suggestion).length > 0 && (
            <div className="mt-[10px]">
              <p className={HEAD}>An auditor may ask</p>
              <ul className={LIST}>{exclusionQuestions(result.suggestion).map((q, i) => <li key={i}><strong className="font-[600]">{q.item}</strong>: {q.why}</li>)}</ul>
            </div>
          )}

          {kind === 'gap_review' && (gapQuestions(result.suggestion).length === 0
            ? <p className="text-ds-body text-ds-fg-muted">No questions to raise.</p>
            : <ul className="space-y-[8px]">
              {gapQuestions(result.suggestion).map((q, i) => {
                const at = jumpToRef(q.field, steps);
                const label = labelOfRef(q.field, steps);
                return (
                  <li key={i} className="text-ds-body text-ds-fg-body">
                    <span className="break-words">{q.question}</span>
                    {at && label && <Button size="sm" variant="link" className="ml-[6px]" rightIcon={<ArrowRight aria-hidden />} onClick={() => onJump(at.stage, at.field)}>{label}</Button>}
                  </li>
                );
              })}
            </ul>)}

          {kind === 'scope_draft' && hasText && !nothingToAdd && <p className="mt-[8px] text-ds-label text-ds-fg-muted">Accepting replaces the statement above.</p>}
          <div className="mt-[12px] flex flex-wrap gap-[8px]">
            {kind !== 'gap_review' && !nothingToAdd && <Button size="sm" variant="primary" disabled={editing && kind !== 'scope_draft' && picked.length === 0} onClick={accept}>Accept</Button>}
            {kind !== 'gap_review' && !nothingToAdd && <Button size="sm" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? 'Done editing' : 'Edit'}</Button>}
            <Button size="sm" onClick={dismiss}>Dismiss</Button>
          </div>
        </div>
      )}
    </div>
  );
}
