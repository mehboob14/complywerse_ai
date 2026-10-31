// What a finished request tells the person who started it, as decisions apart from React so `node --test` can pin them (reportOutcome.test.ts):
// the words of a confirmation and of a failure, whether the failure offers Retry, how a notification becomes a toast, and the options a mutation
// is run with so that it always reports. useNotify and useReportedMutation only carry these out.
import { apiErrorText, safeDetail } from '../../../lib/apiError.ts';
import type { ToastAction, ToastType } from '../Toast';

/** A confirmation of a quick action goes by itself after this long (ms). */
export const SUCCESS_MS = 3000;
/** The headline of an error that was given none. */
export const ERROR_TITLE = 'Something went wrong';
const TRY_AGAIN = 'Please try again.';
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const DONE = 'Done';
// axios codes of a request that got no answer at all
const NO_ANSWER = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT']);

type HttpError = { isAxiosError?: boolean; code?: string; response?: { status?: number } };
const asHttp = (error: unknown): HttpError | null => (error && typeof error === 'object' ? (error as HttpError) : null);

/** The HTTP status the server answered with, or null when it gave none (network down, timeout, a thrown Error). */
export function statusOf(error: unknown): number | null {
  const status = asHttp(error)?.response?.status;
  return typeof status === 'number' ? status : null;
}

function unreachable(error: unknown): boolean {
  const e = asHttp(error);
  return e?.isAxiosError === true && statusOf(e) === null && NO_ANSWER.has(String(e.code));
}

/**
 * What to tell the person about a failure: the server's own words, cleaned (a string is taken as the message), else `fallback`, else a plain line
 * that says whether the server could be reached. Never empty, never markup or a stack trace, at most 240 characters.
 */
export function errorMessage(error: unknown, fallback?: string): string {
  const said = safeDetail(typeof error === 'string' ? error : apiErrorText(error, ''));
  return said || safeDetail(fallback) || (unreachable(error) ? UNREACHABLE : TRY_AGAIN);
}

/** Whether doing the same thing again can come out differently: not when the server has refused the request (invalid, not allowed, a conflict). */
export function canRetry(error: unknown): boolean {
  const status = statusOf(error);
  return status === null || status >= 500 || status === 408 || status === 425 || status === 429;
}

// ── notify.* → toast ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NotifyOptions {
  /** a headline; the message then reads as its detail */
  title?: string;
  /** ms; a confirmation defaults to SUCCESS_MS, a warning or info to the toast default */
  duration?: number;
  action?: ToastAction;
}

export interface NotifyErrorOptions {
  title?: string;
  /** said when the server said nothing usable */
  fallback?: string;
  /** adds a Retry button that calls it */
  retry?: () => void;
}

