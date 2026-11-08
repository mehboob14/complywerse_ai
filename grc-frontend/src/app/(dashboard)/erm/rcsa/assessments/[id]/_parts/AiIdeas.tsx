'use client';

// "Ideas for evidence": what Comply Agent suggests an assessor could attach to back an answer (types of document, why, example file names), shown under the question when asked for.
// It reads the unit's own question and nothing else, takes a moment (it is an AI call) and may fail: all three are said in words, with a Retry. The old popover was 384px wide, had no
// way to close it with the keyboard and an "Accept" button that did nothing (the API never sent a value to accept), so it is gone.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { rcsaApi } from '@/lib/api';
import { Button, ErrorState, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';

interface Idea { question_id: number; suggestion: string; reasoning?: string | null; gaps_detected?: string[]; evidence_recommendations?: Array<{ evidence_type: string; description: string; example_files?: string[] }> }

export function AiIdeas({ assessmentId, questionId, label }: { assessmentId: number; questionId: number; label: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['rcsa', 'ai-ideas', assessmentId, questionId],
    queryFn: async () => ((await rcsaApi.getAISuggestions(assessmentId, questionId)).data as Idea[]).find((s) => Number(s.question_id) === questionId) ?? null,
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const panel = `ideas-${questionId}`;
  return (
    <div className="min-w-0">
      <Button size="sm" variant="ghost" leftIcon={<Sparkles aria-hidden />} aria-expanded={open} aria-controls={panel} aria-label={`${open ? 'Hide' : 'Show'} evidence ideas for: ${label}`} onClick={() => setOpen((v) => !v)}>
        Evidence ideas
      </Button>
      {open && (
        <div id={panel} className="mt-[4px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          {q.isLoading && <div role="status" aria-label="Asking Comply Agent"><Skeleton className="h-[16px] w-[60%]" /><Skeleton className="mt-[8px] h-[16px] w-[80%]" /></div>}
          {q.isError && <ErrorState compact title="Comply Agent couldn't answer" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
          {q.isSuccess && !q.data && <p className="text-ds-body text-ds-fg-muted">There are no ideas for this question.</p>}
          {q.isSuccess && q.data && (
            <div className="flex flex-col gap-[8px]">
              <p className="text-ds-body text-ds-fg">{q.data.suggestion}</p>
              {q.data.reasoning && <p className="text-ds-label text-ds-fg-muted">{q.data.reasoning}</p>}
              {(q.data.evidence_recommendations ?? []).length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
                  {(q.data.evidence_recommendations ?? []).map((r) => (
                    <li key={r.evidence_type} className="text-ds-body text-ds-fg-body">
                      <span className="font-[600] text-ds-fg">{r.evidence_type}</span>
                      {` · ${r.description}`}
                      {(r.example_files ?? []).length > 0 && <span className="block text-ds-label text-ds-fg-muted">{`For example: ${(r.example_files ?? []).join(', ')}`}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-ds-label text-ds-fg-muted">These are suggestions. Attach what you really have.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
