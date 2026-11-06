'use client';

// FormError: what the server said about a save that failed, at the top of the form it is about: said ONCE, where the person is looking, with what they typed
// kept, and a Retry that repeats the same save when asking again can help (not for a refusal: a conflict, a missing right, an invalid value). It is a danger
// Notice (an alert, an icon: never colour alone) whose line is the server's own words, cleaned (no markup, no stack trace, at most 240 characters), else the
// `fallback`, else a plain line that says whether the server could be reached. Pass the error the request THREW, not its message: whether to offer Retry is read
// from it. With nothing failed it draws nothing. The pair for it is `useReportedMutation({ toast: 'success', onError: setProblem })` (a drawer that shows its
// failure inline does not also toast it).
//
//   <FormError title="Couldn't save the document" error={problem} onRetry={() => save.mutate(values)} />
import { Button } from './Button';
import { Notice } from './Notice';
import { canRetry, errorMessage } from './reportOutcome';

export interface FormErrorProps {
  /** What failed, as a headline: "Couldn't save the document". */
  title: string;
  /** What the request threw (an axios error, an Error), or null while nothing has failed: then nothing is drawn. A string is taken as the message and always may be retried. */
  error: unknown;
  /** Repeats the save. Offered only when asking again can help; left out, no Retry. */
  onRetry?: () => void;
  /** Said when the server gave no usable words, instead of "Please try again."; what the server says always wins. */
  fallback?: string;
  /** Layout only (margin, width). */
  className?: string;
}

export function FormError({ title, error, onRetry, fallback, className }: FormErrorProps) {
  if (error === null || error === undefined || error === false) return null;
  const retry = onRetry && canRetry(error)
    ? <Button size="sm" aria-label={`Retry: ${title}`} onClick={onRetry}>Retry</Button>
    : undefined;
  return <Notice tone="danger" title={title} action={retry} className={className}>{errorMessage(error, fallback)}</Notice>;
}