export interface ToastInput {
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

/** A success, warning or info: one line is the headline; with a `title` the line becomes its detail. */
export function confirmationToast(type: Exclude<ToastType, 'error'>, message: string, options: NotifyOptions = {}): ToastInput {
  const { title, action, duration = type === 'success' ? SUCCESS_MS : undefined } = options;
  return title ? { title, message, type, duration, action } : { title: message, type, duration, action };
}

/** An error: it stays until it is dismissed, says what the server said (cleaned), and carries a Retry when given one. */
export function errorToast(errorOrMessage: unknown, options: NotifyErrorOptions = {}): ToastInput {
  const { title, fallback, retry } = options;
  return {
    title: title?.trim() || ERROR_TITLE,
    message: errorMessage(errorOrMessage, fallback),
    type: 'error',
    duration: 0,
    action: retry ? { label: 'Retry', onClick: retry } : undefined,
  };
}

// ── a mutation's outcome → what is said ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Outcome<D, V> = { ok: true; data: D; variables: V } | { ok: false; error: unknown; variables: V };

/** A confirmation: one line, or a headline with a second line under it. */
export type SuccessWords = string | { title: string; message?: string };

export interface ReportConfig<D, V> {
  /** "Document archived"; `{ title: 'Settings saved', message: 'New requests use them from now on.' }` (a headline and a second line); or a function
   *  of what the server returned that gives either (a throw in it is ignored: the record is saved) */
  success: SuccessWords | ((data: D, variables: V) => SuccessWords);
  /** the headline of the failure: "Couldn't archive the document" */
  failure: string;
  /** said when the server gave no usable words, instead of the plain "Please try again." (what the server says always wins; same rule as errorMessage) */
  fallback?: string;
  /** false: never offer Retry (a create that is not safe to repeat). Otherwise Retry is offered when canRetry(error) */
  retryable?: boolean;
}

/** `title` is there only when the confirmation has a second line: `message` is then that line (the way confirmationToast reads a title). */
export interface SuccessReport { kind: 'success'; message: string; title?: string }
export interface ErrorReport { kind: 'error'; title: string; message: string; retry?: () => void }

/**
 * The words of a confirmation, whatever the caller gave: a string is one line; an object is a headline and, when it has one, a second line. A part
 * that is blank or not text is dropped (a second line without a headline becomes the headline), and nothing usable at all says "Done".
 */
export function successWords(words: unknown): { message: string; title?: string } {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  if (words !== null && typeof words === 'object') {
    const { title, message } = words as { title?: unknown; message?: unknown };
    return text(title) && text(message) ? { title: text(title), message: text(message) } : { message: text(title) || text(message) || DONE };
  }
  return { message: text(words) || DONE };
}

/**
 * What to say about a finished mutation. A success outcome gives a success report and a failure outcome gives an error report, whatever the
 * wording functions do. `rerun` is how a retry runs the request again: the Retry button calls it with the SAME variables.
 */
export function reportOutcome<D, V>(outcome: { ok: true; data: D; variables: V }, config: ReportConfig<D, V>): SuccessReport;
export function reportOutcome<D, V>(outcome: { ok: false; error: unknown; variables: V }, config: ReportConfig<D, V>, rerun?: (variables: V) => void): ErrorReport;
export function reportOutcome<D, V>(outcome: Outcome<D, V>, config: ReportConfig<D, V>, rerun?: (variables: V) => void): SuccessReport | ErrorReport {
  if (outcome.ok) {
    let words: unknown = '';
    try { words = typeof config.success === 'function' ? config.success(outcome.data, outcome.variables) : config.success; } catch { words = ''; }
    return { kind: 'success', ...successWords(words) };
  }
  const retry = rerun && config.retryable !== false && canRetry(outcome.error) ? () => rerun(outcome.variables) : undefined;
  return { kind: 'error', title: (config.failure || '').trim() || ERROR_TITLE, message: errorMessage(outcome.error, config.fallback), retry };
}

/** Which outcomes are toasted. 'always' (the default, what it has always done): the confirmation and the failure. 'success': only the confirmation, for a
 *  drawer or a dialog that shows a failure inline (one message per failure, not two). 'errors': only the failure, for an action whose success is plain to
 *  see (the row changes). 'none': neither, the page reports for itself. The page's own onSuccess, onError and the refresh run in every mode. */
export type ToastMode = 'always' | 'success' | 'errors' | 'none';

/** Whether an outcome of `kind` is toasted in `mode`. A missing or unknown mode is 'always', so every caller that passes none is as it was. */
export function toastsOutcome(mode: ToastMode | undefined, kind: 'success' | 'error'): boolean {
  switch (mode) {
    case 'success': return kind === 'success';
    case 'errors': return kind === 'error';
    case 'none': return false;
    default: return true;
  }
}

export interface ReportedMutationConfig<D, V> extends ReportConfig<D, V> {
  mutationFn: (variables: V) => Promise<D>;
  /** the page's own work once the server has confirmed (close the dialog, clear the form); it runs after the confirmation is shown */
  onSuccess?: (data: D, variables: V) => unknown;
  /** the page's own work after a failure; it runs after the failure is shown (or, with toast 'success' or 'none', in its place: errorMessage(error) has the words) */
  onError?: (error: unknown, variables: V) => unknown;
  /** query keys to refresh once the server has confirmed */
  invalidate?: ReadonlyArray<readonly unknown[]>;
  /** which outcomes are toasted: 'always' (default), 'success', 'errors' or 'none' (see ToastMode) */
  toast?: ToastMode;
}

/** What carrying out a report touches; useReportedMutation supplies the real ones, the tests fakes. */
export interface ReportSinks<V> {
  /** called with one argument for a one-line confirmation; with `{ title }` when there is a second line (`message` is then that line) */
  notifySuccess: (message: string, options?: { title: string }) => void;
  notifyError: (message: string, options: { title: string; retry?: () => void }) => void;
  invalidate: (queryKey: readonly unknown[]) => void;
  /** start the same mutation again */
  rerun: (variables: V) => void;
}

/**
 * The options a mutation runs with so that it always reports. The confirmation is said from `onSuccess` only, so never before the server has
 * answered and never after a failure; a failure stays on screen (Retry when it can help). The page's own `onSuccess` cannot turn a saved record
 * into a reported failure: if it throws, the error is logged and the confirmation stands (a Retry would repeat the write).
 */
export function reportedMutationOptions<D, V>(config: ReportedMutationConfig<D, V>, sinks: ReportSinks<V>) {
  return {
    mutationFn: config.mutationFn,
    onSuccess: async (data: D, variables: V): Promise<void> => {
      const report = reportOutcome({ ok: true, data, variables }, config);
      if (toastsOutcome(config.toast, 'success')) {
        if (report.title) sinks.notifySuccess(report.message, { title: report.title });
        else sinks.notifySuccess(report.message);
      }
      config.invalidate?.forEach((queryKey) => sinks.invalidate(queryKey));
      try { await config.onSuccess?.(data, variables); } catch (error) { console.error(error); }
    },
    onError: async (error: unknown, variables: V): Promise<void> => {
      const report = reportOutcome({ ok: false, error, variables }, config, sinks.rerun);
      if (toastsOutcome(config.toast, 'error')) sinks.notifyError(report.message, { title: report.title, retry: report.retry });
      await config.onError?.(error, variables);
    },
  };
}
