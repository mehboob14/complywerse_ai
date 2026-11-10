'use client';

// One message of the conversation. The person's words are a bubble on the right; an answer is a card on the left with the AI mark, drawn from
// Markdown, with its sources and a "show more results" button when the server has more. An answer that is still coming says so (and how long it
// has taken), one the guard refused says why in plain words and offers to edit the question, one that failed says what happened and offers Retry.
// Nothing here shows only on hover.
import { memo, useEffect, useState } from 'react';
import { ChevronDown, Copy, Loader2, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/ds/Button';
import { ErrorState } from '@/components/ui/ds/ErrorState';
import { Notice } from '@/components/ui/ds/Notice';
import { AnswerMarkdown } from './AnswerMarkdown';
import { SourceCards } from './SourceCards';
import { clockTime, shownSoFar, type ChatMessage } from './chatModel';

export interface MessageActions {
  onRetry: (messageId: string) => void;
  onLoadMore: (messageId: string) => void;
  onEditQuestion: (question: string) => void;
  onCopy: (text: string) => void;
}

/** Whole seconds since `active` became true (0 while it is not). */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return undefined; }
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

const SLOW_AFTER = 20;

function Thinking({ seconds }: { seconds: number }) {
  const words = seconds >= SLOW_AFTER ? `Still working. This is taking longer than usual (${seconds} s). You can press Stop.` : seconds >= 5 ? `Thinking… ${seconds} s` : 'Thinking…';
  return (
    <div role="status" className="flex items-center gap-2 text-ds-body text-ds-fg-body">
      <Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin" strokeWidth={1.75} />
      <span>{words}</span>
    </div>
  );
}

export const MessageView = memo(function MessageView({ message, busy, moreLoading, actions }: { message: ChatMessage; busy: boolean; moreLoading: boolean; actions: MessageActions }) {
  const seconds = useElapsed(!!message.isLoading);

  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[88%] sm:max-w-[80%]">
          <span className="sr-only">You asked: </span>
          <div className="whitespace-pre-wrap break-words rounded-ds-card bg-ds-primary px-[12px] py-[8px] text-ds-body text-ds-on-primary [overflow-wrap:anywhere]">{message.content}</div>
          <p className="mt-[2px] px-[4px] text-right text-ds-label text-ds-fg-muted">{clockTime(message.timestamp)}</p>
        </div>
      </li>
    );
  }

  const failed = message.outcome === 'failed';
  const refused = message.outcome === 'blocked';
  const answered = !message.isLoading && !failed && !refused;
  return (
    <li className="flex gap-[10px]">
      <span aria-hidden className="mt-[2px] grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-primary-text">
        <Sparkles className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 max-w-[94%] flex-1">
        <span className="sr-only">Comply Agent answered: </span>
        {message.isLoading ? (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]"><Thinking seconds={seconds} /></div>
        ) : refused ? (
          <Notice tone="warning" title={message.content} className="max-w-[640px]" action={message.originalQuestion ? (
            <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => actions.onEditQuestion(message.originalQuestion as string)}>Edit question</Button>
          ) : undefined}>
            {message.reason ? `${message.reason} ` : ''}Nothing from this question was sent.
          </Notice>
        ) : failed ? (
          <div className="max-w-[640px] rounded-ds-card border border-ds-border bg-ds-surface">
            <ErrorState compact title={message.content} onRetry={message.retryable === false || busy ? undefined : () => actions.onRetry(message.id)} />
          </div>
        ) : (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[14px] py-[10px]">
            <AnswerMarkdown text={message.content} />
            {message.hasMore && (
              <div className="mt-[12px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border pt-[10px]">
                <Button leftIcon={<ChevronDown aria-hidden />} loading={moreLoading} disabled={busy && !moreLoading} onClick={() => actions.onLoadMore(message.id)}>Show more results</Button>
                {message.totalCount ? <span className="text-ds-label text-ds-fg-muted">{shownSoFar(message)} of {message.totalCount} shown</span> : null}
              </div>
            )}
            <SourceCards sources={message.sources} />
          </div>
        )}
        <div className="mt-[2px] flex items-center gap-[4px] px-[2px]">
          <span className="text-ds-label text-ds-fg-muted">{message.isLoading ? '' : clockTime(message.timestamp)}</span>
          {answered && (
            <Button size="sm" variant="ghost" leftIcon={<Copy aria-hidden />} onClick={() => actions.onCopy(message.content)}>Copy</Button>
          )}
        </div>
      </div>
    </li>
  );
});
